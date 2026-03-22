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
  function scaffoldMemory(
    root: string,
    overrides: Partial<{
      project: string
      cwd: string
      title: string
      sessionId: string
      rawSha256: string
      stem: string
      includeFull: boolean
    }> = {},
  ): void {
    // Create directory structure
    const manifestsDir = join(root, 'Memory', '06_transcripts', 'manifests', 'codex', '2026', '03')
    const cleanDir = join(root, 'Memory', '06_transcripts', 'clean', 'codex', '2026', '03')
    const rawDir = join(root, 'Memory', '06_transcripts', 'raw', 'codex', '2026', '03')
    mkdirSync(manifestsDir, { recursive: true })
    mkdirSync(cleanDir, { recursive: true })
    mkdirSync(rawDir, { recursive: true })

    const stem = overrides.stem ?? 'test-session__deadbeef'
    const includeFull = overrides.includeFull ?? true
    const manifest = {
      client: 'codex',
      project: overrides.project ?? 'test',
      session_id: overrides.sessionId ?? 'test-session-001',
      raw_sha256: overrides.rawSha256 ?? ('deadbeef' + '0'.repeat(56)),
      title: overrides.title ?? 'Integration Test Session',
      started_at: '2026-03-10T10:00:00Z',
      imported_at: '2026-03-10T10:01:00Z',
      cwd: overrides.cwd ?? '/home/user/project',
      branch: 'main',
      raw_source_path: '/src/session.jsonl',
      raw_upload_permission: 'not-set',
      global_raw_path: '',
      global_clean_path: '',
      global_manifest_path: '',
      global_full_path: '',
      repo_raw_path: `Memory/06_transcripts/raw/codex/2026/03/${stem}.jsonl`,
      repo_clean_path: `Memory/06_transcripts/clean/codex/2026/03/${stem}.md`,
      repo_manifest_path: `Memory/06_transcripts/manifests/codex/2026/03/${stem}.json`,
      repo_full_path: includeFull ? `Memory/06_transcripts/full/codex/2026/03/${stem}.json` : '',
      message_count: 2,
      tool_event_count: 1,
      event_count: 6,
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

    const rawJsonl = [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-03-10T10:00:00Z',
        payload: {
          id: overrides.sessionId ?? 'test-session-001',
          thread_name: overrides.title ?? 'Integration Test Session',
          cwd: overrides.cwd ?? '/home/user/project',
          git: { branch: 'main' },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-10T10:00:00Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Build the report system.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-10T10:00:03Z',
        payload: {
          type: 'reasoning',
          summary: [{ text: 'Planning the next implementation step.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-10T10:00:04Z',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{"command":"git status"}',
          call_id: 'call-1',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-10T10:00:05Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'Exit code: 0\nOutput:\nclean',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-10T10:00:06Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: "I'll help with that!" }],
        },
      }),
      '',
    ].join('\n')
    writeFileSync(join(rawDir, `${stem}.jsonl`), rawJsonl, 'utf-8')

    if (includeFull) {
      const fullDir = join(root, 'Memory', '06_transcripts', 'full', 'codex', '2026', '03')
      mkdirSync(fullDir, { recursive: true })
      writeFileSync(
        join(fullDir, `${stem}.json`),
        JSON.stringify({
          schema_version: 'transcript.full.v1',
          client: 'codex',
          session_id: overrides.sessionId ?? 'test-session-001',
          title: overrides.title ?? 'Integration Test Session',
          started_at: '2026-03-10T10:00:00Z',
          cwd: overrides.cwd ?? '/home/user/project',
          branch: 'main',
          source_path: '/src/session.jsonl',
          messages: [
            { role: 'user', text: 'Build the report system.', timestamp: '2026-03-10T10:00:00Z' },
            { role: 'assistant', text: "I'll help with that!", timestamp: '2026-03-10T10:00:05Z' },
          ],
          tool_events: [],
          events: [
            { kind: 'context', title: 'turn_context', timestamp: '2026-03-10T10:00:00Z', sequence: 0, metadata: { model: 'gpt-5.4' } },
            { kind: 'message', role: 'user', text: 'Build the report system.', timestamp: '2026-03-10T10:00:00Z', sequence: 1 },
            { kind: 'reasoning', summary: 'Planning the next implementation step.', timestamp: '2026-03-10T10:00:03Z', sequence: 2, redacted: false },
            { kind: 'tool_call', tool_name: 'shell_command', summary: 'shell_command input={"command":"git status"}', input: { command: 'git status' }, call_id: 'call-1', timestamp: '2026-03-10T10:00:04Z', sequence: 3 },
            { kind: 'tool_result', tool_name: 'shell_command', summary: 'shell_command output=clean', output: 'Exit code: 0\\nOutput:\\nclean', call_id: 'call-1', timestamp: '2026-03-10T10:00:05Z', sequence: 4 },
            { kind: 'message', role: 'assistant', text: "I'll help with that!", timestamp: '2026-03-10T10:00:06Z', sequence: 5 },
          ],
        }, null, 2),
        'utf-8',
      )
    }
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

  it('renders structured replay HTML from normalized full transcript json', async () => {
    scaffoldMemory(tmpDir)
    const output = join(tmpDir, 'Memory', '07_reports')

    await buildReport({ root: tmpDir, output, noAi: true })

    const transcriptHtml = readFileSync(
      join(output, 'transcripts', 'codex', 'test-session__deadbeef.html'),
      'utf-8',
    )
    expect(transcriptHtml).toContain('transcript-timeline')
    expect(transcriptHtml).toContain('data-event-kind="tool_call"')
    expect(transcriptHtml).toContain('Build the report system.')
    expect(transcriptHtml).toContain('shell_command')
    expect(transcriptHtml).toContain('Planning the next implementation step.')
  })

  it('falls back to parsing raw transcripts when full transcript json is missing', async () => {
    scaffoldMemory(tmpDir, { includeFull: false })
    const output = join(tmpDir, 'Memory', '07_reports')

    await buildReport({ root: tmpDir, output, noAi: true })

    const transcriptHtml = readFileSync(
      join(output, 'transcripts', 'codex', 'test-session__deadbeef.html'),
      'utf-8',
    )
    expect(transcriptHtml).toContain('Search this replay')
    expect(transcriptHtml).toContain('Session Map')
    expect(transcriptHtml).toContain('Expand details')
    expect(transcriptHtml).toContain('shell_command')
    expect(transcriptHtml).toContain('Planning the next implementation step.')
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

  it('includes extra manifest dirs in the projects and sessions pages', async () => {
    scaffoldMemory(tmpDir, {
      project: 'alpha',
      cwd: '/home/user/alpha',
      sessionId: 'alpha-session-001',
      rawSha256: 'a'.repeat(64),
      stem: 'alpha-session__aaaabbbb',
    })

    const extraRoot = join(tmpDir, 'extra-project')
    scaffoldMemory(extraRoot, {
      project: 'beta',
      cwd: '/home/user/beta',
      sessionId: 'beta-session-001',
      rawSha256: 'b'.repeat(64),
      stem: 'beta-session__ccccdddd',
    })

    const output = join(tmpDir, 'Memory', '07_reports')
    await buildReport({
      root: tmpDir,
      output,
      noAi: true,
      extraManifestDirs: [join(extraRoot, 'Memory', '06_transcripts', 'manifests')],
    })

    const projectsHtml = readFileSync(join(output, 'projects', 'index.html'), 'utf-8')
    expect(projectsHtml).toContain('alpha')
    expect(projectsHtml).toContain('beta')
    expect(projectsHtml).toContain('../transcripts/index.html?project=beta')

    const sessionsHtml = readFileSync(join(output, 'transcripts', 'index.html'), 'utf-8')
    expect(sessionsHtml).toContain('id="project-filter"')
    expect(sessionsHtml).toContain('data-project="beta"')
  })
})
