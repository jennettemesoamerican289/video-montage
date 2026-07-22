import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AudioClip, Cut } from './types'

// Синхронное превью: видео — мастер-часы, аудио-клипы играют в своих окнах
// [start, start+duration]. На каждом кадре rAF сверяем время видео и
// запускаем/останавливаем/ресинхроним каждый <audio>. Звук самого видео
// (если есть) микшируется браузером автоматически — получаем предпросмотр
// итогового ролика ещё до сборки mp4.
export interface Transport {
  playing: boolean
  time: number
  toggle: () => void
  play: () => void
  pause: () => void
  seek: (t: number) => void
}

const RESYNC_THRESHOLD = 0.28 // сек рассинхрона, после которого правим currentTime

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

  // Держим пул <audio> в соответствии со списком клипов.
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

  // Останавливаем всё при размонтировании.
  useEffect(() => {
    const p = pool.current
    return () => {
      for (const a of p.values()) a.pause()
    }
  }, [])

  // Выставляет аудио-клипы в согласованное с моментом t состояние.
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

  // rAF-петля во время воспроизведения.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => {
      const v = videoRef.current
      if (v) {
        // Перепрыгиваем вырезанные фрагменты.
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
    // Запускаем клипы текущего окна прямо в user-gesture — разблокирует автоплей аудио.
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
