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
  readonly pushUrl: string | null
  readonly transport: PushTransport | null
  readonly usedFallback: boolean
}

export type PushTransport = 'ssh' | 'https' | 'other'

export interface PushRemoteStatus {
  readonly remote: string | null
  readonly fetchUrl: string | null
  readonly pushUrl: string | null
  readonly transport: PushTransport | null
  readonly fallbackUrls: readonly string[]
}

export interface BranchPushStatus {
  readonly remote: string | null
  readonly pushUrl: string | null
  readonly transport: PushTransport | null
  readonly usedFallback: boolean
}

export function redactRemoteUrl(url: string | null): string | null {
  if (url === null) {
    return null
  }

  const trimmed = url.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    const keepPlainUser = parsed.protocol === 'ssh:' && !parsed.password && parsed.username === 'git'
    if (parsed.username && !keepPlainUser) {
      parsed.username = '***'
      parsed.password = ''
    }
    return parsed.toString()
  } catch {
    return trimmed.replace(/(https?:\/\/)([^/\s@]+)@/gi, '$1***@')
  }
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
  const target = describePushRemote(projectPath)
  if (target.remote === null || target.pushUrl === null || target.transport === null) {
    return {
      remote: null,
      created: false,
      pushUrl: null,
      transport: null,
      usedFallback: false,
    }
  }
  if (hasTrackingUpstream(projectPath)) {
    return {
      remote: target.remote,
      created: false,
      pushUrl: target.pushUrl,
      transport: target.transport,
      usedFallback: false,
    }
  }

  const resolvedTarget = {
    ...target,
    remote: target.remote,
    pushUrl: target.pushUrl,
    transport: target.transport,
  }
  const pushed = pushToResolvedRemote(projectPath, resolvedTarget, ['push', '-u', resolvedTarget.remote, branch])
  return {
    remote: pushed.remote,
    created: true,
    pushUrl: pushed.pushUrl,
    transport: pushed.transport,
    usedFallback: pushed.usedFallback,
  }
}

export function pushBranchToRemote(projectPath: string, branch: string): BranchPushStatus {
  const trackingRemote = resolveTrackingRemote(projectPath)
  const remote = trackingRemote ?? resolvePushRemote(projectPath)
  const target = describePushRemote(projectPath, remote ?? undefined)
  if (target.remote === null || target.pushUrl === null || target.transport === null) {
    return {
      remote: null,
      pushUrl: null,
      transport: null,
      usedFallback: false,
    }
  }

  const resolvedTarget = {
    ...target,
    remote: target.remote,
    pushUrl: target.pushUrl,
    transport: target.transport,
  }
  const pushArgs = trackingRemote !== null
    ? ['push']
    : ['push', resolvedTarget.remote, branch]
  return pushToResolvedRemote(projectPath, resolvedTarget, pushArgs)
}

export function describePushRemote(projectPath: string, remoteName?: string): PushRemoteStatus {
  const remote = remoteName ?? resolvePushRemote(projectPath)
  if (remote === null) {
    return {
      remote: null,
      fetchUrl: null,
      pushUrl: null,
      transport: null,
      fallbackUrls: [],
    }
  }

  const fetchUrl = execCommand('git', ['remote', 'get-url', remote], {
    cwd: projectPath,
    allowFailure: true,
  }).trim()
  const pushUrl = execCommand('git', ['remote', 'get-url', '--push', remote], {
    cwd: projectPath,
    allowFailure: true,
  }).trim() || fetchUrl
  const transport = pushUrl ? detectPushTransport(pushUrl) : null

  return {
    remote,
    fetchUrl: fetchUrl || null,
    pushUrl: pushUrl || null,
    transport,
    fallbackUrls: collectFallbackPushUrls(pushUrl, fetchUrl),
  }
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

function resolveTrackingRemote(projectPath: string): string | null {
  const upstream = execCommand(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd: projectPath, allowFailure: true },
  ).trim()
  if (!upstream) {
    return null
  }

  const slashIndex = upstream.indexOf('/')
  return slashIndex <= 0 ? null : upstream.slice(0, slashIndex)
}

function pushToResolvedRemote(
  projectPath: string,
  target: PushRemoteStatus & { remote: string; pushUrl: string; transport: PushTransport },
  pushArgs: string[],
): BranchPushStatus {
  try {
    git(projectPath, ...pushArgs)
    return {
      remote: target.remote,
      pushUrl: target.pushUrl,
      transport: target.transport,
      usedFallback: false,
    }
  } catch (primaryError: unknown) {
    if (shouldTryFallbackTransport(primaryError, target.fallbackUrls)) {
      let lastFallbackFailure: { url: string; error: unknown } | null = null
      for (const fallbackUrl of target.fallbackUrls) {
        try {
          execCommand(
            'git',
            ['-c', `remote.${target.remote}.pushurl=${fallbackUrl}`, ...pushArgs],
            { cwd: projectPath },
          )
          return {
            remote: target.remote,
            pushUrl: fallbackUrl,
            transport: detectPushTransport(fallbackUrl),
            usedFallback: true,
          }
        } catch (fallbackError: unknown) {
          lastFallbackFailure = {
            url: fallbackUrl,
            error: fallbackError,
          }
        }
      }
      if (lastFallbackFailure !== null) {
        throw new Error(
          formatPushFailure(
            target.remote,
            target.pushUrl,
            primaryError,
            lastFallbackFailure.url,
            lastFallbackFailure.error,
          ),
        )
      }
    }

    throw new Error(formatPushFailure(target.remote, target.pushUrl, primaryError))
  }
}

function detectPushTransport(url: string): PushTransport {
  const normalized = url.trim().toLowerCase()
  if (normalized.startsWith('https://')) {
    return 'https'
  }
  if (normalized.startsWith('ssh://') || normalized.startsWith('git@')) {
    return 'ssh'
  }
  return 'other'
}

function collectFallbackPushUrls(pushUrl: string, fetchUrl: string): string[] {
  const candidates = [
    fetchUrl,
    ...alternateTransportUrls(pushUrl),
    ...alternateTransportUrls(fetchUrl),
  ]

  const seen = new Set<string>()
  const normalizedPrimary = normalizeComparableUrl(pushUrl)
  const fallbackUrls: string[] = []

  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue

    const normalizedCandidate = normalizeComparableUrl(trimmed)
    if (normalizedCandidate === normalizedPrimary || seen.has(normalizedCandidate)) {
      continue
    }

    seen.add(normalizedCandidate)
    fallbackUrls.push(trimmed)
  }

  return fallbackUrls
}

function alternateTransportUrls(url: string): string[] {
  const repo = parseGitHubRepo(url)
  if (repo === null) {
    return []
  }

  const httpsUrl = `https://github.com/${repo.owner}/${repo.repo}.git`
  const sshUrl = `ssh://git@ssh.github.com:443/${repo.owner}/${repo.repo}.git`

  return [httpsUrl, sshUrl]
}

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return null
  }

  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  if (httpsMatch) {
    return {
      owner: httpsMatch[1]!,
      repo: httpsMatch[2]!,
    }
  }

  const scpMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)
  if (scpMatch) {
    return {
      owner: scpMatch[1]!,
      repo: scpMatch[2]!,
    }
  }

  const sshMatch = trimmed.match(/^ssh:\/\/git@(?:github\.com|ssh\.github\.com(?::443)?)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  if (sshMatch) {
    return {
      owner: sshMatch[1]!,
      repo: sshMatch[2]!,
    }
  }

  return null
}

function shouldTryFallbackTransport(error: unknown, fallbackUrls: readonly string[]): boolean {
  if (fallbackUrls.length === 0) {
    return false
  }

  const message = collectErrorText(error).toLowerCase()
  return [
    'host key verification failed',
    'permission denied (publickey)',
    'could not read from remote repository',
    'authentication failed',
    'repository not found',
    'could not resolve host',
    'unable to access',
    'connection timed out',
    'connection refused',
    'ssh:',
  ].some(fragment => message.includes(fragment))
}

function formatPushFailure(
  remote: string,
  pushUrl: string,
  primaryError: unknown,
  fallbackUrl?: string,
  fallbackError?: unknown,
): string {
  const lines = [
    `Unable to push branch to remote '${remote}'.`,
    `Primary push URL: ${redactRemoteUrl(pushUrl)}`,
    `Primary error: ${summarizeError(primaryError)}`,
  ]

  if (fallbackUrl) {
    lines.push(`Fallback push URL: ${redactRemoteUrl(fallbackUrl)}`)
    if (fallbackError) {
      lines.push(`Fallback error: ${summarizeError(fallbackError)}`)
    }
  }

  return lines.join('\n')
}

function summarizeError(error: unknown): string {
  const lines = redactRemoteUrlsInText(collectErrorText(error))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const preferred = lines.find(line => !line.startsWith('Command failed:'))
  return preferred ?? lines[0] ?? String(error)
}

function collectErrorText(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message]
    const extra = error as {
      readonly stdout?: string | Buffer
      readonly stderr?: string | Buffer
    }
    if (extra.stdout !== undefined) {
      parts.push(bufferToString(extra.stdout))
    }
    if (extra.stderr !== undefined) {
      parts.push(bufferToString(extra.stderr))
    }
    return parts.filter(Boolean).join('\n')
  }

  return String(error)
}

function bufferToString(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf-8')
}

function redactRemoteUrlsInText(value: string): string {
  return value.replace(/(https?:\/\/)([^/\s@]+)@/gi, '$1***@')
}

function normalizeComparableUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
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
