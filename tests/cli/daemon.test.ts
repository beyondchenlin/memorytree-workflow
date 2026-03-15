import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  heartbeatScriptPath,
  isLaunchdRegistered,
  cmdUninstall,
} from '../../src/cli/cmd-daemon.js'

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

// ---------------------------------------------------------------------------
// cmdStatus — tested via dynamic import with mocks set before import
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
// cmdInstall — test saveConfig is called with overrides
// ---------------------------------------------------------------------------

describe('cmdInstall', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('calls saveConfig with overridden interval and auto-push', async () => {
    const savedConfigs: unknown[] = []
    vi.doMock('../../src/heartbeat/config.js', () => ({
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
// cmdUninstall — lightweight test
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
