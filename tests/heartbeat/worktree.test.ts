import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sandboxRoot: string
let developmentPath: string
let memoryPath: string
let commonDir: string
let commonAlias: string

beforeEach(() => {
  sandboxRoot = mkdtempSync(join(tmpdir(), 'memorytree-worktree-test-'))
  developmentPath = join(sandboxRoot, 'repo')
  memoryPath = join(sandboxRoot, 'memory-worktree')
  commonDir = join(sandboxRoot, 'common')
  commonAlias = join(sandboxRoot, 'common-alias')

  mkdirSync(developmentPath, { recursive: true })
  mkdirSync(memoryPath, { recursive: true })
  mkdirSync(commonDir, { recursive: true })
  symlinkSync(commonDir, commonAlias, process.platform === 'win32' ? 'junction' : 'dir')
})

afterEach(() => {
  rmSync(sandboxRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('ensureProjectWorktree', () => {
  it('accepts equivalent git common-dir paths that differ by alias or canonical form', async () => {
    vi.doMock('../../src/utils/exec.js', () => ({
      git: (cwd: string, ...args: string[]) => {
        if (cwd === developmentPath && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
          return `${developmentPath}\n`
        }
        if (cwd === memoryPath && args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === 'HEAD') {
          return 'memorytree\n'
        }
        throw new Error(`Unexpected git call: ${cwd} ${args.join(' ')}`)
      },
      execCommand: (_command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel' && options?.cwd === memoryPath) {
          return `${memoryPath}\n`
        }
        if (args[0] === 'rev-parse' && args[1] === '--git-common-dir' && options?.cwd === developmentPath) {
          return `${commonDir}\n`
        }
        if (args[0] === 'rev-parse' && args[1] === '--git-common-dir' && options?.cwd === memoryPath) {
          return `${commonAlias}\n`
        }
        if (args[0] === 'check-ref-format' && args[1] === '--branch' && args[2] === 'memorytree') {
          return 'memorytree\n'
        }
        if (args[0] === 'rev-parse' && args[1] === '--verify') {
          return ''
        }
        throw new Error(`Unexpected execCommand call: ${args.join(' ')}`)
      },
    }))

    const { ensureProjectWorktree } = await import('../../src/heartbeat/worktree.js')

    const result = ensureProjectWorktree({
      development_path: developmentPath,
      memory_path: memoryPath,
      memory_branch: 'memorytree',
    } as never)

    expect(result).toEqual({
      branch: 'memorytree',
      created: false,
    })
  })
})
