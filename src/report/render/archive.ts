/**
 * Archive page: renders markdown files from Memory/05_archive/.
 */

import type { Translations } from '../i18n/types.js'
import { escHtml, htmlShell, renderNav, slugifyName } from './layout.js'
import type { MarkdownFile } from './layout.js'
import { markdownToHtml } from './markdown.js'

export type ArchiveFile = MarkdownFile

export function renderArchive(files: ArchiveFile[], t?: Translations): string {
  const nav = renderNav('archive', 1, t)
  const title = t?.nav.archive ?? 'Archive'

  if (files.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">No archive files found in Memory/05_archive/.</p>
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
  <p class="subtitle">${files.length} archive file(s)</p>
</div>
${sections}`

  return htmlShell(title, content, nav)
}
