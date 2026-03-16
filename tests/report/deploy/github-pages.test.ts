import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock child_process.execFileSync so no actual git commands run
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue(Buffer.from('')),
}))

// Mock getLogger to avoid needing full setup
vi.mock('../../../src/heartbeat/log.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

import { deployGithubPages } from '../../../src/report/deploy/github-pages.js'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ghpages-test-'))
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// CNAME file generation
// ---------------------------------------------------------------------------

describe('CNAME file', () => {
  it('writes CNAME when cname is set', async () => {
    mkdirSync(join(tmpDir, 'output'), { recursive: true })
    // Make execFileSync throw on ls-remote so branch is treated as non-existent
    const mockExec = vi.mocked(execFileSync)
    mockExec.mockImplementationOnce(() => { throw new Error('ls-remote failed') })
    // Other calls succeed (worktree add, commit, push, subtree push, etc.)
    mockExec.mockReturnValue(Buffer.from(''))

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir: join(tmpDir, 'output'),
      branch: 'gh-pages',
      cname: 'memory.example.com',
    })

    const cnamePath = join(tmpDir, 'output', 'CNAME')
    expect(existsSync(cnamePath)).toBe(true)
    expect(readFileSync(cnamePath, 'utf-8').trim()).toBe('memory.example.com')
  })

  it('skips CNAME when cname is empty string', async () => {
    mkdirSync(join(tmpDir, 'output'), { recursive: true })
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir: join(tmpDir, 'output'),
      branch: 'gh-pages',
      cname: '',
    })

    const cnamePath = join(tmpDir, 'output', 'CNAME')
    expect(existsSync(cnamePath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Branch name validation
// ---------------------------------------------------------------------------

describe('branch name validation', () => {
  it('skips deploy for branch with shell meta-chars', async () => {
    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir: tmpDir,
      branch: 'gh-pages; rm -rf /',
      cname: '',
    })
    expect(execFileSync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Skip deploy when branch is empty
// ---------------------------------------------------------------------------

describe('skip when branch is empty', () => {
  it('does nothing when branch is empty string', async () => {
    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir: tmpDir,
      branch: '',
      cname: '',
    })
    expect(execFileSync).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// git subtree push command
// ---------------------------------------------------------------------------

describe('git subtree push', () => {
  it('calls git subtree push with correct branch', async () => {
    mkdirSync(join(tmpDir, 'output'), { recursive: true })
    const mockExec = vi.mocked(execFileSync)
    // ls-remote succeeds (branch exists)
    mockExec.mockReturnValue(Buffer.from('refs/heads/gh-pages'))

    await deployGithubPages({
      repoRoot: tmpDir,
      outputDir: join(tmpDir, 'output'),
      branch: 'gh-pages',
      cname: '',
    })

    // execFileSync is called as: execFileSync('git', [...args], opts)
    // c[0] = 'git', c[1] = args array
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['subtree', 'push', '--prefix', expect.any(String), 'origin', 'gh-pages']),
      expect.objectContaining({ cwd: tmpDir }),
    )
  })
})

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe('failure handling', () => {
  it('does not throw when git commands fail', async () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('git failure') })

    await expect(
      deployGithubPages({
        repoRoot: tmpDir,
        outputDir: tmpDir,
        branch: 'gh-pages',
        cname: '',
      })
    ).resolves.not.toThrow()
  })
})
