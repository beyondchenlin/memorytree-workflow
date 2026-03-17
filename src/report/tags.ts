/**
 * AI tag extraction with SHA256-based caching.
 * Extracts 3–5 keyword tags from a session summary using Claude.
 * Falls back to [] when noAi=true, API key absent, or any error occurs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { escHtml } from './render/layout.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagOptions {
  cacheDir: string
  noAi: boolean
  model: string
}

interface TagCache {
  sha256: string
  tags: string[]
  generated_at: string
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getTags(
  sha256: string,
  summary: string,
  options: TagOptions,
): Promise<string[]> {
  // noAi mode: skip entirely
  if (options.noAi) return []

  // No summary → nothing to tag
  if (!summary.trim()) return []

  // Check cache first
  const cached = readTagCache(sha256, options.cacheDir)
  if (cached !== null) return cached

  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return []

  return callTagApi(sha256, summary, options)
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function callTagApi(
  sha256: string,
  summary: string,
  options: TagOptions,
): Promise<string[]> {
  try {
    const { default: Anthropic } = await (import('@anthropic-ai/sdk') as Promise<{ default: typeof import('@anthropic-ai/sdk').default }>)

    const client = new Anthropic()
    const response = await client.messages.create({
      model: options.model,
      max_tokens: 60,
      system: 'You are a tag extractor. Respond with a JSON array only — no prose, no markdown.',
      messages: [
        {
          role: 'user',
          content: `Extract 3-5 short keyword tags from this session summary. Respond with JSON array only: ["tag1","tag2"]\n\n${summary.slice(0, 500)}`,
        },
      ],
    })

    const block = response.content[0]
    const text = block && block.type === 'text' ? block.text.trim() : ''
    if (!text) return []

    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []

    const tags = parsed
      .filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 50)
      .slice(0, 5)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0)

    if (tags.length > 0) {
      writeTagCache(sha256, tags, options.cacheDir)
    }
    return tags
  } catch {
    // Never crash — API errors, JSON parse errors, missing SDK
    return []
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Render tags as pill badges. Returns '' for empty array. */
export function renderTagBadges(tags: string[]): string {
  if (tags.length === 0) return ''
  const pills = tags
    .map(t => `<span class="tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`)
    .join('')
  return `<div class="tag-list">${pills}</div>`
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readTagCache(sha256: string, cacheDir: string): string[] | null {
  const path = tagCachePath(sha256, cacheDir)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const entry = JSON.parse(raw) as TagCache
    return Array.isArray(entry.tags) ? entry.tags : null
  } catch {
    return null
  }
}

function writeTagCache(sha256: string, tags: string[], cacheDir: string): void {
  try {
    const tagsDir = join(cacheDir, 'tags')
    mkdirSync(tagsDir, { recursive: true })
    const entry: TagCache = { sha256, tags, generated_at: new Date().toISOString() }
    writeFileSync(tagCachePath(sha256, cacheDir), JSON.stringify(entry, null, 2) + '\n', 'utf-8')
  } catch {
    // Best-effort
  }
}

function tagCachePath(sha256: string, cacheDir: string): string {
  return join(cacheDir, 'tags', `${sha256}.json`)
}
