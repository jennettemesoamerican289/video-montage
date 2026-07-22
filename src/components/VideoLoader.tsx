import { useState } from 'react'

interface Props {
  onFile: (file: File) => void
}

// Стартовый экран: большая зона для перетаскивания или выбора видеофайла.
export default function VideoLoader({ onFile }: Props) {
  const [over, setOver] = useState(false)

  return (
    <div className="loader">
      <label
        className={`dropzone hud-panel ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) onFile(file)
        }}
      >
        <div className="dz-icon">🎞️</div>
        <div className="dz-title">Перетащите видео сюда</div>
        <div className="dz-sub">или нажмите, чтобы выбрать файл</div>
        <input
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      <p className="loader-hint">
        Кадры видео появятся на таймлайне. Дальше можно добавить mp3 и расставить озвучку.
      </p>
    </div>
  )
}
