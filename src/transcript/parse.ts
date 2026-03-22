import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

import type {
  Client,
  ParsedTranscript,
  TranscriptEvent,
  TranscriptMessage,
  TranscriptMessageEvent,
  TranscriptToolEvent,
} from '../types/transcript.js'
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
  extractSimpleText,
  extractTextBlocks,
  findFirstMappingWithKeys,
  getNested,
  joinParagraphs,
  loadJsonl,
  normalizeTimestamp,
  parseIsoTimestamp,
  summarizeValue,
} from './common.js'

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

export function parseCodexTranscript(filePath: string): ParsedTranscript {
  const records = loadJsonl(filePath)
  const stem = basename(filePath, extname(filePath))
  let sessionId = stem
  let title = stem
  let startedAt = normalizeTimestamp(statSync(filePath).mtimeMs / 1000)
  let cwd = ''
  let branch = ''

  const messages: TranscriptMessage[] = []
  const streamingMessages: TranscriptMessage[] = []
  const toolEvents: TranscriptToolEvent[] = []
  const canonicalMessageEvents: TranscriptMessageEvent[] = []
  const streamingMessageEvents: TranscriptMessageEvent[] = []
  const otherEvents: TranscriptEvent[] = []
  const toolNamesByCallId = new Map<string, string>()

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    const sequence = index
    const recordType = String(record['type'] ?? '')
    const timestamp = normalizeTimestamp(record['timestamp'], startedAt)

    if (recordType === 'session_meta') {
      const payload = ensureDict(record['payload'])
      sessionId = String(payload['id'] ?? '') || sessionId
      title = String(payload['thread_name'] ?? '') || String(payload['title'] ?? '') || title
      startedAt = earliestTimestamp(startedAt, payload['timestamp'] ?? record['timestamp'])
      cwd = String(payload['cwd'] ?? '') || cwd
      branch = String(getNested(payload, 'git', 'branch') ?? '') || branch
      otherEvents.push({
        kind: 'context',
        title: 'session_meta',
        timestamp,
        sequence,
        summary: title || sessionId,
        metadata: payload,
      })
      continue
    }

    if (recordType === 'turn_context') {
      const payload = ensureDict(record['payload'])
      otherEvents.push({
        kind: 'context',
        title: 'turn_context',
        timestamp,
        sequence,
        summary: String(payload['model'] ?? '') || String(payload['cwd'] ?? '') || 'turn_context',
        metadata: payload,
      })
      continue
    }

    if (recordType !== 'response_item' && recordType !== 'event_msg') {
      continue
    }

    const payload = ensureDict(record['payload'])
    const payloadType = String(payload['type'] ?? '')

    if (payloadType === 'message') {
      const role = String(payload['role'] ?? '').toLowerCase()
      const text = extractTextBlocks(payload['content'])
      if (text) {
        const phase = asOptionalString(payload['phase'])
        canonicalMessageEvents.push({
          kind: 'message',
          role: role || 'unknown',
          text,
          timestamp,
          sequence,
          summary: summarizeValue(text, 240),
          ...(phase ? { phase } : {}),
        })
        if (role === 'user' || role === 'assistant') {
          messages.push({ role, text, timestamp })
        }
      }
      continue
    }

    if (payloadType === 'user_message' || payloadType === 'agent_message') {
      const role = payloadType === 'user_message' ? 'user' : 'assistant'
      const text = String(payload['message'] ?? '').trim()
      if (text) {
        const phase = asOptionalString(payload['phase'])
        streamingMessageEvents.push({
          kind: 'message',
          role,
          text,
          timestamp,
          sequence,
          summary: summarizeValue(text, 240),
          ...(phase ? { phase } : {}),
        })
        streamingMessages.push({ role, text, timestamp })
      }
      continue
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const toolName =
        String(payload['name'] ?? '') ||
        String(payload['call_id'] ?? '') ||
        payloadType
      const input =
        payloadType === 'function_call'
          ? parseStructuredValue(payload['arguments'] ?? payload['input'])
          : parseStructuredValue(payload['input'])
      const summary = `${toolName} input=${summarizeValue(input)}`
      const callId = asOptionalString(payload['call_id'])
      if (callId) {
        toolNamesByCallId.set(callId, toolName)
      }
      toolEvents.push({ summary, timestamp })
      otherEvents.push({
        kind: 'tool_call',
        tool_name: toolName,
        input,
        timestamp,
        sequence,
        summary,
        metadata: payload,
        ...(callId ? { call_id: callId } : {}),
      })
      continue
    }

    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      const callId = asOptionalString(payload['call_id'])
      const toolName =
        String(payload['name'] ?? '') ||
        (callId ? toolNamesByCallId.get(callId) ?? '' : '') ||
        String(payload['call_id'] ?? '') ||
        payloadType
      const output = payload['output'] ?? payload['content']
      const normalizedOutput = parseStructuredValue(output)
      const summary = `${toolName} output=${summarizeValue(normalizedOutput)}`
      toolEvents.push({ summary, timestamp })
      otherEvents.push({
        kind: 'tool_result',
        tool_name: toolName,
        output: normalizedOutput,
        exit_code: extractExitCode(normalizedOutput),
        timestamp,
        sequence,
        summary,
        metadata: payload,
        ...(callId ? { call_id: callId } : {}),
      })
      continue
    }

    if (payloadType === 'reasoning') {
      const reasoningText = extractReasoningText(payload)
      const reasoningSummary = extractReasoningSummary(payload, reasoningText)
      const redacted = Boolean(payload['encrypted_content'])
      otherEvents.push({
        kind: 'reasoning',
        timestamp,
        sequence,
        summary: reasoningSummary,
        redacted,
        metadata: extractReasoningMetadata(payload),
        ...(!redacted && reasoningText ? { text: reasoningText } : {}),
      })
      continue
    }

    if (payloadType === 'token_count') {
      const totals = ensureDict(getNested(payload, 'info', 'total_token_usage'))
      const totalTokens = asOptionalNumber(totals['total_tokens'])
      const inputTokens = asOptionalNumber(totals['input_tokens'])
      const outputTokens = asOptionalNumber(totals['output_tokens'])
      const reasoningTokens = asOptionalNumber(totals['reasoning_output_tokens'])
      otherEvents.push({
        kind: 'token_count',
        timestamp,
        sequence,
        summary: buildTokenSummary(totals),
        metadata: payload,
        ...(typeof totalTokens === 'number' ? { total_tokens: totalTokens } : {}),
        ...(typeof inputTokens === 'number' ? { input_tokens: inputTokens } : {}),
        ...(typeof outputTokens === 'number' ? { output_tokens: outputTokens } : {}),
        ...(typeof reasoningTokens === 'number' ? { reasoning_tokens: reasoningTokens } : {}),
      })
      continue
    }

    if (payloadType === 'task_started' || payloadType === 'task_complete') {
      const turnId = asOptionalString(payload['turn_id'])
      const lastAgentMessage = asOptionalString(payload['last_agent_message'])
      otherEvents.push({
        kind: 'task_status',
        status: payloadType === 'task_started' ? 'started' : 'completed',
        timestamp,
        sequence,
        summary:
          payloadType === 'task_complete'
            ? summarizeValue(payload['last_agent_message'] ?? payloadType, 240)
            : payloadType,
        metadata: payload,
        ...(turnId ? { turn_id: turnId } : {}),
        ...(lastAgentMessage ? { last_agent_message: lastAgentMessage } : {}),
      })
      continue
    }

    if (payloadType) {
      const text = extractSimpleText(payload['message']) || extractSimpleText(payload['content']) || undefined
      otherEvents.push({
        kind: 'system',
        title: payloadType,
        timestamp,
        sequence,
        summary: summarizeValue(payload, 240),
        metadata: payload,
        ...(text ? { text } : {}),
      })
    }
  }

  const finalMessages = trimLeadingCodexSystemInjections(
    messages.length > 0 ? messages : streamingMessages,
  )
  const chosenMessageEvents = deduplicateMessageEvents(
    canonicalMessageEvents.length > 0 ? canonicalMessageEvents : streamingMessageEvents,
  )
  const finalEvents = renumberEvents(
    [...otherEvents, ...chosenMessageEvents].sort(compareEventSequence),
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
    events: finalEvents,
    source_path: filePath,
  }
}

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
  const events: TranscriptEvent[] = []
  const toolNamesByUseId = new Map<string, string>()
  let sequence = 0

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
    const content = message['content']

    if (typeof content === 'string') {
      const text = content.trim()
      if (text) {
        messages.push({ role, text, timestamp })
        events.push({
          kind: 'message',
          role,
          text,
          timestamp,
          sequence: sequence++,
          summary: summarizeValue(text, 240),
        })
      }
      continue
    }

    const textParts: string[] = []
    const flushMessage = (): void => {
      const text = joinParagraphs(textParts)
      textParts.length = 0
      if (!text) return
      messages.push({ role, text, timestamp })
      events.push({
        kind: 'message',
        role,
        text,
        timestamp,
        sequence: sequence++,
        summary: summarizeValue(text, 240),
      })
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
        flushMessage()
        const reasoningText = String(rec['text'] ?? '').trim()
        if (reasoningText) {
          events.push({
            kind: 'reasoning',
            timestamp,
            sequence: sequence++,
            text: reasoningText,
            summary: summarizeValue(reasoningText, 240),
            redacted: false,
          })
        }
        continue
      }

      if (TOOL_USE_TYPES.has(blockType)) {
        flushMessage()
        const toolName = String(rec['name'] ?? '') || 'tool_use'
        const toolUseId = asOptionalString(rec['id']) ?? asOptionalString(rec['tool_use_id'])
        if (toolUseId) {
          toolNamesByUseId.set(toolUseId, toolName)
        }
        const input = rec['input']
        const summary = `${toolName} input=${summarizeValue(input)}`
        toolEvents.push({ summary, timestamp })
        events.push({
          kind: 'tool_call',
          tool_name: toolName,
          input,
          timestamp,
          sequence: sequence++,
          summary,
          metadata: rec,
          ...(toolUseId ? { call_id: toolUseId } : {}),
        })
        continue
      }

      if (TOOL_RESULT_TYPES.has(blockType)) {
        flushMessage()
        const toolUseId = asOptionalString(rec['tool_use_id'])
        const toolName = (toolUseId ? toolNamesByUseId.get(toolUseId) : undefined) ?? toolUseId ?? 'tool_result'
        const output = rec['content']
        const summary = `${toolName} output=${summarizeValue(output)}`
        toolEvents.push({ summary, timestamp })
        events.push({
          kind: 'tool_result',
          tool_name: toolName,
          output,
          timestamp,
          sequence: sequence++,
          summary,
          metadata: rec,
          ...(toolUseId ? { call_id: toolUseId } : {}),
        })
      }
    }

    flushMessage()
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
    events: renumberEvents(events),
    source_path: filePath,
  }
}

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
    sessionId =
      String(firstMeta['sessionId'] ?? '') ||
      String(firstMeta['chatId'] ?? '') ||
      String(firstMeta['id'] ?? '') ||
      sessionId
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
    sessionId =
      String(rec['sessionId'] ?? '') ||
      String(rec['chatId'] ?? '') ||
      String(rec['id'] ?? '') ||
      sessionId
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

  const dedupedMessages = deduplicateMessages(messages)
  const dedupedToolEvents = deduplicateToolEvents(toolEvents)
  const events = renumberEvents([
    ...dedupedMessages.map((message, index) => ({
      kind: 'message' as const,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp,
      sequence: index,
      summary: summarizeValue(message.text, 240),
    })),
    ...dedupedToolEvents.map((event, index) => ({
      kind: 'tool_call' as const,
      tool_name: toolNameFromSummary(event.summary),
      timestamp: event.timestamp,
      sequence: dedupedMessages.length + index,
      summary: event.summary,
    })),
  ].sort(compareEventTime))

  return {
    client: 'gemini',
    session_id: sessionId,
    title,
    started_at: startedAt,
    cwd,
    branch,
    messages: dedupedMessages,
    tool_events: dedupedToolEvents,
    events,
    source_path: filePath,
  }
}

const DOUBAO_TURN_RE = /^(User|AI):\s*\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s*$/

export function parseDoubaoTranscript(filePath: string): ParsedTranscript {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  const stem = basename(filePath, extname(filePath))
  let title = stem
  let sessionId = stem
  let startedAt = normalizeTimestamp(statSync(filePath).mtimeMs / 1000)

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
      const lastSegment = url.split('/').pop() ?? ''
      if (lastSegment) sessionId = lastSegment
      continue
    }

    const createdMatch = line.match(/^Created:\s*(.+)$/)
    if (createdMatch) {
      const raw = (createdMatch[1] ?? '').trim().replace(' ', 'T')
      if (raw) startedAt = raw
      continue
    }
  }

  while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() === '') {
    lineIndex++
  }

  const messages: TranscriptMessage[] = []

  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? ''
    const match = line.match(DOUBAO_TURN_RE)

    if (!match) {
      lineIndex++
      continue
    }

    const role: string = match[1] === 'User' ? 'user' : 'assistant'
    const timestamp = (match[2] ?? '').trim().replace(' ', 'T')
    lineIndex++

    while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() === '') {
      lineIndex++
    }

    const bodyLines: string[] = []
    while (lineIndex < lines.length) {
      const bodyLine = lines[lineIndex] ?? ''
      if (DOUBAO_TURN_RE.test(bodyLine)) break
      bodyLines.push(bodyLine)
      lineIndex++
    }

    while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? '').trim() === '') {
      bodyLines.pop()
    }

    const text = bodyLines.join('\n').trim()
    if (text) {
      messages.push({ role, text, timestamp })
    }
  }

  const dedupedMessages = deduplicateMessages(messages)

  return {
    client: 'doubao',
    session_id: sessionId,
    title,
    started_at: startedAt,
    cwd: '',
    branch: '',
    messages: dedupedMessages,
    tool_events: [],
    events: renumberEvents(
      dedupedMessages.map((message, index) => ({
        kind: 'message',
        role: message.role,
        text: message.text,
        timestamp: message.timestamp,
        sequence: index,
        summary: summarizeValue(message.text, 240),
      })),
    ),
    source_path: filePath,
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (!/^(?:\{|\[|"|-)/.test(trimmed)) return trimmed
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

function extractReasoningText(payload: Record<string, unknown>): string {
  const contentText = extractTextBlocks(payload['content'])
  if (contentText) return contentText

  const parts: string[] = []
  for (const item of ensureList(payload['summary'])) {
    const text = extractSimpleText(item)
    if (text) {
      parts.push(text)
    }
  }
  return joinParagraphs(parts)
}

function extractReasoningSummary(payload: Record<string, unknown>, reasoningText: string): string {
  if (reasoningText) {
    return summarizeValue(reasoningText, 240)
  }
  if (payload['encrypted_content']) {
    return 'Private reasoning captured; content is encrypted.'
  }
  return 'Reasoning step recorded.'
}

function extractReasoningMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (payload['encrypted_content']) {
    metadata['encrypted'] = true
  }
  if (Array.isArray(payload['summary'])) {
    metadata['summary_count'] = payload['summary'].length
  }
  return metadata
}

function buildTokenSummary(totals: Record<string, unknown>): string {
  const totalTokens = asOptionalNumber(totals['total_tokens'])
  if (typeof totalTokens === 'number') {
    return `total_tokens=${totalTokens}`
  }
  return 'Token usage updated.'
}

function extractExitCode(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/Exit code:\s*(-?\d+)/)
  if (!match) return null
  return Number.parseInt(match[1] ?? '', 10)
}

function deduplicateMessageEvents(events: TranscriptMessageEvent[]): TranscriptMessageEvent[] {
  const seen = new Set<string>()
  const result: TranscriptMessageEvent[] = []
  for (const event of events) {
    const signature = `${event.timestamp ?? ''}\0${event.role}\0${event.text}`
    if (seen.has(signature)) {
      continue
    }
    seen.add(signature)
    result.push(event)
  }
  return result
}

function renumberEvents(events: TranscriptEvent[]): TranscriptEvent[] {
  return events.map((event, index) => ({ ...event, sequence: index }))
}

function compareEventSequence(a: TranscriptEvent, b: TranscriptEvent): number {
  return a.sequence - b.sequence
}

function compareEventTime(a: TranscriptEvent, b: TranscriptEvent): number {
  const left = a.timestamp ? parseIsoTimestamp(a.timestamp) : null
  const right = b.timestamp ? parseIsoTimestamp(b.timestamp) : null
  if (left !== null && right !== null) {
    return left.getTime() - right.getTime()
  }
  if (left !== null) return -1
  if (right !== null) return 1
  return a.sequence - b.sequence
}

function toolNameFromSummary(summary: string): string {
  const match = summary.trim().match(/^([A-Za-z_][A-Za-z0-9_:-]*)/)
  return match?.[1] ?? 'tool'
}
