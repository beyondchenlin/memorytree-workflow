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

  it('creates the memorytree branch automatically when the dedicated worktree does not exist yet', async () => {
    const freshMemoryPath = join(sandboxRoot, 'fresh-memory-worktree')
    const gitMock = vi.fn((cwd: string, ...args: string[]) => {
      if (cwd === developmentPath && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return `${developmentPath}\n`
      }
      if (
        cwd === developmentPath
        && args[0] === 'worktree'
        && args[1] === 'add'
        && args[2] === '-b'
        && args[3] === 'memorytree'
        && args[4] === freshMemoryPath
        && args[5] === 'HEAD'
      ) {
        return ''
      }
      throw new Error(`Unexpected git call: ${cwd} ${args.join(' ')}`)
    })

    vi.doMock('../../src/utils/exec.js', () => ({
      git: gitMock,
      execCommand: (_command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
        if (args[0] === 'rev-parse' && args[1] === '--git-common-dir' && options?.cwd === developmentPath) {
          return `${commonDir}\n`
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
      memory_path: freshMemoryPath,
      memory_branch: 'memorytree',
    } as never)

    expect(result).toEqual({
      branch: 'memorytree',
      created: true,
    })
    expect(gitMock).toHaveBeenCalledWith(
      developmentPath,
      'worktree',
      'add',
      '-b',
      'memorytree',
      freshMemoryPath,
      'HEAD',
    )
  })
})

describe('ensureBranchUpstream', () => {
  it('falls back from GitHub SSH push URLs to HTTPS when the SSH push fails', async () => {
    vi.doMock('../../src/utils/exec.js', () => ({
      git: (cwd: string, ...args: string[]) => {
        if (cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${cwd}`)
        }
        if (args[0] === 'remote') {
          return 'origin\n'
        }
        if (args[0] === 'push' && args[1] === '-u' && args[2] === 'origin' && args[3] === 'memorytree') {
          const error = new Error('Command failed: git push -u origin memorytree')
          Object.assign(error, {
            stderr: 'Host key verification failed.\nfatal: Could not read from remote repository.\n',
          })
          throw error
        }
        throw new Error(`Unexpected git call: ${args.join(' ')}`)
      },
      execCommand: (_command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
        if (options?.cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${options?.cwd}`)
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
          return 'https://github.com/example/repo.git\n'
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === '--push' && args[3] === 'origin') {
          return 'ssh://git@ssh.github.com:443/example/repo.git\n'
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') {
          return ''
        }
        if (
          args[0] === '-c'
          && args[1] === 'remote.origin.pushurl=https://github.com/example/repo.git'
          && args[2] === 'push'
          && args[3] === '-u'
          && args[4] === 'origin'
          && args[5] === 'memorytree'
        ) {
          return ''
        }
        throw new Error(`Unexpected execCommand call: ${args.join(' ')}`)
      },
    }))

    const { ensureBranchUpstream } = await import('../../src/heartbeat/worktree.js')

    const result = ensureBranchUpstream(developmentPath, 'memorytree')

    expect(result).toEqual({
      remote: 'origin',
      created: true,
      pushUrl: 'https://github.com/example/repo.git',
      transport: 'https',
      usedFallback: true,
    })
  })

  it('reports both the primary and fallback push failures when fallback also fails', async () => {
    vi.doMock('../../src/utils/exec.js', () => ({
      git: (cwd: string, ...args: string[]) => {
        if (cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${cwd}`)
        }
        if (args[0] === 'remote') {
          return 'origin\n'
        }
        if (args[0] === 'push' && args[1] === '-u' && args[2] === 'origin' && args[3] === 'memorytree') {
          const error = new Error('Command failed: git push -u origin memorytree')
          Object.assign(error, {
            stderr: 'Host key verification failed.\nfatal: Could not read from remote repository.\n',
          })
          throw error
        }
        throw new Error(`Unexpected git call: ${args.join(' ')}`)
      },
      execCommand: (_command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
        if (options?.cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${options?.cwd}`)
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
          return 'https://github.com/example/repo.git\n'
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === '--push' && args[3] === 'origin') {
          return 'ssh://git@ssh.github.com:443/example/repo.git\n'
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') {
          return ''
        }
        if (
          args[0] === '-c'
          && args[1] === 'remote.origin.pushurl=https://github.com/example/repo.git'
          && args[2] === 'push'
          && args[3] === '-u'
          && args[4] === 'origin'
          && args[5] === 'memorytree'
        ) {
          const error = new Error('Command failed: git -c remote.origin.pushurl=https://github.com/example/repo.git push -u origin memorytree')
          Object.assign(error, {
            stderr: 'Authentication failed for https://github.com/example/repo.git\n',
          })
          throw error
        }
        throw new Error(`Unexpected execCommand call: ${args.join(' ')}`)
      },
    }))

    const { ensureBranchUpstream } = await import('../../src/heartbeat/worktree.js')

    let thrown: unknown = null
    try {
      ensureBranchUpstream(developmentPath, 'memorytree')
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('Primary push URL: ssh://git@ssh.github.com:443/example/repo.git')
    expect((thrown as Error).message).toContain('Fallback push URL: https://github.com/example/repo.git')
    expect((thrown as Error).message).toContain('Host key verification failed.')
    expect((thrown as Error).message).toContain('Authentication failed for https://github.com/example/repo.git')
  })

  it('redacts credentials from failure details', async () => {
    vi.doMock('../../src/utils/exec.js', () => ({
      git: (cwd: string, ...args: string[]) => {
        if (cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${cwd}`)
        }
        if (args[0] === 'remote') {
          return 'origin\n'
        }
        if (args[0] === 'push' && args[1] === '-u' && args[2] === 'origin' && args[3] === 'memorytree') {
          const error = new Error('Command failed: git push -u origin memorytree')
          Object.assign(error, {
            stderr: 'Authentication failed for https://x-access-token:super-secret-token@example.internal/repo.git\n',
          })
          throw error
        }
        throw new Error(`Unexpected git call: ${args.join(' ')}`)
      },
      execCommand: (_command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
        if (options?.cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${options?.cwd}`)
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
          return 'https://x-access-token:super-secret-token@example.internal/repo.git\n'
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === '--push' && args[3] === 'origin') {
          return 'https://x-access-token:super-secret-token@example.internal/repo.git\n'
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') {
          return ''
        }
        throw new Error(`Unexpected execCommand call: ${args.join(' ')}`)
      },
    }))

    const { ensureBranchUpstream } = await import('../../src/heartbeat/worktree.js')

    let thrown: unknown = null
    try {
      ensureBranchUpstream(developmentPath, 'memorytree')
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('Primary push URL: https://***@example.internal/repo.git')
    expect((thrown as Error).message).not.toContain('super-secret-token')
  })
})

describe('pushBranchToRemote', () => {
  it('preserves the existing tracking upstream semantics by using plain git push', async () => {
    const gitMock = vi.fn((cwd: string, ...args: string[]) => {
      if (cwd !== developmentPath) {
        throw new Error(`Unexpected cwd: ${cwd}`)
      }
      if (args[0] === 'push') {
        return ''
      }
      if (args[0] === 'remote') {
        return 'origin\n'
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`)
    })

    vi.doMock('../../src/utils/exec.js', () => ({
      git: gitMock,
      execCommand: (_command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
        if (options?.cwd !== developmentPath) {
          throw new Error(`Unexpected cwd: ${options?.cwd}`)
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === '--symbolic-full-name') {
          return 'origin/memorytree-remote\n'
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
          return 'https://github.com/example/repo.git\n'
        }
        if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === '--push' && args[3] === 'origin') {
          return 'https://github.com/example/repo.git\n'
        }
        throw new Error(`Unexpected execCommand call: ${args.join(' ')}`)
      },
    }))

    const { pushBranchToRemote } = await import('../../src/heartbeat/worktree.js')

    const result = pushBranchToRemote(developmentPath, 'memorytree')

    expect(result).toEqual({
      remote: 'origin',
      pushUrl: 'https://github.com/example/repo.git',
      transport: 'https',
      usedFallback: false,
    })
    expect(gitMock).toHaveBeenCalledWith(developmentPath, 'push')
    expect(gitMock).not.toHaveBeenCalledWith(developmentPath, 'push', 'origin', 'memorytree')
  })
})
