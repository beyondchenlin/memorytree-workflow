/**
 * Logging setup for heartbeat — file output + stderr.
 * Port of scripts/_log_utils.py
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  exception(msg: string, err?: unknown): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_LABELS: Readonly<Record<LogLevel, string>> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let singleton: MemoryTreeLogger | undefined

// ---------------------------------------------------------------------------
// MemoryTreeLogger
// ---------------------------------------------------------------------------

class MemoryTreeLogger implements Logger {
  private readonly levelPriority: number
  private readonly logFilePath: string | undefined

  constructor(logLevel: LogLevel) {
    this.levelPriority = LEVEL_PRIORITY[logLevel]

    const filePath = logFilePathForToday()
    const logDir = resolve(filePath, '..')
    try {
      mkdirSync(logDir, { recursive: true })
      // Verify we can write by doing nothing — the first real append will
      // confirm access.  We store the path only after the dir exists.
      this.logFilePath = filePath
    } catch {
      // Cannot create log directory — stderr-only mode.
      this.writeStderr('WARN', `Could not open log file: ${filePath}`)
      this.logFilePath = undefined
    }
  }

  debug(msg: string): void {
    this.log('debug', msg)
  }

  info(msg: string): void {
    this.log('info', msg)
  }

  warn(msg: string): void {
    this.log('warn', msg)
  }

  error(msg: string): void {
    this.log('error', msg)
  }

  exception(msg: string, err?: unknown): void {
    if (err instanceof Error && err.stack) {
      this.log('error', `${msg}\n${err.stack}`)
    } else if (err !== undefined) {
      this.log('error', `${msg}\n${String(err)}`)
    } else {
      this.log('error', msg)
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private log(level: LogLevel, msg: string): void {
    if (LEVEL_PRIORITY[level] < this.levelPriority) {
      return
    }

    const label = LEVEL_LABELS[level]
    const formatted = `${timestamp()} [${label}] ${msg}`

    this.writeStderr(label, msg)
    this.writeFile(formatted)
  }

  private writeStderr(_label: string, _msg: string): void {
    // Use the pre-formatted line for consistency.  We rebuild here so the
    // standalone warning in the constructor can also call this without a
    // full formatted line.
    const line = `${timestamp()} [${_label}] ${_msg}\n`
    process.stderr.write(line)
  }

  private writeFile(formatted: string): void {
    if (this.logFilePath === undefined) {
      return
    }
    try {
      appendFileSync(this.logFilePath, formatted + '\n', 'utf-8')
    } catch {
      // Silently ignore file-write errors — stderr is the primary channel.
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create (or return existing) singleton logger.
 *
 * The `logLevel` parameter is only used on the *first* call.  Subsequent
 * calls return the existing logger regardless of the level argument.
 */
export function setupLogging(logLevel: LogLevel = 'info'): Logger {
  if (singleton !== undefined) {
    return singleton
  }
  singleton = new MemoryTreeLogger(resolveLevel(logLevel))
  return singleton
}

/**
 * Return the singleton logger.  If `setupLogging` has not been called yet
 * the logger is auto-created with default settings (`info` level).
 */
export function getLogger(): Logger {
  if (singleton === undefined) {
    singleton = new MemoryTreeLogger(resolveLevel('info'))
  }
  return singleton
}

/**
 * Reset the singleton — primarily useful for tests.
 */
export function _resetLogger(): void {
  singleton = undefined
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveLevel(level: string): LogLevel {
  const lower = level.toLowerCase()
  const mapping: Record<string, LogLevel> = {
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    warning: 'warn',
    error: 'error',
  }
  return mapping[lower] ?? 'info'
}

function logFilePathForToday(): string {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD in UTC
  return resolve(homedir(), '.memorytree', 'logs', `heartbeat-${today}.log`)
}

function timestamp(): string {
  // Produce YYYY-MM-DDTHH:MM:SS in UTC matching the Python datefmt.
  const now = new Date()
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const mi = String(now.getUTCMinutes()).padStart(2, '0')
  const s = String(now.getUTCSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}
