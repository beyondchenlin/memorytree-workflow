import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  detectState,
  extractGoalVersion,
  needsAgentsMerge,
  hasReadOrderSignal,
  hasMemoryLayoutSignal,
  hasActiveTodoRule,
  hasAppendOnlyChatLogRule,
  hasRepoSafetyRule,
  hasCommitTitleRule,
  hasDedicatedMemorytreePrFlow,
  hasMemorytreeOnlyScopeRule,
  hasAutoMergeRule,
  upgrade,
  formatResultText,
} from '../../src/project/upgrade.js'

import { createMemoryDirs } from '../../src/project/scaffold.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'upgrade-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// detectState
// ---------------------------------------------------------------------------

describe('detectState', () => {
  it('returns "not-installed" for empty directory', () => {
    expect(detectState(tmpDir)).toBe('not-installed')
  })

  it('returns "partial" when AGENTS.md exists but Memory/ does not', () => {
    writeFileSync(join(tmpDir, 'AGENTS.md'), '# AGENTS')
    expect(detectState(tmpDir)).toBe('partial')
  })

  it('returns "installed" for full setup with complete AGENTS.md', () => {
    createMemoryDirs(tmpDir)

    const goalDir = join(tmpDir, 'Memory', '01_goals')
    const todoDir = join(tmpDir, 'Memory', '02_todos')
    const chatDir = join(tmpDir, 'Memory', '03_chat_logs')
    writeFileSync(join(goalDir, 'goal_v001_20250615.md'), '# Goal')
    writeFileSync(join(todoDir, 'todo_v001_001_20250615.md'), '# Todo')
    writeFileSync(join(chatDir, '2025-06-15_14-30.md'), '# Chat')

    // Write a complete AGENTS.md with all 9 signals
    writeFileSync(join(tmpDir, 'AGENTS.md'), buildCompleteAgentsMd())

    expect(detectState(tmpDir)).toBe('installed')
  })

  it('returns "partial" when Memory exists but files are missing', () => {
    createMemoryDirs(tmpDir)
    expect(detectState(tmpDir)).toBe('partial')
  })
})

// ---------------------------------------------------------------------------
// extractGoalVersion
// ---------------------------------------------------------------------------

describe('extractGoalVersion', () => {
  it('extracts version from valid goal filename', () => {
    expect(extractGoalVersion('/path/to/goal_v002_20250615.md')).toBe('002')
  })

  it('extracts version from Windows-style path', () => {
    expect(extractGoalVersion('C:\\path\\to\\goal_v005_20250615.md')).toBe('005')
  })

  it('returns null for non-matching filename', () => {
    expect(extractGoalVersion('/path/to/readme.md')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(extractGoalVersion(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// needsAgentsMerge
// ---------------------------------------------------------------------------

describe('needsAgentsMerge', () => {
  it('returns true for incomplete AGENTS.md', () => {
    const agentsPath = join(tmpDir, 'AGENTS.md')
    writeFileSync(agentsPath, '# AGENTS\nSome basic instructions.\n')
    expect(needsAgentsMerge(agentsPath)).toBe(true)
  })

  it('returns false for complete AGENTS.md with all signals', () => {
    const agentsPath = join(tmpDir, 'AGENTS.md')
    writeFileSync(agentsPath, buildCompleteAgentsMd())
    expect(needsAgentsMerge(agentsPath)).toBe(false)
  })

  it('returns true for non-existent file', () => {
    expect(needsAgentsMerge(join(tmpDir, 'nope.md'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Signal detectors
// ---------------------------------------------------------------------------

describe('hasReadOrderSignal', () => {
  it('returns true for text containing "read order"', () => {
    expect(hasReadOrderSignal('always follow the read order below')).toBe(true)
  })

  it('returns true for text containing "read files in order"', () => {
    expect(hasReadOrderSignal('read files in order')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(hasReadOrderSignal('just some random text')).toBe(false)
  })
})

describe('hasMemoryLayoutSignal', () => {
  it('returns true when all three directory names are present', () => {
    const text = 'memory/01_goals contains goals.\nmemory/02_todos tracks tasks.\nmemory/03_chat_logs stores logs.'
    expect(hasMemoryLayoutSignal(text)).toBe(true)
  })

  it('returns false when only some directories are mentioned', () => {
    expect(hasMemoryLayoutSignal('memory/01_goals and memory/02_todos only')).toBe(false)
  })
})

describe('hasActiveTodoRule', () => {
  it('returns true for matching rule text', () => {
    expect(hasActiveTodoRule('keep the active todo synchronized with the current goal')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(hasActiveTodoRule('update the task list regularly')).toBe(false)
  })
})

describe('hasAppendOnlyChatLogRule', () => {
  it('returns true for "append-only" chat log rule', () => {
    expect(hasAppendOnlyChatLogRule('treat chat logs as append-only records')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(hasAppendOnlyChatLogRule('edit the chat log freely')).toBe(false)
  })
})

describe('hasRepoSafetyRule', () => {
  it('returns true when PR, CI, review, branch, and repo concepts are all present', () => {
    const text = 'repository rules require a pull request with CI checks passing and reviewer approval on protected branches'
    expect(hasRepoSafetyRule(text)).toBe(true)
  })

  it('returns false when concepts are missing', () => {
    expect(hasRepoSafetyRule('just push directly to main')).toBe(false)
  })
})

describe('hasCommitTitleRule', () => {
  it('returns true for "memorytree(scope):" pattern', () => {
    expect(hasCommitTitleRule('use memorytree(memory): as commit title prefix')).toBe(true)
  })

  it('returns true for "memorytree-scoped commit title"', () => {
    expect(hasCommitTitleRule('always use a memorytree-scoped commit title')).toBe(true)
  })

  it('returns false for generic commit text', () => {
    expect(hasCommitTitleRule('write a clear commit message')).toBe(false)
  })
})

describe('hasDedicatedMemorytreePrFlow', () => {
  it('returns true when memorytree, branch, PR, and dedicated are all present', () => {
    const text = 'create a dedicated branch for memorytree changes and open a separate pull request'
    expect(hasDedicatedMemorytreePrFlow(text)).toBe(true)
  })

  it('returns false when missing key concepts', () => {
    expect(hasDedicatedMemorytreePrFlow('push memorytree changes to main')).toBe(false)
  })
})

describe('hasMemorytreeOnlyScopeRule', () => {
  it('returns true for "memorytree-owned files" text', () => {
    expect(hasMemorytreeOnlyScopeRule('only commit memorytree-owned files')).toBe(true)
  })

  it('returns true for "memorytree-managed files" text', () => {
    expect(hasMemorytreeOnlyScopeRule('stage only memorytree-managed files')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(hasMemorytreeOnlyScopeRule('commit all changed files')).toBe(false)
  })
})

describe('hasAutoMergeRule', () => {
  it('returns true for "auto-merge only when repository rules permit"', () => {
    expect(hasAutoMergeRule('auto-merge only when repository rules permit')).toBe(true)
  })

  it('returns true for "only enable auto-merge when required approvals pass"', () => {
    expect(hasAutoMergeRule('only enable auto-merge when required approvals are met')).toBe(true)
  })

  it('returns false for unrelated text', () => {
    expect(hasAutoMergeRule('always enable auto-merge for all PRs')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// upgrade (end-to-end)
// ---------------------------------------------------------------------------

describe('upgrade', () => {
  it('performs full upgrade on empty directory', () => {
    const skillRoot = join(tmpDir, 'skill')
    const templatesDir = join(skillRoot, 'assets', 'templates', 'en')
    mkdirSync(templatesDir, { recursive: true })

    writeFileSync(join(templatesDir, 'goal.md'), '# Goal v{{GOAL_VERSION}}\nDate: {{DATE}}\nPrevious: {{PREVIOUS_VERSION}}\n{{GOAL_SUMMARY}}')
    writeFileSync(join(templatesDir, 'todo.md'), '# Todo v{{GOAL_VERSION}}.{{TODO_SUBVERSION}}\nDate: {{DATE}}')
    writeFileSync(join(templatesDir, 'chat-log.md'), '# Chat {{DATE}} {{TIME}}\nProject: {{PROJECT_NAME}}')
    writeFileSync(join(templatesDir, 'agents.md'), '# AGENTS\nMemoryTree instructions for the project.')

    const projectRoot = join(tmpDir, 'project')
    mkdirSync(projectRoot, { recursive: true })

    const dt = new Date('2025-06-15T14:30:00')
    const result = upgrade(
      projectRoot, skillRoot, templatesDir, 'en', 'auto',
      'Build feature X', 'test-project', dt,
    )

    expect(result.state_before).toBe('not-installed')
    expect(result.created_dirs).toHaveLength(5)
    expect(result.created_files.length).toBeGreaterThanOrEqual(3)
    expect(result.created_files).toContain('AGENTS.md')
    expect(result.agents_action).toBe('created')
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(projectRoot, 'Memory', '01_goals'))).toBe(true)
  })

  it('preserves existing AGENTS.md on re-run', () => {
    const skillRoot = join(tmpDir, 'skill')
    const templatesDir = join(skillRoot, 'assets', 'templates', 'en')
    mkdirSync(templatesDir, { recursive: true })

    writeFileSync(join(templatesDir, 'goal.md'), '# Goal {{GOAL_VERSION}}')
    writeFileSync(join(templatesDir, 'todo.md'), '# Todo')
    writeFileSync(join(templatesDir, 'chat-log.md'), '# Chat')
    writeFileSync(join(templatesDir, 'agents.md'), '# AGENTS template')

    const projectRoot = join(tmpDir, 'project')
    mkdirSync(projectRoot, { recursive: true })

    // First run creates files
    const dt = new Date('2025-06-15T14:30:00')
    upgrade(projectRoot, skillRoot, templatesDir, 'en', 'auto', 'summary', 'proj', dt)

    // Second run should preserve
    const result2 = upgrade(projectRoot, skillRoot, templatesDir, 'en', 'auto', 'summary', 'proj', dt)

    expect(result2.agents_action).toBe('preserved_existing')
    expect(result2.preserved_files).toContain('AGENTS.md')
    expect(result2.created_dirs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// formatResultText
// ---------------------------------------------------------------------------

describe('formatResultText', () => {
  it('formats a result with created dirs and files', () => {
    const result = {
      state_before: 'not-installed',
      state_after: 'partial',
      requested_locale: 'auto',
      effective_locale: 'en',
      created_dirs: ['Memory/01_goals', 'Memory/02_todos'],
      created_files: ['Memory/01_goals/goal_v001_20250615.md', 'AGENTS.md'],
      preserved_files: [],
      agents_action: 'created',
      agents_merge_required: false,
    }
    const text = formatResultText(result)

    expect(text).toContain('state_before: not-installed')
    expect(text).toContain('state_after: partial')
    expect(text).toContain('effective_locale: en')
    expect(text).toContain('agents_action: created')
    expect(text).toContain('agents_merge_required: false')
    expect(text).toContain('created_dirs:')
    expect(text).toContain('- Memory/01_goals')
    expect(text).toContain('created_files:')
    expect(text).toContain('- AGENTS.md')
  })

  it('omits sections when lists are empty', () => {
    const result = {
      state_before: 'installed',
      state_after: 'installed',
      requested_locale: 'en',
      effective_locale: 'en',
      created_dirs: [],
      created_files: [],
      preserved_files: ['AGENTS.md'],
      agents_action: 'preserved_existing',
      agents_merge_required: false,
    }
    const text = formatResultText(result)

    expect(text).not.toContain('created_dirs:')
    expect(text).not.toContain('created_files:')
    expect(text).toContain('preserved_files:')
    expect(text).toContain('- AGENTS.md')
  })
})

// ---------------------------------------------------------------------------
// Helper: build a complete AGENTS.md with all 9 signals
// ---------------------------------------------------------------------------

function buildCompleteAgentsMd(): string {
  return [
    '# AGENTS.md',
    '',
    '## Read Order',
    'Read files in order: goals, todos, chat logs.',
    '',
    '## Memory Layout',
    '- Memory/01_goals — project goals',
    '- Memory/02_todos — active tasks',
    '- Memory/03_chat_logs — conversation history',
    '',
    '## Rules',
    '- Keep the active todo synchronized with the current goal version.',
    '- Treat chat logs as append-only records. Never rewrite or delete prior entries.',
    '',
    '## Repository Safety',
    'Repository rules require a pull request with CI checks passing and reviewer approval on protected branches.',
    '',
    '## Commit Convention',
    'Use memorytree(memory): as commit title prefix.',
    '',
    '## PR Flow',
    'Create a dedicated branch for memorytree changes and open a separate pull request.',
    '',
    '## Scope',
    'Only commit memorytree-owned files and changes.',
    '',
    '## Auto-Merge',
    'Auto-merge only when repository rules permit.',
  ].join('\n')
}
