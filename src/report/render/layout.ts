/**
 * HTML layout helpers: shell, navigation, and HTML escaping.
 */

import { basename } from 'node:path'

import type { ManifestEntry } from '../../types/transcript.js'
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
// Navigation
// ---------------------------------------------------------------------------

export type NavPage = 'dashboard' | 'transcripts' | 'goals' | 'knowledge' | 'search'

const NAV_ITEMS: Array<{ id: NavPage; label: string; href: string }> = [
  { id: 'dashboard', label: 'Dashboard', href: '../index.html' },
  { id: 'transcripts', label: 'Transcripts', href: '../transcripts/index.html' },
  { id: 'goals', label: 'Goals', href: '../goals/index.html' },
  { id: 'knowledge', label: 'Knowledge', href: '../knowledge/index.html' },
  { id: 'search', label: 'Search', href: '../search.html' },
]

/** Nav items for root-level pages (index.html, search.html) use relative paths */
const NAV_ITEMS_ROOT: Array<{ id: NavPage; label: string; href: string }> = [
  { id: 'dashboard', label: 'Dashboard', href: 'index.html' },
  { id: 'transcripts', label: 'Transcripts', href: 'transcripts/index.html' },
  { id: 'goals', label: 'Goals', href: 'goals/index.html' },
  { id: 'knowledge', label: 'Knowledge', href: 'knowledge/index.html' },
  { id: 'search', label: 'Search', href: 'search.html' },
]

export function renderNav(current: NavPage, rootLevel = false): string {
  const items = rootLevel ? NAV_ITEMS_ROOT : NAV_ITEMS
  const links = items
    .map(item => {
      const cls = item.id === current ? 'nav-link active' : 'nav-link'
      return `<a href="${escHtml(item.href)}" class="${cls}">${escHtml(item.label)}</a>`
    })
    .join('')
  return `<nav class="nav"><span class="nav-brand">MemoryTree</span>${links}</nav>`
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

export function htmlShell(title: string, content: string, nav: string, extraHead = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — MemoryTree</title>
<style>${REPORT_CSS}</style>
${extraHead}
</head>
<body>
${nav}
<div class="container">
${content}
</div>
</body>
</html>`
}
