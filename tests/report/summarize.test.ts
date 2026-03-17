import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildSummaryPrompt,
  readCache,
  writeCache,
  getSummary,
} from '../../src/report/summarize.js'
import type { SummaryMessage } from '../../src/report/summarize.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'summarize-test-'))
  // Ensure ANTHROPIC_API_KEY is not set for most tests
  delete process.env['ANTHROPIC_API_KEY']
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env['ANTHROPIC_API_KEY']
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// buildSummaryPrompt
// ---------------------------------------------------------------------------

describe('buildSummaryPrompt', () => {
  it('includes role and text for each message', () => {
    const msgs: SummaryMessage[] = [
      { role: 'user', text: 'Hello world' },
      { role: 'assistant', text: 'Hi there' },
    ]
    const prompt = buildSummaryPrompt(msgs)
    expect(prompt).toContain('USER: Hello world')
    expect(prompt).toContain('ASSISTANT: Hi there')
  })

  it('truncates message text to 500 chars', () => {
    const longText = 'x'.repeat(600)
    const msgs: SummaryMessage[] = [{ role: 'user', text: longText }]
    const prompt = buildSummaryPrompt(msgs)
    const line = prompt.split('\n')[0] ?? ''
    // "USER: " + 500 chars = 506 chars max
    expect(line.length).toBeLessThanOrEqual(506)
  })

  it('limits to first 30 messages', () => {
    const msgs: SummaryMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Message ${i}`,
    }))
    const prompt = buildSummaryPrompt(msgs)
    // Prompt should not contain message 30+
    expect(prompt).not.toContain('Message 30')
    expect(prompt).toContain('Message 29')
  })

  it('handles empty messages array', () => {
    const prompt = buildSummaryPrompt([])
    expect(prompt).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Cache read/write
// ---------------------------------------------------------------------------

describe('readCache / writeCache', () => {
  it('returns null for cache miss', () => {
    const result = readCache('nonexistent-sha256', tmpDir)
    expect(result).toBeNull()
  })

  it('round-trips: write then read', () => {
    writeCache('abc123', 'Great session summary.', tmpDir)
    const result = readCache('abc123', tmpDir)
    expect(result).toBe('Great session summary.')
  })

  it('creates cache file at correct path', () => {
    writeCache('sha256abc', 'some summary', tmpDir)
    expect(existsSync(join(tmpDir, 'sha256abc.json'))).toBe(true)
  })

  it('returns null for corrupted cache file', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(tmpDir, 'bad.json'), 'not json!!!', 'utf-8')
    expect(readCache('bad', tmpDir)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getSummary
// ---------------------------------------------------------------------------

describe('getSummary', () => {
  it('returns cached summary without API call', async () => {
    writeCache('cachedhash', 'Cached result', tmpDir)
    const result = await getSummary('cachedhash', [], {
      cacheDir: tmpDir,
      noAi: false,
      model: 'claude-haiku-4-5-20251001',
    })
    expect(result).toBe('Cached result')
  })

  it('returns empty string when noAi=true', async () => {
    const result = await getSummary('newsha', [], {
      cacheDir: tmpDir,
      noAi: true,
      model: 'claude-haiku-4-5-20251001',
    })
    expect(result).toBe('')
  })

  it('returns empty string when ANTHROPIC_API_KEY not set', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    const result = await getSummary('newsha2', [], {
      cacheDir: tmpDir,
      noAi: false,
      model: 'claude-haiku-4-5-20251001',
    })
    expect(result).toBe('')
  })

  it('prefers cache over API even when key is set', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key'
    writeCache('cachedwithkey', 'Cached!', tmpDir)
    const result = await getSummary('cachedwithkey', [], {
      cacheDir: tmpDir,
      noAi: false,
      model: 'claude-haiku-4-5-20251001',
    })
    expect(result).toBe('Cached!')
  })
})
