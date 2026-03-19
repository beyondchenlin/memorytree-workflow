import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  projectUsesIsolatedMemoryPath,
  syncProjectContextToMemory,
  syncProjectOutputsToDevelopment,
} from '../../src/heartbeat/sync.js'
import type { ProjectEntry } from '../../src/heartbeat/config.js'

let sandbox: string
let developmentPath: string
let memoryPath: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'memorytree-sync-'))
  developmentPath = join(sandbox, 'dev')
  memoryPath = join(sandbox, 'memory')
  mkdirSync(developmentPath, { recursive: true })
  mkdirSync(memoryPath, { recursive: true })
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('projectUsesIsolatedMemoryPath', () => {
  it('returns false when development and memory paths are the same', () => {
    expect(projectUsesIsolatedMemoryPath(makeProject(developmentPath, developmentPath))).toBe(false)
  })
})

describe('syncProjectContextToMemory', () => {
  it('copies AGENTS and Memory/01-05 into the memory worktree and removes stale managed files', () => {
    writeFileSync(join(developmentPath, 'AGENTS.md'), '# repo policy\n', 'utf-8')
    mkdirSync(join(developmentPath, 'Memory', '01_goals'), { recursive: true })
    mkdirSync(join(developmentPath, 'Memory', '02_todos'), { recursive: true })
    writeFileSync(join(developmentPath, 'Memory', '01_goals', 'goal.md'), 'goal\n', 'utf-8')
    writeFileSync(join(developmentPath, 'Memory', '02_todos', 'todo.md'), 'todo\n', 'utf-8')

    mkdirSync(join(memoryPath, 'Memory', '05_archive'), { recursive: true })
    writeFileSync(join(memoryPath, 'Memory', '05_archive', 'stale.md'), 'stale\n', 'utf-8')

    const stats = syncProjectContextToMemory(makeProject(developmentPath, memoryPath))

    expect(readFileSync(join(memoryPath, 'AGENTS.md'), 'utf-8')).toContain('# repo policy')
    expect(readFileSync(join(memoryPath, 'Memory', '01_goals', 'goal.md'), 'utf-8')).toBe('goal\n')
    expect(readFileSync(join(memoryPath, 'Memory', '02_todos', 'todo.md'), 'utf-8')).toBe('todo\n')
    expect(existsSync(join(memoryPath, 'Memory', '05_archive', 'stale.md'))).toBe(false)
    expect(stats.copied).toBeGreaterThanOrEqual(3)
    expect(stats.deleted).toBe(1)
  })
})

describe('syncProjectOutputsToDevelopment', () => {
  it('copies Memory/06-07 back into the development directory and prunes stale output files', () => {
    mkdirSync(join(memoryPath, 'Memory', '06_transcripts', 'clean'), { recursive: true })
    mkdirSync(join(memoryPath, 'Memory', '07_reports'), { recursive: true })
    writeFileSync(join(memoryPath, 'Memory', '06_transcripts', 'clean', 'session.md'), 'session\n', 'utf-8')
    writeFileSync(join(memoryPath, 'Memory', '07_reports', 'index.html'), '<html></html>\n', 'utf-8')

    mkdirSync(join(developmentPath, 'Memory', '07_reports', 'old'), { recursive: true })
    writeFileSync(join(developmentPath, 'Memory', '07_reports', 'old', 'stale.html'), 'stale\n', 'utf-8')

    const stats = syncProjectOutputsToDevelopment(makeProject(developmentPath, memoryPath))

    expect(readFileSync(join(developmentPath, 'Memory', '06_transcripts', 'clean', 'session.md'), 'utf-8')).toBe('session\n')
    expect(readFileSync(join(developmentPath, 'Memory', '07_reports', 'index.html'), 'utf-8')).toBe('<html></html>\n')
    expect(existsSync(join(developmentPath, 'Memory', '07_reports', 'old', 'stale.html'))).toBe(false)
    expect(stats.copied).toBeGreaterThanOrEqual(2)
    expect(stats.deleted).toBe(1)
  })
})

function makeProject(devPath: string, memPath: string): ProjectEntry {
  return {
    id: 'demo',
    path: memPath,
    name: 'demo',
    development_path: devPath,
    memory_path: memPath,
    heartbeat_interval: '5m',
    refresh_interval: '30m',
    auto_push: true,
    generate_report: true,
    ai_summary_model: 'claude-haiku-4-5-20251001',
    locale: 'en',
    gh_pages_branch: '',
    cname: '',
    webhook_url: '',
    report_base_url: '',
    report_port: 10010,
    last_heartbeat_at: '',
    last_refresh_at: '',
  }
}
