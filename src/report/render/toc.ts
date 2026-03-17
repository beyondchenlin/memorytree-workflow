/**
 * Table of contents extraction and rendering.
 * Extracts h2/h3 headings from raw markdown and generates a sticky TOC nav.
 */

import { escHtml } from './layout.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TocEntry {
  level: 2 | 3
  text: string
  /** URL-safe anchor id, duplicate-free (suffixed -1, -2, …) */
  id: string
}

// ---------------------------------------------------------------------------
// Extract TOC from raw markdown
// ---------------------------------------------------------------------------

/**
 * Parse h2 and h3 headings from markdown source.
 * Duplicate heading text gets a numeric suffix: `-1`, `-2`, …
 */
export function extractToc(md: string): TocEntry[] {
  const entries: TocEntry[] = []
  const seen = new Map<string, number>()

  for (const line of md.split('\n')) {
    const h2 = line.match(/^## (.+)$/)
    const h3 = line.match(/^### (.+)$/)
    const match = h2 ?? h3
    if (!match) continue

    const level: 2 | 3 = h2 ? 2 : 3
    const text = (match[1] ?? '').trim()
    const base = slugifyHeading(text)

    const count = seen.get(base) ?? 0
    const id = count === 0 ? base : `${base}-${count}`
    seen.set(base, count + 1)

    entries.push({ level, text, id })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Render TOC HTML
// ---------------------------------------------------------------------------

/**
 * Render a collapsible TOC nav from extracted entries.
 * Returns empty string when entries is empty.
 */
export function renderToc(entries: TocEntry[]): string {
  if (entries.length === 0) return ''

  const items = entries
    .map(e => {
      const indent = e.level === 3 ? ' style="padding-left:1.25rem"' : ''
      return `<li${indent}><a href="#${escHtml(e.id)}">${escHtml(e.text)}</a></li>`
    })
    .join('\n      ')

  return `<nav class="toc" id="toc">
  <button class="toc-toggle" id="toc-toggle" type="button" aria-expanded="true">
    Contents <span class="toc-arrow">▾</span>
  </button>
  <ul class="toc-list" id="toc-list">
    ${items}
  </ul>
</nav>`
}

// ---------------------------------------------------------------------------
// TOC ID scoping
// ---------------------------------------------------------------------------

export function prefixTocIds(entries: TocEntry[], prefix: string): TocEntry[] {
  if (!prefix) return entries
  return entries.map(entry => ({
    ...entry,
    id: `${prefix}-${entry.id}`,
  }))
}

// ---------------------------------------------------------------------------
// Heading anchor injection
// ---------------------------------------------------------------------------

/**
 * Post-process rendered HTML to add id attributes to heading tags so
 * TOC anchor links resolve correctly.
 * Only modifies <h2> and <h3> tags without existing id attributes.
 */
export function injectHeadingIds(html: string, entries: TocEntry[]): string {
  if (entries.length === 0) return html

  // Process entries in order so duplicates match correctly
  const remaining = [...entries]
  // [\s\S]*? allows inline HTML inside headings (e.g. <strong>, <code>)
  return html.replace(/<h([23])>([\s\S]*?)<\/h[23]>/g, (full, levelStr, innerHtml) => {
    const level = parseInt(levelStr, 10) as 2 | 3
    // Strip HTML tags from rendered inner content to get plain text for matching
    const innerText = (innerHtml as string).replace(/<[^>]+>/g, '').trim()
    const idx = remaining.findIndex(e => {
      if (e.level !== level) return false
      // Compare plain text: strip markdown markers from entry text, strip HTML from inner
      return stripInlineMarkdown(e.text) === innerText || escHtml(e.text) === (innerHtml as string).trim()
    })
    if (idx === -1) return full
    const entry = remaining.splice(idx, 1)[0]!
    return `<h${level} id="${escHtml(entry.id)}">${innerHtml}</h${level}>`
  })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // remove non-word chars except hyphen
    .trim()
    .replace(/[\s_]+/g, '-')   // spaces/underscores → hyphen
    .replace(/-+/g, '-')       // collapse multiple hyphens
}

/**
 * Strip common markdown inline markers to get plain text.
 * Used to match TOC entries against rendered HTML heading content.
 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // **bold**
    .replace(/\*([^*]+)\*/g, '$1')               // *italic*
    .replace(/`([^`]+)`/g, '$1')                 // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // [link](url) → text
    .trim()
}
