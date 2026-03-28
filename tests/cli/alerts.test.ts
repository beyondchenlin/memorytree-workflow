import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tmpDir: string

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpDir,
  }
})

import { readAlerts, writeAlert } from '../../src/heartbeat/alert.js'
import { cmdAlerts } from '../../src/cli/cmd-alerts.js'

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'memorytree-alerts-cli-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('cmdAlerts', () => {
  it('displays pending alerts and clears them by default', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    writeAlert('demo-project', 'push_failed', 'Push failed after retry.')

    const result = cmdAlerts()

    expect(result).toBe(0)
    expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('Pending alerts:')
    expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('[push_failed]')
    expect(readAlerts()).toEqual([])
    expect(existsSync(join(tmpDir, '.memorytree', 'alerts.json'))).toBe(false)
  })

  it('can keep alerts on disk when requested', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    writeAlert('demo-project', 'sensitive_match', 'Sensitive pattern in transcript: test.jsonl')

    const result = cmdAlerts({ clear: false })

    expect(result).toBe(0)
    expect(readAlerts()).toHaveLength(1)
  })
})
