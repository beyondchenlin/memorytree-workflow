/**
 * Full-text search: pre-built JSON index embedded as inline JS.
 * Vanilla JS substring search, no external library.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { SearchIndexEntry } from '../../types/report.js'
import type { Translations } from '../i18n/types.js'
import { escHtml, htmlShell, renderNav, transcriptUrlFromRoot } from './layout.js'

const MAX_INDEX_BYTES = 50_000
const SNIPPET_LEN = 200
const SEARCH_TEXT_LEN = 700

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

export function buildSearchIndex(
  manifests: ManifestEntry[],
  getSnippet: (m: ManifestEntry) => string,
  getSearchText: (m: ManifestEntry) => string = getSnippet,
): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = []
  let totalBytes = 0

  for (const m of manifests) {
    let snippet = getSnippet(m).slice(0, SNIPPET_LEN)
    let searchText = getSearchText(m).slice(0, SEARCH_TEXT_LEN)
    const project = m.project || lastPathSegment(m.cwd) || 'unknown'

    // Check if truncating the snippet is needed to stay within budget
    const baseBytes = JSON.stringify({
      url: transcriptUrl(m),
      title: m.title || m.session_id,
      client: m.client,
      project,
      date: m.started_at.slice(0, 10),
      snippet: '',
      search_text: '',
    }).length
    const budgetForText = MAX_INDEX_BYTES - totalBytes - baseBytes - 10
    if (budgetForText < 20) break

    const combinedText = snippet.length + searchText.length
    if (combinedText > budgetForText) {
      const snippetBudget = Math.min(
        snippet.length,
        budgetForText,
        Math.max(40, Math.floor(budgetForText * 0.35)),
      )
      const searchBudget = Math.max(0, budgetForText - snippetBudget)
      snippet = snippet.slice(0, snippetBudget)
      searchText = searchText.slice(0, searchBudget)
    }

    const entry: SearchIndexEntry = {
      url: transcriptUrl(m),
      title: m.title || m.session_id,
      client: m.client,
      project,
      date: m.started_at.slice(0, 10),
      snippet,
      ...(searchText ? { search_text: searchText } : {}),
    }
    totalBytes += JSON.stringify(entry).length
    entries.push(entry)
  }

  return entries
}

function transcriptUrl(m: ManifestEntry): string {
  return transcriptUrlFromRoot(m)
}

function lastPathSegment(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
}

// ---------------------------------------------------------------------------
// Search page renderer
// ---------------------------------------------------------------------------

export function renderSearchPage(index: SearchIndexEntry[], t?: Translations): string {
  // Escape </script> to prevent script-injection via manifest-controlled content
  const indexJson = JSON.stringify(index).replace(/<\//g, '<\\/')
  const nav = renderNav('search', 0, t)
  const title = t?.search.title ?? 'Search'
  const placeholder = t?.search.placeholder ?? 'Search sessions, messages, and content...'

  // Build unique client and project lists for filter dropdowns
  const clients = [...new Set(index.map(e => e.client).filter(Boolean))].sort()
  const projects = [...new Set(index.map(e => e.project).filter(Boolean))].sort()

  const clientOptions = clients
    .map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`)
    .join('')
  const projectOptions = projects
    .map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`)
    .join('')

  const extraHead = `<script>
const SEARCH_INDEX = ${indexJson};
</script>`

  const content = `
<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">Full-text search across all imported sessions</p>
</div>

<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
  <select id="filter-client" class="search-filter-select">
    <option value="">All Clients</option>
    ${clientOptions}
  </select>
  <select id="filter-project" class="search-filter-select">
    <option value="">All Projects</option>
    ${projectOptions}
  </select>
</div>
<input
  type="search"
  id="search-input"
  class="search-box"
  placeholder="${escHtml(placeholder)}"
  autofocus
>
<div id="search-count"></div>
<div id="search-results" class="search-results"></div>

<script>
(function() {
  var input = document.getElementById('search-input');
  var resultsEl = document.getElementById('search-results');
  var countEl = document.getElementById('search-count');
  var clientSel = document.getElementById('filter-client');
  var projectSel = document.getElementById('filter-project');

  function highlight(text, query) {
    if (!query) return escHtml(text);
    var escaped = escHtml(text);
    var escapedQ = escHtml(query);
    var lower = escaped.toLowerCase();
    var lowerQ = escapedQ.toLowerCase();
    if (!lowerQ) return escaped;
    var result = '';
    var i = 0;
    while (i < escaped.length) {
      var idx = lower.indexOf(lowerQ, i);
      if (idx === -1) { result += escaped.slice(i); break; }
      result += escaped.slice(i, idx) + '<mark>' + escaped.slice(idx, idx + lowerQ.length) + '</mark>';
      i = idx + lowerQ.length;
    }
    return result;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderResults() {
    var query = (input.value || '');
    var q = query.toLowerCase().trim();
    var filterClient = clientSel ? clientSel.value : '';
    var filterProject = projectSel ? projectSel.value : '';
    var filtered = SEARCH_INDEX.filter(function(e) {
      if (filterClient && e.client !== filterClient) return false;
      if (filterProject && e.project !== filterProject) return false;
      if (!q) return true;
       return (e.title || '').toLowerCase().includes(q) ||
              (e.snippet || '').toLowerCase().includes(q) ||
              (e.search_text || '').toLowerCase().includes(q);
     });
    if (!q && !filterClient && !filterProject) {
      resultsEl.innerHTML = '';
      countEl.textContent = SEARCH_INDEX.length + ' session(s) indexed';
      return;
    }
    countEl.textContent = filtered.length + ' result(s)' + (q ? ' for "' + escHtml(q) + '"' : '');
    resultsEl.innerHTML = filtered.map(function(e) {
      return '<div class="search-result">' +
        '<div class="search-result-title"><a href="' + escHtml(e.url) + '">' + highlight(e.title, query) + '</a></div>' +
        '<div class="search-result-meta"><span class="badge badge-' + escHtml(e.client) + '">' + escHtml(e.client) + '</span> &nbsp; ' + escHtml(e.date) + '</div>' +
        '<div class="search-result-snippet">' + highlight(e.snippet, query) + '</div>' +
        '</div>';
    }).join('');
  }

  renderResults();
  input.addEventListener('input', renderResults);
  if (clientSel) clientSel.addEventListener('change', renderResults);
  if (projectSel) projectSel.addEventListener('change', renderResults);
})();
</script>`

  return htmlShell(title, content, nav, extraHead)
}
