/**
 * Transcript discovery — file scanning and project matching.
 * Port of scripts/_transcript_discover.py
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

import fg from 'fast-glob'

import type { ParsedTranscript } from '../types/transcript.js'
import { slugify, CLIENTS } from './common.js'
import { toPosixPath } from '../utils/path.js'

// ---------------------------------------------------------------------------
// Glob patterns per client
// ---------------------------------------------------------------------------

const CLIENT_PATTERNS: Readonly<Record<string, readonly string[]>> = {
  codex: ['sessions/**/*.jsonl'],
  claude: ['projects/**/*.jsonl'],
  gemini: [
    'tmp/*/checkpoints/**/*.json',
    'tmp/*/checkpoints/**/*.jsonl',
    'history/**/*.json',
    'history/**/*.jsonl',
    'chats/**/*.json',
    'chats/**/*.jsonl',
  ],
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultGlobalTranscriptRoot(): string {
  return toPosixPath(resolve(homedir(), '.memorytree', 'transcripts'))
}

export function defaultClientRoots(): Record<string, string> {
  const home = homedir()
  return {
    codex: resolve(home, '.codex'),
    claude: resolve(home, '.claude'),
    gemini: resolve(home, '.gemini'),
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

export function discoverSourceFiles(
  clients?: ReadonlySet<string>,
  roots?: Readonly<Record<string, string>>,
): Array<[string, string]> {
  const requested = clients ?? CLIENTS
  const resolvedRoots = roots ?? defaultClientRoots()
  const matches: Array<[string, string]> = []
  const seen = new Set<string>()

  for (const client of [...requested].sort()) {
    const root: string | undefined = resolvedRoots[client]
    if (root === undefined || !existsSync(root)) continue

    const patterns = CLIENT_PATTERNS[client]
    if (patterns === undefined) continue

    for (const pattern of patterns) {
      const paths = fg.sync(pattern, { cwd: root, absolute: true, onlyFiles: true })
      for (const filePath of paths) {
        const resolved = toPosixPath(resolve(filePath))
        const key = resolved.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        matches.push([client, resolved])
      }
    }
  }

  matches.sort((a, b) => {
    const mtimeA = safeFileMtime(a[1])
    const mtimeB = safeFileMtime(b[1])
    if (mtimeB !== mtimeA) return mtimeB - mtimeA
    const pathA = a[1].toLowerCase()
    const pathB = b[1].toLowerCase()
    // Reverse sort: higher path string comes first (matching Python's reverse=True)
    if (pathB > pathA) return 1
    if (pathB < pathA) return -1
    return 0
  })

  return matches
}

// ---------------------------------------------------------------------------
// Project slug inference
// ---------------------------------------------------------------------------

export function inferProjectSlug(parsed: ParsedTranscript): string {
  if (parsed.cwd) {
    try {
      const cwdBase = basename(parsed.cwd)
      return slugify(cwdBase, 'project')
    } catch {
      // fall through
    }
  }

  if (parsed.client === 'claude') {
    let parentName = basename(dirname(parsed.source_path)).toLowerCase()
    parentName = parentName.replace(/^[a-z]--/, '')
    return slugify(parentName, 'project')
  }

  if (parsed.client === 'gemini') {
    const parentDir = basename(dirname(parsed.source_path))
    if (parentDir) {
      return slugify(parentDir, 'project')
    }
  }

  return 'unknown-project'
}

// ---------------------------------------------------------------------------
// Repo matching
// ---------------------------------------------------------------------------

export function transcriptMatchesRepo(
  parsed: ParsedTranscript,
  repoRoot: string,
  repoSlug: string,
): boolean {
  const normalizedRepo = toPosixPath(resolve(repoRoot)).toLowerCase()

  if (parsed.cwd) {
    try {
      const normalizedCwd = toPosixPath(resolve(parsed.cwd)).toLowerCase()
      if (normalizedCwd === normalizedRepo) return true
      // Check if repoRoot is a parent of cwd
      const repoPrefix = normalizedRepo.endsWith('/')
        ? normalizedRepo
        : normalizedRepo + '/'
      if (normalizedCwd.startsWith(repoPrefix)) return true
    } catch {
      // fall through
    }
  }

  return projectSlugsMatch(inferProjectSlug(parsed), repoSlug)
}

// ---------------------------------------------------------------------------
// Slug matching
// ---------------------------------------------------------------------------

export function projectSlugsMatch(left: string, right: string): boolean {
  return Boolean(
    left && right && left === right && left !== 'unknown-project',
  )
}

// ---------------------------------------------------------------------------
// Safe mtime
// ---------------------------------------------------------------------------

export function safeFileMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs / 1000
  } catch {
    return 0
  }
}
