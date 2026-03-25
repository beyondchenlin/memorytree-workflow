import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDoctorReport, formatDoctorReport } from '../../src/cli/cmd-doctor.js'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

describe('buildDoctorReport', () => {
  it('reports a healthy command resolution when the selected shim exists and is non-empty', () => {
    const skillRoot = createSkillRoot()
    const shimPath = writeFile(join(skillRoot, 'bin', 'memorytree.cmd'), '@echo off\r\n')

    const report = buildDoctorReport({
      skillRoot,
      scriptPath: join(skillRoot, 'dist', 'cli.js'),
      platformName: 'win32',
      commands: ['memorytree'],
      candidatePathsByCommand: {
        memorytree: [shimPath],
      },
    })

    expect(report.ok).toBe(true)
    expect(report.status).toBe('ok')
    expect(report.commands[0]?.healthy).toBe(true)
    expect(report.commands[0]?.selected_path).toBe(shimPath)
    expect(formatDoctorReport(report)).toContain('Status: ok')
  })

  it('warns when Windows resolves memorytree to a zero-byte file inside the VS Code install directory', () => {
    const skillRoot = createSkillRoot()
    const badPath = writeFile(join(
      skillRoot,
      'Users',
      'ai',
      'AppData',
      'Local',
      'Programs',
      'Microsoft VS Code',
      'memorytree',
    ), '')
    const goodPath = writeFile(join(skillRoot, 'fnm', 'memorytree.cmd'), '@echo off\r\n')

    const report = buildDoctorReport({
      skillRoot,
      scriptPath: join(skillRoot, 'dist', 'cli.js'),
      platformName: 'win32',
      commands: ['memorytree'],
      candidatePathsByCommand: {
        memorytree: [badPath, goodPath],
      },
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe('warning')
    expect(report.commands[0]?.healthy).toBe(false)
    expect(report.commands[0]?.warnings).toContain('The first PATH resolution for memorytree looks broken or unsafe.')
    expect(report.commands[0]?.warnings).toContain('A later candidate looks usable, but the shell will still hit the first one first.')
    expect(report.warnings).toContain('A Windows PATH entry inside the VS Code install directory is shadowing MemoryTree.')
    expect(report.fallback_quick_start_command).toContain('daemon quick-start --root <target-repo>')

    const text = formatDoctorReport(report)
    expect(text).toContain('resolved file is 0 bytes')
    expect(text).toContain('resolved path is inside the VS Code install directory')
    expect(text).toContain('Fallback command:')
  })

  it('warns when memorytree is not found on PATH at all', () => {
    const skillRoot = createSkillRoot()

    const report = buildDoctorReport({
      skillRoot,
      scriptPath: join(skillRoot, 'dist', 'cli.js'),
      platformName: 'linux',
      commands: ['memorytree'],
      candidatePathsByCommand: {
        memorytree: [],
      },
    })

    expect(report.ok).toBe(false)
    expect(report.commands[0]?.resolved).toBe(false)
    expect(report.commands[0]?.warnings).toContain('memorytree was not found on PATH.')
    expect(formatDoctorReport(report)).toContain('PATH resolution: not found')
  })
})

function createSkillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memorytree-doctor-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'assets', 'templates'), { recursive: true })
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'SKILL.md'), '---\nname: memorytree-workflow\ndescription: test skill\n---\n', 'utf-8')
  writeFileSync(join(root, 'dist', 'cli.js'), '#!/usr/bin/env node\n', 'utf-8')
  return root
}

function writeFile(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
  return path
}
