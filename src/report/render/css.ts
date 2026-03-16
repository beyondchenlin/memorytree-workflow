/**
 * GitHub Dark-inspired CSS for the report website.
 * Self-contained — no external CDN dependencies.
 */

export const REPORT_CSS = `
:root {
  --bg: #0d1117;
  --bg-secondary: #161b22;
  --bg-card: #21262d;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --accent-hover: #79b8ff;
  --green-0: #161b22;
  --green-1: #0e4429;
  --green-2: #006d32;
  --green-3: #26a641;
  --green-4: #39d353;
  --user-bg: #1c2d3e;
  --user-border: #388bfd44;
  --assistant-bg: #1c1c1c;
  --assistant-border: #30363d;
  --code-bg: #161b22;
  --badge-codex: #1f6feb;
  --badge-claude: #6e40c9;
  --badge-gemini: #1a7f37;
  --danger: #f85149;
  --warning: #d29922;
  --success: #3fb950;
  --font-mono: 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { font-size: 16px; scroll-behavior: smooth; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
  line-height: 1.6;
  min-height: 100vh;
}

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }

code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--code-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  border: 1px solid var(--border);
}

pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}

pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.875rem;
}

h1, h2, h3, h4, h5, h6 {
  color: var(--text);
  line-height: 1.3;
  margin-bottom: 0.5rem;
}

h1 { font-size: 1.75rem; }
h2 { font-size: 1.375rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-top: 1.5rem; margin-bottom: 0.75rem; }
h3 { font-size: 1.125rem; }

p { margin-bottom: 0.75rem; }

ul, ol { padding-left: 1.5rem; margin-bottom: 0.75rem; }
li { margin-bottom: 0.25rem; }

table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--text-muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; background: var(--bg-secondary); }
tr:hover td { background: var(--bg-secondary); }

/* ── Nav ── */
.nav {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 0 1.5rem;
  display: flex;
  align-items: center;
  gap: 0;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-brand {
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
  padding: 0.75rem 1rem 0.75rem 0;
  margin-right: 0.5rem;
  border-right: 1px solid var(--border);
}

.nav-link {
  display: inline-block;
  padding: 0.75rem 1rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  transition: color 0.15s;
}

.nav-link:hover { color: var(--text); text-decoration: none; }
.nav-link.active { color: var(--text); border-bottom: 2px solid var(--accent); }

/* ── Layout ── */
.container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }

.page-header { margin-bottom: 2rem; }
.page-header h1 { font-size: 1.5rem; }
.page-header .subtitle { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem; }

/* ── Cards ── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.card-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1;
}

.stat-label { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

/* ── Charts ── */
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

@media (max-width: 900px) {
  .chart-grid { grid-template-columns: 1fr; }
}

.chart-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
}

.chart-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.chart-card svg { display: block; width: 100%; overflow: visible; }
.chart-card.full-width { grid-column: 1 / -1; }

/* ── Badge ── */
.badge {
  display: inline-block;
  padding: 0.2em 0.6em;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge-codex { background: #1f6feb33; color: #58a6ff; border: 1px solid #1f6feb66; }
.badge-claude { background: #6e40c933; color: #bc8cff; border: 1px solid #6e40c966; }
.badge-gemini { background: #1a7f3733; color: #3fb950; border: 1px solid #1a7f3766; }
.badge-unknown { background: #30363d33; color: #8b949e; border: 1px solid #30363d66; }

/* ── Messages ── */
.messages { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem; }

.message {
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid;
  max-width: 100%;
}

.message-user {
  background: var(--user-bg);
  border-color: var(--user-border);
  align-self: flex-start;
}

.message-assistant {
  background: var(--assistant-bg);
  border-color: var(--assistant-border);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.message-role {
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: capitalize;
}

.message-user .message-role { color: #58a6ff; }
.message-assistant .message-role { color: #8b949e; }

.message-body { font-size: 0.9rem; line-height: 1.7; word-break: break-word; }
.message-body p { margin-bottom: 0.5rem; }
.message-body p:last-child { margin-bottom: 0; }

/* ── Summary card ── */
.summary-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.summary-card .summary-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
  margin-bottom: 0.4rem;
}

/* ── Metadata table ── */
.meta-table { font-size: 0.85rem; margin-bottom: 1.25rem; }
.meta-table td:first-child { color: var(--text-muted); width: 140px; font-weight: 500; }

/* ── Backlinks ── */
.backlinks {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 1.25rem;
  font-size: 0.85rem;
}

.backlinks-title { font-weight: 600; color: var(--text-muted); margin-bottom: 0.4rem; font-size: 0.8rem; text-transform: uppercase; }
.backlinks ul { padding-left: 1rem; }

/* ── Search ── */
.search-box {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: var(--text);
  font-size: 1rem;
  font-family: inherit;
  margin-bottom: 1rem;
  outline: none;
  transition: border-color 0.15s;
}

.search-box:focus { border-color: var(--accent); }

.search-results { display: flex; flex-direction: column; gap: 0.75rem; }

.search-result {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  transition: border-color 0.15s;
}

.search-result:hover { border-color: var(--accent); }
.search-result-title { font-weight: 600; margin-bottom: 0.25rem; }
.search-result-meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.search-result-snippet { font-size: 0.85rem; color: var(--text-muted); }
.search-result mark { background: #3d3000; color: var(--warning); border-radius: 2px; padding: 0 0.1em; }
#search-count { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem; }

/* ── Heatmap legend ── */
.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
  justify-content: flex-end;
}

/* ── Responsive ── */
@media (max-width: 600px) {
  .nav { padding: 0 0.75rem; }
  .container { padding: 1rem 0.75rem; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
`
