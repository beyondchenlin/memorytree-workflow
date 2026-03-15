import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock homedir so lockPath() points to a temp directory
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
  acquireLock,
  releaseLock,
  readLockPid,
  isProcessAlive,
  lockPath,
} from '../../src/heartbeat/lock.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'lock-test-'))
})

afterEach(() => {
  // Always release before cleaning up to avoid leftover lock files
  try {
    releaseLock()
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// lockPath
// ---------------------------------------------------------------------------

describe('lockPath', () => {
  it('returns a path inside <home>/.memorytree/', () => {
    const path = lockPath()
    expect(path).toContain('.memorytree')
    expect(path).toContain('heartbeat.lock')
    expect(path.startsWith(tmpDir)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// acquireLock / releaseLock
// ---------------------------------------------------------------------------

describe('acquireLock / releaseLock', () => {
  it('acquireLock succeeds when no lock exists', () => {
    expect(acquireLock()).toBe(true)
  })

  it('acquireLock fails when lock is held by current process', () => {
    expect(acquireLock()).toBe(true)
    // Second acquire should fail because current PID is alive
    expect(acquireLock()).toBe(false)
  })

  it('releaseLock removes the lock file', () => {
    acquireLock()
    releaseLock()
    expect(existsSync(lockPath())).toBe(false)
  })

  it('acquire succeeds after release', () => {
    expect(acquireLock()).toBe(true)
    releaseLock()
    expect(acquireLock()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// readLockPid
// ---------------------------------------------------------------------------

describe('readLockPid', () => {
  it('returns PID when lock is held', () => {
    acquireLock()
    const pid = readLockPid()
    expect(pid).toBe(process.pid)
  })

  it('returns null when no lock file exists', () => {
    expect(readLockPid()).toBeNull()
  })

  it('returns null for corrupt lock file', () => {
    const path = lockPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'not-a-number')
    expect(readLockPid()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isProcessAlive
// ---------------------------------------------------------------------------

describe('isProcessAlive', () => {
  it('returns true for current process PID', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('returns false for PID 0', () => {
    expect(isProcessAlive(0)).toBe(false)
  })

  it('returns false for negative PID', () => {
    expect(isProcessAlive(-1)).toBe(false)
  })

  it('returns false for very large PID (unlikely to exist)', () => {
    expect(isProcessAlive(9999999)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Stale lock detection
// ---------------------------------------------------------------------------

describe('stale lock detection', () => {
  it('reclaims lock file with dead PID', () => {
    const path = lockPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    // Write a PID that is almost certainly not running
    writeFileSync(path, '9999999')

    // acquireLock should detect the dead PID and reclaim
    expect(acquireLock()).toBe(true)

    // Verify the lock now belongs to us
    expect(readLockPid()).toBe(process.pid)
  })

  it('reclaims lock with corrupt content', () => {
    const path = lockPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'garbage-content')

    expect(acquireLock()).toBe(true)
    expect(readLockPid()).toBe(process.pid)
  })
})
