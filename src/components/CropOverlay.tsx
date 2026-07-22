import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Crop } from '../types'

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>
  crop: Crop | null
  onChange: (c: Crop) => void
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 }
const MIN = 0.05

const HANDLES = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const
type Handle = (typeof HANDLES)[number] | 'move'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Рамка кропа поверх видео. Позиционируется по ФАКТИЧЕСКОМУ прямоугольнику
// видимого кадра (с учётом object-fit: contain и любого letterbox), а не по
// размеру видеоэлемента — иначе на видео не-16:9 рамка уезжает за кадр.
export default function CropOverlay({ videoRef, crop, onChange }: Props) {
  const eff = crop ?? FULL
  const [box, setBox] = useState<Box>({ left: 0, top: 0, width: 0, height: 0 })
  const drag = useRef<{ h: Handle; sx: number; sy: number; orig: Crop } | null>(null)

  // Вычисляет прямоугольник видимого кадра внутри видеоэлемента.
  useLayoutEffect(() => {
    const v = videoRef.current
    if (!v) return
    const measure = () => {
      const cW = v.clientWidth
      const cH = v.clientHeight
      const vW = v.videoWidth || 16
      const vH = v.videoHeight || 9
      const scale = Math.min(cW / vW, cH / vH) || 0
      const dW = vW * scale
      const dH = vH * scale
      setBox({
        left: v.offsetLeft + (cW - dW) / 2,
        top: v.offsetTop + (cH - dH) / 2,
        width: dW,
        height: dH,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(v)
    v.addEventListener('loadedmetadata', measure)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      v.removeEventListener('loadedmetadata', measure)
      window.removeEventListener('resize', measure)
    }
  }, [videoRef])

  const onDown = (h: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { h, sx: e.clientX, sy: e.clientY, orig: eff }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || box.width === 0 || box.height === 0) return
    // delta в долях — относительно ВИДИМОГО кадра, а не элемента.
    const dx = (e.clientX - d.sx) / box.width
    const dy = (e.clientY - d.sy) / box.height
    let { x, y, w, h } = d.orig
    const has = (s: string) => d.h.includes(s)

    if (d.h === 'move') {
      x = clamp(x + dx, 0, 1 - w)
      y = clamp(y + dy, 0, 1 - h)
    } else {
      if (has('l')) {
        const nx = clamp(x + dx, 0, x + w - MIN)
        w += x - nx
        x = nx
      }
      if (has('r')) w = clamp(w + dx, MIN, 1 - x)
      if (has('t')) {
        const ny = clamp(y + dy, 0, y + h - MIN)
        h += y - ny
        y = ny
      }
      if (has('b')) h = clamp(h + dy, MIN, 1 - y)
    }
    onChange({ x, y, w, h })
  }

  const onUp = (e: React.PointerEvent) => {
    if (drag.current) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      drag.current = null
    }
  }

  const pct = (v: number) => `${v * 100}%`

  return (
    <div
      className="crop-overlay"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <div
        className="crop-rect"
        style={{ left: pct(eff.x), top: pct(eff.y), width: pct(eff.w), height: pct(eff.h) }}
        onPointerDown={onDown('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {HANDLES.map((h) => (
          <div
            key={h}
            className={`crop-h crop-${h}`}
            onPointerDown={onDown(h)}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        ))}
      </div>
    </div>
  )
}
