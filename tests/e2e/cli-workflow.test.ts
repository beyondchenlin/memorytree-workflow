import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
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
import { createServer } from 'node:net'
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

interface RunningProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly stdout: () => string
  readonly stderr: () => string
}

const workspaceRoot = resolve(process.cwd())
const cliPath = join(workspaceRoot, 'dist', 'cli.js')

let sandboxRoot: string
let homeDir: string
let repoRoot: string
let otherRepoRoot: string
let globalRoot: string
let liveProcesses: ChildProcessWithoutNullStreams[]

beforeEach(() => {
  sandboxRoot = mkdtempSync(join(tmpdir(), 'memorytree-e2e-'))
  homeDir = join(sandboxRoot, 'home')
  repoRoot = join(sandboxRoot, 'repo')
  otherRepoRoot = join(sandboxRoot, 'other-repo')
  globalRoot = join(sandboxRoot, 'global')
  liveProcesses = []
  mkdirSync(homeDir, { recursive: true })
})

afterEach(async () => {
  for (const child of liveProcesses) {
    await stopProcess(child)
  }

  await removeTreeWithRetry(sandboxRoot)
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
    expect(result.stderr).toContain('This command updated repository files only.')
    expect(result.stderr).toContain('memorytree daemon quick-start --root')
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

  it('discovers current-project and all-projects transcripts through the built CLI', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')
    initGitRepo(otherRepoRoot, 'main')

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'discover-current',
      startedAt: '2026-03-17T10:30:00Z',
    })
    writeCodexTranscript({
      homeDir,
      repoPath: otherRepoRoot,
      branch: 'main',
      stem: 'discover-other',
      startedAt: '2026-03-17T10:45:00Z',
    })

    const currentProject = runCli([
      'discover',
      '--root', repoRoot,
      '--client', 'codex',
      '--scope', 'current-project',
      '--project-name', 'repo',
      '--global-root', globalRoot,
      '--raw-upload-permission', 'approved',
      '--format', 'json',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(currentProject, 'memorytree discover current-project')

    const currentPayload = JSON.parse(currentProject.stdout) as Record<string, unknown>
    expect(currentPayload['discovered_count']).toBe(2)
    expect(currentPayload['imported_count']).toBe(1)
    expect(currentPayload['repo_mirror_count']).toBe(1)
    expect(currentPayload['global_only_count']).toBe(0)
    expect(currentPayload['skipped_count']).toBe(1)
    expect(listFiles(join(repoRoot, 'Memory', '06_transcripts', 'manifests')).length).toBe(1)

    const allProjects = runCli([
      'discover',
      '--root', repoRoot,
      '--client', 'codex',
      '--scope', 'all-projects',
      '--project-name', 'repo',
      '--global-root', globalRoot,
      '--raw-upload-permission', 'approved',
      '--format', 'json',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(allProjects, 'memorytree discover all-projects')

    const allPayload = JSON.parse(allProjects.stdout) as Record<string, unknown>
    expect(allPayload['discovered_count']).toBe(2)
    expect(allPayload['imported_count']).toBe(2)
    expect(allPayload['repo_mirror_count']).toBe(1)
    expect(allPayload['global_only_count']).toBe(1)
    expect(allPayload['skipped_count']).toBe(0)
    expect(listFiles(join(globalRoot, 'index', 'manifests')).length).toBe(2)
  })

  it('recalls the latest prior session and returns clean transcript content', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'older',
      startedAt: '2024-03-17T10:30:00Z',
      title: 'Older session',
      userText: 'First idea.',
      assistantText: 'First answer.',
    })
    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'latest',
      startedAt: '2024-03-17T11:30:00Z',
      title: 'Latest session',
      userText: 'Second idea.',
      assistantText: 'Second answer.',
    })

    const result = runCli([
      'recall',
      '--root', repoRoot,
      '--project-name', 'repo',
      '--global-root', globalRoot,
      '--activation-time', '2025-03-17T12:00:00Z',
      '--format', 'json',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(result, 'memorytree recall')

    const payload = JSON.parse(result.stdout) as Record<string, unknown>
    expect(payload['found']).toBe(true)
    expect(payload['imported_count']).toBe(2)
    expect(payload['session_id']).toBe('sess-latest')
    expect(payload['title']).toBe('Latest session')
    expect(payload['branch']).toBe('main')
    expect(String(payload['clean_content'] ?? '')).toContain('Second idea.')
    expect(String(payload['clean_content'] ?? '')).toContain('Second answer.')
    expect(existsSync(String(payload['global_clean_path'] ?? ''))).toBe(true)
  })

  it('serves the generated report over real HTTP', async () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    const transcriptPath = writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'serve-report',
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
    assertSuccess(importResult, 'memorytree import for serve')

    const buildResult = runCli([
      'report',
      'build',
      '--root', repoRoot,
      '--no-ai',
      '--locale', 'en',
      '--report-base-url', 'https://memory.example.com',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(buildResult, 'memorytree report build for serve')

    const port = await getAvailablePort()
    const server = await startCli([
      'report',
      'serve',
      '--dir', join(repoRoot, 'Memory', '07_reports'),
      '--port', String(port),
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
      waitForUrl: `http://127.0.0.1:${port}/`,
    })

    const rootResponse = await fetch(`http://127.0.0.1:${port}/`)
    expect(rootResponse.status).toBe(200)
    const rootHtml = await rootResponse.text()
    expect(rootHtml.toLowerCase()).toContain('<html')

    const searchResponse = await fetch(`http://127.0.0.1:${port}/search.html`)
    expect(searchResponse.status).toBe(200)
    expect(server.stdout()).toContain(`http://localhost:${port}/`)
  })

  it('uses report_port from global config when report serve omits --port', async () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    const transcriptPath = writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'serve-report-config-port',
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
    assertSuccess(importResult, 'memorytree import for configured serve port')

    const buildResult = runCli([
      'report',
      'build',
      '--root', repoRoot,
      '--no-ai',
      '--locale', 'en',
      '--report-base-url', 'https://memory.example.com',
    ], { env: isolatedEnv(homeDir) })
    assertSuccess(buildResult, 'memorytree report build for configured serve port')

    const port = await getAvailablePort()
    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: false,
      reportPort: port,
    })

    const server = await startCli([
      'report',
      'serve',
      '--dir', join(repoRoot, 'Memory', '07_reports'),
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
      waitForUrl: `http://127.0.0.1:${port}/`,
    })

    const rootResponse = await fetch(`http://127.0.0.1:${port}/`)
    expect(rootResponse.status).toBe(200)
    expect(server.stdout()).toContain(`http://localhost:${port}/`)
  })

  it('shows scenario-based daemon help with the quick-start command', () => {
    expect(existsSync(cliPath)).toBe(true)

    const result = runCli(['daemon', '--help'])
    assertSuccess(result, 'memorytree daemon --help')

    expect(result.stdout).toContain('Scenario examples:')
    expect(result.stdout).toContain('memorytree daemon quick-start --root .')
    expect(result.stdout).toContain('memorytree daemon install --interval 5m --auto-push true')
    expect(result.stdout).toContain('memorytree daemon register --root .')
    expect(result.stdout).not.toContain('memorytree daemon register --root . --quick-start')
    expect(result.stdout).toContain('memorytree daemon run-once --root . --force')
  })

  it('shows caddy-first report help and keeps report serve as fallback', () => {
    expect(existsSync(cliPath)).toBe(true)

    const reportHelp = runCli(['report', '--help'])
    assertSuccess(reportHelp, 'memorytree report --help')
    expect(reportHelp.stdout).toContain('Local hosting guidance:')
    expect(reportHelp.stdout).toContain('Use Caddy to host ./Memory/07_reports')
    expect(reportHelp.stdout).toContain('memorytree report serve --dir ./Memory/07_reports --port 10010')

    const serveHelp = runCli(['report', 'serve', '--help'])
    assertSuccess(serveHelp, 'memorytree report serve --help')
    expect(serveHelp.stdout).toContain('fallback when Caddy is not used')
    expect(serveHelp.stdout).toContain('For long-running local access, prefer Caddy.')

    const buildHelp = runCli(['report', 'build', '--help'])
    assertSuccess(buildHelp, 'memorytree report build --help')
    expect(buildHelp.stdout).toContain('After building, keep Caddy pointed at the output directory')
  })

  it('shows project-managed Caddy help and subcommands through the built CLI', () => {
    expect(existsSync(cliPath)).toBe(true)

    const caddyHelp = runCli(['caddy', '--help'])
    assertSuccess(caddyHelp, 'memorytree caddy --help')
    expect(caddyHelp.stdout).toContain('Manage MemoryTree-owned Caddy config')
    expect(caddyHelp.stdout).toContain('memorytree caddy enable --root .')
    expect(caddyHelp.stdout).toContain('memorytree caddy status --root .')
    expect(caddyHelp.stdout).toContain('memorytree caddy disable --root .')

    const enableHelp = runCli(['caddy', 'enable', '--help'])
    assertSuccess(enableHelp, 'memorytree caddy enable --help')
    expect(enableHelp.stdout).toContain('Write/update the current project Caddy fragment and reload Caddy')
  })

  it('shows quick-start and register help examples through the built CLI', () => {
    expect(existsSync(cliPath)).toBe(true)

    const quickStartHelp = runCli(['daemon', 'quick-start', '--help'])
    assertSuccess(quickStartHelp, 'memorytree daemon quick-start --help')
    expect(quickStartHelp.stdout).toContain('memorytree daemon quick-start --root .')
    expect(quickStartHelp.stdout).toContain('default first-time setup path')
    expect(quickStartHelp.stdout).toContain('shared source of truth')
    expect(quickStartHelp.stdout).toContain('local cache mirror')
    expect(quickStartHelp.stdout).toContain('Raw transcript mirror commits stay disabled until you explicitly approve them later.')

    const registerHelp = runCli(['daemon', 'register', '--help'])
    assertSuccess(registerHelp, 'memorytree daemon register --help')
    expect(registerHelp.stdout).toContain('Recommended defaults for the current repository:')
    expect(registerHelp.stdout).toContain('Advanced setup with custom values:')
    expect(registerHelp.stdout).toContain('choose the branch, heartbeat cadence, auto_push, raw transcript permission, report port, or worktree path yourself')
    expect(registerHelp.stdout).toContain('memorytree daemon register --root . --quick-start')
    expect(registerHelp.stdout).toContain('--raw-upload-permission <perm>')
    expect(registerHelp.stdout).not.toContain('30m refresh')
  })

  it('shows doctor help with direct node fallback guidance', () => {
    expect(existsSync(cliPath)).toBe(true)

    const doctorHelp = runCli(['doctor', '--help'])
    assertSuccess(doctorHelp, 'memorytree doctor --help')
    expect(doctorHelp.stdout).toContain('Inspect the installed MemoryTree command path')
    expect(doctorHelp.stdout).toContain('memorytree doctor')
    expect(doctorHelp.stdout).toContain('node dist/cli.js doctor')
    expect(doctorHelp.stdout).toContain('node dist/cli.js daemon quick-start --root <target-repo>')
  })

  it('shows that init and upgrade do not register heartbeat by themselves', () => {
    expect(existsSync(cliPath)).toBe(true)

    const initHelp = runCli(['init', '--help'])
    assertSuccess(initHelp, 'memorytree init --help')
    expect(initHelp.stdout).toContain('does not register the repository with heartbeat')
    expect(initHelp.stdout).toContain('memorytree daemon quick-start --root .')

    const upgradeHelp = runCli(['upgrade', '--help'])
    assertSuccess(upgradeHelp, 'memorytree upgrade --help')
    expect(upgradeHelp.stdout).toContain('does not register the repository with heartbeat')
    expect(upgradeHelp.stdout).toContain('memorytree daemon quick-start --root .')
  })

  it('registers a repository with a dedicated heartbeat worktree through the CLI', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')
    const bareRemote = join(sandboxRoot, 'register-remote.git')
    initBareRemote(bareRemote)
    assertSuccess(runGit(['remote', 'add', 'origin', bareRemote], repoRoot), 'git remote add origin for register')

    const result = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--quick-start',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon register')

    const worktreePath = join(homeDir, '.memorytree', 'worktrees', 'repo')
    const configText = readFileSync(join(homeDir, '.memorytree', 'config.toml'), 'utf-8')
    expect(configText).toContain(`development_path = "${escapeToml(toPosix(repoRoot))}"`)
    expect(configText).toContain(`memory_path = "${escapeToml(toPosix(worktreePath))}"`)
    expect(configText).toContain('memory_branch = "memorytree"')
    expect(configText).toContain('heartbeat_interval = "5m"')
    expect(configText).toContain('raw_upload_permission = "not-set"')
    expect(configText).toContain('generate_report = true')
    expect(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath).stdout.trim()).toBe('memorytree')
    expect(runGitDir(['rev-parse', 'memorytree'], bareRemote).status).toBe(0)
  })

  it('allows overriding the memory branch name in detailed register settings', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    const result = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--branch', 'memorytree-custom',
      '--heartbeat-interval', '15m',
      '--auto-push', 'false',
      '--generate-report', 'true',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon register detailed settings')

    const worktreePath = join(homeDir, '.memorytree', 'worktrees', 'repo')
    const configText = readFileSync(join(homeDir, '.memorytree', 'config.toml'), 'utf-8')
    expect(configText).toContain('memory_branch = "memorytree-custom"')
    expect(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath).stdout.trim()).toBe('memorytree-custom')
  })

  it('keeps existing register settings when quick-start is rerun for the same repository', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

    const detailedResult = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--branch', 'memorytree-custom',
      '--heartbeat-interval', '15m',
      '--auto-push', 'false',
      '--generate-report', 'false',
      '--report-port', '12000',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(detailedResult, 'memorytree daemon register detailed settings before quick-start rerun')

    const quickStartResult = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--quick-start',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(quickStartResult, 'memorytree daemon register --quick-start rerun')

    const worktreePath = join(homeDir, '.memorytree', 'worktrees', 'repo')
    const configText = readFileSync(join(homeDir, '.memorytree', 'config.toml'), 'utf-8')
    expect(configText).toContain('memory_branch = "memorytree-custom"')
    expect(configText).toContain('heartbeat_interval = "15m"')
    expect(configText).toContain('auto_push = false')
    expect(configText).toContain('generate_report = false')
    expect(configText).toContain('report_port = 12000')
    expect(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath).stdout.trim()).toBe('memorytree-custom')
  })

  it('runs heartbeat through a registered worktree and syncs outputs back to the development directory', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

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
    assertSuccess(upgradeResult, 'memorytree upgrade for worktree heartbeat')

    const registerResult = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--quick-start',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(registerResult, 'memorytree daemon register for worktree heartbeat')

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'heartbeat-worktree-sync',
    })

    const result = runCli([
      'daemon',
      'run-once',
      '--root', repoRoot,
      '--force',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once via worktree')

    const worktreePath = join(homeDir, '.memorytree', 'worktrees', 'repo')
    expect(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath).stdout.trim()).toBe('memorytree')
    expect(runGit(['log', '-1', '--pretty=%s'], worktreePath).stdout.trim()).toBe(
      'memorytree(transcripts): import 1 transcript(s)',
    )
    expect(listFiles(join(repoRoot, 'Memory', '06_transcripts', 'manifests')).length).toBe(1)
    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'index.html'))).toBe(true)
  })

  it('keeps a de-tracked development branch clean while heartbeat refreshes cache mirrors from the worktree', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

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
    assertSuccess(upgradeResult, 'memorytree upgrade for de-tracked worktree heartbeat')

    commitAll(repoRoot, 'chore: scaffold memorytree workspace')
    detrackManagedCache(repoRoot)
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('')

    const registerResult = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--quick-start',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(registerResult, 'memorytree daemon register for de-tracked worktree heartbeat')

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'heartbeat-detracked-worktree-sync',
    })

    const result = runCli([
      'daemon',
      'run-once',
      '--root', repoRoot,
      '--force',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once via de-tracked worktree')

    const worktreePath = join(homeDir, '.memorytree', 'worktrees', 'repo')
    expect(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath).stdout.trim()).toBe('memorytree')
    expect(runGit(['log', '-1', '--pretty=%s'], worktreePath).stdout.trim()).toBe(
      'memorytree(transcripts): import 1 transcript(s)',
    )
    expect(existsSync(join(repoRoot, 'AGENTS.md'))).toBe(true)
    expect(listFiles(join(repoRoot, 'Memory', '06_transcripts', 'manifests')).length).toBe(1)
    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'index.html'))).toBe(true)
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('')
  })

  it('creates a snapshot commit when no new transcripts are imported but context changes', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'main')

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
    assertSuccess(upgradeResult, 'memorytree upgrade for snapshot heartbeat')

    const registerResult = runCli([
      'daemon',
      'register',
      '--root', repoRoot,
      '--quick-start',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(registerResult, 'memorytree daemon register for snapshot heartbeat')

    const transcriptPath = writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'main',
      stem: 'heartbeat-snapshot-seed',
    })

    const firstResult = runCli([
      'daemon',
      'run-once',
      '--root', repoRoot,
      '--force',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(firstResult, 'memorytree daemon run-once snapshot seed')
    rmSync(transcriptPath, { force: true })

    const todoDir = join(repoRoot, 'Memory', '02_todos')
    const todoName = readdirSync(todoDir).find(name => name.endsWith('.md'))
    expect(todoName).toBeTruthy()
    const todoPath = join(todoDir, todoName!)
    writeFileSync(
      todoPath,
      readFileSync(todoPath, 'utf-8') + '\n- Snapshot heartbeat verification.\n',
      'utf-8',
    )

    const secondResult = runCli([
      'daemon',
      'run-once',
      '--root', repoRoot,
      '--force',
    ], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(secondResult, 'memorytree daemon run-once snapshot follow-up')

    const worktreePath = join(homeDir, '.memorytree', 'worktrees', 'repo')
    const subjects = runGit(['log', '-2', '--pretty=%s'], worktreePath).stdout.trim().split(/\r?\n/)
    expect(subjects[0]).toBe('memorytree(snapshot): heartbeat sync')
    expect(subjects[1]).toBe('memorytree(transcripts): import 1 transcript(s)')
    expect(readFileSync(join(worktreePath, 'Memory', '02_todos', todoName!), 'utf-8')).toContain(
      'Snapshot heartbeat verification.',
    )
    expect(readFileSync(join(repoRoot, 'Memory', '07_reports', 'todos', 'index.html'), 'utf-8')).toContain(
      'Snapshot heartbeat verification.',
    )
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

  it('keeps repo raw transcript mirrors unstaged when raw upload permission is not approved', () => {
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
    assertSuccess(upgradeResult, 'memorytree upgrade (raw permission off)')

    writeFileSync(join(repoRoot, '.gitignore'), 'Memory/07_reports/\n', 'utf-8')
    commitAll(repoRoot, 'chore: scaffold memorytree workspace')

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: true,
      rawUploadPermission: 'not-set',
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'memorytree/e2e',
      stem: 'heartbeat-raw-off',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once (raw permission off)')

    const changedFiles = runGit(['show', '--name-only', '--pretty=', 'HEAD'], repoRoot).stdout
    expect(changedFiles).toContain('Memory/06_transcripts/manifests/')
    expect(changedFiles).not.toContain('Memory/06_transcripts/raw/')
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('?? Memory/06_transcripts/raw/')
  })

  it('commits repo raw transcript mirrors when raw upload permission is approved', () => {
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
    assertSuccess(upgradeResult, 'memorytree upgrade (raw permission approved)')

    writeFileSync(join(repoRoot, '.gitignore'), 'Memory/07_reports/\n', 'utf-8')
    commitAll(repoRoot, 'chore: scaffold memorytree workspace')

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: true,
      rawUploadPermission: 'approved',
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'memorytree/e2e',
      stem: 'heartbeat-raw-approved',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once (raw permission approved)')

    const changedFiles = runGit(['show', '--name-only', '--pretty=', 'HEAD'], repoRoot).stdout
    expect(changedFiles).toContain('Memory/06_transcripts/manifests/')
    expect(changedFiles).toContain('Memory/06_transcripts/raw/')
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('')
  })

  it('commits managed content on a memorytree branch even after AGENTS.md and Memory/** are ignored', () => {
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
    assertSuccess(upgradeResult, 'memorytree upgrade (ignored managed paths)')

    writeFileSync(join(repoRoot, '.gitignore'), 'Memory/07_reports/\n', 'utf-8')
    commitAll(repoRoot, 'chore: scaffold memorytree workspace')
    detrackManagedCache(repoRoot)
    expect(runGit(['status', '--short'], repoRoot).stdout.trim()).toBe('')

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: true,
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'memorytree/e2e',
      stem: 'heartbeat-ignored-managed',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once (ignored managed paths)')

    expect(runGit(['log', '-1', '--pretty=%s'], repoRoot).stdout.trim()).toBe(
      'memorytree(transcripts): import 1 transcript(s)',
    )
    const changedFiles = runGit(['show', '--name-only', '--pretty=', 'HEAD'], repoRoot).stdout
    expect(changedFiles).toContain('AGENTS.md')
    expect(changedFiles).toContain('Memory/02_todos/')
    expect(changedFiles).toContain('Memory/06_transcripts/manifests/')
    expect(changedFiles).not.toContain('Memory/06_transcripts/raw/')
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

  it('deploys heartbeat reports to a gh-pages branch with CNAME', () => {
    expect(existsSync(cliPath)).toBe(true)
    initGitRepo(repoRoot, 'memorytree/e2e')

    const bareRemote = join(sandboxRoot, 'remote.git')
    initBareRemote(bareRemote)
    assertSuccess(runGit(['remote', 'add', 'origin', bareRemote], repoRoot), 'git remote add origin')

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
    assertSuccess(upgradeResult, 'memorytree upgrade for gh-pages deploy')

    writeFileSync(join(repoRoot, '.gitignore'), 'Memory/07_reports/\n', 'utf-8')
    commitAll(repoRoot, 'chore: scaffold memorytree workspace')

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: true,
      ghPagesBranch: 'gh-pages',
      cname: 'memory.example.com',
      reportBaseUrl: 'https://memory.example.com',
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'memorytree/e2e',
      stem: 'heartbeat-gh-pages',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once with gh-pages deploy')

    expect(runGitDir(['rev-parse', 'gh-pages'], bareRemote).status).toBe(0)
    expect(runGitDir(['show', 'gh-pages:CNAME'], bareRemote).stdout.trim()).toBe('memory.example.com')

    const tree = runGitDir(['ls-tree', '--name-only', '-r', 'gh-pages'], bareRemote)
    expect(tree.stdout).toContain('index.html')
    expect(tree.stdout).toContain('transcripts/index.html')
    expect(tree.stdout).toContain('feed.xml')

    const feed = runGitDir(['show', 'gh-pages:feed.xml'], bareRemote)
    expect(feed.stdout).toContain('https://memory.example.com')
  })

  it('keeps heartbeat successful when webhook delivery is rejected', () => {
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
    assertSuccess(upgradeResult, 'memorytree upgrade for webhook resilience')

    writeFileSync(join(repoRoot, '.gitignore'), 'Memory/07_reports/\n', 'utf-8')
    commitAll(repoRoot, 'chore: scaffold memorytree workspace')

    writeConfig(homeDir, {
      projectPath: repoRoot,
      autoPush: false,
      generateReport: true,
      webhookUrl: 'https://127.0.0.1/hook',
      reportBaseUrl: 'https://memory.example.com',
    })

    writeCodexTranscript({
      homeDir,
      repoPath: repoRoot,
      branch: 'memorytree/e2e',
      stem: 'heartbeat-webhook',
    })

    const result = runCli(['daemon', 'run-once'], {
      cwd: repoRoot,
      env: isolatedEnv(homeDir),
    })
    assertSuccess(result, 'memorytree daemon run-once with rejected webhook')

    expect(existsSync(join(repoRoot, 'Memory', '07_reports', 'index.html'))).toBe(true)
    expect(runGit(['log', '-1', '--pretty=%s'], repoRoot).stdout.trim()).toBe(
      'memorytree(transcripts): import 1 transcript(s)',
    )
  })
})

function runCli(args: readonly string[], options: RunOptions = {}): CommandResult {
  return runCommand(process.execPath, [cliPath, ...args], options)
}

function runGit(args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): CommandResult {
  return runCommand('git', args, { cwd, env })
}

function runGitDir(args: readonly string[], gitDir: string): CommandResult {
  return runCommand('git', ['--git-dir', gitDir, ...args], {})
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

async function startCli(
  args: readonly string[],
  options: RunOptions & { waitForUrl?: string } = {},
): Promise<RunningProcess> {
  let stdout = ''
  let stderr = ''

  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  liveProcesses.push(child)
  child.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })

  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error([
        `process exited early with code ${String(child.exitCode)}`,
        'stdout:',
        stdout.trim(),
        'stderr:',
        stderr.trim(),
      ].join('\n'))
    }

    if (!options.waitForUrl) {
      return stdout.length > 0
    }

    try {
      const response = await fetch(options.waitForUrl)
      return response.status === 200
    } catch {
      return false
    }
  }, 15_000)

  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
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

function initBareRemote(root: string): void {
  assertSuccess(
    runCommand('git', ['init', '--bare', root], { cwd: sandboxRoot }),
    'git init --bare',
  )
}

function commitAll(root: string, message: string): void {
  assertSuccess(runGit(['add', '.'], root), 'git add .')
  assertSuccess(runGit(['commit', '-m', message], root), `git commit ${message}`)
}

function detrackManagedCache(root: string): void {
  const gitignorePath = join(root, '.gitignore')
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : ''
  const lines = existing
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(Boolean)

  for (const entry of ['AGENTS.md', 'Memory/**']) {
    if (!lines.includes(entry)) {
      lines.push(entry)
    }
  }

  writeFileSync(gitignorePath, `${lines.join('\n')}\n`, 'utf-8')
  assertSuccess(runGit(['rm', '--cached', 'AGENTS.md'], root), 'git rm --cached AGENTS.md')
  assertSuccess(runGit(['rm', '--cached', '-r', 'Memory'], root), 'git rm --cached Memory')
  assertSuccess(runGit(['add', '.gitignore'], root), 'git add .gitignore for managed de-track')
  assertSuccess(runGit(['commit', '-m', 'chore: de-track managed cache'], root), 'git commit managed de-track')
}

function writeConfig(
  homePath: string,
  options: {
    projectPath: string
    autoPush: boolean
    generateReport: boolean
    ghPagesBranch?: string
    cname?: string
    webhookUrl?: string
    reportBaseUrl?: string
    reportPort?: number
    rawUploadPermission?: 'not-set' | 'approved' | 'denied'
  },
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
    `gh_pages_branch = "${escapeToml(options.ghPagesBranch ?? '')}"`,
    `cname = "${escapeToml(options.cname ?? '')}"`,
    `webhook_url = "${escapeToml(options.webhookUrl ?? '')}"`,
    `report_base_url = "${escapeToml(options.reportBaseUrl ?? '')}"`,
    `report_port = ${String(options.reportPort ?? 10010)}`,
    'watch_dirs = []',
    '',
    '[[projects]]',
    `path = "${escapeToml(toPosix(options.projectPath))}"`,
    'name = "repo"',
    `raw_upload_permission = "${escapeToml(options.rawUploadPermission ?? 'not-set')}"`,
    '',
  ].join('\n')

  writeFileSync(join(configDir, 'config.toml'), configToml, 'utf-8')
}

function writeCodexTranscript(
  options: {
    homeDir: string
    repoPath: string
    branch: string
    stem: string
    startedAt?: string
    title?: string
    userText?: string
    assistantText?: string
  },
): string {
  const transcriptDir = join(options.homeDir, '.codex', 'sessions', 'e2e')
  mkdirSync(transcriptDir, { recursive: true })

  const startedAt = options.startedAt ?? '2026-03-17T10:30:00Z'
  const transcriptPath = join(transcriptDir, `${options.stem}.jsonl`)
  const repoPath = toPosix(options.repoPath)
  const records = [
    {
      type: 'session_meta',
      payload: {
        id: `sess-${options.stem}`,
        title: options.title ?? `E2E ${options.stem}`,
        cwd: repoPath,
        git: { branch: options.branch },
        timestamp: startedAt,
      },
    },
    {
      type: 'response_item',
      timestamp: offsetIso(startedAt, 1),
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: options.userText ?? 'Capture this coding session.' }],
      },
    },
    {
      type: 'response_item',
      timestamp: offsetIso(startedAt, 2),
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: options.assistantText ?? 'Captured and indexed.' }],
      },
    },
    {
      type: 'response_item',
      timestamp: offsetIso(startedAt, 3),
      payload: {
        type: 'function_call',
        name: 'read_file',
        arguments: { path: 'README.md' },
      },
    },
    {
      type: 'response_item',
      timestamp: offsetIso(startedAt, 4),
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

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('failed to allocate port'))
        return
      }

      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolvePort(address.port)
      })
    })
  })
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  try {
    child.kill()
  } catch {
    return
  }

  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 2_000)
    const done = () => {
      clearTimeout(timeout)
      resolve()
    }
    child.once('exit', done)
    child.once('close', done)
  })
}

async function removeTreeWithRetry(root: string): Promise<void> {
  const deadline = Date.now() + 5_000

  // Windows can keep directory handles alive briefly after child.exit.
  let removed = false
  while (!removed) {
    try {
      rmSync(root, { recursive: true, force: true })
      removed = true
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException
      if (!err.code || Date.now() >= deadline) {
        throw error
      }

      const code = String(err.code)
      if (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM') {
        throw error
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return
      }
      lastError = null
    } catch (error) {
      lastError = error
    }

    await new Promise(resolveSleep => setTimeout(resolveSleep, intervalMs))
  }

  if (lastError instanceof Error) {
    throw lastError
  }
  if (lastError !== null) {
    throw new Error(String(lastError))
  }
  throw new Error('timed out waiting for condition')
}

function offsetIso(baseIso: string, seconds: number): string {
  return new Date(Date.parse(baseIso) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
