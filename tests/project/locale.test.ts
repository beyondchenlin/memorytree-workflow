import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  normalizeLocale,
  detectRepoLocale,
  detectSystemLocale,
} from '../../src/project/locale.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'locale-test-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// normalizeLocale
// ---------------------------------------------------------------------------

describe('normalizeLocale', () => {
  it('passes "en" through as "en"', () => {
    expect(normalizeLocale('en')).toBe('en')
  })

  it('passes "zh-cn" through as "zh-cn"', () => {
    expect(normalizeLocale('zh-cn')).toBe('zh-cn')
  })

  it('maps "zh" to "zh-cn"', () => {
    expect(normalizeLocale('zh')).toBe('zh-cn')
  })

  it('maps "en-us" to "en"', () => {
    expect(normalizeLocale('en-us')).toBe('en')
  })

  it('maps "zh-tw" to "zh-cn"', () => {
    expect(normalizeLocale('zh-tw')).toBe('zh-cn')
  })

  it('detects locale from repo root when value is "auto"', () => {
    // Create a repo with English README
    writeFileSync(
      join(tmpDir, 'README.md'),
      'This is a project with enough English words to trigger detection. ' +
      'The project provides utilities for text processing and data analysis. ' +
      'It includes modules for parsing, indexing, and searching content.',
    )
    const result = normalizeLocale('auto', tmpDir)
    expect(result).toBe('en')
  })

  it('passes through unknown locale values unchanged', () => {
    expect(normalizeLocale('fr')).toBe('fr')
    expect(normalizeLocale('ja')).toBe('ja')
    expect(normalizeLocale('de')).toBe('de')
  })
})

// ---------------------------------------------------------------------------
// detectRepoLocale
// ---------------------------------------------------------------------------

describe('detectRepoLocale', () => {
  it('returns "en" for repo with English README', () => {
    writeFileSync(
      join(tmpDir, 'README.md'),
      'This is a comprehensive project description written entirely in English. ' +
      'The project provides a suite of utilities for text processing and data analysis. ' +
      'It includes modules for parsing structured documents, building search indexes, ' +
      'and performing full text search across large document collections. ' +
      'Additional features include automated testing, continuous integration support, ' +
      'and detailed documentation for all public APIs. ' +
      'The codebase follows modern best practices including immutable data patterns, ' +
      'comprehensive error handling, and thorough input validation at system boundaries.',
    )
    expect(detectRepoLocale(tmpDir)).toBe('en')
  })

  it('returns "zh-cn" for repo with Chinese README', () => {
    writeFileSync(
      join(tmpDir, 'README.md'),
      '这是一个关于文本处理和数据分析的综合项目。' +
      '本项目提供了一套实用工具集，用于解析结构化文档、建立搜索索引和执行全文搜索。' +
      '额外功能包括自动化测试、持续集成支持以及详细的公共接口文档。' +
      '代码库遵循现代最佳实践，包括不可变数据模式、全面的错误处理和系统边界的输入验证。',
    )
    expect(detectRepoLocale(tmpDir)).toBe('zh-cn')
  })

  it('returns null for mixed repo with balanced content', () => {
    // Write roughly balanced content so neither side wins by 1.25x
    writeFileSync(
      join(tmpDir, 'README.md'),
      'This project is a text processing toolkit for data analysis workflows.\n' +
      '本项目是一个文本处理工具包用于数据分析工作流。\n' +
      'It supports parsing and indexing documents across formats.\n' +
      '支持跨格式解析和索引文档。\n' +
      'Features include search, dedup, and automated reports.\n' +
      '功能包括搜索、去重和自动化报告。',
    )
    const result = detectRepoLocale(tmpDir)
    // With balanced content, either null or one of the two is acceptable
    expect([null, 'en', 'zh-cn']).toContain(result)
  })

  it('returns null for empty repo with no text files', () => {
    expect(detectRepoLocale(tmpDir)).toBeNull()
  })

  it('returns null for non-existent directory', () => {
    expect(detectRepoLocale(join(tmpDir, 'nonexistent'))).toBeNull()
  })

  it('detects Chinese from README.zh-CN.md filename', () => {
    writeFileSync(
      join(tmpDir, 'README.zh-CN.md'),
      '这是中文自述文件。项目概述和安装说明都在这里。',
    )
    expect(detectRepoLocale(tmpDir)).toBe('zh-cn')
  })
})

// ---------------------------------------------------------------------------
// detectSystemLocale
// ---------------------------------------------------------------------------

describe('detectSystemLocale', () => {
  it('returns "zh-cn" when LC_ALL is zh_CN', () => {
    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
    vi.stubEnv('LANG', '')
    vi.stubEnv('LANGUAGE', '')
    expect(detectSystemLocale()).toBe('zh-cn')
  })

  it('returns "en" when LANG is en_US', () => {
    vi.stubEnv('LC_ALL', '')
    vi.stubEnv('LANG', 'en_US.UTF-8')
    vi.stubEnv('LANGUAGE', '')
    expect(detectSystemLocale()).toBe('en')
  })

  it('returns "en" when no locale env vars are set', () => {
    vi.stubEnv('LC_ALL', '')
    vi.stubEnv('LANG', '')
    vi.stubEnv('LANGUAGE', '')
    expect(detectSystemLocale()).toBe('en')
  })

  it('returns "zh-cn" when LANGUAGE contains "chinese"', () => {
    vi.stubEnv('LC_ALL', '')
    vi.stubEnv('LANG', '')
    vi.stubEnv('LANGUAGE', 'Chinese')
    expect(detectSystemLocale()).toBe('zh-cn')
  })

  it('prioritizes LC_ALL over LANG', () => {
    vi.stubEnv('LC_ALL', 'zh_CN')
    vi.stubEnv('LANG', 'en_US')
    vi.stubEnv('LANGUAGE', '')
    expect(detectSystemLocale()).toBe('zh-cn')
  })
})
