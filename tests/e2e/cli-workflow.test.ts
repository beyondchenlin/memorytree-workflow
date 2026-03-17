import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

const workspaceRoot = resolve(process.cwd())
const cliPath = join(workspaceRoot, 'dist', 'cli.js')

let sandboxRoot: string
let homeDir: string
let repoRoot: string
let globalRoot: string

beforeEach(() => {
  sandboxRoot = mkdtempSync(join(tmpdir(), 'memorytree-e2e-'))
  homeDir = join(sandboxRoot, 'home')
  repoRoot = join(sandboxRoot, 'repo')
  globalRoot = join(sandboxRoot, 'global')
  mkdirSync(homeDir, { recursive: true })
})

afterEach(() => {
  rmSync(sandboxRoot, { recursive: true, force: true })
})

describe('CLI E2E', () => {
  it('upgrades a fresh repository through the built CLI', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    const result = runCli([
      'upgrade',
      '--root', repoRoot,
      '--project-name', 'e2e-demo',
      '--goal-summary', 'Build durable memory workflows.',
      '--locale', 'auto',
      '--date', '2026-03-17',
      '--time', '10:30',
      '--format', 'json',
    ])
    assertSuccess(result, 'memorytree upgrade')

    const payload = JSON.parse(result.stdout) as Record<string, unknown>
    expect(payload['state_before']).toBe('not-installed')
    expect(payload['state_after']).toBe('installed')
    expect(payload['effective_locale']).toBe('en')
    expect(existsSync(join(repoRoot, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(repoRoot, 'Memory', '01_goals'))).toBe(true)
    expect(existsSync(join(repoRoot, 'Memory', '02_todos'))).toBe(true)
    expect(existsSync(join(repoRoot, 'Memory', '03_chat_logs'))).toBe(true)
  })

  it('imports a transcript and builds the HTML report through the built CLI', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    const transcriptPath = writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'import-report',
    })

    const importResult = runCli([
      'import',
      '--root', repoRoot,
      '--source', transcriptPath,
      '--client', 'codex',
      '--project-name', 'repo',
      '--global-root', globalRoot,
      '--raw-upload-permission', 'approved',
      '--format', 'json',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(importResult, 'memorytree import')

    const imported = JSON.parse(importResult.stdout) as Record<string, unknown>
    expect(imported['matches_current_repo']).toBe(true)
    expect(String(imported['repo_clean_path'] ?? '')).toContain('Memory/06_transcripts/clean/')
    expect(existsSync(join(repoRoot, String(imported['repo_manifest_path'])))).toBe(true)
    expect(existsSync(String(imported['global_manifest_path']))).toBe(true)

    const reportResult = runCli([
      'report',
      'build',
      '--root', repoRoot,
      '--no-ai',
      '--locale', 'en',
      '--report-base-url', 'https://memory.example.com',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(reportResult, 'memorytree report build')

    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'index.html'))).toBe(true)
    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'transcripts', 'index.html'))).toBe(true)
    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'search.html'))).toBe(true)
    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'feed.xml'))).toBe(true)
    expect(readFileSync(join(repoRoot, '.gitignore'), 'utf-8')).toContain('Memory/07_reports/')
    expect(readFileSync(join(repoRoot, 'Memory', '07_reports', 'feed.xml'), 'utf-8')).toContain('https://memory.example.com')
  })

  it('runs heartbeat end-to-end on a dedicated memorytree branch and commits imports', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'memorytree/e2e')

    const upgradeResult = runCli([
      'upgrade',
      '--root', repoRoot,
      '--project-name', 'repo',
      '--goal-summary', 'Build durable memory workflows.',
      '--locale', 'en',
      '--date', '2026-03-17',
      '--time', '10:30',
      '--format', 'json',
    ])
    assertSuccess(upgradeResult, 'memorytree upgrade (memorytree branch)')

    writeFileSync(join(repoRoot, '.gitignore'), 'Memory/07_reports/\n', 'utf-8')
    commitAll(repoRoot, 'chore: scaffold memorytree workspace')

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: true,
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'memorytree/e2e',
      stem: 'heartbeat-commit',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once (memorytree branch)')

    expect(runGit(['log', '-1', '--pretty=%s'], repoRoot).stdout.trim()).toBe(
      'memorytree(transcripts): import 1 transcript(s)',
    )
    expect(listFiles(join(repoRoot, 'Memory', '06_transcripts', 'manifests')).length).toBe(1)
    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'index.html'))).toBe(true)
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('?? Memory/06_transcripts/raw/')
    expect(listFiles(join(homeDir, '.memorytree', 'transcripts', 'index')).length).toBeGreaterThan(0)
  })

  it('keeps repository branches clean during heartbeat on non-memorytree branches', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')
    const beforeHead = runGit(['rev-parse', 'HEAD'], repoRoot).stdout.trim()

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: false,
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'heartbeat-global-only',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once (main branch)')

    const afterHead = runGit(['rev-parse', 'HEAD'], repoRoot).stdout.trim()
    expect(afterHead).toBe(beforeHead)
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('')
    expect(existsSync(join(repoRoot, 'Memory', '06_transcripts'))).toBe(false)
    expect(listFiles(join(homeDir, '.memorytree', 'transcripts', 'index', 'manifests')).length).toBe(1)
  })
})

function runCli(args: readonly string[], options: RunOptions = {}): CommandResult {
  return runCommand(process.execPath, [cliPath, ...args], options)
}

function runGit(args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): CommandResult {
  return runCommand('git', args, { cwd, env })
}

function runCommand(command: string, args: readonly string[], options: RunOptions): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function assertSuccess(result: CommandResult, label: string): void {
  if (result.status !== 0) {
    throw new Error([
      `${label} failed with exit code ${String(result.status)}`,
      'stdout:',
      result.stdout.trim(),
      'stderr:',
      result.stderr.trim(),
    ].join('\n'))
  }
}

function isolatedEnv(homePath: string): NodeJS.ProcessEnv {
  return {
    HOME: homePath,
    USERPROFILE: homePath,
  }
}

function initGitRepo(root: string, branch: string): void {
  mkdirSync(root, { recursive: true })
  assertSuccess(runGit(['init', '-b', branch], root), 'git init')
  assertSuccess(runGit(['config', 'user.email', 'e2e@example.com'], root), 'git config user.email')
  assertSuccess(runGit(['config', 'user.name', 'MemoryTree E2E'], root), 'git config user.name')

  writeFileSync(join(root, 'README.md'), '# E2E Repo\n', 'utf-8')
  assertSuccess(runGit(['add', 'README.md'], root), 'git add README')
  assertSuccess(runGit(['commit', '-m', 'chore: init repo'], root), 'git commit init')
}

function commitAll(root: string, message: string): void {
  assertSuccess(runGit(['add', '.'], root), 'git add .')
  assertSuccess(runGit(['commit', '-m', message], root), `git commit ${message}`)
}

function writeConfig(
  homePath: string,
  options: { projectPath: string; autoPush: boolean; generateReport: boolean },
): void {
  const configDir = join(homePath, '.memorytree')
  mkdirSync(configDir, { recursive: true })

  const configToml = [
    'heartbeat_interval = "5m"',
    `auto_push = ${options.autoPush ? 'true' : 'false'}`,
    'log_level = "debug"',
    `generate_report = ${options.generateReport ? 'true' : 'false'}`,
    'ai_summary_model = "claude-haiku-4-5-20251001"',
    'locale = "en"',
    'gh_pages_branch = ""',
    'cname = ""',
    'webhook_url = ""',
    'report_base_url = ""',
    'watch_dirs = []',
    '',
    '[[projects]]',
    `path = "${escapeToml(toPosix(options.projectPath))}"`,
    'name = "repo"',
    '',
  ].join('\n')

  writeFileSync(join(configDir, 'config.toml'), configToml, 'utf-8')
}

function writeCodexTranscript(
  options: { homeDir: string; repoPath: string; branch: string; stem: string },
): string {
  const transcriptDir = join(options.homeDir, '.codex', 'sessions', 'e2e')
  mkdirSync(transcriptDir, { recursive: true })

  const transcriptPath = join(transcriptDir, `${options.stem}.jsonl`)
  const repoPath = toPosix(options.repoPath)
  const records = [
    {
      type: 'session_meta',
      payload: {
        id: `sess-${options.stem}`,
        title: `E2E ${options.stem}`,
        cwd: repoPath,
        git: { branch: options.branch },
        timestamp: '2026-03-17T10:30:00Z',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-03-17T10:30:01Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Capture this coding session.' }],
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-03-17T10:30:02Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Captured and indexed.' }],
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-03-17T10:30:03Z',
      payload: {
        type: 'function_call',
        name: 'read_file',
        arguments: { path: 'README.md' },
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-03-17T10:30:04Z',
      payload: {
        type: 'function_call_output',
        name: 'read_file',
        output: '# E2E Repo',
      },
    },
  ]

  writeFileSync(
    transcriptPath,
    records.map(record => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  )
  return transcriptPath
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return []

  const files: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry)
      const stats = statSync(entryPath)
      if (stats.isDirectory()) {
        stack.push(entryPath)
      } else {
        files.push(toPosix(relative(root, entryPath)))
      }
    }
  }

  return files.sort()
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
