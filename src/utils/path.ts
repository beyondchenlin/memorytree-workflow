import { normalize } from 'node:path'

/**
 * Convert a file path to posix format (forward slashes).
 * All paths written to files (JSON / SQLite / Markdown / JSONL) must use posix format.
 */
export function toPosixPath(p: string): string {
  return normalize(p).replace(/\\/g, '/')
}
