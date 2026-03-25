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
import type { Config, ProjectEntry, RawUploadPermission } from './config.js'
import {
  findProjectForPath,
  loadConfig,
  noteProjectHeartbeatRun,
  projectDisplayName,
  projectExecutionPath,
  projectIsDue,
  saveConfig,
} from './config.js'
import { acquireLock, releaseLock } from './lock.js'
import { resetFailureCount, writeAlert, writeAlertWithThreshold } from './alert.js'
import type { LogLevel } from './log.js'
import { getLogger, setupLogging } from './log.js'
import { MANAGED_REPO_PATHS, syncProjectContextToMemory, syncProjectOutputsToDevelopment } from './sync.js'
import { collectExtraManifestDirs } from '../report/extra-manifests.js'
import {
  ensureBranchUpstream,
  ensureProjectWorktree,
  hasTrackingUpstream,
  isProjectMemoryBranch,
  pushBranchToRemote,
  redactRemoteUrl,
} from './worktree.js'
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
const MAX_GIT_ADD_PATH_CHARS = 12_000

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface HeartbeatRunOptions {
  readonly force?: boolean
  readonly root?: string
}

export async function main(options: HeartbeatRunOptions = {}): Promise<number> {
  const config = loadConfig()
  setupLogging(config.log_level as LogLevel)
  const logger = getLogger()

  if (!acquireLock()) {
    logger.info('Another heartbeat instance is running. Exiting.')
    writeAlert('global', 'lock_held', 'Heartbeat exited: another instance held the lock.')
    return 0
  }

  try {
    return await runHeartbeat(config, options)
  } finally {
    releaseLock()
  }
}

// ---------------------------------------------------------------------------
// Heartbeat orchestration
// ---------------------------------------------------------------------------

export async function runHeartbeat(config: Config, options: HeartbeatRunOptions = {}): Promise<number> {
  const logger = getLogger()
  const targetProject = options.root ? findProjectForPath(config, resolve(options.root)) : null

  if (config.projects.length === 0) {
    logger.info('No projects registered in config.toml. Nothing to do.')
    return 0
  }
  if (options.root && !targetProject) {
    logger.warn(`No registered project matched: ${resolve(options.root)}`)
    return 1
  }

  const projects = targetProject ? [targetProject] : config.projects

  logger.info(`Heartbeat started. ${projects.length} project(s) selected.`)

  let nextConfig = config
  let configChanged = false
  const now = new Date()
  const runTimestamp = now.toISOString()

  for (const entry of projects) {
    const projectName = projectDisplayName(entry)
    const projectPath = resolve(projectExecutionPath(entry))
    const heartbeatDue = options.force === true || projectIsDue(entry, now)

    if (!heartbeatDue) {
      logger.debug(`[${projectName}] Not due yet, skipping.`)
      continue
    }

    try {
      const worktree = ensureProjectWorktree(entry)
      if (!existsSync(projectPath)) {
        logger.warn(`Project path does not exist, skipping: ${projectPath}`)
        continue
      }

      if (worktree.created) {
        logger.info(`[${projectName}] Created worktree on branch '${worktree.branch}'.`)
      }

      const contextSync = syncProjectContextToMemory(entry)
      if (!contextSync.skipped) {
        logger.info(
          `[${projectName}] Synced context to ${worktree.branch} ` +
          `(copied ${contextSync.copied}, deleted ${contextSync.deleted}).`,
        )
      }

      const extraManifestDirs = collectExtraManifestDirs(projectPath)
      await processProject(config, projectPath, projectName, entry, extraManifestDirs)
      nextConfig = noteProjectHeartbeatRun(nextConfig, entry.id, runTimestamp)
      configChanged = true

      const outputSync = syncProjectOutputsToDevelopment(entry)
      if (!outputSync.skipped) {
        logger.info(
          `[${projectName}] Synced outputs back to development directory ` +
          `(copied ${outputSync.copied}, deleted ${outputSync.deleted}).`,
        )
      }
    } catch (err: unknown) {
      logger.exception(`Error processing project: ${projectPath}`, err)
      writeAlertWithThreshold(
        toPosixPath(projectPath),
        'push_failed',
        `Heartbeat error for project: ${basename(projectPath)}`,
      )
    }
  }

  if (configChanged) {
    saveConfig(nextConfig)
  }

  logger.info('Heartbeat finished.')
  return 0
}

// ---------------------------------------------------------------------------
// Per-project processing
// ---------------------------------------------------------------------------

export async function processProject(
  config: Config,
  projectPath: string,
  projectName: string,
  project?: ProjectEntry,
  extraManifestDirs?: string[],
): Promise<void> {
  const logger = getLogger()
  const repoSlug = slugify(projectName, 'project')
  const globalRoot = defaultGlobalTranscriptRoot()
  const branch = currentBranch(projectPath)
  const mirrorToRepo = isDedicatedMemorytreeBranch(branch, project)
  const autoPush = project?.auto_push ?? config.auto_push ?? true
  const generateReport = project?.generate_report ?? config.generate_report ?? false
  const aiSummaryModel = project?.ai_summary_model ?? config.ai_summary_model ?? 'claude-haiku-4-5-20251001'
  const locale = project?.locale ?? config.locale ?? 'en'
  const ghPagesBranch = project?.gh_pages_branch ?? config.gh_pages_branch ?? ''
  const cname = project?.cname ?? config.cname ?? ''
  const webhookUrl = project?.webhook_url ?? config.webhook_url ?? ''
  const reportBaseUrl = project?.report_base_url ?? config.report_base_url ?? ''
  const rawUploadPermission = project?.raw_upload_permission ?? 'not-set'

  if (!mirrorToRepo) {
    logger.warn(
      `[${projectName}] Current branch '${branch}' is not a dedicated MemoryTree branch. ` +
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
      await importTranscript(parsed, projectPath, globalRoot, repoSlug, rawUploadPermission, mirrorToRepo)
      importedCount++
    } catch {
      logger.exception(`Failed to import transcript: ${source}`)
    }
  }

  if (importedCount === 0) {
    logger.info(`[${projectName}] No new transcripts to import.`)
  } else {
    logger.info(`[${projectName}] Imported ${importedCount} transcript(s).`)
  }

  if (generateReport) {
    try {
      const { buildReport } = await import('../report/build.js')
      await buildReport({
        root: projectPath,
        output: join(projectPath, 'Memory', '07_reports'),
        noAi: !process.env['ANTHROPIC_API_KEY'],
        model: aiSummaryModel,
        locale,
        ghPagesBranch,
        cname,
        webhookUrl,
        reportBaseUrl,
        ...(extraManifestDirs ? { extraManifestDirs } : {}),
      })
      logger.info(`[${projectName}] Report generated.`)
    } catch (err: unknown) {
      logger.warn(`[${projectName}] Report generation failed: ${String(err)}`)
      // Never propagate — report failure must not abort heartbeat cycle
    }
  }

  if (mirrorToRepo) {
    gitCommitAndPush({ auto_push: autoPush }, projectPath, projectName, importedCount, rawUploadPermission)
  } else {
    logger.info(`[${projectName}] Skipped repo-local commit/push on branch '${branch}'.`)
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

export function gitCommitAndPush(
  config: Pick<Config, 'auto_push'>,
  projectPath: string,
  projectName: string,
  importedCount: number,
  rawUploadPermission: RawUploadPermission = 'not-set',
): void {
  const logger = getLogger()

  const changedPaths = changedManagedPaths(projectPath)
  if (changedPaths.length === 0) {
    logger.info(`[${projectName}] No git changes in managed MemoryTree content.`)
    return
  }

  const stageablePaths = changedPaths.filter(path => shouldStageManagedPath(path, rawUploadPermission))
  if (stageablePaths.length === 0) {
    logger.info(`[${projectName}] Only raw transcript mirror changes detected without approval; skipping commit.`)
    return
  }

  const commitMessage = importedCount > 0
    ? `memorytree(transcripts): import ${importedCount} transcript(s)`
    : 'memorytree(snapshot): heartbeat sync'

  stageManagedPaths(projectPath, stageablePaths)
  git(projectPath, 'commit', '-m', commitMessage)
  if (importedCount > 0) {
    logger.info(`[${projectName}] Committed ${importedCount} transcript import(s).`)
  } else {
    logger.info(`[${projectName}] Committed heartbeat snapshot.`)
  }

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
    const branch = currentBranch(projectPath)
    if (hasTrackingUpstream(projectPath)) {
      const pushed = pushBranchToRemote(projectPath, branch)
      if (pushed.remote === null) {
        return false
      }
      if (pushed.usedFallback && pushed.pushUrl !== null) {
        getLogger().info(`[${projectName}] Pushed successfully via fallback ${redactRemoteUrl(pushed.pushUrl)}.`)
      }
    } else {
      const upstream = ensureBranchUpstream(projectPath, branch)
      if (upstream.remote === null) {
        return false
      }
      const fallbackNote = upstream.usedFallback && upstream.pushUrl !== null
        ? ` via fallback ${redactRemoteUrl(upstream.pushUrl)}`
        : ''
      getLogger().info(`[${projectName}] Configured upstream ${upstream.remote}/${branch}${fallbackNote}.`)
    }
    getLogger().info(`[${projectName}] Pushed successfully.`)
    return true
  } catch {
    return false
  }
}

export function currentBranch(projectPath: string): string {
  return git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
}

export function isDedicatedMemorytreeBranch(
  branch: string,
  project?: Pick<ProjectEntry, 'memory_branch'>,
): boolean {
  return isProjectMemoryBranch(branch, project)
}

export function changedManagedPaths(projectPath: string): string[] {
  const seen = new Set<string>()
  const paths: string[] = []

  for (const path of collectChangedManagedPaths(projectPath)) {
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }

  return paths
}

export function isRepoRawTranscriptPath(path: string): boolean {
  return path.replace(/\\/g, '/').startsWith(RAW_TRANSCRIPT_PREFIX)
}

function shouldStageManagedPath(path: string, rawUploadPermission: RawUploadPermission): boolean {
  if (!isRepoRawTranscriptPath(path)) {
    return true
  }

  return rawUploadPermission === 'approved'
}

function unquotePath(path: string): string {
  if (!(path.startsWith('"') && path.endsWith('"'))) return path

  return path
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function collectChangedManagedPaths(projectPath: string): string[] {
  return [
    ...gitPathLines(projectPath, 'diff', '--name-only', '--', ...MANAGED_REPO_PATHS),
    ...gitPathLines(projectPath, 'diff', '--cached', '--name-only', '--', ...MANAGED_REPO_PATHS),
    ...gitPathLines(projectPath, 'ls-files', '--others', '--exclude-standard', '--', ...MANAGED_REPO_PATHS),
    ...gitPathLines(
      projectPath,
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      ...MANAGED_REPO_PATHS,
    ),
  ]
}

function stageManagedPaths(projectPath: string, stageablePaths: readonly string[]): void {
  let batch: string[] = []
  let batchChars = 0

  for (const path of stageablePaths) {
    const pathChars = path.length + 1
    if (batch.length > 0 && batchChars + pathChars > MAX_GIT_ADD_PATH_CHARS) {
      git(projectPath, 'add', '-A', '-f', '--', ...batch)
      batch = []
      batchChars = 0
    }

    batch.push(path)
    batchChars += pathChars
  }

  if (batch.length > 0) {
    git(projectPath, 'add', '-A', '-f', '--', ...batch)
  }
}

function gitPathLines(projectPath: string, ...args: string[]): string[] {
  const output = git(projectPath, ...args)
  const paths: string[] = []

  for (const rawLine of output.split(/\r?\n/)) {
    const path = unquotePath(rawLine.trim())
    if (!path) continue
    paths.push(path)
  }

  return paths
}
