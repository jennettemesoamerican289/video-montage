import { useState } from 'react'

interface Props {
  onFile: (file: File) => void
}

// Start screen: a large area to drop or pick a video file.
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
        <div className="dz-title">Drop a video here</div>
        <div className="dz-sub">or click to choose a file</div>
        <input
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      <p className="loader-hint">
        Video frames will appear on the timeline. Then you can add mp3s and lay out the voiceover.
      </p>
    </div>
  )
}
