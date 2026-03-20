import { resolve } from 'node:path'

import { findProjectForPath, loadConfig, type ProjectEntry } from '../heartbeat/config.js'
import {
  disableManagedCaddy,
  enableManagedCaddy,
  isCaddyInstalled,
  loadManagedCaddyStatus,
  managedCaddyStartCommand,
} from '../caddy/manager.js'

export async function cmdCaddyEnable(options: { root: string }): Promise<number> {
  const project = resolveProject(options.root)
  if (project === null) {
    process.stderr.write(
      'Project not found in ~/.memorytree/config.toml. Run `memorytree daemon quick-start --root .` first.\n',
    )
    return 1
  }

  if (!isCaddyInstalled()) {
    process.stderr.write('Caddy is not installed or not available on PATH. Install Caddy first.\n')
    return 1
  }

  try {
    const result = enableManagedCaddy(project)
    process.stdout.write(`Caddy enabled for project: ${project.name}\n`)
    process.stdout.write(`Port: ${String(project.report_port)}\n`)
    process.stdout.write(`Exposure: ${project.report_exposure}\n`)
    process.stdout.write(`Report directory: ${result.reportDir}\n`)
    process.stdout.write(`Main config: ${result.mainConfigPath}\n`)
    process.stdout.write(`Project fragment: ${result.fragmentPath}\n`)
    for (const url of result.localUrls) {
      process.stdout.write(`Local URL: ${url}\n`)
    }
    for (const url of result.lanUrls) {
      process.stdout.write(`LAN URL: ${url}\n`)
    }
    return 0
  } catch (error: unknown) {
    process.stderr.write(`${formatError(error)}\n`)
    return 1
  }
}

export async function cmdCaddyDisable(options: { root: string }): Promise<number> {
  const project = resolveProject(options.root)
  if (project === null) {
    process.stderr.write(
      'Project not found in ~/.memorytree/config.toml. Run `memorytree daemon quick-start --root .` first.\n',
    )
    return 1
  }

  if (!isCaddyInstalled()) {
    process.stderr.write('Caddy is not installed or not available on PATH. Install Caddy first.\n')
    return 1
  }

  try {
    const result = disableManagedCaddy(project)
    process.stdout.write(`Caddy disabled for project: ${project.name}\n`)
    process.stdout.write(`Main config: ${result.mainConfigPath}\n`)
    process.stdout.write(`Project fragment removed: ${result.fragmentPath}\n`)
    return 0
  } catch (error: unknown) {
    process.stderr.write(`${formatError(error)}\n`)
    return 1
  }
}

export async function cmdCaddyStatus(options: { root: string }): Promise<number> {
  const project = resolveProject(options.root)
  if (project === null) {
    process.stderr.write(
      'Project not found in ~/.memorytree/config.toml. Run `memorytree daemon quick-start --root .` first.\n',
    )
    return 1
  }

  const status = await loadManagedCaddyStatus(project)
  process.stdout.write(`Caddy installed: ${yesNo(status.installed)}\n`)
  process.stdout.write(`Caddy running: ${yesNo(status.running)}\n`)
  process.stdout.write(`Using MemoryTree Caddyfile: ${yesNoOrUnknown(status.usingManagedConfig)}\n`)
  process.stdout.write(`Project registered: ${yesNo(status.fragmentExists)}\n`)
  process.stdout.write(`Port: ${String(status.port)}\n`)
  process.stdout.write(`Exposure: ${status.exposure}\n`)
  process.stdout.write(`Report directory: ${status.reportDir}\n`)
  process.stdout.write(`Main config: ${status.mainConfigPath}\n`)
  process.stdout.write(`Project fragment: ${status.fragmentPath}\n`)
  for (const url of status.localUrls) {
    process.stdout.write(`Local URL: ${url}\n`)
  }
  for (const url of status.lanUrls) {
    process.stdout.write(`LAN URL: ${url}\n`)
  }
  if (!status.installed || !status.running || status.usingManagedConfig !== true) {
    process.stdout.write(`Managed start command: ${managedCaddyStartCommand()}\n`)
  }
  return 0
}

function resolveProject(root: string): ProjectEntry | null {
  const config = loadConfig()
  return findProjectForPath(config, resolve(root))
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

function yesNoOrUnknown(value: boolean | null): string {
  if (value === null) return 'unknown'
  return yesNo(value)
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}
