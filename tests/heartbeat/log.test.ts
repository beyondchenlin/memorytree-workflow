import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock homedir so log files go to a temp directory
// ---------------------------------------------------------------------------

let tmpDir: string

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpDir,
  }
})

import {
  setupLogging,
  getLogger,
  _resetLogger,
} from '../../src/heartbeat/log.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'log-test-'))
  _resetLogger()
})

afterEach(() => {
  _resetLogger()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLogFile(): string | undefined {
  const logsDir = join(tmpDir, '.memorytree', 'logs')
  try {
    const files = readdirSync(logsDir)
    return files.find(f => f.startsWith('heartbeat-') && f.endsWith('.log'))
  } catch {
    return undefined
  }
}

function readLogContents(): string {
  const logsDir = join(tmpDir, '.memorytree', 'logs')
  const file = findLogFile()
  if (!file) return ''
  return readFileSync(join(logsDir, file), 'utf-8')
}

// ---------------------------------------------------------------------------
// setupLogging
// ---------------------------------------------------------------------------

describe('setupLogging', () => {
  it('returns a Logger with all required methods', () => {
    const logger = setupLogging('info')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.exception).toBe('function')
  })

  it('writes log messages to a file', () => {
    const logger = setupLogging('info')
    logger.info('test message from setupLogging')

    const contents = readLogContents()
    expect(contents).toContain('test message from setupLogging')
    expect(contents).toContain('[INFO]')
  })
})

// ---------------------------------------------------------------------------
// getLogger
// ---------------------------------------------------------------------------

describe('getLogger', () => {
  it('returns the same instance as setupLogging', () => {
    const logger1 = setupLogging('info')
    const logger2 = getLogger()
    // Both should be the same singleton
    expect(logger2).toBe(logger1)
  })

  it('auto-creates a logger if setupLogging was not called', () => {
    const logger = getLogger()
    expect(typeof logger.info).toBe('function')
    // Should still be able to write
    logger.info('auto-created logger message')
    const contents = readLogContents()
    expect(contents).toContain('auto-created logger message')
  })
})

// ---------------------------------------------------------------------------
// Log level filtering
// ---------------------------------------------------------------------------

describe('log level filtering', () => {
  it('filters debug messages when level is info', () => {
    const logger = setupLogging('info')
    logger.debug('this should be filtered')
    logger.info('this should appear')

    const contents = readLogContents()
    expect(contents).not.toContain('this should be filtered')
    expect(contents).toContain('this should appear')
  })

  it('includes debug messages when level is debug', () => {
    const logger = setupLogging('debug')
    logger.debug('debug message visible')

    const contents = readLogContents()
    expect(contents).toContain('debug message visible')
    expect(contents).toContain('[DEBUG]')
  })
})

// ---------------------------------------------------------------------------
// Log file path includes date
// ---------------------------------------------------------------------------

describe('log file naming', () => {
  it('log file name includes today date in YYYY-MM-DD format', () => {
    setupLogging('info')
    getLogger().info('trigger file creation')

    const fileName = findLogFile()
    expect(fileName).toBeTruthy()
    // File should match heartbeat-YYYY-MM-DD.log
    expect(fileName).toMatch(/^heartbeat-\d{4}-\d{2}-\d{2}\.log$/)
  })
})
