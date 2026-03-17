/**
 * MemoryTree heartbeat — single execution, stateless, idempotent.
 * Port of scripts/heartbeat.py
 */

import type { ParsedTranscript } from '../types/transcript.js'
import { discoverSourceFiles, transcriptMatchesRepo } from '../transcript/discover.js'
import { importTranscript, transcriptHasContent } from '../transcript/import.js'
import { parseTranscript } from '../transcript/parse.js'
import { slugify } from '../transcript/common.js'
import { defaultGlobalTranscriptRoot } from '../transcript/discover.js'
import type { Config } from './config.js'
import { loadConfig } from './config.js'
import { acquireLock, releaseLock } from './lock.js'
import { resetFailureCount, writeAlert, writeAlertWithThreshold } from './alert.js'
import type { LogLevel } from './log.js'
import { getLogger, setupLogging } from './log.js'
import { git } from '../utils/exec.js'
import { toPosixPath } from '../utils/path.js'
import { basename, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Sensitive pattern detection
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
  /(?:secret|token)\s*[:=]\s*\S+/i,
  /(?:sk-|pk_live_|sk_live_|ghp_|gho_|glpat-)\S{10,}/,
  /Bearer\s+\S{20,}/i,
]

const RAW_TRANSCRIPT_PREFIX = 'Memory/06_transcripts/raw/'

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function main(): Promise<number> {
  const config = loadConfig()
  setupLogging(config.log_level as LogLevel)
  const logger = getLogger()

  if (!acquireLock()) {
    logger.info('Another heartbeat instance is running. Exiting.')
    writeAlert('global', 'lock_held', 'Heartbeat exited: another instance held the lock.')
    return 0
  }

  try {
    return await runHeartbeat(config)
  } finally {
    releaseLock()
  }
}

// ---------------------------------------------------------------------------
// Heartbeat orchestration
// ---------------------------------------------------------------------------

export async function runHeartbeat(config: Config): Promise<number> {
  const logger = getLogger()

  if (config.projects.length === 0) {
    logger.info('No projects registered in config.toml. Nothing to do.')
    return 0
  }

  logger.info(`Heartbeat started. ${config.projects.length} project(s) registered.`)

  for (const entry of config.projects) {
    const projectPath = resolve(entry.path)
    if (!existsSync(projectPath)) {
      logger.warn(`Project path does not exist, skipping: ${projectPath}`)
      continue
    }
    try {
      await processProject(config, projectPath, entry.name || basename(projectPath))
    } catch (err: unknown) {
      logger.exception(`Error processing project: ${projectPath}`, err)
      writeAlertWithThreshold(
        toPosixPath(projectPath),
        'push_failed',
        `Heartbeat error for project: ${basename(projectPath)}`,
      )
    }
  }

  logger.info('Heartbeat finished.')
  return 0
}

// ---------------------------------------------------------------------------
// Per-project processing
// ---------------------------------------------------------------------------

export async function processProject(config: Config, projectPath: string, projectName: string): Promise<void> {
  const logger = getLogger()
  const repoSlug = slugify(projectName, 'project')
  const globalRoot = defaultGlobalTranscriptRoot()
  const branch = currentBranch(projectPath)
  const mirrorToRepo = isDedicatedMemorytreeBranch(branch)

  if (!mirrorToRepo) {
    logger.warn(
      `[${projectName}] Current branch '${branch}' is not a dedicated memorytree/* branch. ` +
      'Importing to the global archive only.',
    )
  }

  const discovered = discoverSourceFiles()
  let importedCount = 0

  for (const [client, source] of discovered) {
    let parsed: ParsedTranscript
    try {
      parsed = parseTranscript(client, source)
    } catch {
      logger.debug(`Failed to parse ${source}, skipping.`)
      continue
    }

    if (!transcriptHasContent(parsed)) continue
    if (!transcriptMatchesRepo(parsed, projectPath, repoSlug)) continue

    scanSensitive(parsed, projectPath)

    try {
      await importTranscript(parsed, projectPath, globalRoot, repoSlug, 'not-set', mirrorToRepo)
      importedCount++
    } catch {
      logger.exception(`Failed to import transcript: ${source}`)
    }
  }

  if (importedCount === 0) {
    logger.info(`[${projectName}] No new transcripts to import.`)
    return
  }

  logger.info(`[${projectName}] Imported ${importedCount} transcript(s).`)
  if (mirrorToRepo) {
    gitCommitAndPush(config, projectPath, projectName, importedCount)
  } else {
    logger.info(`[${projectName}] Skipped repo-local commit/push on branch '${branch}'.`)
  }

  if (config.generate_report) {
    try {
      const { buildReport } = await import('../report/build.js')
      await buildReport({
        root: projectPath,
        output: join(projectPath, 'Memory', '07_reports'),
        noAi: !process.env['ANTHROPIC_API_KEY'],
        model: config.ai_summary_model,
        locale: config.locale,
        ghPagesBranch: config.gh_pages_branch,
        cname: config.cname,
        webhookUrl: config.webhook_url,
        reportBaseUrl: config.report_base_url,
      })
      logger.info(`[${projectName}] Report generated.`)
    } catch (err: unknown) {
      logger.warn(`[${projectName}] Report generation failed: ${String(err)}`)
      // Never propagate — report failure must not abort heartbeat cycle
    }
  }
}

// ---------------------------------------------------------------------------
// Sensitive pattern scanning
// ---------------------------------------------------------------------------

export function scanSensitive(parsed: ParsedTranscript, projectPath: string): void {
  const logger = getLogger()
  for (const msg of parsed.messages) {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(msg.text)) {
        logger.warn(
          `Sensitive pattern detected in transcript ${parsed.source_path} (project: ${basename(projectPath)}, role: ${msg.role})`,
        )
        writeAlert(
          toPosixPath(projectPath),
          'sensitive_match',
          `Sensitive pattern in transcript: ${basename(parsed.source_path)}`,
        )
        return
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

export function gitCommitAndPush(config: Config, projectPath: string, projectName: string, count: number): void {
  const logger = getLogger()

  const changedPaths = changedMemoryPaths(projectPath)
  if (changedPaths.length === 0) {
    logger.info(`[${projectName}] No git changes in Memory/.`)
    return
  }

  const stageablePaths = changedPaths.filter(path => !isRepoRawTranscriptPath(path))
  if (stageablePaths.length === 0) {
    logger.info(`[${projectName}] Only raw transcript mirror changes detected; skipping commit.`)
    return
  }

  git(projectPath, 'add', '--', ...stageablePaths)
  git(projectPath, 'commit', '-m', `memorytree(transcripts): import ${count} transcript(s)`)
  logger.info(`[${projectName}] Committed ${count} transcript import(s).`)

  if (!config.auto_push) {
    logger.info(`[${projectName}] auto_push disabled, skipping push.`)
    return
  }

  const remotes = git(projectPath, 'remote')
  if (!remotes.trim()) {
    logger.warn(`[${projectName}] No git remote configured, skipping push.`)
    writeAlert(toPosixPath(projectPath), 'no_remote', 'Push skipped: no Git remote configured.')
    return
  }

  if (!tryPush(projectPath, projectName)) {
    logger.warn(`[${projectName}] Push failed, retrying once...`)
    if (!tryPush(projectPath, projectName)) {
      logger.error(`[${projectName}] Push failed after retry.`)
      writeAlertWithThreshold(toPosixPath(projectPath), 'push_failed', 'Push failed after retry.')
      return
    }
  }

  resetFailureCount(toPosixPath(projectPath), 'push_failed')
}

export function tryPush(projectPath: string, projectName: string): boolean {
  try {
    git(projectPath, 'push')
    getLogger().info(`[${projectName}] Pushed successfully.`)
    return true
  } catch {
    return false
  }
}

export function currentBranch(projectPath: string): string {
  return git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
}

export function isDedicatedMemorytreeBranch(branch: string): boolean {
  return branch.trim().startsWith('memorytree/')
}

export function changedMemoryPaths(projectPath: string): string[] {
  const status = git(projectPath, 'status', '--porcelain', '--untracked-files=all', '--', 'Memory/')
  const seen = new Set<string>()
  const paths: string[] = []

  for (const rawLine of status.split(/\r?\n/)) {
    const path = statusLinePath(rawLine)
    if (path === null || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }

  return paths
}

export function isRepoRawTranscriptPath(path: string): boolean {
  return path.replace(/\\/g, '/').startsWith(RAW_TRANSCRIPT_PREFIX)
}

function statusLinePath(line: string): string | null {
  if (line.length < 4) return null

  const rawPath = line.slice(3).trim()
  if (!rawPath) return null

  const path = rawPath.includes(' -> ')
    ? rawPath.slice(rawPath.lastIndexOf(' -> ') + 4)
    : rawPath

  return unquotePath(path)
}

function unquotePath(path: string): string {
  if (!(path.startsWith('"') && path.endsWith('"'))) return path

  return path
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}
