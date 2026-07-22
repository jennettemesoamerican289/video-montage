// Локальный бэкенд видеоредактора с проектами.
// Проекты хранятся на диске (см. projects.js) и переживают перезапуск.
// Сервер отвечает за приём медиа, извлечение кадров через ffmpeg,
// раздачу медиа-файлов и сборку mp4.
import express from 'express'
import multer from 'multer'
import { mkdir, rename, copyFile, unlink, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe, extractFrames, buildExport, THUMB, KEYFRAME } from './ffmpeg.js'
import { createProjectStore } from './projects.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA = path.join(ROOT, 'data')
const TMP = path.join(DATA, 'tmp')

for (const d of [DATA, TMP]) {
  if (!existsSync(d)) await mkdir(d, { recursive: true })
}

const store = createProjectStore(DATA)
const PORT = process.env.PORT || 3001
const app = express()
app.use(express.json())

// Раздача всех медиа проектов под /media/projects/<id>/...
app.use('/media', express.static(DATA))

const upload = multer({ dest: TMP })

// multer кладёт файл во временную папку; переносим в целевой каталог.
async function moveFile(from, to) {
  try {
    await rename(from, to)
  } catch (err) {
    if (err.code === 'EXDEV') {
      await copyFile(from, to)
      await unlink(from)
    } else {
      throw err
    }
  }
}

// Собирает клиентское представление проекта: добавляет URL к медиа.
function toClient(p) {
  const base = `/media/projects/${p.id}`
  const video = p.video
    ? {
        id: p.video.id,
        name: p.video.name,
        duration: p.video.duration,
        width: p.video.width,
        height: p.video.height,
        fps: p.video.fps,
        videoUrl: `${base}/video.${p.video.ext}`,
        frames: (p.video.frames || []).map((f) => ({ url: `${base}/frames/${f.file}`, t: f.t })),
      }
    : null
  const clips = (p.clips || []).map((c) => {
    const a = p.audios?.[c.audioId]
    return {
      clipId: c.clipId,
      audioId: c.audioId,
      name: c.name,
      duration: c.duration,
      start: c.start,
      url: a ? `${base}/audio/${c.audioId}.${a.ext}` : null,
    }
  })
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    video,
    clips,
    crop: p.crop ?? null,
    cuts: p.cuts ?? [],
  }
}

// Валидирует список вырезов [{start,end}] в секундах (end>start).
function sanitizeCuts(arr) {
  if (!Array.isArray(arr)) return []
  return arr
    .map((c) => ({ start: Math.max(0, Number(c.start)), end: Number(c.end) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
}

// Валидирует объект кропа {x,y,w,h} в долях 0..1; иначе — null (полный кадр).
function sanitizeCrop(c) {
  if (!c || typeof c !== 'object') return null
  const n = (v) => Math.max(0, Math.min(1, Number(v)))
  const x = n(c.x)
  const y = n(c.y)
  const w = Math.max(0.02, Math.min(1 - x, Number(c.w)))
  const h = Math.max(0.02, Math.min(1 - y, Number(c.h)))
  if (![x, y, w, h].every(Number.isFinite)) return null
  return { x, y, w, h }
}

// Обёртка обработчика: единый формат ошибок.
const h = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (err) {
    console.error(`${req.method} ${req.path} failed:`, err)
    res.status(err.status || 500).json({ error: String(err.message || err) })
  }
}

// Загружает проект или отвечает 404.
async function requireProject(id) {
  if (!(await store.exists(id))) {
    const e = new Error('Проект не найден')
    e.status = 404
    throw e
  }
  return store.read(id)
}

// --- Проекты: список / создание / чтение / сохранение / удаление ------------
app.get('/api/projects', h(async (_req, res) => {
  res.json(await store.list())
}))

app.post('/api/projects', h(async (req, res) => {
  const p = await store.create(req.body?.name)
  res.json(toClient(p))
}))

app.get('/api/projects/:id', h(async (req, res) => {
  const p = await requireProject(req.params.id)
  res.json(toClient(p))
}))

// Автосохранение состояния таймлайна (имя и/или клипы).
app.patch('/api/projects/:id', h(async (req, res) => {
  const p = await requireProject(req.params.id)
  if (typeof req.body?.name === 'string') p.name = req.body.name.trim() || p.name
  if (Array.isArray(req.body?.clips)) {
    p.clips = req.body.clips.map((c) => ({
      clipId: c.clipId,
      audioId: c.audioId,
      name: c.name,
      duration: Number(c.duration) || 0,
      start: Math.max(0, Number(c.start) || 0),
    }))
  }
  if ('crop' in (req.body || {})) p.crop = sanitizeCrop(req.body.crop)
  if ('cuts' in (req.body || {})) p.cuts = sanitizeCuts(req.body.cuts)
  await store.write(p)
  res.json({ ok: true, updatedAt: p.updatedAt })
}))

app.delete('/api/projects/:id', h(async (req, res) => {
  await requireProject(req.params.id)
  await store.remove(req.params.id)
  res.json({ ok: true })
}))

// --- Загрузка видео в проект: probe + кадры --------------------------------
app.post('/api/projects/:id/video', upload.single('file'), h(async (req, res) => {
  const p = await requireProject(req.params.id)
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' })

  const ext = (path.extname(req.file.originalname) || '.mp4').slice(1).toLowerCase()
  const dest = store.sub(p.id, `video.${ext}`)

  // Чистим прежнее видео и оба набора кадров, если пересобираем другим файлом.
  for (const old of await readdir(store.dir(p.id))) {
    if (old.startsWith('video.')) await unlink(store.sub(p.id, old)).catch(() => {})
  }
  const framesDir = store.sub(p.id, 'frames')
  const keyDir = store.sub(p.id, 'keyframes')
  for (const d of [framesDir, keyDir]) {
    await rm(d, { recursive: true, force: true })
    await mkdir(d, { recursive: true })
  }

  await moveFile(req.file.path, dest)
  const meta = await probe(dest)
  if (!meta.hasVideo) return res.status(400).json({ error: 'В файле нет видеодорожки' })
  // Мелкие превью — для таймлайна; крупные keyframes — для анализа Claude Code.
  const frames = await extractFrames(dest, framesDir, meta.duration, THUMB)
  const keyframes = await extractFrames(dest, keyDir, meta.duration, KEYFRAME)

  p.video = {
    id: crypto.randomUUID(),
    name: req.file.originalname,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    ext,
    frames,
    keyframes,
  }
  p.crop = null // новый файл — сбрасываем прежнюю рамку кропа
  p.cuts = [] // и прежние вырезы
  await store.write(p)
  res.json(toClient(p).video)
}))

// --- Загрузка аудио-ассета в проект ----------------------------------------
app.post('/api/projects/:id/audio', upload.single('file'), h(async (req, res) => {
  const p = await requireProject(req.params.id)
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' })

  const audioId = crypto.randomUUID()
  const ext = (path.extname(req.file.originalname) || '.mp3').slice(1).toLowerCase()
  const dest = store.sub(p.id, `audio/${audioId}.${ext}`)
  await moveFile(req.file.path, dest)

  const meta = await probe(dest)
  if (!meta.hasAudio) return res.status(400).json({ error: 'В файле нет аудиодорожки' })

  p.audios = p.audios || {}
  p.audios[audioId] = { name: req.file.originalname, duration: meta.duration, ext }
  await store.write(p)
  res.json({
    id: audioId,
    name: req.file.originalname,
    duration: meta.duration,
    url: `/media/projects/${p.id}/audio/${audioId}.${ext}`,
  })
}))

// --- План озвучки: JSON с кадрами (абсолютные пути) для Claude Code ---------
// Пользователь копирует это в буфер и вставляет в Claude Code — тот открывает
// кадры по путям и возвращает озвучку сегментами {start,end,text}.
app.get('/api/projects/:id/voiceover-plan', h(async (req, res) => {
  const p = await requireProject(req.params.id)
  if (!p.video) return res.status(400).json({ error: 'В проекте нет видео' })

  // Для анализа отдаём КРУПНЫЕ keyframes; на старых проектах их нет — fallback на превью.
  const useKey = Array.isArray(p.video.keyframes) && p.video.keyframes.length > 0
  const list = useKey ? p.video.keyframes : p.video.frames || []
  const framesDir = store.sub(p.id, useKey ? 'keyframes' : 'frames')
  const frames = list.map((f) => ({
    t: f.t,
    path: path.join(framesDir, f.file),
  }))

  const plan = {
    instructions:
      'Ниже кадры видео с таймингами (t — секунда кадра) и абсолютные пути к JPG на диске. ' +
      'Открой кадры (прочитай файлы по path), пойми, что происходит в видео, и напиши закадровую ' +
      'озвучку НА РУССКОМ, разбитую на короткие сегменты. Верни ТОЛЬКО JSON-массив вида ' +
      '[{"start": число_сек, "end": число_сек, "text": "реплика"}]. Правила: ' +
      '(1) короткие фрагменты по 1–2 предложения — их удобно править и озвучивать по отдельности; ' +
      '(2) привязывай start/end к содержимому кадров, чтобы речь совпадала с картинкой; ' +
      '(3) НЕ выдавай один длинный монолит; (4) укладывай текст по длительности (end−start) — ' +
      'ориентир ~2–3 слова в секунду; (5) оставляй паузы, где по видео уместно. ' +
      'Пользователь озвучит каждый сегмент отдельно (mp3) и поставит его на таймлайн в позицию start.',
    project: p.name,
    video: {
      name: p.video.name,
      duration: p.video.duration,
      fps: p.video.fps,
      width: p.video.width,
      height: p.video.height,
    },
    framesDir,
    frames,
    existingAudio: (p.clips || []).map((c) => ({
      name: c.name,
      start: c.start,
      duration: c.duration,
    })),
    responseExample: [
      { start: 0, end: 3.5, text: 'Пример первого короткого фрагмента.' },
      { start: 4, end: 7, text: 'Пример второго фрагмента после небольшой паузы.' },
    ],
  }
  res.json(plan)
}))

// --- Экспорт проекта в mp4 --------------------------------------------------
app.post('/api/projects/:id/export', h(async (req, res) => {
  const p = await requireProject(req.params.id)
  if (!p.video) return res.status(400).json({ error: 'В проекте нет видео' })

  // Если клиент прислал свежую расстановку/кроп — сохраняем перед сборкой.
  if (Array.isArray(req.body?.clips)) {
    p.clips = req.body.clips.map((c) => ({
      clipId: c.clipId,
      audioId: c.audioId,
      name: c.name,
      duration: Number(c.duration) || 0,
      start: Math.max(0, Number(c.start) || 0),
    }))
    await store.write(p)
  }
  if ('crop' in (req.body || {})) {
    p.crop = sanitizeCrop(req.body.crop)
    await store.write(p)
  }
  if ('cuts' in (req.body || {})) {
    p.cuts = sanitizeCuts(req.body.cuts)
    await store.write(p)
  }

  const videoPath = store.sub(p.id, `video.${p.video.ext}`)
  const resolved = []
  for (const c of p.clips || []) {
    const a = p.audios?.[c.audioId]
    if (!a) continue
    resolved.push({ file: store.sub(p.id, `audio/${c.audioId}.${a.ext}`), start: Number(c.start) || 0 })
  }

  const exportId = crypto.randomUUID()
  const outPath = store.sub(p.id, `exports/${exportId}.mp4`)
  await buildExport(videoPath, resolved, outPath, {
    crop: p.crop,
    cuts: p.cuts,
    width: p.video.width,
    height: p.video.height,
    duration: p.video.duration,
  })

  res.json({
    id: exportId,
    url: `/media/projects/${p.id}/exports/${exportId}.mp4`,
    name: `${p.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'montage'}.mp4`,
  })
}))

// В production отдаём собранный фронтенд из dist.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(ROOT, 'dist')
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`▶ video_montage backend: http://localhost:${PORT}`)
})
