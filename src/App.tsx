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
  // Гасит один прогон автосохранения — сразу после загрузки проекта с сервера.
  const suppressSave = useRef(false)
  // Синхронное превью: видео + аудио-клипы играют вместе, вырезы перепрыгиваются.
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

  // --- Открытие / закрытие проекта ------------------------------------------
  const openProject = useCallback(
    (id: string) =>
      withBusy('Открываю проект…', async () => {
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

  // --- Автосохранение состояния (имя + клипы) с дебаунсом --------------------
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

  // --- Медиа -----------------------------------------------------------------
  const handleVideoFile = useCallback(
    (file: File) =>
      withBusy('Извлекаю кадры из видео…', async () => {
        if (!projectId) return
        const v = await uploadVideo(projectId, file)
        setVideo(v)
        setCrop(null) // сервер сбросил кроп под новый файл
        setCuts([]) // и вырезы
        setResult(null)
      }),
    [withBusy, projectId],
  )

  // Пакетная загрузка mp3: файлы кладутся ВСТЫК, один за другим, в порядке выбора.
  // startAt задан при drop (начинать с позиции курсора), иначе — от конца раскладки.
  const addAudioFiles = useCallback(
    async (files: File[], startAt?: number) => {
      if (!projectId || files.length === 0) return
      setError(null)
      try {
        const assets: AudioAsset[] = []
        for (let i = 0; i < files.length; i++) {
          setBusy(`Загружаю аудио ${i + 1}/${files.length}: ${files[i].name}`)
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
            cursor += a.duration // следующий встык за этим
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

  // Импорт озвучки по таймингам: каждый файл кладётся на start своего сегмента.
  const importVoiceover = useCallback(
    async (files: File[], starts: number[], replace: boolean) => {
      if (!projectId || files.length === 0) return
      setShowImport(false)
      setError(null)
      try {
        const added: AudioClip[] = []
        for (let i = 0; i < files.length; i++) {
          setBusy(`Импорт озвучки ${i + 1}/${files.length}: ${files[i].name}`)
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

  // Добавляет вырез [start,end] (секунды исходного видео).
  const addCut = useCallback((start: number, end: number) => {
    if (end - start < 0.05) return
    setCuts((prev) => [...prev, { start, end }].sort((a, b) => a.start - b.start))
    setResult(null)
  }, [])

  const removeCut = useCallback((index: number) => {
    setCuts((prev) => prev.filter((_, i) => i !== index))
    setResult(null)
  }, [])

  // Удаляет все аудио-клипы с таймлайна разом (с подтверждением).
  const clearAudio = useCallback(() => {
    setClips((prev) => {
      if (prev.length === 0) return prev
      if (!confirm(`Удалить все аудио-клипы (${prev.length})?`)) return prev
      setResult(null)
      return []
    })
  }, [])

  const handleExport = useCallback(
    () =>
      withBusy('Собираю mp4 (перекодирование может занять время)…', async () => {
        if (!projectId) return
        const r = await exportMontage(projectId, clips, crop, cuts)
        setResult(r)
      }),
    [withBusy, projectId, clips, crop, cuts],
  )

  // Копирует JSON-план озвучки (кадры + тайминги) в буфер для вставки в Claude Code.
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

  // Пробел — play/pause (кроме случаев, когда фокус в поле ввода).
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

  // --- Экран выбора проекта --------------------------------------------------
  if (!projectId) {
    return (
      <div className="app">
        {error && <div className="banner error">⚠ {error}</div>}
        <ProjectPicker onOpen={openProject} />
      </div>
    )
  }

  // --- Редактор проекта ------------------------------------------------------
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button className="btn ghost back" onClick={closeProject} title="К списку проектов">
            ← Проекты
          </button>
          <input
            className="text-input project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            title="Название проекта"
          />
          <span className={`save-state ${saveState}`}>
            {saveState === 'saving' ? 'Сохранение…' : saveState === 'saved' ? 'Сохранено ✓' : ''}
          </span>
        </div>
        <div className="toolbar">
          <label className="btn ghost">
            {video ? 'Заменить видео' : '+ видео'}
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
                + аудио
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
                  title="Удалить все аудио-клипы с таймлайна"
                >
                  🗑 Очистить аудио ({clips.length})
                </button>
              )}
              <button
                className={`btn ${cropMode ? 'active' : ''}`}
                onClick={() => {
                  setCropMode((m) => !m)
                  setCutMode(false)
                }}
                title="Кроп: двигай рамку поверх видео, чтобы обрезать края кадра"
              >
                ⛶ Кроп{crop ? ' •' : ''}
              </button>
              {crop && (
                <button className="btn ghost" onClick={() => setCrop(null)} title="Сбросить кроп">
                  Сброс
                </button>
              )}
              <button
                className={`btn ${cutMode ? 'active' : ''}`}
                onClick={() => {
                  setCutMode((m) => !m)
                  setCropMode(false)
                }}
                title="Вырезать куски: тяни по видео-дорожке, чтобы отметить фрагмент на удаление"
              >
                ✂ Вырезать{cuts.length ? ` (${cuts.length})` : ''}
              </button>
              {cuts.length > 0 && (
                <button className="btn ghost" onClick={() => setCuts([])} title="Убрать все вырезы">
                  Сброс
                </button>
              )}
              <div className="zoom">
                <button className="btn icon" onClick={() => zoom(1 / 1.4)} title="Отдалить">−</button>
                <span className="zoom-label">{Math.round(pxPerSec)} px/с</span>
                <button className="btn icon" onClick={() => zoom(1.4)} title="Приблизить">+</button>
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
