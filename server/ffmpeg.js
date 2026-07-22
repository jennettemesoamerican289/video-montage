// Thin wrappers around ffmpeg/ffprobe (self-contained binaries from npm).
// Everything runs via spawn — commands are built explicitly so we fully
// control filter_complex during export.
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const ffprobePath = ffprobeStatic.path

// Small previews for the timeline strip (height, cap on frame count).
export const THUMB = { height: 90, maxFrames: 400, quality: 5, prefix: 'frame' }
// Large frames for Claude Code analysis: readable resolution but sparser in time,
// so we don't produce hundreds of images or burn tokens when reviewing them.
export const KEYFRAME = { height: 720, maxFrames: 60, quality: 2, prefix: 'key' }

// Runs a process, collecting stderr for a clear error.
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d))
    proc.stderr.on('data', (d) => (stderr += d))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${path.basename(bin)} exited ${code}\n${stderr.slice(-2000)}`))
    })
  })
}

// r_frame_rate comes as a fraction like "30000/1001" — turn it into a number.
function parseFps(raw) {
  if (!raw || raw === '0/0') return null
  const [num, den] = raw.split('/').map(Number)
  if (!den) return num || null
  return +(num / den).toFixed(3)
}

// Media file metadata: duration, dimensions, fps.
export async function probe(file) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_type,width,height,r_frame_rate',
    '-of', 'json',
    file,
  ]
  const { stdout } = await run(ffprobePath, args)
  const data = JSON.parse(stdout)
  const streams = data.streams || []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const duration = Number(data.format?.duration) || 0
  return {
    duration,
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: v ? parseFps(v.r_frame_rate) : null,
  }
}

// Extracts video frames as JPGs into outDir. The interval is chosen so there are
// no more than spec.maxFrames frames. scale does not upscale small videos (min with ih).
// Returns a list of { file, t }, where t is the frame's moment in seconds.
export async function extractFrames(file, outDir, duration, spec = THUMB) {
  const interval = Math.max(1, Math.ceil(duration / spec.maxFrames)) // seconds between frames
  const fps = 1 / interval
  // Escape the comma inside min() — otherwise it splits filters.
  const scale = `scale=-2:min(${spec.height}\\,ih)`
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-vf', `fps=${fps},${scale}`,
    '-q:v', String(spec.quality),
    path.join(outDir, `${spec.prefix}-%04d.jpg`),
  ]
  await run(ffmpegPath, args)
  const names = (await readdir(outDir))
    .filter((n) => n.startsWith(`${spec.prefix}-`) && n.endsWith('.jpg'))
    .sort()
  // <prefix>-0001.jpg → t=0, <prefix>-0002.jpg → t=interval, ...
  return names.map((name, i) => ({ file: name, t: i * interval }))
}

// Turns a crop in fractions (0..1) into the pixel filter ffmpeg crop=w:h:x:y.
// Dimensions are rounded to even (yuv420 requirement) and clamped to the frame.
function cropFilter(crop, width, height) {
  if (!crop || !width || !height) return null
  const even = (n) => Math.max(2, Math.round(n / 2) * 2)
  let cw = even(crop.w * width)
  let ch = even(crop.h * height)
  cw = Math.min(cw, even(width))
  ch = Math.min(ch, even(height))
  let cx = Math.round(crop.x * width)
  let cy = Math.round(crop.y * height)
  cx = Math.max(0, Math.min(cx, width - cw))
  cy = Math.max(0, Math.min(cy, height - ch))
  // Full frame — no filter needed.
  if (cw >= even(width) && ch >= even(height) && cx === 0 && cy === 0) return null
  return `crop=${cw}:${ch}:${cx}:${cy}`
}

// Normalizes cuts: drops empty ones, sorts, merges overlaps.
function mergeCuts(cuts, duration) {
  const sorted = (cuts || [])
    .map((c) => ({ start: Math.max(0, Number(c.start)), end: Math.min(duration, Number(c.end)) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const c of sorted) {
    const last = merged[merged.length - 1]
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end)
    else merged.push({ ...c })
  }
  return merged
}

// Inverts cuts into keep-segments (what remains in the video).
function keepSegments(merged, duration) {
  const keep = []
  let pos = 0
  for (const c of merged) {
    if (c.start > pos) keep.push({ from: pos, to: c.start })
    pos = Math.max(pos, c.end)
  }
  if (pos < duration) keep.push({ from: pos, to: duration })
  return keep
}

// Remaps a moment t after cuts: shift left by the total length of cuts before t.
// If t falls inside a cut — returns null (the clip is dropped).
function shiftTime(t, merged) {
  let removed = 0
  for (const c of merged) {
    if (c.end <= t) removed += c.end - c.start
    else if (c.start <= t && t < c.end) return null
  }
  return t - removed
}

// Builds the final mp4: (optional) time cuts + crop + mix of audio clips.
// clips: [{ file: absPath, start: seconds }] in the ORIGINAL video's coordinates.
// opts: { crop?, width, height, duration, cuts? }.
// With cuts the video is sliced into keep-segments (trim+concat), and clip starts
// are remapped; clips inside cuts are dropped. Output length is bounded by -t.
export async function buildExport(videoPath, clips, outPath, opts = {}) {
  const { crop, width, height, duration } = opts
  const merged = duration ? mergeCuts(opts.cuts, duration) : []
  const hasCuts = merged.length > 0

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath]
  for (const c of clips) args.push('-i', c.file)

  const filters = []

  // --- Video branch: cuts (trim+concat) → crop ---
  let vLabel = '0:v'
  let outDuration = duration
  if (hasCuts) {
    const keep = keepSegments(merged, duration)
    outDuration = keep.reduce((s, k) => s + (k.to - k.from), 0)
    keep.forEach((k, i) => {
      filters.push(`[0:v]trim=${k.from.toFixed(3)}:${k.to.toFixed(3)},setpts=PTS-STARTPTS[kv${i}]`)
    })
    filters.push(`${keep.map((_, i) => `[kv${i}]`).join('')}concat=n=${keep.length}:v=1:a=0[vcat]`)
    vLabel = '[vcat]'
  }
  const cf = cropFilter(crop, width, height)
  if (cf) {
    const inLabel = vLabel === '0:v' ? '[0:v]' : vLabel
    filters.push(`${inLabel}${cf}[vout]`)
    vLabel = '[vout]'
  }

  // --- Audio branch: remap starts by cuts, adelay + amix over silence ---
  const remapped = clips
    .map((c, i) => ({ input: i + 1, start: hasCuts ? shiftTime(c.start, merged) : c.start }))
    .filter((c) => c.start != null && c.start >= 0)
  const hasAudio = remapped.length > 0

  if (hasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    const silenceIdx = clips.length + 1 // video = 0, clips 1..n, silence n+1
    const mixLabels = [`[${silenceIdx}:a]`]
    remapped.forEach((c, i) => {
      const delayMs = Math.max(0, Math.round(c.start * 1000))
      filters.push(`[${c.input}:a]adelay=${delayMs}|${delayMs}[d${i}]`)
      mixLabels.push(`[d${i}]`)
    })
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0[aout]`)
  }

  if (filters.length) args.push('-filter_complex', filters.join(';'))
  args.push('-map', vLabel)
  if (hasAudio) args.push('-map', '[aout]')

  // Always re-encode to H.264/AAC + faststart — the mp4 is guaranteed to play.
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')
  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k')
    // anullsrc silence is infinite — bound the output to the final video length.
    if (outDuration && outDuration > 0) args.push('-t', String(outDuration))
    else args.push('-shortest')
  }
  args.push('-movflags', '+faststart', outPath)

  await run(ffmpegPath, args)
  return outPath
}
