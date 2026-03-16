import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(os.tmpdir(), `mt-tags-test-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// renderTagBadges tests (synchronous, no AI)
// ---------------------------------------------------------------------------

import { renderTagBadges } from '../../src/report/tags.js'

describe('renderTagBadges', () => {
  it('returns empty string for empty tags', () => {
    expect(renderTagBadges([])).toBe('')
  })

  it('renders tag pills', () => {
    const html = renderTagBadges(['typescript', 'testing'])
    expect(html).toContain('class="tag"')
    expect(html).toContain('typescript')
    expect(html).toContain('testing')
  })

  it('escapes HTML special chars in tags', () => {
    const html = renderTagBadges(['a&b', '<test>'])
    expect(html).toContain('a&amp;b')
    expect(html).toContain('&lt;test&gt;')
    expect(html).not.toContain('<test>')
  })

  it('sets data-tag attribute', () => {
    const html = renderTagBadges(['typescript'])
    expect(html).toContain('data-tag="typescript"')
  })
})

// ---------------------------------------------------------------------------
// getTags tests
// ---------------------------------------------------------------------------

import { getTags } from '../../src/report/tags.js'

describe('getTags', () => {
  it('returns [] when noAi=true', async () => {
    const cacheDir = makeTmpDir()
    const result = await getTags('abc123', 'some summary', { cacheDir, noAi: true, model: 'test' })
    expect(result).toEqual([])
  })

  it('returns [] when summary is empty', async () => {
    const cacheDir = makeTmpDir()
    const result = await getTags('abc123', '', { cacheDir, noAi: false, model: 'test' })
    expect(result).toEqual([])
  })

  it('returns [] when summary is whitespace only', async () => {
    const cacheDir = makeTmpDir()
    const result = await getTags('abc123', '   \n  ', { cacheDir, noAi: false, model: 'test' })
    expect(result).toEqual([])
  })

  it('returns [] when no API key set', async () => {
    const cacheDir = makeTmpDir()
    const saved = process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']
    try {
      const result = await getTags('abc123', 'a valid summary', { cacheDir, noAi: false, model: 'test' })
      expect(result).toEqual([])
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved
    }
  })

  it('returns cached tags without calling API', async () => {
    const cacheDir = makeTmpDir()
    const sha256 = 'cached-sha256'
    // Write cache file
    const tagsDir = join(cacheDir, 'tags')
    mkdirSync(tagsDir, { recursive: true })
    writeFileSync(
      join(tagsDir, `${sha256}.json`),
      JSON.stringify({ sha256, tags: ['cached', 'tag'], generated_at: '2026-01-01T00:00:00Z' }),
    )
    // Even with a fake API key, cached result should be returned immediately
    const saved = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = 'fake-key'
    try {
      const result = await getTags(sha256, 'some summary', { cacheDir, noAi: false, model: 'test' })
      expect(result).toEqual(['cached', 'tag'])
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved
      else delete process.env['ANTHROPIC_API_KEY']
    }
  })
})
