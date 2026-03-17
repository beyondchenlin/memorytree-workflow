/**
 * GitHub Pages deployment: push report output to gh-pages branch.
 */

import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, relative } from 'node:path'
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

/** Safe character set for branch names — blocks shell meta-chars. */
const BRANCH_RE = /^[a-zA-Z0-9._/-]+$/

export async function deployGithubPages(options: GithubPagesOptions): Promise<void> {
  const { repoRoot, outputDir, branch, cname } = options
  const logger = getLogger()

  if (!branch) return

  // Validate branch name to prevent any injection
  if (!BRANCH_RE.test(branch)) {
    logger.warn(`[gh-pages] Invalid branch name, skipping deploy: "${branch}"`)
    return
  }

  try {
    // 1. Write CNAME file if configured
    if (cname) {
      const cnamePath = join(outputDir, 'CNAME')
      writeFileSync(cnamePath, cname + '\n', 'utf-8')
      logger.info(`[gh-pages] CNAME written: ${cname}`)
    }

    // 2. Check if branch exists on remote
    let branchExists = false
    try {
      git(repoRoot, 'ls-remote', '--exit-code', '--heads', 'origin', branch)
      branchExists = true
    } catch {
      branchExists = false
    }

    if (!branchExists) {
      // Create orphan branch via a temporary worktree (mkdtempSync avoids collision)
      logger.info(`[gh-pages] Branch '${branch}' not found, creating orphan...`)
      const worktreePath = mkdtempSync(join(tmpdir(), 'mt-gh-pages-'))
      try {
        git(repoRoot, 'worktree', 'add', '--orphan', '-b', branch, worktreePath)
        git(worktreePath, 'commit', '--allow-empty', '-m', 'chore: init gh-pages')
        git(repoRoot, 'push', 'origin', branch)
      } finally {
        try { git(repoRoot, 'worktree', 'remove', '--force', worktreePath) } catch { /* ignore */ }
      }
    }

    // 3. Push using git subtree
    // path.relative() is authoritative; normalize separators for git
    const relOutput = relative(repoRoot, outputDir).replace(/\\/g, '/')
    logger.info(`[gh-pages] Pushing ${relOutput} to origin/${branch}...`)
    git(repoRoot, 'subtree', 'push', '--prefix', relOutput, 'origin', branch)
    logger.info(`[gh-pages] Successfully pushed to origin/${branch}`)
  } catch (err: unknown) {
    logger.warn(`[gh-pages] Deploy failed: ${String(err)}`)
    // Never throw — report deploy failure must not abort heartbeat
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Invoke git with explicit args — no shell interpolation. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}
