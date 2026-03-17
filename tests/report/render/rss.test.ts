import { describe, it, expect } from 'vitest'
import { renderRssFeed } from '../../../src/report/render/rss.js'
import type { ManifestEntry } from '../../../src/types/transcript.js'

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'claude',
    project: 'test',
    session_id: 'sess-001',
    raw_sha256: 'abc123',
    title: 'My Session',
    started_at: '2026-03-16T10:00:00Z',
    imported_at: '2026-03-16T10:01:00Z',
    cwd: '/home/user/project',
    branch: 'main',
    raw_source_path: '',
    raw_upload_permission: 'not-set',
    global_raw_path: '',
    global_clean_path: '',
    global_manifest_path: '',
    repo_raw_path: '',
    repo_clean_path: 'Memory/06_transcripts/clean/claude/2026/03/sess-001.md',
    repo_manifest_path: '',
    message_count: 5,
    tool_event_count: 2,
    cleaning_mode: 'standard',
    repo_mirror_enabled: true,
    ...overrides,
  }
}

describe('renderRssFeed', () => {
  it('produces valid RSS 2.0 XML header', () => {
    const xml = renderRssFeed([], {}, '')
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<channel>')
    expect(xml).toContain('</channel>')
    expect(xml).toContain('</rss>')
  })

  it('omits channel link when baseUrl is empty', () => {
    const xml = renderRssFeed([], {}, '')
    expect(xml).not.toContain('<link>')
  })

  it('includes channel link when baseUrl is set', () => {
    const xml = renderRssFeed([], {}, 'https://memory.example.com')
    expect(xml).toContain('<link>https://memory.example.com</link>')
  })

  it('renders session as RSS item with title and guid', () => {
    const m = makeManifest()
    const xml = renderRssFeed([m], {}, '')
    expect(xml).toContain('<title>My Session</title>')
    expect(xml).toContain('<guid isPermaLink="false">sess-001</guid>')
  })

  it('includes absolute link and permalink guid when baseUrl is set', () => {
    const m = makeManifest()
    const xml = renderRssFeed([m], {}, 'https://memory.example.com')
    expect(xml).toContain('<link>https://memory.example.com/transcripts/claude/')
    expect(xml).toContain('isPermaLink="true"')
  })

  it('includes description from summaries', () => {
    const m = makeManifest()
    const xml = renderRssFeed([m], { 'sess-001': 'This is the summary.' }, '')
    expect(xml).toContain('<description>This is the summary.</description>')
  })

  it('escapes XML special characters in title', () => {
    const m = makeManifest({ title: 'A & B <test> "quote"' })
    const xml = renderRssFeed([m], {}, '')
    expect(xml).toContain('A &amp; B &lt;test&gt; &quot;quote&quot;')
    expect(xml).not.toContain('<test>')
  })

  it('limits output to 100 items', () => {
    const manifests = Array.from({ length: 150 }, (_, i) =>
      makeManifest({ session_id: `sess-${i.toString().padStart(3, '0')}`, started_at: `2026-03-${(i % 28 + 1).toString().padStart(2, '0')}T00:00:00Z` })
    )
    const xml = renderRssFeed(manifests, {}, '')
    const itemCount = (xml.match(/<item>/g) ?? []).length
    expect(itemCount).toBe(100)
  })

  it('includes pubDate in RFC 2822 format', () => {
    const m = makeManifest({ started_at: '2026-03-16T10:00:00Z' })
    const xml = renderRssFeed([m], {}, '')
    expect(xml).toContain('<pubDate>')
    // RFC 2822 dates contain weekday abbreviation
    expect(xml).toMatch(/<pubDate>Mon,/)
  })

  it('handles empty manifests array', () => {
    const xml = renderRssFeed([], {}, 'https://example.com')
    expect(xml).toContain('<channel>')
    expect(xml).not.toContain('<item>')
  })
})
