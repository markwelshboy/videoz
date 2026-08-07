import type { CropRect, ExportResult, MediaAsset, MediaKind, TrainingProfile } from './types'

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return body.detail ?? JSON.stringify(body)
  } catch {
    return response.statusText || 'Request failed'
  }
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
  return response.json()
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
