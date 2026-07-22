import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../types'
import { createProject, deleteProject, listProjects } from '../api'

interface Props {
  onOpen: (id: string) => void
}

// Стартовый экран: список сохранённых проектов + создание нового.
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
      const p = await createProject(name.trim() || 'Новый проект')
      onOpen(p.id)
    } catch (e) {
      setError(String((e as Error).message || e))
      setCreating(false)
    }
  }

  const remove = async (id: string, projName: string) => {
    if (!confirm(`Удалить проект «${projName}» вместе со всеми файлами?`)) return
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
      <h1 className="picker-title">Проекты</h1>
      <p className="picker-sub">Выберите проект или создайте новый — всё сохраняется автоматически.</p>

      <div className="new-project">
        <input
          className="text-input"
          placeholder="Название нового проекта"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !creating && create()}
        />
        <button className="btn primary" disabled={creating} onClick={create}>
          {creating ? 'Создаю…' : '+ Создать проект'}
        </button>
      </div>

      {error && <div className="banner error">⚠ {error}</div>}

      <div className="project-list">
        {projects === null && <div className="muted">Загрузка…</div>}
        {projects?.length === 0 && <div className="muted">Пока нет проектов.</div>}
        {projects?.map((p) => (
          <div key={p.id} className="project-card hud-panel hoverable" onClick={() => onOpen(p.id)}>
            <div className="pc-main">
              <div className="pc-name">{p.name}</div>
              <div className="pc-meta">
                {p.hasVideo ? '🎞️ видео есть' : 'без видео'} · клипов: {p.clipCount} · изменён{' '}
                {fmtDate(p.updatedAt)}
              </div>
            </div>
            <button
              className="pc-remove"
              title="Удалить проект"
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
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
