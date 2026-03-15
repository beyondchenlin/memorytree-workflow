/**
 * PID-based lock file for heartbeat single-instance enforcement.
 * Port of scripts/_lock_utils.py
 */

import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function lockPath(): string {
  return resolve(homedir(), '.memorytree', 'heartbeat.lock')
}

// ---------------------------------------------------------------------------
// Lock acquisition
// ---------------------------------------------------------------------------

/**
 * Try to acquire the heartbeat lock. Returns `true` on success.
 *
 * If the lock file already exists, the stored PID is checked:
 * - alive process  -> return false (already running)
 * - dead process   -> reclaim the stale lock
 * - corrupt file   -> remove and retry
 *
 * Uses `O_CREAT | O_EXCL` to prevent TOCTOU races.
 */
export function acquireLock(): boolean {
  const path = lockPath()
  mkdirSync(dirname(path), { recursive: true })

  if (existsSync(path)) {
    let storedPid: number | undefined
    try {
      const raw = readFileSync(path, 'utf-8').trim()
      storedPid = parseInt(raw, 10)
      if (!Number.isFinite(storedPid)) {
        storedPid = undefined
      }
    } catch {
      // Corrupt lock file — treat as stale
      storedPid = undefined
    }

    if (storedPid === undefined) {
      // Corrupt or unreadable lock file — remove it
      removeLockFile(path)
    } else {
      if (isProcessAlive(storedPid)) {
        return false
      }
      // Stale lock from a dead process — reclaim
      removeLockFile(path)
    }
  }

  // Use exclusive create to prevent TOCTOU race
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
    const pidBytes = Buffer.from(String(process.pid), 'utf-8')
    writeSync(fd, pidBytes)
    closeSync(fd)
  } catch {
    // Another process created the lock between our check and create,
    // or an OS-level I/O error occurred.
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Lock release
// ---------------------------------------------------------------------------

/** Release the heartbeat lock. */
export function releaseLock(): void {
  removeLockFile(lockPath())
}

// ---------------------------------------------------------------------------
// Lock inspection
// ---------------------------------------------------------------------------

/** Read the PID from the lock file, or `null` if not locked / corrupt. */
export function readLockPid(): number | null {
  const path = lockPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = readFileSync(path, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Process liveness
// ---------------------------------------------------------------------------

/** Check whether a process with the given PID is still running. */
export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) {
    return false
  }
  if (process.platform === 'win32') {
    return isProcessAliveWindows(pid)
  }
  return isProcessAliveUnix(pid)
}

function isProcessAliveUnix(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      // EPERM means the process exists but we lack permission to signal it
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        return true
      }
    }
    // ESRCH or any other error means the process does not exist
    return false
  }
}

function isProcessAliveWindows(pid: number): boolean {
  try {
    const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    })
    // tasklist prints "INFO: No tasks are running..." when no match is found.
    // Use word-boundary regex to avoid substring false positives (e.g., PID 12 matching 312).
    return new RegExp(`\\b${pid}\\b`).test(output)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function removeLockFile(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Ignore errors — file may already be gone
  }
}
