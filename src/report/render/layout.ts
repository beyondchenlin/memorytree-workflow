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
  // Sidebar collapse
  if (localStorage.getItem('mt-sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');
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
    // Sidebar collapse toggle
    var collapseBtn = document.getElementById('sidebar-collapse');
    if (collapseBtn) collapseBtn.addEventListener('click', function() {
      var collapsed = document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('mt-sidebar', collapsed ? 'collapsed' : 'expanded');
    });
    // TOC toggle
    var tocToggle = document.getElementById('toc-toggle');
    var tocList = document.getElementById('toc-list');
    if (tocToggle && tocList) tocToggle.addEventListener('click', function() {
      var expanded = tocToggle.getAttribute('aria-expanded') === 'true';
      tocToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (expanded) { tocList.setAttribute('hidden', ''); } else { tocList.removeAttribute('hidden'); }
    });
    // Reader Mode toggle
    var readerBtn = document.getElementById('reader-toggle');
    if (readerBtn) {
      if (localStorage.getItem('mt-reader') === '1') document.body.classList.add('reader-mode');
      readerBtn.addEventListener('click', function() {
        var on = document.body.classList.toggle('reader-mode');
        localStorage.setItem('mt-reader', on ? '1' : '0');
      });
    }
    // View Transitions API (progressive enhancement)
    if (document.startViewTransition) {
      document.addEventListener('click', function(e) {
        var a = e.target && (e.target.closest ? e.target.closest('a[href]:not([target]):not([download])') : null);
        if (!a) return;
        var href = a.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('http')) return;
        e.preventDefault();
        document.startViewTransition(function() { window.location.href = href; });
      });
    }
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
    { id: 'dashboard', icon: '📊', labelKey: 'dashboard', href: `${p}index.html` },
    { id: 'transcripts', icon: '💬', labelKey: 'sessions', href: `${p}transcripts/index.html` },
    { id: 'projects', icon: '📁', labelKey: 'projects', href: `${p}projects/index.html` },
    { id: 'graph', icon: '🕸️', labelKey: 'graph', href: `${p}graph.html` },
    { id: 'goals', icon: '🎯', labelKey: 'goals', href: `${p}goals/index.html` },
    { id: 'todos', icon: '✅', labelKey: 'todos', href: `${p}todos/index.html` },
    { id: 'knowledge', icon: '📚', labelKey: 'knowledge', href: `${p}knowledge/index.html` },
    { id: 'archive', icon: '🗄️', labelKey: 'archive', href: `${p}archive/index.html` },
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
    return `<a href="${escHtml(item.href)}" class="${cls}" title="${escHtml(label(item))}">${escHtml(item.icon)} <span class="nav-label">${escHtml(label(item))}</span></a>`
  }).join('\n      ')

  return `<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <span class="sidebar-brand">MemoryTree</span>
    <button class="sidebar-collapse-btn" id="sidebar-collapse" type="button" title="Collapse sidebar">«</button>
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

export interface HtmlShellOptions {
  extraHead?: string
  lang?: string
  breadcrumb?: string
  /** Inject reader-mode toggle button into the page */
  readerMode?: boolean
  /** Open Graph description (og:description). Truncated to 200 chars. */
  ogDescription?: string
  /** Absolute URL for og:url. Omitted when empty. */
  ogUrl?: string
}

export function htmlShell(
  title: string,
  content: string,
  nav: string,
  extraHeadOrOpts: string | HtmlShellOptions = '',
  lang = 'en',
): string {
  // Accept legacy string arg (extraHead) or new options object
  const opts: HtmlShellOptions = typeof extraHeadOrOpts === 'string'
    ? { extraHead: extraHeadOrOpts, lang }
    : extraHeadOrOpts
  const extraHead = opts.extraHead ?? ''
  const resolvedLang = opts.lang ?? lang
  const breadcrumb = opts.breadcrumb ?? ''
  const readerBtn = opts.readerMode !== false
    ? `<button class="reader-toggle-btn" id="reader-toggle" type="button" title="Toggle reader mode">📖</button>`
    : ''

  // Open Graph meta tags
  const ogDesc = opts.ogDescription ? opts.ogDescription.slice(0, 200) : ''
  const ogMeta = [
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:type" content="website">`,
    ogDesc ? `<meta property="og:description" content="${escHtml(ogDesc)}">` : '',
    opts.ogUrl ? `<meta property="og:url" content="${escHtml(opts.ogUrl)}">` : '',
  ].filter(Boolean).join('\n')

  const topbar = `<header class="topbar" id="topbar">
  <span class="topbar-brand">MemoryTree</span>
  <div class="topbar-actions">
    <button class="theme-toggle-btn" id="theme-toggle-mobile" type="button">☀</button>
    <button class="hamburger" id="hamburger" type="button">☰</button>
  </div>
</header>`

  return `<!DOCTYPE html>
<html lang="${escHtml(resolvedLang)}" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — MemoryTree</title>
${ogMeta}
<style>${REPORT_CSS}</style>
${extraHead}
${SIDEBAR_INLINE_JS}
</head>
<body>
${topbar}
${nav}
<div class="main-content">
  <div class="container">
${breadcrumb ? `${breadcrumb}\n` : ''}<div style="display:flex;justify-content:flex-end;margin-bottom:0.5rem">${readerBtn}</div>
${content}
  </div>
</div>
</body>
</html>`
}
