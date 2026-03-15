/**
 * Locale — project language detection.
 * Port of scripts/_locale_utils.py
 */

import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { basename, join, extname } from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.txt'])
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g
const LATIN_RE = /[A-Za-z]/g
const MIN_LATIN_SIGNAL = 3

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizeLocale(value: string, root?: string): string {
  let normalized = (value ?? '').trim().toLowerCase()
  if (normalized === '' || normalized === 'auto') {
    normalized = (root ? detectRepoLocale(root) : null) ?? detectSystemLocale()
  }

  const mapping: Record<string, string> = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'zh': 'zh-cn',
    'zh-cn': 'zh-cn',
    'zh-sg': 'zh-cn',
    'zh-hans': 'zh-cn',
    'zh-hant': 'zh-cn',
    'zh-tw': 'zh-cn',
    'zh-hk': 'zh-cn',
  }
  return mapping[normalized] ?? normalized
}

export function detectRepoLocale(root: string): string | null {
  if (!existsSync(root)) return null

  let zhScore = 0
  let enScore = 0

  for (const filePath of iterRepoTextCandidates(root)) {
    const name = basename(filePath).toLowerCase()
    if (name.includes('zh-cn') || name.includes('zh_cn')) {
      zhScore += 12
    }

    const sample = readTextSample(filePath)
    if (!sample) continue

    const cjkCount = (sample.match(CJK_RE) ?? []).length
    const latinCount = (sample.match(LATIN_RE) ?? []).length

    if (cjkCount >= 8 && cjkCount >= Math.max(4, Math.floor(latinCount / 4))) {
      zhScore += cjkCount
    }
    if (cjkCount === 0 && latinCount >= MIN_LATIN_SIGNAL) {
      enScore += Math.max(latinCount, 12)
      continue
    }
    if (latinCount >= 40 && latinCount >= Math.max(40, cjkCount * 4)) {
      enScore += latinCount
    }
  }

  if (zhScore === 0 && enScore === 0) return null
  if (zhScore === 0) return 'en'
  if (enScore === 0) return 'zh-cn'
  if (zhScore >= enScore * 1.25) return 'zh-cn'
  if (enScore >= zhScore * 1.25) return 'en'
  return null
}

export function detectSystemLocale(): string {
  const candidates = [
    process.env['LC_ALL'],
    process.env['LANG'],
    process.env['LANGUAGE'],
  ]
  for (const candidate of candidates) {
    const text = (candidate ?? '').toLowerCase()
    if (text.startsWith('zh') || text.includes('chinese')) {
      return 'zh-cn'
    }
  }
  return 'en'
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function* iterRepoTextCandidates(root: string): Generator<string> {
  const seen = new Set<string>()

  for (const rel of ['AGENTS.md', 'README.md', 'README.zh-CN.md', 'README.zh_CN.md']) {
    const p = join(root, rel)
    if (existsSync(p) && isFile(p)) {
      seen.add(p)
      yield p
    }
  }

  const topLevel: string[] = []
  try {
    for (const entry of readdirSync(root)) {
      const p = join(root, entry)
      if (isFile(p) && TEXT_EXTENSIONS.has(extname(p).toLowerCase()) && !seen.has(p)) {
        topLevel.push(p)
      }
    }
  } catch {
    // ignore
  }
  topLevel.sort()
  for (const p of topLevel.slice(0, 8)) {
    seen.add(p)
    yield p
  }

  const docsDir = join(root, 'docs')
  if (existsSync(docsDir) && isDir(docsDir)) {
    let count = 0
    for (const p of walkDir(docsDir)) {
      if (count >= 12) break
      if (!isFile(p) || !TEXT_EXTENSIONS.has(extname(p).toLowerCase()) || seen.has(p)) continue
      seen.add(p)
      count++
      yield p
    }
  }
}

function walkDir(dir: string): string[] {
  const results: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...walkDir(p))
      } else if (entry.isFile()) {
        results.push(p)
      }
    }
  } catch {
    // ignore
  }
  results.sort()
  return results
}

function readTextSample(filePath: string): string {
  try {
    const buf = Buffer.alloc(4096)
    const fd = openSync(filePath, 'r')
    const bytesRead = readSync(fd, buf, 0, 4096, 0)
    closeSync(fd)
    return buf.subarray(0, bytesRead).toString('utf-8')
  } catch {
    return ''
  }
}

function isFile(p: string): boolean {
  try { return statSync(p).isFile() } catch { return false }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}
