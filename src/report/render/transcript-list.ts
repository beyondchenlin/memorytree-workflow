/**
 * Session list page: tabular index of all imported transcripts, with client and project filters.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import type { Translations } from '../i18n/types.js'
import { clientBadge, escHtml, htmlShell, renderNav, transcriptUrlFromRoot } from './layout.js'
import { renderTagBadges } from '../tags.js'
import { projectNameOfManifest } from './projects.js'

// ---------------------------------------------------------------------------
// Transcript list
// ---------------------------------------------------------------------------

export function renderTranscriptList(
  manifests: ManifestEntry[],
  t?: Translations,
  summaries?: Record<string, string>,
  tags?: Record<string, string[]>,
): string {
  const nav = renderNav('transcripts', 1, t)

  const sorted = [...manifests].sort((a, b) => b.started_at.localeCompare(a.started_at))

  const title = t?.sessions.title ?? 'Sessions'
  const clientLabel = t?.sessions.client ?? 'Client'
  const dateLabel = t?.sessions.date ?? 'Date'
  const idLabel = t?.sessions.id ?? 'ID'
  const msgsLabel = t?.sessions.msgs ?? 'Msgs'
  const toolsLabel = t?.sessions.tools ?? 'Tools'
  const allLabel = t?.sessions.all ?? 'All'
  const projectLabel = t?.sessions.project ?? 'Project'
  const allProjectsLabel = t?.sessions.allProjects ?? 'All Projects'
  const importedCountTemplate = t?.sessions.importedCount ?? '{count} session(s) imported'
  const shownForProjectTemplate = t?.sessions.shownForProject ?? '{count} session(s) shown for project "{project}"'

  if (sorted.length === 0) {
    const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle">${escHtml(t?.sessions.noSessions ?? 'No sessions imported yet.')}</p>
</div>`
    return htmlShell(title, content, nav)
  }

  const clientSet = new Set<string>()
  for (const manifest of sorted) clientSet.add(manifest.client)
  const clients = [...clientSet].sort()

  const projects = [...new Set(sorted.map(projectNameOfManifest))].sort()
  const projectCounts = new Map<string, number>()
  for (const project of sorted.map(projectNameOfManifest)) {
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1)
  }

  const tabBar = renderTabBar(allLabel, clients, sorted)
  const projectFilter = renderProjectFilter(projects, projectCounts, sorted.length, allProjectsLabel, projectLabel)

  const rows = sorted
    .map(manifest => {
      const url = transcriptHref(manifest)
      const project = projectNameOfManifest(manifest)
      const projectHref = `index.html?project=${encodeURIComponent(project)}`
      const date = manifest.started_at.slice(0, 10)
      const time = manifest.started_at.slice(11, 16)
      const badge = clientBadge(manifest.client)
      const summary = summaries?.[manifest.session_id] ?? ''
      const sessionTags = tags?.[manifest.session_id] ?? []
      const tagBadges = renderTagBadges(sessionTags)
      const meta = `${escHtml(manifest.client)} | ${escHtml(date)} | ${manifest.message_count} ${escHtml(msgsLabel)}`

      return `<tr data-client="${escHtml(manifest.client)}" data-project="${escHtml(project)}">
  <td>${badge}</td>
  <td><a href="${escHtml(url)}" data-summary="${escHtml(summary)}" data-meta="${escHtml(meta)}">${escHtml(manifest.title || manifest.session_id)}</a>${tagBadges}</td>
  <td><a href="${escHtml(projectHref)}" class="table-filter-link">${escHtml(project)}</a></td>
  <td style="color:var(--text-muted)">${escHtml(date)} ${escHtml(time)}</td>
  <td style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem">${escHtml(manifest.session_id.slice(0, 8))}</td>
  <td style="text-align:right;color:var(--text-muted)">${manifest.message_count}</td>
  <td style="text-align:right;color:var(--text-muted)">${manifest.tool_event_count}</td>
</tr>`
    })
    .join('')

  const filterJs = `<script>
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var tabs = document.querySelectorAll('.tab-btn');
    var rows = document.querySelectorAll('tr[data-client]');
    var projectSelect = document.getElementById('project-filter');
    var subtitle = document.getElementById('sessions-subtitle');
    var clientFilter = '';
    var totalRows = rows.length;
    var importedCountTemplate = ${JSON.stringify(importedCountTemplate)};
    var shownForProjectTemplate = ${JSON.stringify(shownForProjectTemplate)};

    function formatTemplate(template, values) {
      var result = template;
      Object.keys(values).forEach(function(key) {
        result = result.split('{' + key + '}').join(String(values[key]));
      });
      return result;
    }

    function syncProjectFilter(project) {
      if (!window.history || !window.history.replaceState) return;
      var url = new URL(window.location.href);
      if (project) {
        url.searchParams.set('project', project);
      } else {
        url.searchParams.delete('project');
      }
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }

    function updateSubtitle(visibleCount, project) {
      if (!subtitle) return;
      if (project) {
        subtitle.textContent = formatTemplate(shownForProjectTemplate, {
          count: String(visibleCount),
          project: project,
        });
        return;
      }
      subtitle.textContent = formatTemplate(importedCountTemplate, {
        count: String(totalRows),
      });
    }

    function applyFilters() {
      var projectFilter = projectSelect ? projectSelect.value : '';
      var visibleCount = 0;
      rows.forEach(function(row) {
        var matchesClient = !clientFilter || row.getAttribute('data-client') === clientFilter;
        var matchesProject = !projectFilter || row.getAttribute('data-project') === projectFilter;
        var visible = matchesClient && matchesProject;
        row.style.display = visible ? '' : 'none';
        if (visible) visibleCount += 1;
      });
      updateSubtitle(visibleCount, projectFilter);
      syncProjectFilter(projectFilter);
    }

    var initialProject = '';
    try {
      initialProject = new URL(window.location.href).searchParams.get('project') || '';
    } catch {}

    if (projectSelect && initialProject) {
      projectSelect.value = initialProject;
    }

    tabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        tabs.forEach(function(other) { other.classList.remove('active'); });
        btn.classList.add('active');
        clientFilter = btn.getAttribute('data-filter') || '';
        applyFilters();
      });
    });

    if (projectSelect) {
      projectSelect.addEventListener('change', applyFilters);
    }

    applyFilters();
  });
})();
</script>`

  const content = `<div class="page-header">
  <h1>${escHtml(title)}</h1>
  <p class="subtitle" id="sessions-subtitle">${escHtml(formatTemplate(importedCountTemplate, { count: String(sorted.length) }))}</p>
</div>
${tabBar}
${projectFilter}
<div class="card" style="padding:0;overflow:hidden">
<table>
<thead><tr>
  <th>${escHtml(clientLabel)}</th>
  <th>Title</th>
  <th>${escHtml(projectLabel)}</th>
  <th>${escHtml(dateLabel)}</th>
  <th>${escHtml(idLabel)}</th>
  <th style="text-align:right">${escHtml(msgsLabel)}</th>
  <th style="text-align:right">${escHtml(toolsLabel)}</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`

  return htmlShell(title, content, nav, filterJs)
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function renderTabBar(allLabel: string, clients: string[], manifests: ManifestEntry[]): string {
  const total = manifests.length
  const tabs = [
    `<button class="tab-btn active" data-filter="" type="button">${escHtml(allLabel)} (${total})</button>`,
    ...clients.map(client => {
      const count = manifests.filter(manifest => manifest.client === client).length
      return `<button class="tab-btn" data-filter="${escHtml(client)}" type="button">${escHtml(client)} (${count})</button>`
    }),
  ]
  return `<div class="tab-bar">${tabs.join('')}</div>`
}

function renderProjectFilter(
  projects: string[],
  projectCounts: Map<string, number>,
  total: number,
  allProjectsLabel: string,
  projectLabel: string,
): string {
  const options = [
    `<option value="">${escHtml(allProjectsLabel)} (${total})</option>`,
    ...projects.map(project => `<option value="${escHtml(project)}">${escHtml(project)} (${projectCounts.get(project) ?? 0})</option>`),
  ]

  return `<div class="filter-bar">
  <label class="filter-label" for="project-filter">${escHtml(projectLabel)}</label>
  <select id="project-filter" class="search-filter-select">
    ${options.join('\n    ')}
  </select>
</div>`
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function transcriptHref(manifest: ManifestEntry): string {
  return transcriptUrlFromRoot(manifest).replace(/^transcripts\//, '')
}

function formatTemplate(template: string, values: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}
