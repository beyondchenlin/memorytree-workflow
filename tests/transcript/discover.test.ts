import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { ParsedTranscript } from '../../src/types/transcript.js'
import {
  defaultGlobalTranscriptRoot,
  defaultClientRoots,
  inferProjectSlug,
  projectSlugsMatch,
  transcriptMatchesRepo,
  safeFileMtime,
  discoverSourceFiles,
} from '../../src/transcript/discover.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal ParsedTranscript for testing
// ---------------------------------------------------------------------------

function makeParsed(overrides: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    client: 'codex',
    session_id: 'test-session',
    title: 'Test',
    started_at: '2024-01-01T00:00:00Z',
    cwd: '',
    branch: '',
    messages: [],
    tool_events: [],
    source_path: '/tmp/test.jsonl',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// defaultGlobalTranscriptRoot
// ---------------------------------------------------------------------------

describe('defaultGlobalTranscriptRoot', () => {
  it('returns path containing .memorytree/transcripts', () => {
    const root = defaultGlobalTranscriptRoot()
    expect(root).toContain('.memorytree/transcripts')
  })

  it('returns a posix-style path (forward slashes)', () => {
    const root = defaultGlobalTranscriptRoot()
    expect(root).not.toContain('\\')
  })
})

// ---------------------------------------------------------------------------
// defaultClientRoots
// ---------------------------------------------------------------------------

describe('defaultClientRoots', () => {
  it('returns roots for codex, claude, and gemini', () => {
    const roots = defaultClientRoots()
    expect(Object.keys(roots).sort()).toEqual(['claude', 'codex', 'gemini'])
  })

  it('each root contains the client name', () => {
    const roots = defaultClientRoots()
    for (const [client, root] of Object.entries(roots)) {
      expect(root).toContain(`.${client}`)
    }
  })
})

// ---------------------------------------------------------------------------
// inferProjectSlug
// ---------------------------------------------------------------------------

describe('inferProjectSlug', () => {
  it('returns slugified cwd basename when cwd is set', () => {
    const parsed = makeParsed({ cwd: '/home/user/My Project' })
    expect(inferProjectSlug(parsed)).toBe('my-project')
  })

  it('returns "project" fallback when cwd basename is non-ASCII only', () => {
    const parsed = makeParsed({ cwd: '/home/user/\u4F60\u597D' })
    expect(inferProjectSlug(parsed)).toBe('project')
  })

  it('derives slug from claude source_path parent when cwd is empty', () => {
    const parsed = makeParsed({
      client: 'claude',
      cwd: '',
      source_path: '/home/user/.claude/projects/a--my-repo/session.jsonl',
    })
    expect(inferProjectSlug(parsed)).toBe('my-repo')
  })

  it('strips single-letter prefix from claude parent dir', () => {
    const parsed = makeParsed({
      client: 'claude',
      cwd: '',
      source_path: '/home/user/.claude/projects/z--cool-project/session.jsonl',
    })
    expect(inferProjectSlug(parsed)).toBe('cool-project')
  })

  it('derives slug from gemini source_path parent when cwd is empty', () => {
    const parsed = makeParsed({
      client: 'gemini',
      cwd: '',
      source_path: '/home/user/.gemini/history/my-app/session.json',
    })
    expect(inferProjectSlug(parsed)).toBe('my-app')
  })

  it('returns "unknown-project" for codex with no cwd', () => {
    const parsed = makeParsed({ client: 'codex', cwd: '' })
    expect(inferProjectSlug(parsed)).toBe('unknown-project')
  })

  it('prefers cwd over source_path for claude', () => {
    const parsed = makeParsed({
      client: 'claude',
      cwd: '/home/user/from-cwd',
      source_path: '/home/user/.claude/projects/a--from-source/session.jsonl',
    })
    expect(inferProjectSlug(parsed)).toBe('from-cwd')
  })
})

// ---------------------------------------------------------------------------
// projectSlugsMatch
// ---------------------------------------------------------------------------

describe('projectSlugsMatch', () => {
  it('returns true for equal non-empty slugs', () => {
    expect(projectSlugsMatch('my-project', 'my-project')).toBe(true)
  })

  it('returns false for different slugs', () => {
    expect(projectSlugsMatch('project-a', 'project-b')).toBe(false)
  })

  it('returns false when left is empty', () => {
    expect(projectSlugsMatch('', 'project')).toBe(false)
  })

  it('returns false when right is empty', () => {
    expect(projectSlugsMatch('project', '')).toBe(false)
  })

  it('returns false for "unknown-project"', () => {
    expect(projectSlugsMatch('unknown-project', 'unknown-project')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transcriptMatchesRepo
// ---------------------------------------------------------------------------

describe('transcriptMatchesRepo', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'repo-match-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('matches when cwd equals repo root', () => {
    const parsed = makeParsed({ cwd: tmpDir })
    expect(transcriptMatchesRepo(parsed, tmpDir, 'unrelated-slug')).toBe(true)
  })

  it('matches when cwd is a subdirectory of repo root', () => {
    const subDir = join(tmpDir, 'sub', 'dir')
    mkdirSync(subDir, { recursive: true })
    const parsed = makeParsed({ cwd: subDir })
    expect(transcriptMatchesRepo(parsed, tmpDir, 'unrelated-slug')).toBe(true)
  })

  it('does not match when cwd is a sibling directory', () => {
    const other = mkdtempSync(join(tmpdir(), 'other-'))
    try {
      const parsed = makeParsed({ cwd: other })
      expect(transcriptMatchesRepo(parsed, tmpDir, 'no-match')).toBe(false)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('falls back to slug matching when cwd is empty', () => {
    const parsed = makeParsed({ cwd: '', client: 'codex' })
    // inferProjectSlug returns 'unknown-project' for codex with no cwd
    expect(transcriptMatchesRepo(parsed, tmpDir, 'unknown-project')).toBe(false)
  })

  it('matches via slug when cwd is empty but slugs match', () => {
    const parsed = makeParsed({
      client: 'claude',
      cwd: '',
      source_path: '/home/.claude/projects/a--my-repo/session.jsonl',
    })
    expect(transcriptMatchesRepo(parsed, tmpDir, 'my-repo')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// safeFileMtime
// ---------------------------------------------------------------------------

describe('safeFileMtime', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mtime-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns mtime in seconds for existing file', () => {
    const filePath = join(tmpDir, 'test.txt')
    writeFileSync(filePath, 'content')
    const mtime = safeFileMtime(filePath)
    expect(mtime).toBeGreaterThan(0)
    // Should be within a few seconds of now
    const now = Date.now() / 1000
    expect(Math.abs(now - mtime)).toBeLessThan(10)
  })

  it('returns 0 for non-existent file', () => {
    expect(safeFileMtime(join(tmpDir, 'missing.txt'))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// discoverSourceFiles — integration test with temp directories
// ---------------------------------------------------------------------------

describe('discoverSourceFiles', () => {
  let tmpDir: string
  let codexRoot: string
  let claudeRoot: string
  let geminiRoot: string
  let mockRoots: Record<string, string>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'discover-'))
    codexRoot = join(tmpDir, '.codex')
    claudeRoot = join(tmpDir, '.claude')
    geminiRoot = join(tmpDir, '.gemini')
    mockRoots = { codex: codexRoot, claude: claudeRoot, gemini: geminiRoot }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('discovers codex session files', () => {
    const sessionsDir = join(codexRoot, 'sessions', 'abc')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'session.jsonl'), '{"type":"test"}\n')

    const results = discoverSourceFiles(new Set(['codex']), mockRoots)
    expect(results.length).toBe(1)
    expect(results[0]![0]).toBe('codex')
    expect(results[0]![1]).toContain('session.jsonl')
  })

  it('discovers claude project files', () => {
    const projectDir = join(claudeRoot, 'projects', 'a--my-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'chat.jsonl'), '{"msg":"hi"}\n')

    const results = discoverSourceFiles(new Set(['claude']), mockRoots)
    expect(results.length).toBe(1)
    expect(results[0]![0]).toBe('claude')
    expect(results[0]![1]).toContain('chat.jsonl')
  })

  it('discovers gemini history files', () => {
    const historyDir = join(geminiRoot, 'history', 'my-app')
    mkdirSync(historyDir, { recursive: true })
    writeFileSync(join(historyDir, 'session.json'), '{}')

    const results = discoverSourceFiles(new Set(['gemini']), mockRoots)
    expect(results.length).toBe(1)
    expect(results[0]![0]).toBe('gemini')
    expect(results[0]![1]).toContain('session.json')
  })

  it('skips clients whose root does not exist', () => {
    // codexRoot does not exist on disk — nothing was mkdirSync'd
    const results = discoverSourceFiles(new Set(['codex']), mockRoots)
    expect(results).toEqual([])
  })

  it('sorts results by mtime descending', () => {
    const sessionsDir = join(codexRoot, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    const older = join(sessionsDir, 'older.jsonl')
    const newer = join(sessionsDir, 'newer.jsonl')
    writeFileSync(older, '{"a":1}\n')
    writeFileSync(newer, '{"b":2}\n')

    // Set explicit mtimes: older = 1000s ago, newer = 500s ago
    const now = new Date()
    const olderTime = new Date(now.getTime() - 1000_000)
    const newerTime = new Date(now.getTime() - 500_000)
    utimesSync(older, olderTime, olderTime)
    utimesSync(newer, newerTime, newerTime)

    const results = discoverSourceFiles(new Set(['codex']), mockRoots)
    expect(results.length).toBe(2)
    // Newer file should come first
    expect(results[0]![1]).toContain('newer.jsonl')
    expect(results[1]![1]).toContain('older.jsonl')
  })

  it('deduplicates files by resolved lowercase path', () => {
    const historyDir = join(geminiRoot, 'history', 'proj')
    mkdirSync(historyDir, { recursive: true })
    writeFileSync(join(historyDir, 'data.json'), '{}')

    const results = discoverSourceFiles(new Set(['gemini']), mockRoots)
    // history/**/*.json matches data.json; should appear only once
    expect(results.length).toBe(1)
  })

  it('discovers gemini checkpoint files', () => {
    const checkpointDir = join(geminiRoot, 'tmp', 'workspace1', 'checkpoints', 'sub')
    mkdirSync(checkpointDir, { recursive: true })
    writeFileSync(join(checkpointDir, 'checkpoint.jsonl'), '{"c":3}\n')

    const results = discoverSourceFiles(new Set(['gemini']), mockRoots)
    expect(results.length).toBe(1)
    expect(results[0]![0]).toBe('gemini')
    expect(results[0]![1]).toContain('checkpoint.jsonl')
  })
})
