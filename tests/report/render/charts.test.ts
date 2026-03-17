import { describe, it, expect } from 'vitest'
import {
  renderHeatmap,
  renderClientDoughnut,
  renderWeeklyLine,
  renderToolBar,
} from '../../../src/report/render/charts.js'

// ---------------------------------------------------------------------------
// renderHeatmap
// ---------------------------------------------------------------------------

describe('renderHeatmap', () => {
  it('produces valid SVG with empty data', () => {
    const svg = renderHeatmap({})
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('<rect')
  })

  it('applies green color for active days', () => {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)
    const svg = renderHeatmap({ [dateStr]: 5 })
    // Should have a non-default color (not #161b22) for an active day
    expect(svg).toContain('#26a641')
  })

  it('includes day count in title tooltip', () => {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)
    const svg = renderHeatmap({ [dateStr]: 3 })
    expect(svg).toContain('3 session')
  })

  it('renders heatmap legend', () => {
    const svg = renderHeatmap({})
    expect(svg).toContain('Less')
    expect(svg).toContain('More')
  })
})

// ---------------------------------------------------------------------------
// renderClientDoughnut
// ---------------------------------------------------------------------------

describe('renderClientDoughnut', () => {
  it('renders empty state gracefully (all-zero)', () => {
    const svg = renderClientDoughnut({})
    expect(svg).toContain('<svg')
    expect(svg).toContain('No data')
  })

  it('renders segments for each client', () => {
    const svg = renderClientDoughnut({ codex: 5, claude: 3, gemini: 2 })
    expect(svg).toContain('<svg')
    expect(svg).toContain('codex')
    expect(svg).toContain('claude')
    expect(svg).toContain('gemini')
  })

  it('shows total session count in center', () => {
    const svg = renderClientDoughnut({ codex: 7, claude: 3 })
    expect(svg).toContain('10')
    expect(svg).toContain('sessions')
  })

  it('handles single client', () => {
    const svg = renderClientDoughnut({ codex: 10 })
    expect(svg).toContain('10')
    expect(svg).not.toContain('No data')
  })

  it('skips zero-count clients', () => {
    const svg = renderClientDoughnut({ codex: 5, claude: 0 })
    expect(svg).toContain('codex')
    expect(svg).not.toContain('>claude<')
  })
})

// ---------------------------------------------------------------------------
// renderWeeklyLine
// ---------------------------------------------------------------------------

describe('renderWeeklyLine', () => {
  it('produces valid SVG with empty data', () => {
    const svg = renderWeeklyLine({})
    expect(svg).toContain('<svg')
    expect(svg).toContain('<polyline')
  })

  it('renders area path and line', () => {
    const svg = renderWeeklyLine({ '2026-W10': 10, '2026-W11': 20 })
    expect(svg).toContain('<path')
    expect(svg).toContain('<polyline')
  })

  it('handles single non-zero week', () => {
    const svg = renderWeeklyLine({ '2026-W01': 5 })
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('NaN')
  })

  it('does not contain NaN with all-zero data', () => {
    const svg = renderWeeklyLine({})
    expect(svg).not.toContain('NaN')
  })
})

// ---------------------------------------------------------------------------
// renderToolBar
// ---------------------------------------------------------------------------

describe('renderToolBar', () => {
  it('shows no-data message for empty input', () => {
    const svg = renderToolBar({})
    expect(svg).toContain('No tool data available')
  })

  it('renders bars for provided tools', () => {
    const svg = renderToolBar({ Bash: 10, Read: 5, Write: 3 })
    expect(svg).toContain('Bash')
    expect(svg).toContain('Read')
    expect(svg).toContain('Write')
  })

  it('limits to top 10 tools', () => {
    const tools: Record<string, number> = {}
    for (let i = 0; i < 15; i++) {
      tools[`Tool${i}`] = 15 - i
    }
    const svg = renderToolBar(tools)
    // Should not contain Tool10 (11th ranked) since sorted by count desc
    const rectCount = (svg.match(/<rect/g) ?? []).length
    expect(rectCount).toBeLessThanOrEqual(10)
  })

  it('sorts tools by count descending', () => {
    const svg = renderToolBar({ LowUsage: 1, HighUsage: 100 })
    const highPos = svg.indexOf('HighUsage')
    const lowPos = svg.indexOf('LowUsage')
    expect(highPos).toBeGreaterThan(-1)
    expect(lowPos).toBeGreaterThan(-1)
    // HighUsage should appear before LowUsage in the SVG
    expect(highPos).toBeLessThan(lowPos)
  })
})
