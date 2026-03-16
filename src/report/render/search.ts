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

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

export function buildSearchIndex(
  manifests: ManifestEntry[],
  getSnippet: (m: ManifestEntry) => string,
): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = []
  let totalBytes = 0

  for (const m of manifests) {
    let snippet = getSnippet(m).slice(0, SNIPPET_LEN)
    const entry: SearchIndexEntry = {
      url: transcriptUrl(m),
      title: m.title || m.session_id,
      client: m.client,
      date: m.started_at.slice(0, 10),
      snippet,
    }
    const entryBytes = JSON.stringify(entry).length
    if (totalBytes + entryBytes > MAX_INDEX_BYTES) {
      // Truncate snippet to fit within budget
      const remaining = MAX_INDEX_BYTES - totalBytes - (entryBytes - snippet.length) - 10
      if (remaining < 20) break
      snippet = snippet.slice(0, remaining)
      entry.snippet = snippet
    }
    totalBytes += JSON.stringify(entry).length
    entries.push(entry)
  }

  return entries
}

function transcriptUrl(m: ManifestEntry): string {
  return transcriptUrlFromRoot(m)
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

  const extraHead = `<script>
const SEARCH_INDEX = ${indexJson};
</script>`

  const content = `
<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">Full-text search across all imported sessions</p>
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
  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');
  const countEl = document.getElementById('search-count');

  function highlight(text, query) {
    if (!query) return escHtml(text);
    const escaped = escHtml(text);
    const escapedQ = escHtml(query);
    const lower = escaped.toLowerCase();
    const lowerQ = escapedQ.toLowerCase();
    if (!lowerQ) return escaped;
    let result = '';
    let i = 0;
    while (i < escaped.length) {
      const idx = lower.indexOf(lowerQ, i);
      if (idx === -1) { result += escaped.slice(i); break; }
      result += escaped.slice(i, idx) + '<mark>' + escaped.slice(idx, idx + lowerQ.length) + '</mark>';
      i = idx + lowerQ.length;
    }
    return result;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderResults(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      resultsEl.innerHTML = '';
      countEl.textContent = SEARCH_INDEX.length + ' session(s) indexed';
      return;
    }
    const matches = SEARCH_INDEX.filter(function(e) {
      return (e.title || '').toLowerCase().includes(q) ||
             (e.snippet || '').toLowerCase().includes(q) ||
             (e.client || '').toLowerCase().includes(q);
    });
    countEl.textContent = matches.length + ' result(s) for "' + escHtml(q) + '"';
    resultsEl.innerHTML = matches.map(function(e) {
      return '<div class="search-result">' +
        '<div class="search-result-title"><a href="' + escHtml(e.url) + '">' + highlight(e.title, query) + '</a></div>' +
        '<div class="search-result-meta"><span class="badge badge-' + escHtml(e.client) + '">' + escHtml(e.client) + '</span> &nbsp; ' + escHtml(e.date) + '</div>' +
        '<div class="search-result-snippet">' + highlight(e.snippet, query) + '</div>' +
        '</div>';
    }).join('');
  }

  renderResults('');
  input.addEventListener('input', function() { renderResults(input.value); });
})();
</script>`

  return htmlShell(title, content, nav, extraHead)
}
