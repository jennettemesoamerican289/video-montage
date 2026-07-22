// Shared editor data types (match the backend responses).

export interface Frame {
  url: string
  t: number // frame moment in seconds
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

// An audio clip instance placed on the timeline.
export interface AudioClip {
  clipId: string // local instance id (one audio can be placed multiple times)
  audioId: string
  name: string
  duration: number
  url?: string
  start: number // start position on the timeline, seconds
}

export interface ExportResult {
  id: string
  url: string
  name: string
}

// Short project card for the list.
export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  hasVideo: boolean
  clipCount: number
}

// Voiceover plan for Claude Code: frames with on-disk paths + a prompt.
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

// Crop rectangle in fractions (0..1) of the frame size. null = full frame.
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

// A time-based cut-out segment of the video (seconds of the original timeline).
export interface Cut {
  start: number
  end: number
}

// Full project state.
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
