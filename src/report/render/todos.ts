/**
 * Todos page: renders markdown files from Memory/02_todos/.
 */

import type { Translations } from '../i18n/types.js'
import { escHtml, htmlShell, renderNav, slugifyName } from './layout.js'
import type { MarkdownFile } from './layout.js'
import { markdownToHtml } from './markdown.js'

export type TodoFile = MarkdownFile

export function renderTodos(files: TodoFile[], t?: Translations): string {
  const nav = renderNav('todos', 1, t)
  const title = t?.nav.todos ?? 'Todos'

  if (files.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">No todo files found in Memory/02_todos/.</p>
</div>`
    return htmlShell(title, content, nav)
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
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${files.length} todo file(s)</p>
</div>
${sections}`

  return htmlShell(title, content, nav)
}
