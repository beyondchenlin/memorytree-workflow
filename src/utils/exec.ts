/**
 * Subprocess execution wrapper for git and other commands.
 * Port of heartbeat.py _git() and daemon subprocess calls.
 */

import { execFileSync } from 'node:child_process'

export function execCommand(
  command: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number; allowFailure?: boolean },
): string {
  const cwd = options?.cwd
  const timeout = options?.timeout ?? 120_000
  const allowFailure = options?.allowFailure ?? false

  try {
    const stdout = execFileSync(command, [...args], {
      cwd,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return stdout
  } catch (err: unknown) {
    if (allowFailure) {
      const e = err as { stdout?: string }
      return typeof e.stdout === 'string' ? e.stdout : ''
    }
    throw err
  }
}

export function git(cwd: string, ...args: string[]): string {
  const allowFailure = args[0] === 'status' || args[0] === 'remote'
  return execCommand('git', args, { cwd, allowFailure })
}
