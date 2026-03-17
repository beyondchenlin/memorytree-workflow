import { describe, it, expect } from 'vitest'
import { renderBreadcrumb } from '../../../src/report/render/breadcrumb.js'

describe('renderBreadcrumb', () => {
  it('returns empty string for empty items', () => {
    expect(renderBreadcrumb([])).toBe('')
  })

  it('renders single item as current page (no link)', () => {
    const html = renderBreadcrumb([{ label: 'Dashboard' }])
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Dashboard')
    expect(html).not.toContain('<a ')
  })

  it('renders intermediate items as links', () => {
    const html = renderBreadcrumb([
      { label: 'Home', url: '../index.html' },
      { label: 'Sessions', url: '../transcripts/index.html' },
      { label: 'my-session' },
    ])
    expect(html).toContain('href="../index.html"')
    expect(html).toContain('href="../transcripts/index.html"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('my-session')
  })

  it('last item has no link even if url is provided', () => {
    const html = renderBreadcrumb([
      { label: 'Home', url: 'index.html' },
      { label: 'Current', url: 'current.html' },
    ])
    // last item should have aria-current, not be a link
    expect(html).toContain('aria-current="page"')
    // 'Current' text should appear exactly once (no link)
    expect((html.match(/href="current\.html"/g) ?? []).length).toBe(0)
  })

  it('escapes HTML in labels and URLs', () => {
    const html = renderBreadcrumb([
      { label: '<b>Bold</b>', url: 'page.html?a=1&b=2' },
      { label: 'End' },
    ])
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('&amp;')
  })

  it('renders separator between items', () => {
    const html = renderBreadcrumb([
      { label: 'A', url: 'a.html' },
      { label: 'B' },
    ])
    expect(html).toContain('›')
  })

  it('wraps in nav with aria-label', () => {
    const html = renderBreadcrumb([{ label: 'X' }])
    expect(html).toContain('<nav class="breadcrumb"')
    expect(html).toContain('aria-label="breadcrumb"')
  })
})
