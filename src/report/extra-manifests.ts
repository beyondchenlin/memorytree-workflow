/**
 * Collect transcript manifest directories from other registered projects so a
 * report can include cross-project sessions in one place.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { findProjectForPath, loadConfig, projectExecutionPath } from '../heartbeat/config.js'

export function collectExtraManifestDirs(root: string): string[] {
  const resolvedRoot = resolve(root)
  const config = loadConfig()
  const currentProject = findProjectForPath(config, resolvedRoot)
  if (currentProject === null) {
    return []
  }

  const seen = new Set<string>()
  const dirs: string[] = []

  for (const project of config.projects) {
    if (project.id === currentProject.id) continue

    const manifestsDir = resolve(join(projectExecutionPath(project), 'Memory', '06_transcripts', 'manifests'))
    if (!existsSync(manifestsDir) || seen.has(manifestsDir)) continue

    seen.add(manifestsDir)
    dirs.push(manifestsDir)
  }

  return dirs
}
