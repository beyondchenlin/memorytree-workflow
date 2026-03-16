/**
 * Goals page: renders markdown files from Memory/01_goals/.
 */

import type { Translations } from '../i18n/types.js'
import { escHtml, htmlShell, renderNav, slugifyName } from './layout.js'
import type { MarkdownFile } from './layout.js'
import { hasMermaidBlocks, markdownToHtml, MERMAID_CDN_SCRIPT } from './markdown.js'
import { extractToc, renderToc, injectHeadingIds } from './toc.js'

export type GoalFile = MarkdownFile

export function renderGoals(files: GoalFile[], t?: Translations): string {
  const nav = renderNav('goals', 1, t)
  const title = t?.nav.goals ?? 'Goals'

  if (files.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">No goal files found in Memory/01_goals/.</p>
</div>`
    return htmlShell(title, content, nav)
  }

  const sections = files
    .map(f => {
      const tocEntries = extractToc(f.content)
      const rawHtml = markdownToHtml(f.content)
      const htmlContent = injectHeadingIds(rawHtml, tocEntries)
      const toc = renderToc(tocEntries)
      return `<div class="card" id="${escHtml(slugifyName(f.filename))}">
  <h2>${escHtml(f.title)}</h2>
  <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem">${escHtml(f.filename)}</p>
  ${toc}
  <div class="markdown-body">${htmlContent}</div>
</div>`
    })
    .join('\n')

  const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${files.length} goal file(s)</p>
</div>
${sections}`

  const hasMermaid = files.some(f => hasMermaidBlocks(f.content))
  return htmlShell(title, content, nav, hasMermaid ? { extraHead: MERMAID_CDN_SCRIPT } : {})
}
