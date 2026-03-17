/**
 * Breadcrumb navigation helper.
 * Renders an accessible <nav aria-label="breadcrumb"> from a list of items.
 */

import { escHtml } from './layout.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadcrumbItem {
  label: string
  /** URL of this crumb. Omit for the current (last) item. */
  url?: string
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render a breadcrumb trail.
 * - Items with a `url` are rendered as links.
 * - The last item (current page) has no link and gets aria-current="page".
 * - Returns empty string when items array is empty.
 */
export function renderBreadcrumb(items: BreadcrumbItem[]): string {
  if (items.length === 0) return ''

  const parts = items.map((item, i) => {
    const isLast = i === items.length - 1
    if (isLast || !item.url) {
      const ariaCurrent = isLast ? ' aria-current="page"' : ''
      return `<span class="breadcrumb-item"${ariaCurrent}>${escHtml(item.label)}</span>`
    }
    return `<a class="breadcrumb-item" href="${escHtml(item.url)}">${escHtml(item.label)}</a>`
  })

  return `<nav class="breadcrumb" aria-label="breadcrumb">${parts.join('<span class="breadcrumb-sep">›</span>')}</nav>`
}
