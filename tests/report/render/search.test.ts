import { describe, it, expect } from 'vitest'
import type { ManifestEntry } from '../../../src/types/transcript.js'
import { buildSearchIndex, renderSearchPage } from '../../../src/report/render/search.js'
import type { SearchIndexEntry } from '../../../src/types/report.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(id: string, client = 'codex', repoClean = ''): ManifestEntry {
  return {
    client,
    project: 'test',
    session_id: id,
    raw_sha256: id.padEnd(64, '0'),
    title: `Session ${id}`,
    started_at: '2026-03-10T10:00:00Z',
    imported_at: '2026-03-10T10:01:00Z',
    cwd: '',
    branch: 'main',
    raw_source_path: '',
    raw_upload_permission: 'not-set',
    global_raw_path: '',
    global_clean_path: '',
    global_manifest_path: '',
    repo_raw_path: '',
    repo_clean_path: repoClean,
    repo_manifest_path: '',
    message_count: 5,
    tool_event_count: 2,
    cleaning_mode: 'deterministic-code',
    repo_mirror_enabled: true,
  }
}

// ---------------------------------------------------------------------------
// buildSearchIndex
// ---------------------------------------------------------------------------

describe('buildSearchIndex', () => {
  it('builds index with correct fields', () => {
    const m = makeManifest('abc', 'codex', 'Memory/06_transcripts/clean/codex/2026/03/abc__deadbeef.md')
    const index = buildSearchIndex([m], () => 'some snippet')
    expect(index).toHaveLength(1)
    const entry = index[0]!
    expect(entry.title).toBe('Session abc')
    expect(entry.client).toBe('codex')
    expect(entry.date).toBe('2026-03-10')
    expect(entry.snippet).toBe('some snippet')
  })

  it('uses session_id as stem when no clean path', () => {
    const m = makeManifest('myid', 'claude', '')
    const index = buildSearchIndex([m], () => '')
    expect(index[0]!.url).toContain('myid')
  })

  it('produces correct URL format', () => {
    const m = makeManifest('xyz', 'claude', 'Memory/06_transcripts/clean/claude/2026/03/xyz__abc.md')
    const index = buildSearchIndex([m], () => '')
    expect(index[0]!.url).toBe('transcripts/claude/xyz__abc.html')
  })

  it('truncates snippets to 200 chars', () => {
    const longSnippet = 'x'.repeat(300)
    const m = makeManifest('a')
    const index = buildSearchIndex([m], () => longSnippet)
    expect(index[0]!.snippet.length).toBeLessThanOrEqual(200)
  })

  it('respects 50kB total index budget', () => {
    const manifests: ManifestEntry[] = []
    for (let i = 0; i < 100; i++) {
      manifests.push(makeManifest(`session-${i}`))
    }
    // Give each session a large snippet
    const bigSnippet = 'a'.repeat(200)
    const index = buildSearchIndex(manifests, () => bigSnippet)
    const json = JSON.stringify(index)
    expect(json.length).toBeLessThanOrEqual(51_000) // some tolerance
  })

  it('returns empty array for no manifests', () => {
    expect(buildSearchIndex([], () => '')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// renderSearchPage
// ---------------------------------------------------------------------------

describe('renderSearchPage', () => {
  it('embeds SEARCH_INDEX as inline JS', () => {
    const index: SearchIndexEntry[] = [
      { url: 'transcripts/codex/a.html', title: 'Test', client: 'codex', date: '2026-03-10', snippet: 'hi' },
    ]
    const html = renderSearchPage(index)
    expect(html).toContain('const SEARCH_INDEX =')
    expect(html).toContain('"transcripts/codex/a.html"')
  })

  it('produces valid HTML structure', () => {
    const html = renderSearchPage([])
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<title>')
    expect(html).toContain('search-input')
  })

  it('embeds valid JSON in the index', () => {
    const index: SearchIndexEntry[] = [
      { url: 'a.html', title: 'Test <session>', client: 'codex', date: '2026-03-10', snippet: 'body' },
    ]
    const html = renderSearchPage(index)
    // Extract the JSON part
    const match = html.match(/const SEARCH_INDEX = (\[[\s\S]*?\]);/)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match![1]!)).not.toThrow()
  })

  it('includes vanilla JS search logic', () => {
    const html = renderSearchPage([])
    expect(html).toContain('addEventListener')
    expect(html).toContain('SEARCH_INDEX')
    expect(html).toContain('toLowerCase')
  })
})
