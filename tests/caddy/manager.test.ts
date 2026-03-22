import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

let tmpHome: string
const execCommandMock = vi.fn()

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpHome,
  }
})

vi.mock('../../src/utils/exec.js', () => ({
  execCommand: (...args: unknown[]) => execCommandMock(...args),
}))

import {
  findManagedPortConflict,
  loadManagedCaddyStatus,
  managedCaddyPaths,
  managedCaddyStartCommand,
  renderManagedMainCaddyfile,
  renderManagedProjectFragment,
} from '../../src/caddy/manager.js'
import { toPosixPath } from '../../src/utils/path.js'

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'memorytree-caddy-test-'))
  execCommandMock.mockReset()
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('managedCaddyPaths', () => {
  it('stores the managed config tree under ~/.memorytree/caddy', () => {
    const paths = managedCaddyPaths('demo-project')

    expect(paths.rootDir).toContain('.memorytree')
    expect(paths.mainConfigPath).toContain('.memorytree')
    expect(paths.fragmentPath).toContain(join('.memorytree', 'caddy', 'sites'))
    expect(paths.fragmentPath).toMatch(/demo-project\.caddy$/)
  })
})

describe('renderManagedMainCaddyfile', () => {
  it('imports project site fragments through a MemoryTree-owned main Caddyfile', () => {
    const text = renderManagedMainCaddyfile()

    expect(text).toContain('auto_https off')
    expect(text).toContain('import sites/*.caddy')
  })
})

describe('renderManagedProjectFragment', () => {
  it('renders a local-only site block with loopback bind', () => {
    const reportDir = resolve('Memory', '07_reports')
    const text = renderManagedProjectFragment({
      id: 'demo-project',
      name: 'Demo Project',
      report_port: 10010,
      report_exposure: 'local',
    }, reportDir)

    expect(text).toContain('# project_id: demo-project')
    expect(text).toContain('# report_port: 10010')
    expect(text).toContain('# report_exposure: local')
    expect(text).toContain('http://127.0.0.1:10010, http://localhost:10010')
    expect(text).toContain('bind 127.0.0.1 [::1]')
    expect(text).toContain(`root * "${toPosixPath(reportDir)}"`)
    expect(text).toContain('file_server')
  })

  it('renders a lan-visible site block without loopback bind restriction', () => {
    const text = renderManagedProjectFragment({
      id: 'demo-project',
      name: 'Demo Project',
      report_port: 12000,
      report_exposure: 'lan',
    }, '/workspace/demo/Memory/07_reports')

    expect(text).toContain('http://:12000')
    expect(text).not.toContain('bind 127.0.0.1')
  })
})

describe('findManagedPortConflict', () => {
  it('detects when another managed fragment already owns the same port', () => {
    const paths = managedCaddyPaths('demo-project')
    mkdirSync(paths.sitesDir, { recursive: true })
    writeFileSync(join(paths.sitesDir, 'other-project.caddy'), [
      '# project_id: other-project',
      '# report_port: 10010',
      '',
    ].join('\n'), 'utf-8')

    expect(findManagedPortConflict('demo-project', 10010)).toBe('other-project')
  })

  it('ignores the current project fragment when the port matches itself', () => {
    const paths = managedCaddyPaths('demo-project')
    mkdirSync(paths.sitesDir, { recursive: true })
    writeFileSync(paths.fragmentPath, [
      '# project_id: demo-project',
      '# report_port: 10010',
      '',
    ].join('\n'), 'utf-8')

    expect(findManagedPortConflict('demo-project', 10010)).toBeNull()
  })
})

describe('managedCaddyStartCommand', () => {
  it('points Caddy at the MemoryTree-owned main config', () => {
    expect(managedCaddyStartCommand()).toContain('caddy run --config')
    expect(managedCaddyStartCommand()).toContain('.memorytree')
    expect(managedCaddyStartCommand()).toContain('Caddyfile')
  })
})

describe('loadManagedCaddyStatus', () => {
  it('sends an allowed Origin header when querying the Caddy admin API', async () => {
    execCommandMock.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'version') return 'v2.9.0'
      if (args[0] === 'adapt') return '{"apps":{"http":{"servers":{}}}}'
      throw new Error(`Unexpected execCommand call: ${args.join(' ')}`)
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"apps":{"http":{"servers":{}}}}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const paths = managedCaddyPaths('demo-project')
    mkdirSync(paths.rootDir, { recursive: true })
    mkdirSync(paths.sitesDir, { recursive: true })
    writeFileSync(paths.mainConfigPath, renderManagedMainCaddyfile(), 'utf-8')
    writeFileSync(paths.fragmentPath, '# demo-project\n', 'utf-8')

    await loadManagedCaddyStatus({
      id: 'demo-project',
      path: '/memorytree/worktrees/demo-project',
      name: 'demo-project',
      development_path: '/repo',
      memory_path: '/memorytree/worktrees/demo-project',
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
      report_exposure: 'lan',
      last_heartbeat_at: '',
      last_refresh_at: '',
    })

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:2019/config/', {
      headers: {
        Origin: 'http://127.0.0.1:2019',
      },
    })
  })
})
