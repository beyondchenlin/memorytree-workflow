/**
 * Transcript parsing — client inference, dispatch, and format-specific parsers.
 * Port of scripts/_transcript_parse.py
 */

import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

import type { Client, ParsedTranscript, TranscriptMessage, TranscriptToolEvent } from '../types/transcript.js'
import { toPosixPath } from '../utils/path.js'
import {
  SKIP_BLOCK_TYPES,
  TEXT_BLOCK_TYPES,
  TOOL_RESULT_TYPES,
  TOOL_USE_TYPES,
  deduplicateMessages,
  deduplicateToolEvents,
  earliestTimestamp,
  ensureDict,
  ensureList,
  extractGeminiText,
  extractTextBlocks,
  findFirstMappingWithKeys,
  getNested,
  joinParagraphs,
  loadJsonl,
  normalizeTimestamp,
  summarizeValue,
} from './common.js'

// ---------------------------------------------------------------------------
// Client inference + dispatch
// ---------------------------------------------------------------------------

export function inferClient(client: string, sourcePath: string): Client {
  if (client !== 'auto') {
    return client as Client
  }
  const normalized = toPosixPath(sourcePath).toLowerCase()
  const fileName = basename(sourcePath).toLowerCase()
  if (normalized.includes('/.codex/') || fileName.startsWith('rollout-')) {
    return 'codex'
  }
  if (normalized.includes('/.claude/') || normalized.includes('/projects/')) {
    return 'claude'
  }
  if (normalized.includes('/.gemini/') || normalized.includes('checkpoint')) {
    return 'gemini'
  }
  if (fileName.startsWith('doubao_') || normalized.includes('/doubao/')) {
    return 'doubao'
  }
  throw new Error(`could not infer transcript client from source path: ${sourcePath}`)
}

export function parseTranscript(client: string, sourcePath: string): ParsedTranscript {
  const resolved = inferClient(client, sourcePath)
  if (resolved === 'codex') {
    return parseCodexTranscript(sourcePath)
  }
  if (resolved === 'claude') {
    return parseClaudeTranscript(sourcePath)
  }
  if (resolved === 'gemini') {
    return parseGeminiTranscript(sourcePath)
  }
  if (resolved === 'doubao') {
    return parseDoubaoTranscript(sourcePath)
  }
  throw new Error(`unsupported transcript client: ${resolved}`)
}

// ---------------------------------------------------------------------------
// Codex parser
// ---------------------------------------------------------------------------

export function parseCodexTranscript(filePath: string): ParsedTranscript {
  const records = loadJsonl(filePath)
  const stem = basename(filePath, extname(filePath))
  let sessionId = stem
  let title = stem
  let startedAt = normalizeTimestamp(statSync(filePath).mtimeMs / 1000)
  let cwd = ''
  let branch = ''
  // Canonical messages from `payload.type === 'message'` (response_item records).
  const messages: TranscriptMessage[] = []
  // Streaming fallback: `agent_message` / `user_message` from event_msg records.
  // The Codex CLI double-encodes every message: each turn fires as a streaming
  // `event_msg` (agent_message / user_message) AND later as a canonical
  // `response_item` (message). Processing both causes duplicates because the two
  // representations share almost-identical but not always equal timestamps
  // (millisecond jitter), defeating timestamp-based deduplication. We therefore
  // prefer canonical records and use streaming records only as a fallback for
  // sessions recorded by older Codex versions that emit only streaming events.
  const streamingMessages: TranscriptMessage[] = []
  const toolEvents: TranscriptToolEvent[] = []

  for (const record of records) {
    const recordType = String(record['type'] ?? '')
    const timestamp = normalizeTimestamp(record['timestamp'], startedAt)

    if (recordType === 'session_meta') {
      const payload = ensureDict(record['payload'])
      sessionId = String(payload['id'] ?? '') || sessionId
      title = String(payload['thread_name'] ?? '') || String(payload['title'] ?? '') || title
      startedAt = earliestTimestamp(startedAt, payload['timestamp'])
      cwd = String(payload['cwd'] ?? '') || cwd
      branch = String(getNested(payload, 'git', 'branch') ?? '') || branch
      continue
    }

    if (recordType !== 'response_item' && recordType !== 'event_msg') {
      continue
    }

    const payload = ensureDict(record['payload'])
    const payloadType = String(payload['type'] ?? '')

    if (payloadType === 'message') {
      const role = String(payload['role'] ?? '').toLowerCase()
      if (role === 'user' || role === 'assistant') {
        const text = extractTextBlocks(payload['content'])
        if (text) {
          messages.push({ role, text, timestamp })
        }
      }
      continue
    }

    // Collect streaming events as fallback only — never mix with canonical records.
    if (payloadType === 'user_message' || payloadType === 'agent_message') {
      const role = payloadType === 'user_message' ? 'user' : 'assistant'
      const text = String(payload['message'] ?? '').trim()
      if (text) {
        streamingMessages.push({ role, text, timestamp })
      }
      continue
    }

    if (payloadType === 'function_call') {
      const name = String(payload['name'] ?? '') || 'function_call'
      const args = payload['arguments'] ?? payload['input']
      toolEvents.push({
        summary: `${name} input=${summarizeValue(args)}`,
        timestamp,
      })
      continue
    }

    if (payloadType === 'custom_tool_call') {
      const name = String(payload['name'] ?? '') || String(payload['call_id'] ?? '') || 'custom_tool_call'
      toolEvents.push({
        summary: `${name} input=${summarizeValue(payload['input'])}`,
        timestamp,
      })
      continue
    }

    if (payloadType === 'function_call_output') {
      const name = String(payload['name'] ?? '') || String(payload['call_id'] ?? '') || 'function_call_output'
      const output = payload['output'] ?? payload['content']
      toolEvents.push({
        summary: `${name} output=${summarizeValue(output)}`,
        timestamp,
      })
      continue
    }

    if (payloadType === 'custom_tool_call_output') {
      const name = String(payload['name'] ?? '') || String(payload['call_id'] ?? '') || 'custom_tool_call_output'
      const output = payload['output'] ?? payload['content']
      toolEvents.push({
        summary: `${name} output=${summarizeValue(output)}`,
        timestamp,
      })
    }
  }

  // Use canonical records when available; fall back to streaming events otherwise.
  // Then drop only the leading Codex system injection messages so we do not
  // accidentally erase later turns where the user is legitimately discussing
  // AGENTS.md, environment tags, or other injected scaffolding.
  const finalMessages = trimLeadingCodexSystemInjections(
    messages.length > 0 ? messages : streamingMessages,
  )

  return {
    client: 'codex',
    session_id: sessionId,
    title,
    started_at: startedAt,
    cwd,
    branch,
    messages: deduplicateMessages(finalMessages),
    tool_events: deduplicateToolEvents(toolEvents),
    source_path: filePath,
  }
}

// ---------------------------------------------------------------------------
// Codex system injection detection
// ---------------------------------------------------------------------------

// The Codex CLI injects system context — AGENTS.md instructions, skill
// definitions, environment metadata, and permissions — as the first
// `message(role=user)` record of every session. These are not real user turns
// and must be filtered so the clean transcript starts with the actual
// conversation.
const CODEX_INJECTION_MARKERS: readonly string[] = [
  '<INSTRUCTIONS>',
  '<environment_context>',
  '<permissions instructions>',
  '<collaboration_mode>',
  '# AGENTS.md instructions for',
]

export function isCodexSystemInjection(text: string): boolean {
  return CODEX_INJECTION_MARKERS.some(marker => text.includes(marker))
}

function trimLeadingCodexSystemInjections(messages: TranscriptMessage[]): TranscriptMessage[] {
  let firstRealIndex = 0
  while (firstRealIndex < messages.length) {
    const message = messages[firstRealIndex]
    if (!message || message.role !== 'user' || !isCodexSystemInjection(message.text)) {
      break
    }
    firstRealIndex++
  }
  return messages.slice(firstRealIndex)
}

// ---------------------------------------------------------------------------
// Claude parser
// ---------------------------------------------------------------------------

export function parseClaudeTranscript(filePath: string): ParsedTranscript {
  const records = loadJsonl(filePath)
  const stem = basename(filePath, extname(filePath))
  let sessionId = stem
  const title = stem
  let startedAt = normalizeTimestamp(statSync(filePath).mtimeMs / 1000)
  let cwd = ''
  let branch = ''
  const messages: TranscriptMessage[] = []
  const toolEvents: TranscriptToolEvent[] = []

  for (const record of records) {
    const recordType = String(record['type'] ?? '')
    const timestamp = normalizeTimestamp(record['timestamp'], startedAt)
    sessionId = String(record['sessionId'] ?? '') || sessionId
    startedAt = earliestTimestamp(startedAt, record['timestamp'])
    cwd = String(record['cwd'] ?? '') || cwd
    branch = String(record['gitBranch'] ?? '') || branch

    if (recordType !== 'user' && recordType !== 'assistant') {
      continue
    }

    const message = ensureDict(record['message'])
    const role = String(message['role'] ?? '').toLowerCase() || recordType
    const textParts: string[] = []
    const content = message['content']

    if (typeof content === 'string') {
      const text = content.trim()
      if ((role === 'user' || role === 'assistant') && text) {
        messages.push({ role, text, timestamp })
      }
      continue
    }

    for (const block of ensureList(content)) {
      if (typeof block === 'string') {
        if (block.trim()) {
          textParts.push(block.trim())
        }
        continue
      }
      if (block === null || typeof block !== 'object' || Array.isArray(block)) {
        continue
      }
      const rec = block as Record<string, unknown>
      const blockType = String(rec['type'] ?? '').toLowerCase()

      if (TEXT_BLOCK_TYPES.has(blockType)) {
        const text = String(rec['text'] ?? '').trim()
        if (text) {
          textParts.push(text)
        }
        continue
      }
      if (SKIP_BLOCK_TYPES.has(blockType)) {
        continue
      }
      if (TOOL_USE_TYPES.has(blockType)) {
        const name = String(rec['name'] ?? '') || 'tool_use'
        toolEvents.push({
          summary: `${name} input=${summarizeValue(rec['input'])}`,
          timestamp,
        })
        continue
      }
      if (TOOL_RESULT_TYPES.has(blockType)) {
        const toolUseId = String(rec['tool_use_id'] ?? '') || 'tool_result'
        toolEvents.push({
          summary: `${toolUseId} output=${summarizeValue(rec['content'])}`,
          timestamp,
        })
      }
    }

    const text = joinParagraphs(textParts)
    if ((role === 'user' || role === 'assistant') && text) {
      messages.push({ role, text, timestamp })
    }
  }

  return {
    client: 'claude',
    session_id: sessionId,
    title,
    started_at: startedAt,
    cwd,
    branch,
    messages: deduplicateMessages(messages),
    tool_events: deduplicateToolEvents(toolEvents),
    source_path: filePath,
  }
}

// ---------------------------------------------------------------------------
// Gemini parser
// ---------------------------------------------------------------------------

export function parseGeminiTranscript(filePath: string): ParsedTranscript {
  const stem = basename(filePath, extname(filePath))
  let sessionId = stem
  const title = stem
  let startedAt = normalizeTimestamp(statSync(filePath).mtimeMs / 1000)
  let cwd = ''
  let branch = ''
  const messages: TranscriptMessage[] = []
  const toolEvents: TranscriptToolEvent[] = []

  let payload: unknown
  if (extname(filePath).toLowerCase() === '.jsonl') {
    payload = loadJsonl(filePath)
  } else {
    payload = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
  }

  const metaKeys: ReadonlySet<string> = new Set(['sessionId', 'chatId', 'cwd', 'branch', 'timestamp'])
  const firstMeta = findFirstMappingWithKeys(payload, metaKeys)
  if (firstMeta !== null) {
    sessionId = String(firstMeta['sessionId'] ?? '') || String(firstMeta['chatId'] ?? '') || String(firstMeta['id'] ?? '') || sessionId
    startedAt = earliestTimestamp(startedAt, firstMeta['timestamp'])
    cwd = String(firstMeta['cwd'] ?? '') || String(firstMeta['projectRoot'] ?? '') || cwd
    branch = String(firstMeta['branch'] ?? '') || branch
  }

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item)
      }
      return
    }
    if (node === null || typeof node !== 'object') {
      return
    }
    const rec = node as Record<string, unknown>

    sessionId = String(rec['sessionId'] ?? '') || String(rec['chatId'] ?? '') || String(rec['id'] ?? '') || sessionId
    startedAt = earliestTimestamp(startedAt, rec['timestamp'])
    cwd = String(rec['cwd'] ?? '') || String(rec['projectRoot'] ?? '') || cwd
    branch = String(rec['branch'] ?? '') || branch

    const role = String(rec['role'] ?? rec['author'] ?? rec['sender'] ?? '').toLowerCase()
    const timestamp = normalizeTimestamp(rec['timestamp'], startedAt)

    if (role === 'user' || role === 'assistant' || role === 'model') {
      const normalizedRole = role === 'model' ? 'assistant' : role
      const text = extractGeminiText(rec)
      if (text) {
        messages.push({ role: normalizedRole, text, timestamp })
      }
    }

    const toolName =
      getNested(rec, 'toolUse', 'name') ??
      rec['toolName'] ??
      rec['functionName'] ??
      rec['tool']
    if (toolName) {
      toolEvents.push({
        summary: `${String(toolName)} input=${summarizeValue(rec['args'] ?? rec['input'])}`,
        timestamp,
      })
    }

    for (const value of Object.values(rec)) {
      visit(value)
    }
  }

  visit(payload)

  return {
    client: 'gemini',
    session_id: sessionId,
    title,
    started_at: startedAt,
    cwd,
    branch,
    messages: deduplicateMessages(messages),
    tool_events: deduplicateToolEvents(toolEvents),
    source_path: filePath,
  }
}

// ---------------------------------------------------------------------------
// Doubao parser
// ---------------------------------------------------------------------------
//
// Doubao TXT export format:
//
//   Title: 对话标题
//   URL: https://www.doubao.com/chat/38416801786598914
//   Platform: 豆包
//   Created: 2026-03-16 10:22:17
//   Messages: 28
//
//   User: [2026-03-16 10:22:17]
//   用户消息内容...
//
//   AI: [2026-03-16 15:43:17]
//   AI 回复内容...
//

/** Matches a turn header: "User: [2026-03-16 10:22:17]" or "AI: [2026-03-16 15:43:17]" */
const DOUBAO_TURN_RE = /^(User|AI):\s*\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s*$/

export function parseDoubaoTranscript(filePath: string): ParsedTranscript {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  const stem = basename(filePath, extname(filePath))
  let title = stem
  let sessionId = stem
  let startedAt = normalizeTimestamp(statSync(filePath).mtimeMs / 1000)

  // --- Parse header block (key: value lines before the first blank line) ---
  let lineIndex = 0
  for (; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? ''
    if (line.trim() === '') break

    const titleMatch = line.match(/^Title:\s*(.+)$/)
    if (titleMatch) {
      title = (titleMatch[1] ?? '').trim() || title
      continue
    }

    const urlMatch = line.match(/^URL:\s*(.+)$/)
    if (urlMatch) {
      const url = (urlMatch[1] ?? '').trim()
      // Derive session_id from the last path segment of the URL
      const lastSegment = url.split('/').pop() ?? ''
      if (lastSegment) sessionId = lastSegment
      continue
    }

    const createdMatch = line.match(/^Created:\s*(.+)$/)
    if (createdMatch) {
      // Convert "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
      const iso = (createdMatch[1] ?? '').trim().replace(' ', 'T')
      startedAt = normalizeTimestamp(iso, startedAt)
      continue
    }
  }

  // Skip blank lines between header and first turn
  while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() === '') {
    lineIndex++
  }

  // --- Parse message turns ---
  const messages: TranscriptMessage[] = []

  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? ''
    const match = line.match(DOUBAO_TURN_RE)

    if (!match) {
      lineIndex++
      continue
    }

    const role: string = match[1] === 'User' ? 'user' : 'assistant'
    const iso = (match[2] ?? '').trim().replace(' ', 'T')
    const timestamp = normalizeTimestamp(iso, startedAt)
    lineIndex++ // advance past turn header

    // Skip blank line that follows the turn header
    while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() === '') {
      lineIndex++
    }

    // Collect body lines until next turn header or EOF
    const bodyLines: string[] = []
    while (lineIndex < lines.length) {
      const bodyLine = lines[lineIndex] ?? ''
      if (DOUBAO_TURN_RE.test(bodyLine)) break
      bodyLines.push(bodyLine)
      lineIndex++
    }

    // Trim trailing blank lines from body
    while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? '').trim() === '') {
      bodyLines.pop()
    }

    const text = bodyLines.join('\n').trim()
    if (text) {
      messages.push({ role, text, timestamp })
    }
  }

  return {
    client: 'doubao',
    session_id: sessionId,
    title,
    started_at: startedAt,
    cwd: '',
    branch: '',
    messages: deduplicateMessages(messages),
    tool_events: [],
    source_path: filePath,
  }
}
