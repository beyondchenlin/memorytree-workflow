import { describe, expect, it } from 'vitest'

import type { ManifestEntry } from '../../../src/types/transcript.js'
import { zhCN } from '../../../src/report/i18n/zh-CN.js'
import { renderTranscriptList } from '../../../src/report/render/transcript-list.js'

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'claude',
    project: 'alpha',
    session_id: 'sess-001',
    raw_sha256: 'abc123',
    title: 'Test Session',
    started_at: '2026-01-01T10:00:00Z',
    imported_at: '2026-01-01T10:00:00Z',
    cwd: '/home/user/alpha',
    branch: 'main',
    raw_source_path: '',
    raw_upload_permission: 'allowed',
    global_raw_path: '',
    global_clean_path: '',
    global_manifest_path: '',
    repo_raw_path: '',
    repo_clean_path: '',
    repo_manifest_path: '',
    message_count: 5,
    tool_event_count: 2,
    cleaning_mode: 'standard',
    repo_mirror_enabled: false,
    ...overrides,
  }
}

describe('renderTranscriptList', () => {
  it('renders a project column and project filter control', () => {
    const html = renderTranscriptList([
      makeManifest({ session_id: 's1', project: 'alpha', cwd: '/home/user/alpha' }),
      makeManifest({ session_id: 's2', project: 'beta', cwd: '/home/user/beta' }),
    ])

    expect(html).toContain('<th>Project</th>')
    expect(html).toContain('id="project-filter"')
    expect(html).toContain('All Projects (2)')
    expect(html).toContain('data-project="alpha"')
    expect(html).toContain('data-project="beta"')
  })

  it('links project names back to the filtered sessions page', () => {
    const html = renderTranscriptList([
      makeManifest({ session_id: 's1', project: 'alpha', cwd: '/home/user/alpha' }),
    ])

    expect(html).toContain('index.html?project=alpha')
    expect(html).toContain("new URL(window.location.href).searchParams.get('project')")
  })

  it('falls back to cwd for project display when the project field is empty', () => {
    const html = renderTranscriptList([
      makeManifest({ session_id: 's1', project: '', cwd: '/home/user/fallback-name' }),
    ])

    expect(html).toContain('fallback-name')
  })

  it('uses translated project filter strings when a locale is provided', () => {
    const html = renderTranscriptList([
      makeManifest({ session_id: 's1', project: 'alpha', cwd: '/home/user/alpha' }),
    ], zhCN)

    expect(html).toContain('<th>项目</th>')
    expect(html).toContain('全部项目 (1)')
    expect(html).toContain('已导入 1 个会话')
    expect(html).not.toContain('All Projects')
    expect(html).not.toContain('session(s) imported')
  })
})
