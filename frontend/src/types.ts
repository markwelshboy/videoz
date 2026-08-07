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
  sizes: OutputSize[]
  dimension_multiple: number
  frame_rule?: string
  notes?: string
}

export interface MediaAsset {
  id: string
  original_name: string
  stored_name: string
  url: string
  duration: number
  width: number
  height: number
  fps: number
  frame_count?: number
  has_audio: boolean
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
