/**
 * Session list page: tabular index of all imported transcripts, with client tab filtering.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { Translations } from '../i18n/types.js'
import { clientBadge, escHtml, htmlShell, renderNav, transcriptUrlFromRoot } from './layout.js'

// ---------------------------------------------------------------------------
// Transcript list
// ---------------------------------------------------------------------------

export function renderTranscriptList(manifests: ManifestEntry[], t?: Translations, summaries?: Record<string, string>): string {
  const nav = renderNav('transcripts', 1, t)

  const sorted = [...manifests].sort((a, b) => b.started_at.localeCompare(a.started_at))

  const title = t?.sessions.title ?? 'Sessions'
  const clientLabel = t?.sessions.client ?? 'Client'
  const dateLabel = t?.sessions.date ?? 'Date'
  const idLabel = t?.sessions.id ?? 'ID'
  const msgsLabel = t?.sessions.msgs ?? 'Msgs'
  const toolsLabel = t?.sessions.tools ?? 'Tools'
  const allLabel = t?.sessions.all ?? 'All'

  if (sorted.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(t?.sessions.noSessions ?? 'No sessions imported yet.')}</p>
</div>`
    return htmlShell(title, content, nav)
  }

  // Collect unique clients
  const clientSet = new Set<string>()
  for (const m of sorted) clientSet.add(m.client)
  const clients = [...clientSet].sort()

  // Tab bar
  const tabBar = renderTabBar(allLabel, clients, sorted)

  const rows = sorted
    .map(m => {
      const url = transcriptHref(m)
      const date = m.started_at.slice(0, 10)
      const time = m.started_at.slice(11, 16)
      const badge = clientBadge(m.client)
      const summary = summaries?.[m.session_id] ?? ''
      const meta = `${escHtml(m.client)} · ${escHtml(date)} · ${m.message_count} msgs`
      return `<tr data-client="${escHtml(m.client)}">
  <td>${badge}</td>
  <td><a href="${escHtml(url)}" data-summary="${escHtml(summary)}" data-meta="${escHtml(meta)}">${escHtml(m.title || m.session_id)}</a></td>
  <td style="color:var(--text-muted)">${escHtml(date)} ${escHtml(time)}</td>
  <td style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem">${escHtml(m.session_id.slice(0, 8))}</td>
  <td style="text-align:right;color:var(--text-muted)">${m.message_count}</td>
  <td style="text-align:right;color:var(--text-muted)">${m.tool_event_count}</td>
</tr>`
    })
    .join('')

  const filterJs = `<script>
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var tabs = document.querySelectorAll('.tab-btn');
    var rows = document.querySelectorAll('tr[data-client]');
    tabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        tabs.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var filter = btn.getAttribute('data-filter');
        rows.forEach(function(row) {
          if (!filter || row.getAttribute('data-client') === filter) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });
    });
  });
})();
</script>`

  const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${sorted.length} session(s) imported</p>
</div>
${tabBar}
<div class="card" style="padding:0;overflow:hidden">
<table>
<thead><tr>
  <th>${escHtml(clientLabel)}</th>
  <th>Title</th>
  <th>${escHtml(dateLabel)}</th>
  <th>${escHtml(idLabel)}</th>
  <th style="text-align:right">${escHtml(msgsLabel)}</th>
  <th style="text-align:right">${escHtml(toolsLabel)}</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`

  return htmlShell(title, content, nav, filterJs)
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function renderTabBar(allLabel: string, clients: string[], manifests: ManifestEntry[]): string {
  const total = manifests.length
  const tabs = [
    `<button class="tab-btn active" data-filter="" type="button">${escHtml(allLabel)} (${total})</button>`,
    ...clients.map(client => {
      const count = manifests.filter(m => m.client === client).length
      return `<button class="tab-btn" data-filter="${escHtml(client)}" type="button">${escHtml(client)} (${count})</button>`
    }),
  ]
  return `<div class="tab-bar">${tabs.join('')}</div>`
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function transcriptHref(m: ManifestEntry): string {
  // From transcripts/index.html, the URL is relative to the transcripts/ dir
  // so we only need {client}/{stem}.html (no leading "transcripts/")
  return transcriptUrlFromRoot(m).replace(/^transcripts\//, '')
}
