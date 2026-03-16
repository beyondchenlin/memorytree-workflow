import { describe, it, expect } from 'vitest'
import { loadLocale } from '../../src/report/i18n/index.js'
import { en } from '../../src/report/i18n/en.js'
import { zhCN } from '../../src/report/i18n/zh-CN.js'
import type { Translations } from '../../src/report/i18n/types.js'

// ---------------------------------------------------------------------------
// Helper: all keys must be defined
// ---------------------------------------------------------------------------

function hasAllKeys(obj: Translations): boolean {
  return (
    typeof obj.nav.dashboard === 'string' &&
    typeof obj.nav.sessions === 'string' &&
    typeof obj.nav.projects === 'string' &&
    typeof obj.nav.graph === 'string' &&
    typeof obj.nav.goals === 'string' &&
    typeof obj.nav.todos === 'string' &&
    typeof obj.nav.knowledge === 'string' &&
    typeof obj.nav.archive === 'string' &&
    typeof obj.nav.search === 'string' &&
    typeof obj.dashboard.title === 'string' &&
    typeof obj.dashboard.subtitle === 'string' &&
    typeof obj.dashboard.sessions === 'string' &&
    typeof obj.dashboard.messages === 'string' &&
    typeof obj.dashboard.toolEvents === 'string' &&
    typeof obj.dashboard.activeDays === 'string' &&
    typeof obj.dashboard.recentSessions === 'string' &&
    typeof obj.sessions.title === 'string' &&
    typeof obj.sessions.noSessions === 'string' &&
    typeof obj.sessions.client === 'string' &&
    typeof obj.sessions.date === 'string' &&
    typeof obj.sessions.id === 'string' &&
    typeof obj.sessions.msgs === 'string' &&
    typeof obj.sessions.tools === 'string' &&
    typeof obj.sessions.all === 'string' &&
    typeof obj.transcript.aiSummary === 'string' &&
    typeof obj.transcript.referencedBy === 'string' &&
    typeof obj.transcript.messages === 'string' &&
    typeof obj.transcript.noMessages === 'string' &&
    typeof obj.transcript.client === 'string' &&
    typeof obj.transcript.sessionId === 'string' &&
    typeof obj.transcript.branch === 'string' &&
    typeof obj.transcript.workingDir === 'string' &&
    typeof obj.transcript.sha256 === 'string' &&
    typeof obj.transcript.toolEvents === 'string' &&
    typeof obj.graph.title === 'string' &&
    typeof obj.graph.subtitle === 'string' &&
    typeof obj.graph.noData === 'string' &&
    typeof obj.projects.title === 'string' &&
    typeof obj.projects.noProjects === 'string' &&
    typeof obj.projects.sessions === 'string' &&
    typeof obj.search.title === 'string' &&
    typeof obj.search.placeholder === 'string' &&
    typeof obj.search.results === 'string' &&
    typeof obj.search.noResults === 'string' &&
    typeof obj.common.loading === 'string' &&
    typeof obj.common.unknown === 'string'
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadLocale', () => {
  it('returns English locale for "en"', () => {
    const t = loadLocale('en')
    expect(t.nav.dashboard).toBe('Dashboard')
    expect(t.dashboard.title).toBe('Memory Dashboard')
  })

  it('returns Chinese locale for "zh-CN"', () => {
    const t = loadLocale('zh-CN')
    expect(t.nav.dashboard).toBe('仪表盘')
    expect(t.dashboard.title).toBe('记忆仪表盘')
  })

  it('falls back to English for unknown locale', () => {
    const t = loadLocale('fr')
    expect(t.nav.dashboard).toBe(en.nav.dashboard)
  })

  it('falls back to English for empty string', () => {
    const t = loadLocale('')
    expect(t.nav.dashboard).toBe(en.nav.dashboard)
  })
})

describe('en locale — all keys defined', () => {
  it('has all required keys as non-empty strings', () => {
    expect(hasAllKeys(en)).toBe(true)
  })

  it('all strings are non-empty', () => {
    const flat = [
      ...Object.values(en.nav),
      ...Object.values(en.dashboard),
      ...Object.values(en.sessions),
      ...Object.values(en.transcript),
      ...Object.values(en.graph),
      ...Object.values(en.projects),
      ...Object.values(en.search),
      ...Object.values(en.common),
    ]
    for (const s of flat) {
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
  })
})

describe('zh-CN locale — all keys defined', () => {
  it('has all required keys as non-empty strings', () => {
    expect(hasAllKeys(zhCN)).toBe(true)
  })

  it('all strings are non-empty', () => {
    const flat = [
      ...Object.values(zhCN.nav),
      ...Object.values(zhCN.dashboard),
      ...Object.values(zhCN.sessions),
      ...Object.values(zhCN.transcript),
      ...Object.values(zhCN.graph),
      ...Object.values(zhCN.projects),
      ...Object.values(zhCN.search),
      ...Object.values(zhCN.common),
    ]
    for (const s of flat) {
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
  })

  it('zh-CN nav keys differ from en (are localized)', () => {
    expect(zhCN.nav.dashboard).not.toBe(en.nav.dashboard)
    expect(zhCN.nav.sessions).not.toBe(en.nav.sessions)
    expect(zhCN.nav.knowledge).not.toBe(en.nav.knowledge)
  })
})

describe('locale structure — zh-CN vs en key parity', () => {
  it('zh-CN has same nav keys as en', () => {
    expect(Object.keys(zhCN.nav).sort()).toEqual(Object.keys(en.nav).sort())
  })

  it('zh-CN has same dashboard keys as en', () => {
    expect(Object.keys(zhCN.dashboard).sort()).toEqual(Object.keys(en.dashboard).sort())
  })

  it('zh-CN has same sessions keys as en', () => {
    expect(Object.keys(zhCN.sessions).sort()).toEqual(Object.keys(en.sessions).sort())
  })

  it('zh-CN has same transcript keys as en', () => {
    expect(Object.keys(zhCN.transcript).sort()).toEqual(Object.keys(en.transcript).sort())
  })

  it('zh-CN has same graph keys as en', () => {
    expect(Object.keys(zhCN.graph).sort()).toEqual(Object.keys(en.graph).sort())
  })

  it('zh-CN has same projects keys as en', () => {
    expect(Object.keys(zhCN.projects).sort()).toEqual(Object.keys(en.projects).sort())
  })

  it('zh-CN has same search keys as en', () => {
    expect(Object.keys(zhCN.search).sort()).toEqual(Object.keys(en.search).sort())
  })

  it('zh-CN has same common keys as en', () => {
    expect(Object.keys(zhCN.common).sort()).toEqual(Object.keys(en.common).sort())
  })
})
