/**
 * AI summary generation with SHA256-based caching.
 * Falls back gracefully when API key is absent or SDK is missing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SummaryCache } from '../types/report.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SummaryMessage {
  role: string
  text: string
}

export interface SummaryOptions {
  cacheDir: string
  noAi: boolean
  model: string
}

// ---------------------------------------------------------------------------
// Semaphore (max 5 concurrent AI calls)
// ---------------------------------------------------------------------------

let activeCalls = 0
const MAX_CONCURRENT = 5

async function withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  while (activeCalls >= MAX_CONCURRENT) {
    await new Promise<void>(resolve => setTimeout(resolve, 100))
  }
  activeCalls++
  try {
    return await fn()
  } finally {
    activeCalls--
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getSummary(
  sha256: string,
  messages: SummaryMessage[],
  options: SummaryOptions,
): Promise<string> {
  // Check cache
  const cached = readCache(sha256, options.cacheDir)
  if (cached !== null) {
    return cached
  }

  if (options.noAi) return ''

  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return ''

  return withSemaphore(() => callApi(sha256, messages, options))
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function callApi(
  sha256: string,
  messages: SummaryMessage[],
  options: SummaryOptions,
): Promise<string> {
  try {
    // Dynamic import so the build never fails if @anthropic-ai/sdk is absent
    const { default: Anthropic } = await (import('@anthropic-ai/sdk') as Promise<{ default: typeof import('@anthropic-ai/sdk').default }>)

    const client = new Anthropic()
    const prompt = buildSummaryPrompt(messages)

    const response = await client.messages.create({
      model: options.model,
      max_tokens: 200,
      system:
        'Summarize in 2-3 sentences. What was accomplished? What problems were solved? Be specific. Use past tense.',
      messages: [{ role: 'user', content: prompt }],
    })

    const block = response.content[0]
    const text = block && block.type === 'text' ? block.text : ''
    if (text) {
      writeCache(sha256, text, options.cacheDir)
    }
    return text
  } catch (err: unknown) {
    // MODULE_NOT_FOUND or any API error — never crash the build
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'MODULE_NOT_FOUND') {
      console.warn(`[summarize] API call failed: ${String(err)}`)
    }
    return ''
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** First 30 messages, each truncated to 500 chars. */
export function buildSummaryPrompt(messages: SummaryMessage[]): string {
  const slice = messages.slice(0, 30)
  const lines = slice.map(m => {
    const text = m.text.slice(0, 500)
    return `${m.role.toUpperCase()}: ${text}`
  })
  return lines.join('\n\n')
}

// ---------------------------------------------------------------------------
// Cache read / write
// ---------------------------------------------------------------------------

export function readCache(sha256: string, cacheDir: string): string | null {
  const path = cachePath(sha256, cacheDir)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const entry = JSON.parse(raw) as SummaryCache
    return entry.summary ?? null
  } catch {
    return null
  }
}

export function writeCache(sha256: string, summary: string, cacheDir: string): void {
  try {
    mkdirSync(cacheDir, { recursive: true })
    const entry: SummaryCache = {
      sha256,
      summary,
      generated_at: new Date().toISOString(),
    }
    writeFileSync(cachePath(sha256, cacheDir), JSON.stringify(entry, null, 2) + '\n', 'utf-8')
  } catch {
    // Never crash on cache write failure
  }
}

function cachePath(sha256: string, cacheDir: string): string {
  return join(cacheDir, `${sha256}.json`)
}
