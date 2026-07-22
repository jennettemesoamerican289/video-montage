import type { Transport } from '../useTransport'

interface Props {
  transport: Transport
  duration: number
}

// Playback bar BELOW the video: to-start, play/pause, time, scrubber.
export default function TransportBar({ transport, duration }: Props) {
  const { playing, time, toggle, seek } = transport
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    seek(Math.max(0, Math.min(1, ratio)) * duration)
  }

  return (
    <div className="transport">
      <button className="btn icon" onClick={() => seek(0)} title="To start">⏮</button>
      <button
        className="btn primary play-btn"
        onClick={toggle}
        title={playing ? 'Pause (space)' : 'Play (space)'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="tcode mono">{fmt(time)}</span>
      <div className="scrub" onClick={scrub} title="Seek">
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
        <div className="scrub-knob" style={{ left: `${pct}%` }} />
      </div>
      <span className="tcode mono dim">{fmt(duration)}</span>
    </div>
  )
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
