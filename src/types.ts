// Общие типы данных редактора (совпадают с ответами бэкенда).

export interface Frame {
  url: string
  t: number // момент кадра в секундах
}

export interface Video {
  id: string
  name: string
  duration: number
  width: number | null
  height: number | null
  fps: number | null
  videoUrl: string
  frames: Frame[]
}

export interface AudioAsset {
  id: string
  name: string
  duration: number
  url: string
}

// Экземпляр аудио-клипа, размещённый на таймлайне.
export interface AudioClip {
  clipId: string // локальный id инстанса (одно аудио можно положить несколько раз)
  audioId: string
  name: string
  duration: number
  url?: string
  start: number // позиция начала на таймлайне, секунды
}

export interface ExportResult {
  id: string
  url: string
  name: string
}

// Краткая карточка проекта для списка.
export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  hasVideo: boolean
  clipCount: number
}

// План озвучки для Claude Code: кадры с путями на диске + подсказка.
export interface VoiceoverPlan {
  instructions: string
  project: string
  video: {
    name: string
    duration: number
    fps: number | null
    width: number | null
    height: number | null
  }
  framesDir: string
  frames: { t: number; path: string }[]
  existingAudio: { name: string; start: number; duration: number }[]
  responseExample: { start: number; end: number; text: string }[]
}

// Прямоугольник кропа в долях (0..1) от размеров кадра. null = полный кадр.
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

// Вырезанный по времени фрагмент видео (секунды исходного таймлайна).
export interface Cut {
  start: number
  end: number
}

// Полное состояние проекта.
export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  video: Video | null
  clips: AudioClip[]
  crop: Crop | null
  cuts: Cut[]
}
