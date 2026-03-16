/**
 * Dashboard page renderer: stat cards + SVG charts + recent sessions.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { ReportStats } from '../../types/report.js'
import { clientBadge, escHtml, htmlShell, renderNav, transcriptUrlFromRoot } from './layout.js'
import { renderHeatmap, renderClientDoughnut, renderWeeklyLine, renderToolBar } from './charts.js'

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function renderDashboard(stats: ReportStats, manifests: ManifestEntry[]): string {
  const nav = renderNav('dashboard', true)
  const content = [
    renderPageHeader(stats),
    renderStatsCards(stats),
    renderCharts(stats),
    renderRecentSessions(manifests),
  ].join('\n')

  return htmlShell('Dashboard', content, nav)
}

// ---------------------------------------------------------------------------
// Internal renderers
// ---------------------------------------------------------------------------

function renderPageHeader(stats: ReportStats): string {
  const from = stats.dateRange.from.slice(0, 10) || '—'
  const to = stats.dateRange.to.slice(0, 10) || '—'
  return `<div class="page-header">
  <h1>Memory Dashboard</h1>
  <p class="subtitle">Activity from ${escHtml(from)} to ${escHtml(to)}</p>
</div>`
}

function renderStatsCards(stats: ReportStats): string {
  const cards = [
    { value: fmtNum(stats.totalSessions), label: 'Sessions' },
    { value: fmtNum(stats.totalMessages), label: 'Messages' },
    { value: fmtNum(stats.totalToolEvents), label: 'Tool Events' },
    { value: fmtNum(stats.activeDays), label: 'Active Days' },
  ]

  const html = cards
    .map(
      c => `<div class="card">
  <div class="card-title">${c.label}</div>
  <div class="stat-value">${c.value}</div>
</div>`,
    )
    .join('')

  return `<div class="stats-grid">${html}</div>`
}

function renderCharts(stats: ReportStats): string {
  const heatmap = renderHeatmap(stats.dayBuckets)
  const doughnut = renderClientDoughnut(stats.clientCounts)
  const line = renderWeeklyLine(stats.weekBuckets)
  const bar = renderToolBar(stats.toolCounts)

  return `<div class="chart-grid">
  <div class="chart-card full-width">
    <div class="chart-title">Activity (last 365 days)</div>
    ${heatmap}
  </div>
  <div class="chart-card">
    <div class="chart-title">Client Distribution</div>
    ${doughnut}
  </div>
  <div class="chart-card">
    <div class="chart-title">Messages / Week (last 52 weeks)</div>
    ${line}
  </div>
  <div class="chart-card full-width">
    <div class="chart-title">Top 10 Tools</div>
    ${bar}
  </div>
</div>`
}

function renderRecentSessions(manifests: ManifestEntry[]): string {
  const recent = [...manifests]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 10)

  if (recent.length === 0) {
    return `<div class="card"><p style="color:var(--text-muted)">No sessions imported yet.</p></div>`
  }

  const rows = recent
    .map(m => {
      const url = transcriptHref(m)
      const date = m.started_at.slice(0, 10)
      const badge = clientBadge(m.client)
      const msgs = m.message_count
      const tools = m.tool_event_count
      return `<tr>
  <td>${badge}</td>
  <td><a href="${escHtml(url)}">${escHtml(m.title || m.session_id)}</a></td>
  <td style="color:var(--text-muted)">${escHtml(date)}</td>
  <td style="color:var(--text-muted);text-align:right">${msgs}</td>
  <td style="color:var(--text-muted);text-align:right">${tools}</td>
</tr>`
    })
    .join('')

  return `<h2>Recent Sessions</h2>
<div class="card" style="padding:0;overflow:hidden">
<table>
<thead><tr>
  <th>Client</th><th>Title</th><th>Date</th>
  <th style="text-align:right">Msgs</th>
  <th style="text-align:right">Tools</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

function transcriptHref(m: ManifestEntry): string {
  return transcriptUrlFromRoot(m)
}

