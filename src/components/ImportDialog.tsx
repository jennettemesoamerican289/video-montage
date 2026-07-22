import { useMemo, useState } from 'react'

interface Segment {
  start: number
  end?: number
  text?: string
}
interface Match {
  file: File
  idx: number | null
  start: number | null
}

interface Props {
  onClose: () => void
  onImport: (files: File[], starts: number[], replace: boolean) => void
}

// Parses JSON from Claude Code: an array [{start,end,text}] or { segments: [...] }.
function parseSegments(text: string): Segment[] | null {
  const t = text.trim()
  if (!t) return null
  try {
    let data = JSON.parse(t)
    if (data && !Array.isArray(data) && Array.isArray(data.segments)) data = data.segments
    if (!Array.isArray(data)) return null
    const segs = data
      .map((s: { start?: unknown; end?: unknown; text?: unknown }) => ({
        start: Number(s.start),
        end: s.end != null ? Number(s.end) : undefined,
        text: typeof s.text === 'string' ? s.text : undefined,
      }))
      .filter((s: Segment) => Number.isFinite(s.start))
    return segs.length ? segs : null
  } catch {
    return null
  }
}

// Matches a file to a segment by the first number in its name: 12.mp3 → segments[12].
function matchFiles(files: File[], segments: Segment[] | null): Match[] {
  return files.map((f) => {
    const m = f.name.match(/\d+/)
    const idx = m ? parseInt(m[0], 10) : null
    const seg = idx != null && segments ? segments[idx] : undefined
    return { file: f, idx, start: seg ? seg.start : null }
  })
}

export default function ImportDialog({ onClose, onImport }: Props) {
  const [jsonText, setJsonText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [replace, setReplace] = useState(false)

  const segments = useMemo(() => parseSegments(jsonText), [jsonText])
  const matches = useMemo(() => matchFiles(files, segments), [files, segments])
  const usable = matches.filter((m) => m.start != null)

  const doImport = () => {
    const ok = usable.slice().sort((a, b) => a.start! - b.start!)
    onImport(
      ok.map((m) => m.file),
      ok.map((m) => m.start!),
      replace,
    )
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal hud-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="hud-title">Import voiceover by timings</div>
          <button className="btn ghost btn-x" onClick={onClose}>✕</button>
        </div>

        <p className="modal-hint muted">
          Paste JSON segments from Claude Code (<span className="mono">[{'{'}start, end, text{'}'}, …]</span>)
          and choose mp3s named by segment number: <span className="mono">0.mp3, 1.mp3 …</span>
        </p>

        <textarea
          className="import-json"
          placeholder='[{"start":0,"end":3.5,"text":"…"}, {"start":4,"end":7,"text":"…"}]'
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
        />

        <div className="import-row">
          <span className={`tag ${segments ? 'ok' : 'off'}`}>
            {segments ? `Segments: ${segments.length}` : 'JSON not recognized'}
          </span>
          <label className="btn">
            Choose mp3s
            <input
              type="file"
              accept="audio/*"
              multiple
              hidden
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <span className="tag">Files: {files.length}</span>
          <span className={`tag ${usable.length ? 'ok' : 'off'}`}>Matched: {usable.length}</span>
        </div>

        {files.length > 0 && (
          <div className="import-preview scroll">
            {matches.map((m, i) => (
              <div key={i} className="import-map">
                <span className="mono nm">{m.file.name}</span>
                <span className="arrow">→</span>
                {m.start != null ? (
                  <span className="mono ok">{fmt(m.start)}</span>
                ) : (
                  <span className="mono off">no segment #{m.idx ?? '?'}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <label className="import-check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace current clips on the track
        </label>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={usable.length === 0} onClick={doImport}>
            Import{usable.length ? ` (${usable.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${ms}`
}
