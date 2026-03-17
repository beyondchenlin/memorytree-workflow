/**
 * Load, validate, and manage ~/.memorytree/config.toml.
 * Port of scripts/_config_utils.py
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { toPosixPath } from '../utils/path.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL = '5m'
const DEFAULT_AUTO_PUSH = true
const DEFAULT_LOG_LEVEL = 'info'
const DEFAULT_GENERATE_REPORT = false
const DEFAULT_AI_SUMMARY_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_LOCALE = 'en'
const DEFAULT_GH_PAGES_BRANCH = ''
const DEFAULT_CNAME = ''
const DEFAULT_WEBHOOK_URL = ''
const DEFAULT_REPORT_BASE_URL = ''
const VALID_LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectEntry {
  readonly path: string
  readonly name: string
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
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })

  const lines: string[] = [
    `heartbeat_interval = ${tomlString(cfg.heartbeat_interval)}`,
    `auto_push = ${cfg.auto_push ? 'true' : 'false'}`,
    `log_level = ${tomlString(cfg.log_level)}`,
    `generate_report = ${cfg.generate_report ? 'true' : 'false'}`,
    `ai_summary_model = ${tomlString(cfg.ai_summary_model)}`,
    `locale = ${tomlString(cfg.locale ?? DEFAULT_LOCALE)}`,
    `gh_pages_branch = ${tomlString(cfg.gh_pages_branch ?? DEFAULT_GH_PAGES_BRANCH)}`,
    `cname = ${tomlString(cfg.cname ?? DEFAULT_CNAME)}`,
    `webhook_url = ${tomlString(cfg.webhook_url ?? DEFAULT_WEBHOOK_URL)}`,
    `report_base_url = ${tomlString(cfg.report_base_url ?? DEFAULT_REPORT_BASE_URL)}`,
  ]

  if (cfg.watch_dirs.length > 0) {
    const items = cfg.watch_dirs.map(d => tomlString(d)).join(', ')
    lines.push(`watch_dirs = [${items}]`)
  } else {
    lines.push('watch_dirs = []')
  }

  lines.push('')
  for (const project of cfg.projects) {
    lines.push('[[projects]]')
    lines.push(`path = ${tomlString(project.path)}`)
    if (project.name) {
      lines.push(`name = ${tomlString(project.name)}`)
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
// Project registration
// ---------------------------------------------------------------------------

export function registerProject(cfg: Config, repoPath: string): Config {
  const resolved = toPosixPath(resolve(repoPath))
  for (const entry of cfg.projects) {
    if (toPosixPath(resolve(entry.path)) === resolved) {
      return cfg
    }
  }
  const name = resolved.split('/').pop() ?? ''
  return {
    ...cfg,
    projects: [...cfg.projects, { path: resolved, name }],
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
  }
}

function parseRaw(raw: Record<string, unknown>): Config {
  let interval = raw['heartbeat_interval']
  if (typeof interval !== 'string' || !isValidInterval(interval)) {
    interval = DEFAULT_HEARTBEAT_INTERVAL
  }

  let autoPush = raw['auto_push']
  if (typeof autoPush !== 'boolean') {
    autoPush = DEFAULT_AUTO_PUSH
  }

  let logLevel = raw['log_level']
  if (typeof logLevel !== 'string' || !VALID_LOG_LEVELS.has(logLevel.toLowerCase())) {
    logLevel = DEFAULT_LOG_LEVEL
  }
  logLevel = (logLevel as string).toLowerCase()

  const watchDirs: string[] = []
  const rawDirs = raw['watch_dirs']
  if (Array.isArray(rawDirs)) {
    for (const d of rawDirs) {
      if (typeof d === 'string') watchDirs.push(d)
    }
  }

  const projects: ProjectEntry[] = []
  const rawProjects = raw['projects']
  if (Array.isArray(rawProjects)) {
    for (const entry of rawProjects) {
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        const rec = entry as Record<string, unknown>
        if (typeof rec['path'] === 'string') {
          projects.push({
            path: rec['path'] as string,
            name: String(rec['name'] ?? ''),
          })
        }
      }
    }
  }

  let generateReport = raw['generate_report']
  if (typeof generateReport !== 'boolean') {
    generateReport = DEFAULT_GENERATE_REPORT
  }

  let aiSummaryModel = raw['ai_summary_model']
  if (typeof aiSummaryModel !== 'string' || !aiSummaryModel) {
    aiSummaryModel = DEFAULT_AI_SUMMARY_MODEL
  }

  let locale = raw['locale']
  if (typeof locale !== 'string' || !locale) {
    locale = DEFAULT_LOCALE
  }

  let ghPagesBranch = raw['gh_pages_branch']
  if (typeof ghPagesBranch !== 'string') {
    ghPagesBranch = DEFAULT_GH_PAGES_BRANCH
  }

  let cname = raw['cname']
  if (typeof cname !== 'string') {
    cname = DEFAULT_CNAME
  }

  let webhookUrl = raw['webhook_url']
  if (typeof webhookUrl !== 'string') {
    webhookUrl = DEFAULT_WEBHOOK_URL
  }

  let reportBaseUrl = raw['report_base_url']
  if (typeof reportBaseUrl !== 'string') {
    reportBaseUrl = DEFAULT_REPORT_BASE_URL
  }

  return {
    heartbeat_interval: interval as string,
    watch_dirs: watchDirs,
    projects,
    auto_push: autoPush as boolean,
    log_level: logLevel as string,
    generate_report: generateReport as boolean,
    ai_summary_model: aiSummaryModel as string,
    locale: locale as string,
    gh_pages_branch: ghPagesBranch as string,
    cname: cname as string,
    webhook_url: webhookUrl as string,
    report_base_url: reportBaseUrl as string,
  }
}

function isValidInterval(value: string): boolean {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(s|m|h)$/)
  if (!match) return false
  return parseInt(match[1]!, 10) > 0
}

function tomlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}
