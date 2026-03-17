/**
 * Link graph construction: detects [[session_id]] / [[stem]] references
 * in clean markdown content and builds forward/backlink maps.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { ManifestEntry } from '../../types/transcript.js'
import type { LinkGraph } from '../../types/report.js'

// ---------------------------------------------------------------------------
// Link graph builder
// ---------------------------------------------------------------------------

export function buildLinkGraph(manifests: ManifestEntry[], root: string): LinkGraph {
  const forwardLinks: Record<string, string[]> = {}
  const backlinks: Record<string, string[]> = {}

  // Build lookup table: various identifiers → canonical session_id
  const lookup: Record<string, string> = {}
  for (const m of manifests) {
    // Register by session_id
    lookup[m.session_id] = m.session_id
    // Register by artifact stem (e.g. "019cf4b1-....__0ebaa458")
    const cleanPath = m.repo_clean_path || m.global_clean_path
    if (cleanPath) {
      const stem = basename(cleanPath, '.md')
      if (stem) lookup[stem] = m.session_id
    }
  }

  for (const m of manifests) {
    const cleanPath = resolveCleanPath(m, root)
    if (!cleanPath || !existsSync(cleanPath)) continue

    let content: string
    try {
      content = readFileSync(cleanPath, 'utf-8')
    } catch {
      continue
    }

    const refs = extractLinks(content)
    for (const ref of refs) {
      const targetId = lookup[ref]
      if (!targetId || targetId === m.session_id) continue // skip self-refs

      // Forward: m → target (immutable update)
      const fwd = forwardLinks[m.session_id] ?? []
      if (!fwd.includes(targetId)) {
        forwardLinks[m.session_id] = [...fwd, targetId]
      }

      // Backlink: target ← m (immutable update)
      const back = backlinks[targetId] ?? []
      if (!back.includes(m.session_id)) {
        backlinks[targetId] = [...back, m.session_id]
      }
    }
  }

  return { backlinks, forwardLinks }
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

/** Extract all [[...]] references from text. */
export function extractLinks(content: string): string[] {
  const results: string[] = []
  const re = /\[\[([^\][\n]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const ref = match[1]?.trim()
    if (ref && ref.length > 0) {
      results.push(ref)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function resolveCleanPath(m: ManifestEntry, root: string): string | null {
  if (m.repo_clean_path) {
    return join(root, m.repo_clean_path)
  }
  if (m.global_clean_path) {
    return m.global_clean_path
  }
  return null
}
