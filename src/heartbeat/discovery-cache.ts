import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  inferProjectSlug,
  projectSlugsMatch,
} from '../transcript/discover.js'
import { sha256File } from '../transcript/common.js'
import { transcriptHasContent } from '../transcript/import.js'
import { parseTranscript } from '../transcript/parse.js'
import type { ParsedTranscript } from '../types/transcript.js'
import { toPosixPath } from '../utils/path.js'

export interface HeartbeatDiscoveredSource {
  readonly client: string
  readonly sourcePath: string
  readonly sourceKey: string
  readonly size: number
  readonly mtimeMs: number
  readonly contentSha256: string
  parseStatus: 'ok' | 'error'
  hasContent: boolean
  cwd: string
  inferredProjectSlug: string
  readonly importedProjectKeys: Set<string>
  parsed: ParsedTranscript | null
  readonly cacheHit: boolean
}

interface DiscoveryCacheEntry {
  client: string
  source_path: string
  size: number
  mtime_ms: number
  content_sha256: string
  parse_status: 'ok' | 'error'
  has_content: boolean
  cwd: string
  inferred_project_slug: string
  imported_project_keys: string[]
}

interface DiscoveryCacheDocument {
  version: 2
  entries: Record<string, DiscoveryCacheEntry>
}

export interface HeartbeatDiscoveryCatalog {
  readonly globalRoot: string
  readonly entries: HeartbeatDiscoveredSource[]
  readonly previousEntries: Record<string, DiscoveryCacheEntry>
}

export function prepareHeartbeatDiscoveryCatalog(
  globalRoot: string,
  discoveredFiles: Array<[string, string]>,
): HeartbeatDiscoveryCatalog {
  const previousEntries = loadDiscoveryCache(globalRoot)
  const entries = discoveredFiles.map(([client, sourcePath]) => {
    const normalizedSourcePath = toPosixPath(resolve(sourcePath))
    const sourceKey = normalizedSourcePath.toLowerCase()
    const fingerprint = safeSourceFingerprint(normalizedSourcePath)
    const cached = previousEntries[sourceKey]

    if (
      cached &&
      cached.client === client &&
      cached.parse_status === 'ok' &&
      cached.content_sha256 === fingerprint.contentSha256
    ) {
      return {
        client,
        sourcePath: normalizedSourcePath,
        sourceKey,
        size: fingerprint.size,
        mtimeMs: fingerprint.mtimeMs,
        contentSha256: fingerprint.contentSha256,
        parseStatus: cached.parse_status,
        hasContent: cached.has_content,
        cwd: cached.cwd,
        inferredProjectSlug: cached.inferred_project_slug,
        importedProjectKeys: new Set(cached.imported_project_keys),
        parsed: null,
        cacheHit: true,
      } satisfies HeartbeatDiscoveredSource
    }

    const candidate = parseDiscoveredSource(client, normalizedSourcePath)
    return {
      ...candidate,
      sourceKey,
      size: fingerprint.size,
      mtimeMs: fingerprint.mtimeMs,
      contentSha256: fingerprint.contentSha256,
      importedProjectKeys: new Set<string>(),
      cacheHit: false,
    } satisfies HeartbeatDiscoveredSource
  })

  return {
    globalRoot,
    entries,
    previousEntries,
  }
}

export function saveHeartbeatDiscoveryCatalog(catalog: HeartbeatDiscoveryCatalog): void {
  const nextEntries = { ...catalog.previousEntries }

  for (const entry of catalog.entries) {
    if (entry.parseStatus !== 'ok') {
      delete nextEntries[entry.sourceKey]
      continue
    }

    nextEntries[entry.sourceKey] = {
      client: entry.client,
      source_path: entry.sourcePath,
      size: entry.size,
      mtime_ms: entry.mtimeMs,
      content_sha256: entry.contentSha256,
      parse_status: entry.parseStatus,
      has_content: entry.hasContent,
      cwd: entry.cwd,
      inferred_project_slug: entry.inferredProjectSlug,
      imported_project_keys: [...entry.importedProjectKeys].sort(),
    }
  }

  const cachePath = discoveryCachePath(catalog.globalRoot)
  mkdirSync(dirname(cachePath), { recursive: true })
  const payload: DiscoveryCacheDocument = {
    version: 2,
    entries: nextEntries,
  }
  writeFileSync(cachePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

export function sourceMatchesProject(
  source: Pick<HeartbeatDiscoveredSource, 'cwd' | 'inferredProjectSlug'>,
  repoRoot: string,
  repoSlug: string,
): boolean {
  const normalizedRepo = toPosixPath(resolve(repoRoot)).toLowerCase()

  if (source.cwd) {
    try {
      const normalizedCwd = toPosixPath(resolve(source.cwd)).toLowerCase()
      if (normalizedCwd === normalizedRepo) return true
      const repoPrefix = normalizedRepo.endsWith('/')
        ? normalizedRepo
        : normalizedRepo + '/'
      if (normalizedCwd.startsWith(repoPrefix)) return true
    } catch {
      // Fall through to slug matching.
    }
  }

  return projectSlugsMatch(source.inferredProjectSlug, repoSlug)
}

export function ensureParsedDiscoveredSource(source: HeartbeatDiscoveredSource): ParsedTranscript | null {
  if (source.parsed !== null) {
    return source.parsed
  }
  if (source.parseStatus === 'error') {
    return null
  }

  const parsed = parseDiscoveredSource(source.client, source.sourcePath)
  source.parsed = parsed.parsed
  source.parseStatus = parsed.parseStatus
  source.hasContent = parsed.hasContent
  source.cwd = parsed.cwd
  source.inferredProjectSlug = parsed.inferredProjectSlug
  return source.parsed
}

function loadDiscoveryCache(globalRoot: string): Record<string, DiscoveryCacheEntry> {
  const cachePath = discoveryCachePath(globalRoot)
  if (!existsSync(cachePath)) {
    return {}
  }

  try {
    const raw = JSON.parse(readFileSync(cachePath, 'utf-8')) as Partial<DiscoveryCacheDocument>
    if (raw.version !== 2 || raw.entries === undefined || raw.entries === null || typeof raw.entries !== 'object') {
      return {}
    }

    const entries: Record<string, DiscoveryCacheEntry> = {}
    for (const [key, value] of Object.entries(raw.entries)) {
      if (!isDiscoveryCacheEntry(value)) continue
      entries[key] = value
    }
    return entries
  } catch {
    return {}
  }
}

function discoveryCachePath(globalRoot: string): string {
  return join(globalRoot, 'index', 'discovery-cache.json')
}

function parseDiscoveredSource(
  client: string,
  sourcePath: string,
): Omit<HeartbeatDiscoveredSource, 'sourceKey' | 'size' | 'mtimeMs' | 'contentSha256' | 'importedProjectKeys' | 'cacheHit'> {
  try {
    const parsed = parseTranscript(client, sourcePath)
    return {
      client,
      sourcePath,
      parseStatus: 'ok',
      hasContent: transcriptHasContent(parsed),
      cwd: parsed.cwd,
      inferredProjectSlug: inferProjectSlug(parsed),
      parsed,
    }
  } catch {
    return {
      client,
      sourcePath,
      parseStatus: 'error',
      hasContent: false,
      cwd: '',
      inferredProjectSlug: 'unknown-project',
      parsed: null,
    }
  }
}

function safeSourceFingerprint(sourcePath: string): { size: number; mtimeMs: number; contentSha256: string } {
  try {
    const stats = statSync(sourcePath)
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      contentSha256: sha256File(sourcePath),
    }
  } catch {
    return {
      size: 0,
      mtimeMs: 0,
      contentSha256: '',
    }
  }
}

function isDiscoveryCacheEntry(value: unknown): value is DiscoveryCacheEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record['client'] === 'string'
    && typeof record['source_path'] === 'string'
    && typeof record['size'] === 'number'
    && typeof record['mtime_ms'] === 'number'
    && typeof record['content_sha256'] === 'string'
    && (record['parse_status'] === 'ok' || record['parse_status'] === 'error')
    && typeof record['has_content'] === 'boolean'
    && typeof record['cwd'] === 'string'
    && typeof record['inferred_project_slug'] === 'string'
    && Array.isArray(record['imported_project_keys'])
    && record['imported_project_keys'].every(item => typeof item === 'string')
}
