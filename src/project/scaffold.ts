/**
 * Scaffold — directory init + template rendering.
 * Port of scripts/_scaffold_utils.py
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { toPosixPath } from '../utils/path.js'
import { normalizeLocale } from './locale.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MEMORY_DIRS: readonly string[] = [
  'Memory/01_goals',
  'Memory/02_todos',
  'Memory/03_chat_logs',
  'Memory/04_knowledge',
  'Memory/05_archive',
]

export const CONTENT_POLICY_SOURCE_PATTERNS: readonly string[] = [
  'CONTRIBUTING',
  'CONTRIBUTING.md',
]

export const ALWAYS_POLICY_SOURCE_PATTERNS: readonly string[] = [
  'CODEOWNERS',
  '.github/CODEOWNERS',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  '.pre-commit-config.yaml',
  '.pre-commit-config.yml',
]

const POLICY_TEXT_PATTERNS: readonly RegExp[] = [
  /\bpull request\b/i, /\bmerge request\b/i, /\bpr\b/i,
  /\bbranch(?:es)?\b/i, /\bprotected branch(?:es)?\b/i,
  /\bcommit(?: message)?\b/i, /\bconventional commit(?:s)?\b/i,
  /\breview(?:er|ers)?\b/i, /\bapproval(?:s)?\b/i,
  /\bci\b/i, /\bpipeline(?:s)?\b/i, /\bauto-merge\b/i,
  /\bpre-commit\b/i, /\bcodeowners\b/i,
  /拉取请求/, /合并请求/, /分支/, /提交信息/, /提交标题/,
  /评审/, /审批/, /流水线/, /检查/, /自动合并/, /提交规范/,
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldPaths {
  readonly root: string
  readonly goalDir: string
  readonly todoDir: string
  readonly chatDir: string
  readonly goalPath: string
  readonly todoPath: string
  readonly chatPath: string
  readonly goalVersion: string
  readonly todoVersion: string
  readonly previousVersion: string
  readonly dateLabel: string
  readonly timeLabel: string
}

// ---------------------------------------------------------------------------
// DateTime helper
// ---------------------------------------------------------------------------

export function buildDatetime(dateValue: string, timeValue: string): Date {
  if (dateValue && timeValue) {
    return new Date(`${dateValue}T${timeValue}:00`)
  }
  if (dateValue) {
    return new Date(`${dateValue}T00:00:00`)
  }
  if (timeValue) {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    return new Date(`${y}-${m}-${d}T${timeValue}:00`)
  }
  return new Date()
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export function resolveTemplateDir(skillRoot: string, root: string, localeValue: string): string {
  const templatesRoot = join(skillRoot, 'assets', 'templates')
  const localeName = normalizeLocale(localeValue, root)
  const templateDir = join(templatesRoot, localeName)
  if (!existsSync(templateDir)) {
    throw new Error(`unsupported locale: ${localeValue}`)
  }
  return templateDir
}

// ---------------------------------------------------------------------------
// Policy detection
// ---------------------------------------------------------------------------

export function findExternalPolicySources(root: string): string[] {
  const matches = new Set<string>()

  for (const pattern of ALWAYS_POLICY_SOURCE_PATTERNS) {
    const p = join(root, pattern)
    if (existsSync(p) && isFile(p)) {
      matches.add(toPosixPath(relative(root, p)))
    }
  }

  for (const pattern of CONTENT_POLICY_SOURCE_PATTERNS) {
    const p = join(root, pattern)
    if (existsSync(p) && isFile(p) && hasPolicyContent(p)) {
      matches.add(toPosixPath(relative(root, p)))
    }
  }

  return [...matches].sort()
}

export function hasPolicyContent(filePath: string): boolean {
  let text: string
  try {
    text = readFileSync(filePath, 'utf-8').toLowerCase()
  } catch {
    return true
  }
  return POLICY_TEXT_PATTERNS.some(pattern => pattern.test(text))
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

export function findLatestVersion(folder: string, pattern: RegExp): string | null {
  if (!existsSync(folder)) return null
  const versions: string[] = []
  try {
    for (const entry of readdirSync(folder)) {
      const match = pattern.exec(entry)
      if (match?.[1]) {
        versions.push(match[1])
      }
    }
  } catch {
    return null
  }
  return versions.length > 0 ? versions.sort().pop()! : null
}

export function findLatestGoalFile(folder: string): string | null {
  const regex = /^goal_v(\d{3})_(\d{8})\.md$/
  const matches: Array<[string, string, string]> = []
  if (!existsSync(folder)) return null
  try {
    for (const entry of readdirSync(folder)) {
      const match = regex.exec(entry)
      if (match) {
        matches.push([match[1]!, match[2]!, join(folder, entry)])
      }
    }
  } catch {
    return null
  }
  if (matches.length === 0) return null
  matches.sort()
  return matches[matches.length - 1]![2]
}

export function findLatestTodoVersion(folder: string, goalVersion: string): string | null {
  const regex = new RegExp(`^todo_v${goalVersion}_(\\d{3})_\\d{8}\\.md$`)
  const versions: string[] = []
  if (!existsSync(folder)) return null
  try {
    for (const entry of readdirSync(folder)) {
      const match = regex.exec(entry)
      if (match?.[1]) versions.push(match[1])
    }
  } catch {
    return null
  }
  return versions.length > 0 ? versions.sort().pop()! : null
}

export function findLatestTodoFile(folder: string, goalVersion: string): string | null {
  const regex = new RegExp(`^todo_v${goalVersion}_(\\d{3})_(\\d{8})\\.md$`)
  const matches: Array<[string, string, string]> = []
  if (!existsSync(folder)) return null
  try {
    for (const entry of readdirSync(folder)) {
      const match = regex.exec(entry)
      if (match) matches.push([match[1]!, match[2]!, join(folder, entry)])
    }
  } catch {
    return null
  }
  if (matches.length === 0) return null
  matches.sort()
  return matches[matches.length - 1]![2]
}

export function findLatestChatLogFile(folder: string): string | null {
  const regex = /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})\.md$/
  const matches: Array<[string, string, string]> = []
  if (!existsSync(folder)) return null
  try {
    for (const entry of readdirSync(folder)) {
      const match = regex.exec(entry)
      if (match) matches.push([match[1]!, match[2]!, join(folder, entry)])
    }
  } catch {
    return null
  }
  if (matches.length === 0) return null
  matches.sort()
  return matches[matches.length - 1]![2]
}

// ---------------------------------------------------------------------------
// Template writing
// ---------------------------------------------------------------------------

export function writeTemplate(
  templatePath: string,
  targetPath: string,
  force: boolean,
  values: Record<string, string>,
): boolean {
  if (existsSync(targetPath) && !force) return false
  let content = readFileSync(templatePath, 'utf-8')
  for (const [key, value] of Object.entries(values)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }
  mkdirSync(join(targetPath, '..'), { recursive: true })
  writeFileSync(targetPath, content, 'utf-8')
  return true
}

// ---------------------------------------------------------------------------
// Scaffold paths
// ---------------------------------------------------------------------------

export function resolveScaffoldPaths(root: string, dt: Date): ScaffoldPaths {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')

  const dateToken = `${y}${m}${d}`
  const dateLabel = `${y}-${m}-${d}`
  const timeLabel = `${hh}:${mm}`
  const chatFilename = `${y}-${m}-${d}_${hh}-${mm}.md`

  const goalDir = join(root, 'Memory', '01_goals')
  const todoDir = join(root, 'Memory', '02_todos')
  const chatDir = join(root, 'Memory', '03_chat_logs')

  let goalVersion = findLatestVersion(goalDir, /^goal_v(\d{3})_\d{8}\.md$/)
  if (goalVersion === null) goalVersion = '001'
  const prevNum = parseInt(goalVersion, 10)
  const previousVersion = prevNum > 1 ? `v${String(prevNum - 1).padStart(3, '0')}` : 'none'

  let todoVersion = findLatestTodoVersion(todoDir, goalVersion)
  if (todoVersion === null) todoVersion = '001'

  const goalPath = findLatestGoalFile(goalDir) ?? join(goalDir, `goal_v${goalVersion}_${dateToken}.md`)
  const todoPath = findLatestTodoFile(todoDir, goalVersion) ?? join(todoDir, `todo_v${goalVersion}_${todoVersion}_${dateToken}.md`)
  const chatPath = findLatestChatLogFile(chatDir) ?? join(chatDir, chatFilename)

  return {
    root,
    goalDir,
    todoDir,
    chatDir,
    goalPath,
    todoPath,
    chatPath,
    goalVersion,
    todoVersion,
    previousVersion,
    dateLabel,
    timeLabel,
  }
}

// ---------------------------------------------------------------------------
// Directory creation
// ---------------------------------------------------------------------------

export function createMemoryDirs(root: string): string[] {
  const created: string[] = []
  for (const rel of MEMORY_DIRS) {
    const p = join(root, rel)
    if (!existsSync(p)) {
      created.push(toPosixPath(rel))
    }
    mkdirSync(p, { recursive: true })
  }
  return created
}

// ---------------------------------------------------------------------------
// Content scaffolding
// ---------------------------------------------------------------------------

export function scaffoldContentFiles(
  paths: ScaffoldPaths,
  templates: string,
  goalSummary: string,
  projectName: string,
  force: boolean,
): { created: string[]; preserved: string[] } {
  const created: string[] = []
  const preserved: string[] = []

  const pairs: Array<[string, string, Record<string, string>]> = [
    [
      join(templates, 'goal.md'),
      paths.goalPath,
      {
        GOAL_VERSION: paths.goalVersion,
        DATE: paths.dateLabel,
        PREVIOUS_VERSION: paths.previousVersion,
        GOAL_SUMMARY: goalSummary.trim(),
      },
    ],
    [
      join(templates, 'todo.md'),
      paths.todoPath,
      {
        GOAL_VERSION: paths.goalVersion,
        TODO_SUBVERSION: paths.todoVersion,
        DATE: paths.dateLabel,
      },
    ],
    [
      join(templates, 'chat-log.md'),
      paths.chatPath,
      {
        DATE: paths.dateLabel,
        TIME: paths.timeLabel,
        PROJECT_NAME: projectName.trim(),
      },
    ],
  ]

  for (const [templatePath, targetPath, values] of pairs) {
    if (writeTemplate(templatePath, targetPath, force, values)) {
      created.push(toPosixPath(relative(paths.root, targetPath)))
    } else {
      preserved.push(toPosixPath(relative(paths.root, targetPath)))
    }
  }

  return { created, preserved }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isFile(p: string): boolean {
  try { return statSync(p).isFile() } catch { return false }
}
