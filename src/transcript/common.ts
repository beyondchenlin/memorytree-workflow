/**
 * Shared constants, data-access helpers, text-extraction utilities, and dedup.
 * Port of scripts/_transcript_common.py
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

import type { TranscriptMessage, TranscriptToolEvent } from '../types/transcript.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CLIENTS: ReadonlySet<string> = new Set(['codex', 'claude', 'gemini'])
export const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set(['input_text', 'output_text', 'text'])
export const SKIP_BLOCK_TYPES: ReadonlySet<string> = new Set(['thinking', 'reasoning'])
export const TOOL_USE_TYPES: ReadonlySet<string> = new Set(['tool_use'])
export const TOOL_RESULT_TYPES: ReadonlySet<string> = new Set(['tool_result'])

// ---------------------------------------------------------------------------
// Generic utilities
// ---------------------------------------------------------------------------

export function slugify(value: string, fallback = 'session'): string {
  // eslint-disable-next-line no-control-regex
  const asciiValue = value.replace(/[^\x00-\x7F]/g, '').toLowerCase()
  const slug = asciiValue.replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '')
  return slug || fallback
}

export function sha256File(filePath: string): string {
  const data = readFileSync(filePath)
  return createHash('sha256').update(data).digest('hex')
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

export function normalizeTimestamp(value: unknown, fallback?: string | null): string {
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return formatUtcIso(d)
  }

  if (value instanceof Date) {
    return formatUtcIso(value)
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) {
      return fallback ?? normalizeTimestamp(new Date())
    }
    const parsed = parseIsoTimestamp(text)
    if (parsed !== null) {
      return formatUtcIso(parsed)
    }
    return text
  }

  return fallback ?? normalizeTimestamp(new Date())
}

export function earliestTimestamp(current: string, candidate: unknown): string {
  const normalized = normalizeTimestamp(candidate, current)
  const currentDt = parseIsoTimestamp(current)
  const normalizedDt = parseIsoTimestamp(normalized)
  if (currentDt !== null && normalizedDt !== null) {
    return normalizedDt < currentDt ? normalized : current
  }
  if (normalizedDt !== null) {
    return normalized
  }
  return current || normalized
}

export function parseIsoTimestamp(value: string): Date | null {
  if (!value) return null
  const candidate = value.endsWith('Z') ? value.slice(0, -1) + '+00:00' : value
  const d = new Date(candidate)
  if (isNaN(d.getTime())) return null
  return d
}

export function timestampPartition(timestamp: string): [string, string] {
  const d = parseIsoTimestamp(timestamp)
  if (d === null) return ['unknown', 'unknown']
  const year = d.getUTCFullYear().toString()
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  return [year, month]
}

export function joinParagraphs(parts: Iterable<string>): string {
  const cleaned: string[] = []
  for (const part of parts) {
    const trimmed = String(part).trim()
    if (trimmed) cleaned.push(trimmed)
  }
  return cleaned.join('\n\n')
}

export function summarizeValue(value: unknown, limit = 180): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim()
    return truncate(text, limit)
  }
  let text: string
  try {
    text = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort())
  } catch {
    text = String(value)
  }
  text = text.replace(/\s+/g, ' ').trim()
  return truncate(text, limit)
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 3) + '...'
}

export function yamlEscape(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return `"${escaped}"`
}

// ---------------------------------------------------------------------------
// Data access helpers
// ---------------------------------------------------------------------------

export function ensureDict(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function ensureList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function getNested(payload: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = payload
  for (const key of keys) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return null
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current ?? null
}

export function loadJsonl(filePath: string): Record<string, unknown>[] {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }
  const records: Record<string, unknown>[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed) as Record<string, unknown>)
    } catch {
      continue
    }
  }
  return records
}

export function loadJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const text = readFileSync(filePath, 'utf-8')
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

export function extractTextBlocks(blocks: unknown): string {
  const parts: string[] = []
  const skipTypes = new Set([...SKIP_BLOCK_TYPES, ...TOOL_USE_TYPES, ...TOOL_RESULT_TYPES])

  for (const block of ensureList(blocks)) {
    if (typeof block === 'string') {
      const text = block.trim()
      if (text) parts.push(text)
      continue
    }
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue

    const rec = block as Record<string, unknown>
    const blockType = String(rec['type'] ?? '').toLowerCase()
    if (skipTypes.has(blockType)) continue
    if (TEXT_BLOCK_TYPES.has(blockType)) {
      const text = String(rec['text'] ?? '').trim()
      if (text) parts.push(text)
      continue
    }
    const fallbackText = extractSimpleText(block)
    if (fallbackText) parts.push(fallbackText)
  }
  return joinParagraphs(parts)
}

export function extractSimpleText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return joinParagraphs(value.map(item => extractSimpleText(item)))
  }
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    for (const key of ['text', 'content', 'value']) {
      if (key in rec && typeof rec[key] === 'string') {
        return (rec[key] as string).trim()
      }
    }
    return ''
  }
  return ''
}

export function extractGeminiText(node: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of ['parts', 'content', 'text', 'message']) {
    parts.push(...extractGeminiParts(node[key]))
  }
  return joinParagraphs(parts)
}

export function extractGeminiParts(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      parts.push(...extractGeminiParts(item))
    }
    return parts
  }
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const blockType = String(rec['type'] ?? '').toLowerCase()
    const skipTypes = new Set([...SKIP_BLOCK_TYPES, ...TOOL_USE_TYPES, ...TOOL_RESULT_TYPES])
    if (skipTypes.has(blockType)) return []
    if ('text' in rec && typeof rec['text'] === 'string') {
      const text = (rec['text'] as string).trim()
      return text ? [text] : []
    }
    const parts: string[] = []
    for (const key of ['parts', 'content']) {
      if (key in rec) {
        parts.push(...extractGeminiParts(rec[key]))
      }
    }
    return parts
  }
  return []
}

export function findFirstMappingWithKeys(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>
    const recKeys = Object.keys(rec)
    if (recKeys.some(k => keys.has(k))) return rec
    for (const v of Object.values(rec)) {
      const result = findFirstMappingWithKeys(v, keys)
      if (result !== null) return result
    }
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findFirstMappingWithKeys(item, keys)
      if (result !== null) return result
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Deduplication helpers
// ---------------------------------------------------------------------------

export function deduplicateMessages(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
  const seen = new Set<string>()
  const result: TranscriptMessage[] = []
  for (const msg of messages) {
    const sig = `${msg.timestamp ?? ''}\0${msg.role}\0${contentHash(msg.text)}`
    if (!seen.has(sig)) {
      seen.add(sig)
      result.push(msg)
    }
  }
  return result
}

export function deduplicateToolEvents(events: readonly TranscriptToolEvent[]): TranscriptToolEvent[] {
  const seen = new Set<string>()
  const result: TranscriptToolEvent[] = []
  for (const evt of events) {
    const sig = `${evt.timestamp ?? ''}\0${contentHash(evt.summary)}`
    if (!seen.has(sig)) {
      seen.add(sig)
      result.push(evt)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatUtcIso(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hours = String(d.getUTCHours()).padStart(2, '0')
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')
  const seconds = String(d.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`
}
