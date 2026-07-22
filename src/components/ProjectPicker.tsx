import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../types'
import { createProject, deleteProject, listProjects } from '../api'

interface Props {
  onOpen: (id: string) => void
}

// Start screen: list of saved projects + create a new one.
export default function ProjectPicker({ onOpen }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch((e) => setError(String(e.message || e)))

  useEffect(() => {
    refresh()
  }, [])

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const p = await createProject(name.trim() || 'New project')
      onOpen(p.id)
    } catch (e) {
      setError(String((e as Error).message || e))
      setCreating(false)
    }
  }

  const remove = async (id: string, projName: string) => {
    if (!confirm(`Delete project "${projName}" and all its files?`)) return
    try {
      await deleteProject(id)
      refresh()
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }

  return (
    <div className="picker">
      <div className="eyebrow">◆ Video Montage — Holographic Editor</div>
      <h1 className="picker-title">Projects</h1>
      <p className="picker-sub">Pick a project or create a new one — everything saves automatically.</p>

      <div className="new-project">
        <input
          className="text-input"
          placeholder="New project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !creating && create()}
        />
        <button className="btn primary" disabled={creating} onClick={create}>
          {creating ? 'Creating…' : '+ Create project'}
        </button>
      </div>

      {error && <div className="banner error">⚠ {error}</div>}

      <div className="project-list">
        {projects === null && <div className="muted">Loading…</div>}
        {projects?.length === 0 && <div className="muted">No projects yet.</div>}
        {projects?.map((p) => (
          <div key={p.id} className="project-card hud-panel hoverable" onClick={() => onOpen(p.id)}>
            <div className="pc-main">
              <div className="pc-name">{p.name}</div>
              <div className="pc-meta">
                {p.hasVideo ? '🎞️ has video' : 'no video'} · clips: {p.clipCount} · updated{' '}
                {fmtDate(p.updatedAt)}
              </div>
            </div>
            <button
              className="pc-remove"
              title="Delete project"
              onClick={(e) => {
                e.stopPropagation()
                remove(p.id, p.name)
              }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
