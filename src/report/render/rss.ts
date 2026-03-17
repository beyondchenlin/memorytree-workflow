/**
 * RSS 2.0 feed generator for MemoryTree sessions.
 * Generates a valid feed.xml file.
 * When baseUrl is empty, item links are omitted gracefully.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import { transcriptUrlFromRoot } from './layout.js'

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

function xmlEsc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---------------------------------------------------------------------------
// RSS renderer
// ---------------------------------------------------------------------------

/**
 * Generate an RSS 2.0 feed from session manifests.
 *
 * @param manifests  All session manifests (sorted by started_at descending by caller)
 * @param summaries  Map of session_id → AI summary text
 * @param baseUrl    Absolute base URL (e.g. 'https://memory.example.com').
 *                   When empty, item <link> and channel <link> are omitted.
 */
export function renderRssFeed(
  manifests: ManifestEntry[],
  summaries: Record<string, string>,
  baseUrl: string,
): string {
  const MAX_ITEMS = 100
  const sorted = [...manifests]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, MAX_ITEMS)

  const channelLink = baseUrl ? `\n  <link>${xmlEsc(baseUrl)}</link>` : ''

  const items = sorted.map(m => {
    const title = m.title || m.session_id
    const summary = summaries[m.session_id] ?? ''
    const pubDate = toRfc2822(m.started_at)
    const relUrl = transcriptUrlFromRoot(m)
    const absUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${relUrl}` : ''
    const linkTag = absUrl ? `\n    <link>${xmlEsc(absUrl)}</link>` : ''
    const guidTag = absUrl
      ? `\n    <guid isPermaLink="true">${xmlEsc(absUrl)}</guid>`
      : `\n    <guid isPermaLink="false">${xmlEsc(m.session_id)}</guid>`
    const descTag = summary
      ? `\n    <description>${xmlEsc(summary.slice(0, 500))}</description>`
      : ''
    return `  <item>
    <title>${xmlEsc(title)}</title>${linkTag}${guidTag}
    <pubDate>${xmlEsc(pubDate)}</pubDate>${descTag}
  </item>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>MemoryTree Sessions</title>${channelLink}
  <description>AI session transcripts exported by MemoryTree</description>
  <generator>MemoryTree</generator>
${items}
</channel>
</rss>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ISO 8601 to RFC 2822 format (required by RSS spec). */
function toRfc2822(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString()
}
