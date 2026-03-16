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
  date: string
  snippet: string
}

export interface BuildReportOptions {
  root: string
  output: string
  noAi?: boolean
  model?: string
}
