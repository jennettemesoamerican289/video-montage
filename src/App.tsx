import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioAsset, AudioClip, Crop, Cut, ExportResult, Video } from './types'
import {
  exportMontage,
  getProject,
  getVoiceoverPlan,
  saveProject,
  uploadAudio,
  uploadVideo,
} from './api'
import ProjectPicker from './components/ProjectPicker'
import VideoLoader from './components/VideoLoader'
import Timeline from './components/Timeline'
import ExportPanel from './components/ExportPanel'
import TransportBar from './components/TransportBar'
import ImportDialog from './components/ImportDialog'
import CropOverlay from './components/CropOverlay'
import { useTransport } from './useTransport'

const MIN_PX = 6
const MAX_PX = 300
const DEFAULT_PX = 40

type SaveState = 'idle' | 'saving' | 'saved'

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [video, setVideo] = useState<Video | null>(null)
  const [clips, setClips] = useState<AudioClip[]>([])
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copied, setCopied] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [cropMode, setCropMode] = useState(false)
  const [cuts, setCuts] = useState<Cut[]>([])
  const [cutMode, setCutMode] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Suppresses one autosave run — right after a project is loaded from the server.
  const suppressSave = useRef(false)
  // Synced preview: video + audio clips play together, cuts are skipped over.
  const transport = useTransport(videoRef, clips, cuts)

  const withBusy = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(null)
    }
  }, [])

  // --- Open / close project -------------------------------------------------
  const openProject = useCallback(
    (id: string) =>
      withBusy('Opening project…', async () => {
        const p = await getProject(id)
        suppressSave.current = true
        setProjectId(p.id)
        setProjectName(p.name)
        setVideo(p.video)
        setClips(p.clips)
        setCrop(p.crop)
        setCropMode(false)
        setCuts(p.cuts)
        setCutMode(false)
        setResult(null)
        setSaveState('saved')
      }),
    [withBusy],
  )

  const closeProject = useCallback(() => {
    setProjectId(null)
    setProjectName('')
    setVideo(null)
    setClips([])
    setCrop(null)
    setCropMode(false)
    setCuts([])
    setCutMode(false)
    setResult(null)
    setSaveState('idle')
  }, [])

  // --- Debounced autosave of state (name + clips + crop + cuts) --------------
  useEffect(() => {
    if (!projectId) return
    if (suppressSave.current) {
      suppressSave.current = false
      return
    }
    setSaveState('saving')
    const t = setTimeout(async () => {
      try {
        await saveProject(projectId, { name: projectName, clips, crop, cuts })
        setSaveState('saved')
      } catch {
        setSaveState('idle')
      }
    }, 600)
    return () => clearTimeout(t)
  }, [clips, projectName, projectId, crop, cuts])

  // --- Media -----------------------------------------------------------------
  const handleVideoFile = useCallback(
    (file: File) =>
      withBusy('Extracting frames from video…', async () => {
        if (!projectId) return
        const v = await uploadVideo(projectId, file)
        setVideo(v)
        setCrop(null) // server reset the crop for the new file
        setCuts([]) // and the cuts
        setResult(null)
      }),
    [withBusy, projectId],
  )

  // Batch mp3 upload: files are placed BACK-TO-BACK, one after another, in pick order.
  // startAt is set on drop (start at the cursor position), otherwise from the layout end.
  const addAudioFiles = useCallback(
    async (files: File[], startAt?: number) => {
      if (!projectId || files.length === 0) return
      setError(null)
      try {
        const assets: AudioAsset[] = []
        for (let i = 0; i < files.length; i++) {
          setBusy(`Uploading audio ${i + 1}/${files.length}: ${files[i].name}`)
          assets.push(await uploadAudio(projectId, files[i]))
        }
        setClips((prev) => {
          let cursor =
            startAt ?? prev.reduce((max, c) => Math.max(max, c.start + c.duration), 0)
          cursor = Math.max(0, cursor)
          const added: AudioClip[] = assets.map((a) => {
            const clip: AudioClip = {
              clipId: crypto.randomUUID(),
              audioId: a.id,
              name: a.name,
              duration: a.duration,
              url: a.url,
              start: cursor,
            }
            cursor += a.duration // next one right after this
            return clip
          })
          return [...prev, ...added]
        })
        setResult(null)
      } catch (e) {
        setError(String((e as Error).message || e))
      } finally {
        setBusy(null)
      }
    },
    [projectId],
  )

  const moveClip = useCallback((clipId: string, start: number) => {
    setClips((prev) =>
      prev.map((c) => (c.clipId === clipId ? { ...c, start: Math.max(0, start) } : c)),
    )
    setResult(null)
  }, [])

  const removeClip = useCallback((clipId: string) => {
    setClips((prev) => prev.filter((c) => c.clipId !== clipId))
    setResult(null)
  }, [])

  // Voiceover import by timings: each file is placed at its segment's start.
  const importVoiceover = useCallback(
    async (files: File[], starts: number[], replace: boolean) => {
      if (!projectId || files.length === 0) return
      setShowImport(false)
      setError(null)
      try {
        const added: AudioClip[] = []
        for (let i = 0; i < files.length; i++) {
          setBusy(`Importing voiceover ${i + 1}/${files.length}: ${files[i].name}`)
          const a = await uploadAudio(projectId, files[i])
          added.push({
            clipId: crypto.randomUUID(),
            audioId: a.id,
            name: a.name,
            duration: a.duration,
            url: a.url,
            start: Math.max(0, starts[i]),
          })
        }
        setClips((prev) => (replace ? added : [...prev, ...added]))
        setResult(null)
      } catch (e) {
        setError(String((e as Error).message || e))
      } finally {
        setBusy(null)
      }
    },
    [projectId],
  )

  // Adds a cut [start,end] (seconds of the original video).
  const addCut = useCallback((start: number, end: number) => {
    if (end - start < 0.05) return
    setCuts((prev) => [...prev, { start, end }].sort((a, b) => a.start - b.start))
    setResult(null)
  }, [])

  const removeCut = useCallback((index: number) => {
    setCuts((prev) => prev.filter((_, i) => i !== index))
    setResult(null)
  }, [])

  // Removes all audio clips from the timeline at once (with confirmation).
  const clearAudio = useCallback(() => {
    setClips((prev) => {
      if (prev.length === 0) return prev
      if (!confirm(`Remove all audio clips (${prev.length})?`)) return prev
      setResult(null)
      return []
    })
  }, [])

  const handleExport = useCallback(
    () =>
      withBusy('Building mp4 (re-encoding may take a while)…', async () => {
        if (!projectId) return
        const r = await exportMontage(projectId, clips, crop, cuts)
        setResult(r)
      }),
    [withBusy, projectId, clips, crop, cuts],
  )

  // Copies the voiceover-plan JSON (frames + timings) to the clipboard for Claude Code.
  const handleCopyPlan = useCallback(async () => {
    if (!projectId) return
    setError(null)
    try {
      const plan = await getVoiceoverPlan(projectId)
      await navigator.clipboard.writeText(JSON.stringify(plan, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }, [projectId])

  const zoom = (factor: number) =>
    setPxPerSec((p) => Math.min(MAX_PX, Math.max(MIN_PX, +(p * factor).toFixed(2))))

  // Space — play/pause (except when focus is in an input field).
  useEffect(() => {
    if (!video) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        transport.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [video, transport.toggle])

  // --- Project picker screen -------------------------------------------------
  if (!projectId) {
    return (
      <div className="app">
        {error && <div className="banner error">⚠ {error}</div>}
        <ProjectPicker onOpen={openProject} />
      </div>
    )
  }

  // --- Project editor --------------------------------------------------------
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button className="btn ghost back" onClick={closeProject} title="Back to projects">
            ← Projects
          </button>
          <input
            className="text-input project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            title="Project name"
          />
          <span className={`save-state ${saveState}`}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : ''}
          </span>
        </div>
        <div className="toolbar">
          <label className="btn ghost">
            {video ? 'Replace video' : '+ video'}
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => e.target.files?.[0] && handleVideoFile(e.target.files[0])}
            />
          </label>
          {video && (
            <>
              <label className="btn ghost">
                + audio
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    addAudioFiles(files)
                    e.target.value = ''
                  }}
                />
              </label>
              {clips.length > 0 && (
                <button
                  className="btn danger"
                  onClick={clearAudio}
                  title="Remove all audio clips from the timeline"
                >
                  🗑 Clear audio ({clips.length})
                </button>
              )}
              <button
                className={`btn ${cropMode ? 'active' : ''}`}
                onClick={() => {
                  setCropMode((m) => !m)
                  setCutMode(false)
                }}
                title="Crop: drag the frame over the video to trim the edges"
              >
                ⛶ Crop{crop ? ' •' : ''}
              </button>
              {crop && (
                <button className="btn ghost" onClick={() => setCrop(null)} title="Reset crop">
                  Reset
                </button>
              )}
              <button
                className={`btn ${cutMode ? 'active' : ''}`}
                onClick={() => {
                  setCutMode((m) => !m)
                  setCropMode(false)
                }}
                title="Cut: drag across the video track to mark a segment for removal"
              >
                ✂ Cut{cuts.length ? ` (${cuts.length})` : ''}
              </button>
              {cuts.length > 0 && (
                <button className="btn ghost" onClick={() => setCuts([])} title="Remove all cuts">
                  Reset
                </button>
              )}
              <div className="zoom">
                <button className="btn icon" onClick={() => zoom(1 / 1.4)} title="Zoom out">−</button>
                <span className="zoom-label">{Math.round(pxPerSec)} px/s</span>
                <button className="btn icon" onClick={() => zoom(1.4)} title="Zoom in">+</button>
              </div>
            </>
          )}
        </div>
      </header>

      {busy && <div className="banner busy">{busy}</div>}
      {error && <div className="banner error">⚠ {error}</div>}

      {!video ? (
        <VideoLoader onFile={handleVideoFile} />
      ) : (
        <main className="editor">
          <section className="preview">
            <div className="stage hud-panel">
              <video ref={videoRef} src={video.videoUrl} className="player" playsInline />
              {cropMode && <CropOverlay videoRef={videoRef} crop={crop} onChange={setCrop} />}
            </div>
            <div className="meta">
              <strong>{video.name}</strong>
              <span>
                {fmt(video.duration)} · {video.width}×{video.height}
                {video.fps ? ` · ${video.fps} fps` : ''}
              </span>
            </div>
          </section>

          <div className="dock">
            <TransportBar transport={transport} duration={video.duration} />
            <Timeline
              video={video}
              clips={clips}
              cuts={cuts}
              cutMode={cutMode}
              pxPerSec={pxPerSec}
              playheadTime={transport.time}
              onSeek={transport.seek}
              onAddCut={addCut}
              onRemoveCut={removeCut}
              onMoveClip={moveClip}
              onRemoveClip={removeClip}
              onDropAudio={addAudioFiles}
            />
            <ExportPanel
              clipCount={clips.length}
              busy={!!busy}
              result={result}
              copied={copied}
              onCopyPlan={handleCopyPlan}
              onImport={() => setShowImport(true)}
              onExport={handleExport}
            />
          </div>
        </main>
      )}

      {showImport && (
        <ImportDialog onClose={() => setShowImport(false)} onImport={importVoiceover} />
      )}
    </div>
  )
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
