// Клиент бэкенда. Все пути идут через vite-прокси на localhost:3001.
import type {
  Video,
  AudioAsset,
  AudioClip,
  Crop,
  Cut,
  ExportResult,
  Project,
  ProjectSummary,
  VoiceoverPlan,
} from './types'

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* тело не JSON — оставляем статус */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

function json<T>(url: string, method: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r))
}

async function postFile<T>(url: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  return handle<T>(await fetch(url, { method: 'POST', body: form }))
}

// --- Проекты ---------------------------------------------------------------
export function listProjects(): Promise<ProjectSummary[]> {
  return json<ProjectSummary[]>('/api/projects', 'GET')
}

export function createProject(name: string): Promise<Project> {
  return json<Project>('/api/projects', 'POST', { name })
}

export function getProject(id: string): Promise<Project> {
  return json<Project>(`/api/projects/${id}`, 'GET')
}

export function saveProject(
  id: string,
  patch: { name?: string; clips?: AudioClip[]; crop?: Crop | null; cuts?: Cut[] },
): Promise<{ ok: boolean; updatedAt: string }> {
  // Ключ отправляем только если он задан — иначе сервер решит, что поле чистят.
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.clips !== undefined) {
    body.clips = patch.clips.map((c) => ({
      clipId: c.clipId,
      audioId: c.audioId,
      name: c.name,
      duration: c.duration,
      start: c.start,
    }))
  }
  if (patch.crop !== undefined) body.crop = patch.crop
  if (patch.cuts !== undefined) body.cuts = patch.cuts
  return json(`/api/projects/${id}`, 'PATCH', body)
}

export function deleteProject(id: string): Promise<{ ok: boolean }> {
  return json(`/api/projects/${id}`, 'DELETE')
}

// --- Медиа и экспорт (в рамках проекта) ------------------------------------
export function uploadVideo(projectId: string, file: File): Promise<Video> {
  return postFile<Video>(`/api/projects/${projectId}/video`, file)
}

export function uploadAudio(projectId: string, file: File): Promise<AudioAsset> {
  return postFile<AudioAsset>(`/api/projects/${projectId}/audio`, file)
}

export function getVoiceoverPlan(projectId: string): Promise<VoiceoverPlan> {
  return json<VoiceoverPlan>(`/api/projects/${projectId}/voiceover-plan`, 'GET')
}

export function exportMontage(
  projectId: string,
  clips: AudioClip[],
  crop: Crop | null,
  cuts: Cut[],
): Promise<ExportResult> {
  return json<ExportResult>(`/api/projects/${projectId}/export`, 'POST', {
    crop,
    cuts,
    clips: clips.map((c) => ({
      clipId: c.clipId,
      audioId: c.audioId,
      name: c.name,
      duration: c.duration,
      start: c.start,
    })),
  })
}
