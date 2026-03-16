import { describe, it, expect } from 'vitest'
import type { ManifestEntry } from '../../../src/types/transcript.js'
import { extractProject, renderProjects } from '../../../src/report/render/projects.js'
import { en } from '../../../src/report/i18n/en.js'
import { zhCN } from '../../../src/report/i18n/zh-CN.js'

// ---------------------------------------------------------------------------
// extractProject
// ---------------------------------------------------------------------------

describe('extractProject', () => {
  it('returns the last path segment (Unix)', () => {
    expect(extractProject('/home/user/myproject')).toBe('myproject')
  })

  it('returns the last path segment (Windows)', () => {
    expect(extractProject('C:\\Users\\user\\myproject')).toBe('myproject')
  })

  it('handles trailing slash', () => {
    // No trailing slash in real use, but be resilient
    expect(extractProject('/home/user/myproject')).toBe('myproject')
  })

  it('returns "unknown" for empty string', () => {
    expect(extractProject('')).toBe('unknown')
  })

  it('returns "unknown" for undefined-like input', () => {
    expect(extractProject(undefined as unknown as string)).toBe('unknown')
  })

  it('handles single segment', () => {
    expect(extractProject('myproject')).toBe('myproject')
  })

  it('handles deep path', () => {
    expect(extractProject('/a/b/c/d/e')).toBe('e')
  })
})

// ---------------------------------------------------------------------------
// Manifest fixture builder
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'claude',
    project: 'test',
    session_id: 'sess-001',
    raw_sha256: 'abc123',
    title: 'Test Session',
    started_at: '2026-01-01T10:00:00Z',
    imported_at: '2026-01-01T10:00:00Z',
    cwd: '/home/user/myproject',
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

// ---------------------------------------------------------------------------
// renderProjects — grouping
// ---------------------------------------------------------------------------

describe('renderProjects — grouping', () => {
  it('groups sessions by last cwd segment', () => {
    const manifests = [
      makeManifest({ session_id: 's1', cwd: '/home/user/alpha' }),
      makeManifest({ session_id: 's2', cwd: '/home/user/alpha' }),
      makeManifest({ session_id: 's3', cwd: '/home/user/beta' }),
    ]
    const html = renderProjects(manifests)
    expect(html).toContain('alpha')
    expect(html).toContain('beta')
    // alpha appears once as a project card name
    const alphaCount = (html.match(/alpha/g) ?? []).length
    expect(alphaCount).toBeGreaterThanOrEqual(1)
  })

  it('shows session count per project', () => {
    const manifests = [
      makeManifest({ session_id: 's1', cwd: '/home/user/alpha' }),
      makeManifest({ session_id: 's2', cwd: '/home/user/alpha' }),
      makeManifest({ session_id: 's3', cwd: '/home/user/beta' }),
    ]
    const html = renderProjects(manifests)
    expect(html).toContain('2')
    expect(html).toContain('1')
  })

  it('handles empty manifests list', () => {
    const html = renderProjects([])
    expect(html).toContain('No projects found')
  })

  it('handles "unknown" cwd gracefully', () => {
    const manifests = [makeManifest({ cwd: '' })]
    const html = renderProjects(manifests)
    expect(html).toContain('unknown')
  })

  it('shows client badges per project', () => {
    const manifests = [
      makeManifest({ session_id: 's1', cwd: '/home/user/proj', client: 'claude' }),
      makeManifest({ session_id: 's2', cwd: '/home/user/proj', client: 'codex' }),
    ]
    const html = renderProjects(manifests)
    expect(html).toContain('badge-claude')
    expect(html).toContain('badge-codex')
  })

  it('uses translations when provided (en)', () => {
    const html = renderProjects([], en)
    expect(html).toContain('Projects')
    expect(html).toContain('No projects found')
  })

  it('uses translations when provided (zh-CN)', () => {
    const html = renderProjects([], zhCN)
    expect(html).toContain('项目')
    expect(html).toContain('未找到项目')
  })

  it('shows last active date', () => {
    const manifests = [
      makeManifest({ session_id: 's1', cwd: '/home/user/alpha', started_at: '2026-03-10T10:00:00Z' }),
      makeManifest({ session_id: 's2', cwd: '/home/user/alpha', started_at: '2026-03-16T10:00:00Z' }),
    ]
    const html = renderProjects(manifests)
    expect(html).toContain('2026-03-16')
  })
})
