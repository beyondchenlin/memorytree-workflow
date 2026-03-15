import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  CLIENTS, TEXT_BLOCK_TYPES, SKIP_BLOCK_TYPES, TOOL_USE_TYPES, TOOL_RESULT_TYPES,
  slugify, sha256File, contentHash, normalizeTimestamp, earliestTimestamp,
  parseIsoTimestamp, timestampPartition, joinParagraphs, summarizeValue,
  truncate, yamlEscape, ensureDict, ensureList, getNested, loadJsonl, loadJson,
  extractTextBlocks, extractSimpleText, extractGeminiText, extractGeminiParts,
  findFirstMappingWithKeys, deduplicateMessages, deduplicateToolEvents,
} from '../../src/transcript/common.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('CLIENTS contains codex, claude, gemini', () => {
    expect(CLIENTS).toEqual(new Set(['codex', 'claude', 'gemini']))
  })
  it('TEXT_BLOCK_TYPES contains expected types', () => {
    expect(TEXT_BLOCK_TYPES).toEqual(new Set(['input_text', 'output_text', 'text']))
  })
  it('SKIP_BLOCK_TYPES contains thinking and reasoning', () => {
    expect(SKIP_BLOCK_TYPES).toEqual(new Set(['thinking', 'reasoning']))
  })
  it('TOOL_USE_TYPES contains tool_use', () => {
    expect(TOOL_USE_TYPES).toEqual(new Set(['tool_use']))
  })
  it('TOOL_RESULT_TYPES contains tool_result', () => {
    expect(TOOL_RESULT_TYPES).toEqual(new Set(['tool_result']))
  })
})

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('converts to lowercase ascii slug', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })
  it('removes non-ASCII characters', () => {
    expect(slugify('你好world')).toBe('world')
  })
  it('strips leading/trailing separators', () => {
    expect(slugify('--hello--')).toBe('hello')
  })
  it('returns fallback for empty result', () => {
    expect(slugify('你好')).toBe('session')
  })
  it('returns custom fallback', () => {
    expect(slugify('你好', 'project')).toBe('project')
  })
  it('preserves dots and hyphens', () => {
    expect(slugify('file.name-v2')).toBe('file.name-v2')
  })
  it('collapses multiple separators', () => {
    expect(slugify('a   b   c')).toBe('a-b-c')
  })
  it('handles emoji', () => {
    expect(slugify('🚀launch')).toBe('launch')
  })
})

// ---------------------------------------------------------------------------
// sha256File
// ---------------------------------------------------------------------------

describe('sha256File', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sha256-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('computes sha256 of file contents', () => {
    const filePath = join(tmpDir, 'test.txt')
    writeFileSync(filePath, 'hello world')
    const hash = sha256File(filePath)
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('returns different hash for different content', () => {
    const a = join(tmpDir, 'a.txt')
    const b = join(tmpDir, 'b.txt')
    writeFileSync(a, 'hello')
    writeFileSync(b, 'world')
    expect(sha256File(a)).not.toBe(sha256File(b))
  })
})

// ---------------------------------------------------------------------------
// contentHash
// ---------------------------------------------------------------------------

describe('contentHash', () => {
  it('returns 16-char hex prefix', () => {
    const hash = contentHash('hello')
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })
  it('is deterministic', () => {
    expect(contentHash('test')).toBe(contentHash('test'))
  })
  it('differs for different text', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'))
  })
})

// ---------------------------------------------------------------------------
// normalizeTimestamp
// ---------------------------------------------------------------------------

describe('normalizeTimestamp', () => {
  it('normalizes unix timestamp in seconds', () => {
    // 2024-01-01T00:00:00Z
    expect(normalizeTimestamp(1704067200)).toBe('2024-01-01T00:00:00Z')
  })
  it('normalizes unix timestamp in milliseconds', () => {
    expect(normalizeTimestamp(1704067200000)).toBe('2024-01-01T00:00:00Z')
  })
  it('normalizes ISO string', () => {
    expect(normalizeTimestamp('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z')
  })
  it('normalizes ISO string with offset', () => {
    expect(normalizeTimestamp('2024-01-01T08:00:00+08:00')).toBe('2024-01-01T00:00:00Z')
  })
  it('returns fallback for empty string', () => {
    expect(normalizeTimestamp('', '2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z')
  })
  it('returns fallback for null', () => {
    expect(normalizeTimestamp(null, '2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z')
  })
  it('returns fallback for undefined', () => {
    expect(normalizeTimestamp(undefined, '2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z')
  })
  it('returns current time when no fallback and value is null', () => {
    const result = normalizeTimestamp(null)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
  it('normalizes Date object', () => {
    const d = new Date('2024-06-15T12:30:45.123Z')
    expect(normalizeTimestamp(d)).toBe('2024-06-15T12:30:45Z')
  })
  it('returns original string for unparseable value', () => {
    expect(normalizeTimestamp('not-a-date')).toBe('not-a-date')
  })
  it('strips microseconds', () => {
    expect(normalizeTimestamp('2024-01-01T00:00:00.123456Z')).toBe('2024-01-01T00:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// earliestTimestamp
// ---------------------------------------------------------------------------

describe('earliestTimestamp', () => {
  it('returns earlier of two timestamps', () => {
    expect(earliestTimestamp('2024-06-01T00:00:00Z', '2024-01-01T00:00:00Z'))
      .toBe('2024-01-01T00:00:00Z')
  })
  it('returns current if candidate is later', () => {
    expect(earliestTimestamp('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z'))
      .toBe('2024-01-01T00:00:00Z')
  })
  it('returns normalized candidate if current is empty', () => {
    const result = earliestTimestamp('', '2024-01-01T00:00:00Z')
    expect(result).toBe('2024-01-01T00:00:00Z')
  })
  it('returns current if candidate is not parseable', () => {
    expect(earliestTimestamp('2024-01-01T00:00:00Z', 'garbage'))
      .toBe('2024-01-01T00:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// parseIsoTimestamp
// ---------------------------------------------------------------------------

describe('parseIsoTimestamp', () => {
  it('parses Z-suffix timestamp', () => {
    const d = parseIsoTimestamp('2024-01-01T00:00:00Z')
    expect(d).toBeInstanceOf(Date)
    expect(d!.getTime()).toBe(new Date('2024-01-01T00:00:00Z').getTime())
  })
  it('parses offset timestamp', () => {
    const d = parseIsoTimestamp('2024-01-01T08:00:00+08:00')
    expect(d!.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })
  it('returns null for empty string', () => {
    expect(parseIsoTimestamp('')).toBeNull()
  })
  it('returns null for garbage', () => {
    expect(parseIsoTimestamp('not-a-date')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// timestampPartition
// ---------------------------------------------------------------------------

describe('timestampPartition', () => {
  it('returns year and month', () => {
    expect(timestampPartition('2024-06-15T12:00:00Z')).toEqual(['2024', '06'])
  })
  it('returns unknown for invalid timestamp', () => {
    expect(timestampPartition('garbage')).toEqual(['unknown', 'unknown'])
  })
  it('handles January correctly', () => {
    expect(timestampPartition('2024-01-01T00:00:00Z')).toEqual(['2024', '01'])
  })
})

// ---------------------------------------------------------------------------
// joinParagraphs
// ---------------------------------------------------------------------------

describe('joinParagraphs', () => {
  it('joins non-empty parts with double newline', () => {
    expect(joinParagraphs(['hello', 'world'])).toBe('hello\n\nworld')
  })
  it('filters empty strings', () => {
    expect(joinParagraphs(['hello', '', '  ', 'world'])).toBe('hello\n\nworld')
  })
  it('returns empty string for empty array', () => {
    expect(joinParagraphs([])).toBe('')
  })
  it('trims whitespace from parts', () => {
    expect(joinParagraphs(['  hello  ', '  world  '])).toBe('hello\n\nworld')
  })
})

// ---------------------------------------------------------------------------
// summarizeValue
// ---------------------------------------------------------------------------

describe('summarizeValue', () => {
  it('returns "none" for null', () => {
    expect(summarizeValue(null)).toBe('none')
  })
  it('returns "none" for undefined', () => {
    expect(summarizeValue(undefined)).toBe('none')
  })
  it('collapses whitespace in strings', () => {
    expect(summarizeValue('hello   world')).toBe('hello world')
  })
  it('truncates long strings', () => {
    const long = 'a'.repeat(200)
    const result = summarizeValue(long, 180)
    expect(result.length).toBe(180)
    expect(result.endsWith('...')).toBe(true)
  })
  it('JSON-serializes objects', () => {
    expect(summarizeValue({ a: 1 })).toBe('{"a":1}')
  })
})

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns text if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })
  it('truncates with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...')
  })
  it('handles exact limit', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// yamlEscape
// ---------------------------------------------------------------------------

describe('yamlEscape', () => {
  it('wraps in double quotes', () => {
    expect(yamlEscape('hello')).toBe('"hello"')
  })
  it('escapes backslashes', () => {
    expect(yamlEscape('a\\b')).toBe('"a\\\\b"')
  })
  it('escapes double quotes', () => {
    expect(yamlEscape('say "hi"')).toBe('"say \\"hi\\""')
  })
  it('escapes newlines', () => {
    expect(yamlEscape('line1\nline2')).toBe('"line1\\nline2"')
  })
})

// ---------------------------------------------------------------------------
// ensureDict / ensureList
// ---------------------------------------------------------------------------

describe('ensureDict', () => {
  it('returns object as-is', () => {
    const obj = { a: 1 }
    expect(ensureDict(obj)).toBe(obj)
  })
  it('returns empty object for non-object', () => {
    expect(ensureDict('string')).toEqual({})
    expect(ensureDict(42)).toEqual({})
    expect(ensureDict(null)).toEqual({})
    expect(ensureDict(undefined)).toEqual({})
  })
  it('returns empty object for array', () => {
    expect(ensureDict([1, 2])).toEqual({})
  })
})

describe('ensureList', () => {
  it('returns array as-is', () => {
    const arr = [1, 2]
    expect(ensureList(arr)).toBe(arr)
  })
  it('returns empty array for non-array', () => {
    expect(ensureList('string')).toEqual([])
    expect(ensureList(42)).toEqual([])
    expect(ensureList(null)).toEqual([])
    expect(ensureList({})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getNested
// ---------------------------------------------------------------------------

describe('getNested', () => {
  it('gets deeply nested value', () => {
    const obj = { a: { b: { c: 42 } } }
    expect(getNested(obj, 'a', 'b', 'c')).toBe(42)
  })
  it('returns null for missing key', () => {
    expect(getNested({ a: 1 }, 'b')).toBeNull()
  })
  it('returns null if intermediate is not object', () => {
    expect(getNested({ a: 'string' }, 'a', 'b')).toBeNull()
  })
  it('returns null for empty keys', () => {
    const obj = { a: 1 }
    expect(getNested(obj)).toEqual(obj)
  })
})

// ---------------------------------------------------------------------------
// loadJsonl / loadJson
// ---------------------------------------------------------------------------

describe('loadJsonl', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jsonl-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads valid JSONL file', () => {
    const filePath = join(tmpDir, 'test.jsonl')
    writeFileSync(filePath, '{"a":1}\n{"b":2}\n')
    const records = loadJsonl(filePath)
    expect(records).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('skips blank lines', () => {
    const filePath = join(tmpDir, 'test.jsonl')
    writeFileSync(filePath, '{"a":1}\n\n{"b":2}\n')
    expect(loadJsonl(filePath)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('skips invalid JSON lines', () => {
    const filePath = join(tmpDir, 'test.jsonl')
    writeFileSync(filePath, '{"a":1}\nnot json\n{"b":2}\n')
    expect(loadJsonl(filePath)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('returns empty array for missing file', () => {
    expect(loadJsonl(join(tmpDir, 'missing.jsonl'))).toEqual([])
  })
})

describe('loadJson', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'json-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads valid JSON file', () => {
    const filePath = join(tmpDir, 'test.json')
    writeFileSync(filePath, '{"a":1}')
    expect(loadJson(filePath)).toEqual({ a: 1 })
  })

  it('returns null for missing file', () => {
    expect(loadJson(join(tmpDir, 'missing.json'))).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const filePath = join(tmpDir, 'bad.json')
    writeFileSync(filePath, 'not json')
    expect(loadJson(filePath)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractTextBlocks
// ---------------------------------------------------------------------------

describe('extractTextBlocks', () => {
  it('extracts text from text-type blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]
    expect(extractTextBlocks(blocks)).toBe('hello\n\nworld')
  })

  it('skips thinking and tool blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'thinking', text: 'hmm' },
      { type: 'tool_use', name: 'tool' },
      { type: 'tool_result', content: 'result' },
    ]
    expect(extractTextBlocks(blocks)).toBe('hello')
  })

  it('handles string blocks', () => {
    expect(extractTextBlocks(['hello', 'world'])).toBe('hello\n\nworld')
  })

  it('handles non-list input', () => {
    expect(extractTextBlocks('not a list')).toBe('')
  })

  it('handles input_text and output_text types', () => {
    const blocks = [
      { type: 'input_text', text: 'in' },
      { type: 'output_text', text: 'out' },
    ]
    expect(extractTextBlocks(blocks)).toBe('in\n\nout')
  })

  it('uses extractSimpleText as fallback for unknown block types', () => {
    const blocks = [{ type: 'unknown', text: 'fallback text' }]
    expect(extractTextBlocks(blocks)).toBe('fallback text')
  })
})

// ---------------------------------------------------------------------------
// extractSimpleText
// ---------------------------------------------------------------------------

describe('extractSimpleText', () => {
  it('returns trimmed string', () => {
    expect(extractSimpleText('  hello  ')).toBe('hello')
  })
  it('joins array items', () => {
    expect(extractSimpleText(['hello', 'world'])).toBe('hello\n\nworld')
  })
  it('extracts text key from dict', () => {
    expect(extractSimpleText({ text: 'hello' })).toBe('hello')
  })
  it('extracts content key from dict', () => {
    expect(extractSimpleText({ content: 'hello' })).toBe('hello')
  })
  it('extracts value key from dict', () => {
    expect(extractSimpleText({ value: 'hello' })).toBe('hello')
  })
  it('returns empty for dict without text keys', () => {
    expect(extractSimpleText({ other: 'nope' })).toBe('')
  })
  it('returns empty for null', () => {
    expect(extractSimpleText(null)).toBe('')
  })
  it('returns empty for number', () => {
    expect(extractSimpleText(42)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// extractGeminiText / extractGeminiParts
// ---------------------------------------------------------------------------

describe('extractGeminiText', () => {
  it('extracts from parts key', () => {
    expect(extractGeminiText({ parts: [{ text: 'hello' }] })).toBe('hello')
  })
  it('extracts from text key', () => {
    expect(extractGeminiText({ text: 'direct text' })).toBe('direct text')
  })
  it('merges from multiple keys', () => {
    const node = { text: 'a', message: 'b' }
    expect(extractGeminiText(node)).toBe('a\n\nb')
  })
})

describe('extractGeminiParts', () => {
  it('extracts string', () => {
    expect(extractGeminiParts('hello')).toEqual(['hello'])
  })
  it('skips empty string', () => {
    expect(extractGeminiParts('  ')).toEqual([])
  })
  it('extracts from array', () => {
    expect(extractGeminiParts(['hello', 'world'])).toEqual(['hello', 'world'])
  })
  it('extracts text from dict', () => {
    expect(extractGeminiParts({ text: 'hello' })).toEqual(['hello'])
  })
  it('skips thinking blocks', () => {
    expect(extractGeminiParts({ type: 'thinking', text: 'hmm' })).toEqual([])
  })
  it('skips tool_use blocks', () => {
    expect(extractGeminiParts({ type: 'tool_use', text: 'hmm' })).toEqual([])
  })
  it('recurses into parts and content keys', () => {
    const val = { parts: [{ text: 'a' }], content: [{ text: 'b' }] }
    expect(extractGeminiParts(val)).toEqual(['a', 'b'])
  })
  it('returns empty for null', () => {
    expect(extractGeminiParts(null)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findFirstMappingWithKeys
// ---------------------------------------------------------------------------

describe('findFirstMappingWithKeys', () => {
  it('finds first dict with matching keys', () => {
    const data = { a: { sessionId: '123', other: true } }
    const result = findFirstMappingWithKeys(data, new Set(['sessionId']))
    expect(result).toEqual({ sessionId: '123', other: true })
  })
  it('returns top-level if matching', () => {
    const data = { sessionId: '123' }
    expect(findFirstMappingWithKeys(data, new Set(['sessionId']))).toBe(data)
  })
  it('searches in arrays', () => {
    const data = [{ a: 1 }, { sessionId: '123' }]
    expect(findFirstMappingWithKeys(data, new Set(['sessionId']))).toEqual({ sessionId: '123' })
  })
  it('returns null for no match', () => {
    expect(findFirstMappingWithKeys({ a: 1 }, new Set(['missing']))).toBeNull()
  })
  it('returns null for primitive', () => {
    expect(findFirstMappingWithKeys('string', new Set(['key']))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// deduplicateMessages
// ---------------------------------------------------------------------------

describe('deduplicateMessages', () => {
  it('removes duplicate messages', () => {
    const messages = [
      { role: 'user', text: 'hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user', text: 'hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user', text: 'world', timestamp: '2024-01-01T00:00:00Z' },
    ]
    const result = deduplicateMessages(messages)
    expect(result).toHaveLength(2)
    expect(result[0]!.text).toBe('hello')
    expect(result[1]!.text).toBe('world')
  })

  it('keeps first occurrence', () => {
    const messages = [
      { role: 'user', text: 'first', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user', text: 'first', timestamp: '2024-01-01T00:00:00Z' },
    ]
    expect(deduplicateMessages(messages)).toHaveLength(1)
  })

  it('treats different roles as different', () => {
    const messages = [
      { role: 'user', text: 'hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant', text: 'hello', timestamp: '2024-01-01T00:00:00Z' },
    ]
    expect(deduplicateMessages(messages)).toHaveLength(2)
  })

  it('treats different timestamps as different', () => {
    const messages = [
      { role: 'user', text: 'hello', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user', text: 'hello', timestamp: '2024-01-02T00:00:00Z' },
    ]
    expect(deduplicateMessages(messages)).toHaveLength(2)
  })

  it('handles null timestamps', () => {
    const messages = [
      { role: 'user', text: 'hello', timestamp: null },
      { role: 'user', text: 'hello', timestamp: null },
    ]
    expect(deduplicateMessages(messages)).toHaveLength(1)
  })

  it('returns empty for empty input', () => {
    expect(deduplicateMessages([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// deduplicateToolEvents
// ---------------------------------------------------------------------------

describe('deduplicateToolEvents', () => {
  it('removes duplicate events', () => {
    const events = [
      { summary: 'tool input=value', timestamp: '2024-01-01T00:00:00Z' },
      { summary: 'tool input=value', timestamp: '2024-01-01T00:00:00Z' },
      { summary: 'other input=value', timestamp: '2024-01-01T00:00:00Z' },
    ]
    const result = deduplicateToolEvents(events)
    expect(result).toHaveLength(2)
  })

  it('handles null timestamps', () => {
    const events = [
      { summary: 'tool', timestamp: null },
      { summary: 'tool', timestamp: null },
    ]
    expect(deduplicateToolEvents(events)).toHaveLength(1)
  })

  it('treats different timestamps as different', () => {
    const events = [
      { summary: 'tool', timestamp: '2024-01-01T00:00:00Z' },
      { summary: 'tool', timestamp: '2024-01-02T00:00:00Z' },
    ]
    expect(deduplicateToolEvents(events)).toHaveLength(2)
  })
})
