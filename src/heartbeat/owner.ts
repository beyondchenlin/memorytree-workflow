import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

import { resolveSkillRoot, toPosixPath } from '../utils/path.js'

export type HeartbeatOwnerId = 'claude' | 'codex' | 'gemini' | 'unknown'

export interface HeartbeatOwner {
  readonly owner_id: HeartbeatOwnerId
  readonly owner_label: string
  readonly skill_root: string
  readonly script_path: string
  readonly acquired_at: string
}

export function heartbeatOwnerPath(): string {
  return resolve(homedir(), '.memorytree', 'heartbeat-owner.json')
}

export function detectHeartbeatOwner(options: {
  skillRoot?: string
  scriptPath?: string
  acquiredAt?: string
} = {}): HeartbeatOwner {
  const scriptPath = resolveOwnerScriptPath(options.scriptPath)
  const skillRoot = toPosixPath(resolve(
    options.skillRoot
      ?? inferSkillRootFromScriptPath(scriptPath)
      ?? resolveCurrentSkillRoot()
      ?? dirname(scriptPath),
  ))
  const ownerId = inferHeartbeatOwnerId(`${skillRoot}\n${scriptPath}`)

  return {
    owner_id: ownerId,
    owner_label: heartbeatOwnerLabel(ownerId),
    skill_root: skillRoot,
    script_path: scriptPath,
    acquired_at: options.acquiredAt ?? new Date().toISOString(),
  }
}

function resolveOwnerScriptPath(scriptPath: string | undefined): string {
  if (typeof scriptPath === 'string' && scriptPath.trim()) {
    return toPosixPath(resolve(scriptPath))
  }
  if (typeof process.argv[1] === 'string' && process.argv[1].trim()) {
    return toPosixPath(resolve(process.argv[1]))
  }

  const currentSkillRoot = resolveCurrentSkillRoot()
  if (currentSkillRoot !== null) {
    return toPosixPath(resolve(currentSkillRoot, 'dist', 'cli.js'))
  }

  return toPosixPath(resolve('dist', 'cli.js'))
}

function inferSkillRootFromScriptPath(scriptPath: string): string | null {
  const resolved = resolve(scriptPath)
  const parent = dirname(resolved)
  if (basename(resolved).toLowerCase() === 'cli.js' && basename(parent).toLowerCase() === 'dist') {
    return toPosixPath(dirname(parent))
  }
  return toPosixPath(parent)
}

function resolveCurrentSkillRoot(): string | null {
  try {
    return toPosixPath(resolve(resolveSkillRoot(import.meta.url)))
  } catch {
    return null
  }
}

export function readHeartbeatOwner(): HeartbeatOwner | null {
  const path = heartbeatOwnerPath()
  if (!existsSync(path)) return null

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const ownerId = parsed['owner_id']
    const ownerLabel = parsed['owner_label']
    const skillRoot = parsed['skill_root']
    const scriptPath = parsed['script_path']
    const acquiredAt = parsed['acquired_at']

    if (!isHeartbeatOwnerId(ownerId)) return null
    if (typeof ownerLabel !== 'string') return null
    if (typeof skillRoot !== 'string') return null
    if (typeof scriptPath !== 'string') return null
    if (typeof acquiredAt !== 'string') return null

    return {
      owner_id: ownerId,
      owner_label: ownerLabel,
      skill_root: skillRoot,
      script_path: scriptPath,
      acquired_at: acquiredAt,
    }
  } catch {
    return null
  }
}

export function writeHeartbeatOwner(owner: HeartbeatOwner): void {
  const path = heartbeatOwnerPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(owner, null, 2)}\n`, 'utf-8')
}

export function clearHeartbeatOwner(): void {
  const path = heartbeatOwnerPath()
  if (!existsSync(path)) return

  try {
    unlinkSync(path)
  } catch {
    // best effort
  }
}

export function sameHeartbeatOwner(left: HeartbeatOwner | null, right: HeartbeatOwner): boolean {
  if (left === null) return false
  return left.owner_id === right.owner_id
    && left.skill_root === right.skill_root
    && left.script_path === right.script_path
}

function inferHeartbeatOwnerId(value: string): HeartbeatOwnerId {
  const normalized = value.replace(/\\/g, '/').toLowerCase()
  if (normalized.includes('/.claude/')) return 'claude'
  if (normalized.includes('/.codex/') || normalized.includes('/.agents/skills/')) return 'codex'
  if (normalized.includes('/.gemini/')) return 'gemini'
  return 'unknown'
}

function heartbeatOwnerLabel(ownerId: HeartbeatOwnerId): string {
  if (ownerId === 'claude') return 'Claude Code'
  if (ownerId === 'codex') return 'Codex'
  if (ownerId === 'gemini') return 'Gemini CLI'
  return 'Custom Runtime'
}

function isHeartbeatOwnerId(value: unknown): value is HeartbeatOwnerId {
  return value === 'claude' || value === 'codex' || value === 'gemini' || value === 'unknown'
}
