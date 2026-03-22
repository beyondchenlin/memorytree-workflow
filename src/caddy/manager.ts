import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

import { memorytreeRoot, type ProjectEntry } from '../heartbeat/config.js'
import { toPosixPath } from '../utils/path.js'
import { execCommand } from '../utils/exec.js'

const CADDY_ADMIN_URL = 'http://127.0.0.1:2019'
const CADDY_ADMIN_ORIGIN = 'http://127.0.0.1:2019'

export interface ManagedCaddyPaths {
  readonly rootDir: string
  readonly sitesDir: string
  readonly mainConfigPath: string
  readonly fragmentPath: string
}

export interface ManagedCaddyStatus {
  readonly installed: boolean
  readonly running: boolean
  readonly usingManagedConfig: boolean | null
  readonly mainConfigPath: string
  readonly mainConfigExists: boolean
  readonly fragmentPath: string
  readonly fragmentExists: boolean
  readonly port: number
  readonly exposure: ProjectEntry['report_exposure']
  readonly reportDir: string
  readonly localUrls: readonly string[]
  readonly lanUrls: readonly string[]
}

export interface ManagedCaddyEnableResult {
  readonly mainConfigPath: string
  readonly fragmentPath: string
  readonly reportDir: string
  readonly localUrls: readonly string[]
  readonly lanUrls: readonly string[]
}

export function managedCaddyPaths(projectId: string): ManagedCaddyPaths {
  const rootDir = resolve(memorytreeRoot(), 'caddy')
  const sitesDir = resolve(rootDir, 'sites')
  return {
    rootDir,
    sitesDir,
    mainConfigPath: resolve(rootDir, 'Caddyfile'),
    fragmentPath: resolve(sitesDir, `${projectId}.caddy`),
  }
}

export function projectReportDir(project: Pick<ProjectEntry, 'development_path'>): string {
  return resolve(project.development_path, 'Memory', '07_reports')
}

export function renderManagedMainCaddyfile(): string {
  return [
    '# Managed by MemoryTree. Do not edit by hand.',
    '{',
    '  auto_https off',
    '}',
    '',
    'import sites/*.caddy',
    '',
  ].join('\n')
}

export function renderManagedProjectFragment(
  project: Pick<ProjectEntry, 'id' | 'name' | 'report_port' | 'report_exposure'>,
  reportDir: string,
): string {
  const lines = [
    '# Managed by MemoryTree. Do not edit by hand.',
    `# project_id: ${project.id}`,
    `# project_name: ${project.name}`,
    `# report_port: ${String(project.report_port)}`,
    `# report_exposure: ${project.report_exposure}`,
    '',
    managedSiteAddress(project.report_port, project.report_exposure),
    '{',
  ]

  if (project.report_exposure === 'local') {
    lines.push('  bind 127.0.0.1 [::1]')
  }

  lines.push(`  root * ${quoteForCaddyPath(reportDir)}`)
  lines.push('  file_server')
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

export function isCaddyInstalled(): boolean {
  try {
    execCommand('caddy', ['version'])
    return true
  } catch {
    return false
  }
}

export function findManagedPortConflict(projectId: string, reportPort: number): string | null {
  const { sitesDir, fragmentPath } = managedCaddyPaths(projectId)
  if (!existsSync(sitesDir)) return null

  for (const entry of readdirSync(sitesDir)) {
    if (!entry.endsWith('.caddy')) continue
    const currentPath = resolve(sitesDir, entry)
    if (currentPath === fragmentPath) continue

    const text = readFileSync(currentPath, 'utf-8')
    const portMatch = text.match(/^# report_port:\s*(\d+)\s*$/m)
    if (!portMatch) continue

    const currentPort = parseInt(portMatch[1]!, 10)
    if (currentPort !== reportPort) continue

    const projectMatch = text.match(/^# project_id:\s*(.+)\s*$/m)
    return projectMatch?.[1]?.trim() || entry.replace(/\.caddy$/i, '')
  }

  return null
}

export function enableManagedCaddy(project: ProjectEntry): ManagedCaddyEnableResult {
  const paths = managedCaddyPaths(project.id)
  const conflictProjectId = findManagedPortConflict(project.id, project.report_port)
  if (conflictProjectId !== null) {
    throw new Error(
      `Port ${String(project.report_port)} is already used by another managed Caddy site (${conflictProjectId}). ` +
      'Change this project\'s report_port first, then rerun the command.',
    )
  }

  mkdirSync(paths.rootDir, { recursive: true })
  mkdirSync(paths.sitesDir, { recursive: true })

  const reportDir = projectReportDir(project)
  mkdirSync(reportDir, { recursive: true })

  writeTextIfChanged(paths.mainConfigPath, renderManagedMainCaddyfile())
  writeTextIfChanged(paths.fragmentPath, renderManagedProjectFragment(project, reportDir))
  validateManagedCaddyConfig(paths.mainConfigPath)
  try {
    reloadManagedCaddy(paths.mainConfigPath)
  } catch (error: unknown) {
    throw new Error(
      `Caddy config files were updated, but reload failed. ${formatExecError(error)} ` +
      `Start Caddy with: ${managedCaddyStartCommand()}`,
    )
  }

  return {
    mainConfigPath: paths.mainConfigPath,
    fragmentPath: paths.fragmentPath,
    reportDir,
    localUrls: localUrlsForProject(project.report_port),
    lanUrls: lanUrlsForProject(project.report_port, project.report_exposure),
  }
}

export function disableManagedCaddy(project: Pick<ProjectEntry, 'id' | 'report_port' | 'report_exposure'>): ManagedCaddyEnableResult {
  const paths = managedCaddyPaths(project.id)
  if (existsSync(paths.fragmentPath)) {
    rmSync(paths.fragmentPath, { force: true })
  }

  if (existsSync(paths.mainConfigPath)) {
    validateManagedCaddyConfig(paths.mainConfigPath)
    try {
      reloadManagedCaddy(paths.mainConfigPath)
    } catch (error: unknown) {
      throw new Error(
        `The project fragment was removed, but Caddy reload failed. ${formatExecError(error)} ` +
        `Start Caddy with: ${managedCaddyStartCommand()}`,
      )
    }
  }

  return {
    mainConfigPath: paths.mainConfigPath,
    fragmentPath: paths.fragmentPath,
    reportDir: '',
    localUrls: localUrlsForProject(project.report_port),
    lanUrls: lanUrlsForProject(project.report_port, project.report_exposure),
  }
}

export async function loadManagedCaddyStatus(project: ProjectEntry): Promise<ManagedCaddyStatus> {
  const paths = managedCaddyPaths(project.id)
  const installed = isCaddyInstalled()
  const mainConfigExists = existsSync(paths.mainConfigPath)
  const fragmentExists = existsSync(paths.fragmentPath)
  const runningConfigText = installed ? await fetchRunningCaddyConfigText() : null
  const running = runningConfigText !== null

  let usingManagedConfig: boolean | null = null
  if (installed && running && mainConfigExists) {
    const managedConfigText = adaptManagedCaddyConfig(paths.mainConfigPath)
    usingManagedConfig = stableJsonFromText(managedConfigText) === stableJsonFromText(runningConfigText)
  }

  return {
    installed,
    running,
    usingManagedConfig,
    mainConfigPath: paths.mainConfigPath,
    mainConfigExists,
    fragmentPath: paths.fragmentPath,
    fragmentExists,
    port: project.report_port,
    exposure: project.report_exposure,
    reportDir: projectReportDir(project),
    localUrls: localUrlsForProject(project.report_port),
    lanUrls: lanUrlsForProject(project.report_port, project.report_exposure),
  }
}

export function managedCaddyStartCommand(): string {
  const mainConfigPath = managedCaddyPaths('placeholder').mainConfigPath
  return `caddy run --config "${mainConfigPath}" --adapter caddyfile`
}

function managedSiteAddress(reportPort: number, exposure: ProjectEntry['report_exposure']): string {
  if (exposure === 'lan') {
    return `http://:${String(reportPort)}`
  }
  return `http://127.0.0.1:${String(reportPort)}, http://localhost:${String(reportPort)}`
}

function quoteForCaddyPath(value: string): string {
  const normalized = toPosixPath(resolve(value)).replace(/"/g, '\\"')
  return `"${normalized}"`
}

function writeTextIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, 'utf-8') === content) {
    return
  }
  writeFileSync(path, content, 'utf-8')
}

function validateManagedCaddyConfig(mainConfigPath: string): void {
  execCommand('caddy', ['adapt', '--config', mainConfigPath, '--adapter', 'caddyfile', '--validate'], {
    allowFailure: false,
  })
}

function reloadManagedCaddy(mainConfigPath: string): void {
  execCommand('caddy', ['reload', '--config', mainConfigPath, '--adapter', 'caddyfile'])
}

function adaptManagedCaddyConfig(mainConfigPath: string): string {
  return execCommand('caddy', ['adapt', '--config', mainConfigPath, '--adapter', 'caddyfile'])
}

async function fetchRunningCaddyConfigText(): Promise<string | null> {
  try {
    const response = await fetch(`${CADDY_ADMIN_URL}/config/`, {
      headers: {
        Origin: CADDY_ADMIN_ORIGIN,
      },
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

function stableJsonFromText(text: string | null): string | null {
  if (text === null) return null
  try {
    return JSON.stringify(sortJsonKeys(JSON.parse(text)))
  } catch {
    return null
  }
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortJsonKeys(item))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map(key => [key, sortJsonKeys((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

function localUrlsForProject(reportPort: number): string[] {
  return [
    `http://127.0.0.1:${String(reportPort)}/`,
    `http://localhost:${String(reportPort)}/`,
  ]
}

function lanUrlsForProject(
  reportPort: number,
  exposure: ProjectEntry['report_exposure'],
): string[] {
  if (exposure !== 'lan') return []

  const urls = new Set<string>()
  const interfaces = networkInterfaces()
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      urls.add(`http://${address.address}:${String(reportPort)}/`)
    }
  }
  return [...urls].sort((left, right) => left.localeCompare(right))
}

function formatExecError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}
