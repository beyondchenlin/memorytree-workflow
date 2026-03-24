import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedTranscript } from '../../src/types/transcript.js'

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

    await processProject({ auto_push: true } as never, 'D:/repo', 'demo-project')

    expect(mocks.importTranscript).toHaveBeenCalledTimes(1)
    expect(mocks.importTranscript.mock.calls[0]?.[5]).toBe(false)
    expect(mocks.git).toHaveBeenCalledTimes(1)
  })

  it('allows repo-local commit and push when already on a memorytree/* branch', async () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'memorytree/transcripts\n'
      if (args[0] === 'status') {
        return [
          ' M Memory/06_transcripts/clean/codex/2024/01/file.md',
          '?? Memory/06_transcripts/manifests/codex/2024/01/file.json',
          '?? Memory/06_transcripts/raw/codex/2024/01/file.jsonl',
        ].join('\n')
      }
      if (args[0] === 'remote') return 'origin\n'
      return ''
    })

    await processProject({ auto_push: true } as never, 'D:/repo', 'demo-project')

    expect(mocks.importTranscript).toHaveBeenCalledTimes(1)
    expect(mocks.importTranscript.mock.calls[0]?.[5]).toBe(true)
    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'add',
      '--',
      'Memory/06_transcripts/clean/codex/2024/01/file.md',
      'Memory/06_transcripts/manifests/codex/2024/01/file.json',
    )
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(transcripts): import 1 transcript(s)')
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'push')
  })

  it('builds the report before committing imported transcripts on a memorytree branch', async () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'rev-parse') return 'memorytree/transcripts\n'
      if (args[0] === 'status') {
        return [
          ' M Memory/06_transcripts/clean/codex/2024/01/file.md',
          '?? Memory/06_transcripts/manifests/codex/2024/01/file.json',
        ].join('\n')
      }
      return ''
    })

    await processProject({ auto_push: false, generate_report: true } as never, 'D:/repo', 'demo-project')

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
      if (args[0] === 'status') return ' M Memory/02_todos/todo_v001_001_20260317.md\n'
      return ''
    })

    await processProject({ auto_push: false, generate_report: false } as never, 'D:/repo', 'demo-project')

    expect(mocks.importTranscript).not.toHaveBeenCalled()
    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'add',
      '--',
      'Memory/02_todos/todo_v001_001_20260317.md',
    )
    expect(mocks.git).toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(snapshot): heartbeat sync')
  })
})

describe('gitCommitAndPush raw transcript staging', () => {
  it('skips commit when only raw transcript mirror files changed', () => {
    mocks.git.mockImplementation((_cwd: string, ...args: string[]) => {
      if (args[0] === 'status') return '?? Memory/06_transcripts/raw/codex/2024/01/file.jsonl\n'
      if (args[0] === 'remote') return 'origin\n'
      return ''
    })

    gitCommitAndPush({ auto_push: true } as never, 'D:/repo', 'demo-project', 1)

    expect(mocks.git).toHaveBeenCalledWith(
      'D:/repo',
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'Memory/',
    )
    expect(mocks.git).not.toHaveBeenCalledWith('D:/repo', 'commit', '-m', 'memorytree(transcripts): import 1 transcript(s)')
    expect(mocks.git).not.toHaveBeenCalledWith('D:/repo', 'push')
  })
})
