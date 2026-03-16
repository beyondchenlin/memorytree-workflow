/**
 * Minimal Markdown → HTML converter.
 * Handles: headings, bold, italic, inline code, fenced code blocks, lists.
 * All content is HTML-escaped before applying structural tags.
 */

import { escHtml } from './layout.js'

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const output: string[] = []
  let i = 0
  let inList = false
  let listType: 'ul' | 'ol' | null = null

  function closeList() {
    if (inList) {
      output.push(listType === 'ol' ? '</ol>' : '</ul>')
      inList = false
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced code block
    if (line.startsWith('```')) {
      closeList()
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i++
      }
      output.push(`<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ''}>${escHtml(codeLines.join('\n'))}</code></pre>`)
      i++
      continue
    }

    // YAML front matter (skip)
    if (i === 0 && line === '---') {
      i++
      while (i < lines.length && (lines[i] ?? '') !== '---') i++
      i++ // skip closing ---
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      closeList()
      const level = headingMatch[1]?.length ?? 1
      const text = headingMatch[2] ?? ''
      output.push(`<h${level}>${applyInline(text)}</h${level}>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      closeList()
      output.push('<hr>')
      i++
      continue
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList()
        output.push('<ol>')
        inList = true
        listType = 'ol'
      }
      output.push(`<li>${applyInline(olMatch[2] ?? '')}</li>`)
      i++
      continue
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeList()
        output.push('<ul>')
        inList = true
        listType = 'ul'
      }
      output.push(`<li>${applyInline(ulMatch[2] ?? '')}</li>`)
      i++
      continue
    }

    // Blank line
    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    // Paragraph
    closeList()
    output.push(`<p>${applyInline(line)}</p>`)
    i++
  }

  closeList()
  return output.join('\n')
}

// ---------------------------------------------------------------------------
// Inline formatting
// ---------------------------------------------------------------------------

function applyInline(text: string): string {
  // Process links before HTML-escaping to avoid double-escaping href/label
  const withLinks = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    return `<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(label)}</a>`
  })
  // Escape remaining text, then apply inline patterns on already-safe content
  // Split on the <a> tags we just inserted so they are not re-escaped
  const parts = withLinks.split(/(<a [^>]+>.*?<\/a>)/g)
  const processed = parts
    .map((part, i) => {
      if (i % 2 === 1) return part // already-generated <a> tag, pass through
      const escaped = escHtml(part)
      return escaped
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
    })
    .join('')
  return processed
}
