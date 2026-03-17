/**
 * Projects page: groups sessions by their working directory (last segment).
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { Translations } from '../i18n/types.js'
import { clientBadge, escHtml, htmlShell, renderNav } from './layout.js'

// ---------------------------------------------------------------------------
// Project extraction
// ---------------------------------------------------------------------------

export function extractProject(cwd: string): string {
  if (!cwd) return 'unknown'
  return cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Projects page
// ---------------------------------------------------------------------------

export function renderProjects(manifests: ManifestEntry[], t?: Translations): string {
  const nav = renderNav('projects', 1, t)
  const title = t?.projects.title ?? 'Projects'

  if (manifests.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(t?.projects.noProjects ?? 'No projects found.')}</p>
</div>`
    return htmlShell(title, content, nav)
  }

  // Group by project name
  const projectMap = new Map<string, ManifestEntry[]>()
  for (const m of manifests) {
    const proj = extractProject(m.cwd)
    const group = projectMap.get(proj)
    if (group) {
      group.push(m)
    } else {
      projectMap.set(proj, [m])
    }
  }

  // Sort by session count desc
  const sorted = [...projectMap.entries()].sort((a, b) => b[1].length - a[1].length)

  const sessionLabel = t?.projects.sessions ?? 'sessions'

  const cards = sorted.map(([name, sessions]) => {
    const count = sessions.length
    const lastActive = sessions
      .map(s => s.started_at)
      .sort()
      .at(-1)
      ?.slice(0, 10) ?? '—'

    const clients = [...new Set(sessions.map(s => s.client))]
    const badges = clients.map(c => clientBadge(c)).join(' ')

    return `<div class="project-card">
  <div class="project-card-name">${escHtml(name)}</div>
  <div class="project-card-meta">
    ${count} ${escHtml(sessionLabel)} · last active ${escHtml(lastActive)}
  </div>
  <div class="project-card-clients">${badges}</div>
</div>`
  }).join('\n')

  const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${sorted.length} project(s)</p>
</div>
<div class="project-grid">
${cards}
</div>`

  return htmlShell(title, content, nav)
}
