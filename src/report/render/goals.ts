/**
 * Goals page: renders markdown files from Memory/01_goals/.
 */

import { escHtml, htmlShell, renderNav, slugifyName } from './layout.js'
import type { MarkdownFile } from './layout.js'
import { markdownToHtml } from './markdown.js'

export type GoalFile = MarkdownFile

export function renderGoals(files: GoalFile[]): string {
  const nav = renderNav('goals', false)

  if (files.length === 0) {
    const content = `<div class="page-header">
  <h1>Goals</h1>
  <p class="subtitle">No goal files found in Memory/01_goals/.</p>
</div>`
    return htmlShell('Goals', content, nav)
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
  <h1>Goals</h1>
  <p class="subtitle">${files.length} goal file(s)</p>
</div>
${sections}`

  return htmlShell('Goals', content, nav)
}
