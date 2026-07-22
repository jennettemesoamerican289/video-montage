import { useRef, useState } from 'react'
import type { AudioClip, Cut, Video } from '../types'

interface Props {
  video: Video
  clips: AudioClip[]
  cuts: Cut[]
  cutMode: boolean
  pxPerSec: number
  playheadTime: number
  onSeek: (t: number) => void
  onAddCut: (start: number, end: number) => void
  onRemoveCut: (index: number) => void
  onMoveClip: (clipId: string, start: number) => void
  onRemoveClip: (clipId: string) => void
  onDropAudio: (files: File[], start: number) => void
}

const TRACK_LABEL_W = 72
const VIDEO_TRACK_H = 90
const AUDIO_TRACK_H = 64

// Шаг делений линейки: наименьший «круглый», при котором метки не слипаются.
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
function chooseStep(pxPerSec: number): number {
  for (const s of STEPS) if (s * pxPerSec >= 64) return s
  return STEPS[STEPS.length - 1]
}

function fmtTick(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}с`
}

export default function Timeline({
  video,
  clips,
  cuts,
  cutMode,
  pxPerSec,
  playheadTime,
  onSeek,
  onAddCut,
  onRemoveCut,
  onMoveClip,
  onRemoveClip,
  onDropAudio,
}: Props) {
  const [dragOver, setDragOver] = useState(false)
  // Рисование выреза по видео-дорожке в режиме вырезки.
  const [draw, setDraw] = useState<{ from: number; to: number } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const audioTrackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ clipId: string; startX: number; origStart: number } | null>(null)

  const contentW = Math.max(320, video.duration * pxPerSec + 40)
  const step = chooseStep(pxPerSec)

  // Время в секундах по X-координате указателя (относительно контента).
  const timeAt = (clientX: number) => {
    const el = contentRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(video.duration, (clientX - rect.left) / pxPerSec))
  }
  const seekAt = (clientX: number) => onSeek(timeAt(clientX))

  // --- Вырезка: тянем по видео-дорожке, чтобы отметить фрагмент на удаление ---
  const onCutDown = (e: React.PointerEvent) => {
    if (!cutMode) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const t = timeAt(e.clientX)
    setDraw({ from: t, to: t })
  }
  const onCutMove = (e: React.PointerEvent) => {
    if (!cutMode || !draw) return
    setDraw({ from: draw.from, to: timeAt(e.clientX) })
  }
  const onCutUp = (e: React.PointerEvent) => {
    if (!cutMode || !draw) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    const a = Math.min(draw.from, draw.to)
    const b = Math.max(draw.from, draw.to)
    setDraw(null)
    if (b - a >= 0.05) onAddCut(a, b)
    else onSeek(a) // короткий клик — просто перемотка
  }

  // Перетаскивание аудио-клипа по времени.
  const onClipPointerDown = (e: React.PointerEvent, clip: AudioClip) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { clipId: clip.clipId, startX: e.clientX, origStart: clip.start }
  }
  const onClipPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const delta = (e.clientX - d.startX) / pxPerSec
    onMoveClip(d.clipId, d.origStart + delta)
  }
  const onClipPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      dragRef.current = null
    }
  }

  const ticks: number[] = []
  for (let t = 0; t <= video.duration + 0.001; t += step) ticks.push(t)

  return (
    <div className="timeline">
      <div className="tl-gutter" style={{ width: TRACK_LABEL_W }}>
        <div className="tl-ruler-label" />
        <div className="tl-track-label" style={{ height: VIDEO_TRACK_H }}>Видео</div>
        <div className="tl-track-label" style={{ height: AUDIO_TRACK_H }}>Аудио</div>
      </div>

      <div className="tl-scroll">
        <div className="tl-content" ref={contentRef} style={{ width: contentW }}>
          {/* Линейка времени */}
          <div className="ruler" onClick={(e) => seekAt(e.clientX)}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * pxPerSec }}>
                <span className="tick-label">{fmtTick(t)}</span>
              </div>
            ))}
          </div>

          {/* Дорожка видео: кадры-превью + вырезы (в cutMode — рисование) */}
          <div
            className={`track video-track ${cutMode ? 'cutting' : ''}`}
            style={{ height: VIDEO_TRACK_H }}
            onClick={(e) => !cutMode && seekAt(e.clientX)}
            onPointerDown={onCutDown}
            onPointerMove={onCutMove}
            onPointerUp={onCutUp}
          >
            {video.frames.map((f) => (
              <img
                key={f.url}
                src={f.url}
                alt=""
                draggable={false}
                className="frame"
                style={{ left: f.t * pxPerSec, height: VIDEO_TRACK_H }}
              />
            ))}
            {/* сохранённые вырезы */}
            {cuts.map((c, i) => (
              <div
                key={i}
                className="cut-region"
                style={{ left: c.start * pxPerSec, width: (c.end - c.start) * pxPerSec }}
                title={`Вырез ${c.start.toFixed(2)}–${c.end.toFixed(2)}с`}
              >
                <button
                  className="cut-remove"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveCut(i)
                  }}
                  title="Убрать вырез"
                >
                  ×
                </button>
              </div>
            ))}
            {/* временное выделение при рисовании */}
            {draw && (
              <div
                className="cut-region drawing"
                style={{
                  left: Math.min(draw.from, draw.to) * pxPerSec,
                  width: Math.abs(draw.to - draw.from) * pxPerSec,
                }}
              />
            )}
          </div>

          {/* Дорожка аудио: перетаскиваемые mp3-клипы + приём drop */}
          <div
            ref={audioTrackRef}
            className={`track audio-track ${dragOver ? 'drop' : ''}`}
            style={{ height: AUDIO_TRACK_H }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const rect = audioTrackRef.current!.getBoundingClientRect()
              const start = Math.max(0, (e.clientX - rect.left) / pxPerSec)
              const audioFiles = Array.from(e.dataTransfer.files || []).filter((f) =>
                f.type.startsWith('audio/'),
              )
              if (audioFiles.length) onDropAudio(audioFiles, start)
            }}
          >
            {clips.map((c) => (
              <div
                key={c.clipId}
                className="clip"
                style={{ left: c.start * pxPerSec, width: Math.max(24, c.duration * pxPerSec) }}
                onPointerDown={(e) => onClipPointerDown(e, c)}
                onPointerMove={onClipPointerMove}
                onPointerUp={onClipPointerUp}
                title={`${c.name} · старт ${c.start.toFixed(2)}с · ${c.duration.toFixed(1)}с`}
              >
                <span className="clip-name">{c.name}</span>
                <button
                  className="clip-remove"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemoveClip(c.clipId)}
                  title="Удалить клип"
                >
                  ×
                </button>
              </div>
            ))}
            {clips.length === 0 && (
              <div className="track-hint">Перетащите сюда mp3 или нажмите «+ аудио»</div>
            )}
          </div>

          {/* Плейхед поверх всех дорожек */}
          <div className="playhead" style={{ left: playheadTime * pxPerSec }} />
        </div>
      </div>
    </div>
  )
}
