import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { collectExtraManifestDirs } from '../../src/cli/cmd-report.js'

let sandboxRoot: string
let homeDir: string
let repoRoot: string
let otherRepoRoot: string
let originalHome: string | undefined
let originalUserProfile: string | undefined

beforeEach(() => {
  sandboxRoot = mkdtempSync(join(tmpdir(), 'cmd-report-test-'))
  homeDir = join(sandboxRoot, 'home')
  repoRoot = join(sandboxRoot, 'repo')
  otherRepoRoot = join(sandboxRoot, 'other-repo')
  originalHome = process.env['HOME']
  originalUserProfile = process.env['USERPROFILE']

  mkdirSync(join(homeDir, '.memorytree'), { recursive: true })
  mkdirSync(join(repoRoot, 'Memory', '06_transcripts', 'manifests'), { recursive: true })
  mkdirSync(join(otherRepoRoot, 'Memory', '06_transcripts', 'manifests'), { recursive: true })

  process.env['HOME'] = homeDir
  process.env['USERPROFILE'] = homeDir

  writeFileSync(
    join(homeDir, '.memorytree', 'config.toml'),
    [
      'heartbeat_interval = "5m"',
      'watch_dirs = []',
      '',
      '[[projects]]',
      `path = "${toPosix(repoRoot)}"`,
      `development_path = "${toPosix(repoRoot)}"`,
      `memory_path = "${toPosix(repoRoot)}"`,
      'name = "repo"',
      '',
      '[[projects]]',
      `path = "${toPosix(otherRepoRoot)}"`,
      `development_path = "${toPosix(otherRepoRoot)}"`,
      `memory_path = "${toPosix(otherRepoRoot)}"`,
      'name = "other-repo"',
      '',
    ].join('\n'),
    'utf-8',
  )
})

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env['HOME']
  } else {
    process.env['HOME'] = originalHome
  }

  if (originalUserProfile === undefined) {
    delete process.env['USERPROFILE']
  } else {
    process.env['USERPROFILE'] = originalUserProfile
  }

  rmSync(sandboxRoot, { recursive: true, force: true })
})

describe('collectExtraManifestDirs', () => {
  it('returns other registered project manifest dirs for the current project', () => {
    expect(collectExtraManifestDirs(repoRoot)).toEqual([
      resolve(join(otherRepoRoot, 'Memory', '06_transcripts', 'manifests')),
    ])
  })

  it('returns an empty list when the current root is not registered', () => {
    expect(collectExtraManifestDirs(join(sandboxRoot, 'unknown'))).toEqual([])
  })
})

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}
