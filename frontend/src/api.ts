import type { CropRect, ExportBundleResult, ExportResult, MediaAsset, MediaKind, TrainingProfile } from './types'

const EXPORT_SESSION_KEY = 'videoz.export-session'
export const EXPORT_SESSION_EVENT = 'videoz:exports-changed'

export interface ExportSessionState {
  sourceId: string
  sourceName: string
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
    if (!parsed.sourceId || !Array.isArray(parsed.filenames)) return null
    return parsed
  } catch {
    return null
  }
}

function publishExportSession(state: ExportSessionState) {
  window.sessionStorage.setItem(EXPORT_SESSION_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent<ExportSessionState>(EXPORT_SESSION_EVENT, { detail: state }))
}

function resetExportSession(asset: MediaAsset) {
  publishExportSession({ sourceId: asset.id, sourceName: asset.original_name, filenames: [] })
}

function rememberExport(asset: MediaAsset, result: ExportResult) {
  const current = getExportSession()
  const state: ExportSessionState = current?.sourceId === asset.id
    ? current
    : { sourceId: asset.id, sourceName: asset.original_name, filenames: [] }
  if (!state.filenames.includes(result.filename)) state.filenames.push(result.filename)
  publishExportSession(state)
}

export async function fetchProfiles(): Promise<TrainingProfile[]> {
  const response = await fetch('/api/profiles')
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function importMedia(file: File): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/media/import', { method: 'POST', body: form })
  if (!response.ok) throw new Error(await readError(response))
  const asset = await response.json() as MediaAsset
  resetExportSession(asset)
  return asset
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
  const result = await response.json() as ExportResult
  rememberExport(input.asset, result)
  return result
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
