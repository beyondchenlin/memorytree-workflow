import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock homedir so any internal path helpers (logging, alerts, config, lock)
// all point to a temp directory and don't pollute the real home.
// ---------------------------------------------------------------------------

let tmpDir: string

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpDir,
  }
})

import { scanSensitive } from '../../src/heartbeat/heartbeat.js'
import { _resetLogger, setupLogging } from '../../src/heartbeat/log.js'
import { readAlerts, clearAlerts } from '../../src/heartbeat/alert.js'
import type { ParsedTranscript } from '../../src/types/transcript.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hb-test-'))
  _resetLogger()
  setupLogging('warn') // suppress info/debug noise during tests
})

afterEach(() => {
  clearAlerts()
  _resetLogger()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTranscript(texts: string[]): ParsedTranscript {
  return {
    client: 'claude',
    session_id: 'test-session',
    title: 'Test',
    started_at: '2024-01-01T00:00:00Z',
    cwd: '/tmp/project',
    branch: 'main',
    messages: texts.map(text => ({ role: 'user', text, timestamp: '2024-01-01T00:00:00Z' })),
    tool_events: [],
    source_path: '/tmp/transcript.json',
  }
}

// ---------------------------------------------------------------------------
// scanSensitive — detection
// ---------------------------------------------------------------------------

describe('scanSensitive', () => {
  it('detects API key pattern: api_key = sk-1234567890', () => {
    const parsed = makeTranscript(['Set api_key = sk-1234567890abcdef'])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('sensitive_match')
  })

  it('detects password pattern: password = secret123', () => {
    const parsed = makeTranscript(['password = secret123'])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('sensitive_match')
  })

  it('detects token pattern: token = abc123xyz', () => {
    const parsed = makeTranscript(['secret = my-secret-value'])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('sensitive_match')
  })

  it('detects known secret prefixes: sk-xxxx, ghp_xxxx', () => {
    const parsed = makeTranscript(['Use sk-abcdef1234567890extra'])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('sensitive_match')
  })

  it('detects GitHub PAT prefix: ghp_xxxx', () => {
    clearAlerts()
    const parsed = makeTranscript(['Token ghp_abcdef1234567890extraextra'])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('sensitive_match')
  })

  it('detects Bearer token pattern', () => {
    clearAlerts()
    const parsed = makeTranscript(['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij'])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('sensitive_match')
  })

  it('does not flag normal text without sensitive patterns', () => {
    const parsed = makeTranscript([
      'This is a normal conversation about code.',
      'We discussed the API design for the project.',
      'The function returns a list of tokens from the parser.',
    ])
    scanSensitive(parsed, '/tmp/project')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(0)
  })

  it('stops after first match (returns early)', () => {
    const parsed = makeTranscript([
      'api_key = first-key',
      'password = second-secret',
    ])
    scanSensitive(parsed, '/tmp/project')

    // Should produce exactly one alert (returns after first sensitive match)
    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// SENSITIVE_PATTERNS — individual regex verification
// ---------------------------------------------------------------------------

describe('SENSITIVE_PATTERNS individual patterns', () => {
  it('api_key pattern matches various forms', () => {
    const apiKeyPattern = /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i
    expect(apiKeyPattern.test('api_key = abc123')).toBe(true)
    expect(apiKeyPattern.test('api-key: abc123')).toBe(true)
    expect(apiKeyPattern.test('apikey=abc123')).toBe(true)
    expect(apiKeyPattern.test('APIKEY = ABC')).toBe(true)
    expect(apiKeyPattern.test('no match here')).toBe(false)
  })

  it('password pattern matches password/passwd/pwd', () => {
    const pwdPattern = /(?:password|passwd|pwd)\s*[:=]\s*\S+/i
    expect(pwdPattern.test('password = secret')).toBe(true)
    expect(pwdPattern.test('passwd: hidden')).toBe(true)
    expect(pwdPattern.test('PWD=test123')).toBe(true)
    expect(pwdPattern.test('no match')).toBe(false)
  })

  it('secret/token pattern', () => {
    const secretPattern = /(?:secret|token)\s*[:=]\s*\S+/i
    expect(secretPattern.test('secret = mysecret')).toBe(true)
    expect(secretPattern.test('TOKEN: mytoken')).toBe(true)
    expect(secretPattern.test('no match')).toBe(false)
  })

  it('known prefix pattern matches sk-, ghp_, glpat-, etc.', () => {
    const prefixPattern = /(?:sk-|pk_live_|sk_live_|ghp_|gho_|glpat-)\S{10,}/
    expect(prefixPattern.test('sk-abcdefghij1234567890')).toBe(true)
    expect(prefixPattern.test('ghp_1234567890abcdef')).toBe(true)
    expect(prefixPattern.test('pk_live_xxxxxxxxxx')).toBe(true)
    expect(prefixPattern.test('sk_live_1234567890')).toBe(true)
    expect(prefixPattern.test('gho_1234567890abcdef')).toBe(true)
    expect(prefixPattern.test('glpat-1234567890abcdef')).toBe(true)
    expect(prefixPattern.test('sk-short')).toBe(false) // too short
    expect(prefixPattern.test('normal text')).toBe(false)
  })

  it('Bearer token pattern matches long bearer strings', () => {
    const bearerPattern = /Bearer\s+\S{20,}/i
    expect(bearerPattern.test('Bearer eyJhbGciOiJIUzI1NiJ9abc')).toBe(true)
    expect(bearerPattern.test('bearer AAAAAAAAAAAAAAAAAAAA')).toBe(true)
    expect(bearerPattern.test('Bearer short')).toBe(false)
    expect(bearerPattern.test('no bearer here')).toBe(false)
  })
})
