/**
 * CLI: memorytree daemon install|uninstall|run-once|watch|status
 * Port of scripts/memorytree_daemon.py
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { platform } from 'node:process'

import { configPath, intervalToSeconds, loadConfig, saveConfig } from '../heartbeat/config.js'
import { readLockPid } from '../heartbeat/lock.js'
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

export async function cmdRunOnce(): Promise<number> {
  const { main } = await import('../heartbeat/heartbeat.js')
  return main()
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
    execCommand('crontab', ['-'], { allowFailure: false })
    // Use stdin approach - write temp file and pipe
    const tmpFile = resolve(homedir(), '.memorytree', '.crontab.tmp')
    writeFileSync(tmpFile, newCrontab)
    execCommand('bash', ['-c', `crontab "${tmpFile}"`])
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
    execCommand('bash', ['-c', `crontab "${tmpFile}"`])
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

function installSchtasks(scriptPath: string, seconds: number): number {
  if (isSchtasksRegistered()) {
    process.stderr.write("Heartbeat is already registered in Task Scheduler. Use 'uninstall' first.\n")
    return 1
  }

  const minutes = Math.max(1, Math.floor(seconds / 60))
  const trCommand = `node "${scriptPath}" daemon run-once`

  try {
    execCommand('schtasks', [
      '/create', '/tn', TASK_NAME, '/sc', 'minute', '/mo', String(minutes),
      '/tr', trCommand, '/f',
    ])
  } catch {
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
  // In the compiled distribution, this is dist/cli.js
  return resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..', 'dist', 'cli.js')
}
