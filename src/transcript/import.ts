/**
 * Transcript import — orchestration, cleaning, and manifest management.
 * Port of scripts/_transcript_import.py
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, extname, join, basename, relative } from 'node:path'

import type { ManifestEntry, ParsedTranscript } from '../types/transcript.js'
import { toPosixPath } from '../utils/path.js'
import {
  loadJson,
  normalizeTimestamp,
  sha256File,
  slugify,
  timestampPartition,
  yamlEscape,
} from './common.js'
import { upsertSearchIndex } from './db.js'

export async function importTranscript(
  parsed: ParsedTranscript,
  root: string,
  globalRoot: string,
  projectSlug: string,
  rawUploadPermission: string,
  mirrorToRepo = true,
): Promise<ManifestEntry> {
  const importedAt = normalizeTimestamp(new Date())
  const rawSha256 = sha256File(parsed.source_path)
  const sessionLabel = slugify(
    parsed.session_id,
    slugify(stemOf(parsed.source_path), 'session'),
  )
  const artifactStem = `${sessionLabel}__${rawSha256.slice(0, 8)}`
  const sourceSuffix = extname(parsed.source_path) || '.txt'

  const [yearToken, monthToken] = timestampPartition(parsed.started_at || importedAt)

  const repoRoot = join(root, 'Memory', '06_transcripts')
  const repoRawPath = join(repoRoot, 'raw', parsed.client, yearToken, monthToken, `${artifactStem}${sourceSuffix}`)
  const repoCleanPath = join(repoRoot, 'clean', parsed.client, yearToken, monthToken, `${artifactStem}.md`)
  const repoManifestPath = join(repoRoot, 'manifests', parsed.client, yearToken, monthToken, `${artifactStem}.json`)

  const globalRawPath = join(globalRoot, 'raw', parsed.client, projectSlug, yearToken, monthToken, `${artifactStem}${sourceSuffix}`)
  const globalCleanPath = join(globalRoot, 'clean', parsed.client, projectSlug, yearToken, monthToken, `${artifactStem}.md`)
  const globalManifestPath = join(globalRoot, 'index', 'manifests', parsed.client, projectSlug, yearToken, monthToken, `${artifactStem}.json`)
  const globalEventLogPath = join(globalRoot, 'index', 'sessions.jsonl')
  const globalDbPath = join(globalRoot, 'index', 'search.sqlite')

  for (const p of [globalRawPath, globalCleanPath, globalManifestPath, globalEventLogPath, globalDbPath]) {
    mkdirSync(dirname(p), { recursive: true })
  }
  if (mirrorToRepo) {
    for (const p of [repoRawPath, repoCleanPath, repoManifestPath]) {
      mkdirSync(dirname(p), { recursive: true })
    }
  }

  if (mirrorToRepo) {
    copyFile(parsed.source_path, repoRawPath)
  }
  copyFile(parsed.source_path, globalRawPath)

  let manifest: ManifestEntry = {
    client: parsed.client,
    project: projectSlug,
    session_id: parsed.session_id,
    title: parsed.title,
    started_at: parsed.started_at,
    imported_at: importedAt,
    cwd: parsed.cwd,
    branch: parsed.branch,
    raw_source_path: toPosixPath(parsed.source_path),
    raw_sha256: rawSha256,
    raw_upload_permission: rawUploadPermission,
    repo_raw_path: mirrorToRepo ? toPosixPath(relative(root, repoRawPath)) : '',
    repo_clean_path: mirrorToRepo ? toPosixPath(relative(root, repoCleanPath)) : '',
    repo_manifest_path: mirrorToRepo ? toPosixPath(relative(root, repoManifestPath)) : '',
    global_raw_path: toPosixPath(globalRawPath),
    global_clean_path: toPosixPath(globalCleanPath),
    global_manifest_path: toPosixPath(globalManifestPath),
    message_count: parsed.messages.length,
    tool_event_count: parsed.tool_events.length,
    cleaning_mode: 'deterministic-code',
    repo_mirror_enabled: mirrorToRepo,
  }

  const existingGlobalManifest = loadJson(globalManifestPath)
  manifest = preserveExistingImportTimestamp(existingGlobalManifest, manifest)

  if (mirrorToRepo) {
    writeCleanMarkdown(parsed, manifest, repoCleanPath)
  }
  writeCleanMarkdown(parsed, manifest, globalCleanPath)
  const manifestRecord = { ...manifest } as Record<string, unknown>
  if (mirrorToRepo) {
    writeJson(repoManifestPath, manifestRecord)
  }
  const appendToEventLog = existingGlobalManifest === null || !deepEqual(existingGlobalManifest, manifestRecord)
  writeJson(globalManifestPath, manifestRecord)
  if (appendToEventLog) {
    appendJsonl(globalEventLogPath, manifestRecord)
  }
  await upsertSearchIndex(globalDbPath, manifest)

  return manifest
}

export function transcriptHasContent(parsed: ParsedTranscript): boolean {
  return parsed.messages.length > 0 || parsed.tool_events.length > 0
}

export function writeCleanMarkdown(parsed: ParsedTranscript, manifest: ManifestEntry, filePath: string): void {
  const lines: string[] = [
    '---',
    `client: ${manifest.client}`,
    `project: ${manifest.project}`,
    `session_id: ${manifest.session_id}`,
    `title: ${yamlEscape(manifest.title)}`,
    `started_at: ${manifest.started_at}`,
    `imported_at: ${manifest.imported_at}`,
    `cwd: ${yamlEscape(manifest.cwd)}`,
    `branch: ${yamlEscape(manifest.branch)}`,
    `raw_source_path: ${yamlEscape(manifest.raw_source_path)}`,
    `raw_sha256: ${manifest.raw_sha256}`,
    `raw_upload_permission: ${manifest.raw_upload_permission}`,
    `cleaning_mode: ${manifest.cleaning_mode}`,
    '---',
    '',
    `# ${manifest.title || manifest.session_id}`,
    '',
    '## Metadata',
    `- Client: \`${manifest.client}\``,
    `- Project: \`${manifest.project}\``,
    `- Session ID: \`${manifest.session_id}\``,
    `- Started At: \`${manifest.started_at}\``,
    `- Imported At: \`${manifest.imported_at}\``,
    `- Raw SHA256: \`${manifest.raw_sha256}\``,
    `- Raw Source: \`${manifest.raw_source_path}\``,
    `- Repo Raw Path: \`${manifest.repo_raw_path}\``,
    `- Repo Clean Path: \`${manifest.repo_clean_path}\``,
    '',
    '## Messages',
  ]

  if (parsed.messages.length > 0) {
    for (let i = 0; i < parsed.messages.length; i++) {
      const message = parsed.messages[i]!
      lines.push(
        `### ${i + 1}. ${message.role}`,
        `- Timestamp: \`${message.timestamp ?? manifest.started_at}\``,
        '',
        message.text,
        '',
      )
    }
  } else {
    lines.push(
      'No user or assistant messages were extracted deterministically from the source transcript.',
      '',
    )
  }

  writeFileSync(filePath, lines.join('\n'), 'utf-8')
}

export function preserveExistingImportTimestamp(
  existing: Record<string, unknown> | null,
  payload: ManifestEntry,
): ManifestEntry {
  if (existing === null) return payload
  const payloadRecord = { ...payload } as Record<string, unknown>
  if (!deepEqual(manifestSignature(existing), manifestSignature(payloadRecord))) return payload
  const importedAt = existing['imported_at']
  if (typeof importedAt === 'string' && importedAt) {
    return { ...payload, imported_at: importedAt }
  }
  return payload
}

export function manifestSignature(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'imported_at') {
      result[key] = value
    }
  }
  return result
}

export function manifestChanged(filePath: string, payload: Record<string, unknown>): boolean {
  if (!existsSync(filePath)) return true
  try {
    const current = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
    return !deepEqual(current, payload)
  } catch {
    return true
  }
}

export function writeJson(filePath: string, payload: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

export function appendJsonl(filePath: string, payload: Record<string, unknown>): void {
  appendFileSync(filePath, JSON.stringify(payload) + '\n', 'utf-8')
}

export function copyFile(source: string, destination: string): void {
  if (source === destination) return
  copyFileSync(source, destination)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stemOf(filePath: string): string {
  const base = basename(filePath)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]))
}
