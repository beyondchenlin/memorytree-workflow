import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  fallbackHeartbeatScriptPath,
  heartbeatScriptPath,
  isLaunchdRegistered,
  cmdUninstall,
  vbsLauncherPath,
  writeVbsLauncher,
} from '../../src/cli/cmd-daemon.js'

function normalizeDriveLetterPathForAssertion(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/(?=[A-Za-z]:\/)/, '')
}

function mockNormalizeRawUploadPermission(
  value: unknown,
  fallback: 'not-set' | 'approved' | 'denied',
): 'not-set' | 'approved' | 'denied' {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return normalized === 'approved' || normalized === 'denied' || normalized === 'not-set'
    ? normalized
    : fallback
}

// ---------------------------------------------------------------------------
// heartbeatScriptPath
// ---------------------------------------------------------------------------

describe('heartbeatScriptPath', () => {
  it('returns a path ending with cli.js', () => {
    const scriptPath = heartbeatScriptPath()
    expect(scriptPath).toMatch(/cli\.js$/)
  })

  it('contains dist directory in the path', () => {
    const scriptPath = heartbeatScriptPath()
    expect(scriptPath).toContain('dist')
  })
})

describe('fallbackHeartbeatScriptPath', () => {
  it('resolves dist-side bundled modules back to dist/cli.js', () => {
    const scriptPath = fallbackHeartbeatScriptPath('file:///D:/demo1/memorytree-workflow/dist/cmd-daemon-Q5EUSPRF.js')
    expect(normalizeDriveLetterPathForAssertion(scriptPath)).toBe('D:/demo1/memorytree-workflow/dist/cli.js')
  })

  it('resolves source modules back to repository dist/cli.js', () => {
    const scriptPath = fallbackHeartbeatScriptPath('file:///D:/demo1/memorytree-workflow/src/cli/cmd-daemon.ts')
    expect(normalizeDriveLetterPathForAssertion(scriptPath)).toBe('D:/demo1/memorytree-workflow/dist/cli.js')
  })
})

describe('cmdRunOnce', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('forwards root and force options to heartbeat.main', async () => {
    const main = vi.fn(async () => 0)
    vi.doMock('../../src/heartbeat/heartbeat.js', () => ({
      main,
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '5m',
        auto_push: true,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
      }),
      intervalToSeconds: () => 300,
      saveConfig: () => {},
      findProjectForPath: () => null,
      upsertProject: (cfg: unknown) => cfg,
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = await mod.cmdRunOnce({ root: '/repo', force: true })

    expect(result).toBe(0)
    expect(main).toHaveBeenCalledWith({ root: '/repo', force: true })
  })
})

describe('cmdRegisterProject', () => {
  let stdoutChunks: string[]
  let stderrChunks: string[]
  const originalWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  beforeEach(() => {
    stdoutChunks = []
    stderrChunks = []
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk)
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    process.stderr.write = originalStderrWrite
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('upserts config and ensures a dedicated worktree', async () => {
    const savedConfigs: unknown[] = []
    const upserted = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      projects: [
        {
          id: 'repo',
          path: '/memorytree/worktrees/repo',
          name: 'repo',
          development_path: '/repo',
          memory_path: '/memorytree/worktrees/repo',
          memory_branch: 'memorytree',
          heartbeat_interval: '5m',
          refresh_interval: '30m',
          auto_push: true,
          generate_report: true,
          ai_summary_model: 'claude-haiku-4-5-20251001',
          locale: 'en',
          gh_pages_branch: '',
          cname: '',
          webhook_url: '',
          report_base_url: '',
          report_port: 10010,
          last_heartbeat_at: '',
          last_refresh_at: '',
        },
      ],
    }

    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '9m',
        auto_push: false,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
        generate_report: false,
        ai_summary_model: 'claude-haiku-4-5-20251001',
        locale: 'en',
        gh_pages_branch: '',
        cname: '',
        webhook_url: '',
        report_base_url: '',
        report_port: 10010,
      }),
      saveConfig: (cfg: unknown) => { savedConfigs.push(cfg) },
      intervalToSeconds: () => 300,
      findProjectForPath: () => upserted.projects[0],
      upsertProject: () => upserted,
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = mod.cmdRegisterProject({
      root: '/repo',
      quickStart: true,
    })

    expect(result).toBe(0)
    expect(savedConfigs).toHaveLength(1)
    expect(stdoutChunks.join('')).toContain('Worktree branch: memorytree')
    expect(stdoutChunks.join('')).toContain('Upstream configured: yes (origin/memorytree)')
  })

  it('rejects branch override in quick start mode', async () => {
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '9m',
        auto_push: false,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
        generate_report: false,
        ai_summary_model: 'claude-haiku-4-5-20251001',
        locale: 'en',
        gh_pages_branch: '',
        cname: '',
        webhook_url: '',
        report_base_url: '',
        report_port: 10010,
      }),
      saveConfig: () => {},
      intervalToSeconds: () => 300,
      findProjectForPath: () => null,
      upsertProject: (cfg: unknown) => cfg,
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = mod.cmdRegisterProject({
      root: '/repo',
      quickStart: true,
      branch: 'custom-memorytree',
    })

    expect(result).toBe(1)
    expect(stderrChunks.join('')).toContain('Quick Start uses the default memorytree branch')
  })

  it('returns a clean failure when first upstream binding throws', async () => {
    const savedConfigs: unknown[] = []
    const upserted = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      projects: [
        {
          id: 'repo',
          path: '/memorytree/worktrees/repo',
          name: 'repo',
          development_path: '/repo',
          memory_path: '/memorytree/worktrees/repo',
          memory_branch: 'memorytree',
          heartbeat_interval: '5m',
          refresh_interval: '30m',
          auto_push: true,
          generate_report: true,
          ai_summary_model: 'claude-haiku-4-5-20251001',
          locale: 'en',
          gh_pages_branch: '',
          cname: '',
          webhook_url: '',
          report_base_url: '',
          report_port: 10010,
          last_heartbeat_at: '',
          last_refresh_at: '',
        },
      ],
    }

    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '9m',
        auto_push: false,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
        generate_report: false,
        ai_summary_model: 'claude-haiku-4-5-20251001',
        locale: 'en',
        gh_pages_branch: '',
        cname: '',
        webhook_url: '',
        report_base_url: '',
        report_port: 10010,
      }),
      saveConfig: (cfg: unknown) => { savedConfigs.push(cfg) },
      intervalToSeconds: () => 300,
      findProjectForPath: () => upserted.projects[0],
      upsertProject: () => upserted,
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => { throw new Error('push rejected') },
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = mod.cmdRegisterProject({
      root: '/repo',
      quickStart: true,
    })

    expect(result).toBe(1)
    expect(savedConfigs).toHaveLength(1)
    expect(stdoutChunks.join('')).toContain('Registered project: repo')
    expect(stderrChunks.join('')).toContain('Upstream configured: failed (push rejected)')
  })

  it('keeps existing project settings when quick start is rerun for the same repository', async () => {
    const savedConfigs: unknown[] = []
    const existingProject = {
      id: 'repo',
      path: '/memorytree/custom-worktree',
      name: 'repo',
      development_path: '/repo',
      memory_path: '/memorytree/custom-worktree',
      memory_branch: 'custom-memorytree',
      heartbeat_interval: '15m',
      refresh_interval: '45m',
      auto_push: false,
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 12000,
      last_heartbeat_at: '',
      last_refresh_at: '',
    }
    const currentConfig = {
      heartbeat_interval: '9m',
      auto_push: true,
      projects: [existingProject],
      watch_dirs: [],
      log_level: 'info',
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
    }

    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => currentConfig,
      saveConfig: (cfg: unknown) => { savedConfigs.push(cfg) },
      intervalToSeconds: () => 300,
      findProjectForPath: (cfg: typeof currentConfig) => cfg.projects[0] ?? null,
      upsertProject: (cfg: typeof currentConfig, _root: string, overrides: Record<string, unknown>) => ({
        ...cfg,
        projects: [
          {
            ...existingProject,
            ...overrides,
          },
        ],
      }),
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'custom-memorytree', created: false }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = mod.cmdRegisterProject({
      root: '/repo',
      quickStart: true,
    })

    expect(result).toBe(0)
    expect(savedConfigs).toHaveLength(1)
    expect(savedConfigs[0]).toMatchObject({
      projects: [
        expect.objectContaining({
          memory_path: '/memorytree/custom-worktree',
          memory_branch: 'custom-memorytree',
          heartbeat_interval: '15m',
          refresh_interval: '45m',
          auto_push: false,
          generate_report: false,
          report_port: 12000,
        }),
      ],
    })
    expect(stdoutChunks.join('')).toContain('Memory branch: custom-memorytree')
    expect(stdoutChunks.join('')).toContain('Heartbeat interval: 15m')
    expect(stdoutChunks.join('')).toContain('Refresh interval: 45m')
    expect(stdoutChunks.join('')).toContain('Auto-push: false')
    expect(stdoutChunks.join('')).toContain('Generate report: false')
    expect(stdoutChunks.join('')).toContain('Upstream configured: skipped (auto_push disabled)')
  })
})

describe('cmdQuickStart', () => {
  let stdoutChunks: string[]
  let stderrChunks: string[]
  const originalWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  beforeEach(() => {
    stdoutChunks = []
    stderrChunks = []
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk)
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    process.stderr.write = originalStderrWrite
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('registers and runs immediately when the scheduler is already installed', async () => {
    const main = vi.fn(async () => 0)
    const savedConfigs: unknown[] = []
    const upserted = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      projects: [
        {
          id: 'repo',
          path: '/memorytree/worktrees/repo',
          name: 'repo',
          development_path: '/repo',
          memory_path: '/memorytree/worktrees/repo',
          memory_branch: 'memorytree',
          heartbeat_interval: '5m',
          refresh_interval: '30m',
          auto_push: true,
          generate_report: true,
          ai_summary_model: 'claude-haiku-4-5-20251001',
          locale: 'en',
          gh_pages_branch: '',
          cname: '',
          webhook_url: '',
          report_base_url: '',
          report_port: 10010,
          last_heartbeat_at: '',
          last_refresh_at: '',
        },
      ],
    }

    vi.doMock('node:process', () => ({
      platform: 'linux',
    }))
    vi.doMock('../../src/heartbeat/heartbeat.js', () => ({
      main,
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '9m',
        auto_push: true,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
        generate_report: false,
        ai_summary_model: 'claude-haiku-4-5-20251001',
        locale: 'en',
        gh_pages_branch: '',
        cname: '',
        webhook_url: '',
        report_base_url: '',
        report_port: 10010,
      }),
      saveConfig: (cfg: unknown) => { savedConfigs.push(cfg) },
      intervalToSeconds: (value: string) => {
        if (value === '9m') return 540
        if (value === '5m') return 300
        return 300
      },
      findProjectForPath: () => upserted.projects[0],
      upsertProject: () => upserted,
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: (command: string, args: string[]) => {
        if (command === 'crontab' && args[0] === '-l') {
          return '*/5 * * * * node "/tmp/cli.js" daemon run-once # memorytree\n'
        }
        return ''
      },
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = await mod.cmdQuickStart({ root: '/repo' })

    expect(result).toBe(0)
    expect(savedConfigs).toHaveLength(1)
    expect(main).toHaveBeenCalledWith(expect.objectContaining({
      root: expect.stringMatching(/[\\/]repo$/),
      force: true,
    }))
    expect(stdoutChunks.join('')).toContain('scheduler already registered at 5m')
    expect(stdoutChunks.join('')).toContain('Step 2/3: registering the current repository')
    expect(stdoutChunks.join('')).toContain('Step 3/3: running one immediate heartbeat sync')
    expect(stderrChunks.join('')).toBe('')
  })

  it('reinstalls a too-slow scheduler before quick start continues', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'memorytree-quick-start-reinstall-'))
    const main = vi.fn(async () => 0)
    const savedConfigs: unknown[] = []
    let installedCron = '*/10 * * * * node "/tmp/cli.js" daemon run-once # memorytree\n'
    let currentConfig = {
      heartbeat_interval: '5m',
      auto_push: false,
      projects: [],
      watch_dirs: [],
      log_level: 'info',
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
    }

    vi.doMock('node:process', () => ({
      platform: 'linux',
    }))
    vi.doMock('node:os', () => ({
      homedir: () => tempHome,
    }))
    vi.doMock('../../src/heartbeat/heartbeat.js', () => ({
      main,
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => currentConfig,
      saveConfig: (cfg: typeof currentConfig) => {
        savedConfigs.push(cfg)
        currentConfig = cfg
      },
      intervalToSeconds: (value: string) => {
        if (value === '10m') return 600
        if (value === '5m') return 300
        return 300
      },
      findProjectForPath: (cfg: typeof currentConfig) => cfg.projects[0] ?? null,
      upsertProject: (cfg: typeof currentConfig) => ({
        ...cfg,
        projects: [
          {
            id: 'repo',
            path: '/memorytree/worktrees/repo',
            name: 'repo',
            development_path: '/repo',
            memory_path: '/memorytree/worktrees/repo',
            memory_branch: 'memorytree',
            heartbeat_interval: '5m',
            refresh_interval: '30m',
            auto_push: true,
            generate_report: true,
            ai_summary_model: 'claude-haiku-4-5-20251001',
            locale: 'en',
            gh_pages_branch: '',
            cname: '',
            webhook_url: '',
            report_base_url: '',
            report_port: 10010,
            last_heartbeat_at: '',
            last_refresh_at: '',
          },
        ],
      }),
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: (command: string, args: string[]) => {
        if (command === 'crontab' && args[0] === '-l') {
          return installedCron
        }
        if (command === 'crontab' && args[0]) {
          installedCron = readFileSync(args[0], 'utf-8')
          return ''
        }
        return ''
      },
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = await mod.cmdQuickStart({ root: '/repo' })

    expect(result).toBe(0)
    expect(savedConfigs[0]).toMatchObject({
      heartbeat_interval: '5m',
      auto_push: false,
    })
    expect(installedCron).toContain('*/5 * * * *')
    expect(stdoutChunks.join('')).toContain('registered at 10m; reinstalling it to 5m')
    expect(stdoutChunks.join('')).toContain('Heartbeat removed from cron.')
    expect(stdoutChunks.join('')).toContain('Heartbeat registered in cron (every 5m).')
    expect(main).toHaveBeenCalledWith(expect.objectContaining({
      root: expect.stringMatching(/[\\/]repo$/),
      force: true,
    }))

    rmSync(tempHome, { recursive: true, force: true })
  })

  it('installs the scheduler with defaults before registering when missing', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'memorytree-quick-start-'))
    const main = vi.fn(async () => 0)
    const savedConfigs: unknown[] = []
    const upserted = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      projects: [
        {
          id: 'repo',
          path: '/memorytree/worktrees/repo',
          name: 'repo',
          development_path: '/repo',
          memory_path: '/memorytree/worktrees/repo',
          memory_branch: 'memorytree',
          heartbeat_interval: '5m',
          refresh_interval: '30m',
          auto_push: true,
          generate_report: true,
          ai_summary_model: 'claude-haiku-4-5-20251001',
          locale: 'en',
          gh_pages_branch: '',
          cname: '',
          webhook_url: '',
          report_base_url: '',
          report_port: 10010,
          last_heartbeat_at: '',
          last_refresh_at: '',
        },
      ],
    }

    vi.doMock('node:process', () => ({
      platform: 'linux',
    }))
    vi.doMock('node:os', () => ({
      homedir: () => tempHome,
    }))
    vi.doMock('../../src/heartbeat/heartbeat.js', () => ({
      main,
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '9m',
        auto_push: false,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
        generate_report: false,
        ai_summary_model: 'claude-haiku-4-5-20251001',
        locale: 'en',
        gh_pages_branch: '',
        cname: '',
        webhook_url: '',
        report_base_url: '',
        report_port: 10010,
      }),
      saveConfig: (cfg: unknown) => { savedConfigs.push(cfg) },
      intervalToSeconds: () => 300,
      findProjectForPath: () => upserted.projects[0],
      upsertProject: () => upserted,
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/worktree.js', () => ({
      defaultProjectWorktreePath: () => '/memorytree/worktrees/repo',
      defaultProjectWorktreeBranch: () => 'memorytree',
      ensureBranchUpstream: () => ({ remote: 'origin', created: true }),
      ensureProjectWorktree: () => ({ branch: 'memorytree', created: true }),
      isValidWorktreeBranchName: () => true,
    }))
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: (command: string, args: string[]) => {
        if (command === 'crontab' && args[0] === '-l') {
          return ''
        }
        return ''
      },
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = await mod.cmdQuickStart({ root: '/repo' })

    expect(result).toBe(0)
    expect(savedConfigs).toHaveLength(2)
    expect(savedConfigs[0]).toMatchObject({
      heartbeat_interval: '5m',
      auto_push: true,
    })
    expect(main).toHaveBeenCalledWith(expect.objectContaining({
      root: expect.stringMatching(/[\\/]repo$/),
      force: true,
    }))
    expect(stdoutChunks.join('')).toContain('installing heartbeat scheduler with recommended defaults')
    expect(stdoutChunks.join('')).toContain('Heartbeat registered in cron (every 5m).')

    rmSync(tempHome, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// cmdStatus â€?tested via dynamic import with mocks set before import
// ---------------------------------------------------------------------------

describe('cmdStatus', () => {
  let stdoutChunks: string[]
  const originalWrite = process.stdout.write

  beforeEach(() => {
    stdoutChunks = []
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk)
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns 0 and outputs platform and lock info (no lock)', async () => {
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '5m',
        auto_push: true,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
      }),
      intervalToSeconds: () => 300,
      saveConfig: () => {},
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = mod.cmdStatus()
    expect(result).toBe(0)

    const output = stdoutChunks.join('')
    expect(output).toContain('Platform:')
    expect(output).toContain('Registered:')
    expect(output).toContain('Lock:       not held')
  })

  it('shows lock held when PID exists', async () => {
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => 12345,
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({
        heartbeat_interval: '5m',
        auto_push: true,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
      }),
      intervalToSeconds: () => 300,
      saveConfig: () => {},
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    const result = mod.cmdStatus()
    expect(result).toBe(0)

    const output = stdoutChunks.join('')
    expect(output).toContain('held by PID 12345')
  })
})

// ---------------------------------------------------------------------------
// Platform detection helpers
// ---------------------------------------------------------------------------

describe('isCronRegistered', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns false when crontab output is empty', async () => {
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({ heartbeat_interval: '5m', auto_push: true, projects: [], watch_dirs: [], log_level: 'info' }),
      intervalToSeconds: () => 300,
      saveConfig: () => {},
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    expect(mod.isCronRegistered()).toBe(false)
  })
})

describe('isLaunchdRegistered', () => {
  it('returns false when plist file does not exist', () => {
    // isLaunchdRegistered checks existsSync of the plist path
    // In test env, the plist will not exist
    expect(isLaunchdRegistered()).toBe(false)
  })
})

describe('isSchtasksRegistered', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns false when schtasks query throws', async () => {
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => { throw new Error('not found') },
    }))
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      configPath: () => '/nonexistent/config.toml',
      loadConfig: () => ({ heartbeat_interval: '5m', auto_push: true, projects: [], watch_dirs: [], log_level: 'info' }),
      intervalToSeconds: () => 300,
      saveConfig: () => {},
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    expect(mod.isSchtasksRegistered()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// cmdInstall â€?test saveConfig is called with overrides
// ---------------------------------------------------------------------------

describe('cmdInstall', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('calls saveConfig with overridden interval and auto-push', async () => {
    const savedConfigs: unknown[] = []
    vi.doMock('../../src/heartbeat/config.js', () => ({
      DEFAULT_MEMORY_BRANCH: 'memorytree',
      DEFAULT_RAW_UPLOAD_PERMISSION: 'not-set',
      normalizeRawUploadPermission: mockNormalizeRawUploadPermission,
      loadConfig: () => ({
        heartbeat_interval: '5m',
        auto_push: true,
        projects: [],
        watch_dirs: [],
        log_level: 'info',
      }),
      saveConfig: (cfg: unknown) => { savedConfigs.push(cfg) },
      intervalToSeconds: () => 600,
      configPath: () => '/nonexistent/config.toml',
    }))
    vi.doMock('../../src/heartbeat/lock.js', () => ({
      readLockPid: () => null,
    }))
    // Mock execCommand to prevent real system calls
    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: () => '',
    }))

    const mod = await import('../../src/cli/cmd-daemon.js')
    mod.cmdInstall({ interval: '10m', autoPush: 'false' })

    expect(savedConfigs.length).toBeGreaterThanOrEqual(1)
    const saved = savedConfigs[0] as Record<string, unknown>
    expect(saved['heartbeat_interval']).toBe('10m')
    expect(saved['auto_push']).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// cmdUninstall â€?lightweight test
// ---------------------------------------------------------------------------

describe('cmdUninstall', () => {
  let stderrChunks: string[]
  let stdoutChunks: string[]
  const originalStderrWrite = process.stderr.write
  const originalStdoutWrite = process.stdout.write

  afterEach(() => {
    process.stderr.write = originalStderrWrite
    process.stdout.write = originalStdoutWrite
    vi.restoreAllMocks()
  })

  it('returns 0 or 1 depending on platform', () => {
    stderrChunks = []
    stdoutChunks = []
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk)
      return true
    }) as typeof process.stderr.write
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk)
      return true
    }) as typeof process.stdout.write

    const result = cmdUninstall()
    // On any supported platform it returns 0; unsupported returns 1
    expect([0, 1]).toContain(result)
  })
})

// ---------------------------------------------------------------------------
// writeVbsLauncher
// ---------------------------------------------------------------------------

describe('writeVbsLauncher', () => {
  it('writes a VBS file with UTF-16 LE BOM', () => {
    const vbsPath = writeVbsLauncher('C:\\test\\cli.js')
    expect(existsSync(vbsPath)).toBe(true)

    const raw = readFileSync(vbsPath)
    // UTF-16 LE BOM: 0xFF 0xFE
    expect(raw[0]).toBe(0xff)
    expect(raw[1]).toBe(0xfe)

    // Clean up
    rmSync(vbsPath, { force: true })
  })

  it('uses process.execPath instead of hardcoded node', () => {
    const vbsPath = writeVbsLauncher('C:\\test\\cli.js')
    const raw = readFileSync(vbsPath)
    // Decode UTF-16 LE (skip BOM)
    const content = raw.subarray(2).toString('utf16le')

    // Should contain the full node path, not bare "node"
    const expectedNode = process.execPath.replace(/"/g, '""')
    expect(content).toContain(expectedNode)
    expect(content).not.toMatch(/^WshShell\.Run "node /m)

    rmSync(vbsPath, { force: true })
  })

  it('escapes double quotes in script path', () => {
    const vbsPath = writeVbsLauncher('C:\\path with "quotes"\\cli.js')
    const raw = readFileSync(vbsPath)
    const content = raw.subarray(2).toString('utf16le')

    // VBScript "" escaping
    expect(content).toContain('path with ""quotes""')

    rmSync(vbsPath, { force: true })
  })

  it('contains WScript.Shell and Run with SW_HIDE (0)', () => {
    const vbsPath = writeVbsLauncher('C:\\test\\cli.js')
    const raw = readFileSync(vbsPath)
    const content = raw.subarray(2).toString('utf16le')

    expect(content).toContain('CreateObject("WScript.Shell")')
    expect(content).toContain(', 0, False')
    expect(content).toContain('daemon run-once')

    rmSync(vbsPath, { force: true })
  })

  it('vbsLauncherPath returns path under .memorytree', () => {
    const p = vbsLauncherPath()
    expect(p).toContain('.memorytree')
    expect(p).toContain('heartbeat-launcher.vbs')
  })
})

