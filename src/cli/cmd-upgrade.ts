/**
 * CLI: memorytree upgrade — upgrade a repo to MemoryTree safely.
 * Port of scripts/upgrade-memorytree.py CLI wrapper.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeLocale } from '../project/locale.js'
import { buildDatetime, resolveTemplateDir } from '../project/scaffold.js'
import { upgrade, formatResultText } from '../project/upgrade.js'

export interface UpgradeOptions {
  root: string
  projectName: string
  goalSummary: string
  locale: string
  date: string
  time: string
  format: string
}

export function cmdUpgrade(options: UpgradeOptions): number {
  const root = resolve(options.root)
  if (!existsSync(root)) {
    process.stderr.write(`root does not exist: ${root}\n`)
    return 1
  }

  const skillRoot = resolve(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'), '..', '..', '..')
  const templates = resolveTemplateDir(skillRoot, root, options.locale)
  const effectiveLocale = normalizeLocale(options.locale, root)
  const dt = buildDatetime(options.date, options.time)

  const result = upgrade(
    root,
    skillRoot,
    templates,
    effectiveLocale,
    options.locale,
    options.goalSummary,
    options.projectName,
    dt,
  )

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    process.stdout.write(formatResultText(result) + '\n')
  }
  return 0
}
