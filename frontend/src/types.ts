export type MediaKind = 'video' | 'image'

export interface OutputSize {
  width: number
  height: number
  label: string
}

export interface TrainingProfile {
  id: string
  architecture: string
  trainer: string
  label: string
  media_kind: MediaKind
  fps: number
  frame_options: number[]
  default_frames?: number
  sizes: OutputSize[]
  dimension_multiple: number
  frame_rule?: string
  notes?: string
}

export interface MediaAsset {
  id: string
  project_id?: string
  original_name: string
  stored_name: string
  url: string
  duration: number
  width: number
  height: number
  fps: number
  frame_count?: number
  has_audio: boolean
  thumbnails: string[]
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ExportResult {
  filename: string
  url: string
  command: string[]
}

export interface ExportBundleResult {
  filename: string
  url: string
  files: string[]
}

export interface Project {
  id: string
  name: string
  dataset_prefix: string
  created_at: string
  updated_at: string
}

export interface SavedSelection {
  id: string
  project_id: string
  asset_id: string
  sequence: number
  start_time: number
  frame_count: number
  profile_id: string
  size_index: number
  crop: CropRect
  crop_scale: number
  export_filename?: string
  created_at: string
  updated_at: string
}

export interface ProjectWorkspace {
  project: Project
  sources: MediaAsset[]
  selections: SavedSelection[]
}

export interface SelectionInput {
  asset_id: string
  start_time: number
  frame_count: number
  profile_id: string
  size_index: number
  crop: CropRect
  crop_scale: number
}
