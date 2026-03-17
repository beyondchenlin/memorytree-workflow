// Types — ParsedTranscript, Message, ToolEvent interfaces
// To be implemented in Phase 1

export type Client = 'codex' | 'claude' | 'gemini'

export interface TranscriptMessage {
  role: string
  text: string
  timestamp: string | null
}

export interface TranscriptToolEvent {
  summary: string
  timestamp: string | null
}

export interface ParsedTranscript {
  client: Client
  session_id: string
  title: string
  started_at: string
  cwd: string
  branch: string
  messages: TranscriptMessage[]
  tool_events: TranscriptToolEvent[]
  source_path: string
}

export interface ManifestEntry {
  client: string
  project: string
  session_id: string
  raw_sha256: string
  title: string
  started_at: string
  imported_at: string
  cwd: string
  branch: string
  raw_source_path: string
  raw_upload_permission: string
  global_raw_path: string
  global_clean_path: string
  global_manifest_path: string
  repo_raw_path: string
  repo_clean_path: string
  repo_manifest_path: string
  message_count: number
  tool_event_count: number
  cleaning_mode: string
  repo_mirror_enabled: boolean
  /** AI-extracted keyword tags. Populated during report build; absent in older manifests. */
  tags?: string[]
}
