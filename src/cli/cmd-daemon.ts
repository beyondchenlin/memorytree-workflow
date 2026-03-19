/**
 * CLI: memorytree daemon install|uninstall|run-once|watch|status
 * Port of scripts/memorytree_daemon.py
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { platform } from 'node:process'

import {
  DEFAULT_MEMORY_BRANCH,
  configPath,
  findProjectForPath,
  intervalToSeconds,
  loadConfig,
  saveConfig,
  upsertProject,
} from '../heartbeat/config.js'
import { readLockPid } from '../heartbeat/lock.js'
import {
  defaultProjectWorktreePath,
  defaultProjectWorktreeBranch,
  ensureBranchUpstream,
  ensureProjectWorktree,
  isValidWorktreeBranchName,
} from '../heartbeat/worktree.js'
import { execCommand } from '../utils/exec.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_NAME = 'MemoryTree Heartbeat'
const LAUNCHD_LABEL = 'com.memorytree.heartbeat'

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export function cmdInstall(options: { interval?: string; autoPush?: string }): number {
  let config = loadConfig()

  if (options.interval) {
    config = { ...config, heartbeat_interval: options.interval }
  }
  if (options.autoPush) {
    config = { ...config, auto_push: options.autoPush === 'true' }
  }

  saveConfig(config)
  const seconds = intervalToSeconds(config.heartbeat_interval)
  const scriptPath = heartbeatScriptPath()

  const sys = platform
  if (sys === 'linux') return installCron(scriptPath, seconds)
  if (sys === 'darwin') return installLaunchd(scriptPath, seconds)
  if (sys === 'win32') return installSchtasks(scriptPath, seconds)

  process.stderr.write(`Unsupported platform: ${sys}\n`)
  return 1
}

export function cmdUninstall(): number {
  const sys = platform
  if (sys === 'linux') return uninstallCron()
  if (sys === 'darwin') return uninstallLaunchd()
  if (sys === 'win32') return uninstallSchtasks()

  process.stderr.write(`Unsupported platform: ${sys}\n`)
  return 1
}

export async function cmdRunOnce(options: { root?: string; force?: boolean } = {}): Promise<number> {
  const { main } = await import('../heartbeat/heartbeat.js')
  return main(options)
}

export async function cmdWatch(options: { interval?: string }): Promise<number> {
  const config = loadConfig()
  const intervalStr = options.interval ?? config.heartbeat_interval
  const seconds = intervalToSeconds(intervalStr)
  const { main } = await import('../heartbeat/heartbeat.js')

  process.stdout.write(`Watch mode: running heartbeat every ${seconds}s. Press Ctrl+C to stop.\n`)
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await main()
      await new Promise(r => setTimeout(r, seconds * 1000))
    }
  } catch {
    process.stdout.write('\nWatch mode stopped.\n')
  }
  return 0
}

export function cmdStatus(): number {
  const sys = platform

  let registered = false
  if (sys === 'linux') registered = isCronRegistered()
  else if (sys === 'darwin') registered = isLaunchdRegistered()
  else if (sys === 'win32') registered = isSchtasksRegistered()

  const platformName = sys === 'darwin' ? 'Darwin' : sys === 'win32' ? 'Windows' : 'Linux'
  process.stdout.write(`Platform:   ${platformName}\n`)
  process.stdout.write(`Registered: ${registered ? 'yes' : 'no'}\n`)

  const pid = readLockPid()
  if (pid !== null) {
    process.stdout.write(`Lock:       held by PID ${pid}\n`)
  } else {
    process.stdout.write('Lock:       not held\n')
  }

  if (existsSync(configPath())) {
    const config = loadConfig()
    process.stdout.write(`Interval:   ${config.heartbeat_interval}\n`)
    process.stdout.write(`Auto-push:  ${config.auto_push}\n`)
    process.stdout.write(`Projects:   ${config.projects.length}\n`)
  } else {
    process.stdout.write('Config:     not found (using defaults)\n')
  }

  return 0
}

export function cmdRegisterProject(options: {
  root: string
  name?: string
  worktree?: string
  branch?: string
  quickStart?: boolean
  heartbeatInterval?: string
  refreshInterval?: string
  autoPush?: string
  generateReport?: string
  reportPort?: string
}): number {
  const root = resolve(options.root)
  const config = loadConfig()

  if (options.quickStart && options.branch !== undefined) {
    process.stderr.write('Quick Start uses the default memorytree branch. Omit --branch to customize it.\n')
    return 1
  }

  const requestedBranch = options.quickStart
    ? defaultProjectWorktreeBranch()
    : options.branch ?? DEFAULT_MEMORY_BRANCH
  if (!isValidWorktreeBranchName(requestedBranch)) {
    process.stderr.write(`Invalid MemoryTree branch name: ${requestedBranch}\n`)
    return 1
  }

  const heartbeatInterval = options.quickStart
    ? '5m'
    : options.heartbeatInterval ?? config.heartbeat_interval
  const refreshInterval = options.quickStart
    ? '30m'
    : options.refreshInterval ?? '30m'
  const autoPush = options.quickStart
    ? true
    : parseOptionalBoolean(options.autoPush) ?? config.auto_push
  const generateReport = options.quickStart
    ? true
    : parseOptionalBoolean(options.generateReport) ?? config.generate_report

  const requestedPort = options.reportPort ? parseInt(options.reportPort, 10) : NaN
  const reportPort = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : config.report_port

  const updated = upsertProject(config, root, {
    name: options.name ?? basename(root),
    development_path: root,
    memory_path: options.worktree ? resolve(options.worktree) : defaultProjectWorktreePath(root),
    memory_branch: requestedBranch,
    heartbeat_interval: heartbeatInterval,
    refresh_interval: refreshInterval,
    auto_push: autoPush,
    generate_report: generateReport,
    report_port: reportPort,
  })

  const project = findProjectForPath(updated, root)
  if (!project) {
    process.stderr.write(`Failed to register project: ${root}\n`)
    return 1
  }

  const worktree = ensureProjectWorktree(project)
  saveConfig(updated)
  let upstream: ReturnType<typeof ensureBranchUpstream> | null = null
  let upstreamError = ''
  if (project.auto_push) {
    try {
      upstream = ensureBranchUpstream(project.memory_path, worktree.branch)
    } catch (error: unknown) {
      upstreamError = error instanceof Error ? error.message : String(error)
    }
  }

  process.stdout.write(`Registered project: ${project.name}\n`)
  process.stdout.write(`Development path: ${project.development_path}\n`)
  process.stdout.write(`Memory path: ${project.memory_path}\n`)
  process.stdout.write(`Memory branch: ${project.memory_branch}\n`)
  process.stdout.write(`Heartbeat interval: ${project.heartbeat_interval}\n`)
  process.stdout.write(`Refresh interval: ${project.refresh_interval}\n`)
  process.stdout.write(`Auto-push: ${project.auto_push}\n`)
  process.stdout.write(`Generate report: ${project.generate_report}\n`)
  process.stdout.write(`Worktree branch: ${worktree.branch}\n`)
  process.stdout.write(`Worktree created: ${worktree.created ? 'yes' : 'no'}\n`)
  if (upstreamError) {
    process.stderr.write(`Upstream configured: failed (${upstreamError})\n`)
  } else if (upstream === null) {
    process.stdout.write('Upstream configured: skipped (auto_push disabled)\n')
  } else if (upstream.remote === null) {
    process.stdout.write('Upstream configured: no remote available\n')
  } else {
    process.stdout.write(`Upstream configured: ${upstream.created ? 'yes' : 'already'} (${upstream.remote}/${worktree.branch})\n`)
  }
  return upstreamError ? 1 : 0
}

// ---------------------------------------------------------------------------
// Linux (cron)
// ---------------------------------------------------------------------------

function installCron(scriptPath: string, seconds: number): number {
  if (isCronRegistered()) {
    process.stderr.write("Heartbeat is already registered in cron. Use 'uninstall' first.\n")
    return 1
  }

  const minutes = Math.max(1, Math.floor(seconds / 60))
  const logDir = resolve(homedir(), '.memorytree', 'logs')
  mkdirSync(logDir, { recursive: true })

  const cronLine = `*/${minutes} * * * * node "${scriptPath}" daemon run-once >> "${resolve(logDir, 'heartbeat-cron.log')}" 2>&1 # memorytree`
  const existing = getCrontab()
  const newCrontab = existing.trim()
    ? existing.trimEnd() + '\n' + cronLine + '\n'
    : cronLine + '\n'

  try {
    const tmpFile = resolve(homedir(), '.memorytree', '.crontab.tmp')
    writeFileSync(tmpFile, newCrontab)
    execCommand('crontab', [tmpFile])
    unlinkSync(tmpFile)
  } catch {
    process.stderr.write('Failed to install cron job.\n')
    return 1
  }

  process.stdout.write(`Heartbeat registered in cron (every ${minutes}m).\n`)
  return 0
}

function uninstallCron(): number {
  const existing = getCrontab()
  const filtered = existing.split('\n').filter(line => !line.includes('memorytree')).join('\n') + '\n'
  try {
    const tmpFile = resolve(homedir(), '.memorytree', '.crontab.tmp')
    mkdirSync(dirname(tmpFile), { recursive: true })
    writeFileSync(tmpFile, filtered)
    execCommand('crontab', [tmpFile])
    unlinkSync(tmpFile)
  } catch {
    // best effort
  }
  process.stdout.write('Heartbeat removed from cron.\n')
  return 0
}

export function isCronRegistered(): boolean {
  return getCrontab().includes('memorytree')
}

function getCrontab(): string {
  try {
    return execCommand('crontab', ['-l'], { allowFailure: true })
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// macOS (launchd)
// ---------------------------------------------------------------------------

function launchdPlistPath(): string {
  return resolve(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
}

function installLaunchd(scriptPath: string, seconds: number): number {
  const plistPath = launchdPlistPath()
  if (existsSync(plistPath)) {
    process.stderr.write("Heartbeat plist already exists. Use 'uninstall' first.\n")
    return 1
  }

  const logDir = resolve(homedir(), '.memorytree', 'logs')
  mkdirSync(logDir, { recursive: true })

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>node</string>
        <string>${scriptPath}</string>
        <string>daemon</string>
        <string>run-once</string>
    </array>
    <key>StartInterval</key>
    <integer>${seconds}</integer>
    <key>StandardOutPath</key>
    <string>${resolve(logDir, 'heartbeat-launchd.log')}</string>
    <key>StandardErrorPath</key>
    <string>${resolve(logDir, 'heartbeat-launchd.log')}</string>
</dict>
</plist>
`
  mkdirSync(dirname(plistPath), { recursive: true })
  writeFileSync(plistPath, plistContent, 'utf-8')

  try {
    execCommand('launchctl', ['load', plistPath])
  } catch {
    process.stderr.write('Failed to load plist.\n')
    return 1
  }

  process.stdout.write(`Heartbeat registered via launchd (every ${seconds}s).\n`)
  return 0
}

function uninstallLaunchd(): number {
  const plistPath = launchdPlistPath()
  if (existsSync(plistPath)) {
    try { execCommand('launchctl', ['unload', plistPath], { allowFailure: true }) } catch { /* ignore */ }
    try { unlinkSync(plistPath) } catch { /* ignore */ }
  }
  process.stdout.write('Heartbeat removed from launchd.\n')
  return 0
}

export function isLaunchdRegistered(): boolean {
  return existsSync(launchdPlistPath())
}

// ---------------------------------------------------------------------------
// Windows (Task Scheduler)
// ---------------------------------------------------------------------------

// Write a VBScript launcher that runs node silently (no console window).
// wscript.exe /B runs in batch mode (suppresses script error popups).
// VBScript Run(..., 0, False): 0 = SW_HIDE hides the window; False = fire-and-forget.
// Written as UTF-16 LE with BOM so wscript.exe handles non-ASCII paths (e.g. Chinese
// usernames) correctly on all Windows versions.
export function vbsLauncherPath(): string {
  return resolve(homedir(), '.memorytree', 'heartbeat-launcher.vbs')
}

export function writeVbsLauncher(scriptPath: string): string {
  const vbsPath = vbsLauncherPath()
  mkdirSync(dirname(vbsPath), { recursive: true })
  // Inside VBScript strings, double-quote is escaped as ""
  const escapedScript = scriptPath.replace(/"/g, '""')
  // Use the full node binary path so the launcher works even when Task Scheduler's
  // PATH differs from the user's shell (e.g. nvm/fnm environments).
  const escapedNode = process.execPath.replace(/"/g, '""')
  const content = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run """${escapedNode}"" ""${escapedScript}"" daemon run-once", 0, False`,
  ].join('\r\n') + '\r\n'
  // UTF-16 LE BOM: recognised by wscript.exe on all Windows versions and preserves
  // non-ASCII characters (e.g. Chinese home directory paths) without corruption.
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')])
  writeFileSync(vbsPath, buf)
  return vbsPath
}

function installSchtasks(scriptPath: string, seconds: number): number {
  if (isSchtasksRegistered()) {
    process.stderr.write("Heartbeat is already registered in Task Scheduler. Use 'uninstall' first.\n")
    return 1
  }

  const minutes = Math.max(1, Math.floor(seconds / 60))
  const vbsPath = writeVbsLauncher(scriptPath)
  const trCommand = `wscript.exe /B "${vbsPath}"`

  try {
    execCommand('schtasks', [
      '/create', '/tn', TASK_NAME, '/sc', 'minute', '/mo', String(minutes),
      '/tr', trCommand, '/f',
    ])
  } catch {
    // schtasks failed — remove the launcher file we just wrote to keep state clean
    try { unlinkSync(vbsPath) } catch { /* ignore */ }
    process.stderr.write('Failed to create scheduled task.\n')
    return 1
  }

  process.stdout.write(`Heartbeat registered in Task Scheduler (every ${minutes}m).\n`)
  return 0
}

function uninstallSchtasks(): number {
  try {
    execCommand('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], { allowFailure: true })
  } catch {
    // best effort
  }
  const vbsPath = vbsLauncherPath()
  if (existsSync(vbsPath)) {
    try { unlinkSync(vbsPath) } catch { /* ignore */ }
  }
  process.stdout.write('Heartbeat removed from Task Scheduler.\n')
  return 0
}

export function isSchtasksRegistered(): boolean {
  try {
    execCommand('schtasks', ['/query', '/tn', TASK_NAME])
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function heartbeatScriptPath(): string {
  // Use process.argv[1] which is the actual script being executed,
  // more reliable than import.meta.url which varies between tsx and bundled output
  const scriptArg = process.argv[1] ?? ''
  if (scriptArg && scriptArg.endsWith('cli.js')) {
    return resolve(scriptArg)
  }
  // Fallback: resolve relative to import.meta.url
  const urlPath = new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')
  return resolve(dirname(urlPath), '..', '..', 'dist', 'cli.js')
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}
