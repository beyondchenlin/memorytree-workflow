/**
 * Session list page: tabular index of all imported transcripts.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import { clientBadge, escHtml, htmlShell, renderNav, transcriptUrlFromRoot } from './layout.js'

// ---------------------------------------------------------------------------
// Transcript list
// ---------------------------------------------------------------------------

export function renderTranscriptList(manifests: ManifestEntry[]): string {
  const nav = renderNav('transcripts', false)

  const sorted = [...manifests].sort((a, b) => b.started_at.localeCompare(a.started_at))

  if (sorted.length === 0) {
    const content = `<div class="page-header">
  <h1>Sessions</h1>
  <p class="subtitle">No sessions imported yet.</p>
</div>`
    return htmlShell('Sessions', content, nav)
  }

  const rows = sorted
    .map(m => {
      const url = transcriptHref(m)
      const date = m.started_at.slice(0, 10)
      const time = m.started_at.slice(11, 16)
      const badge = clientBadge(m.client)
      return `<tr>
  <td>${badge}</td>
  <td><a href="${escHtml(url)}">${escHtml(m.title || m.session_id)}</a></td>
  <td style="color:var(--text-muted)">${escHtml(date)} ${escHtml(time)}</td>
  <td style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem">${escHtml(m.session_id.slice(0, 8))}</td>
  <td style="text-align:right;color:var(--text-muted)">${m.message_count}</td>
  <td style="text-align:right;color:var(--text-muted)">${m.tool_event_count}</td>
</tr>`
    })
    .join('')

  const content = `<div class="page-header">
  <h1>Sessions</h1>
  <p class="subtitle">${sorted.length} session(s) imported</p>
</div>
<div class="card" style="padding:0;overflow:hidden">
<table>
<thead><tr>
  <th>Client</th>
  <th>Title</th>
  <th>Date</th>
  <th>ID</th>
  <th style="text-align:right">Msgs</th>
  <th style="text-align:right">Tools</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`

  return htmlShell('Sessions', content, nav)
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function transcriptHref(m: ManifestEntry): string {
  // From transcripts/index.html, the URL is relative to the transcripts/ dir
  // so we only need {client}/{stem}.html (no leading "transcripts/")
  return transcriptUrlFromRoot(m).replace(/^transcripts\//, '')
}
