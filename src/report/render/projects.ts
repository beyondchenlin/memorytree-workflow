/**
 * Projects page: groups sessions by project and links into the filtered session list.
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

export function projectNameOfManifest(manifest: Pick<ManifestEntry, 'project' | 'cwd'>): string {
  const declared = typeof manifest.project === 'string' ? manifest.project.trim() : ''
  return declared || extractProject(manifest.cwd)
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

  const projectMap = new Map<string, ManifestEntry[]>()
  for (const manifest of manifests) {
    const projectName = projectNameOfManifest(manifest)
    const group = projectMap.get(projectName)
    if (group) {
      group.push(manifest)
    } else {
      projectMap.set(projectName, [manifest])
    }
  }

  const sorted = [...projectMap.entries()].sort((a, b) => {
    const byCount = b[1].length - a[1].length
    return byCount !== 0 ? byCount : a[0].localeCompare(b[0])
  })

  const sessionLabel = t?.projects.sessions ?? 'sessions'
  const projectCountTemplate = t?.projects.projectCount ?? '{count} project(s)'
  const cardMetaTemplate = t?.projects.cardMeta ?? '{count} {sessions} - last active {date}'
  const viewSessionsTemplate = t?.projects.viewSessionsForProject ?? 'View sessions for {project}'
  const unknownLabel = t?.common.unknown ?? 'unknown'

  const cards = sorted.map(([name, sessions]) => {
    const count = sessions.length
    const lastActive = sessions
      .map(session => session.started_at)
      .sort()
      .at(-1)
      ?.slice(0, 10) ?? unknownLabel

    const clients = [...new Set(sessions.map(session => session.client))]
    const badges = clients.map(client => clientBadge(client)).join(' ')
    const href = `../transcripts/index.html?project=${encodeURIComponent(name)}`
    const meta = formatTemplate(cardMetaTemplate, {
      count: String(count),
      sessions: sessionLabel,
      date: lastActive,
    })
    const ariaLabel = formatTemplate(viewSessionsTemplate, { project: name })

    return `<a class="project-card project-card-link" href="${escHtml(href)}" aria-label="${escHtml(ariaLabel)}">
  <div class="project-card-name">${escHtml(name)}</div>
  <div class="project-card-meta">
    ${escHtml(meta)}
  </div>
  <div class="project-card-clients">${badges}</div>
</a>`
  }).join('\n')

  const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(formatTemplate(projectCountTemplate, { count: String(sorted.length) }))}</p>
</div>
<div class="project-grid">
${cards}
</div>`

  return htmlShell(title, content, nav)
}

function formatTemplate(template: string, values: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}
