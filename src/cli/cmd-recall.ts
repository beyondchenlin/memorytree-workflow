/**
 * CLI: memorytree recall — on-demand transcript sync + session lookup.
 * Port of scripts/recall-session.py CLI wrapper.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { recall, formatText } from '../recall/recall.js'

export interface RecallOptions {
  root: string
  projectName: string
  globalRoot: string
  activationTime: string
  format: string
}

export async function cmdRecall(options: RecallOptions): Promise<number> {
  const root = resolve(options.root)
  if (!existsSync(root)) {
    process.stderr.write(`root does not exist: ${root}\n`)
    return 1
  }

  const result = await recall(root, options.projectName, options.globalRoot, options.activationTime)

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    process.stdout.write(formatText(result) + '\n')
  }
  return 0
}
