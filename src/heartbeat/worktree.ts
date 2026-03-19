import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { platform } from 'node:process'

import type { ProjectEntry } from './config.js'
import { memorytreeRoot } from './config.js'
import { execCommand, git } from '../utils/exec.js'

export interface WorktreeStatus {
  readonly branch: string
  readonly created: boolean
}

export function defaultProjectWorktreePath(developmentPath: string): string {
  return resolve(memorytreeRoot(), 'worktrees', slugifySegment(basename(resolve(developmentPath))))
}

export function defaultProjectWorktreeBranch(project: Pick<ProjectEntry, 'id' | 'name' | 'development_path'>): string {
  const source = project.name || basename(project.development_path) || project.id
  return `memorytree/${slugifySegment(source)}`
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
  const branch = defaultProjectWorktreeBranch(project)

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
  const normalized = resolve(value).replace(/\\/g, '/').replace(/\/+$/, '')
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
