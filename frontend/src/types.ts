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

export type CaptionStatus = 'uncaptioned' | 'new' | 'reviewed' | 'edited' | 'failed'
export type CaptionSampleMode = 'fixed_count' | 'fps'
export type CaptionVisualDetail = 'low' | 'standard' | 'high'
export type CaptionJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface CaptionProviderInfo {
  id: string
  label: string
  available: boolean
  reason?: string
  default_model?: string
  model_hint?: string
}

export interface CaptionRecipe {
  id: string
  project_id?: string
  name: string
  provider_id: string
  model: string
  prompt: string
  system_prompt: string
  sample_mode: CaptionSampleMode
  frame_count: number
  sample_fps: number
  visual_detail: CaptionVisualDetail
  max_tokens: number
  temperature: number
  top_p: number
  seed?: number
  created_at: string
  updated_at: string
}

export interface CaptionRecipeInput {
  project_id?: string
  name: string
  provider_id: string
  model: string
  prompt: string
  system_prompt: string
  sample_mode: CaptionSampleMode
  frame_count: number
  sample_fps: number
  visual_detail: CaptionVisualDetail
  max_tokens: number
  temperature: number
  top_p: number
  seed?: number
}

export interface CaptionFrame {
  index: number
  time: number
  url: string
}

export interface CaptionAsset {
  key: string
  project_id: string
  kind: 'selection' | 'standalone'
  selection_id?: string
  sequence?: number
  display_name: string
  url: string
  duration: number
  width: number
  height: number
  fps: number
  caption_body: string
  status: CaptionStatus
  selected: boolean
  current_recipe_id?: string
  frame_times: number[]
  updated_at?: string
}

export interface CaptionProjectSettings {
  project_id: string
  trigger_phrase: string
}

export interface CaptionWorkspaceData {
  project: Project
  settings: CaptionProjectSettings
  assets: CaptionAsset[]
  recipes: CaptionRecipe[]
}

export interface CaptionJob {
  id: string
  project_id: string
  asset_key: string
  recipe_id: string
  status: CaptionJobStatus
  progress: number
  error?: string
  created_at: string
  updated_at: string
}

export interface CaptionGenerationResult {
  jobs: CaptionJob[]
}

export interface CaptionVersion {
  id: string
  asset_key: string
  recipe_id: string
  provider_id: string
  model: string
  prompt: string
  frame_times: number[]
  caption_body: string
  created_at: string
}
