import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import initSqlJs from 'sql.js'

import { upsertSearchIndex } from '../../src/transcript/db.js'
import type { ManifestEntry } from '../../src/types/transcript.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'claude',
    project: 'my-project',
    session_id: 'sess-001',
    raw_sha256: 'abc123def456',
    title: 'Test Session',
    started_at: '2024-06-01T00:00:00Z',
    imported_at: '2024-06-01T01:00:00Z',
    cwd: '/home/user/project',
    branch: 'main',
    raw_source_path: '/raw/source.jsonl',
    raw_upload_permission: 'granted',
    global_raw_path: '/global/raw/file.jsonl',
    global_clean_path: '/global/clean/file.md',
    global_manifest_path: '/global/manifests/file.json',
    global_full_path: '/global/full/file.json',
    repo_raw_path: '.memorytree/raw/file.jsonl',
    repo_clean_path: '.memorytree/clean/file.md',
    repo_manifest_path: '.memorytree/manifest.yaml',
    repo_full_path: '.memorytree/full.json',
    message_count: 42,
    tool_event_count: 7,
    event_count: 21,
    cleaning_mode: 'deterministic-code',
    repo_mirror_enabled: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('upsertSearchIndex', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'db-test-'))
    dbPath = join(tmpDir, 'transcripts.db')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // -----------------------------------------------------------------------
  // 1. Creates a new database and inserts a record
  // -----------------------------------------------------------------------
  it('creates a new db file and inserts one record', async () => {
    expect(existsSync(dbPath)).toBe(false)

    const manifest = makeManifest()
    await upsertSearchIndex(dbPath, manifest)

    expect(existsSync(dbPath)).toBe(true)

    // Read back with sql.js to verify
    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const rows = db.exec('SELECT * FROM transcripts')
      expect(rows).toHaveLength(1)
      const columns = rows[0]!.columns
      const values = rows[0]!.values
      expect(values).toHaveLength(1)

      // Check a few key fields via column index
      const clientIdx = columns.indexOf('client')
      const titleIdx = columns.indexOf('title')
      const msgIdx = columns.indexOf('message_count')
      const toolIdx = columns.indexOf('tool_event_count')

      expect(values[0]![clientIdx]).toBe('claude')
      expect(values[0]![titleIdx]).toBe('Test Session')
      expect(values[0]![msgIdx]).toBe(42)
      expect(values[0]![toolIdx]).toBe(7)
    } finally {
      db.close()
    }
  })

  // -----------------------------------------------------------------------
  // 2. Upsert — insert then update same PK, verify updated fields
  // -----------------------------------------------------------------------
  it('updates existing record on conflict (upsert)', async () => {
    const manifest = makeManifest()
    await upsertSearchIndex(dbPath, manifest)

    // Update non-PK fields
    const updated = makeManifest({
      title: 'Updated Title',
      message_count: 100,
      tool_event_count: 20,
      branch: 'feature-x',
    })
    await upsertSearchIndex(dbPath, updated)

    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const rows = db.exec('SELECT * FROM transcripts')
      expect(rows).toHaveLength(1)
      // Still only 1 row (upsert, not duplicate)
      expect(rows[0]!.values).toHaveLength(1)

      const columns = rows[0]!.columns
      const row = rows[0]!.values[0]!
      const titleIdx = columns.indexOf('title')
      const msgIdx = columns.indexOf('message_count')
      const toolIdx = columns.indexOf('tool_event_count')
      const branchIdx = columns.indexOf('branch')

      expect(row[titleIdx]).toBe('Updated Title')
      expect(row[msgIdx]).toBe(100)
      expect(row[toolIdx]).toBe(20)
      expect(row[branchIdx]).toBe('feature-x')
    } finally {
      db.close()
    }
  })

  // -----------------------------------------------------------------------
  // 3. Table schema has 22 columns
  // -----------------------------------------------------------------------
  it('creates table with 22 columns', async () => {
    await upsertSearchIndex(dbPath, makeManifest())

    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const info = db.exec('PRAGMA table_info(transcripts)')
      expect(info).toHaveLength(1)
      expect(info[0]!.values).toHaveLength(22)

      // Verify column names
      const columnNames = info[0]!.values.map((row) => row[1])
      expect(columnNames).toEqual([
        'client', 'project', 'session_id', 'raw_sha256',
        'title', 'started_at', 'imported_at',
        'cwd', 'branch', 'raw_source_path', 'raw_upload_permission',
        'global_raw_path', 'global_clean_path', 'global_manifest_path', 'global_full_path',
        'repo_raw_path', 'repo_clean_path', 'repo_manifest_path', 'repo_full_path',
        'message_count', 'tool_event_count', 'event_count',
      ])
    } finally {
      db.close()
    }
  })

  // -----------------------------------------------------------------------
  // 4. Multiple different records
  // -----------------------------------------------------------------------
  it('inserts multiple different records', async () => {
    const m1 = makeManifest({ session_id: 'sess-001', raw_sha256: 'hash1' })
    const m2 = makeManifest({ session_id: 'sess-002', raw_sha256: 'hash2', title: 'Second' })
    const m3 = makeManifest({ session_id: 'sess-003', raw_sha256: 'hash3', client: 'codex' })

    await upsertSearchIndex(dbPath, m1)
    await upsertSearchIndex(dbPath, m2)
    await upsertSearchIndex(dbPath, m3)

    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const rows = db.exec('SELECT * FROM transcripts ORDER BY session_id')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.values).toHaveLength(3)

      const columns = rows[0]!.columns
      const sessionIdx = columns.indexOf('session_id')
      expect(rows[0]!.values[0]![sessionIdx]).toBe('sess-001')
      expect(rows[0]!.values[1]![sessionIdx]).toBe('sess-002')
      expect(rows[0]!.values[2]![sessionIdx]).toBe('sess-003')
    } finally {
      db.close()
    }
  })

  // -----------------------------------------------------------------------
  // 5. Opens existing db file (reads back previous data)
  // -----------------------------------------------------------------------
  it('opens an existing db and preserves previous records', async () => {
    // Insert first record
    await upsertSearchIndex(dbPath, makeManifest({ session_id: 'first' }))

    // Insert second record into same file
    await upsertSearchIndex(dbPath, makeManifest({ session_id: 'second', raw_sha256: 'different' }))

    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const rows = db.exec('SELECT COUNT(*) as cnt FROM transcripts')
      expect(rows[0]!.values[0]![0]).toBe(2)
    } finally {
      db.close()
    }
  })

  // -----------------------------------------------------------------------
  // 6. Primary key columns are correct (composite key)
  // -----------------------------------------------------------------------
  it('enforces composite primary key (client, project, session_id, raw_sha256)', async () => {
    // Two records with same session_id but different raw_sha256 = 2 rows
    const m1 = makeManifest({ raw_sha256: 'sha-aaa', title: 'First' })
    const m2 = makeManifest({ raw_sha256: 'sha-bbb', title: 'Second' })
    await upsertSearchIndex(dbPath, m1)
    await upsertSearchIndex(dbPath, m2)

    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const rows = db.exec('SELECT title FROM transcripts ORDER BY raw_sha256')
      expect(rows[0]!.values).toHaveLength(2)
      expect(rows[0]!.values[0]![0]).toBe('First')
      expect(rows[0]!.values[1]![0]).toBe('Second')
    } finally {
      db.close()
    }
  })

  it('migrates an existing db that predates full transcript columns', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    try {
      db.run(`
        CREATE TABLE transcripts (
          client TEXT NOT NULL,
          project TEXT NOT NULL,
          session_id TEXT NOT NULL,
          raw_sha256 TEXT NOT NULL,
          title TEXT NOT NULL,
          started_at TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          cwd TEXT NOT NULL,
          branch TEXT NOT NULL,
          raw_source_path TEXT NOT NULL,
          raw_upload_permission TEXT NOT NULL,
          global_raw_path TEXT NOT NULL,
          global_clean_path TEXT NOT NULL,
          repo_raw_path TEXT NOT NULL,
          repo_clean_path TEXT NOT NULL,
          repo_manifest_path TEXT NOT NULL,
          message_count INTEGER NOT NULL,
          tool_event_count INTEGER NOT NULL,
          PRIMARY KEY (client, project, session_id, raw_sha256)
        )
      `)
      writeFileSync(dbPath, Buffer.from(db.export()))
    } finally {
      db.close()
    }

    await upsertSearchIndex(dbPath, makeManifest())

    const SQL2 = await initSqlJs()
    const migrated = new SQL2.Database(readFileSync(dbPath))
    try {
      const info = migrated.exec('PRAGMA table_info(transcripts)')
      const columnNames = info[0]!.values.map((row) => row[1])
      expect(columnNames).toContain('global_full_path')
      expect(columnNames).toContain('repo_full_path')
      expect(columnNames).toContain('event_count')

      const rows = migrated.exec('SELECT global_full_path, repo_full_path, event_count FROM transcripts')
      expect(rows[0]!.values[0]).toEqual(['/global/full/file.json', '.memorytree/full.json', 21])
    } finally {
      migrated.close()
    }
  })
})
