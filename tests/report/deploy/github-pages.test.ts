import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('../../../src/heartbeat/log.js', () => ({
  getLogger: () => logger,
}))

import { execFileSync } from 'node:child_process'
import { deployGithubPages } from '../../../src/report/deploy/github-pages.js'

let tmpDir: string
let outputDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ghpages-test-'))
  outputDir = join(tmpDir, 'output')
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, 'index.html'), '<h1>report</h1>\n', 'utf-8')
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('deployGithubPages', () => {
  it('writes CNAME when cname is set', async () => {
    mockGit()

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir,
      branch: 'gh-pages',
      cname: 'memory.example.com',
    })

    const cnamePath = join(outputDir, 'CNAME')
    expect(existsSync(cnamePath)).toBe(true)
    expect(readFileSync(cnamePath, 'utf-8').trim()).toBe('memory.example.com')
  })

  it('skips deploy for branch with shell meta-chars', async () => {
    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir,
      branch: 'gh-pages; rm -rf /',
      cname: '',
    })

    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('does nothing when branch is empty string', async () => {
    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir,
      branch: '',
      cname: '',
    })

    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('publishes to an existing remote branch via a temporary repo', async () => {
    const calls = mockGit({ branchExists: true })

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir,
      branch: 'gh-pages',
      cname: '',
    })

    expect(hasCommand(calls, ['remote', 'get-url', 'origin'], tmpDir)).toBe(true)
    expect(hasCommand(calls, ['init'])).toBe(true)
    expect(hasCommand(calls, ['remote', 'add', 'origin', 'https://example.com/repo.git'])).toBe(true)
    expect(hasCommand(calls, ['fetch', '--depth', '1', 'origin', 'gh-pages'])).toBe(true)
    expect(hasCommand(calls, ['checkout', '-B', 'gh-pages', 'FETCH_HEAD'])).toBe(true)
    expect(hasCommand(calls, ['add', '--all'])).toBe(true)
    expect(hasCommand(calls, ['status', '--short'])).toBe(true)
    expect(hasCommand(calls, [
      '-c', 'user.name=MemoryTree',
      '-c', 'user.email=memorytree@local.invalid',
      'commit', '-m', 'chore: publish memorytree report',
    ])).toBe(true)
    expect(hasCommand(calls, ['push', 'origin', 'HEAD:gh-pages'])).toBe(true)
    expect(calls.some(call => call.args.includes('subtree'))).toBe(false)
  })

  it('creates an orphan branch when the remote branch does not exist', async () => {
    const calls = mockGit({ branchExists: false })

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir,
      branch: 'gh-pages',
      cname: '',
    })

    expect(hasCommand(calls, ['checkout', '--orphan', 'gh-pages'])).toBe(true)
    expect(hasCommand(calls, ['push', 'origin', 'HEAD:gh-pages'])).toBe(true)
  })

  it('skips commit and push when there is nothing new to publish', async () => {
    const calls = mockGit({ branchExists: true, statusOutput: '' })

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir,
      branch: 'gh-pages',
      cname: '',
    })

    expect(hasCommand(calls, ['status', '--short'])).toBe(true)
    expect(hasCommand(calls, ['push', 'origin', 'HEAD:gh-pages'])).toBe(false)
    expect(hasCommand(calls, ['commit', '-m', 'chore: publish memorytree report'])).toBe(false)
  })

  it('does not throw when git commands fail', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('git failure')
    })

    await expect(
      deployGithubPages({
        repoRoot: tmpDir,
        outputDir,
        branch: 'gh-pages',
        cname: '',
      }),
    ).resolves.not.toThrow()
  })
})

interface GitCall {
  cwd?: string
  args: string[]
}

function mockGit(options: {
  branchExists?: boolean
  remoteUrl?: string
  statusOutput?: string
} = {}): GitCall[] {
  const calls: GitCall[] = []
  const mockExec = vi.mocked(execFileSync)

  mockExec.mockImplementation((_command, rawArgs, rawOptions) => {
    const args = [...(rawArgs as string[])]
    const cwd = (rawOptions as { cwd?: string } | undefined)?.cwd
    calls.push({ cwd, args })

    if (matches(args, ['remote', 'get-url', 'origin'])) {
      return Buffer.from(options.remoteUrl ?? 'https://example.com/repo.git')
    }

    if (matches(args, ['ls-remote', '--exit-code', '--heads', 'origin', 'gh-pages'])) {
      if (options.branchExists === false) {
        throw new Error('branch not found')
      }
      return Buffer.from('refs/heads/gh-pages\n')
    }

    if (matches(args, ['status', '--short'])) {
      return Buffer.from(options.statusOutput ?? 'A  index.html\n')
    }

    return Buffer.from('')
  })

  return calls
}

function hasCommand(calls: GitCall[], expected: string[], cwd?: string): boolean {
  return calls.some(call => matches(call.args, expected) && (cwd === undefined || call.cwd === cwd))
}

function matches(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((value, index) => value === expected[index])
}
