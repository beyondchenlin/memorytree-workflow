import { existsSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Convert a file path to posix format (forward slashes).
 * All paths written to files (JSON / SQLite / Markdown / JSONL) must use posix format.
 */
export function toPosixPath(p: string): string {
  return normalize(p.replace(/\\/g, '/').replace(/\/+/g, '/')).replace(/\\/g, '/')
}

/**
 * Resolve the installed skill root from a module URL.
 * Works for both source execution (`src/**`) and built execution (`dist/**`).
 */
export function resolveSkillRoot(moduleUrl: string): string {
  let current = dirname(fileURLToPath(moduleUrl))

  while (true) {
    if (existsSync(join(current, 'SKILL.md')) && existsSync(join(current, 'assets', 'templates'))) {
      return current
    }

    const parent = resolve(current, '..')
    if (parent === current) {
      throw new Error(`Unable to resolve skill root from ${moduleUrl}`)
    }
    current = parent
  }
}
