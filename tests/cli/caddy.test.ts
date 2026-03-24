import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('cmdCaddyEnable', () => {
  let stdoutChunks: string[]
  let stderrChunks: string[]
  const originalStdoutWrite = process.stdout.write
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
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('enables Caddy for a registered project and prints the access URLs', async () => {
    const project = {
      id: 'repo',
      path: '/memorytree/worktrees/repo',
      name: 'repo',
      development_path: '/repo',
      memory_path: '/memorytree/worktrees/repo',
      memory_branch: 'memorytree',
      heartbeat_interval: '5m',
      auto_push: true,
      generate_report: true,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      report_exposure: 'lan',
      last_heartbeat_at: '',
    }

    vi.doMock('../../src/heartbeat/config.js', () => ({
      loadConfig: () => ({ projects: [project] }),
      findProjectForPath: () => project,
    }))
    vi.doMock('../../src/caddy/manager.js', () => ({
      enableManagedCaddy: () => ({
        mainConfigPath: '/home/.memorytree/caddy/Caddyfile',
        fragmentPath: '/home/.memorytree/caddy/sites/repo.caddy',
        reportDir: '/repo/Memory/07_reports',
        localUrls: ['http://127.0.0.1:10010/', 'http://localhost:10010/'],
        lanUrls: ['http://192.168.1.99:10010/'],
      }),
      disableManagedCaddy: () => ({
        mainConfigPath: '',
        fragmentPath: '',
        reportDir: '',
        localUrls: [],
        lanUrls: [],
      }),
      isCaddyInstalled: () => true,
      loadManagedCaddyStatus: async () => ({
        installed: true,
        running: true,
        usingManagedConfig: true,
        mainConfigPath: '',
        mainConfigExists: true,
        fragmentPath: '',
        fragmentExists: true,
        port: 10010,
        exposure: 'local',
        reportDir: '',
        localUrls: [],
        lanUrls: [],
      }),
      managedCaddyStartCommand: () => 'caddy run --config "/home/.memorytree/caddy/Caddyfile" --adapter caddyfile',
    }))

    const mod = await import('../../src/cli/cmd-caddy.js')
    const result = await mod.cmdCaddyEnable({ root: '/repo' })

    expect(result).toBe(0)
    const output = stdoutChunks.join('')
    expect(output).toContain('Caddy enabled for project: repo')
    expect(output).toContain('Exposure: lan')
    expect(output).toContain('Local URL: http://127.0.0.1:10010/')
    expect(output).toContain('LAN URL: http://192.168.1.99:10010/')
    expect(stderrChunks.join('')).toBe('')
  })

  it('fails cleanly when the repository is not registered yet', async () => {
    vi.doMock('../../src/heartbeat/config.js', () => ({
      loadConfig: () => ({ projects: [] }),
      findProjectForPath: () => null,
    }))
    vi.doMock('../../src/caddy/manager.js', () => ({
      enableManagedCaddy: () => ({}),
      disableManagedCaddy: () => ({}),
      isCaddyInstalled: () => true,
      loadManagedCaddyStatus: async () => ({
        installed: false,
        running: false,
        usingManagedConfig: null,
        mainConfigPath: '',
        mainConfigExists: false,
        fragmentPath: '',
        fragmentExists: false,
        port: 10010,
        exposure: 'local',
        reportDir: '',
        localUrls: [],
        lanUrls: [],
      }),
      managedCaddyStartCommand: () => 'caddy run --config "/home/.memorytree/caddy/Caddyfile" --adapter caddyfile',
    }))

    const mod = await import('../../src/cli/cmd-caddy.js')
    const result = await mod.cmdCaddyEnable({ root: '/repo' })

    expect(result).toBe(1)
    expect(stderrChunks.join('')).toContain('Project not found in ~/.memorytree/config.toml')
  })
})

describe('cmdCaddyStatus', () => {
  let stdoutChunks: string[]
  const originalStdoutWrite = process.stdout.write

  beforeEach(() => {
    stdoutChunks = []
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk)
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('shows unknown config usage and the managed start command when Caddy is not running', async () => {
    const project = {
      id: 'repo',
      path: '/memorytree/worktrees/repo',
      name: 'repo',
      development_path: '/repo',
      memory_path: '/memorytree/worktrees/repo',
      memory_branch: 'memorytree',
      heartbeat_interval: '5m',
      auto_push: true,
      generate_report: true,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      report_exposure: 'local',
      last_heartbeat_at: '',
    }

    vi.doMock('../../src/heartbeat/config.js', () => ({
      loadConfig: () => ({ projects: [project] }),
      findProjectForPath: () => project,
    }))
    vi.doMock('../../src/caddy/manager.js', () => ({
      enableManagedCaddy: () => ({}),
      disableManagedCaddy: () => ({}),
      isCaddyInstalled: () => true,
      loadManagedCaddyStatus: async () => ({
        installed: true,
        running: false,
        usingManagedConfig: null,
        mainConfigPath: '/home/.memorytree/caddy/Caddyfile',
        mainConfigExists: true,
        fragmentPath: '/home/.memorytree/caddy/sites/repo.caddy',
        fragmentExists: true,
        port: 10010,
        exposure: 'local',
        reportDir: '/repo/Memory/07_reports',
        localUrls: ['http://127.0.0.1:10010/', 'http://localhost:10010/'],
        lanUrls: [],
      }),
      managedCaddyStartCommand: () => 'caddy run --config "/home/.memorytree/caddy/Caddyfile" --adapter caddyfile',
    }))

    const mod = await import('../../src/cli/cmd-caddy.js')
    const result = await mod.cmdCaddyStatus({ root: '/repo' })

    expect(result).toBe(0)
    const output = stdoutChunks.join('')
    expect(output).toContain('Caddy installed: yes')
    expect(output).toContain('Caddy running: no')
    expect(output).toContain('Using MemoryTree Caddyfile: unknown')
    expect(output).toContain('Managed start command: caddy run --config')
  })
})
