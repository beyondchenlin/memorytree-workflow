import { describe, it, expect } from 'vitest'
import { extractToc, renderToc, injectHeadingIds, prefixTocIds } from '../../../src/report/render/toc.js'

describe('extractToc', () => {
  it('extracts h2 and h3 headings', () => {
    const md = `# Title\n\n## Section One\n\nSome text\n\n### Sub Section\n\n## Section Two`
    const toc = extractToc(md)
    expect(toc).toHaveLength(3)
    expect(toc[0]).toEqual({ level: 2, text: 'Section One', id: 'section-one' })
    expect(toc[1]).toEqual({ level: 3, text: 'Sub Section', id: 'sub-section' })
    expect(toc[2]).toEqual({ level: 2, text: 'Section Two', id: 'section-two' })
  })

  it('ignores h1 headings', () => {
    const md = `# Top Level\n\n## Only This`
    const toc = extractToc(md)
    expect(toc).toHaveLength(1)
    expect(toc[0]!.level).toBe(2)
  })

  it('handles duplicate headings with -N suffix', () => {
    const md = `## Intro\n\n## Intro\n\n## Intro`
    const toc = extractToc(md)
    expect(toc[0]!.id).toBe('intro')
    expect(toc[1]!.id).toBe('intro-1')
    expect(toc[2]!.id).toBe('intro-2')
  })

  it('returns empty array for content with no headings', () => {
    expect(extractToc('Just some text\n\nNo headings here.')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(extractToc('')).toEqual([])
  })

  it('slugifies special characters in heading text', () => {
    const md = `## Hello, World! (2026)`
    const toc = extractToc(md)
    expect(toc[0]!.id).toBe('hello-world-2026')
  })
})

describe('renderToc', () => {
  it('returns empty string for empty entries', () => {
    expect(renderToc([])).toBe('')
  })

  it('renders h2 items without indent', () => {
    const entries = [{ level: 2 as const, text: 'Section', id: 'section' }]
    const html = renderToc(entries)
    expect(html).toContain('<a href="#section">Section</a>')
    expect(html).not.toContain('padding-left')
  })

  it('renders h3 items with indent style', () => {
    const entries = [{ level: 3 as const, text: 'Sub', id: 'sub' }]
    const html = renderToc(entries)
    expect(html).toContain('padding-left')
    expect(html).toContain('<a href="#sub">Sub</a>')
  })

  it('escapes HTML in heading text', () => {
    const entries = [{ level: 2 as const, text: '<script>alert(1)</script>', id: 'xss' }]
    const html = renderToc(entries)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('wraps in nav.toc with toggle button', () => {
    const entries = [{ level: 2 as const, text: 'A', id: 'a' }]
    const html = renderToc(entries)
    expect(html).toContain('class="toc"')
    expect(html).toContain('toc-toggle')
  })
})

describe('injectHeadingIds', () => {
  it('injects id attributes into h2 and h3 tags', () => {
    const html = '<h2>Section One</h2><p>text</p><h3>Sub Section</h3>'
    const entries = [
      { level: 2 as const, text: 'Section One', id: 'section-one' },
      { level: 3 as const, text: 'Sub Section', id: 'sub-section' },
    ]
    const result = injectHeadingIds(html, entries)
    expect(result).toContain('<h2 id="section-one">Section One</h2>')
    expect(result).toContain('<h3 id="sub-section">Sub Section</h3>')
  })

  it('returns original html when entries is empty', () => {
    const html = '<h2>Test</h2>'
    expect(injectHeadingIds(html, [])).toBe(html)
  })

  it('leaves unmatched headings unchanged', () => {
    const html = '<h2>Unknown Heading</h2>'
    const entries = [{ level: 2 as const, text: 'Different', id: 'different' }]
    const result = injectHeadingIds(html, entries)
    expect(result).toBe('<h2>Unknown Heading</h2>')
  })
})

describe('prefixTocIds', () => {
  it('prefixes ids to keep anchors unique across merged documents', () => {
    const entries = [
      { level: 2 as const, text: 'Overview', id: 'overview' },
      { level: 3 as const, text: 'Details', id: 'details' },
    ]
    expect(prefixTocIds(entries, 'goal-a-md')).toEqual([
      { level: 2, text: 'Overview', id: 'goal-a-md-overview' },
      { level: 3, text: 'Details', id: 'goal-a-md-details' },
    ])
  })

  it('returns original ids when prefix is empty', () => {
    const entries = [{ level: 2 as const, text: 'Overview', id: 'overview' }]
    expect(prefixTocIds(entries, '')).toEqual(entries)
  })
})
