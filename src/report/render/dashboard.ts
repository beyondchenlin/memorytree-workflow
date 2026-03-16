/**
 * Dashboard page renderer: stat cards + SVG charts + recent sessions.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { ReportStats } from '../../types/report.js'
import type { Translations } from '../i18n/types.js'
import { clientBadge, escHtml, htmlShell, renderNav, transcriptUrlFromRoot } from './layout.js'
import { renderHeatmap, renderClientDoughnut, renderWeeklyLine, renderToolBar } from './charts.js'

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function renderDashboard(stats: ReportStats, manifests: ManifestEntry[], t?: Translations): string {
  const nav = renderNav('dashboard', 0, t)
  const content = [
    renderPageHeader(stats, t),
    renderStatsCards(stats, t),
    renderCharts(stats),
    renderRecentSessions(manifests, t),
  ].join('\n')

  const lang = t ? detectLang(t) : 'en'
  return htmlShell(t?.dashboard.title ?? 'Dashboard', content, nav, '', lang)
}

// ---------------------------------------------------------------------------
// Internal renderers
// ---------------------------------------------------------------------------

function renderPageHeader(stats: ReportStats, t?: Translations): string {
  const from = stats.dateRange.from.slice(0, 10) || '—'
  const to = stats.dateRange.to.slice(0, 10) || '—'
  const title = t?.dashboard.title ?? 'Memory Dashboard'
  const subtitle = (t?.dashboard.subtitle ?? 'Activity from {from} to {to}')
    .replace('{from}', from)
    .replace('{to}', to)
  return `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(subtitle)}</p>
</div>`
}

function renderStatsCards(stats: ReportStats, t?: Translations): string {
  const cards = [
    { value: fmtNum(stats.totalSessions), label: t?.dashboard.sessions ?? 'Sessions' },
    { value: fmtNum(stats.totalMessages), label: t?.dashboard.messages ?? 'Messages' },
    { value: fmtNum(stats.totalToolEvents), label: t?.dashboard.toolEvents ?? 'Tool Events' },
    { value: fmtNum(stats.activeDays), label: t?.dashboard.activeDays ?? 'Active Days' },
  ]

  const html = cards
    .map(
      c => `<div class="card">
  <div class="card-title">${escHtml(c.label)}</div>
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

function renderRecentSessions(manifests: ManifestEntry[], t?: Translations): string {
  const recent = [...manifests]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 10)

  const heading = t?.dashboard.recentSessions ?? 'Recent Sessions'
  const clientLabel = t?.sessions.client ?? 'Client'
  const titleLabel = 'Title'
  const dateLabel = t?.sessions.date ?? 'Date'
  const msgsLabel = t?.sessions.msgs ?? 'Msgs'
  const toolsLabel = t?.sessions.tools ?? 'Tools'

  if (recent.length === 0) {
    return `<div class="card"><p style="color:var(--text-muted)">${escHtml(t?.sessions.noSessions ?? 'No sessions imported yet.')}</p></div>`
  }

  const rows = recent
    .map(m => {
      const url = transcriptUrlFromRoot(m)
      const date = m.started_at.slice(0, 10)
      const badge = clientBadge(m.client)
      const msgs = m.message_count
      const tools = m.tool_event_count
      const summary = ''
      const meta = `${escHtml(m.client)} · ${escHtml(date)} · ${msgs} msgs`
      return `<tr>
  <td>${badge}</td>
  <td><a href="${escHtml(url)}" data-summary="${escHtml(summary)}" data-meta="${escHtml(meta)}">${escHtml(m.title || m.session_id)}</a></td>
  <td style="color:var(--text-muted)">${escHtml(date)}</td>
  <td style="color:var(--text-muted);text-align:right">${msgs}</td>
  <td style="color:var(--text-muted);text-align:right">${tools}</td>
</tr>`
    })
    .join('')

  return `<h2>${escHtml(heading)}</h2>
<div class="card" style="padding:0;overflow:hidden">
<table>
<thead><tr>
  <th>${escHtml(clientLabel)}</th><th>Title</th><th>${escHtml(dateLabel)}</th>
  <th style="text-align:right">${escHtml(msgsLabel)}</th>
  <th style="text-align:right">${escHtml(toolsLabel)}</th>
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

function detectLang(t: Translations): string {
  // Heuristic: check if nav.dashboard is Chinese
  return /[\u4e00-\u9fff]/.test(t.nav.dashboard) ? 'zh-CN' : 'en'
}
