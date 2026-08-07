import type {
  CaptionAsset,
  CaptionFrame,
  CaptionGenerationResult,
  CaptionJob,
  CaptionProjectSettings,
  CaptionProviderInfo,
  CaptionRecipe,
  CaptionRecipeInput,
  CaptionStatus,
  CaptionWorkspaceData,
  CropRect,
  ExportBundleResult,
  ExportResult,
  MediaAsset,
  MediaKind,
  Project,
  ProjectWorkspace,
  SavedSelection,
  SelectionInput,
  TrainingProfile,
} from './types'

const EXPORT_SESSION_KEY = 'videoz.export-session'
export const EXPORT_SESSION_EVENT = 'videoz:exports-changed'

export interface ExportSessionState {
  projectId: string
  projectName: string
  filenames: string[]
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return body.detail ?? JSON.stringify(body)
  } catch {
    return response.statusText || 'Request failed'
  }
}

export function getExportSession(): ExportSessionState | null {
  try {
    const raw = window.sessionStorage.getItem(EXPORT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ExportSessionState
    if (!parsed.projectId || !Array.isArray(parsed.filenames)) return null
    return parsed
  } catch {
    return null
  }
}

function publishExportSession(state: ExportSessionState) {
  window.sessionStorage.setItem(EXPORT_SESSION_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent<ExportSessionState>(EXPORT_SESSION_EVENT, { detail: state }))
}

export function syncExportSession(project: Project, filenames: string[]) {
  publishExportSession({
    projectId: project.id,
    projectName: project.name,
    filenames: [...new Set(filenames.filter(Boolean))],
  })
}

function rememberProjectExport(project: Project, result: ExportResult) {
  const current = getExportSession()
  const state: ExportSessionState = current?.projectId === project.id
    ? current
    : { projectId: project.id, projectName: project.name, filenames: [] }
  state.projectName = project.name
  if (!state.filenames.includes(result.filename)) state.filenames.push(result.filename)
  publishExportSession(state)
}

export async function fetchProfiles(): Promise<TrainingProfile[]> {
  const response = await fetch('/api/profiles')
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function fetchProjects(): Promise<Project[]> {
  const response = await fetch('/api/projects')
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function createProject(name: string, datasetPrefix?: string): Promise<Project> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataset_prefix: datasetPrefix || null }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function updateProject(projectId: string, input: { name?: string; dataset_prefix?: string }): Promise<Project> {
  const response = await fetch(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function fetchProjectWorkspace(projectId: string): Promise<ProjectWorkspace> {
  const response = await fetch(`/api/projects/${projectId}`)
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function importProjectMedia(projectId: string, file: File): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/projects/${projectId}/media/import`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function importMedia(file: File): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/media/import', { method: 'POST', body: form })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function createSavedSelection(projectId: string, input: SelectionInput): Promise<SavedSelection> {
  const response = await fetch(`/api/projects/${projectId}/selections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function updateSavedSelection(selectionId: string, input: SelectionInput): Promise<SavedSelection> {
  const response = await fetch(`/api/selections/${selectionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function deleteSavedSelection(selectionId: string): Promise<void> {
  const response = await fetch(`/api/selections/${selectionId}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await readError(response))
}

export async function exportSavedSelection(project: Project, selectionId: string): Promise<ExportResult> {
  const response = await fetch(`/api/selections/${selectionId}/export`, { method: 'POST' })
  if (!response.ok) throw new Error(await readError(response))
  const result = await response.json() as ExportResult
  rememberProjectExport(project, result)
  return result
}

export async function createExport(input: {
  asset: MediaAsset
  profileId: string
  mediaKind: MediaKind
  startTime: number
  fps: number
  frames: number
  outputWidth: number
  outputHeight: number
  crop: CropRect
}): Promise<ExportResult> {
  const response = await fetch('/api/exports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_filename: input.asset.stored_name,
      original_name: input.asset.original_name,
      profile_id: input.profileId,
      media_kind: input.mediaKind,
      start_time: input.startTime,
      fps: input.fps,
      frames: input.frames,
      output_width: input.outputWidth,
      output_height: input.outputHeight,
      crop: input.crop,
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function createExportBundle(filenames: string[], name?: string): Promise<ExportBundleResult> {
  const response = await fetch('/api/exports/bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames, name }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function fetchCaptionProviders(): Promise<CaptionProviderInfo[]> {
  const response = await fetch('/api/caption/providers')
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function fetchCaptionWorkspace(projectId: string): Promise<CaptionWorkspaceData> {
  const response = await fetch(`/api/projects/${projectId}/caption`)
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function updateCaptionSettings(projectId: string, triggerPhrase: string): Promise<CaptionProjectSettings> {
  const response = await fetch(`/api/projects/${projectId}/caption/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger_phrase: triggerPhrase }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function importCaptionVideo(projectId: string, file: File): Promise<CaptionAsset> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/projects/${projectId}/caption/import`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function patchCaptionAsset(
  assetKey: string,
  input: { caption_body?: string; status?: CaptionStatus; selected?: boolean; frame_times?: number[] },
): Promise<CaptionAsset> {
  const response = await fetch(`/api/caption/assets/${encodeURIComponent(assetKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function fetchCaptionFrames(assetKey: string, input: { count?: number; times?: number[] }): Promise<CaptionFrame[]> {
  const response = await fetch(`/api/caption/assets/${encodeURIComponent(assetKey)}/frames`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: input.count ?? input.times?.length ?? 8, times: input.times ?? null }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function createCaptionRecipe(input: CaptionRecipeInput): Promise<CaptionRecipe> {
  const response = await fetch('/api/caption/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function updateCaptionRecipe(recipeId: string, input: CaptionRecipeInput): Promise<CaptionRecipe> {
  const response = await fetch(`/api/caption/recipes/${recipeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function generateCaptions(projectId: string, assetKeys: string[], recipeId: string): Promise<CaptionGenerationResult> {
  const response = await fetch('/api/caption/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, asset_keys: assetKeys, recipe_id: recipeId }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function fetchCaptionJob(jobId: string): Promise<CaptionJob> {
  const response = await fetch(`/api/caption/jobs/${jobId}`)
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function createCaptionDatasetBundle(projectId: string, assetKeys: string[]): Promise<ExportBundleResult> {
  const response = await fetch(`/api/projects/${projectId}/caption/bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_keys: assetKeys }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}
