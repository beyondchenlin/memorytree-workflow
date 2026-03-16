/**
 * HTML layout helpers: shell, navigation, and HTML escaping.
 */

import { basename } from 'node:path'

import type { ManifestEntry } from '../../types/transcript.js'
import type { Translations } from '../i18n/types.js'
import { REPORT_CSS } from './css.js'

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

export function escHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Navigation page IDs
// ---------------------------------------------------------------------------

export type NavPage =
  | 'dashboard'
  | 'transcripts'
  | 'projects'
  | 'graph'
  | 'goals'
  | 'todos'
  | 'knowledge'
  | 'archive'
  | 'search'

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

const SIDEBAR_INLINE_JS = `
<script>
(function() {
  // Theme
  var saved = localStorage.getItem('mt-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  function updateThemeBtn() {
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀ Light' : '☾ Dark';
  }
  document.addEventListener('DOMContentLoaded', function() {
    updateThemeBtn();
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', function() {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('mt-theme', next);
      updateThemeBtn();
    });
    // Mobile hamburger
    var hb = document.getElementById('hamburger');
    var sb = document.getElementById('sidebar');
    var ov = document.getElementById('sidebar-overlay');
    function closeSidebar() {
      if (sb) sb.classList.remove('open');
      if (ov) ov.classList.remove('open');
    }
    if (hb) hb.addEventListener('click', function() {
      if (sb) sb.classList.toggle('open');
      if (ov) ov.classList.toggle('open');
    });
    if (ov) ov.addEventListener('click', closeSidebar);
    // Popover preview
    var popover = null;
    document.querySelectorAll('a[data-summary]').forEach(function(el) {
      el.addEventListener('mouseenter', function(e) {
        var summary = el.getAttribute('data-summary') || '';
        var meta = el.getAttribute('data-meta') || '';
        if (!summary && !meta) return;
        if (!popover) {
          popover = document.createElement('div');
          popover.className = 'popover';
          document.body.appendChild(popover);
        }
        popover.innerHTML = '';
        if (meta) {
          var metaDiv = document.createElement('div');
          metaDiv.className = 'popover-meta';
          metaDiv.textContent = meta;
          popover.appendChild(metaDiv);
        }
        if (summary) {
          var sumDiv = document.createElement('div');
          sumDiv.className = 'popover-summary';
          sumDiv.textContent = summary;
          popover.appendChild(sumDiv);
        }
        popover.style.display = 'block';
        positionPopover(e);
      });
      el.addEventListener('mousemove', positionPopover);
      el.addEventListener('mouseleave', function() {
        if (popover) popover.style.display = 'none';
      });
    });
    function positionPopover(e) {
      if (!popover) return;
      var x = e.clientX + 12;
      var y = e.clientY + 12;
      var pw = popover.offsetWidth || 320;
      var ph = popover.offsetHeight || 80;
      if (x + pw > window.innerWidth - 8) x = e.clientX - pw - 12;
      if (y + ph > window.innerHeight - 8) y = e.clientY - ph - 12;
      popover.style.left = x + 'px';
      popover.style.top = y + 'px';
    }
  });
})();
</script>`

interface NavItem {
  id: NavPage
  icon: string
  labelKey: keyof Translations['nav']
  href: string
}

function buildNavItems(depth: 0 | 1 | 2): NavItem[] {
  const p = '../'.repeat(depth)
  return [
    { id: 'dashboard', icon: '◈', labelKey: 'dashboard', href: `${p}index.html` },
    { id: 'transcripts', icon: '💬', labelKey: 'sessions', href: `${p}transcripts/index.html` },
    { id: 'projects', icon: '📁', labelKey: 'projects', href: `${p}projects/index.html` },
    { id: 'graph', icon: '⬡', labelKey: 'graph', href: `${p}graph.html` },
    { id: 'goals', icon: '🎯', labelKey: 'goals', href: `${p}goals/index.html` },
    { id: 'todos', icon: '✓', labelKey: 'todos', href: `${p}todos/index.html` },
    { id: 'knowledge', icon: '📚', labelKey: 'knowledge', href: `${p}knowledge/index.html` },
    { id: 'archive', icon: '🗄', labelKey: 'archive', href: `${p}archive/index.html` },
    { id: 'search', icon: '🔍', labelKey: 'search', href: `${p}search.html` },
  ]
}

export function renderNav(current: NavPage, depth: 0 | 1 | 2, t?: Translations): string {
  const items = buildNavItems(depth)

  // Labels for each nav item
  const label = (item: NavItem): string => {
    if (t) return t.nav[item.labelKey]
    // Fallback English labels
    const defaults: Record<string, string> = {
      dashboard: 'Dashboard', sessions: 'Sessions', projects: 'Projects',
      graph: 'Graph', goals: 'Goals', todos: 'Todos',
      knowledge: 'Knowledge', archive: 'Archive', search: 'Search',
    }
    return defaults[item.labelKey] ?? item.labelKey
  }

  const themeLabel = '☀ Light'

  const navLinks = items.map(item => {
    const cls = item.id === current ? 'nav-link active' : 'nav-link'
    return `<a href="${escHtml(item.href)}" class="${cls}">${escHtml(item.icon)} ${escHtml(label(item))}</a>`
  }).join('\n      ')

  return `<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <span class="sidebar-brand">MemoryTree</span>
  </div>
  <nav class="sidebar-nav">
    ${navLinks}
  </nav>
  <div class="sidebar-footer">
    <button class="theme-toggle-btn" id="theme-toggle" type="button">${escHtml(themeLabel)}</button>
  </div>
</aside>
<div class="sidebar-overlay" id="sidebar-overlay"></div>`
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transcript URL helpers (single canonical implementation)
// ---------------------------------------------------------------------------

/**
 * Compute the stem (filename without .md) for a manifest's clean path.
 * Falls back to session_id.
 */
export function manifestStem(m: ManifestEntry): string {
  const cleanPath = m.repo_clean_path || m.global_clean_path || ''
  return cleanPath ? basename(cleanPath, '.md') : m.session_id
}

/**
 * URL to a transcript page relative to the **root** of the report output dir.
 * Use this from index.html and transcripts/index.html.
 */
export function transcriptUrlFromRoot(m: ManifestEntry): string {
  return `transcripts/${m.client}/${manifestStem(m)}.html`
}

/**
 * URL to a transcript page relative to **another transcript** page.
 * Use this from individual transcript pages.
 */
export function transcriptUrlFromTranscript(m: ManifestEntry): string {
  return `../${m.client}/${manifestStem(m)}.html`
}

// ---------------------------------------------------------------------------
// Client badge (allowlisted CSS class)
// ---------------------------------------------------------------------------

const KNOWN_CLIENTS = new Set(['codex', 'claude', 'gemini'])

/** Render a coloured client badge. CSS class is allowlisted to prevent injection. */
export function clientBadge(client: string): string {
  const safeClass = KNOWN_CLIENTS.has(client) ? client : 'unknown'
  return `<span class="badge badge-${safeClass}">${escHtml(client)}</span>`
}

// ---------------------------------------------------------------------------
// Shared MarkdownFile type and slug helper
// ---------------------------------------------------------------------------

export interface MarkdownFile {
  filename: string
  title: string
  content: string
}

export function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

export function htmlShell(title: string, content: string, nav: string, extraHead = '', lang = 'en'): string {
  const topbar = `<header class="topbar" id="topbar">
  <span class="topbar-brand">MemoryTree</span>
  <div class="topbar-actions">
    <button class="theme-toggle-btn" id="theme-toggle-mobile" type="button">☀</button>
    <button class="hamburger" id="hamburger" type="button">☰</button>
  </div>
</header>`

  return `<!DOCTYPE html>
<html lang="${escHtml(lang)}" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — MemoryTree</title>
<style>${REPORT_CSS}</style>
${extraHead}
${SIDEBAR_INLINE_JS}
</head>
<body>
${topbar}
${nav}
<div class="main-content">
  <div class="container">
${content}
  </div>
</div>
</body>
</html>`
}
