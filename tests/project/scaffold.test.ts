import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildDatetime,
  createMemoryDirs,
  resolveScaffoldPaths,
  findLatestVersion,
  findLatestGoalFile,
  findLatestTodoFile,
  findLatestChatLogFile,
  writeTemplate,
  scaffoldContentFiles,
  hasPolicyContent,
  findExternalPolicySources,
  MEMORY_DIRS,
} from '../../src/project/scaffold.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'scaffold-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// buildDatetime
// ---------------------------------------------------------------------------

describe('buildDatetime', () => {
  it('creates date from date + time strings', () => {
    const dt = buildDatetime('2025-06-15', '14:30')
    expect(dt.getFullYear()).toBe(2025)
    expect(dt.getMonth()).toBe(5) // 0-indexed
    expect(dt.getDate()).toBe(15)
    expect(dt.getHours()).toBe(14)
    expect(dt.getMinutes()).toBe(30)
  })

  it('creates midnight when only date is provided', () => {
    const dt = buildDatetime('2025-06-15', '')
    expect(dt.getFullYear()).toBe(2025)
    expect(dt.getHours()).toBe(0)
    expect(dt.getMinutes()).toBe(0)
  })

  it('uses today with given time when only time is provided', () => {
    const dt = buildDatetime('', '09:45')
    const today = new Date()
    expect(dt.getFullYear()).toBe(today.getFullYear())
    expect(dt.getMonth()).toBe(today.getMonth())
    expect(dt.getDate()).toBe(today.getDate())
    expect(dt.getHours()).toBe(9)
    expect(dt.getMinutes()).toBe(45)
  })

  it('returns approximate now when neither date nor time is provided', () => {
    const before = Date.now()
    const dt = buildDatetime('', '')
    const after = Date.now()
    expect(dt.getTime()).toBeGreaterThanOrEqual(before)
    expect(dt.getTime()).toBeLessThanOrEqual(after)
  })
})

// ---------------------------------------------------------------------------
// createMemoryDirs
// ---------------------------------------------------------------------------

describe('createMemoryDirs', () => {
  it('creates all 5 memory directories', () => {
    const created = createMemoryDirs(tmpDir)
    expect(created).toHaveLength(5)
    for (const rel of MEMORY_DIRS) {
      expect(existsSync(join(tmpDir, rel))).toBe(true)
    }
  })

  it('returns list of created dir paths in posix format', () => {
    const created = createMemoryDirs(tmpDir)
    for (const p of created) {
      expect(p).not.toContain('\\')
      expect(p).toContain('Memory/')
    }
  })

  it('is idempotent: second call returns empty list', () => {
    createMemoryDirs(tmpDir)
    const secondCall = createMemoryDirs(tmpDir)
    expect(secondCall).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resolveScaffoldPaths
// ---------------------------------------------------------------------------

describe('resolveScaffoldPaths', () => {
  it('returns correct paths with default version 001 for empty root', () => {
    createMemoryDirs(tmpDir)
    const dt = new Date('2025-06-15T14:30:00')
    const paths = resolveScaffoldPaths(tmpDir, dt)

    expect(paths.root).toBe(tmpDir)
    expect(paths.goalVersion).toBe('001')
    expect(paths.todoVersion).toBe('001')
    expect(paths.previousVersion).toBe('none')
    expect(paths.dateLabel).toBe('2025-06-15')
    expect(paths.timeLabel).toBe('14:30')
    expect(paths.goalPath).toContain('goal_v001_20250615.md')
    expect(paths.todoPath).toContain('todo_v001_001_20250615.md')
    expect(paths.chatPath).toContain('2025-06-15_14-30.md')
  })

  it('finds existing versions when goal files exist', () => {
    createMemoryDirs(tmpDir)
    const goalDir = join(tmpDir, 'Memory', '01_goals')
    writeFileSync(join(goalDir, 'goal_v002_20250610.md'), '# Goal v002')

    const dt = new Date('2025-06-15T10:00:00')
    const paths = resolveScaffoldPaths(tmpDir, dt)

    expect(paths.goalVersion).toBe('002')
    expect(paths.previousVersion).toBe('v001')
    expect(paths.goalPath).toContain('goal_v002_20250610.md')
  })
})

// ---------------------------------------------------------------------------
// findLatestVersion
// ---------------------------------------------------------------------------

describe('findLatestVersion', () => {
  it('finds the highest version number', () => {
    const dir = join(tmpDir, 'goals')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'goal_v001_20250601.md'), '')
    writeFileSync(join(dir, 'goal_v003_20250610.md'), '')
    writeFileSync(join(dir, 'goal_v002_20250605.md'), '')

    const result = findLatestVersion(dir, /^goal_v(\d{3})_\d{8}\.md$/)
    expect(result).toBe('003')
  })

  it('returns null when no files match the pattern', () => {
    const dir = join(tmpDir, 'goals')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'unrelated.txt'), '')

    const result = findLatestVersion(dir, /^goal_v(\d{3})_\d{8}\.md$/)
    expect(result).toBeNull()
  })

  it('returns null for non-existent directory', () => {
    const result = findLatestVersion(join(tmpDir, 'nope'), /^goal_v(\d{3})_\d{8}\.md$/)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findLatestGoalFile
// ---------------------------------------------------------------------------

describe('findLatestGoalFile', () => {
  it('returns the latest goal file sorted by version and date', () => {
    const dir = join(tmpDir, 'goals')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'goal_v001_20250601.md'), '')
    writeFileSync(join(dir, 'goal_v002_20250610.md'), '')
    writeFileSync(join(dir, 'goal_v001_20250615.md'), '')

    const result = findLatestGoalFile(dir)
    expect(result).toContain('goal_v002_20250610.md')
  })

  it('returns null for empty directory', () => {
    const dir = join(tmpDir, 'goals')
    mkdirSync(dir, { recursive: true })
    expect(findLatestGoalFile(dir)).toBeNull()
  })

  it('returns null for non-existent directory', () => {
    expect(findLatestGoalFile(join(tmpDir, 'nope'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findLatestTodoFile
// ---------------------------------------------------------------------------

describe('findLatestTodoFile', () => {
  it('finds the latest todo file matching the given goal version', () => {
    const dir = join(tmpDir, 'todos')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'todo_v001_001_20250601.md'), '')
    writeFileSync(join(dir, 'todo_v001_002_20250610.md'), '')
    writeFileSync(join(dir, 'todo_v002_001_20250612.md'), '')

    const result = findLatestTodoFile(dir, '001')
    expect(result).toContain('todo_v001_002_20250610.md')
  })

  it('returns null when no todos match the goal version', () => {
    const dir = join(tmpDir, 'todos')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'todo_v002_001_20250601.md'), '')

    expect(findLatestTodoFile(dir, '001')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findLatestChatLogFile
// ---------------------------------------------------------------------------

describe('findLatestChatLogFile', () => {
  it('returns the latest chat log by date and time', () => {
    const dir = join(tmpDir, 'chats')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '2025-06-10_09-00.md'), '')
    writeFileSync(join(dir, '2025-06-15_14-30.md'), '')
    writeFileSync(join(dir, '2025-06-12_10-00.md'), '')

    const result = findLatestChatLogFile(dir)
    expect(result).toContain('2025-06-15_14-30.md')
  })

  it('returns null for empty directory', () => {
    const dir = join(tmpDir, 'chats')
    mkdirSync(dir, { recursive: true })
    expect(findLatestChatLogFile(dir)).toBeNull()
  })

  it('returns null for non-existent directory', () => {
    expect(findLatestChatLogFile(join(tmpDir, 'nope'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// writeTemplate
// ---------------------------------------------------------------------------

describe('writeTemplate', () => {
  it('writes template with placeholder substitution', () => {
    const templatePath = join(tmpDir, 'template.md')
    const targetPath = join(tmpDir, 'output', 'result.md')
    writeFileSync(templatePath, '# Goal v{{VERSION}}\nDate: {{DATE}}\n')

    const written = writeTemplate(templatePath, targetPath, false, {
      VERSION: '001',
      DATE: '2025-06-15',
    })

    expect(written).toBe(true)
    const content = readFileSync(targetPath, 'utf-8')
    expect(content).toBe('# Goal v001\nDate: 2025-06-15\n')
  })

  it('skips existing file when force=false', () => {
    const templatePath = join(tmpDir, 'template.md')
    const targetPath = join(tmpDir, 'existing.md')
    writeFileSync(templatePath, 'new content {{KEY}}')
    writeFileSync(targetPath, 'original content')

    const written = writeTemplate(templatePath, targetPath, false, { KEY: 'val' })

    expect(written).toBe(false)
    expect(readFileSync(targetPath, 'utf-8')).toBe('original content')
  })

  it('overwrites existing file when force=true', () => {
    const templatePath = join(tmpDir, 'template.md')
    const targetPath = join(tmpDir, 'existing.md')
    writeFileSync(templatePath, 'new content {{KEY}}')
    writeFileSync(targetPath, 'original content')

    const written = writeTemplate(templatePath, targetPath, true, { KEY: 'val' })

    expect(written).toBe(true)
    expect(readFileSync(targetPath, 'utf-8')).toBe('new content val')
  })
})

// ---------------------------------------------------------------------------
// scaffoldContentFiles
// ---------------------------------------------------------------------------

describe('scaffoldContentFiles', () => {
  it('creates goal, todo, and chat files from templates', () => {
    const templatesDir = join(tmpDir, 'templates')
    mkdirSync(templatesDir, { recursive: true })
    writeFileSync(join(templatesDir, 'goal.md'), '# Goal v{{GOAL_VERSION}}\nDate: {{DATE}}\nPrev: {{PREVIOUS_VERSION}}\n{{GOAL_SUMMARY}}')
    writeFileSync(join(templatesDir, 'todo.md'), '# Todo v{{GOAL_VERSION}}.{{TODO_SUBVERSION}}\nDate: {{DATE}}')
    writeFileSync(join(templatesDir, 'chat-log.md'), '# Chat {{DATE}} {{TIME}}\nProject: {{PROJECT_NAME}}')

    const projectRoot = join(tmpDir, 'project')
    mkdirSync(projectRoot, { recursive: true })
    createMemoryDirs(projectRoot)

    const dt = new Date('2025-06-15T14:30:00')
    const paths = resolveScaffoldPaths(projectRoot, dt)

    const result = scaffoldContentFiles(paths, templatesDir, 'Build feature X', 'my-project', false)

    expect(result.created).toHaveLength(3)
    expect(result.preserved).toHaveLength(0)

    const goalContent = readFileSync(paths.goalPath, 'utf-8')
    expect(goalContent).toContain('Goal v001')
    expect(goalContent).toContain('2025-06-15')
    expect(goalContent).toContain('Build feature X')
  })

  it('preserves existing content files', () => {
    const templatesDir = join(tmpDir, 'templates')
    mkdirSync(templatesDir, { recursive: true })
    writeFileSync(join(templatesDir, 'goal.md'), '# Goal {{GOAL_VERSION}}')
    writeFileSync(join(templatesDir, 'todo.md'), '# Todo')
    writeFileSync(join(templatesDir, 'chat-log.md'), '# Chat')

    const projectRoot = join(tmpDir, 'project')
    mkdirSync(projectRoot, { recursive: true })
    createMemoryDirs(projectRoot)

    const dt = new Date('2025-06-15T14:30:00')
    const paths = resolveScaffoldPaths(projectRoot, dt)

    // Create files first
    scaffoldContentFiles(paths, templatesDir, 'summary', 'proj', false)

    // Second call should preserve all
    const result = scaffoldContentFiles(paths, templatesDir, 'summary', 'proj', false)
    expect(result.created).toHaveLength(0)
    expect(result.preserved).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// hasPolicyContent
// ---------------------------------------------------------------------------

describe('hasPolicyContent', () => {
  it('detects policy text with "pull request" keyword', () => {
    const filePath = join(tmpDir, 'CONTRIBUTING.md')
    writeFileSync(filePath, '# Contributing\nPlease submit a pull request for review.\n')
    expect(hasPolicyContent(filePath)).toBe(true)
  })

  it('detects policy text with "conventional commits" keyword', () => {
    const filePath = join(tmpDir, 'CONTRIBUTING.md')
    writeFileSync(filePath, 'We use conventional commits for all changes.\n')
    expect(hasPolicyContent(filePath)).toBe(true)
  })

  it('returns false for non-policy content', () => {
    const filePath = join(tmpDir, 'CONTRIBUTING.md')
    writeFileSync(filePath, '# Contributing\nThank you for your interest in this project.\nPlease see the docs folder.\n')
    expect(hasPolicyContent(filePath)).toBe(false)
  })

  it('detects Chinese policy terms', () => {
    const filePath = join(tmpDir, 'CONTRIBUTING.md')
    writeFileSync(filePath, '# 贡献指南\n请提交拉取请求进行审查。\n')
    expect(hasPolicyContent(filePath)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// findExternalPolicySources
// ---------------------------------------------------------------------------

describe('findExternalPolicySources', () => {
  it('finds CODEOWNERS file', () => {
    writeFileSync(join(tmpDir, 'CODEOWNERS'), '* @team')
    const result = findExternalPolicySources(tmpDir)
    expect(result).toContain('CODEOWNERS')
  })

  it('finds .github/CODEOWNERS', () => {
    mkdirSync(join(tmpDir, '.github'), { recursive: true })
    writeFileSync(join(tmpDir, '.github', 'CODEOWNERS'), '* @team')
    const result = findExternalPolicySources(tmpDir)
    expect(result).toContain('.github/CODEOWNERS')
  })

  it('finds CONTRIBUTING.md with policy content', () => {
    writeFileSync(join(tmpDir, 'CONTRIBUTING.md'), 'Submit a pull request for changes.\n')
    const result = findExternalPolicySources(tmpDir)
    expect(result).toContain('CONTRIBUTING.md')
  })

  it('skips CONTRIBUTING.md without policy content', () => {
    writeFileSync(join(tmpDir, 'CONTRIBUTING.md'), 'Welcome to the project.\n')
    const result = findExternalPolicySources(tmpDir)
    expect(result).not.toContain('CONTRIBUTING.md')
  })

  it('returns empty list for bare repo', () => {
    const result = findExternalPolicySources(tmpDir)
    expect(result).toEqual([])
  })

  it('returns sorted results', () => {
    writeFileSync(join(tmpDir, 'CODEOWNERS'), '* @team')
    writeFileSync(join(tmpDir, 'CONTRIBUTING.md'), 'Please open a pull request.\n')
    const result = findExternalPolicySources(tmpDir)
    const sorted = [...result].sort()
    expect(result).toEqual(sorted)
  })
})
