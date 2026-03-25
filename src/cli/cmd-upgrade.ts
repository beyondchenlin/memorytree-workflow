/**
 * CLI: memorytree upgrade — upgrade a repo to MemoryTree safely.
 * Port of scripts/upgrade-memorytree.py CLI wrapper.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { normalizeLocale } from '../project/locale.js'
import { buildDatetime, resolveTemplateDir } from '../project/scaffold.js'
import { upgrade, formatResultText } from '../project/upgrade.js'
import { ensureManagedGitignore, type GitignoreEnsureResult } from '../project/scaffold.js'
import { resolveSkillRoot } from '../utils/path.js'

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

  const skillRoot = resolveSkillRoot(import.meta.url)
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
  const gitignoreResult = ensureManagedGitignore(root)

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(result) + '\n')
    writeHeartbeatNextStep(root, gitignoreResult, process.stderr)
  } else {
    process.stdout.write(formatResultText(result) + '\n')
    writeHeartbeatNextStep(root, gitignoreResult)
  }
  return 0
}

function writeHeartbeatNextStep(
  root: string,
  gitignoreResult: GitignoreEnsureResult | null,
  stream: Pick<NodeJS.WriteStream, 'write'> = process.stdout,
): void {
  const displayRoot = root.includes(' ') ? `"${root}"` : root
  stream.write('This command updated repository files only.\n')
  writeGitignoreStatus(stream, gitignoreResult)
  stream.write('It did not register heartbeat or modify ~/.memorytree/config.toml.\n')
  stream.write('If you want the default heartbeat setup for this repository, run:\n')
  stream.write(`  memorytree daemon quick-start --root ${displayRoot}\n`)
  stream.write(
    'Heartbeat keeps the dedicated MemoryTree branch as the shared source of truth ' +
    'and refreshes this repository directory as a local cache mirror.\n',
  )
}

function writeGitignoreStatus(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  result: GitignoreEnsureResult | null,
): void {
  if (result === null) return
  if (result.changed) {
    stream.write(`.gitignore updated: ${result.added.join(', ')}\n`)
    return
  }
  stream.write('.gitignore already contains managed MemoryTree entries.\n')
}
