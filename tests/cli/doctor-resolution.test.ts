import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  }
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('buildDoctorReport command resolution', () => {
  it('prefers PowerShell Get-Command ordering over where.exe on Windows', async () => {
    const skillRoot = createSkillRoot()
    const ps1Path = writeFile(join(skillRoot, 'bin', 'memorytree.ps1'), '# test\n')
    const cmdPath = writeFile(join(skillRoot, 'bin', 'memorytree.cmd'), '@echo off\r\n')

    vi.doMock('../../src/utils/exec.js', () => ({
      execCommand: (command: string) => {
        if (command === 'pwsh.exe') {
          return `${ps1Path}\r\n${cmdPath}\r\n`
        }
        if (command === 'where.exe') {
          return `${cmdPath}\r\n`
        }
        return ''
      },
    }))

    const { buildDoctorReport } = await import('../../src/cli/cmd-doctor.js')
    const report = buildDoctorReport({
      skillRoot,
      scriptPath: join(skillRoot, 'dist', 'cli.js'),
      platformName: 'win32',
      commands: ['memorytree'],
    })

    expect(report.ok).toBe(true)
    expect(report.commands[0]?.selected_path).toBe(ps1Path)
    expect(report.commands[0]?.candidates.map(candidate => candidate.path)).toEqual([ps1Path, cmdPath])
  })
})

function createSkillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memorytree-doctor-resolution-'))
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
