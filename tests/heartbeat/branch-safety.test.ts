import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedTranscript } from '../../src/types/transcript.js'
import type { HeartbeatDiscoveredSource } from '../../src/heartbeat/discovery-cache.js'

const mocks = vi.hoisted(() => ({
  discoverSourceFiles: vi.fn(),
  transcriptMatchesRepo: vi.fn(),
  defaultGlobalTranscriptRoot: vi.fn(),
  importTranscript: vi.fn(),
  buildReport: vi.fn(),
  transcriptHasContent: vi.fn(),
  parseTranscript: vi.fn(),
  slugify: vi.fn(),
  loadConfig: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  resetFailureCount: vi.fn(),
  writeAlert: vi.fn(),
  writeAlertWithThreshold: vi.fn(),
  getLogger: vi.fn(),
  setupLogging: vi.fn(),
  ensureBranchUpstream: vi.fn(),
  hasTrackingUpstream: vi.fn(),
  isProjectMemoryBranch: vi.fn(),
  pushBranchToRemote: vi.fn(),
  git: vi.fn(),
  toPosixPath: vi.fn(),
}))

vi.mock('../../src/transcript/discover.js', () => ({
  discoverSourceFiles: mocks.discoverSourceFiles,
  transcriptMatchesRepo: mocks.transcriptMatchesRepo,
  defaultGlobalTranscriptRoot: mocks.defaultGlobalTranscriptRoot,
}))

vi.mock('../../src/transcript/import.js', () => ({
  importTranscript: mocks.importTranscript,
  transcriptHasContent: mocks.transcriptHasContent,
}))

vi.mock('../../src/report/build.js', () => ({
  buildReport: mocks.buildReport,
}))

vi.mock('../../src/transcript/parse.js', () => ({
  parseTranscript: mocks.parseTranscript,
}))

vi.mock('../../src/transcript/common.js', () => ({
  slugify: mocks.slugify,
}))

vi.mock('../../src/heartbeat/config.js', () => ({
  loadConfig: mocks.loadConfig,
}))

vi.mock('../../src/heartbeat/lock.js', () => ({
  acquireLock: mocks.acquireLock,
  releaseLock: mocks.releaseLock,
}))

vi.mock('../../src/heartbeat/alert.js', () => ({
  resetFailureCount: mocks.resetFailureCount,
  writeAlert: mocks.writeAlert,
  writeAlertWithThreshold: mocks.writeAlertWithThreshold,
}))

vi.mock('../../src/heartbeat/log.js', () => ({
  getLogger: mocks.getLogger,
  setupLogging: mocks.setupLogging,
}))

vi.mock('../../src/heartbeat/worktree.js', () => ({
  ensureBranchUpstream: mocks.ensureBranchUpstream,
  ensureProjectWorktree: vi.fn(),
  hasTrackingUpstream: mocks.hasTrackingUpstream,
  isProjectMemoryBranch: mocks.isProjectMemoryBranch,
  pushBranchToRemote: mocks.pushBranchToRemote,
  redactRemoteUrl: (value: string | null) => value,
}))

vi.mock('../../src/utils/exec.js', () => ({
  git: mocks.git,
}))

vi.mock('../../src/utils/path.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/path.js')>('../../src/utils/path.js')
  return {
    ...actual,
    toPosixPath: mocks.toPosixPath,
  }
})

import { gitCommitAndPush, isDedicatedMemorytreeBranch, processProject } from '../../src/heartbeat/heartbeat.js'

function makeTranscript(): ParsedTranscript {
  return {
    client: 'codex',
    session_id: 'sess-1',
    title: 'Test session',
    started_at: '2024-01-01T00:00:00Z',
    cwd: 'D:/repo',
    branch: 'main',
    messages: [{ role: 'user', text: 'hello', timestamp: '2024-01-01T00:00:00Z' }],
    tool_events: [],
    source_path: 'C:/tmp/rollout-1.jsonl',
  }
}

function makeDiscoveredSource(overrides: Partial<HeartbeatDiscoveredSource> = {}): HeartbeatDiscoveredSource {
  return {
    client: 'codex',
    sourcePath: 'C:/tmp/rollout-1.jsonl',
    sourceKey: 'c:/tmp/rollout-1.jsonl',
    size: 128,
    mtimeMs: 1,
    parseStatus: 'ok',
    hasContent: true,
    cwd: 'D:/repo',
    inferredProjectSlug: 'demo-project',
    importedProjectKeys: new Set<string>(),
    parsed: makeTranscript(),
    cacheHit: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.discoverSourceFiles.mockReturnValue([['codex', 'C:/tmp/rollout-1.jsonl']])
  mocks.transcriptMatchesRepo.mockReturnValue(true)
  mocks.defaultGlobalTranscriptRoot.mockReturnValue('C:/Users/ai/.memorytree/transcripts')
  mocks.transcriptHasContent.mockReturnValue(true)
  mocks.parseTranscript.mockReturnValue(makeTranscript())
  mocks.importTranscript.mockResolvedValue({})
  mocks.buildReport.mockResolvedValue(undefined)
  mocks.slugify.mockReturnValue('demo-project')
  mocks.loadConfig.mockReturnValue({})
  mocks.acquireLock.mockReturnValue(true)
  mocks.toPosixPath.mockImplementation((value: string) => value)
  mocks.ensureBranchUpstream.mockReturnValue({ remote: 'origin', created: true })
  mocks.pushBranchToRemote.mockReturnValue({
    remote: 'origin',
    pushUrl: 'https://github.com/example/repo.git',
    transport: 'https',
    usedFallback: false,
  })
  mocks.hasTrackingUpstream.mockReturnValue(true)
  mocks.isProjectMemoryBranch.mockImplementation((branch: string) => (
    branch === 'memorytree' || branch.startsWith('memorytree/')
  ))

  mocks.getLogger.mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    exception: vi.fn(),
  })
})

describe('isDedicatedMemorytreeBranch', () => {
  it('matches memorytree and legacy memorytree/* branches', () => {
    expect(isDedicatedMemorytreeBranch('memorytree')).toBe(true)
    expect(isDedicatedMemorytreeBranch('memorytree/transcripts')).toBe(true)
    expect(isDedicatedMemorytreeBranch('memorytree/openmnemo')).toBe(true)
    expect(isDedicatedMemorytreeBranch('main')).toBe(false)
    expect(isDedicatedMemorytreeBranch('feature/memorytree')).toBe(false)
  })
})

describe('processProject branch safety', () => {
  it('imports to global archive only when the current branch is not memorytree/*', async () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'main\n'
      throw new Error(`unexpected git call: ${args.join(' ')}`)
    })

    await processProject(
      { auto_push: true } as never,
      'D:/repo',
      'demo-project',
      [makeDiscoveredSource()],
      'C:/Users/ai/.memorytree/transcripts',
    )

    expect(mocks.importTranscript).toHaveBeenCalledTimes(1)
    expect(mocks.importTranscript.mock.calls[0]?.[5]).toBe(false)
    expect(mocks.git).toHaveBeenCalledTimes(1)
  })

  it('allows repo-local commit and push when already on a memorytree/* branch', async () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'memorytree/transcripts\n'
      if (args[0] === 'diff') {
        return [
          'Memory/06_transcripts/clean/codex/2024/01/file.md',
        ].join('\n')
      }
      if (args[0] === 'ls-files' && args.includes('--ignored')) {
        return 'Memory/06_transcripts/raw/codex/2024/01/file.jsonl\n'
      }
      if (args[0] === 'ls-files') return 'Memory/06_transcripts/manifests/codex/2024/01/file.json\n'
      if (args[0] === 'remote') return 'origin\n'
      return ''
    })

    await processProject(
      { auto_push: true } as never,
      'D:/repo',
      'demo-project',
      [makeDiscoveredSource()],
      'C:/Users/ai/.memorytree/transcripts',
    )

    expect(mocks.importTranscript).toHaveBeenCalledTimes(1)
    expect(mocks.importTranscript.mock.calls[0]?.[5]).toBe(true)
    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'add',
      '-A',
      '-f',
      '--',
      'Memory/06_transcripts/clean/codex/2024/01/file.md',
      'Memory/06_transcripts/manifests/codex/2024/01/file.json',
    )
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(transcripts): import 1 transcript(s)')
    expect(mocks.pushBranchToRemote).toHaveBeenCalledWith('D:/repo', 'memorytree/transcripts')
  })

  it('builds the report before committing imported transcripts on a memorytree branch', async () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'memorytree/transcripts\n'
      if (args[0] === 'diff') {
        return [
          'Memory/06_transcripts/clean/codex/2024/01/file.md',
        ].join('\n')
      }
      if (args[0] === 'ls-files') return 'Memory/06_transcripts/manifests/codex/2024/01/file.json\n'
      return ''
    })

    await processProject(
      { auto_push: false, generate_report: true } as never,
      'D:/repo',
      'demo-project',
      [makeDiscoveredSource()],
      'C:/Users/ai/.memorytree/transcripts',
    )

    expect(mocks.buildReport).toHaveBeenCalledTimes(1)
    const commitCallIndex = mocks.git.mock.calls.findIndex(([, ...args]) => args[0] === 'commit')
    expect(commitCallIndex).toBeGreaterThanOrEqual(0)
    const buildOrder = mocks.buildReport.mock.invocationCallOrder[0]!
    const commitOrder = mocks.git.mock.invocationCallOrder[commitCallIndex]!
    expect(buildOrder).toBeLessThan(commitOrder)
  })

  it('commits a snapshot when no new transcripts were imported but context changed', async () => {
    mocks.discoverSourceFiles.mockReturnValue([])
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'memorytree/transcripts\n'
      if (args[0] === 'diff') return 'Memory/02_todos/todo_v001_001_20260317.md\n'
      return ''
    })

    await processProject(
      { auto_push: false, generate_report: false } as never,
      'D:/repo',
      'demo-project',
      [],
      'C:/Users/ai/.memorytree/transcripts',
    )

    expect(mocks.importTranscript).not.toHaveBeenCalled()
    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'add',
      '-A',
      '-f',
      '--',
      'Memory/02_todos/todo_v001_001_20260317.md',
    )
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(snapshot): heartbeat sync')
  })

  it('commits AGENTS.md changes on a memorytree branch', async () => {
    mocks.discoverSourceFiles.mockReturnValue([])
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'memorytree/transcripts\n'
      if (args[0] === 'diff') return 'AGENTS.md\n'
      return ''
    })

    await processProject(
      { auto_push: false, generate_report: false } as never,
      'D:/repo',
      'demo-project',
      [],
      'C:/Users/ai/.memorytree/transcripts',
    )

    expect(mocks.importTranscript).not.toHaveBeenCalled()
    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'add',
      '-A',
      '-f',
      '--',
      'AGENTS.md',
    )
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(snapshot): heartbeat sync')
  })
})

describe('gitCommitAndPush raw transcript staging', () => {
  it('skips commit when only raw transcript mirror files changed', () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('--ignored')) {
        return 'Memory/06_transcripts/raw/codex/2024/01/file.jsonl\n'
      }
      if (args[0] === 'remote') return 'origin\n'
      return ''
    })

    gitCommitAndPush({ auto_push: true } as never, 'D:/repo', 'demo-project', 1)

    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      'AGENTS.md',
      'Memory/01_goals',
      'Memory/02_todos',
      'Memory/03_chat_logs',
      'Memory/04_knowledge',
      'Memory/05_archive',
      'Memory/06_transcripts',
      'Memory/07_reports',
    )
    expect(mocks.git).not.toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(transcripts): import 1 transcript(s)')
    expect(mocks.git).not.toHaveBeenCalledWith('D:/repo', 'push')
  })

  it('splits large staging sets across multiple git add calls', () => {
    const manyPaths = Array.from({ length: 220 }, (_, index) =>
      `Memory/06_transcripts/clean/codex/2024/01/session-${String(index).padStart(3, '0')}-` +
      `${'x'.repeat(40)}.md`,
    )

    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'ls-files' && !args.includes('--ignored')) {
        return manyPaths.join('\n') + '\n'
      }
      return ''
    })

    gitCommitAndPush({ auto_push: false } as never, 'D:/repo', 'demo-project', 0)

    const addCalls = mocks.git.mock.calls.filter((call): call is [string, ...string[]] => call[1] === 'add')
    expect(addCalls.length).toBeGreaterThan(1)

    const stagedPaths = addCalls.flatMap(call => call.slice(5))
    expect(stagedPaths).toEqual(manyPaths)
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(snapshot): heartbeat sync')
  })
})
