import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { platform as runtimePlatform } from 'node:process'

import { resolveSkillRoot } from '../utils/path.js'
import { execCommand } from '../utils/exec.js'

export interface DoctorCommandCandidate {
  readonly path: string
  readonly exists: boolean
  readonly size_bytes: number | null
  readonly suspicious: boolean
  readonly reasons: readonly string[]
}

export interface DoctorCommandReport {
  readonly command: string
  readonly resolved: boolean
  readonly healthy: boolean
  readonly selected_path: string | null
  readonly candidates: readonly DoctorCommandCandidate[]
  readonly warnings: readonly string[]
}

export interface DoctorReport {
  readonly ok: boolean
  readonly status: 'ok' | 'warning'
  readonly script_path: string
  readonly skill_root: string
  readonly dist_cli_path: string
  readonly dist_cli_exists: boolean
  readonly commands: readonly DoctorCommandReport[]
  readonly warnings: readonly string[]
  readonly fallback_command: string
  readonly fallback_quick_start_command: string
}

export interface BuildDoctorReportOptions {
  readonly commands?: readonly string[]
  readonly platformName?: NodeJS.Platform
  readonly scriptPath?: string
  readonly skillRoot?: string
  readonly candidatePathsByCommand?: Readonly<Record<string, readonly string[]>>
}

export function cmdDoctor(options: { format?: string } = {}): number {
  const format = (options.format ?? 'text').trim().toLowerCase()
  const report = buildDoctorReport()

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.ok ? 0 : 1
  }

  process.stdout.write(formatDoctorReport(report))
  return report.ok ? 0 : 1
}

export function buildDoctorReport(options: BuildDoctorReportOptions = {}): DoctorReport {
  const platformName = options.platformName ?? runtimePlatform
  const skillRoot = options.skillRoot ?? resolveSkillRoot(import.meta.url)
  const distCliPath = resolve(skillRoot, 'dist', 'cli.js')
  const rawScriptPath = options.scriptPath ?? process.argv[1]
  const scriptPath = resolve(rawScriptPath && rawScriptPath.trim() ? rawScriptPath : distCliPath)
  const commands = options.commands ?? ['memorytree']
  const commandReports = commands.map(command => inspectCommand(command, {
    platformName,
    candidatePaths: options.candidatePathsByCommand?.[command] ?? resolveCommandCandidates(command, platformName),
  }))

  const warnings: string[] = []
  if (!existsSync(distCliPath)) {
    warnings.push('Built CLI not found at dist/cli.js. Run npm run build before using the direct fallback command.')
  }
  if (commandReports.some(report => !report.healthy)) {
    warnings.push('Global command resolution is not fully healthy. Use the direct node fallback until PATH resolves cleanly.')
  }
  if (platformName === 'win32' && commandReports.some(report =>
    report.candidates.some(candidate => candidate.reasons.some(reason => reason.includes('VS Code install directory'))),
  )) {
    warnings.push('A Windows PATH entry inside the VS Code install directory is shadowing MemoryTree.')
  }

  const ok = warnings.length === 0
  const fallbackCommand = `node ${quoteForShell(distCliPath)}`

  return {
    ok,
    status: ok ? 'ok' : 'warning',
    script_path: scriptPath,
    skill_root: skillRoot,
    dist_cli_path: distCliPath,
    dist_cli_exists: existsSync(distCliPath),
    commands: commandReports,
    warnings,
    fallback_command: fallbackCommand,
    fallback_quick_start_command: `${fallbackCommand} daemon quick-start --root <target-repo>`,
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    'MemoryTree doctor',
    `Status: ${report.status}`,
    `CLI entry: ${report.script_path}`,
    `Skill root: ${report.skill_root}`,
    `Built CLI: ${report.dist_cli_exists ? report.dist_cli_path : `missing (${report.dist_cli_path})`}`,
  ]

  for (const command of report.commands) {
    lines.push('')
    lines.push(`Command: ${command.command}`)
    if (!command.resolved) {
      lines.push('  PATH resolution: not found')
    } else {
      lines.push(`  Selected: ${command.selected_path}`)
      command.candidates.forEach((candidate, index) => {
        const size = candidate.size_bytes === null ? 'size unknown' : `${String(candidate.size_bytes)} bytes`
        const status = candidate.suspicious ? 'warning' : 'ok'
        lines.push(`  ${String(index + 1)}. ${candidate.path} (${size}, ${status})`)
        for (const reason of candidate.reasons) {
          lines.push(`     - ${reason}`)
        }
      })
    }
    for (const warning of command.warnings) {
      lines.push(`  Warning: ${warning}`)
    }
  }

  lines.push('')
  lines.push('Fallback command:')
  lines.push(`  ${report.fallback_quick_start_command}`)

  if (report.warnings.length > 0) {
    lines.push('')
    lines.push('Next steps:')
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`)
    }
    lines.push('  - Re-run npm link from the skill root if you expect a global memorytree command.')
  }

  return `${lines.join('\n')}\n`
}

function inspectCommand(
  command: string,
  options: {
    platformName: NodeJS.Platform
    candidatePaths: readonly string[]
  },
): DoctorCommandReport {
  const candidates = options.candidatePaths.map(path => inspectCandidate(path, command, options.platformName))
  const selected = candidates[0] ?? null
  const healthy = selected !== null && selected.exists && (selected.size_bytes ?? 0) > 0 && !selected.suspicious
  const warnings: string[] = []

  if (candidates.length === 0) {
    warnings.push(`${command} was not found on PATH.`)
  } else if (!healthy) {
    warnings.push(`The first PATH resolution for ${command} looks broken or unsafe.`)
    if (candidates.slice(1).some(candidate => candidate.exists && (candidate.size_bytes ?? 0) > 0 && !candidate.suspicious)) {
      warnings.push('A later candidate looks usable, but the shell will still hit the first one first.')
    }
  }

  return {
    command,
    resolved: candidates.length > 0,
    healthy,
    selected_path: selected?.path ?? null,
    candidates,
    warnings,
  }
}

function inspectCandidate(
  candidatePath: string,
  command: string,
  platformName: NodeJS.Platform,
): DoctorCommandCandidate {
  const path = resolve(stripOuterQuotes(candidatePath))
  const exists = existsSync(path)
  const size = exists ? statSync(path).size : null
  const reasons: string[] = []

  if (!exists) {
    reasons.push('resolved path does not exist')
  }
  if (size === 0) {
    reasons.push('resolved file is 0 bytes')
  }
  if (looksLikeVsCodeInstallPath(path, platformName)) {
    reasons.push('resolved path is inside the VS Code install directory')
  }
  if (platformName === 'win32' && basename(path).toLowerCase() === command.toLowerCase() && size === 0) {
    reasons.push('Windows is resolving the command to a bare empty file, not a working shim')
  }

  return {
    path,
    exists,
    size_bytes: size,
    suspicious: reasons.length > 0,
    reasons,
  }
}

function resolveCommandCandidates(command: string, platformName: NodeJS.Platform): string[] {
  if (platformName === 'win32') {
    return resolveWindowsCommandCandidates(command)
  }

  const raw = execCommand('which', ['-a', command], { allowFailure: true })
  return parseCandidateLines(raw)
}

function stripOuterQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1')
}

function looksLikeVsCodeInstallPath(path: string, platformName: NodeJS.Platform): boolean {
  if (platformName !== 'win32') return false
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/microsoft vs code/')
}

function quoteForShell(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`
}

function resolveWindowsCommandCandidates(command: string): string[] {
  const candidates: string[] = []

  for (const line of parseCandidateLines(resolvePowerShellCommandCandidates(command))) {
    if (!candidates.includes(line)) {
      candidates.push(line)
    }
  }

  for (const line of parseCandidateLines(execCommand('where.exe', [command], { allowFailure: true }))) {
    if (!candidates.includes(line)) {
      candidates.push(line)
    }
  }

  return candidates
}

function resolvePowerShellCommandCandidates(command: string): string {
  const escapedCommand = command.replace(/'/g, "''")
  const script = [
    `$cmd = '${escapedCommand}'`,
    'Get-Command -All $cmd -ErrorAction SilentlyContinue | ForEach-Object {',
    '  if ($_.Path) { $_.Path }',
    '}',
  ].join(' ')

  for (const shell of ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell']) {
    const raw = execCommand(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      allowFailure: true,
    })
    if (raw.trim()) {
      return raw
    }
  }

  return ''
}

function parseCandidateLines(raw: string): string[] {
  return Array.from(new Set(
    raw
      .split(/\r?\n/)
      .map(line => stripOuterQuotes(line.trim()))
      .filter(Boolean),
  ))
}
