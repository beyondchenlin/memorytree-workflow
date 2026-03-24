import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { ProjectEntry } from './config.js'

export const DEV_TO_MEMORY_PATHS = [
  'AGENTS.md',
  'Memory/01_goals',
  'Memory/02_todos',
  'Memory/03_chat_logs',
  'Memory/04_knowledge',
  'Memory/05_archive',
] as const

export const MEMORY_TO_DEV_PATHS = [
  'Memory/06_transcripts',
  'Memory/07_reports',
] as const

export const MANAGED_REPO_PATHS = [
  ...DEV_TO_MEMORY_PATHS,
  ...MEMORY_TO_DEV_PATHS,
] as const

export interface SyncStats {
  readonly copied: number
  readonly deleted: number
  readonly skipped: boolean
}

export function projectUsesIsolatedMemoryPath(project: ProjectEntry): boolean {
  return normalizeComparablePath(project.development_path) !== normalizeComparablePath(project.memory_path)
}

export function syncProjectContextToMemory(project: ProjectEntry): SyncStats {
  if (!projectUsesIsolatedMemoryPath(project)) {
    return { copied: 0, deleted: 0, skipped: true }
  }

  return syncPathSet(project.development_path, project.memory_path, DEV_TO_MEMORY_PATHS)
}

export function syncProjectOutputsToDevelopment(project: ProjectEntry): SyncStats {
  if (!projectUsesIsolatedMemoryPath(project)) {
    return { copied: 0, deleted: 0, skipped: true }
  }

  return syncPathSet(project.memory_path, project.development_path, MEMORY_TO_DEV_PATHS)
}

function syncPathSet(
  sourceRoot: string,
  targetRoot: string,
  relativePaths: readonly string[],
): SyncStats {
  let copied = 0
  let deleted = 0

  for (const relativePath of relativePaths) {
    const stats = syncManagedPath(
      resolve(sourceRoot, relativePath),
      resolve(targetRoot, relativePath),
    )
    copied += stats.copied
    deleted += stats.deleted
  }

  return {
    copied,
    deleted,
    skipped: false,
  }
}

function syncManagedPath(sourcePath: string, targetPath: string): Omit<SyncStats, 'skipped'> {
  if (!existsSync(sourcePath)) {
    return {
      copied: 0,
      deleted: removeTree(targetPath),
    }
  }

  const sourceStats = lstatSync(sourcePath)
  if (sourceStats.isDirectory()) {
    return syncDirectory(sourcePath, targetPath)
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  if (existsSync(targetPath) && lstatSync(targetPath).isDirectory()) {
    rmSync(targetPath, { recursive: true, force: true })
  }
  copyFileSync(sourcePath, targetPath)
  return { copied: 1, deleted: 0 }
}

function syncDirectory(sourceDir: string, targetDir: string): Omit<SyncStats, 'skipped'> {
  if (existsSync(targetDir) && !lstatSync(targetDir).isDirectory()) {
    rmSync(targetDir, { recursive: true, force: true })
  }

  mkdirSync(targetDir, { recursive: true })

  let copied = 0
  let deleted = 0
  const sourceNames = new Set(readdirSync(sourceDir))

  for (const name of sourceNames) {
    const stats = syncManagedPath(join(sourceDir, name), join(targetDir, name))
    copied += stats.copied
    deleted += stats.deleted
  }

  for (const name of readdirSync(targetDir)) {
    if (sourceNames.has(name)) continue
    deleted += removeTree(join(targetDir, name))
  }

  return { copied, deleted }
}

function removeTree(targetPath: string): number {
  if (!existsSync(targetPath)) {
    return 0
  }

  const count = countFiles(targetPath)
  rmSync(targetPath, { recursive: true, force: true })
  return count
}

function countFiles(targetPath: string): number {
  const stats = lstatSync(targetPath)
  if (!stats.isDirectory()) {
    return 1
  }

  let total = 0
  for (const name of readdirSync(targetPath)) {
    total += countFiles(join(targetPath, name))
  }
  return total
}

function normalizeComparablePath(value: string): string {
  return resolve(value).replace(/\\/g, '/').replace(/\/+$/, '')
}
