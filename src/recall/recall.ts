/**
 * Recall — on-demand transcript sync + latest session lookup.
 * Port of scripts/recall-session.py
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve, join } from 'node:path'

import initSqlJs from 'sql.js'

import { slugify } from '../transcript/common.js'
import { defaultGlobalTranscriptRoot, discoverSourceFiles, transcriptMatchesRepo } from '../transcript/discover.js'
import { importTranscript, transcriptHasContent } from '../transcript/import.js'
import { parseTranscript } from '../transcript/parse.js'
import { toPosixPath } from '../utils/path.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecallResult {
  found: boolean
  project: string
  repo: string
  imported_count: number
  message?: string
  client?: string
  session_id?: string
  title?: string
  started_at?: string
  cwd?: string
  branch?: string
  message_count?: number
  tool_event_count?: number
  global_clean_path?: string
  clean_content?: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function recall(
  root: string,
  projectName: string,
  globalRootOverride: string,
  activationTime: string,
): Promise<RecallResult> {
  const resolvedRoot = resolve(root)
  const repoSlug = slugify(projectName.trim() || basename(resolvedRoot), 'project')
  const globalRoot = globalRootOverride ? resolve(globalRootOverride) : defaultGlobalTranscriptRoot()
  const effectiveActivation = activationTime || nowIso()

  const imported = await syncCurrentProject(resolvedRoot, repoSlug, globalRoot)

  const session = await findLatestSession(globalRoot, resolvedRoot, repoSlug, effectiveActivation)

  if (session === null) {
    return {
      found: false,
      project: repoSlug,
      repo: toPosixPath(resolvedRoot),
      imported_count: imported,
      message: 'No previous session found for this project.',
    }
  }

  const cleanPath = String(session['global_clean_path'] ?? '')
  let cleanContent = ''
  if (cleanPath && existsSync(cleanPath)) {
    try {
      cleanContent = readFileSync(cleanPath, 'utf-8')
    } catch {
      // ignore read errors
    }
  }

  return {
    found: true,
    project: repoSlug,
    repo: toPosixPath(resolvedRoot),
    imported_count: imported,
    client: String(session['client'] ?? ''),
    session_id: String(session['session_id'] ?? ''),
    title: String(session['title'] ?? ''),
    started_at: String(session['started_at'] ?? ''),
    cwd: String(session['cwd'] ?? ''),
    branch: String(session['branch'] ?? ''),
    message_count: Number(session['message_count'] ?? 0),
    tool_event_count: Number(session['tool_event_count'] ?? 0),
    global_clean_path: cleanPath,
    clean_content: cleanContent,
  }
}

// ---------------------------------------------------------------------------
// Sync current project
// ---------------------------------------------------------------------------

export async function syncCurrentProject(root: string, repoSlug: string, globalRoot: string): Promise<number> {
  const discovered = discoverSourceFiles()
  let imported = 0

  for (const [client, source] of discovered) {
    let parsed
    try {
      parsed = parseTranscript(client, source)
    } catch {
      continue
    }

    if (!transcriptHasContent(parsed)) continue
    if (!transcriptMatchesRepo(parsed, root, repoSlug)) continue

    try {
      await importTranscript(parsed, root, globalRoot, repoSlug, 'not-set', true)
      imported++
    } catch {
      continue
    }
  }

  return imported
}

// ---------------------------------------------------------------------------
// Find latest session
// ---------------------------------------------------------------------------

export async function findLatestSession(
  globalRoot: string,
  root: string,
  repoSlug: string,
  activationTime: string,
): Promise<Record<string, unknown> | null> {
  const dbPath = join(globalRoot, 'index', 'search.sqlite')
  if (!existsSync(dbPath)) {
    return findLatestFromJsonl(globalRoot, root, repoSlug, activationTime)
  }

  try {
    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      const stmt = db.prepare(
        'SELECT * FROM transcripts WHERE started_at < ? ORDER BY started_at DESC LIMIT 20',
      )
      stmt.bind([activationTime])

      const resolvedRoot = toPosixPath(resolve(root)).toLowerCase()
      const columns = stmt.getColumnNames()

      while (stmt.step()) {
        const values = stmt.get()
        const row: Record<string, unknown> = {}
        for (let i = 0; i < columns.length; i++) {
          row[columns[i]!] = values[i]
        }
        const cwd = String(row['cwd'] ?? '')
        const project = String(row['project'] ?? '')
        if (cwdMatches(cwd, resolvedRoot) || project === repoSlug) {
          stmt.free()
          return row
        }
      }
      stmt.free()
    } finally {
      db.close()
    }
  } catch {
    return findLatestFromJsonl(globalRoot, root, repoSlug, activationTime)
  }

  return null
}

// ---------------------------------------------------------------------------
// JSONL fallback
// ---------------------------------------------------------------------------

export function findLatestFromJsonl(
  globalRoot: string,
  root: string,
  repoSlug: string,
  activationTime: string,
): Record<string, unknown> | null {
  const jsonlPath = join(globalRoot, 'index', 'sessions.jsonl')
  if (!existsSync(jsonlPath)) return null

  const resolvedRoot = toPosixPath(resolve(root)).toLowerCase()
  const candidates: Record<string, unknown>[] = []

  let content: string
  try {
    content = readFileSync(jsonlPath, 'utf-8')
  } catch {
    return null
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    const started = String(entry['started_at'] ?? '')
    if (started >= activationTime) continue

    const cwd = String(entry['cwd'] ?? '')
    const project = String(entry['project'] ?? '')
    if (cwdMatches(cwd, resolvedRoot) || project === repoSlug) {
      candidates.push(entry)
    }
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const aTime = String(a['started_at'] ?? '')
    const bTime = String(b['started_at'] ?? '')
    return bTime.localeCompare(aTime)
  })
  return candidates[0]!
}

// ---------------------------------------------------------------------------
// CWD matching
// ---------------------------------------------------------------------------

export function cwdMatches(cwd: string, resolvedRoot: string): boolean {
  if (!cwd) return false
  try {
    const cwdResolved = toPosixPath(resolve(cwd)).toLowerCase()
    if (cwdResolved === resolvedRoot) return true
    const prefix = resolvedRoot.endsWith('/') ? resolvedRoot : resolvedRoot + '/'
    return cwdResolved.startsWith(prefix)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function formatText(payload: RecallResult): string {
  if (!payload.found) {
    return [
      `project: ${payload.project}`,
      `imported: ${payload.imported_count}`,
      `result: ${payload.message ?? 'No previous session found.'}`,
    ].join('\n')
  }

  const lines = [
    `project: ${payload.project}`,
    `client: ${payload.client ?? ''}`,
    `session_id: ${payload.session_id ?? ''}`,
    `title: ${payload.title ?? ''}`,
    `started_at: ${payload.started_at ?? ''}`,
    `cwd: ${payload.cwd ?? ''}`,
    `branch: ${payload.branch ?? ''}`,
    `messages: ${payload.message_count ?? 0}`,
    `tool_events: ${payload.tool_event_count ?? 0}`,
    `imported_this_sync: ${payload.imported_count}`,
    `clean_transcript: ${payload.global_clean_path ?? ''}`,
  ]

  if (payload.clean_content) {
    lines.push('', '--- clean transcript content ---', payload.clean_content)
  }

  return lines.join('\n')
}
