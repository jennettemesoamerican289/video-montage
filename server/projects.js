// On-disk project store. Each project is a self-contained folder
// data/projects/<id>/ with project.json (source of truth) and media inside:
//   project.json          — metadata, audio assets, clip layout
//   video.<ext>           — source video (if uploaded)
//   frames/frame-XXXX.jpg — preview frames
//   audio/<audioId>.<ext> — uploaded mp3s
//   exports/<exportId>.mp4 — export results
// Thanks to this, work state survives a server restart.
import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export function createProjectStore(dataRoot) {
  const root = path.join(dataRoot, 'projects')

  const dir = (id) => path.join(root, safeId(id))
  const metaPath = (id) => path.join(dir(id), 'project.json')
  const sub = (id, name) => path.join(dir(id), name)

  async function ensure() {
    if (!existsSync(root)) await mkdir(root, { recursive: true })
  }

  async function read(id) {
    const raw = await readFile(metaPath(id), 'utf8')
    return JSON.parse(raw)
  }

  async function write(project) {
    project.updatedAt = new Date().toISOString()
    await writeFile(metaPath(project.id), JSON.stringify(project, null, 2))
    return project
  }

  async function create(name) {
    await ensure()
    const id = randomUUID()
    await mkdir(dir(id), { recursive: true })
    await mkdir(sub(id, 'frames'), { recursive: true })
    await mkdir(sub(id, 'audio'), { recursive: true })
    await mkdir(sub(id, 'exports'), { recursive: true })
    const now = new Date().toISOString()
    const project = {
      id,
      name: (name && String(name).trim()) || 'Untitled',
      createdAt: now,
      updatedAt: now,
      video: null,
      audios: {},
      clips: [],
    }
    return write(project)
  }

  async function list() {
    await ensure()
    const names = await readdir(root).catch(() => [])
    const out = []
    for (const n of names) {
      try {
        const p = await read(n)
        out.push({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          hasVideo: !!p.video,
          clipCount: (p.clips || []).length,
        })
      } catch {
        /* not a project — skip */
      }
    }
    // Newest / most-recently-changed first.
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return out
  }

  async function remove(id) {
    await rm(dir(id), { recursive: true, force: true })
  }

  async function exists(id) {
    try {
      await stat(metaPath(id))
      return true
    } catch {
      return false
    }
  }

  return { root, dir, sub, read, write, create, list, remove, exists }
}

// Only allow a valid uuid — guards against path traversal in :id.
function safeId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error(`Invalid project id: ${id}`)
  }
  return id
}
