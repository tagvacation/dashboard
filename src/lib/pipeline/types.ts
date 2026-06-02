export type PipelineStep =
  | 'init'
  | 'topic'
  | 'script'
  | 'audio'
  | 'sheet_meta'
  | 'veo_submit'
  | 'veo_poll'
  | 'complete'
  | 'failed'

export interface Scene {
  scene_num: string    // zero-padded, e.g. "01"
  beat: string
  video_prompt: string
  tts_text: string
  caption: string
  primary_anchor: string
  secondary_anchor: string
  has_secondary: boolean
}

export interface Script {
  story_id: string
  title_hindi: string
  hook_caption: string
  moral: string
  character_anchor: { description_en: string; description_hi: string }
  secondary_character_anchor: { description_en: string; description_hi: string }
  scenes: Scene[]
  total_scenes: number
}

export interface PipelineRun {
  story_id: string
  status: PipelineStep
  log: string              // JSON array of log lines
  topic: string
  theme: string
  script_json: string      // serialized Script
  operation_ids: string    // JSON: { "01": "op_id", ... }
  completed_clips: string  // JSON: ["01", "02", ...]
  filtered_clips: string   // JSON: ["05", ...] — content-filtered, skipped
  error: string
  created_at: string
  updated_at: string
}
