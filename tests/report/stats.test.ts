import { describe, it, expect } from 'vitest'
import type { ManifestEntry } from '../../src/types/transcript.js'
import {
  computeStats,
  buildDayBuckets,
  buildWeekBuckets,
  extractToolNames,
  accumulateToolCounts,
} from '../../src/report/stats.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'codex',
    project: 'test',
    session_id: 'abc-123',
    raw_sha256: 'deadbeef',
    title: 'Test Session',
    started_at: '2026-03-10T10:00:00Z',
    imported_at: '2026-03-10T10:01:00Z',
    cwd: '/home/user',
    branch: 'main',
    raw_source_path: '/src/file.jsonl',
    raw_upload_permission: 'not-set',
    global_raw_path: '',
    global_clean_path: '',
    global_manifest_path: '',
    repo_raw_path: '',
    repo_clean_path: '',
    repo_manifest_path: '',
    message_count: 10,
    tool_event_count: 5,
    cleaning_mode: 'deterministic-code',
    repo_mirror_enabled: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

describe('computeStats', () => {
  it('handles zero manifests', () => {
    const stats = computeStats([])
    expect(stats.totalSessions).toBe(0)
    expect(stats.totalMessages).toBe(0)
    expect(stats.totalToolEvents).toBe(0)
    expect(stats.activeDays).toBe(0)
    expect(stats.dateRange.from).toBe('')
    expect(stats.dateRange.to).toBe('')
    expect(stats.clientCounts).toEqual({})
    expect(stats.dayBuckets).toEqual({})
    expect(stats.weekBuckets).toEqual({})
    expect(stats.toolCounts).toEqual({})
  })

  it('sums messages and tool events', () => {
    const m1 = makeManifest({ message_count: 10, tool_event_count: 5 })
    const m2 = makeManifest({ session_id: 'xyz', message_count: 20, tool_event_count: 3 })
    const stats = computeStats([m1, m2])
    expect(stats.totalSessions).toBe(2)
    expect(stats.totalMessages).toBe(30)
    expect(stats.totalToolEvents).toBe(8)
  })

  it('counts client distribution', () => {
    const m1 = makeManifest({ client: 'codex' })
    const m2 = makeManifest({ session_id: 'b', client: 'claude' })
    const m3 = makeManifest({ session_id: 'c', client: 'claude' })
    const stats = computeStats([m1, m2, m3])
    expect(stats.clientCounts['codex']).toBe(1)
    expect(stats.clientCounts['claude']).toBe(2)
  })

  it('counts active days correctly', () => {
    const m1 = makeManifest({ started_at: '2026-03-10T10:00:00Z' })
    const m2 = makeManifest({ session_id: 'b', started_at: '2026-03-10T14:00:00Z' }) // same day
    const m3 = makeManifest({ session_id: 'c', started_at: '2026-03-11T08:00:00Z' }) // different day
    const stats = computeStats([m1, m2, m3])
    expect(stats.activeDays).toBe(2)
  })

  it('computes date range', () => {
    const m1 = makeManifest({ started_at: '2026-01-01T00:00:00Z' })
    const m2 = makeManifest({ session_id: 'b', started_at: '2026-03-15T00:00:00Z' })
    const stats = computeStats([m1, m2])
    expect(stats.dateRange.from).toBe('2026-01-01T00:00:00Z')
    expect(stats.dateRange.to).toBe('2026-03-15T00:00:00Z')
  })

  it('accepts external toolCounts', () => {
    const stats = computeStats([], { Bash: 10, Read: 5 })
    expect(stats.toolCounts['Bash']).toBe(10)
    expect(stats.toolCounts['Read']).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// buildDayBuckets
// ---------------------------------------------------------------------------

describe('buildDayBuckets', () => {
  it('returns empty for zero manifests', () => {
    expect(buildDayBuckets([])).toEqual({})
  })

  it('buckets sessions by date', () => {
    const m1 = makeManifest({ started_at: '2026-03-10T10:00:00Z' })
    const m2 = makeManifest({ session_id: 'b', started_at: '2026-03-10T14:00:00Z' })
    const m3 = makeManifest({ session_id: 'c', started_at: '2026-03-11T08:00:00Z' })
    const buckets = buildDayBuckets([m1, m2, m3])
    expect(buckets['2026-03-10']).toBe(2)
    expect(buckets['2026-03-11']).toBe(1)
  })

  it('ignores manifests with empty started_at', () => {
    const m = makeManifest({ started_at: '' })
    expect(buildDayBuckets([m])).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// buildWeekBuckets
// ---------------------------------------------------------------------------

describe('buildWeekBuckets', () => {
  it('returns empty for zero manifests', () => {
    expect(buildWeekBuckets([])).toEqual({})
  })

  it('buckets messages by ISO week', () => {
    // 2026-03-10 is in week 2026-W11
    const m1 = makeManifest({ started_at: '2026-03-10T10:00:00Z', message_count: 5 })
    const m2 = makeManifest({ session_id: 'b', started_at: '2026-03-11T10:00:00Z', message_count: 3 })
    const buckets = buildWeekBuckets([m1, m2])
    // Both are in the same week
    const weekKey = Object.keys(buckets)[0]
    expect(weekKey).toMatch(/^\d{4}-W\d{2}$/)
    const val = weekKey ? buckets[weekKey] : 0
    expect(val).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// extractToolNames
// ---------------------------------------------------------------------------

describe('extractToolNames', () => {
  it('extracts first word as tool name', () => {
    const names = extractToolNames(['Bash input={"command":"ls"}', 'Read /file.ts'])
    expect(names[0]).toBe('Bash')
    expect(names[1]).toBe('Read')
  })

  it('handles underscore and hyphen in names', () => {
    const names = extractToolNames(['function_call input=...', 'custom-tool arg=1'])
    expect(names[0]).toBe('function_call')
    expect(names[1]).toBe('custom-tool')
  })

  it('returns unknown for non-identifier start', () => {
    const names = extractToolNames(['123abc', '!cmd'])
    expect(names[0]).toBe('unknown')
    expect(names[1]).toBe('unknown')
  })

  it('handles empty array', () => {
    expect(extractToolNames([])).toEqual([])
  })

  it('handles empty string entries', () => {
    const names = extractToolNames([''])
    expect(names[0]).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// accumulateToolCounts
// ---------------------------------------------------------------------------

describe('accumulateToolCounts', () => {
  it('accumulates counts into new map', () => {
    const base = { Bash: 3 }
    const result = accumulateToolCounts(base, ['Bash', 'Read', 'Bash'])
    expect(result['Bash']).toBe(5)
    expect(result['Read']).toBe(1)
  })

  it('does not mutate input', () => {
    const base = { Bash: 1 }
    accumulateToolCounts(base, ['Bash'])
    expect(base['Bash']).toBe(1)
  })
})
