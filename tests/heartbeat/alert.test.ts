import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock homedir so alertsPath() / failureStatePath() point to temp directory
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
  readAlerts,
  writeAlert,
  writeAlertWithThreshold,
  resetFailureCount,
  clearAlerts,
  formatAlertsForDisplay,
  alertsPath,
  MAX_ALERTS,
  FAILURE_THRESHOLD,
} from '../../src/heartbeat/alert.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'alert-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// alertsPath
// ---------------------------------------------------------------------------

describe('alertsPath', () => {
  it('returns a path inside <home>/.memorytree/', () => {
    const path = alertsPath()
    expect(path).toContain('.memorytree')
    expect(path).toContain('alerts.json')
    expect(path.startsWith(tmpDir)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// readAlerts
// ---------------------------------------------------------------------------

describe('readAlerts', () => {
  it('returns empty array when file does not exist', () => {
    expect(readAlerts()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// writeAlert
// ---------------------------------------------------------------------------

describe('writeAlert', () => {
  it('creates a new alert', () => {
    writeAlert('my-project', 'push_failed', 'Push timed out')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.project).toBe('my-project')
    expect(alerts[0]!.type).toBe('push_failed')
    expect(alerts[0]!.message).toBe('Push timed out')
    expect(alerts[0]!.count).toBe(1)
    expect(alerts[0]!.timestamp).toBeTruthy()
  })

  it('deduplicates: updates count for same project+type', () => {
    writeAlert('proj', 'push_failed', 'first error')
    writeAlert('proj', 'push_failed', 'second error')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.count).toBe(2)
    expect(alerts[0]!.message).toBe('second error')
  })

  it('does not merge alerts with different types', () => {
    writeAlert('proj', 'push_failed', 'msg1')
    writeAlert('proj', 'no_remote', 'msg2')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(2)
  })

  it('does not merge alerts with different projects', () => {
    writeAlert('proj-a', 'push_failed', 'msg1')
    writeAlert('proj-b', 'push_failed', 'msg2')

    const alerts = readAlerts()
    expect(alerts).toHaveLength(2)
  })

  it('caps alerts at MAX_ALERTS', () => {
    // Write MAX_ALERTS + 10 unique alerts
    for (let i = 0; i < MAX_ALERTS + 10; i++) {
      writeAlert(`proj-${i}`, 'push_failed', `msg-${i}`)
    }

    const alerts = readAlerts()
    expect(alerts.length).toBeLessThanOrEqual(MAX_ALERTS)
  })
})

// ---------------------------------------------------------------------------
// writeAlertWithThreshold
// ---------------------------------------------------------------------------

describe('writeAlertWithThreshold', () => {
  it('does not write alert until threshold is reached', () => {
    // Write FAILURE_THRESHOLD - 1 times (below threshold)
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      writeAlertWithThreshold('proj', 'push_failed', 'msg')
    }
    expect(readAlerts()).toHaveLength(0)

    // One more call reaches the threshold
    writeAlertWithThreshold('proj', 'push_failed', 'msg')
    expect(readAlerts()).toHaveLength(1)
  })

  it('writes on every subsequent call after threshold', () => {
    // Reach threshold
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      writeAlertWithThreshold('proj', 'push_failed', 'msg')
    }
    expect(readAlerts()).toHaveLength(1)

    // One more increments beyond threshold, still writes (updates count)
    writeAlertWithThreshold('proj', 'push_failed', 'msg again')
    const alerts = readAlerts()
    expect(alerts).toHaveLength(1)
    // Count should reflect the dedup in writeAlert
    expect(alerts[0]!.count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// resetFailureCount
// ---------------------------------------------------------------------------

describe('resetFailureCount', () => {
  it('resets the failure counter so threshold check restarts', () => {
    // Accumulate failures below threshold
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      writeAlertWithThreshold('proj', 'push_failed', 'msg')
    }

    resetFailureCount('proj', 'push_failed')

    // After reset, need FAILURE_THRESHOLD calls again to write
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      writeAlertWithThreshold('proj', 'push_failed', 'msg')
    }
    expect(readAlerts()).toHaveLength(0)
  })

  it('does nothing if key does not exist', () => {
    // Should not throw
    expect(() => resetFailureCount('nonexistent', 'push_failed')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// clearAlerts
// ---------------------------------------------------------------------------

describe('clearAlerts', () => {
  it('removes all alerts', () => {
    writeAlert('proj', 'push_failed', 'msg')
    expect(readAlerts()).toHaveLength(1)

    clearAlerts()
    expect(readAlerts()).toEqual([])
  })

  it('does nothing if no alerts file exists', () => {
    expect(() => clearAlerts()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// formatAlertsForDisplay
// ---------------------------------------------------------------------------

describe('formatAlertsForDisplay', () => {
  it('returns empty string for empty array', () => {
    expect(formatAlertsForDisplay([])).toBe('')
  })

  it('formats a single alert', () => {
    const result = formatAlertsForDisplay([
      { type: 'push_failed', project: 'my-proj', message: 'Push timed out', count: 1 },
    ])
    expect(result).toContain('[push_failed]')
    expect(result).toContain('my-proj')
    expect(result).toContain('Push timed out')
    // count=1 should NOT show suffix
    expect(result).not.toContain('(x1)')
  })

  it('shows count suffix when count > 1', () => {
    const result = formatAlertsForDisplay([
      { type: 'push_failed', project: 'proj', message: 'err', count: 5 },
    ])
    expect(result).toContain('(x5)')
  })

  it('formats multiple alerts on separate lines', () => {
    const result = formatAlertsForDisplay([
      { type: 'push_failed', project: 'proj-a', message: 'err1', count: 1 },
      { type: 'no_remote', project: 'proj-b', message: 'err2', count: 3 },
    ])
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('proj-a')
    expect(lines[1]).toContain('proj-b')
    expect(lines[1]).toContain('(x3)')
  })
})
