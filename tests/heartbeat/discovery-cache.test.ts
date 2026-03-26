import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  ensureParsedDiscoveredSource,
  prepareHeartbeatDiscoveryCatalog,
  saveHeartbeatDiscoveryCatalog,
  sourceMatchesProject,
} from '../../src/heartbeat/discovery-cache.js'

let sandbox: string
let globalRoot: string
let repoRoot: string
let transcriptPath: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'memorytree-discovery-cache-'))
  globalRoot = join(sandbox, 'global')
  repoRoot = join(sandbox, 'repo')
  transcriptPath = join(sandbox, 'codex-session.jsonl')
  mkdirSync(globalRoot, { recursive: true })
  mkdirSync(repoRoot, { recursive: true })

  const records = [
    {
      type: 'session_meta',
      payload: {
        id: 'sess-001',
        title: 'Cache Test',
        cwd: repoRoot,
        git: { branch: 'main' },
        timestamp: '2024-06-15T10:00:00Z',
      },
    },
    {
      type: 'response_item',
      timestamp: '2024-06-15T10:00:01Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Check cache behavior' }],
      },
    },
  ]
  writeFileSync(transcriptPath, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8')
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('heartbeat discovery cache', () => {
  it('reuses cached metadata and imported project markers for unchanged sources', () => {
    const firstCatalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    const firstEntry = firstCatalog.entries[0]!

    expect(firstEntry.cacheHit).toBe(false)
    expect(firstEntry.parsed).not.toBeNull()
    expect(firstEntry.hasContent).toBe(true)

    firstEntry.importedProjectKeys.add('project-1')
    saveHeartbeatDiscoveryCatalog(firstCatalog)

    const secondCatalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    const secondEntry = secondCatalog.entries[0]!

    expect(secondEntry.cacheHit).toBe(true)
    expect(secondEntry.parsed).toBeNull()
    expect(secondEntry.hasContent).toBe(true)
    expect(secondEntry.importedProjectKeys.has('project-1')).toBe(true)
  })

  it('reparses cached entries on demand when full transcript data is needed', () => {
    const firstCatalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    saveHeartbeatDiscoveryCatalog(firstCatalog)

    const secondCatalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    const entry = secondCatalog.entries[0]!

    expect(entry.parsed).toBeNull()

    const parsed = ensureParsedDiscoveredSource(entry)
    expect(parsed).not.toBeNull()
    expect(parsed?.session_id).toBe('sess-001')
    expect(entry.parsed?.session_id).toBe('sess-001')
  })

  it('matches projects by cached cwd without reparsing the source file', () => {
    const catalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    const entry = catalog.entries[0]!

    expect(sourceMatchesProject(entry, repoRoot, 'different-slug')).toBe(true)
  })

  it('writes a persistent discovery cache document', () => {
    const catalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    catalog.entries[0]!.importedProjectKeys.add('project-1')
    saveHeartbeatDiscoveryCatalog(catalog)

    const raw = JSON.parse(
      readFileSync(join(globalRoot, 'index', 'discovery-cache.json'), 'utf-8'),
    ) as { version: number; entries: Record<string, { imported_project_keys: string[]; content_sha256: string }> }

    expect(raw.version).toBe(2)
    expect(Object.values(raw.entries)[0]!.imported_project_keys).toContain('project-1')
    expect(Object.values(raw.entries)[0]!.content_sha256).toHaveLength(64)
  })

  it('invalidates a cache hit when content changes but size and mtime stay the same', () => {
    const stableTime = new Date('2024-06-15T10:00:05.000Z')
    utimesSync(transcriptPath, stableTime, stableTime)
    const firstCatalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    saveHeartbeatDiscoveryCatalog(firstCatalog)

    const originalStats = statSync(transcriptPath)
    const changedRecords = [
      {
        type: 'session_meta',
        payload: {
          id: 'sess-001',
          title: 'Cache Test',
          cwd: repoRoot,
          git: { branch: 'main' },
          timestamp: '2024-06-15T10:00:00Z',
        },
      },
      {
        type: 'response_item',
        timestamp: '2024-06-15T10:00:01Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Check cache checksum' }],
        },
      },
    ]
    writeFileSync(transcriptPath, changedRecords.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8')
    utimesSync(transcriptPath, stableTime, stableTime)

    const changedStats = statSync(transcriptPath)
    expect(changedStats.size).toBe(originalStats.size)
    expect(changedStats.mtimeMs).toBe(stableTime.getTime())
    expect(originalStats.mtimeMs).toBe(stableTime.getTime())

    const secondCatalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    const secondEntry = secondCatalog.entries[0]!

    expect(secondEntry.cacheHit).toBe(false)
    expect(secondEntry.parsed).not.toBeNull()
  })

  it('ignores older cache documents that do not carry content hashes', () => {
    mkdirSync(join(globalRoot, 'index'), { recursive: true })
    writeFileSync(
      join(globalRoot, 'index', 'discovery-cache.json'),
      JSON.stringify({
        version: 1,
        entries: {
          [transcriptPath.toLowerCase()]: {
            client: 'codex',
            source_path: transcriptPath,
            size: 123,
            mtime_ms: 456,
            parse_status: 'ok',
            has_content: true,
            cwd: repoRoot,
            inferred_project_slug: 'repo',
            imported_project_keys: ['project-1'],
          },
        },
      }, null, 2) + '\n',
      'utf-8',
    )

    const catalog = prepareHeartbeatDiscoveryCatalog(globalRoot, [['codex', transcriptPath]])
    const entry = catalog.entries[0]!

    expect(entry.cacheHit).toBe(false)
    expect(entry.parsed).not.toBeNull()
  })
})
