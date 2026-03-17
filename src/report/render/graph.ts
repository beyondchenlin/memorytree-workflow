/**
 * Knowledge graph page: force-directed visualization of sessions and knowledge links.
 * Inline vanilla JS, no CDN dependencies.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { LinkGraph } from '../../types/report.js'
import type { Translations } from '../i18n/types.js'
import type { MarkdownFile } from './layout.js'
import { escHtml, htmlShell, renderNav, transcriptUrlFromRoot, slugifyName } from './layout.js'

const MAX_NODES = 500

// ---------------------------------------------------------------------------
// Graph data types
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string
  label: string
  type: 'session' | 'knowledge'
  client?: string
  url: string
}

interface GraphEdge {
  source: string
  target: string
}

// ---------------------------------------------------------------------------
// Build graph data
// ---------------------------------------------------------------------------

export function buildGraphData(
  manifests: ManifestEntry[],
  knowledgeFiles: MarkdownFile[],
  linkGraph: LinkGraph,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Cap manifests to MAX_NODES (most recent first)
  const sorted = [...manifests]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, MAX_NODES)

  const nodeSet = new Set<string>()
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (const m of sorted) {
    if (!nodeSet.has(m.session_id)) {
      nodeSet.add(m.session_id)
      nodes.push({
        id: m.session_id,
        label: m.title || m.session_id.slice(0, 8),
        type: 'session',
        client: m.client,
        url: transcriptUrlFromRoot(m),
      })
    }
  }

  for (const kf of knowledgeFiles) {
    const id = `knowledge:${kf.filename}`
    if (!nodeSet.has(id)) {
      nodeSet.add(id)
      nodes.push({
        id,
        label: kf.title || kf.filename,
        type: 'knowledge',
        url: `knowledge/index.html#${slugifyName(kf.filename)}`,
      })
    }
  }

  // Add edges from link graph (only for nodes that exist)
  for (const [sourceId, targets] of Object.entries(linkGraph.forwardLinks)) {
    if (!nodeSet.has(sourceId)) continue
    for (const targetId of targets) {
      if (nodeSet.has(targetId)) {
        edges.push({ source: sourceId, target: targetId })
      }
    }
  }

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Graph page renderer

export function renderGraph(
  manifests: ManifestEntry[],
  knowledgeFiles: MarkdownFile[],
  linkGraph: LinkGraph,
  t?: Translations,
): string {
  const nav = renderNav('graph', 0, t)
  const title = t?.graph.title ?? 'Knowledge Graph'
  const subtitle = t?.graph.subtitle ?? 'Connections between sessions and knowledge files'

  const { nodes, edges } = buildGraphData(manifests, knowledgeFiles, linkGraph)

  if (nodes.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(t?.graph.noData ?? 'No graph data available.')}</p>
</div>`
    return htmlShell(title, content, nav)
  }

  // Embed graph data as JSON; escape sequences that could break a <script> block
  const graphDataJson = JSON.stringify({ nodes, edges })
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

  const graphScript = `<script>
(function() {
var GRAPH_DATA = ${graphDataJson};

// Client color map
var CLIENT_COLORS = { claude: '#bc8cff', codex: '#58a6ff', gemini: '#3fb950' };
function nodeColor(n) {
  if (n.type === 'knowledge') return '#f0c040';
  return CLIENT_COLORS[n.client] || '#8b949e';
}
function nodeRadius(n) { return n.type === 'knowledge' ? 7 : 5; }

var canvas = document.getElementById('graph-canvas');
if (!canvas) return;
var ctx = canvas.getContext('2d');

// High-DPI
function resize() {
  var rect = canvas.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
}
resize();
window.addEventListener('resize', function() { resize(); draw(); });

var W = canvas.getBoundingClientRect().width;
var H = canvas.getBoundingClientRect().height;

// Init positions (random spread)
var nodeMap = {};
var simNodes = GRAPH_DATA.nodes.map(function(n) {
  var sn = { id: n.id, label: n.label, type: n.type, client: n.client, url: n.url,
    x: W/2 + (Math.random()-0.5)*W*0.7, y: H/2 + (Math.random()-0.5)*H*0.7, vx: 0, vy: 0 };
  nodeMap[n.id] = sn;
  return sn;
});

var simEdges = GRAPH_DATA.edges.map(function(e) {
  return { source: nodeMap[e.source], target: nodeMap[e.target] };
}).filter(function(e) { return e.source && e.target; });

// Simulation params — tuned for ~50–200 node graphs on a 900px canvas
var ALPHA = 1.0;        // initial energy; decays each tick
var ALPHA_DECAY = 0.0228; // decay rate ≈ ln(0.001)/300 (settles in ~300 ticks)
var ALPHA_MIN = 0.001;  // stop simulation below this threshold
var CHARGE = -120;      // repulsion strength between nodes (negative = push apart)
var LINK_DIST = 80;     // spring rest length in pixels
var CENTER_FORCE = 0.05; // gravity toward canvas center (prevents drift)
var DAMPING = 0.6;      // velocity damping per tick (higher = faster settling)

// Pan/zoom state
var panX = 0, panY = 0, scale = 1;
var dragging = false, dragNode = null, dragOffX = 0, dragOffY = 0;
var isPanning = false, panStartX = 0, panStartY = 0, panStartPanX = 0, panStartPanY = 0;

function worldToScreen(wx, wy) {
  return { x: (wx + panX) * scale + W/2, y: (wy + panY) * scale + H/2 };
}
function screenToWorld(sx, sy) {
  return { x: (sx - W/2) / scale - panX, y: (sy - H/2) / scale - panY };
}

function tick() {
  if (ALPHA < ALPHA_MIN) return;
  ALPHA *= (1 - ALPHA_DECAY);

  // Repulsion (n^2, capped)
  var N = simNodes.length;
  for (var i = 0; i < N; i++) {
    for (var j = i+1; j < N; j++) {
      var ni = simNodes[i], nj = simNodes[j];
      var dx = nj.x - ni.x, dy = nj.y - ni.y;
      var dist = Math.sqrt(dx*dx + dy*dy) || 1;
      var force = CHARGE / (dist * dist) * ALPHA;
      var fx = dx / dist * force, fy = dy / dist * force;
      ni.vx -= fx; ni.vy -= fy;
      nj.vx += fx; nj.vy += fy;
    }
  }

  // Link attraction
  for (var k = 0; k < simEdges.length; k++) {
    var e = simEdges[k];
    var dx2 = e.target.x - e.source.x, dy2 = e.target.y - e.source.y;
    var dist2 = Math.sqrt(dx2*dx2 + dy2*dy2) || 1;
    var strength = (dist2 - LINK_DIST) / dist2 * 0.5 * ALPHA;
    var fx2 = dx2 * strength, fy2 = dy2 * strength;
    e.source.vx += fx2; e.source.vy += fy2;
    e.target.vx -= fx2; e.target.vy -= fy2;
  }

  // Center gravity
  for (var m = 0; m < N; m++) {
    var node = simNodes[m];
    node.vx += -node.x * CENTER_FORCE * ALPHA;
    node.vy += -node.y * CENTER_FORCE * ALPHA;
    if (node === dragNode) continue;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function draw() {
  W = canvas.getBoundingClientRect().width;
  H = canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();

  // Draw edges
  ctx.strokeStyle = 'rgba(139,148,158,0.3)';
  ctx.lineWidth = 1;
  for (var k = 0; k < simEdges.length; k++) {
    var e = simEdges[k];
    var s = worldToScreen(e.source.x, e.source.y);
    var t2 = worldToScreen(e.target.x, e.target.y);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.stroke();
  }

  // Draw nodes
  for (var i = 0; i < simNodes.length; i++) {
    var n = simNodes[i];
    var pos = worldToScreen(n.x, n.y);
    var r = nodeRadius(n) * scale;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(r, 3), 0, Math.PI*2);
    ctx.fillStyle = nodeColor(n);
    ctx.fill();
    if (n === hoverNode) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Draw hover label
  if (hoverNode) {
    var hpos = worldToScreen(hoverNode.x, hoverNode.y);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(hoverNode.label.slice(0, 30), hpos.x + 8, hpos.y - 4);
  }

  ctx.restore();
}

var hoverNode = null;

function findNode(sx, sy) {
  var w = screenToWorld(sx, sy);
  var best = null, bestDist = Infinity;
  for (var i = 0; i < simNodes.length; i++) {
    var n = simNodes[i];
    var dx = n.x - w.x, dy = n.y - w.y;
    var dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 15 / scale && dist < bestDist) { best = n; bestDist = dist; }
  }
  return best;
}

function getCanvasPos(evt) {
  var rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

canvas.addEventListener('mousemove', function(e) {
  var pos = getCanvasPos(e);
  if (isPanning) {
    panX = panStartPanX + (pos.x - panStartX) / scale;
    panY = panStartPanY + (pos.y - panStartY) / scale;
    return;
  }
  if (dragNode) {
    var w = screenToWorld(pos.x, pos.y);
    dragNode.x = w.x + dragOffX;
    dragNode.y = w.y + dragOffY;
    dragNode.vx = 0; dragNode.vy = 0;
    return;
  }
  var node = findNode(pos.x, pos.y);
  hoverNode = node;
  canvas.style.cursor = node ? 'pointer' : 'grab';
});

canvas.addEventListener('mousedown', function(e) {
  var pos = getCanvasPos(e);
  var node = findNode(pos.x, pos.y);
  if (node) {
    dragNode = node;
    var w = screenToWorld(pos.x, pos.y);
    dragOffX = node.x - w.x;
    dragOffY = node.y - w.y;
    ALPHA = 0.3;
  } else {
    isPanning = true;
    panStartX = pos.x; panStartY = pos.y;
    panStartPanX = panX; panStartPanY = panY;
  }
});

canvas.addEventListener('mouseup', function(e) {
  if (dragNode) { dragNode = null; return; }
  isPanning = false;
});

canvas.addEventListener('click', function(e) {
  var pos = getCanvasPos(e);
  var node = findNode(pos.x, pos.y);
  if (node && node.url) { window.location.href = node.url; }
});

canvas.addEventListener('wheel', function(e) {
  e.preventDefault();
  var pos = getCanvasPos(e);
  var factor = e.deltaY > 0 ? 0.9 : 1.1;
  var wx = (pos.x - W/2) / scale - panX;
  var wy = (pos.y - H/2) / scale - panY;
  scale *= factor;
  scale = Math.max(0.1, Math.min(10, scale));
  panX = (pos.x - W/2) / scale - wx;
  panY = (pos.y - H/2) / scale - wy;
}, { passive: false });

// Animation loop — stops automatically once simulation settles
function loop() {
  tick();
  draw();
  if (ALPHA >= ALPHA_MIN) {
    requestAnimationFrame(loop);
  }
}
loop();
})();
</script>`

  const legendItems = [
    { color: '#bc8cff', label: 'Claude' },
    { color: '#58a6ff', label: 'Codex' },
    { color: '#3fb950', label: 'Gemini' },
    { color: '#8b949e', label: 'Other' },
    { color: '#f0c040', label: 'Knowledge' },
  ]

  const legend = legendItems.map(item =>
    `<div class="graph-legend-item">
  <span class="graph-legend-dot" style="background:${escHtml(item.color)}"></span>
  ${escHtml(item.label)}
</div>`
  ).join('')

  const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(subtitle)} · ${nodes.length} nodes, ${edges.length} edges</p>
</div>
<canvas id="graph-canvas"></canvas>
<div class="graph-legend">${legend}</div>`

  return htmlShell(title, content, nav, graphScript)
}
