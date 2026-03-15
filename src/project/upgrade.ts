/**
 * Upgrade — upgrade detection + execution.
 * Port of scripts/upgrade-memorytree.py
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { toPosixPath } from '../utils/path.js'

import {
  createMemoryDirs,
  findExternalPolicySources,
  findLatestChatLogFile,
  findLatestGoalFile,
  findLatestTodoFile,
  resolveScaffoldPaths,
  scaffoldContentFiles,
  writeTemplate,
} from './scaffold.js'

// ---------------------------------------------------------------------------
// State detection
// ---------------------------------------------------------------------------

export function detectState(root: string): string {
  const memoryDir = join(root, 'Memory')
  const goalDir = join(root, 'Memory', '01_goals')
  const todoDir = join(root, 'Memory', '02_todos')
  const chatDir = join(root, 'Memory', '03_chat_logs')
  const agentsPath = join(root, 'AGENTS.md')
  const policySources = findExternalPolicySources(root)

  const latestGoal = findLatestGoalFile(goalDir)
  const goalVersion = extractGoalVersion(latestGoal)
  const hasGoal = latestGoal !== null
  const hasTodo = goalVersion !== null && findLatestTodoFile(todoDir, goalVersion) !== null
  const hasChat = findLatestChatLogFile(chatDir) !== null
  const hasAgents = existsSync(agentsPath) && isFile(agentsPath)
  const agentsReady = hasAgents && !needsAgentsMerge(agentsPath)

  if (!existsSync(memoryDir)) {
    return (hasAgents || policySources.length > 0) ? 'partial' : 'not-installed'
  }
  if (hasGoal && hasTodo && hasChat && agentsReady) {
    return 'installed'
  }
  return 'partial'
}

export function extractGoalVersion(filePath: string | null): string | null {
  if (filePath === null) return null
  const name = basename(toPosixPath(filePath))
  const match = /^goal_v(\d{3})_\d{8}\.md$/.exec(name)
  return match?.[1] ?? null
}

// ---------------------------------------------------------------------------
// AGENTS.md completeness check (9 signals)
// ---------------------------------------------------------------------------

export function needsAgentsMerge(agentsPath: string): boolean {
  let text: string
  try {
    text = readFileSync(agentsPath, 'utf-8').toLowerCase()
  } catch {
    return true
  }

  const checks = [
    hasReadOrderSignal(text),
    hasMemoryLayoutSignal(text),
    hasActiveTodoRule(text),
    hasAppendOnlyChatLogRule(text),
    hasRepoSafetyRule(text),
    hasCommitTitleRule(text),
    hasDedicatedMemorytreePrFlow(text),
    hasMemorytreeOnlyScopeRule(text),
    hasAutoMergeRule(text),
  ]
  return !checks.every(Boolean)
}

// ---------------------------------------------------------------------------
// Signal detectors
// ---------------------------------------------------------------------------

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(p => p.test(text))
}

function matchesAllConcepts(text: string, groups: readonly (readonly RegExp[])[]): boolean {
  return groups.every(patterns => matchesAny(text, patterns))
}

export function hasReadOrderSignal(text: string): boolean {
  return matchesAny(text, [
    /\bread order\b/, /\bread .* in order\b/, /读取顺序/, /按此顺序读取/,
  ])
}

export function hasMemoryLayoutSignal(text: string): boolean {
  return matchesAllConcepts(text, [
    [/memory\/01_goals/, /\b01_goals\b/],
    [/memory\/02_todos/, /\b02_todos\b/],
    [/memory\/03_chat_logs/, /\b03_chat_logs\b/],
  ])
}

export function hasActiveTodoRule(text: string): boolean {
  return matchesAny(text, [
    /keep .*todo .*synchron/,
    /todo .*aligned .*active goal/,
    /(sync|align|keep|maintain|bind).{0,50}(active|current).{0,20}todo.{0,50}(active|current).{0,20}goal/,
    /(active|current).{0,20}todo.{0,50}(sync|align|match|bound).{0,50}(active|current).{0,20}goal/,
    /当前待办必须与当前目标保持同步/,
    /待办必须与当前目标保持同步/,
  ])
}

export function hasAppendOnlyChatLogRule(text: string): boolean {
  return matchesAny(text, [
    /append[- ]only .*chat log/,
    /append[- ]only records/,
    /treat chat logs as append[- ]only/,
    /never rewrite or delete prior entries/,
    /对话日志只追加/,
    /禁止重写或删除既有内容/,
  ])
}

export function hasRepoSafetyRule(text: string): boolean {
  return matchesAllConcepts(text, [
    [/\bpr\b/, /\bpull request\b/, /\bmerge request\b/, /拉取请求/, /合并请求/],
    [/\bci\b/, /\bchecks?\b/, /\bpipeline\b/, /\be2e\b/, /检查/, /流水线/],
    [/\breview(?:er|ers)?\b/, /\bapproval(?:s)?\b/, /评审/, /审批/],
    [/\bbranch(?:es)?\b/, /\bprotected branch(?:es)?\b/, /分支/],
  ]) && matchesAny(text, [
    /\brepository\b/, /\brepo\b/, /\bproject\b/, /\bhost\b/,
    /\brule(?:s)?\b/, /\brequirement(?:s)?\b/, /\bpolicy\b/, /\bcontrol(?:s)?\b/,
    /仓库/, /规则/, /要求/,
  ])
}

export function hasCommitTitleRule(text: string): boolean {
  return matchesAny(text, [
    /\bmemorytree\([^)]*\):/, /\b[a-z]+\((memorytree)\):/,
    /\bmemorytree:/, /memorytree-scoped commit title/,
    /memorytree-specific commit title/, /use .*memorytree.*commit title/,
    /提交标题.*memorytree/,
  ])
}

export function hasDedicatedMemorytreePrFlow(text: string): boolean {
  return matchesAllConcepts(text, [
    [/\bmemorytree\b/, /记忆/],
    [/\bbranch(?:es)?\b/, /分支/],
    [/\bpr\b/, /\bpull request\b/, /\bmerge request\b/, /拉取请求/, /合并请求/],
    [/\bdedicated\b/, /\bseparate\b/, /\bisolated\b/, /\bown\b/, /专用/, /独立/],
  ])
}

export function hasMemorytreeOnlyScopeRule(text: string): boolean {
  return matchesAny(text, [
    /memorytree[- ]owned changes/,
    /memorytree[- ]owned files/,
    /memorytree-managed files/,
    /(stage|push|commit).{0,40}only.{0,40}memorytree[- ]owned.{0,20}(files|changes)?/,
    /(stage|push|commit).{0,40}only.{0,40}memorytree.{0,20}(files|changes|diff)/,
    /only.{0,40}memorytree.{0,20}(files|changes|diff)/,
    /仅自动提交和推送.*memorytree.*变更/,
    /由 memorytree 管理/,
  ])
}

export function hasAutoMergeRule(text: string): boolean {
  return matchesAny(text, [
    /auto-merge only when .*permit/,
    /only when repository rules permit/,
    /only when repo rules permit/,
    /only enable auto-merge when.{0,60}(required )?(approvals|checks|reviews?)/,
    /auto-merge.{0,60}(required approvals|required checks|repository rules)/,
    /仅在仓库规则允许时才开启自动合并/,
  ])
}

// ---------------------------------------------------------------------------
// Upgrade execution
// ---------------------------------------------------------------------------

export interface UpgradeResult {
  state_before: string
  state_after: string
  requested_locale: string
  effective_locale: string
  created_dirs: string[]
  created_files: string[]
  preserved_files: string[]
  agents_action: string
  agents_merge_required: boolean
}

export function upgrade(
  root: string,
  skillRoot: string,
  templates: string,
  effectiveLocale: string,
  requestedLocale: string,
  goalSummary: string,
  projectName: string,
  dt: Date,
): UpgradeResult {
  const initialState = detectState(root)

  const createdDirs = createMemoryDirs(root)
  const paths = resolveScaffoldPaths(root, dt)
  const { created: createdFiles, preserved: preservedFiles } = scaffoldContentFiles(
    paths, templates, goalSummary, projectName, false,
  )

  const agentsPath = join(root, 'AGENTS.md')
  let agentsAction = 'preserved_existing'
  if (!existsSync(agentsPath)) {
    const agentsTemplate = join(templates, 'agents.md')
    if (existsSync(agentsTemplate) && writeTemplate(agentsTemplate, agentsPath, false, {})) {
      createdFiles.push('AGENTS.md')
      agentsAction = 'created'
    }
  } else {
    preservedFiles.push('AGENTS.md')
  }
  const mergeRequired = agentsAction === 'preserved_existing' && needsAgentsMerge(agentsPath)

  return {
    state_before: initialState,
    state_after: detectState(root),
    requested_locale: requestedLocale,
    effective_locale: effectiveLocale,
    created_dirs: createdDirs,
    created_files: createdFiles,
    preserved_files: preservedFiles,
    agents_action: agentsAction,
    agents_merge_required: mergeRequired,
  }
}

export function formatResultText(result: UpgradeResult): string {
  const lines = [
    `state_before: ${result.state_before}`,
    `state_after: ${result.state_after}`,
    `effective_locale: ${result.effective_locale}`,
    `agents_action: ${result.agents_action}`,
    `agents_merge_required: ${result.agents_merge_required}`,
  ]
  if (result.created_dirs.length > 0) {
    lines.push('created_dirs:')
    for (const item of result.created_dirs) lines.push(`- ${item}`)
  }
  if (result.created_files.length > 0) {
    lines.push('created_files:')
    for (const item of result.created_files) lines.push(`- ${item}`)
  }
  if (result.preserved_files.length > 0) {
    lines.push('preserved_files:')
    for (const item of result.preserved_files) lines.push(`- ${item}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isFile(p: string): boolean {
  try { return statSync(p).isFile() } catch { return false }
}
