/**
 * Manage ~/.memorytree/alerts.json — append, dedup, threshold, display.
 * Port of scripts/_alert_utils.py
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_ALERTS = 100

export const ALERT_TYPES: ReadonlySet<string> = new Set([
  'no_remote',
  'sensitive_match',
  'push_failed',
  'lock_held',
])

export const FAILURE_THRESHOLD = 3

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Alert {
  readonly timestamp: string
  readonly project: string
  readonly type: string
  readonly message: string
  readonly count: number
  readonly [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function alertsPath(): string {
  return resolve(homedir(), '.memorytree', 'alerts.json')
}

function failureStatePath(): string {
  return resolve(homedir(), '.memorytree', 'failure_counts.json')
}

// ---------------------------------------------------------------------------
// Timestamp helper (self-contained — no cross-module dependency)
// ---------------------------------------------------------------------------

function utcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ---------------------------------------------------------------------------
// Read / Write alerts
// ---------------------------------------------------------------------------

export function readAlerts(): readonly Alert[] {
  const path = alertsPath()
  if (!existsSync(path)) {
    return []
  }
  try {
    const text = readFileSync(path, 'utf-8')
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) {
      return []
    }
    return data as Alert[]
  } catch {
    return []
  }
}

export function writeAlert(project: string, alertType: string, message: string): void {
  const alerts = readAlerts()
  const now = utcTimestamp()

  let found = false
  const updated: Alert[] = []

  for (const alert of alerts) {
    if (alert.project === project && alert.type === alertType) {
      updated.push({
        ...alert,
        timestamp: now,
        message,
        count: (alert.count ?? 1) + 1,
      })
      found = true
    } else {
      updated.push({ ...alert })
    }
  }

  if (!found) {
    updated.push({ timestamp: now, project, type: alertType, message, count: 1 })
  }

  const trimmed = updated.length > MAX_ALERTS
    ? updated.slice(updated.length - MAX_ALERTS)
    : updated

  saveAlerts(trimmed)
}

// ---------------------------------------------------------------------------
// Threshold-based writes
// ---------------------------------------------------------------------------

export function writeAlertWithThreshold(
  project: string,
  alertType: string,
  message: string,
): void {
  const counts = readFailureCounts()
  const key = `${project}::${alertType}`
  const current = ((counts[key] as number | undefined) ?? 0) + 1
  const newCounts: Record<string, number> = { ...counts, [key]: current }
  saveFailureCounts(newCounts)

  if (current >= FAILURE_THRESHOLD) {
    writeAlert(project, alertType, message)
  }
}

export function resetFailureCount(project: string, alertType: string): void {
  const counts = readFailureCounts()
  const key = `${project}::${alertType}`
  if (key in counts) {
    const newCounts: Record<string, number> = {}
    for (const [k, v] of Object.entries(counts)) {
      if (k !== key) {
        newCounts[k] = v
      }
    }
    saveFailureCounts(newCounts)
  }
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export function clearAlerts(): void {
  const path = alertsPath()
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      // Silently ignore removal errors (matches Python behaviour)
    }
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatAlertsForDisplay(alerts: readonly Record<string, unknown>[]): string {
  if (alerts.length === 0) {
    return ''
  }
  const lines: string[] = []
  for (const alert of alerts) {
    const count = typeof alert['count'] === 'number' ? alert['count'] : 1
    const countSuffix = count > 1 ? ` (x${String(count)})` : ''
    const type = typeof alert['type'] === 'string' ? alert['type'] : 'unknown'
    const project = typeof alert['project'] === 'string' ? alert['project'] : '?'
    const message = typeof alert['message'] === 'string' ? alert['message'] : ''
    lines.push(`  [${type}] ${project}: ${message}${countSuffix}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internal — alerts persistence
// ---------------------------------------------------------------------------

function saveAlerts(alerts: readonly Alert[]): void {
  const path = alertsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(alerts, null, 2) + '\n', 'utf-8')
}

// ---------------------------------------------------------------------------
// Internal — failure counts persistence
// ---------------------------------------------------------------------------

function readFailureCounts(): Record<string, number> {
  const path = failureStatePath()
  if (!existsSync(path)) {
    return {}
  }
  try {
    const text = readFileSync(path, 'utf-8')
    const data: unknown = JSON.parse(text)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return {}
    }
    return data as Record<string, number>
  } catch {
    return {}
  }
}

function saveFailureCounts(counts: Record<string, number>): void {
  const path = failureStatePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(counts, null, 2) + '\n', 'utf-8')
}
