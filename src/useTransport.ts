import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AudioClip, Cut } from './types'

// Synced preview: the video is the master clock, audio clips play in their windows
// [start, start+duration]. On each rAF frame we check the video time and
// start/stop/resync each <audio>. The video's own sound (if any) is mixed by the
// browser automatically — giving a preview of the final clip before the mp4 export.
export interface Transport {
  playing: boolean
  time: number
  toggle: () => void
  play: () => void
  pause: () => void
  seek: (t: number) => void
}

const RESYNC_THRESHOLD = 0.28 // seconds of drift after which we fix currentTime

export function useTransport(
  videoRef: RefObject<HTMLVideoElement | null>,
  clips: AudioClip[],
  cuts: Cut[] = [],
): Transport {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const pool = useRef<Map<string, HTMLAudioElement>>(new Map())
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const cutsRef = useRef(cuts)
  cutsRef.current = cuts

  // Keep the <audio> pool in sync with the clip list.
  useEffect(() => {
    const p = pool.current
    for (const c of clips) {
      if (c.url && !p.has(c.clipId)) {
        const a = new Audio(c.url)
        a.preload = 'auto'
        p.set(c.clipId, a)
      }
    }
    for (const [id, a] of p) {
      if (!clips.some((c) => c.clipId === id)) {
        a.pause()
        p.delete(id)
      }
    }
  }, [clips])

  // Stop everything on unmount.
  useEffect(() => {
    const p = pool.current
    return () => {
      for (const a of p.values()) a.pause()
    }
  }, [])

  // Brings audio clips into a state consistent with moment t.
  const syncClipsAt = useCallback((t: number, active: boolean) => {
    for (const c of clipsRef.current) {
      const a = pool.current.get(c.clipId)
      if (!a) continue
      const end = c.start + c.duration
      const inside = t >= c.start && t < end
      if (active && inside) {
        const target = t - c.start
        if (a.paused) {
          a.currentTime = target
          a.play().catch(() => {})
        } else if (Math.abs(a.currentTime - target) > RESYNC_THRESHOLD) {
          a.currentTime = target
        }
      } else if (!a.paused) {
        a.pause()
      }
    }
  }, [])

  // rAF loop during playback.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => {
      const v = videoRef.current
      if (v) {
        // Skip over cut-out segments.
        const cut = cutsRef.current.find((c) => v.currentTime >= c.start && v.currentTime < c.end - 0.02)
        if (cut) v.currentTime = cut.end
        setTime(v.currentTime)
        syncClipsAt(v.currentTime, true)
        if (v.ended) {
          for (const a of pool.current.values()) a.pause()
          setPlaying(false)
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, videoRef, syncClipsAt])

  const play = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.ended) v.currentTime = 0
    v.play().catch(() => {})
    // Start clips of the current window right in the user gesture — unlocks audio autoplay.
    syncClipsAt(v.currentTime, true)
    setPlaying(true)
  }, [videoRef, syncClipsAt])

  const pause = useCallback(() => {
    videoRef.current?.pause()
    for (const a of pool.current.values()) a.pause()
    setPlaying(false)
  }, [videoRef])

  const toggle = useCallback(() => {
    if (playing) pause()
    else play()
  }, [playing, play, pause])

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current
      const clamped = Math.max(0, t)
      if (v) v.currentTime = clamped
      setTime(clamped)
      syncClipsAt(clamped, playing)
    },
    [videoRef, playing, syncClipsAt],
  )

  return { playing, time, toggle, play, pause, seek }
}
