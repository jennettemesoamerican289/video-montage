import type { ExportResult } from '../types'

interface Props {
  clipCount: number
  busy: boolean
  result: ExportResult | null
  copied: boolean
  onCopyPlan: () => void
  onImport: () => void
  onExport: () => void
}

// Bottom panel: voiceover plan for Claude, voiceover import by timings,
// mp4 export and a link to the result.
export default function ExportPanel({
  clipCount,
  busy,
  result,
  copied,
  onCopyPlan,
  onImport,
  onExport,
}: Props) {
  return (
    <footer className="export">
      <div className="export-info">
        Audio clips on the timeline: <strong>{clipCount}</strong>
      </div>
      <button
        className="btn"
        onClick={onCopyPlan}
        title="Copy JSON with frames and timings — paste into Claude Code to generate voiceover text"
      >
        {copied ? 'Copied ✓' : '📋 Voiceover plan for Claude'}
      </button>
      <button
        className="btn"
        onClick={onImport}
        title="Import mp3s by JSON timings from Claude Code"
      >
        📥 Import voiceover
      </button>
      <button className="btn primary" disabled={busy} onClick={onExport}>
        {busy ? 'Building…' : 'Export mp4'}
      </button>
      {result && (
        <a className="btn download" href={result.url} download={result.name}>
          ⬇ Download {result.name}
        </a>
      )}
    </footer>
  )
}
