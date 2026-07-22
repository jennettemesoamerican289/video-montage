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

// Нижняя панель: план озвучки для Claude, импорт озвучки по таймингам,
// сборка mp4 и ссылка на результат.
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
        Аудио-клипов на таймлайне: <strong>{clipCount}</strong>
      </div>
      <button
        className="btn"
        onClick={onCopyPlan}
        title="Скопировать JSON с кадрами и таймингами — вставить в Claude Code для генерации текстов озвучки"
      >
        {copied ? 'Скопировано ✓' : '📋 План озвучки для Claude'}
      </button>
      <button
        className="btn"
        onClick={onImport}
        title="Импортировать mp3 по JSON-таймингам от Claude Code"
      >
        📥 Импорт озвучки
      </button>
      <button className="btn primary" disabled={busy} onClick={onExport}>
        {busy ? 'Собираю…' : 'Собрать mp4'}
      </button>
      {result && (
        <a className="btn download" href={result.url} download={result.name}>
          ⬇ Скачать {result.name}
        </a>
      )}
    </footer>
  )
}
