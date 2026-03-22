/**
 * Transcript search index — SQLite upsert for the global transcript catalog.
 *
 * Uses sql.js (WebAssembly SQLite) so the module works without a native
 * sqlite3 binding.  The WASM init is async; we cache the resulting factory
 * promise so it is only resolved once per process.
 */

import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ManifestEntry } from '../types/transcript.js'

// ---------------------------------------------------------------------------
// Lazy sql.js initialisation (cached promise)
// ---------------------------------------------------------------------------

let sqlPromise: Promise<SqlJsStatic> | null = null

function getSqlJs(): Promise<SqlJsStatic> {
  if (sqlPromise === null) {
    sqlPromise = initSqlJs()
  }
  return sqlPromise
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const PK_COLUMNS = [
  'client',
  'project',
  'session_id',
  'raw_sha256',
] as const

const DATA_COLUMNS = [
  'title',
  'started_at',
  'imported_at',
  'cwd',
  'branch',
  'raw_source_path',
  'raw_upload_permission',
  'global_raw_path',
  'global_clean_path',
  'global_manifest_path',
  'global_full_path',
  'repo_raw_path',
  'repo_clean_path',
  'repo_manifest_path',
  'repo_full_path',
  'message_count',
  'tool_event_count',
  'event_count',
] as const

const ALL_COLUMNS = [...PK_COLUMNS, ...DATA_COLUMNS] as const
type ColumnName = (typeof ALL_COLUMNS)[number]

const COLUMN_DEFS: Record<ColumnName, { type: 'TEXT' | 'INTEGER'; defaultValue: string }> = {
  client: { type: 'TEXT', defaultValue: "''" },
  project: { type: 'TEXT', defaultValue: "''" },
  session_id: { type: 'TEXT', defaultValue: "''" },
  raw_sha256: { type: 'TEXT', defaultValue: "''" },
  title: { type: 'TEXT', defaultValue: "''" },
  started_at: { type: 'TEXT', defaultValue: "''" },
  imported_at: { type: 'TEXT', defaultValue: "''" },
  cwd: { type: 'TEXT', defaultValue: "''" },
  branch: { type: 'TEXT', defaultValue: "''" },
  raw_source_path: { type: 'TEXT', defaultValue: "''" },
  raw_upload_permission: { type: 'TEXT', defaultValue: "''" },
  global_raw_path: { type: 'TEXT', defaultValue: "''" },
  global_clean_path: { type: 'TEXT', defaultValue: "''" },
  global_manifest_path: { type: 'TEXT', defaultValue: "''" },
  global_full_path: { type: 'TEXT', defaultValue: "''" },
  repo_raw_path: { type: 'TEXT', defaultValue: "''" },
  repo_clean_path: { type: 'TEXT', defaultValue: "''" },
  repo_manifest_path: { type: 'TEXT', defaultValue: "''" },
  repo_full_path: { type: 'TEXT', defaultValue: "''" },
  message_count: { type: 'INTEGER', defaultValue: '0' },
  tool_event_count: { type: 'INTEGER', defaultValue: '0' },
  event_count: { type: 'INTEGER', defaultValue: '0' },
}

// ---------------------------------------------------------------------------
// SQL statements (built once)
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS transcripts (
    ${ALL_COLUMNS.map((column) => columnDefinition(column)).join(',\n    ')},
    PRIMARY KEY (client, project, session_id, raw_sha256)
  )
`

const UPSERT_SQL = `
  INSERT INTO transcripts (
    ${ALL_COLUMNS.join(', ')}
  ) VALUES (${ALL_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT(${PK_COLUMNS.join(', ')}) DO UPDATE SET
    ${DATA_COLUMNS.map((c) => `${c} = excluded.${c}`).join(',\n    ')}
`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Insert or update a single transcript manifest row in the SQLite search
 * index at `dbPath`.  Creates the database and table if they do not exist.
 *
 * The function is async because the first call must initialise the sql.js
 * WASM module.
 */
export async function upsertSearchIndex(
  dbPath: string,
  manifest: ManifestEntry,
): Promise<void> {
  const SQL = await getSqlJs()

  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database()

  try {
    db.run('PRAGMA journal_mode=WAL')
    ensureTableSchema(db)

    const record: Record<string, unknown> = { ...manifest }
    const params = ALL_COLUMNS.map((col) => {
      const value = record[col]
      if (value === undefined || value === null) {
        return COLUMN_DEFS[col].type === 'INTEGER' ? 0 : ''
      }
      return typeof value === 'number' ? value : String(value)
    })

    db.run(UPSERT_SQL, params)

    const data = db.export()
    writeFileSync(dbPath, Buffer.from(data))
  } finally {
    db.close()
  }
}

function columnDefinition(column: ColumnName, includeDefault = false): string {
  const def = COLUMN_DEFS[column]
  return `${column} ${def.type} NOT NULL${includeDefault ? ` DEFAULT ${def.defaultValue}` : ''}`
}

function ensureTableSchema(db: {
  run: (sql: string) => unknown
  exec: (sql: string) => Array<{ values: unknown[][] }>
}): void {
  db.run(CREATE_TABLE_SQL)

  const info = db.exec('PRAGMA table_info(transcripts)')
  const existing = new Set(
    info[0]?.values.map((row) => String(row[1] ?? '')) ?? [],
  )

  for (const column of DATA_COLUMNS) {
    if (!existing.has(column)) {
      db.run(`ALTER TABLE transcripts ADD COLUMN ${columnDefinition(column, true)}`)
    }
  }
}
