import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  cwdMatches,
  findLatestFromJsonl,
  formatText,
  type RecallResult,
} from '../../src/recall/recall.js'
import { toPosixPath } from '../../src/utils/path.js'

// ---------------------------------------------------------------------------
// cwdMatches
// ---------------------------------------------------------------------------

describe('cwdMatches', () => {
  it('returns true for exact match', () => {
    const root = toPosixPath(resolve('/projects/my-app')).toLowerCase()
    expect(cwdMatches('/projects/my-app', root)).toBe(true)
  })

  it('returns true for subdirectory match', () => {
    const root = toPosixPath(resolve('/projects/my-app')).toLowerCase()
    expect(cwdMatches('/projects/my-app/src/utils', root)).toBe(true)
  })

  it('returns false when cwd does not match', () => {
    const root = toPosixPath(resolve('/projects/my-app')).toLowerCase()
    expect(cwdMatches('/other/project', root)).toBe(false)
  })

  it('returns false for empty cwd', () => {
    const root = toPosixPath(resolve('/projects/my-app')).toLowerCase()
    expect(cwdMatches('', root)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findLatestFromJsonl
// ---------------------------------------------------------------------------

describe('findLatestFromJsonl', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'recall-jsonl-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds the latest session matching the project slug', () => {
    const indexDir = join(tmpDir, 'index')
    mkdirSync(indexDir, { recursive: true })

    const sessions = [
      { project: 'my-app', started_at: '2024-01-01T10:00:00Z', session_id: 'older' },
      { project: 'my-app', started_at: '2024-06-15T10:00:00Z', session_id: 'newer' },
    ]
    writeFileSync(
      join(indexDir, 'sessions.jsonl'),
      sessions.map(s => JSON.stringify(s)).join('\n') + '\n',
    )

    const result = findLatestFromJsonl(tmpDir, '/some/path', 'my-app', '2025-01-01T00:00:00Z')
    expect(result).not.toBeNull()
    expect(result!['session_id']).toBe('newer')
  })

  it('filters out sessions at or after activation time', () => {
    const indexDir = join(tmpDir, 'index')
    mkdirSync(indexDir, { recursive: true })

    const sessions = [
      { project: 'my-app', started_at: '2024-01-01T10:00:00Z', session_id: 'before' },
      { project: 'my-app', started_at: '2025-06-01T00:00:00Z', session_id: 'after' },
    ]
    writeFileSync(
      join(indexDir, 'sessions.jsonl'),
      sessions.map(s => JSON.stringify(s)).join('\n') + '\n',
    )

    const result = findLatestFromJsonl(tmpDir, '/some/path', 'my-app', '2025-01-01T00:00:00Z')
    expect(result).not.toBeNull()
    expect(result!['session_id']).toBe('before')
  })

  it('returns null when no sessions match the project', () => {
    const indexDir = join(tmpDir, 'index')
    mkdirSync(indexDir, { recursive: true })

    const sessions = [
      { project: 'other-project', started_at: '2024-01-01T10:00:00Z', session_id: 's1' },
    ]
    writeFileSync(
      join(indexDir, 'sessions.jsonl'),
      sessions.map(s => JSON.stringify(s)).join('\n') + '\n',
    )

    const result = findLatestFromJsonl(tmpDir, '/some/path', 'my-app', '2025-01-01T00:00:00Z')
    expect(result).toBeNull()
  })

  it('returns null when sessions.jsonl does not exist', () => {
    const result = findLatestFromJsonl(tmpDir, '/some/path', 'my-app', '2025-01-01T00:00:00Z')
    expect(result).toBeNull()
  })

  it('matches sessions by cwd in addition to project slug', () => {
    const indexDir = join(tmpDir, 'index')
    mkdirSync(indexDir, { recursive: true })

    // Use a real temp path so resolve() works correctly
    const projectRoot = join(tmpDir, 'projects', 'my-app')
    mkdirSync(projectRoot, { recursive: true })
    const resolvedRoot = toPosixPath(resolve(projectRoot))

    const sessions = [
      { project: 'unrelated', cwd: resolvedRoot, started_at: '2024-01-01T10:00:00Z', session_id: 'cwd-match' },
    ]
    writeFileSync(
      join(indexDir, 'sessions.jsonl'),
      sessions.map(s => JSON.stringify(s)).join('\n') + '\n',
    )

    const result = findLatestFromJsonl(tmpDir, projectRoot, 'different-slug', '2025-01-01T00:00:00Z')
    expect(result).not.toBeNull()
    expect(result!['session_id']).toBe('cwd-match')
  })

  it('skips malformed JSON lines', () => {
    const indexDir = join(tmpDir, 'index')
    mkdirSync(indexDir, { recursive: true })

    const content = [
      'not valid json',
      JSON.stringify({ project: 'my-app', started_at: '2024-01-01T10:00:00Z', session_id: 'valid' }),
      '{ broken: }',
    ].join('\n') + '\n'
    writeFileSync(join(indexDir, 'sessions.jsonl'), content)

    const result = findLatestFromJsonl(tmpDir, '/some/path', 'my-app', '2025-01-01T00:00:00Z')
    expect(result).not.toBeNull()
    expect(result!['session_id']).toBe('valid')
  })
})

// ---------------------------------------------------------------------------
// formatText
// ---------------------------------------------------------------------------

describe('formatText', () => {
  it('formats a found result with session details', () => {
    const payload: RecallResult = {
      found: true,
      project: 'my-app',
      repo: '/projects/my-app',
      imported_count: 3,
      client: 'claude',
      session_id: 'abc-123',
      title: 'Test Session',
      started_at: '2024-06-15T10:00:00Z',
      cwd: '/projects/my-app',
      branch: 'main',
      message_count: 42,
      tool_event_count: 7,
      event_count: 64,
      global_clean_path: '/tmp/clean.md',
      global_full_path: '/tmp/full.json',
      normalized_content: '[10:00:00] user: Hello',
    }

    const text = formatText(payload)
    expect(text).toContain('project: my-app')
    expect(text).toContain('client: claude')
    expect(text).toContain('session_id: abc-123')
    expect(text).toContain('title: Test Session')
    expect(text).toContain('started_at: 2024-06-15T10:00:00Z')
    expect(text).toContain('branch: main')
    expect(text).toContain('messages: 42')
    expect(text).toContain('tool_events: 7')
    expect(text).toContain('events: 64')
    expect(text).toContain('imported_this_sync: 3')
    expect(text).toContain('full_transcript: /tmp/full.json')
    expect(text).toContain('--- normalized transcript content ---')
  })

  it('formats a not-found result with message', () => {
    const payload: RecallResult = {
      found: false,
      project: 'my-app',
      repo: '/projects/my-app',
      imported_count: 0,
      message: 'No previous session found for this project.',
    }

    const text = formatText(payload)
    expect(text).toContain('project: my-app')
    expect(text).toContain('imported: 0')
    expect(text).toContain('result: No previous session found for this project.')
  })

  it('includes clean content when present', () => {
    const payload: RecallResult = {
      found: true,
      project: 'my-app',
      repo: '/projects/my-app',
      imported_count: 0,
      clean_content: 'This is the transcript content.',
      global_clean_path: '/tmp/clean.md',
    }

    const text = formatText(payload)
    expect(text).toContain('--- clean transcript content ---')
    expect(text).toContain('This is the transcript content.')
  })
})
