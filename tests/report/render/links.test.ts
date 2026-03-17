import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ManifestEntry } from '../../../src/types/transcript.js'
import { extractLinks, buildLinkGraph } from '../../../src/report/render/links.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'links-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeManifest(id: string, stem: string, content?: string): ManifestEntry {
  const cleanRelPath = `Memory/06_transcripts/clean/codex/2026/03/${stem}.md`
  if (content !== undefined) {
    const fullPath = join(tmpDir, cleanRelPath)
    mkdirSync(join(tmpDir, 'Memory/06_transcripts/clean/codex/2026/03'), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }
  return {
    client: 'codex',
    project: 'test',
    session_id: id,
    raw_sha256: id.slice(0, 8).padEnd(64, '0'),
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
    repo_clean_path: cleanRelPath,
    repo_manifest_path: '',
    message_count: 1,
    tool_event_count: 0,
    cleaning_mode: 'deterministic-code',
    repo_mirror_enabled: true,
  }
}

// ---------------------------------------------------------------------------
// extractLinks
// ---------------------------------------------------------------------------

describe('extractLinks', () => {
  it('detects [[id]] references', () => {
    const refs = extractLinks('See [[session-abc]] for details.')
    expect(refs).toContain('session-abc')
  })

  it('detects multiple references', () => {
    const refs = extractLinks('[[a]] and [[b]] are related.')
    expect(refs).toHaveLength(2)
    expect(refs).toContain('a')
    expect(refs).toContain('b')
  })

  it('ignores partial brackets: single bracket', () => {
    const refs = extractLinks('[not a link] and [another')
    expect(refs).toHaveLength(0)
  })

  it('ignores newlines inside brackets', () => {
    const refs = extractLinks('[[line1\nline2]]')
    expect(refs).toHaveLength(0)
  })

  it('trims whitespace from refs', () => {
    const refs = extractLinks('[[ spaced ]]')
    expect(refs[0]).toBe('spaced')
  })

  it('returns empty for text with no links', () => {
    expect(extractLinks('No links here.')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildLinkGraph
// ---------------------------------------------------------------------------

describe('buildLinkGraph', () => {
  it('builds forward and back links', () => {
    const m1 = makeManifest('aaa', 'aaa__00000000', '## Messages\n### 1. user\nSee [[bbb]]')
    const m2 = makeManifest('bbb', 'bbb__00000000', '## Messages\n### 1. user\nNo links here')

    const graph = buildLinkGraph([m1, m2], tmpDir)
    expect(graph.forwardLinks['aaa']).toContain('bbb')
    expect(graph.backlinks['bbb']).toContain('aaa')
  })

  it('ignores self-references', () => {
    const m1 = makeManifest('aaa', 'aaa__00000000', '## Messages\n### 1. user\nSee [[aaa]]')

    const graph = buildLinkGraph([m1], tmpDir)
    expect(graph.forwardLinks['aaa'] ?? []).toHaveLength(0)
    expect(graph.backlinks['aaa'] ?? []).toHaveLength(0)
  })

  it('handles manifests with no clean file', () => {
    const m = makeManifest('zzz', 'zzz__00000000') // no content written
    const graph = buildLinkGraph([m], tmpDir)
    expect(graph.forwardLinks).toEqual({})
    expect(graph.backlinks).toEqual({})
  })

  it('deduplicates links', () => {
    const m1 = makeManifest('aaa', 'aaa__00000000', '## Messages\n### 1. user\n[[bbb]] [[bbb]] again')
    const m2 = makeManifest('bbb', 'bbb__00000000', '')

    const graph = buildLinkGraph([m1, m2], tmpDir)
    const fwd = graph.forwardLinks['aaa'] ?? []
    const count = fwd.filter(x => x === 'bbb').length
    expect(count).toBe(1)
  })

  it('matches by stem as well as session_id', () => {
    // The link text is the stem of the clean file
    const m1 = makeManifest('aaa', 'aaa__00000000', '## Messages\n### 1. user\nSee [[bbb__11111111]]')
    const m2 = makeManifest('bbb', 'bbb__11111111', '')

    const graph = buildLinkGraph([m1, m2], tmpDir)
    expect(graph.forwardLinks['aaa']).toContain('bbb')
  })
})
