/**
 * CLI: memorytree locale — detect project locale.
 * Port of scripts/detect-memorytree-locale.py
 */

import { resolve } from 'node:path'

import { normalizeLocale, detectRepoLocale, detectSystemLocale } from '../project/locale.js'

export interface LocaleOptions {
  root: string
  locale: string
  format: string
}

export function cmdLocale(options: LocaleOptions): number {
  const root = resolve(options.root)
  const requested = options.locale || 'auto'
  const repoLocale = detectRepoLocale(root) ?? ''
  const systemLocale = detectSystemLocale()
  const effective = normalizeLocale(requested, root)

  const payload = {
    requested,
    repo_locale: repoLocale,
    system_locale: systemLocale,
    effective_locale: effective,
  }

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(payload) + '\n')
  } else {
    process.stdout.write(
      `requested: ${payload.requested}\n` +
      `repo_locale: ${payload.repo_locale}\n` +
      `system_locale: ${payload.system_locale}\n` +
      `effective_locale: ${payload.effective_locale}\n`,
    )
  }
  return 0
}
