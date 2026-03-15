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
  'repo_raw_path',
  'repo_clean_path',
  'repo_manifest_path',
  'message_count',
  'tool_event_count',
] as const

const ALL_COLUMNS = [...PK_COLUMNS, ...DATA_COLUMNS] as const

// ---------------------------------------------------------------------------
// SQL statements (built once)
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS transcripts (
    client              TEXT    NOT NULL,
    project             TEXT    NOT NULL,
    session_id          TEXT    NOT NULL,
    raw_sha256          TEXT    NOT NULL,
    title               TEXT    NOT NULL,
    started_at          TEXT    NOT NULL,
    imported_at         TEXT    NOT NULL,
    cwd                 TEXT    NOT NULL,
    branch              TEXT    NOT NULL,
    raw_source_path     TEXT    NOT NULL,
    raw_upload_permission TEXT  NOT NULL,
    global_raw_path     TEXT    NOT NULL,
    global_clean_path   TEXT    NOT NULL,
    repo_raw_path       TEXT    NOT NULL,
    repo_clean_path     TEXT    NOT NULL,
    repo_manifest_path  TEXT    NOT NULL,
    message_count       INTEGER NOT NULL,
    tool_event_count    INTEGER NOT NULL,
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
    db.run(CREATE_TABLE_SQL)

    const record: Record<string, unknown> = { ...manifest }
    const params = ALL_COLUMNS.map((col) => {
      const value = record[col]
      if (value === undefined || value === null) {
        return ''
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
