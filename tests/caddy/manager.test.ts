import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tmpHome: string

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpHome,
  }
})

import {
  findManagedPortConflict,
  managedCaddyPaths,
  managedCaddyStartCommand,
  renderManagedMainCaddyfile,
  renderManagedProjectFragment,
} from '../../src/caddy/manager.js'

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'memorytree-caddy-test-'))
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
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
    const text = renderManagedProjectFragment({
      id: 'demo-project',
      name: 'Demo Project',
      report_port: 10010,
      report_exposure: 'local',
    }, 'D:/demo1/memorytree-workflow/Memory/07_reports')

    expect(text).toContain('# project_id: demo-project')
    expect(text).toContain('# report_port: 10010')
    expect(text).toContain('# report_exposure: local')
    expect(text).toContain('http://127.0.0.1:10010, http://localhost:10010')
    expect(text).toContain('bind 127.0.0.1 [::1]')
    expect(text).toContain('root * "D:/demo1/memorytree-workflow/Memory/07_reports"')
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
