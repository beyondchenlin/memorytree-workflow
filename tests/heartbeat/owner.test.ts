import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
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

import {
  clearHeartbeatOwner,
  detectHeartbeatOwner,
  heartbeatOwnerPath,
  readHeartbeatOwner,
  writeHeartbeatOwner,
} from '../../src/heartbeat/owner.js'

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'heartbeat-owner-test-'))
})

afterEach(() => {
  clearHeartbeatOwner()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('detectHeartbeatOwner', () => {
  it('infers Claude Code from a Claude skill path', () => {
    const owner = detectHeartbeatOwner({
      skillRoot: 'C:/Users/ai/.claude/skills/memorytree-workflow',
      scriptPath: 'C:/Users/ai/.claude/skills/memorytree-workflow/dist/cli.js',
      acquiredAt: '2026-03-28T13:00:00.000Z',
    })

    expect(owner.owner_id).toBe('claude')
    expect(owner.owner_label).toBe('Claude Code')
    expect(owner.skill_root).toContain('/.claude/skills/')
  })

  it('infers Codex from a Codex skill path', () => {
    const owner = detectHeartbeatOwner({
      skillRoot: 'C:/Users/ai/.codex/skills/memorytree-workflow',
      scriptPath: 'C:/Users/ai/.codex/skills/memorytree-workflow/dist/cli.js',
      acquiredAt: '2026-03-28T13:05:00.000Z',
    })

    expect(owner.owner_id).toBe('codex')
    expect(owner.owner_label).toBe('Codex')
    expect(owner.script_path).toContain('/.codex/skills/')
  })

  it('infers owner from script path without requiring a resolved skill root', () => {
    const owner = detectHeartbeatOwner({
      scriptPath: 'C:/Users/ai/.codex/skills/memorytree-workflow/dist/cli.js',
      acquiredAt: '2026-03-28T13:06:00.000Z',
    })

    expect(owner.owner_id).toBe('codex')
    expect(owner.owner_label).toBe('Codex')
    expect(owner.skill_root).toBe('C:/Users/ai/.codex/skills/memorytree-workflow')
  })
})

describe('heartbeat owner state', () => {
  it('stores the current owner under ~/.memorytree', () => {
    const owner = detectHeartbeatOwner({
      skillRoot: 'C:/Users/ai/.codex/skills/memorytree-workflow',
      scriptPath: 'C:/Users/ai/.codex/skills/memorytree-workflow/dist/cli.js',
      acquiredAt: '2026-03-28T13:10:00.000Z',
    })

    writeHeartbeatOwner(owner)

    expect(existsSync(heartbeatOwnerPath())).toBe(true)
    expect(readHeartbeatOwner()).toEqual(owner)
  })

  it('clears the owner file when requested', () => {
    const owner = detectHeartbeatOwner({
      skillRoot: 'C:/Users/ai/.claude/skills/memorytree-workflow',
      scriptPath: 'C:/Users/ai/.claude/skills/memorytree-workflow/dist/cli.js',
      acquiredAt: '2026-03-28T13:15:00.000Z',
    })

    writeHeartbeatOwner(owner)
    clearHeartbeatOwner()

    expect(readHeartbeatOwner()).toBeNull()
    expect(existsSync(heartbeatOwnerPath())).toBe(false)
  })
})
