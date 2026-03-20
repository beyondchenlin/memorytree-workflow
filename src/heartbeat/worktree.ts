import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { platform } from 'node:process'

import type { ProjectEntry } from './config.js'
import { DEFAULT_MEMORY_BRANCH, memorytreeRoot } from './config.js'
import { execCommand, git } from '../utils/exec.js'

export interface WorktreeStatus {
  readonly branch: string
  readonly created: boolean
}

export interface BranchUpstreamStatus {
  readonly remote: string | null
  readonly created: boolean
}

export function defaultProjectWorktreePath(developmentPath: string): string {
  return resolve(memorytreeRoot(), 'worktrees', slugifySegment(basename(resolve(developmentPath))))
}

export function defaultProjectWorktreeBranch(): string {
  return DEFAULT_MEMORY_BRANCH
}

export function resolveProjectWorktreeBranch(project: Pick<ProjectEntry, 'memory_branch'>): string {
  const requested = project.memory_branch.trim()
  return isValidWorktreeBranchName(requested)
    ? requested
    : DEFAULT_MEMORY_BRANCH
}

export function ensureProjectWorktree(project: ProjectEntry): WorktreeStatus {
  const developmentPath = resolve(project.development_path)
  const memoryPath = resolve(project.memory_path)
  if (samePath(developmentPath, memoryPath)) {
    return {
      branch: git(memoryPath, 'rev-parse', '--abbrev-ref', 'HEAD').trim(),
      created: false,
    }
  }

  const repoRoot = git(developmentPath, 'rev-parse', '--show-toplevel').trim()
  const repoCommonDir = gitCommonDir(developmentPath)
  const branch = resolveProjectWorktreeBranch(project)

  if (existsSync(memoryPath)) {
    const existingRoot = execCommand('git', ['rev-parse', '--show-toplevel'], {
      cwd: memoryPath,
      allowFailure: true,
    }).trim()
    if (!existingRoot) {
      throw new Error(`Configured memory_path is not a git worktree: ${memoryPath}`)
    }
    const existingCommonDir = gitCommonDir(memoryPath)
    if (!samePath(existingCommonDir, repoCommonDir)) {
      throw new Error(`Configured memory_path belongs to a different repository: ${memoryPath}`)
    }

    const current = git(memoryPath, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
    if (current !== branch) {
      if (branchExists(repoRoot, branch)) {
        git(memoryPath, 'checkout', branch)
      } else {
        git(memoryPath, 'checkout', '-b', branch)
      }
    }

    return { branch, created: false }
  }

  mkdirSync(dirname(memoryPath), { recursive: true })
  if (branchExists(repoRoot, branch)) {
    git(repoRoot, 'worktree', 'add', memoryPath, branch)
  } else {
    git(repoRoot, 'worktree', 'add', '-b', branch, memoryPath, 'HEAD')
  }

  return { branch, created: true }
}

export function ensureBranchUpstream(projectPath: string, branch: string): BranchUpstreamStatus {
  const remote = resolvePushRemote(projectPath)
  if (remote === null) {
    return { remote: null, created: false }
  }
  if (hasTrackingUpstream(projectPath)) {
    return { remote, created: false }
  }

  git(projectPath, 'push', '-u', remote, branch)
  return { remote, created: true }
}

export function resolvePushRemote(projectPath: string): string | null {
  const remotes = git(projectPath, 'remote')
    .split(/\r?\n/)
    .map(remote => remote.trim())
    .filter(Boolean)

  if (remotes.length === 0) {
    return null
  }
  if (remotes.includes('origin')) {
    return 'origin'
  }
  return remotes[0] ?? null
}

export function hasTrackingUpstream(projectPath: string): boolean {
  const output = execCommand(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd: projectPath, allowFailure: true },
  )
  return output.trim().length > 0
}

export function isValidWorktreeBranchName(branch: string): boolean {
  if (!branch || branch.trim() !== branch) {
    return false
  }

  const output = execCommand('git', ['check-ref-format', '--branch', branch], { allowFailure: true })
  return output.trim() === branch
}

export function isProjectMemoryBranch(
  branch: string,
  project?: Pick<ProjectEntry, 'memory_branch'>,
): boolean {
  const normalized = branch.trim()
  if (!normalized) return false

  const expected = project ? resolveProjectWorktreeBranch(project) : DEFAULT_MEMORY_BRANCH
  return normalized === expected
    || normalized === DEFAULT_MEMORY_BRANCH
    || normalized.startsWith(`${DEFAULT_MEMORY_BRANCH}/`)
}

function gitCommonDir(cwd: string): string {
  const output = execCommand('git', ['rev-parse', '--git-common-dir'], {
    cwd,
  }).trim()

  if (!output) {
    throw new Error(`Unable to resolve git common-dir for: ${cwd}`)
  }

  return isAbsolute(output) ? resolve(output) : resolve(cwd, output)
}

function branchExists(repoRoot: string, branch: string): boolean {
  const output = execCommand('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
    cwd: repoRoot,
    allowFailure: true,
  })
  return output.trim().length > 0
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(value: string): string {
  let normalizedPath = resolve(value)
  if (existsSync(normalizedPath)) {
    try {
      normalizedPath = realpathSync.native
        ? realpathSync.native(normalizedPath)
        : realpathSync(normalizedPath)
    } catch {
      // Fall back to the resolved path when realpath fails.
    }
  }

  const normalized = normalizedPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function slugifySegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return slug || 'project'
}
