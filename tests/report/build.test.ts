import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReport, ensureGitignore, parseMessagesFromMarkdown } from '../../src/report/build.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'build-test-'))
  delete process.env['ANTHROPIC_API_KEY']
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env['ANTHROPIC_API_KEY']
})

// ---------------------------------------------------------------------------
// ensureGitignore
// ---------------------------------------------------------------------------

describe('ensureGitignore', () => {
  it('creates .gitignore with entry if missing', () => {
    ensureGitignore(tmpDir, 'Memory/07_reports/')
    const path = join(tmpDir, '.gitignore')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('Memory/07_reports/')
  })

  it('appends to existing .gitignore', () => {
    const path = join(tmpDir, '.gitignore')
    writeFileSync(path, 'node_modules/\ndist/\n', 'utf-8')
    ensureGitignore(tmpDir, 'Memory/07_reports/')
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('Memory/07_reports/')
  })

  it('does not add duplicate entry', () => {
    const path = join(tmpDir, '.gitignore')
    writeFileSync(path, 'Memory/07_reports/\n', 'utf-8')
    ensureGitignore(tmpDir, 'Memory/07_reports/')
    const content = readFileSync(path, 'utf-8')
    const count = (content.match(/Memory\/07_reports\//g) ?? []).length
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// parseMessagesFromMarkdown
// ---------------------------------------------------------------------------

describe('parseMessagesFromMarkdown', () => {
  it('parses messages from clean markdown format', () => {
    const md = `---
client: codex
---

# Test Session

## Messages

### 1. user
- Timestamp: \`2026-03-10T10:00:00Z\`

Hello, how are you?

### 2. assistant
- Timestamp: \`2026-03-10T10:00:05Z\`

I'm doing well, thank you!
`
    const messages = parseMessagesFromMarkdown(md)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.text).toContain('Hello')
    expect(messages[1]!.role).toBe('assistant')
    expect(messages[1]!.text).toContain("I'm doing well")
  })

  it('returns empty array when no ## Messages section', () => {
    const md = '# Title\n\nSome content.'
    expect(parseMessagesFromMarkdown(md)).toEqual([])
  })

  it('parses timestamps', () => {
    const md = `\n## Messages\n\n### 1. user\n- Timestamp: \`2026-03-10T10:00:00Z\`\n\nHello`
    const messages = parseMessagesFromMarkdown(md)
    expect(messages[0]!.timestamp).toBe('2026-03-10T10:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// buildReport integration test
// ---------------------------------------------------------------------------

describe('buildReport', () => {
  function scaffoldMemory(root: string): void {
    // Create directory structure
    const manifestsDir = join(root, 'Memory', '06_transcripts', 'manifests', 'codex', '2026', '03')
    const cleanDir = join(root, 'Memory', '06_transcripts', 'clean', 'codex', '2026', '03')
    mkdirSync(manifestsDir, { recursive: true })
    mkdirSync(cleanDir, { recursive: true })

    const stem = 'test-session__deadbeef'
    const manifest = {
      client: 'codex',
      project: 'test',
      session_id: 'test-session-001',
      raw_sha256: 'deadbeef' + '0'.repeat(56),
      title: 'Integration Test Session',
      started_at: '2026-03-10T10:00:00Z',
      imported_at: '2026-03-10T10:01:00Z',
      cwd: '/home/user/project',
      branch: 'main',
      raw_source_path: '/src/session.jsonl',
      raw_upload_permission: 'not-set',
      global_raw_path: '',
      global_clean_path: '',
      global_manifest_path: '',
      repo_raw_path: '',
      repo_clean_path: `Memory/06_transcripts/clean/codex/2026/03/${stem}.md`,
      repo_manifest_path: `Memory/06_transcripts/manifests/codex/2026/03/${stem}.json`,
      message_count: 2,
      tool_event_count: 0,
      cleaning_mode: 'deterministic-code',
      repo_mirror_enabled: true,
    }

    writeFileSync(
      join(manifestsDir, `${stem}.json`),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    )

    const cleanMd = `---
client: codex
---

# Integration Test Session

## Messages

### 1. user
- Timestamp: \`2026-03-10T10:00:00Z\`

Build the report system.

### 2. assistant
- Timestamp: \`2026-03-10T10:00:05Z\`

I'll help with that!
`
    writeFileSync(join(cleanDir, `${stem}.md`), cleanMd, 'utf-8')
  }

  it('creates all expected HTML files', async () => {
    scaffoldMemory(tmpDir)
    const output = join(tmpDir, 'Memory', '07_reports')

    await buildReport({
      root: tmpDir,
      output,
      noAi: true,
    })

    expect(existsSync(join(output, 'index.html'))).toBe(true)
    expect(existsSync(join(output, 'transcripts', 'index.html'))).toBe(true)
    expect(existsSync(join(output, 'goals', 'index.html'))).toBe(true)
    expect(existsSync(join(output, 'knowledge', 'index.html'))).toBe(true)
    expect(existsSync(join(output, 'search.html'))).toBe(true)
  })

  it('generates individual transcript HTML with SVG charts in dashboard', async () => {
    scaffoldMemory(tmpDir)
    const output = join(tmpDir, 'Memory', '07_reports')

    await buildReport({ root: tmpDir, output, noAi: true })

    // Dashboard should contain SVG
    const dashHtml = readFileSync(join(output, 'index.html'), 'utf-8')
    expect(dashHtml).toContain('<svg')

    // Individual transcript should exist
    const transcriptDir = join(output, 'transcripts', 'codex')
    expect(existsSync(transcriptDir)).toBe(true)
    const files = readdirSync(transcriptDir)
    expect(files.some(f => f.endsWith('.html'))).toBe(true)
  })

  it('creates .gitignore entry for Memory/07_reports/', async () => {
    scaffoldMemory(tmpDir)
    const output = join(tmpDir, 'Memory', '07_reports')

    await buildReport({ root: tmpDir, output, noAi: true })

    const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('Memory/07_reports/')
  })

  it('removes stale generated files before rebuilding', async () => {
    scaffoldMemory(tmpDir)
    const output = join(tmpDir, 'Memory', '07_reports')
    const stalePath = join(output, 'transcripts', 'codex', 'stale.html')

    mkdirSync(join(output, 'transcripts', 'codex'), { recursive: true })
    writeFileSync(stalePath, '<html>stale</html>', 'utf-8')

    await buildReport({ root: tmpDir, output, noAi: true })

    expect(existsSync(stalePath)).toBe(false)
  })

  it('scopes duplicate heading anchors per markdown file', async () => {
    scaffoldMemory(tmpDir)
    const goalsDir = join(tmpDir, 'Memory', '01_goals')
    mkdirSync(goalsDir, { recursive: true })
    writeFileSync(join(goalsDir, 'a.md'), '# Goal A\n\n## Overview\n\nAlpha\n', 'utf-8')
    writeFileSync(join(goalsDir, 'b.md'), '# Goal B\n\n## Overview\n\nBeta\n', 'utf-8')
    const output = join(tmpDir, 'Memory', '07_reports')

    await buildReport({ root: tmpDir, output, noAi: true })

    const html = readFileSync(join(output, 'goals', 'index.html'), 'utf-8')
    expect(html).toContain('href="#a-md-overview"')
    expect(html).toContain('href="#b-md-overview"')
    expect((html.match(/id="a-md-overview"/g) ?? [])).toHaveLength(1)
    expect((html.match(/id="b-md-overview"/g) ?? [])).toHaveLength(1)
  })

  it('handles empty Memory directory gracefully', async () => {
    // Create root but no transcripts
    mkdirSync(join(tmpDir, 'Memory'), { recursive: true })
    const output = join(tmpDir, 'Memory', '07_reports')

    await expect(
      buildReport({ root: tmpDir, output, noAi: true }),
    ).resolves.toBeUndefined()

    expect(existsSync(join(output, 'index.html'))).toBe(true)
  })
})
