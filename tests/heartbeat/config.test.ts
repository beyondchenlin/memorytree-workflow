import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Mock homedir so all path helpers point to a temp directory
// ---------------------------------------------------------------------------

let tmpDir: string

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpDir,
  }
})

// Import after mock setup so configPath() / memorytreeRoot() use the mock
import {
  DEFAULT_MEMORY_BRANCH,
  loadConfig,
  saveConfig,
  intervalToSeconds,
  registerProject,
  upsertProject,
  configPath,
  memorytreeRoot,
  findProjectForPath,
  noteProjectHeartbeatRun,
  projectIsDue,
  resolveReportPort,
  resolveReportExposure,
} from '../../src/heartbeat/config.js'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cfg-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// configPath / memorytreeRoot
// ---------------------------------------------------------------------------

describe('configPath / memorytreeRoot', () => {
  it('memorytreeRoot returns <home>/.memorytree', () => {
    const root = memorytreeRoot()
    expect(root).toContain('.memorytree')
    expect(root.startsWith(tmpDir)).toBe(true)
  })

  it('configPath returns <home>/.memorytree/config.toml', () => {
    const path = configPath()
    expect(path).toContain('config.toml')
    expect(path.startsWith(tmpDir)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  it('returns defaults when config file does not exist', () => {
    const cfg = loadConfig()
    expect(cfg.heartbeat_interval).toBe('5m')
    expect(cfg.auto_push).toBe(true)
    expect(cfg.log_level).toBe('info')
    expect(cfg.watch_dirs).toEqual([])
    expect(cfg.projects).toEqual([])
  })

  it('parses valid TOML file', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(
      path,
      [
        'heartbeat_interval = "10m"',
        'auto_push = false',
        'log_level = "debug"',
        'report_port = 12345',
        'report_exposure = "lan"',
        'watch_dirs = ["/home/user/repos"]',
        '',
        '[[projects]]',
        'path = "/home/user/project-a"',
        'name = "project-a"',
        '',
      ].join('\n'),
    )

    const cfg = loadConfig()
    expect(cfg.heartbeat_interval).toBe('10m')
    expect(cfg.auto_push).toBe(false)
    expect(cfg.log_level).toBe('debug')
    expect(cfg.report_port).toBe(12345)
    expect(cfg.report_exposure).toBe('lan')
    expect(cfg.watch_dirs).toEqual(['/home/user/repos'])
    expect(cfg.projects).toHaveLength(1)
    expect(cfg.projects[0]!.path).toBe('/home/user/project-a')
    expect(cfg.projects[0]!.name).toBe('project-a')
  })

  it('returns defaults for invalid TOML', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, '<<<not valid toml>>>')

    const cfg = loadConfig()
    expect(cfg.heartbeat_interval).toBe('5m')
    expect(cfg.auto_push).toBe(true)
    expect(cfg.report_port).toBe(10010)
  })

  it('uses defaults for missing or invalid fields', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    // Only set heartbeat_interval; other fields should default
    writeFileSync(path, 'heartbeat_interval = "1h"\n')

    const cfg = loadConfig()
    expect(cfg.heartbeat_interval).toBe('1h')
    expect(cfg.auto_push).toBe(true)
    expect(cfg.log_level).toBe('info')
    expect(cfg.report_port).toBe(10010)
    expect(cfg.watch_dirs).toEqual([])
    expect(cfg.projects).toEqual([])
  })

  it('hydrates project-level overrides from TOML while keeping global defaults', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(
      path,
      [
        'heartbeat_interval = "5m"',
        'auto_push = true',
        'generate_report = false',
        'report_port = 10010',
        'report_exposure = "local"',
        '',
        '[[projects]]',
        'path = "/home/user/project-a"',
        'memory_path = "/home/user/.memorytree/worktrees/project-a"',
        'development_path = "/home/user/project-a"',
        'memory_branch = "memorytree-custom"',
        'name = "project-a"',
        'heartbeat_interval = "15m"',
        'auto_push = false',
        'generate_report = true',
        'report_port = 18080',
        'report_exposure = "lan"',
        'raw_upload_permission = "approved"',
        'last_heartbeat_at = "2026-03-19T10:00:00Z"',
        '',
      ].join('\n'),
    )

    const cfg = loadConfig()
    expect(cfg.heartbeat_interval).toBe('5m')
    expect(cfg.projects).toHaveLength(1)
    expect(cfg.projects[0]!.heartbeat_interval).toBe('15m')
    expect(cfg.projects[0]!.memory_branch).toBe('memorytree-custom')
    expect(cfg.projects[0]!.auto_push).toBe(false)
    expect(cfg.projects[0]!.generate_report).toBe(true)
    expect(cfg.projects[0]!.report_port).toBe(18080)
    expect(cfg.projects[0]!.report_exposure).toBe('lan')
    expect(cfg.projects[0]!.raw_upload_permission).toBe('approved')
    expect(cfg.projects[0]!.last_heartbeat_at).toBe('2026-03-19T10:00:00Z')
  })

  it('ignores legacy refresh fields from older TOML files', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(
      path,
      [
        '[[projects]]',
        'path = "/home/user/project-a"',
        'name = "project-a"',
        'refresh_interval = "45m"',
        'last_refresh_at = "2026-03-19T10:15:00Z"',
        '',
      ].join('\n'),
    )

    const cfg = loadConfig()
    expect(cfg.projects).toHaveLength(1)
    expect('refresh_interval' in (cfg.projects[0]! as Record<string, unknown>)).toBe(false)
    expect('last_refresh_at' in (cfg.projects[0]! as Record<string, unknown>)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------

describe('saveConfig', () => {
  it('roundtrip: save then load yields equivalent config', () => {
    const original = {
      heartbeat_interval: '10m',
      auto_push: false,
      log_level: 'debug',
      watch_dirs: ['/repos/a', '/repos/b'],
      projects: [
        { path: '/home/user/project-a', name: 'project-a' },
        { path: '/home/user/project-b', name: 'project-b' },
      ],
      generate_report: true,
      ai_summary_model: 'claude-opus-4-6',
      report_port: 10010,
    } as const

    saveConfig(original)
    const loaded = loadConfig()

    expect(loaded.heartbeat_interval).toBe(original.heartbeat_interval)
    expect(loaded.auto_push).toBe(original.auto_push)
    expect(loaded.log_level).toBe(original.log_level)
    expect(loaded.watch_dirs).toEqual([...original.watch_dirs])
    expect(loaded.projects).toHaveLength(2)
    expect(loaded.projects[0]!.path).toBe(original.projects[0]!.path)
    expect(loaded.projects[1]!.name).toBe(original.projects[1]!.name)
    expect(loaded.generate_report).toBe(original.generate_report)
    expect(loaded.ai_summary_model).toBe(original.ai_summary_model)
    expect(loaded.report_port).toBe(original.report_port)
  })

  it('serializes empty projects list', () => {
    const cfg = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
    } as const

    saveConfig(cfg)

    const text = readFileSync(configPath(), 'utf-8')
    expect(text).toContain('heartbeat_interval = "5m"')
    expect(text).toContain('auto_push = true')
    expect(text).toContain('report_port = 10010')
    expect(text).not.toContain('[[projects]]')
  })

  it('roundtrips project raw upload permission', () => {
    saveConfig({
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [{
        path: '/home/user/project-a',
        name: 'project-a',
        development_path: '/home/user/project-a',
        memory_path: '/home/user/.memorytree/worktrees/project-a',
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
        raw_upload_permission: 'denied',
        last_heartbeat_at: '',
      }],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      report_exposure: 'local',
    })

    const loaded = loadConfig()
    expect(loaded.projects[0]!.raw_upload_permission).toBe('denied')
    expect(readFileSync(configPath(), 'utf-8')).toContain('raw_upload_permission = "denied"')
  })
})

// ---------------------------------------------------------------------------
// intervalToSeconds
// ---------------------------------------------------------------------------

describe('intervalToSeconds', () => {
  it('parses minutes: 5m -> 300', () => {
    expect(intervalToSeconds('5m')).toBe(300)
  })

  it('parses hours: 1h -> 3600', () => {
    expect(intervalToSeconds('1h')).toBe(3600)
  })

  it('parses seconds: 30s -> 30', () => {
    expect(intervalToSeconds('30s')).toBe(30)
  })

  it('returns default (300) for invalid input', () => {
    expect(intervalToSeconds('invalid')).toBe(300)
  })

  it('returns default (300) for zero value', () => {
    expect(intervalToSeconds('0m')).toBe(300)
  })

  it('handles leading/trailing whitespace', () => {
    expect(intervalToSeconds('  10m  ')).toBe(600)
  })

  it('is case-insensitive', () => {
    expect(intervalToSeconds('2H')).toBe(7200)
  })
})

// ---------------------------------------------------------------------------
// registerProject
// ---------------------------------------------------------------------------

describe('registerProject', () => {
  it('adds a new project to an empty list', () => {
    const cfg = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
    } as const

    const updated = registerProject(cfg, tmpDir)
    expect(updated.projects).toHaveLength(1)
    expect(updated.projects[0]!.path).toBeTruthy()
    // Name derived from last path segment
    expect(updated.projects[0]!.name).toBeTruthy()
    expect(updated.projects[0]!.memory_branch).toBe(DEFAULT_MEMORY_BRANCH)
  })

  it('skips duplicate project (by resolved path)', () => {
    const cfg = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
    } as const

    const updated1 = registerProject(cfg, tmpDir)
    const updated2 = registerProject(updated1, tmpDir)
    expect(updated2.projects).toHaveLength(1)
  })

  it('does not mutate the original config', () => {
    const cfg = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
    } as const

    const updated = registerProject(cfg, tmpDir)
    expect(cfg.projects).toHaveLength(0)
    expect(updated.projects).toHaveLength(1)
  })

  it('copies global behavior defaults into a newly registered project', () => {
    const cfg = {
      heartbeat_interval: '9m',
      auto_push: false,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: true,
      ai_summary_model: 'claude-sonnet-4-6',
      locale: 'zh-CN',
      gh_pages_branch: 'gh-pages',
      cname: '',
      webhook_url: '',
      report_base_url: 'https://example.com/memory',
      report_port: 18181,
    } as const

    const updated = registerProject(cfg, tmpDir)
    expect(updated.projects).toHaveLength(1)
    expect(updated.projects[0]!.heartbeat_interval).toBe('9m')
    expect(updated.projects[0]!.auto_push).toBe(false)
    expect(updated.projects[0]!.generate_report).toBe(true)
    expect(updated.projects[0]!.locale).toBe('zh-CN')
    expect(updated.projects[0]!.gh_pages_branch).toBe('gh-pages')
    expect(updated.projects[0]!.report_base_url).toBe('https://example.com/memory')
    expect(updated.projects[0]!.report_port).toBe(18181)
    expect(updated.projects[0]!.report_exposure).toBe('local')
    expect(updated.projects[0]!.raw_upload_permission).toBe('not-set')
    expect(updated.projects[0]!.memory_branch).toBe(DEFAULT_MEMORY_BRANCH)
  })
})

describe('upsertProject', () => {
  it('updates an existing project instead of appending a duplicate entry', () => {
    const initial = registerProject(loadConfig(), tmpDir)
    const updated = upsertProject(initial, tmpDir, {
      heartbeat_interval: '15m',
      auto_push: false,
      generate_report: true,
    })

    expect(updated.projects).toHaveLength(1)
    expect(updated.projects[0]!.heartbeat_interval).toBe('15m')
    expect(updated.projects[0]!.auto_push).toBe(false)
    expect(updated.projects[0]!.generate_report).toBe(true)
  })

  it('updates the dedicated memory branch when overridden', () => {
    const initial = registerProject(loadConfig(), tmpDir)
    const updated = upsertProject(initial, tmpDir, {
      memory_branch: 'memorytree-alt',
    })

    expect(updated.projects[0]!.memory_branch).toBe('memorytree-alt')
  })
})

// ---------------------------------------------------------------------------
// New fields: generate_report and ai_summary_model
// ---------------------------------------------------------------------------

describe('generate_report and ai_summary_model fields', () => {
  it('defaults to false and haiku model', () => {
    const cfg = loadConfig()
    expect(cfg.generate_report).toBe(false)
    expect(cfg.ai_summary_model).toBe('claude-haiku-4-5-20251001')
  })

  it('parses generate_report from TOML', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(
      path,
      ['generate_report = true', 'ai_summary_model = "claude-opus-4-6"', ''].join('\n'),
    )
    const cfg = loadConfig()
    expect(cfg.generate_report).toBe(true)
    expect(cfg.ai_summary_model).toBe('claude-opus-4-6')
  })

  it('defaults generate_report on invalid value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'generate_report = "yes"\n')
    const cfg = loadConfig()
    expect(cfg.generate_report).toBe(false)
  })

  it('defaults ai_summary_model on empty value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'ai_summary_model = ""\n')
    const cfg = loadConfig()
    expect(cfg.ai_summary_model).toBe('claude-haiku-4-5-20251001')
  })

  it('round-trips generate_report and ai_summary_model', () => {
    const original = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: true,
      ai_summary_model: 'claude-sonnet-4-6',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
    } as const

    saveConfig(original)
    const loaded = loadConfig()
    expect(loaded.generate_report).toBe(true)
    expect(loaded.ai_summary_model).toBe('claude-sonnet-4-6')
  })
})

// ---------------------------------------------------------------------------
// New fields: locale, gh_pages_branch, cname, webhook_url
// ---------------------------------------------------------------------------

describe('locale / gh_pages_branch / cname / webhook_url fields', () => {
  it('defaults locale to "en"', () => {
    const cfg = loadConfig()
    expect(cfg.locale).toBe('en')
  })

  it('defaults gh_pages_branch to ""', () => {
    const cfg = loadConfig()
    expect(cfg.gh_pages_branch).toBe('')
  })

  it('defaults cname to ""', () => {
    const cfg = loadConfig()
    expect(cfg.cname).toBe('')
  })

  it('defaults webhook_url to ""', () => {
    const cfg = loadConfig()
    expect(cfg.webhook_url).toBe('')
  })

  it('parses all 4 fields from TOML', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(
      path,
      [
        'locale = "zh-CN"',
        'gh_pages_branch = "gh-pages"',
        'cname = "memory.example.com"',
        'webhook_url = "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"',
        '',
      ].join('\n'),
    )
    const cfg = loadConfig()
    expect(cfg.locale).toBe('zh-CN')
    expect(cfg.gh_pages_branch).toBe('gh-pages')
    expect(cfg.cname).toBe('memory.example.com')
    expect(cfg.webhook_url).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/xxx')
  })

  it('defaults locale on missing field', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'heartbeat_interval = "5m"\n')
    const cfg = loadConfig()
    expect(cfg.locale).toBe('en')
  })

  it('defaults locale on empty string', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'locale = ""\n')
    const cfg = loadConfig()
    expect(cfg.locale).toBe('en')
  })

  it('round-trips all 4 fields via saveConfig/loadConfig', () => {
    const original = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'zh-CN',
      gh_pages_branch: 'gh-pages',
      cname: 'memory.example.com',
      webhook_url: 'https://hooks.slack.com/services/test',
      report_base_url: '',
    } as const

    saveConfig(original)
    const loaded = loadConfig()
    expect(loaded.locale).toBe('zh-CN')
    expect(loaded.gh_pages_branch).toBe('gh-pages')
    expect(loaded.cname).toBe('memory.example.com')
    expect(loaded.webhook_url).toBe('https://hooks.slack.com/services/test')
  })

  it('handles non-string gh_pages_branch gracefully', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'gh_pages_branch = 42\n')
    const cfg = loadConfig()
    expect(cfg.gh_pages_branch).toBe('')
  })
})

// ---------------------------------------------------------------------------
// New field: report_base_url
// ---------------------------------------------------------------------------

describe('report_base_url field', () => {
  it('defaults to empty string', () => {
    const cfg = loadConfig()
    expect(cfg.report_base_url).toBe('')
  })

  it('parses report_base_url from TOML', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_base_url = "https://memory.example.com"\n')
    const cfg = loadConfig()
    expect(cfg.report_base_url).toBe('https://memory.example.com')
  })

  it('defaults on missing field', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'heartbeat_interval = "5m"\n')
    const cfg = loadConfig()
    expect(cfg.report_base_url).toBe('')
  })

  it('defaults on non-string value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_base_url = 123\n')
    const cfg = loadConfig()
    expect(cfg.report_base_url).toBe('')
  })

  it('round-trips via saveConfig/loadConfig', () => {
    const original = {
      heartbeat_interval: '5m',
      auto_push: false,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: 'https://memory.example.com',
    } as const

    saveConfig(original)
    const loaded = loadConfig()
    expect(loaded.report_base_url).toBe('https://memory.example.com')
  })
})

// ---------------------------------------------------------------------------
// New field: report_port
// ---------------------------------------------------------------------------

describe('report_port field', () => {
  it('defaults to 10010', () => {
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(10010)
  })

  it('parses report_port from TOML', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_port = 18080\n')
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(18080)
  })

  it('defaults on missing field', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'heartbeat_interval = "5m"\n')
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(10010)
  })

  it('defaults on non-number value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_port = "bad"\n')
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(10010)
  })

  it('defaults on non-positive value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_port = 0\n')
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(10010)
  })

  it('defaults on non-integer value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_port = 10010.5\n')
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(10010)
  })

  it('defaults on out-of-range value', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_port = 70000\n')
    const cfg = loadConfig()
    expect(cfg.report_port).toBe(10010)
  })

  it('round-trips via saveConfig/loadConfig', () => {
    const original = {
      heartbeat_interval: '5m',
      auto_push: false,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 18080,
    } as const

    saveConfig(original)
    const loaded = loadConfig()
    expect(loaded.report_port).toBe(18080)
  })
})

describe('report_exposure field', () => {
  it('defaults to local', () => {
    const cfg = loadConfig()
    expect(cfg.report_exposure).toBe('local')
  })

  it('parses report_exposure from TOML', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_exposure = "lan"\n')
    const cfg = loadConfig()
    expect(cfg.report_exposure).toBe('lan')
  })

  it('defaults on invalid report_exposure', () => {
    const path = configPath()
    mkdirSync(join(tmpDir, '.memorytree'), { recursive: true })
    writeFileSync(path, 'report_exposure = "public"\n')
    const cfg = loadConfig()
    expect(cfg.report_exposure).toBe('local')
  })

  it('round-trips via saveConfig/loadConfig', () => {
    const original = {
      heartbeat_interval: '5m',
      auto_push: false,
      log_level: 'info',
      watch_dirs: [],
      projects: [],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 18080,
      report_exposure: 'lan',
    } as const

    saveConfig(original)
    const loaded = loadConfig()
    expect(loaded.report_exposure).toBe('lan')
  })
})

describe('project path helpers', () => {
  it('findProjectForPath matches nested report directories using the longest root', () => {
    const cfg = registerProject(loadConfig(), '/workspace/app')
    const project = findProjectForPath(cfg, '/workspace/app/Memory/07_reports')

    expect(project).not.toBeNull()
    expect(project!.development_path).toBe('/workspace/app')
  })

  it('resolveReportPort prefers the matching project port over the global default', () => {
    const cfg = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [
        {
          id: 'project-a',
          path: '/workspace/app',
          name: 'project-a',
          development_path: '/workspace/app',
          memory_path: '/workspace/.memorytree/worktrees/app',
          memory_branch: DEFAULT_MEMORY_BRANCH,
          heartbeat_interval: '5m',
          auto_push: true,
          generate_report: false,
          ai_summary_model: 'claude-haiku-4-5-20251001',
          locale: 'en',
          gh_pages_branch: '',
          cname: '',
          webhook_url: '',
          report_base_url: '',
          report_port: 19090,
          last_heartbeat_at: '',
        },
      ],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
    } as const

    expect(resolveReportPort(cfg, '/workspace/app/Memory/07_reports')).toBe(19090)
    expect(resolveReportPort(cfg, '/workspace/other')).toBe(10010)
  })

  it('resolveReportExposure prefers the matching project exposure over the global default', () => {
    const cfg = {
      heartbeat_interval: '5m',
      auto_push: true,
      log_level: 'info',
      watch_dirs: [],
      projects: [
        {
          id: 'project-a',
          path: '/workspace/app',
          name: 'project-a',
          development_path: '/workspace/app',
          memory_path: '/workspace/.memorytree/worktrees/app',
          memory_branch: DEFAULT_MEMORY_BRANCH,
          heartbeat_interval: '5m',
          auto_push: true,
          generate_report: false,
          ai_summary_model: 'claude-haiku-4-5-20251001',
          locale: 'en',
          gh_pages_branch: '',
          cname: '',
          webhook_url: '',
          report_base_url: '',
          report_port: 19090,
          report_exposure: 'lan',
          last_heartbeat_at: '',
        },
      ],
      generate_report: false,
      ai_summary_model: 'claude-haiku-4-5-20251001',
      locale: 'en',
      gh_pages_branch: '',
      cname: '',
      webhook_url: '',
      report_base_url: '',
      report_port: 10010,
      report_exposure: 'local',
    } as const

    expect(resolveReportExposure(cfg, '/workspace/app/Memory/07_reports')).toBe('lan')
    expect(resolveReportExposure(cfg, '/workspace/other')).toBe('local')
  })
})

describe('project scheduling helpers', () => {
  it('projectIsDue returns false when the last run is still inside the interval', () => {
    const project = registerProject(loadConfig(), '/workspace/app').projects[0]!
    const updated = {
      ...project,
      last_heartbeat_at: '2026-03-19T10:00:00Z',
    }
    expect(projectIsDue(updated, new Date('2026-03-19T10:04:59Z'))).toBe(false)
  })

  it('projectIsDue returns true when the interval has elapsed', () => {
    const project = registerProject(loadConfig(), '/workspace/app').projects[0]!
    const updated = {
      ...project,
      last_heartbeat_at: '2026-03-19T10:00:00Z',
    }
    expect(projectIsDue(updated, new Date('2026-03-19T10:05:00Z'))).toBe(true)
  })

  it('noteProjectHeartbeatRun updates only the targeted project timestamp', () => {
    const cfg1 = registerProject(loadConfig(), '/workspace/app-a')
    const cfg2 = registerProject(cfg1, '/workspace/app-b')
    const target = cfg2.projects[1]!

    const updated = noteProjectHeartbeatRun(cfg2, target.id, '2026-03-19T10:30:00Z')

    expect(updated.projects[0]!.last_heartbeat_at).toBe('')
    expect(updated.projects[1]!.last_heartbeat_at).toBe('2026-03-19T10:30:00Z')
  })
})
