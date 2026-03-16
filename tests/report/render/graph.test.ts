import { describe, it, expect } from 'vitest'
import type { ManifestEntry } from '../../../src/types/transcript.js'
import type { LinkGraph } from '../../../src/types/report.js'
import type { MarkdownFile } from '../../../src/report/render/layout.js'
import { buildGraphData, renderGraph } from '../../../src/report/render/graph.js'
import { en } from '../../../src/report/i18n/en.js'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    client: 'claude',
    project: 'test',
    session_id: 'sess-001',
    raw_sha256: 'abc123',
    title: 'Test Session',
    started_at: '2026-01-01T10:00:00Z',
    imported_at: '2026-01-01T10:00:00Z',
    cwd: '/home/user/project',
    branch: 'main',
    raw_source_path: '',
    raw_upload_permission: 'allowed',
    global_raw_path: '',
    global_clean_path: '',
    global_manifest_path: '',
    repo_raw_path: '',
    repo_clean_path: '',
    repo_manifest_path: '',
    message_count: 5,
    tool_event_count: 2,
    cleaning_mode: 'standard',
    repo_mirror_enabled: false,
    ...overrides,
  }
}

function emptyLinkGraph(): LinkGraph {
  return { backlinks: {}, forwardLinks: {} }
}

// ---------------------------------------------------------------------------
// buildGraphData
// ---------------------------------------------------------------------------

describe('buildGraphData', () => {
  it('creates one session node per manifest', () => {
    const manifests = [
      makeManifest({ session_id: 's1' }),
      makeManifest({ session_id: 's2' }),
    ]
    const { nodes } = buildGraphData(manifests, [], emptyLinkGraph())
    const sessionNodes = nodes.filter(n => n.type === 'session')
    expect(sessionNodes).toHaveLength(2)
  })

  it('creates knowledge nodes for each knowledge file', () => {
    const kf: MarkdownFile[] = [
      { filename: 'note.md', title: 'Note', content: '# Note' },
    ]
    const { nodes } = buildGraphData([], kf, emptyLinkGraph())
    const knowledgeNodes = nodes.filter(n => n.type === 'knowledge')
    expect(knowledgeNodes).toHaveLength(1)
    expect(knowledgeNodes[0]!.id).toBe('knowledge:note.md')
  })

  it('creates edges from forwardLinks', () => {
    const manifests = [
      makeManifest({ session_id: 's1' }),
      makeManifest({ session_id: 's2' }),
    ]
    const linkGraph: LinkGraph = {
      backlinks: { s2: ['s1'] },
      forwardLinks: { s1: ['s2'] },
    }
    const { edges } = buildGraphData(manifests, [], linkGraph)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.source).toBe('s1')
    expect(edges[0]!.target).toBe('s2')
  })

  it('ignores edges to non-existent nodes', () => {
    const manifests = [makeManifest({ session_id: 's1' })]
    const linkGraph: LinkGraph = {
      backlinks: {},
      forwardLinks: { s1: ['does-not-exist'] },
    }
    const { edges } = buildGraphData(manifests, [], linkGraph)
    expect(edges).toHaveLength(0)
  })

  it('caps nodes at 500 (most recent first)', () => {
    const manifests = Array.from({ length: 600 }, (_, i) =>
      makeManifest({
        session_id: `s${i}`,
        started_at: `2026-01-${String(i % 28 + 1).padStart(2, '0')}T10:00:00Z`,
      })
    )
    const { nodes } = buildGraphData(manifests, [], emptyLinkGraph())
    const sessionNodes = nodes.filter(n => n.type === 'session')
    expect(sessionNodes).toHaveLength(500)
  })

  it('handles empty input', () => {
    const { nodes, edges } = buildGraphData([], [], emptyLinkGraph())
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('sets correct node url for sessions', () => {
    const m = makeManifest({ session_id: 'sess-abc', client: 'claude' })
    const { nodes } = buildGraphData([m], [], emptyLinkGraph())
    const n = nodes.find(x => x.id === 'sess-abc')
    expect(n?.url).toContain('transcripts/claude')
  })
})

// ---------------------------------------------------------------------------
// renderGraph
// ---------------------------------------------------------------------------

describe('renderGraph', () => {
  it('renders empty state when no manifests', () => {
    const html = renderGraph([], [], emptyLinkGraph())
    expect(html).toContain('No graph data available')
  })

  it('renders canvas element with nodes', () => {
    const manifests = [makeManifest({ session_id: 's1' })]
    const html = renderGraph(manifests, [], emptyLinkGraph())
    expect(html).toContain('graph-canvas')
    expect(html).toContain('GRAPH_DATA')
  })

  it('embeds graph data as JSON', () => {
    const manifests = [makeManifest({ session_id: 'unique-sess-id' })]
    const html = renderGraph(manifests, [], emptyLinkGraph())
    expect(html).toContain('unique-sess-id')
  })

  it('uses translations for title', () => {
    const manifests = [makeManifest({ session_id: 's1' })]
    const html = renderGraph(manifests, [], emptyLinkGraph(), en)
    expect(html).toContain('Knowledge Graph')
  })

  it('escapes </script> injection in graph data JSON', () => {
    // The graph data is embedded as JSON inside a <script> block.
    // </script> in node labels must be escaped to prevent premature script close.
    const manifests = [makeManifest({ session_id: 's1', title: 'foo</script>bar' })]
    const html = renderGraph(manifests, [], emptyLinkGraph())
    // The literal </script> must not appear inside the <script> block
    // (it gets escaped as <\/script> in the JSON)
    expect(html).not.toContain('foo</script>bar')
  })

  it('shows node and edge counts in subtitle', () => {
    const manifests = [
      makeManifest({ session_id: 's1' }),
      makeManifest({ session_id: 's2' }),
    ]
    const linkGraph: LinkGraph = {
      backlinks: { s2: ['s1'] },
      forwardLinks: { s1: ['s2'] },
    }
    const html = renderGraph(manifests, [], linkGraph)
    expect(html).toContain('2 nodes')
    expect(html).toContain('1 edge')
  })
})
