import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { ManifestEntry, ParsedTranscript } from '../../src/types/transcript.js'
import {
  importTranscript,
  transcriptHasContent,
  writeCleanMarkdown,
  preserveExistingImportTimestamp,
  manifestSignature,
  manifestChanged,
  writeJson,
  appendJsonl,
  copyFile,
} from '../../src/transcript/import.js'

function makeParsed(overrides: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    client: 'codex',
    session_id: 'test-session',
    title: 'Test Session',
    started_at: '2024-06-15T12:00:00Z',
    cwd: '/home/user/project',
    branch: 'main',
    messages: [
      { role: 'user', text: 'Hello', timestamp: '2024-06-15T12:00:00Z' },
      { role: 'assistant', text: 'Hi there', timestamp: '2024-06-15T12:00:01Z' },
    ],
    tool_events: [
      { summary: 'read_file input="test.ts"', timestamp: '2024-06-15T12:00:02Z' },
    ],
    events: [
      {
        kind: 'message',
        role: 'user',
        text: 'Hello',
        timestamp: '2024-06-15T12:00:00Z',
        sequence: 0,
      },
      {
        kind: 'message',
        role: 'assistant',
        text: 'Hi there',
        timestamp: '2024-06-15T12:00:01Z',
        sequence: 1,
      },
      {
        kind: 'tool_call',
        tool_name: 'read_file',
        call_id: 'call-1',
        summary: 'read_file input="test.ts"',
        input: { path: 'test.ts' },
        timestamp: '2024-06-15T12:00:02Z',
        sequence: 2,
      },
    ],
    source_path: '',
    ...overrides,
  }
}

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'codex',
    project: 'test-project',
    session_id: 'test-session',
    raw_sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    title: 'Test Session',
    started_at: '2024-06-15T12:00:00Z',
    imported_at: '2024-06-15T13:00:00Z',
    cwd: '/home/user/project',
    branch: 'main',
    raw_source_path: '/home/user/.codex/sessions/test.jsonl',
    raw_upload_permission: 'none',
    global_raw_path: '/home/user/.memorytree/transcripts/raw/codex/test-project/2024/06/test__abcdef12.jsonl',
    global_clean_path: '/home/user/.memorytree/transcripts/clean/codex/test-project/2024/06/test__abcdef12.md',
    global_manifest_path: '/home/user/.memorytree/transcripts/index/manifests/codex/test-project/2024/06/test__abcdef12.json',
    repo_raw_path: 'Memory/06_transcripts/raw/codex/2024/06/test__abcdef12.jsonl',
    repo_clean_path: 'Memory/06_transcripts/clean/codex/2024/06/test__abcdef12.md',
    repo_manifest_path: 'Memory/06_transcripts/manifests/codex/2024/06/test__abcdef12.json',
    global_full_path: '/home/user/.memorytree/transcripts/full/codex/test-project/2024/06/test__abcdef12.json',
    repo_full_path: 'Memory/06_transcripts/full/codex/2024/06/test__abcdef12.json',
    message_count: 2,
    tool_event_count: 1,
    event_count: 3,
    cleaning_mode: 'deterministic-code',
    repo_mirror_enabled: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// transcriptHasContent
// ---------------------------------------------------------------------------

describe('transcriptHasContent', () => {
  it('returns true when messages exist', () => {
    expect(transcriptHasContent(makeParsed())).toBe(true)
  })

  it('returns true when only tool_events exist', () => {
    expect(transcriptHasContent(makeParsed({ messages: [], tool_events: [{ summary: 'tool', timestamp: null }] }))).toBe(true)
  })

  it('returns true when only normalized events exist', () => {
    expect(transcriptHasContent(makeParsed({ messages: [], tool_events: [], events: [{ kind: 'context', title: 'turn_context', timestamp: null, sequence: 0 }] }))).toBe(true)
  })

  it('returns false when both empty', () => {
    expect(transcriptHasContent(makeParsed({ messages: [], tool_events: [], events: [] }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// writeCleanMarkdown
// ---------------------------------------------------------------------------

describe('writeCleanMarkdown', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'clean-md-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('writes markdown with frontmatter and messages', () => {
    const filePath = join(tmpDir, 'test.md')
    const parsed = makeParsed()
    const manifest = makeManifest()
    writeCleanMarkdown(parsed, manifest, filePath)

    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('---')
    expect(content).toContain('client: codex')
    expect(content).toContain('## Messages')
    expect(content).toContain('### 1. user')
    expect(content).toContain('Hello')
    expect(content).toContain('### 2. assistant')
    expect(content).toContain('Hi there')
    expect(content).not.toContain('## Tool Events')
    expect(content).not.toContain('read_file')
  })

  it('writes no-messages placeholder when messages empty', () => {
    const filePath = join(tmpDir, 'empty.md')
    const parsed = makeParsed({ messages: [] })
    const manifest = makeManifest()
    writeCleanMarkdown(parsed, manifest, filePath)

    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('No user or assistant messages')
  })

  it('does not write tool events section', () => {
    const filePath = join(tmpDir, 'no-tools.md')
    const parsed = makeParsed({ tool_events: [] })
    const manifest = makeManifest()
    writeCleanMarkdown(parsed, manifest, filePath)

    const content = readFileSync(filePath, 'utf-8')
    expect(content).not.toContain('## Tool Events')
  })
})

// ---------------------------------------------------------------------------
// preserveExistingImportTimestamp
// ---------------------------------------------------------------------------

describe('preserveExistingImportTimestamp', () => {
  it('returns payload when existing is null', () => {
    const payload = makeManifest()
    expect(preserveExistingImportTimestamp(null, payload)).toBe(payload)
  })

  it('preserves imported_at when signatures match', () => {
    const existing = { ...makeManifest(), imported_at: '2024-01-01T00:00:00Z' } as Record<string, unknown>
    const payload = makeManifest({ imported_at: '2024-06-15T13:00:00Z' })
    const result = preserveExistingImportTimestamp(existing, payload)
    expect(result.imported_at).toBe('2024-01-01T00:00:00Z')
  })

  it('returns new payload when signatures differ', () => {
    const existing = { ...makeManifest({ title: 'old' }), imported_at: '2024-01-01T00:00:00Z' } as Record<string, unknown>
    const payload = makeManifest({ title: 'new', imported_at: '2024-06-15T13:00:00Z' })
    const result = preserveExistingImportTimestamp(existing, payload)
    expect(result.imported_at).toBe('2024-06-15T13:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// manifestSignature
// ---------------------------------------------------------------------------

describe('manifestSignature', () => {
  it('excludes imported_at', () => {
    const sig = manifestSignature({ a: 1, imported_at: 'x', b: 2 })
    expect(sig).toEqual({ a: 1, b: 2 })
  })
})

// ---------------------------------------------------------------------------
// manifestChanged
// ---------------------------------------------------------------------------

describe('manifestChanged', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'manifest-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns true for non-existent file', () => {
    expect(manifestChanged(join(tmpDir, 'missing.json'), { a: 1 })).toBe(true)
  })

  it('returns false when content matches', () => {
    const filePath = join(tmpDir, 'test.json')
    writeFileSync(filePath, JSON.stringify({ a: 1 }))
    expect(manifestChanged(filePath, { a: 1 })).toBe(false)
  })

  it('returns true when content differs', () => {
    const filePath = join(tmpDir, 'test.json')
    writeFileSync(filePath, JSON.stringify({ a: 1 }))
    expect(manifestChanged(filePath, { a: 2 })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// writeJson / appendJsonl
// ---------------------------------------------------------------------------

describe('writeJson', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'json-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('writes formatted JSON with trailing newline', () => {
    const filePath = join(tmpDir, 'test.json')
    writeJson(filePath, { a: 1, b: 'hello' })
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toBe('{\n  "a": 1,\n  "b": "hello"\n}\n')
  })
})

describe('appendJsonl', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'jsonl-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('appends single JSON line', () => {
    const filePath = join(tmpDir, 'test.jsonl')
    writeFileSync(filePath, '')
    appendJsonl(filePath, { a: 1 })
    appendJsonl(filePath, { b: 2 })
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual({ a: 1 })
    expect(JSON.parse(lines[1]!)).toEqual({ b: 2 })
  })
})

// ---------------------------------------------------------------------------
// copyFile
// ---------------------------------------------------------------------------

describe('copyFile', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'copy-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('copies file to destination', () => {
    const src = join(tmpDir, 'src.txt')
    const dst = join(tmpDir, 'dst.txt')
    writeFileSync(src, 'hello')
    copyFile(src, dst)
    expect(readFileSync(dst, 'utf-8')).toBe('hello')
  })

  it('skips when source equals destination', () => {
    const src = join(tmpDir, 'same.txt')
    writeFileSync(src, 'hello')
    copyFile(src, src)
    expect(readFileSync(src, 'utf-8')).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// importTranscript (end-to-end)
// ---------------------------------------------------------------------------

describe('importTranscript', () => {
  let tmpDir: string
  let repoRoot: string
  let globalRoot: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'import-'))
    repoRoot = join(tmpDir, 'repo')
    globalRoot = join(tmpDir, 'global')
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('imports a transcript and creates all expected files', async () => {
    const sourceFile = join(tmpDir, 'test.jsonl')
    writeFileSync(sourceFile, '{"type":"session_meta","payload":{"id":"s1"}}\n')

    const parsed = makeParsed({ source_path: sourceFile })
    const result = await importTranscript(parsed, repoRoot, globalRoot, 'my-project', 'none', true)

    expect(result.client).toBe('codex')
    expect(result.project).toBe('my-project')
    expect(result.message_count).toBe(2)
    expect(result.tool_event_count).toBe(1)
    expect(result.event_count).toBe(3)
    expect(result.cleaning_mode).toBe('deterministic-code')
    expect(result.repo_mirror_enabled).toBe(true)

    // Verify files exist
    expect(existsSync(join(repoRoot, result.repo_raw_path))).toBe(true)
    expect(existsSync(join(repoRoot, result.repo_clean_path))).toBe(true)
    expect(existsSync(join(repoRoot, result.repo_manifest_path))).toBe(true)
    expect(existsSync(join(repoRoot, result.repo_full_path))).toBe(true)

    const full = JSON.parse(readFileSync(join(repoRoot, result.repo_full_path), 'utf-8')) as Record<string, unknown>
    expect(full['schema_version']).toBe('transcript.full.v1')
    expect(Array.isArray(full['events'])).toBe(true)
  })

  it('imports without repo mirror', async () => {
    const sourceFile = join(tmpDir, 'test2.jsonl')
    writeFileSync(sourceFile, '{"type":"test"}\n')

    const parsed = makeParsed({ source_path: sourceFile })
    const result = await importTranscript(parsed, repoRoot, globalRoot, 'my-project', 'none', false)

    expect(result.repo_raw_path).toBe('')
    expect(result.repo_clean_path).toBe('')
    expect(result.repo_manifest_path).toBe('')
    expect(result.repo_full_path).toBe('')
    expect(result.repo_mirror_enabled).toBe(false)
    expect(existsSync(result.global_full_path)).toBe(true)
  })

  it('preserves imported_at on idempotent re-import', async () => {
    const sourceFile = join(tmpDir, 'test3.jsonl')
    writeFileSync(sourceFile, '{"type":"test"}\n')

    const parsed = makeParsed({ source_path: sourceFile })
    const first = await importTranscript(parsed, repoRoot, globalRoot, 'my-project', 'none')
    const firstImportedAt = first.imported_at

    // Re-import (manifest exists, signature unchanged)
    const second = await importTranscript(parsed, repoRoot, globalRoot, 'my-project', 'none')
    expect(second.imported_at).toBe(firstImportedAt)
  })
})
