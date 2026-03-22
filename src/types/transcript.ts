export type Client = 'codex' | 'claude' | 'gemini' | 'doubao'

export interface TranscriptMessage {
  role: string
  text: string
  timestamp: string | null
}

export interface TranscriptToolEvent {
  summary: string
  timestamp: string | null
}

export interface TranscriptEventBase {
  kind:
    | 'message'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'token_count'
    | 'task_status'
    | 'context'
    | 'system'
  timestamp: string | null
  sequence: number
  title?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export interface TranscriptMessageEvent extends TranscriptEventBase {
  kind: 'message'
  role: string
  text: string
  phase?: string
}

export interface TranscriptReasoningEvent extends TranscriptEventBase {
  kind: 'reasoning'
  text?: string
  redacted: boolean
}

export interface TranscriptToolCallEvent extends TranscriptEventBase {
  kind: 'tool_call'
  tool_name: string
  call_id?: string
  input?: unknown
}

export interface TranscriptToolResultEvent extends TranscriptEventBase {
  kind: 'tool_result'
  tool_name: string
  call_id?: string
  output?: unknown
  exit_code?: number | null
}

export interface TranscriptTokenCountEvent extends TranscriptEventBase {
  kind: 'token_count'
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
}

export interface TranscriptTaskStatusEvent extends TranscriptEventBase {
  kind: 'task_status'
  status: 'started' | 'completed'
  turn_id?: string
  last_agent_message?: string
}

export interface TranscriptContextEvent extends TranscriptEventBase {
  kind: 'context'
  title: string
}

export interface TranscriptSystemEvent extends TranscriptEventBase {
  kind: 'system'
  text?: string
}

export type TranscriptEvent =
  | TranscriptMessageEvent
  | TranscriptReasoningEvent
  | TranscriptToolCallEvent
  | TranscriptToolResultEvent
  | TranscriptTokenCountEvent
  | TranscriptTaskStatusEvent
  | TranscriptContextEvent
  | TranscriptSystemEvent

export interface ParsedTranscript {
  client: Client
  session_id: string
  title: string
  started_at: string
  cwd: string
  branch: string
  messages: TranscriptMessage[]
  tool_events: TranscriptToolEvent[]
  events: TranscriptEvent[]
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
  global_full_path?: string
  repo_raw_path: string
  repo_clean_path: string
  repo_manifest_path: string
  repo_full_path?: string
  message_count: number
  tool_event_count: number
  event_count?: number
  cleaning_mode: string
  repo_mirror_enabled: boolean
  tags?: string[]
}

export interface TranscriptArtifact extends ParsedTranscript {
  schema_version: 'transcript.full.v1'
}
