/**
 * SVG chart renderers. All inline SVG, no external libraries.
 * Edge cases: all-zero data renders gracefully.
 */

import { escHtml } from './layout.js'
import { isoWeekKey } from '../stats.js'

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const HEATMAP_COLORS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
const CLIENT_COLORS: Record<string, string> = {
  codex: '#388bfd',
  claude: '#bc8cff',
  gemini: '#3fb950',
}
const FALLBACK_COLORS = ['#58a6ff', '#f78166', '#d29922', '#3fb950', '#bc8cff', '#ff7b72']

// ---------------------------------------------------------------------------
// Heatmap (GitHub-style, last 365 days)
// ---------------------------------------------------------------------------

export function renderHeatmap(dayBuckets: Record<string, number>): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Start from the Sunday before the week that was ~52 weeks ago
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - 364)
  startDate.setDate(startDate.getDate() - startDate.getDay())

  const cellSize = 11
  const cellGap = 3
  const cellStep = cellSize + cellGap
  const leftPad = 28 // space for Mon/Wed/Fri day labels
  const topPad = 18  // space for month labels (unused but keeps top padding)

  // Build exactly 53 weeks
  const weeks: Array<Array<{ date: string; count: number; future: boolean }>> = []
  const cur = new Date(startDate)

  while (weeks.length < 53) {
    const week: Array<{ date: string; count: number; future: boolean }> = []
    for (let d = 0; d < 7; d++) {
      const dateStr = toDateStr(cur)
      const isFuture = cur > today
      week.push({ date: dateStr, count: isFuture ? 0 : (dayBuckets[dateStr] ?? 0), future: isFuture })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  const width = weeks.length * cellStep + leftPad
  const height = 7 * cellStep + topPad + 4

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', '']
  let cells = ''

  for (let w = 0; w < weeks.length; w++) {
    const week = weeks[w]
    if (!week) continue
    for (let d = 0; d < 7; d++) {
      const cell = week[d]
      if (!cell) continue
      const x = leftPad + w * cellStep
      const y = topPad + d * cellStep
      const color = cell.future ? '#0d1117' : getHeatColor(cell.count)
      const title = cell.date ? `${escHtml(cell.date)}: ${cell.count} session(s)` : ''
      cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}">`
      if (title) cells += `<title>${title}</title>`
      cells += `</rect>`
    }
  }

  let labels = ''
  for (let d = 0; d < 7; d++) {
    const label = dayLabels[d]
    if (!label) continue
    const y = topPad + d * cellStep + cellSize - 1
    labels += `<text x="${leftPad - 4}" y="${y}" font-size="9" fill="#8b949e" text-anchor="end">${label}</text>`
  }

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Activity heatmap">
  ${labels}
  ${cells}
</svg>
<div class="heatmap-legend">Less
  ${HEATMAP_COLORS.map(c => `<svg width="11" height="11" viewBox="0 0 11 11"><rect width="11" height="11" rx="2" fill="${c}"/></svg>`).join('')}
More</div>`
}

function getHeatColor(count: number): string {
  if (count === 0) return HEATMAP_COLORS[0] ?? '#161b22'
  if (count === 1) return HEATMAP_COLORS[1] ?? '#0e4429'
  if (count <= 3) return HEATMAP_COLORS[2] ?? '#006d32'
  if (count <= 6) return HEATMAP_COLORS[3] ?? '#26a641'
  return HEATMAP_COLORS[4] ?? '#39d353'
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Client distribution doughnut
// ---------------------------------------------------------------------------

export function renderClientDoughnut(clientCounts: Record<string, number>): string {
  const cx = 90
  const cy = 90
  const r = 60
  const innerR = 38

  const entries = Object.entries(clientCounts).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  if (total === 0 || entries.length === 0) {
    return emptyDoughnut(cx, cy, r)
  }

  const circumference = 2 * Math.PI * r
  let offset = 0
  let segments = ''
  const legendItems: string[] = []

  entries.forEach(([client, count], i) => {
    const fraction = count / total
    const dashLen = fraction * circumference
    const dashGap = circumference - dashLen
    const color = CLIENT_COLORS[client] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] ?? '#58a6ff'
    segments += `<circle
      cx="${cx}" cy="${cy}" r="${r}"
      fill="none"
      stroke="${color}"
      stroke-width="${r - innerR}"
      stroke-dasharray="${dashLen.toFixed(2)} ${dashGap.toFixed(2)}"
      stroke-dashoffset="${(-offset * circumference).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"
    ><title>${escHtml(client)}: ${count} (${(fraction * 100).toFixed(0)}%)</title></circle>`
    offset += fraction

    const pct = (fraction * 100).toFixed(0)
    legendItems.push(
      `<tr><td><svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="${color}"/></svg></td>` +
      `<td style="padding-left:6px;color:#e6edf3">${escHtml(client)}</td>` +
      `<td style="padding-left:12px;color:#8b949e;text-align:right">${count} (${pct}%)</td></tr>`,
    )
    return undefined
  })

  const legendX = cx * 2 + 20
  const width = legendX + 180
  const height = cy * 2

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Client distribution">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#161b22"/>
  ${segments}
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#0d1117"/>
  <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="20" font-weight="700" fill="#e6edf3">${total}</text>
  <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#8b949e">sessions</text>
  <foreignObject x="${legendX}" y="${(cy * 2 - legendItems.length * 28) / 2}" width="180" height="${legendItems.length * 28 + 10}">
    <table xmlns="http://www.w3.org/1999/xhtml" style="font-size:12px;border-collapse:collapse;font-family:sans-serif">
      ${legendItems.join('')}
    </table>
  </foreignObject>
</svg>`
}

function emptyDoughnut(cx: number, cy: number, r: number): string {
  const width = cx * 2 + 220
  const height = cy * 2
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#30363d" stroke-width="22"/>
  <circle cx="${cx}" cy="${cy}" r="${r - 21}" fill="#0d1117"/>
  <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="10" fill="#8b949e">No data</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Weekly messages line chart (last 52 weeks)
// ---------------------------------------------------------------------------

export function renderWeeklyLine(weekBuckets: Record<string, number>): string {
  const W = 580
  const H = 140
  const padL = 38
  const padR = 12
  const padT = 12
  const padB = 24
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  // Build last 52 weeks array
  const weeks = getLast52Weeks()
  const data = weeks.map(w => weekBuckets[w] ?? 0)
  const maxVal = Math.max(...data, 1)

  const points = data.map((v, i) => {
    const x = data.length > 1
      ? padL + (i / (data.length - 1)) * plotW
      : padL + plotW / 2
    const y = padT + plotH - (v / maxVal) * plotH
    return { x, y }
  })

  // Build filled area path
  const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const firstX = points[0]?.x ?? padL
  const lastX = points[points.length - 1]?.x ?? (padL + plotW)
  const baseY = padT + plotH

  const areaPath =
    `M${firstX.toFixed(1)},${baseY} ` +
    points.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L${lastX.toFixed(1)},${baseY} Z`

  // Y axis labels
  const yLabels = [0, Math.round(maxVal / 2), maxVal]
    .map(v => {
      const y = padT + plotH - (v / maxVal) * plotH
      return `<text x="${padL - 4}" y="${y + 4}" font-size="9" fill="#8b949e" text-anchor="end">${v}</text>`
    })
    .join('')

  // X axis: show first and last week labels
  const firstWeek = weeks[0] ?? ''
  const lastWeek = weeks[weeks.length - 1] ?? ''
  const xLabels =
    `<text x="${padL}" y="${H - 4}" font-size="9" fill="#8b949e" text-anchor="start">${escHtml(firstWeek)}</text>` +
    `<text x="${W - padR}" y="${H - 4}" font-size="9" fill="#8b949e" text-anchor="end">${escHtml(lastWeek)}</text>`

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Weekly messages">
  <defs>
    <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#30363d" stroke-width="1"/>
  <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#30363d" stroke-width="1"/>
  ${yLabels}
  ${xLabels}
  <path d="${areaPath}" fill="url(#lineGrad)"/>
  <polyline points="${linePoints}" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`
}

function getLast52Weeks(): string[] {
  const weeks: string[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 51; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i * 7)
    weeks.push(isoWeekKey(d))
  }
  return weeks
}

// ---------------------------------------------------------------------------
// Top tools horizontal bar chart
// ---------------------------------------------------------------------------

export function renderToolBar(toolCounts: Record<string, number>): string {
  const entries = Object.entries(toolCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)

  if (entries.length === 0) {
    return `<svg viewBox="0 0 500 60" xmlns="http://www.w3.org/2000/svg">
  <text x="250" y="35" text-anchor="middle" font-size="13" fill="#8b949e">No tool data available</text>
</svg>`
  }

  const W = 500
  const rowH = 22
  const rowGap = 6
  const labelW = 130
  const barArea = W - labelW - 60
  const H = entries.length * (rowH + rowGap) + 10
  const maxCount = entries[0]?.[1] ?? 1

  const bars = entries
    .map(([name, count], i) => {
      const y = i * (rowH + rowGap) + 5
      const barW = Math.max(2, (count / maxCount) * barArea)
      const color = FALLBACK_COLORS[i % FALLBACK_COLORS.length] ?? '#58a6ff'
      return (
        `<text x="${labelW - 4}" y="${y + rowH - 5}" font-size="10" fill="#8b949e" text-anchor="end">${escHtml(name)}</text>` +
        `<rect x="${labelW}" y="${y + 2}" width="${barW.toFixed(1)}" height="${rowH - 4}" rx="2" fill="${color}" opacity="0.8">` +
        `<title>${escHtml(name)}: ${count}</title></rect>` +
        `<text x="${labelW + barW + 4}" y="${y + rowH - 5}" font-size="10" fill="#8b949e">${count}</text>`
      )
    })
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Top tools">
  ${bars}
</svg>`
}
