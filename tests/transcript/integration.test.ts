import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import initSqlJs from 'sql.js'

import { parseCodexTranscript } from '../../src/transcript/parse.js'
import { importTranscript, transcriptHasContent } from '../../src/transcript/import.js'
import { inferProjectSlug } from '../../src/transcript/discover.js'

describe('integration: parse → import → verify', () => {
  let tmpDir: string
  let repoRoot: string
  let globalRoot: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'integration-'))
    repoRoot = join(tmpDir, 'repo')
    globalRoot = join(tmpDir, 'global')
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('end-to-end: create JSONL → parse → import → verify files', async () => {
    // 1. Create a realistic Codex JSONL transcript
    const sourceFile = join(tmpDir, 'test-session.jsonl')
    const records = [
      { type: 'session_meta', payload: { id: 'sess-001', title: 'Fix bug', cwd: '/home/user/myproject', git: { branch: 'main' }, timestamp: '2024-06-15T10:00:00Z' } },
      { type: 'response_item', timestamp: '2024-06-15T10:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the login bug' }] } },
      { type: 'response_item', timestamp: '2024-06-15T10:00:02Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'I will fix the login bug for you.' }] } },
      { type: 'response_item', timestamp: '2024-06-15T10:00:03Z', payload: { type: 'function_call', name: 'read_file', arguments: { path: 'login.ts' } } },
      { type: 'response_item', timestamp: '2024-06-15T10:00:04Z', payload: { type: 'function_call_output', name: 'read_file', output: 'file contents here' } },
    ]
    writeFileSync(sourceFile, records.map(r => JSON.stringify(r)).join('\n') + '\n')

    // 2. Parse
    const parsed = parseCodexTranscript(sourceFile)
    expect(parsed.client).toBe('codex')
    expect(parsed.session_id).toBe('sess-001')
    expect(parsed.title).toBe('Fix bug')
    expect(parsed.cwd).toBe('/home/user/myproject')
    expect(parsed.branch).toBe('main')
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.tool_events).toHaveLength(2)
    expect(transcriptHasContent(parsed)).toBe(true)

    // 3. Infer project slug
    const slug = inferProjectSlug(parsed)
    expect(slug).toBe('myproject')

    // 4. Import
    const manifest = await importTranscript(parsed, repoRoot, globalRoot, slug, 'none', true)

    // 5. Verify manifest fields
    expect(manifest.client).toBe('codex')
    expect(manifest.project).toBe('myproject')
    expect(manifest.session_id).toBe('sess-001')
    expect(manifest.message_count).toBe(2)
    expect(manifest.tool_event_count).toBe(2)
    expect(manifest.cleaning_mode).toBe('deterministic-code')
    expect(manifest.repo_mirror_enabled).toBe(true)

    // 6. Verify raw file copied to repo + global
    expect(existsSync(join(repoRoot, manifest.repo_raw_path))).toBe(true)

    // 7. Verify clean markdown has correct frontmatter
    const cleanContent = readFileSync(join(repoRoot, manifest.repo_clean_path), 'utf-8')
    expect(cleanContent).toContain('---')
    expect(cleanContent).toContain('client: codex')
    expect(cleanContent).toContain('project: myproject')
    expect(cleanContent).toContain('## Messages')
    expect(cleanContent).toContain('### 1. user')
    expect(cleanContent).toContain('Fix the login bug')
    expect(cleanContent).toContain('### 2. assistant')
    expect(cleanContent).toContain('I will fix the login bug for you.')
    expect(cleanContent).toContain('## Tool Events')
    expect(cleanContent).toContain('read_file')

    // 8. Verify manifest JSON written
    const manifestContent = JSON.parse(
      readFileSync(join(repoRoot, manifest.repo_manifest_path), 'utf-8'),
    )
    expect(manifestContent.client).toBe('codex')
    expect(manifestContent.project).toBe('myproject')

    // 9. Verify SQLite index updated
    const dbPath = join(globalRoot, 'index', 'search.sqlite')
    expect(existsSync(dbPath)).toBe(true)
    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    const rows = db.exec('SELECT client, project, session_id FROM transcripts')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.values).toEqual([['codex', 'myproject', 'sess-001']])
    db.close()

    // 10. Verify event log written
    const eventLogPath = join(globalRoot, 'index', 'sessions.jsonl')
    expect(existsSync(eventLogPath)).toBe(true)
    const eventLines = readFileSync(eventLogPath, 'utf-8').trim().split('\n')
    expect(eventLines).toHaveLength(1)
    const event = JSON.parse(eventLines[0]!)
    expect(event.client).toBe('codex')
  })

  it('idempotent re-import preserves imported_at', async () => {
    const sourceFile = join(tmpDir, 'idem.jsonl')
    writeFileSync(sourceFile, '{"type":"session_meta","payload":{"id":"s1","title":"test"}}\n')

    const parsed = parseCodexTranscript(sourceFile)
    const first = await importTranscript(parsed, repoRoot, globalRoot, 'proj', 'none')
    const second = await importTranscript(parsed, repoRoot, globalRoot, 'proj', 'none')

    expect(second.imported_at).toBe(first.imported_at)
  })

  it('Claude transcript end-to-end', async () => {
    const sourceFile = join(tmpDir, 'claude-session.jsonl')
    const records = [
      { type: 'user', sessionId: 'cs1', cwd: '/proj', gitBranch: 'dev', timestamp: '2024-06-15T10:00:00Z', message: { role: 'user', content: 'Hello Claude' } },
      { type: 'assistant', sessionId: 'cs1', timestamp: '2024-06-15T10:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] } },
    ]
    writeFileSync(sourceFile, records.map(r => JSON.stringify(r)).join('\n') + '\n')

    const { parseClaudeTranscript } = await import('../../src/transcript/parse.js')
    const parsed = parseClaudeTranscript(sourceFile)
    expect(parsed.client).toBe('claude')
    expect(parsed.messages).toHaveLength(2)

    const manifest = await importTranscript(parsed, repoRoot, globalRoot, 'test-proj', 'none')
    expect(manifest.client).toBe('claude')
    expect(manifest.message_count).toBe(2)
  })
})
