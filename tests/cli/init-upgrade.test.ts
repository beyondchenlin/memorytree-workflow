import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { cmdInit } from '../../src/cli/cmd-init.js'
import { cmdUpgrade } from '../../src/cli/cmd-upgrade.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'memorytree-cli-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('cmdInit', () => {
  it('initializes a repo with auto locale using installed templates and prints the heartbeat next step', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const result = cmdInit({
      root: tmpDir,
      projectName: 'demo-project',
      goalSummary: 'Build a durable project memory workflow.',
      locale: 'auto',
      date: '2025-06-15',
      time: '14:30',
      skipAgents: false,
      force: false,
    })

    expect(result).toBe(0)
    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(tmpDir, 'Memory', '01_goals', 'goal_v001_20250615.md'))).toBe(true)
    expect(existsSync(join(tmpDir, 'Memory', '02_todos', 'todo_v001_001_20250615.md'))).toBe(true)
    expect(existsSync(join(tmpDir, 'Memory', '03_chat_logs', '2025-06-15_14-30.md'))).toBe(true)
    const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('AGENTS.md')
    expect(gitignore).toContain('Memory/**')
    expect(gitignore).toContain('memory/**')

    const output = stdout.mock.calls.map(call => String(call[0])).join('')
    expect(output).toContain('Initialized MemoryTree files in:')
    expect(output).toContain('.gitignore')
    expect(output).toContain('did not register heartbeat')
    expect(output).toContain('memorytree daemon quick-start --root')
    expect(output).toContain('shared source of truth')
    expect(output).toContain('local cache mirror')
  })
})

describe('cmdUpgrade', () => {
  it('upgrades a repo with auto locale using installed templates', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const result = cmdUpgrade({
      root: tmpDir,
      projectName: 'demo-project',
      goalSummary: 'Build a durable project memory workflow.',
      locale: 'auto',
      date: '2025-06-15',
      time: '14:30',
      format: 'json',
    })

    expect(result).toBe(0)
    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(tmpDir, 'Memory', '01_goals', 'goal_v001_20250615.md'))).toBe(true)
    const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('AGENTS.md')
    expect(gitignore).toContain('Memory/**')
    expect(gitignore).toContain('memory/**')

    const output = stdout.mock.calls.map(call => String(call[0])).join('')
    const errorOutput = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(output).toContain('"state_before":"not-installed"')
    expect(output).toContain('"state_after":"installed"')
    expect(errorOutput).toContain('This command updated repository files only.')
    expect(errorOutput).toContain('.gitignore')
    expect(errorOutput).toContain('did not register heartbeat')
    expect(errorOutput).toContain('memorytree daemon quick-start --root')
    expect(errorOutput).toContain('shared source of truth')
    expect(errorOutput).toContain('local cache mirror')
  })

  it('writes scaffolded content from the expected template set and prints the heartbeat next step in text mode', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    writeFileSync(join(tmpDir, 'README.md'), '# Demo Project\n\nThis repository uses English documentation.\n')

    cmdUpgrade({
      root: tmpDir,
      projectName: 'demo-project',
      goalSummary: 'Build a durable project memory workflow.',
      locale: 'auto',
      date: '2025-06-15',
      time: '14:30',
      format: 'text',
    })

    const goal = readFileSync(join(tmpDir, 'Memory', '01_goals', 'goal_v001_20250615.md'), 'utf-8')
    expect(goal).toContain('# Project Goal v001')
    expect(goal).toContain('Build a durable project memory workflow.')

    const output = stdout.mock.calls.map(call => String(call[0])).join('')
    expect(output).toContain('This command updated repository files only.')
    expect(output).toContain('.gitignore')
    expect(output).toContain('did not register heartbeat')
    expect(output).toContain('memorytree daemon quick-start --root')
    expect(output).toContain('shared source of truth')
    expect(output).toContain('local cache mirror')
  })
})
