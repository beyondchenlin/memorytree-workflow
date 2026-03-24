/**
 * Load, validate, and manage ~/.memorytree/config.toml.
 * Port of scripts/_config_utils.py
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { toPosixPath } from '../utils/path.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL = '5m'
const DEFAULT_REFRESH_INTERVAL = '30m'
export const DEFAULT_MEMORY_BRANCH = 'memorytree'
const DEFAULT_AUTO_PUSH = true
const DEFAULT_LOG_LEVEL = 'info'
const DEFAULT_GENERATE_REPORT = false
const DEFAULT_AI_SUMMARY_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_LOCALE = 'en'
const DEFAULT_GH_PAGES_BRANCH = ''
const DEFAULT_CNAME = ''
const DEFAULT_WEBHOOK_URL = ''
const DEFAULT_REPORT_BASE_URL = ''
const DEFAULT_REPORT_PORT = 10010
const DEFAULT_REPORT_EXPOSURE = 'local'
export const DEFAULT_RAW_UPLOAD_PERMISSION = 'not-set'
const VALID_LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportExposure = 'local' | 'lan'
export type RawUploadPermission = 'not-set' | 'approved' | 'denied'

export interface ProjectEntry {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly development_path: string
  readonly memory_path: string
  readonly memory_branch: string
  readonly heartbeat_interval: string
  readonly refresh_interval: string
  readonly auto_push: boolean
  readonly generate_report: boolean
  readonly ai_summary_model: string
  readonly locale: string
  readonly gh_pages_branch: string
  readonly cname: string
  readonly webhook_url: string
  readonly report_base_url: string
  readonly report_port: number
  readonly report_exposure: ReportExposure
  readonly raw_upload_permission: RawUploadPermission
  readonly last_heartbeat_at: string
  readonly last_refresh_at: string
}

export interface Config {
  readonly heartbeat_interval: string
  readonly watch_dirs: readonly string[]
  readonly projects: readonly ProjectEntry[]
  readonly auto_push: boolean
  readonly log_level: string
  readonly generate_report: boolean
  readonly ai_summary_model: string
  readonly locale: string
  readonly gh_pages_branch: string
  readonly cname: string
  readonly webhook_url: string
  /** Base URL for RSS/OG meta (e.g. 'https://memory.example.com'). Empty = skip. */
  readonly report_base_url: string
  /** Port for the report HTTP server. Default: 10010. */
  readonly report_port: number
  /** Exposure for local report hosting. Default: local. */
  readonly report_exposure: ReportExposure
}

type ProjectLike = Partial<ProjectEntry> & {
  readonly path?: string
  readonly name?: string
  readonly development_path?: string
  readonly memory_path?: string
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function memorytreeRoot(): string {
  return resolve(homedir(), '.memorytree')
}

export function configPath(): string {
  return resolve(memorytreeRoot(), 'config.toml')
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function loadConfig(): Config {
  const path = configPath()
  if (!existsSync(path)) {
    return defaultConfig()
  }

  let raw: Record<string, unknown>
  try {
    const text = readFileSync(path, 'utf-8')
    raw = parseToml(text) as Record<string, unknown>
  } catch {
    return defaultConfig()
  }

  return parseRaw(raw)
}

export function saveConfig(cfg: Config): void {
  const normalized = normalizeConfig(cfg)
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })

  const lines: string[] = [
    `heartbeat_interval = ${tomlString(normalized.heartbeat_interval)}`,
    `auto_push = ${normalized.auto_push ? 'true' : 'false'}`,
    `log_level = ${tomlString(normalized.log_level)}`,
    `generate_report = ${normalized.generate_report ? 'true' : 'false'}`,
    `ai_summary_model = ${tomlString(normalized.ai_summary_model)}`,
    `locale = ${tomlString(normalized.locale)}`,
    `gh_pages_branch = ${tomlString(normalized.gh_pages_branch)}`,
    `cname = ${tomlString(normalized.cname)}`,
    `webhook_url = ${tomlString(normalized.webhook_url)}`,
    `report_base_url = ${tomlString(normalized.report_base_url)}`,
    `report_port = ${normalized.report_port}`,
    `report_exposure = ${tomlString(normalized.report_exposure)}`,
  ]

  if (normalized.watch_dirs.length > 0) {
    const items = normalized.watch_dirs.map(dir => tomlString(dir)).join(', ')
    lines.push(`watch_dirs = [${items}]`)
  } else {
    lines.push('watch_dirs = []')
  }

  lines.push('')
  for (const project of normalized.projects) {
    lines.push('[[projects]]')
    lines.push(`id = ${tomlString(project.id)}`)
    lines.push(`path = ${tomlString(project.path)}`)
    lines.push(`name = ${tomlString(project.name)}`)
    lines.push(`development_path = ${tomlString(project.development_path)}`)
    lines.push(`memory_path = ${tomlString(project.memory_path)}`)
    lines.push(`memory_branch = ${tomlString(project.memory_branch)}`)
    lines.push(`heartbeat_interval = ${tomlString(project.heartbeat_interval)}`)
    lines.push(`refresh_interval = ${tomlString(project.refresh_interval)}`)
    lines.push(`auto_push = ${project.auto_push ? 'true' : 'false'}`)
    lines.push(`generate_report = ${project.generate_report ? 'true' : 'false'}`)
    lines.push(`ai_summary_model = ${tomlString(project.ai_summary_model)}`)
    lines.push(`locale = ${tomlString(project.locale)}`)
    lines.push(`gh_pages_branch = ${tomlString(project.gh_pages_branch)}`)
    lines.push(`cname = ${tomlString(project.cname)}`)
    lines.push(`webhook_url = ${tomlString(project.webhook_url)}`)
    lines.push(`report_base_url = ${tomlString(project.report_base_url)}`)
    lines.push(`report_port = ${project.report_port}`)
    lines.push(`report_exposure = ${tomlString(project.report_exposure)}`)
    lines.push(`raw_upload_permission = ${tomlString(project.raw_upload_permission)}`)
    if (project.last_heartbeat_at) {
      lines.push(`last_heartbeat_at = ${tomlString(project.last_heartbeat_at)}`)
    }
    if (project.last_refresh_at) {
      lines.push(`last_refresh_at = ${tomlString(project.last_refresh_at)}`)
    }
    lines.push('')
  }

  writeFileSync(path, lines.join('\n') + '\n', 'utf-8')
}

// ---------------------------------------------------------------------------
// Interval parsing
// ---------------------------------------------------------------------------

export function intervalToSeconds(interval: string): number {
  const match = interval.trim().toLowerCase().match(/^(\d+)\s*(s|m|h)$/)
  if (!match) {
    return intervalToSeconds(DEFAULT_HEARTBEAT_INTERVAL)
  }
  const value = parseInt(match[1]!, 10)
  const unit = match[2]!
  if (value <= 0) {
    return intervalToSeconds(DEFAULT_HEARTBEAT_INTERVAL)
  }
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600 }
  return value * (multiplier[unit] ?? 60)
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

export function registerProject(
  cfg: Config,
  repoPath: string,
  overrides: Partial<ProjectLike> = {},
): Config {
  const normalized = normalizeConfig(cfg)
  const resolved = normalizePath(repoPath)
  for (const entry of normalized.projects) {
    if (projectContainsPath(entry, resolved)) {
      return normalized
    }
  }

  const projectInput: Record<string, unknown> = {
    path: overrides.path ?? resolved,
    development_path: overrides.development_path ?? resolved,
    memory_path: overrides.memory_path ?? resolved,
  }
  if (overrides.name !== undefined) projectInput.name = overrides.name
  if (overrides.id !== undefined) projectInput.id = overrides.id
  if (overrides.heartbeat_interval !== undefined) projectInput.heartbeat_interval = overrides.heartbeat_interval
  if (overrides.refresh_interval !== undefined) projectInput.refresh_interval = overrides.refresh_interval
  if (overrides.memory_branch !== undefined) projectInput.memory_branch = overrides.memory_branch
  if (overrides.auto_push !== undefined) projectInput.auto_push = overrides.auto_push
  if (overrides.generate_report !== undefined) projectInput.generate_report = overrides.generate_report
  if (overrides.ai_summary_model !== undefined) projectInput.ai_summary_model = overrides.ai_summary_model
  if (overrides.locale !== undefined) projectInput.locale = overrides.locale
  if (overrides.gh_pages_branch !== undefined) projectInput.gh_pages_branch = overrides.gh_pages_branch
  if (overrides.cname !== undefined) projectInput.cname = overrides.cname
  if (overrides.webhook_url !== undefined) projectInput.webhook_url = overrides.webhook_url
  if (overrides.report_base_url !== undefined) projectInput.report_base_url = overrides.report_base_url
  if (overrides.report_port !== undefined) projectInput.report_port = overrides.report_port
  if (overrides.report_exposure !== undefined) projectInput.report_exposure = overrides.report_exposure
  if (overrides.raw_upload_permission !== undefined) projectInput.raw_upload_permission = overrides.raw_upload_permission
  if (overrides.last_heartbeat_at !== undefined) projectInput.last_heartbeat_at = overrides.last_heartbeat_at

  const project = normalizeProjectEntry(projectInput as ProjectLike, normalized)

  return {
    ...normalized,
    projects: [...normalized.projects, project],
  }
}

export function upsertProject(
  cfg: Config,
  repoPath: string,
  overrides: Partial<ProjectLike> = {},
): Config {
  const normalized = normalizeConfig(cfg)
  const resolved = normalizePath(repoPath)
  const existing = findProjectForPath(normalized, resolved)
  if (existing === null) {
    return registerProject(normalized, repoPath, overrides)
  }

  const project = normalizeProjectEntry({
    ...existing,
    ...overrides,
    development_path: overrides.development_path ?? existing.development_path,
    memory_path: overrides.memory_path ?? existing.memory_path,
    memory_branch: overrides.memory_branch ?? existing.memory_branch,
    path: overrides.path ?? existing.path,
  }, normalized)

  return {
    ...normalized,
    projects: normalized.projects.map(entry => (
      entry.id === existing.id ? project : entry
    )),
  }
}

export function findProjectForPath(config: Config, candidatePath: string): ProjectEntry | null {
  const normalized = normalizePath(candidatePath)
  let bestMatch: ProjectEntry | null = null
  let bestLength = -1

  for (const entry of config.projects) {
    for (const root of projectRoots(entry)) {
      if (!pathContains(root, normalized)) continue
      if (root.length > bestLength) {
        bestMatch = entry
        bestLength = root.length
      }
    }
  }

  return bestMatch
}

export function resolveReportPort(config: Config, candidatePath: string): number {
  const project = findProjectForPath(config, candidatePath)
  return project?.report_port ?? config.report_port
}

export function resolveReportExposure(config: Config, candidatePath: string): ReportExposure {
  const project = findProjectForPath(config, candidatePath)
  return project?.report_exposure ?? config.report_exposure
}

export function projectExecutionPath(project: ProjectEntry): string {
  return normalizePath(project.memory_path || project.path || project.development_path)
}

export function projectDisplayName(project: ProjectEntry): string {
  return project.name || basename(project.development_path || project.path || project.memory_path)
}

export function projectIsDue(project: ProjectEntry, now: Date = new Date()): boolean {
  if (!project.last_heartbeat_at) return true

  const lastRunMs = Date.parse(project.last_heartbeat_at)
  if (!Number.isFinite(lastRunMs)) return true

  const dueAfterMs = intervalToSeconds(project.heartbeat_interval) * 1000
  return now.getTime() - lastRunMs >= dueAfterMs
}

export function projectRefreshIsDue(project: ProjectEntry, now: Date = new Date()): boolean {
  if (!project.last_refresh_at) return true

  const lastRefreshMs = Date.parse(project.last_refresh_at)
  if (!Number.isFinite(lastRefreshMs)) return true

  const dueAfterMs = intervalToSeconds(project.refresh_interval) * 1000
  return now.getTime() - lastRefreshMs >= dueAfterMs
}

export function noteProjectHeartbeatRun(config: Config, projectId: string, at: string): Config {
  const normalized = normalizeConfig(config)
  return {
    ...normalized,
    projects: normalized.projects.map(project => (
      project.id === projectId
        ? { ...project, last_heartbeat_at: at }
        : project
    )),
  }
}

export function noteProjectRefreshRun(config: Config, projectId: string, at: string): Config {
  const normalized = normalizeConfig(config)
  return {
    ...normalized,
    projects: normalized.projects.map(project => (
      project.id === projectId
        ? { ...project, last_refresh_at: at }
        : project
    )),
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function defaultConfig(): Config {
  return {
    heartbeat_interval: DEFAULT_HEARTBEAT_INTERVAL,
    watch_dirs: [],
    projects: [],
    auto_push: DEFAULT_AUTO_PUSH,
    log_level: DEFAULT_LOG_LEVEL,
    generate_report: DEFAULT_GENERATE_REPORT,
    ai_summary_model: DEFAULT_AI_SUMMARY_MODEL,
    locale: DEFAULT_LOCALE,
    gh_pages_branch: DEFAULT_GH_PAGES_BRANCH,
    cname: DEFAULT_CNAME,
    webhook_url: DEFAULT_WEBHOOK_URL,
    report_base_url: DEFAULT_REPORT_BASE_URL,
    report_port: DEFAULT_REPORT_PORT,
    report_exposure: DEFAULT_REPORT_EXPOSURE,
  }
}

function parseRaw(raw: Record<string, unknown>): Config {
  const interval = typeof raw['heartbeat_interval'] === 'string' && isValidInterval(raw['heartbeat_interval'])
    ? raw['heartbeat_interval']
    : DEFAULT_HEARTBEAT_INTERVAL

  const autoPush = typeof raw['auto_push'] === 'boolean'
    ? raw['auto_push']
    : DEFAULT_AUTO_PUSH

  const rawLogLevel = raw['log_level']
  const logLevel = typeof rawLogLevel === 'string' && VALID_LOG_LEVELS.has(rawLogLevel.toLowerCase())
    ? rawLogLevel.toLowerCase()
    : DEFAULT_LOG_LEVEL

  const watchDirs: string[] = []
  const rawDirs = raw['watch_dirs']
  if (Array.isArray(rawDirs)) {
    for (const dir of rawDirs) {
      if (typeof dir === 'string') {
        watchDirs.push(dir)
      }
    }
  }

  const generateReport = typeof raw['generate_report'] === 'boolean'
    ? raw['generate_report']
    : DEFAULT_GENERATE_REPORT

  const aiSummaryModel = typeof raw['ai_summary_model'] === 'string' && raw['ai_summary_model']
    ? raw['ai_summary_model']
    : DEFAULT_AI_SUMMARY_MODEL

  const locale = typeof raw['locale'] === 'string' && raw['locale']
    ? raw['locale']
    : DEFAULT_LOCALE

  const ghPagesBranch = typeof raw['gh_pages_branch'] === 'string'
    ? raw['gh_pages_branch']
    : DEFAULT_GH_PAGES_BRANCH

  const cname = typeof raw['cname'] === 'string'
    ? raw['cname']
    : DEFAULT_CNAME

  const webhookUrl = typeof raw['webhook_url'] === 'string'
    ? raw['webhook_url']
    : DEFAULT_WEBHOOK_URL

  const reportBaseUrl = typeof raw['report_base_url'] === 'string'
    ? raw['report_base_url']
    : DEFAULT_REPORT_BASE_URL

  const reportPort = isValidPort(raw['report_port'])
    ? raw['report_port']
    : DEFAULT_REPORT_PORT
  const reportExposure = normalizeReportExposure(raw['report_exposure'], DEFAULT_REPORT_EXPOSURE)

  const cfg: Config = {
    heartbeat_interval: interval,
    watch_dirs: watchDirs,
    projects: [],
    auto_push: autoPush,
    log_level: logLevel,
    generate_report: generateReport,
    ai_summary_model: aiSummaryModel,
    locale,
    gh_pages_branch: ghPagesBranch,
    cname,
    webhook_url: webhookUrl,
    report_base_url: reportBaseUrl,
    report_port: reportPort,
    report_exposure: reportExposure,
  }

  const projects: ProjectEntry[] = []
  const rawProjects = raw['projects']
  if (Array.isArray(rawProjects)) {
    for (const entry of rawProjects) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      try {
        const normalized = normalizeProjectEntry(entry as ProjectLike, cfg)
        projects.push(normalized)
      } catch {
        continue
      }
    }
  }

  return {
    ...cfg,
    projects,
  }
}

function normalizeConfig(cfg: Config): Config {
  const normalizedBase: Config = {
    heartbeat_interval: isValidInterval(cfg.heartbeat_interval) ? cfg.heartbeat_interval : DEFAULT_HEARTBEAT_INTERVAL,
    watch_dirs: [...cfg.watch_dirs].filter((dir): dir is string => typeof dir === 'string'),
    projects: [],
    auto_push: typeof cfg.auto_push === 'boolean' ? cfg.auto_push : DEFAULT_AUTO_PUSH,
    log_level: isValidLogLevel(cfg.log_level) ? cfg.log_level.toLowerCase() : DEFAULT_LOG_LEVEL,
    generate_report: typeof cfg.generate_report === 'boolean' ? cfg.generate_report : DEFAULT_GENERATE_REPORT,
    ai_summary_model: nonEmptyString(cfg.ai_summary_model, DEFAULT_AI_SUMMARY_MODEL),
    locale: nonEmptyString(cfg.locale, DEFAULT_LOCALE),
    gh_pages_branch: stringOrDefault(cfg.gh_pages_branch, DEFAULT_GH_PAGES_BRANCH),
    cname: stringOrDefault(cfg.cname, DEFAULT_CNAME),
    webhook_url: stringOrDefault(cfg.webhook_url, DEFAULT_WEBHOOK_URL),
    report_base_url: stringOrDefault(cfg.report_base_url, DEFAULT_REPORT_BASE_URL),
    report_port: isValidPort(cfg.report_port) ? cfg.report_port : DEFAULT_REPORT_PORT,
    report_exposure: normalizeReportExposure(cfg.report_exposure, DEFAULT_REPORT_EXPOSURE),
  }

  const projects = cfg.projects.map(project => normalizeProjectEntry(project, normalizedBase))
  return {
    ...normalizedBase,
    projects,
  }
}

function normalizeProjectEntry(project: ProjectLike, cfg: Config): ProjectEntry {
  const rawPath = maybeNormalizePath(project.path)
  const developmentPath = maybeNormalizePath(project.development_path) || rawPath
  const memoryPath = maybeNormalizePath(project.memory_path) || rawPath || developmentPath
  const canonicalPath = memoryPath || rawPath || developmentPath

  if (!canonicalPath) {
    throw new Error('Project entry requires at least one path.')
  }

  const resolvedDevelopmentPath = developmentPath || canonicalPath
  const resolvedMemoryPath = memoryPath || canonicalPath
  const name = nonEmptyString(project.name, basename(resolvedDevelopmentPath))
  const id = createProjectId(
    typeof project.id === 'string' ? project.id : '',
    resolvedDevelopmentPath,
    resolvedMemoryPath,
  )

  return {
    id,
    path: canonicalPath,
    name,
    development_path: resolvedDevelopmentPath,
    memory_path: resolvedMemoryPath,
    memory_branch: nonEmptyString(project.memory_branch, DEFAULT_MEMORY_BRANCH),
    heartbeat_interval: isValidInterval(project.heartbeat_interval ?? '') ? project.heartbeat_interval! : cfg.heartbeat_interval,
    refresh_interval: isValidInterval(project.refresh_interval ?? '') ? project.refresh_interval! : DEFAULT_REFRESH_INTERVAL,
    auto_push: typeof project.auto_push === 'boolean' ? project.auto_push : cfg.auto_push,
    generate_report: typeof project.generate_report === 'boolean' ? project.generate_report : cfg.generate_report,
    ai_summary_model: nonEmptyString(project.ai_summary_model, cfg.ai_summary_model),
    locale: nonEmptyString(project.locale, cfg.locale),
    gh_pages_branch: stringOrDefault(project.gh_pages_branch, cfg.gh_pages_branch),
    cname: stringOrDefault(project.cname, cfg.cname),
    webhook_url: stringOrDefault(project.webhook_url, cfg.webhook_url),
    report_base_url: stringOrDefault(project.report_base_url, cfg.report_base_url),
    report_port: isValidPort(project.report_port) ? project.report_port : cfg.report_port,
    report_exposure: normalizeReportExposure(project.report_exposure, cfg.report_exposure),
    raw_upload_permission: normalizeRawUploadPermission(
      project.raw_upload_permission,
      DEFAULT_RAW_UPLOAD_PERMISSION,
    ),
    last_heartbeat_at: isValidIsoTimestamp(project.last_heartbeat_at) ? project.last_heartbeat_at : '',
    last_refresh_at: isValidIsoTimestamp(project.last_refresh_at) ? project.last_refresh_at : '',
  }
}

function isValidInterval(value: string): boolean {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(s|m|h)$/)
  if (!match) return false
  return parseInt(match[1]!, 10) > 0
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0
    && value <= 65535
}

function normalizeReportExposure(value: unknown, fallback: ReportExposure): ReportExposure {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return normalized === 'lan' ? 'lan' : normalized === 'local' ? 'local' : fallback
}

export function normalizeRawUploadPermission(value: unknown, fallback: RawUploadPermission): RawUploadPermission {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return normalized === 'approved' || normalized === 'denied' || normalized === 'not-set'
    ? normalized
    : fallback
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Number.isFinite(Date.parse(value))
}

function isValidLogLevel(value: unknown): value is string {
  return typeof value === 'string' && VALID_LOG_LEVELS.has(value.toLowerCase())
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function maybeNormalizePath(value: unknown): string {
  return typeof value === 'string' && value
    ? normalizePath(value)
    : ''
}

function normalizePath(value: string): string {
  if (value.startsWith('/')) {
    return toPosixPath(value)
  }
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    return toPosixPath(resolve(value))
  }
  return toPosixPath(resolve(value))
}

function createProjectId(requestedId: string, developmentPath: string, memoryPath: string): string {
  const source = requestedId || `${developmentPath}--${memoryPath}`
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return normalized || 'project'
}

function projectRoots(project: ProjectEntry): string[] {
  return [...new Set([
    normalizePath(project.development_path),
    normalizePath(project.memory_path),
    normalizePath(project.path),
  ])]
}

function projectContainsPath(project: ProjectEntry, candidatePath: string): boolean {
  return projectRoots(project).some(root => pathContains(root, candidatePath))
}

function pathContains(root: string, candidate: string): boolean {
  if (candidate === root) return true
  const prefix = root.endsWith('/') ? root : `${root}/`
  return candidate.startsWith(prefix)
}

function tomlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}
