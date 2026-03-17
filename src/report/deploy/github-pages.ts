/**
 * GitHub Pages deployment: publish report output to a dedicated branch.
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

import { getLogger } from '../../heartbeat/log.js'

export interface GithubPagesOptions {
  /** Repository root (contains .git/) */
  repoRoot: string
  /** Report output directory (e.g. Memory/07_reports) */
  outputDir: string
  /** Branch name to push to (e.g. 'gh-pages'). Empty string = skip. */
  branch: string
  /** Custom domain (CNAME). Empty string = skip. */
  cname: string
}

const COMMIT_MESSAGE = 'chore: publish memorytree report'
const COMMITTER_NAME = 'MemoryTree'
const COMMITTER_EMAIL = 'memorytree@local.invalid'

/** Safe character set for branch names. */
const BRANCH_RE = /^[a-zA-Z0-9._/-]+$/

export async function deployGithubPages(options: GithubPagesOptions): Promise<void> {
  const { repoRoot, outputDir, branch, cname } = options
  const logger = getLogger()

  if (!branch) return

  if (!BRANCH_RE.test(branch)) {
    logger.warn(`[gh-pages] Invalid branch name, skipping deploy: "${branch}"`)
    return
  }

  if (!existsSync(outputDir)) {
    logger.warn(`[gh-pages] Output directory does not exist, skipping deploy: ${outputDir}`)
    return
  }

  try {
    if (cname) {
      const cnamePath = join(outputDir, 'CNAME')
      writeFileSync(cnamePath, cname + '\n', 'utf-8')
      logger.info(`[gh-pages] CNAME written: ${cname}`)
    }

    const remoteUrl = git(repoRoot, 'remote', 'get-url', 'origin').trim()
    if (!remoteUrl) {
      logger.warn('[gh-pages] No origin remote configured, skipping deploy.')
      return
    }

    const publishRoot = mkdtempSync(join(tmpdir(), 'mt-gh-pages-'))
    try {
      git(publishRoot, 'init')
      git(publishRoot, 'remote', 'add', 'origin', remoteUrl)

      if (remoteBranchExists(publishRoot, branch)) {
        logger.info(`[gh-pages] Updating existing origin/${branch} branch.`)
        git(publishRoot, 'fetch', '--depth', '1', 'origin', branch)
        git(publishRoot, 'checkout', '-B', branch, 'FETCH_HEAD')
      } else {
        logger.info(`[gh-pages] Branch '${branch}' not found, creating orphan publish branch.`)
        git(publishRoot, 'checkout', '--orphan', branch)
      }

      clearDirectory(publishRoot)
      copyDirectoryContents(outputDir, publishRoot)

      git(publishRoot, 'add', '--all')
      if (!hasPendingChanges(publishRoot)) {
        logger.info(`[gh-pages] No changes to publish for origin/${branch}.`)
        return
      }

      git(
        publishRoot,
        '-c', `user.name=${COMMITTER_NAME}`,
        '-c', `user.email=${COMMITTER_EMAIL}`,
        'commit',
        '-m',
        COMMIT_MESSAGE,
      )
      git(publishRoot, 'push', 'origin', `HEAD:${branch}`)
      logger.info(`[gh-pages] Successfully pushed report to origin/${branch}`)
    } finally {
      rmSync(publishRoot, { recursive: true, force: true })
    }
  } catch (err: unknown) {
    logger.warn(`[gh-pages] Deploy failed: ${String(err)}`)
    // Never throw; report deploy failure must not abort heartbeat.
  }
}

function remoteBranchExists(cwd: string, branch: string): boolean {
  try {
    git(cwd, 'ls-remote', '--exit-code', '--heads', 'origin', branch)
    return true
  } catch {
    return false
  }
}

function clearDirectory(root: string): void {
  for (const entry of readdirSync(root)) {
    if (entry === '.git') continue
    rmSync(join(root, entry), { recursive: true, force: true })
  }
}

function copyDirectoryContents(source: string, destination: string): void {
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(destination, entry), { recursive: true, force: true })
  }
}

function hasPendingChanges(cwd: string): boolean {
  return git(cwd, 'status', '--short').trim().length > 0
}

/** Invoke git with explicit args; no shell interpolation. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}
