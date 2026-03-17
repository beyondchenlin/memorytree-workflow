/**
 * Statistics computation from ManifestEntry arrays.
 * All purely algorithmic — no I/O, no external deps.
 */

import type { ManifestEntry } from '../types/transcript.js'
import type { ReportStats } from '../types/report.js'

// ---------------------------------------------------------------------------
// Main stats computation
// ---------------------------------------------------------------------------

export function computeStats(
  manifests: ManifestEntry[],
  toolCounts: Record<string, number> = {},
): ReportStats {
  const totalSessions = manifests.length
  let totalMessages = 0
  let totalToolEvents = 0
  const clientCounts: Record<string, number> = {}
  const daySet = new Set<string>()

  for (const m of manifests) {
    totalMessages += m.message_count
    totalToolEvents += m.tool_event_count

    const client = m.client || 'unknown'
    clientCounts[client] = (clientCounts[client] ?? 0) + 1

    const day = isoDay(m.started_at)
    if (day) daySet.add(day)
  }

  const dayBuckets = buildDayBuckets(manifests)
  const weekBuckets = buildWeekBuckets(manifests)

  const dates = manifests
    .map(m => m.started_at)
    .filter(Boolean)
    .sort()

  const from = dates[0] ?? ''
  const to = dates[dates.length - 1] ?? ''

  return {
    totalSessions,
    totalMessages,
    totalToolEvents,
    activeDays: daySet.size,
    dateRange: { from, to },
    clientCounts,
    dayBuckets,
    weekBuckets,
    toolCounts,
  }
}

// ---------------------------------------------------------------------------
// Day buckets: 'YYYY-MM-DD' → session count
// ---------------------------------------------------------------------------

export function buildDayBuckets(manifests: ManifestEntry[]): Record<string, number> {
  const buckets: Record<string, number> = {}
  for (const m of manifests) {
    const day = isoDay(m.started_at)
    if (day) {
      buckets[day] = (buckets[day] ?? 0) + 1
    }
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Week buckets: 'YYYY-WNN' → message count
// ---------------------------------------------------------------------------

export function buildWeekBuckets(manifests: ManifestEntry[]): Record<string, number> {
  const buckets: Record<string, number> = {}
  for (const m of manifests) {
    const week = isoWeek(m.started_at)
    if (week) {
      buckets[week] = (buckets[week] ?? 0) + m.message_count
    }
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Tool name extraction
// ---------------------------------------------------------------------------

/**
 * Extract tool names from tool event summary strings.
 * Summary format is typically: "function_call input=..." or "Bash ..." etc.
 */
export function extractToolNames(summaries: string[]): string[] {
  return summaries.map(s => {
    const trimmed = s.trim()
    // Try to extract first identifier word
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_:-]*)/)
    if (match?.[1]) {
      return match[1]
    }
    return 'unknown'
  })
}

/**
 * Accumulate tool name counts into an existing map.
 */
export function accumulateToolCounts(
  toolCounts: Record<string, number>,
  names: string[],
): Record<string, number> {
  const result = { ...toolCounts }
  for (const name of names) {
    result[name] = (result[name] ?? 0) + 1
  }
  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract 'YYYY-MM-DD' from an ISO timestamp. Returns '' if invalid. */
function isoDay(ts: string): string {
  if (!ts) return ''
  const match = ts.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? ''
}

/** Compute 'YYYY-WNN' ISO week string from an ISO timestamp. */
function isoWeek(ts: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    return isoWeekKey(d)
  } catch {
    return ''
  }
}

/**
 * Compute 'YYYY-WNN' ISO week key from a Date object.
 * Exported so chart renderers can reuse without duplicating the formula.
 */
export function isoWeekKey(d: Date): string {
  // ISO week: the week containing Thursday; Monday = week start
  const thursday = new Date(d)
  thursday.setDate(d.getDate() + (4 - ((d.getDay() + 6) % 7 + 1)))
  const year = thursday.getFullYear()
  const jan4 = new Date(year, 0, 4)
  const week = Math.ceil(
    ((thursday.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7,
  )
  return `${year}-W${String(week).padStart(2, '0')}`
}
