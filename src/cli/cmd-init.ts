/**
 * CLI: memorytree init — initialize a MemoryTree workspace.
 * Port of scripts/init-memorytree.py
 */

import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

import {
  buildDatetime,
  createMemoryDirs,
  findExternalPolicySources,
  resolveScaffoldPaths,
  resolveTemplateDir,
  scaffoldContentFiles,
  writeTemplate,
} from '../project/scaffold.js'

export interface InitOptions {
  root: string
  projectName: string
  goalSummary: string
  locale: string
  date: string
  time: string
  skipAgents: boolean
  force: boolean
}

export function cmdInit(options: InitOptions): number {
  const root = resolve(options.root)
  if (!existsSync(root)) {
    process.stderr.write(`root does not exist: ${root}\n`)
    return 1
  }

  if (options.skipAgents) {
    process.stderr.write(
      '--skip-agents is not supported for fresh initialization. ' +
      'Use memorytree upgrade when preserving or merging an existing AGENTS.md.\n',
    )
    return 1
  }

  const agentsPath = join(root, 'AGENTS.md')
  if (existsSync(agentsPath)) {
    process.stderr.write(
      'AGENTS.md already exists. Use memorytree upgrade to preserve or merge existing repo policy.\n',
    )
    return 1
  }

  const policySources = findExternalPolicySources(root)
  if (policySources.length > 0) {
    const preview = policySources.slice(0, 3).join(', ') + (policySources.length > 3 ? ', ...' : '')
    process.stderr.write(
      `External repo policy files detected (${preview}). ` +
      'Use memorytree upgrade to preserve host commit and PR rules.\n',
    )
    return 1
  }

  const skillRoot = resolve(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'), '..', '..', '..')
  const templates = resolveTemplateDir(skillRoot, root, options.locale)
  const dt = buildDatetime(options.date, options.time)

  createMemoryDirs(root)
  const paths = resolveScaffoldPaths(root, dt)
  scaffoldContentFiles(paths, templates, options.goalSummary, options.projectName, options.force)
  writeTemplate(join(templates, 'agents.md'), agentsPath, options.force, {})

  return 0
}
