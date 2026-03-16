/**
 * Knowledge page: renders markdown files from Memory/04_knowledge/.
 */

import { escHtml, htmlShell, renderNav, slugifyName } from './layout.js'
import type { MarkdownFile } from './layout.js'
import { markdownToHtml } from './markdown.js'

// ---------------------------------------------------------------------------
// Knowledge page
// ---------------------------------------------------------------------------

export type KnowledgeFile = MarkdownFile

export function renderKnowledge(files: KnowledgeFile[]): string {
  const nav = renderNav('knowledge', false)

  const subtitle = `${files.length} knowledge file(s)`

  if (files.length === 0) {
    const content = `<div class="page-header">
  <h1>Knowledge</h1>
  <p class="subtitle">No knowledge files found in Memory/04_knowledge/.</p>
</div>`
    return htmlShell('Knowledge', content, nav)
  }

  const sections = files
    .map(f => {
      const htmlContent = markdownToHtml(f.content)
      return `<div class="card" id="${escHtml(slugifyName(f.filename))}">
  <h2>${escHtml(f.title)}</h2>
  <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1rem">${escHtml(f.filename)}</p>
  <div class="markdown-body">${htmlContent}</div>
</div>`
    })
    .join('\n')

  const content = `<div class="page-header">
  <h1>Knowledge</h1>
  <p class="subtitle">${subtitle}</p>
</div>
${sections}`

  return htmlShell('Knowledge', content, nav)
}

