/**
 * Type definitions for the report generation subsystem.
 */

export interface ReportStats {
  totalSessions: number
  totalMessages: number
  totalToolEvents: number
  activeDays: number
  dateRange: { from: string; to: string }
  clientCounts: Record<string, number>
  /** 'YYYY-MM-DD' → session count */
  dayBuckets: Record<string, number>
  /** 'YYYY-WNN' → message count */
  weekBuckets: Record<string, number>
  /** tool name → invocation count */
  toolCounts: Record<string, number>
}

export interface SummaryCache {
  sha256: string
  summary: string
  generated_at: string
}

export interface LinkGraph {
  /** session_id → list of session_ids that reference it */
  backlinks: Record<string, string[]>
  /** session_id → list of session_ids it references */
  forwardLinks: Record<string, string[]>
}

export interface SearchIndexEntry {
  url: string
  title: string
  client: string
  /** Last path segment of ManifestEntry.cwd (e.g. 'openmnemo') */
  project: string
  date: string
  snippet: string
}

export interface BuildReportOptions {
  root: string
  output: string
  noAi?: boolean
  model?: string
  /** Build-time locale (e.g. 'en', 'zh-CN'). Default: 'en'. */
  locale?: string
  /** gh-pages branch name. Empty string = skip deploy. Default: ''. */
  ghPagesBranch?: string
  /** Custom domain for CNAME file. Empty string = skip. Default: ''. */
  cname?: string
  /** Webhook URL for post-build notifications. Empty string = skip. Default: ''. */
  webhookUrl?: string
  /** Session IDs newly imported in this heartbeat cycle (for webhook). */
  newSessionIds?: string[]
  /** Absolute base URL for RSS/OG links (e.g. 'https://memory.example.com'). Empty = skip. */
  reportBaseUrl?: string
  /** Absolute paths to Memory/06_transcripts/manifests dirs from other registered projects. */
  extraManifestDirs?: string[]
}
