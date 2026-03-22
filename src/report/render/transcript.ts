import type { ManifestEntry, TranscriptEvent } from '../../types/transcript.js'
import type { Translations } from '../i18n/types.js'
import {
  clientBadge,
  escHtml,
  htmlShell,
  renderNav,
  transcriptUrlFromRoot,
  transcriptUrlFromTranscript,
} from './layout.js'

export interface RenderedMessage {
  role: string
  timestamp: string
  text: string
}

export function renderTranscript(
  messages: RenderedMessage[],
  manifest: ManifestEntry,
  summary: string,
  backlinks: ManifestEntry[],
  t?: Translations,
  reportBaseUrl = '',
  events: TranscriptEvent[] = [],
): string {
  const nav = renderNav('transcripts', 2, t)
  const content = `<div class="transcript-page">
${renderHeader(manifest, events, t)}
${summary ? renderSummaryCard(summary, t) : ''}
${backlinks.length > 0 ? renderBacklinks(backlinks, t) : ''}
${events.length > 0 ? renderReplay(manifest, events) : renderMessages(messages, t)}
</div>`

  const title = manifest.title || manifest.session_id
  const ogUrl = reportBaseUrl
    ? `${reportBaseUrl.replace(/\/$/, '')}/${transcriptUrlFromRoot(manifest)}`
    : ''
  const shellOptions = {
    ...(summary ? { ogDescription: summary } : {}),
    ...(ogUrl ? { ogUrl } : {}),
  }
  return htmlShell(title, content, nav, shellOptions)
}

function renderHeader(m: ManifestEntry, events: TranscriptEvent[], t?: Translations): string {
  const badge = clientBadge(m.client)
  const date = m.started_at.slice(0, 10)
  const time = m.started_at.slice(11, 19)
  const counts = countEventKinds(events)
  const messageCount = m.message_count ?? counts.messages
  const toolCount = m.tool_event_count ?? counts.tools
  const eventCount = m.event_count ?? events.length
  const msgsLabel = t?.transcript.messages ?? 'Messages'
  const toolEventsLabel = t?.transcript.toolEvents ?? 'Tool Events'

  return `<section class="transcript-hero card">
  <div class="transcript-hero-copy">
    <div class="transcript-kicker">Full Replay</div>
    <h1>${escHtml(m.title || m.session_id)}</h1>
    <p class="transcript-subtitle">A structured session playback built from normalized transcript JSON. Messages stay readable, heavy payloads stay folded, and long runs stay searchable.</p>
    <div class="transcript-pill-row">
      <span class="transcript-pill">${badge}</span>
      <span class="transcript-pill"><strong>${messageCount}</strong> ${escHtml(msgsLabel)}</span>
      <span class="transcript-pill"><strong>${toolCount}</strong> ${escHtml(toolEventsLabel)}</span>
      <span class="transcript-pill"><strong>${eventCount}</strong> Events</span>
      ${counts.reasoning > 0 ? `<span class="transcript-pill"><strong>${counts.reasoning}</strong> Reasoning</span>` : ''}
    </div>
  </div>
  <div class="transcript-hero-meta">
    <div class="transcript-meta-label">Started</div>
    <div class="transcript-meta-value">${escHtml(date)} ${escHtml(time)}</div>
    <div class="transcript-meta-label">Branch</div>
    <div class="transcript-meta-code">${escHtml(m.branch || '-')}</div>
    <div class="transcript-meta-label">Working Dir</div>
    <div class="transcript-meta-code">${escHtml(m.cwd || '-')}</div>
  </div>
</section>`
}

function renderSummaryCard(summary: string, t?: Translations): string {
  const label = t?.transcript.aiSummary ?? 'AI Summary'
  return `<div class="summary-card">
  <div class="summary-label">${escHtml(label)}</div>
  <div>${escHtml(summary)}</div>
</div>`
}

function renderBacklinks(backlinks: ManifestEntry[], t?: Translations): string {
  const heading = t?.transcript.referencedBy ?? 'Referenced By'
  const items = backlinks
    .map(m => {
      const url = transcriptHref(m)
      return `<li><a href="${escHtml(url)}">${escHtml(m.title || m.session_id)}</a></li>`
    })
    .join('')
  return `<div class="backlinks">
  <div class="backlinks-title">${escHtml(heading)} ${backlinks.length} session(s)</div>
  <ul>${items}</ul>
</div>`
}

function renderReplay(manifest: ManifestEntry, events: TranscriptEvent[]): string {
  const counts = countEventKinds(events)
  return `<section class="replay-shell" data-replay-root>
  <div class="replay-layout">
    <aside class="replay-sidebar">
      ${renderReplaySessionCard(manifest, counts, events.length)}
      ${renderReplayLegend(counts)}
    </aside>
    <div class="replay-main">
      <div class="replay-banner">
        <div class="replay-banner-title">Conversation Flow</div>
        <div class="replay-banner-text">Use the controls to focus on one slice of the session: human prompts, assistant output, tool traffic, reasoning markers, or system context. The raw structure is preserved without forcing everything into one flat blob.</div>
        <div class="transcript-pill-row">
          <span class="transcript-pill"><strong>${counts.messages}</strong> Messages</span>
          <span class="transcript-pill"><strong>${counts.tools}</strong> Tool Events</span>
          <span class="transcript-pill"><strong>${counts.reasoning}</strong> Reasoning</span>
          <span class="transcript-pill"><strong>${counts.system}</strong> System</span>
        </div>
      </div>
      ${renderReplayToolbar(events.length)}
      <div class="replay-empty-state card" data-replay-empty hidden>
        No events match the current filter.
      </div>
      <div class="transcript-timeline" data-replay-timeline>
        ${events.map(renderEvent).join('\n')}
      </div>
    </div>
  </div>
  ${renderReplayScript()}
</section>`
}

function renderReplaySessionCard(
  manifest: ManifestEntry,
  counts: ReturnType<typeof countEventKinds>,
  eventCount: number,
): string {
  return `<section class="replay-sidebar-card card">
  <div class="replay-section-label">Session Map</div>
  <div class="replay-section-title">${escHtml(manifest.title || manifest.session_id)}</div>
  <div class="replay-meta-grid">
    ${renderMetaRow('Client', manifest.client)}
    ${renderMetaRow('Session', manifest.session_id)}
    ${renderMetaRow('Branch', manifest.branch || '-')}
    ${renderMetaRow('Working Dir', manifest.cwd || '-')}
    ${renderMetaRow('SHA-256', `${manifest.raw_sha256.slice(0, 16)}...`)}
  </div>
  <div class="replay-stat-grid">
    ${renderStatCard('Events', String(eventCount))}
    ${renderStatCard('Messages', String(counts.messages))}
    ${renderStatCard('Tools', String(counts.tools))}
    ${renderStatCard('Reasoning', String(counts.reasoning))}
  </div>
</section>`
}

function renderReplayLegend(counts: ReturnType<typeof countEventKinds>): string {
  return `<section class="replay-sidebar-card card">
  <div class="replay-section-label">Reading Mode</div>
  <div class="replay-note">This page keeps the whole session intact while making long transcripts easier to scan.</div>
  <ul class="replay-legend">
    <li><span class="replay-legend-dot replay-dot-message"></span> Messages stay in left/right conversation bubbles.</li>
    <li><span class="replay-legend-dot replay-dot-tool"></span> Tool calls and results are folded by default.</li>
    <li><span class="replay-legend-dot replay-dot-reasoning"></span> Reasoning steps remain visible without leaking encrypted content.</li>
    <li><span class="replay-legend-dot replay-dot-system"></span> Context, task state, and token counters stay in the timeline for auditability.</li>
  </ul>
  <div class="replay-pill-strip">
    <span class="transcript-pill"><strong>${counts.messages}</strong> dialog</span>
    <span class="transcript-pill"><strong>${counts.tools}</strong> tool traffic</span>
  </div>
</section>`
}

function renderReplayToolbar(eventCount: number): string {
  return `<section class="replay-toolbar card">
  <div class="replay-toolbar-copy">
    <div class="replay-section-label">Controls</div>
    <div class="replay-count" data-replay-count>${eventCount} visible events</div>
  </div>
  <div class="replay-toolbar-controls">
    <div class="replay-filter-row">
      ${renderFilterButton('all', 'All')}
      ${renderFilterButton('message', 'Messages')}
      ${renderFilterButton('tool', 'Tools')}
      ${renderFilterButton('reasoning', 'Reasoning')}
      ${renderFilterButton('system', 'System')}
    </div>
    <div class="replay-toolbar-actions">
      <label class="replay-search-field">
        <span>Search this replay</span>
        <input type="search" class="replay-search-input" placeholder="message, tool, reasoning..." data-replay-search>
      </label>
      <button type="button" class="replay-action-button" data-expand-all>Expand details</button>
      <button type="button" class="replay-action-button" data-collapse-all>Collapse details</button>
    </div>
  </div>
</section>`
}

function renderFilterButton(value: string, label: string): string {
  const activeClass = value === 'all' ? ' is-active' : ''
  return `<button type="button" class="replay-filter${activeClass}" data-filter="${escHtml(value)}">${escHtml(label)}</button>`
}

function renderMetaRow(label: string, value: string): string {
  return `<div class="replay-meta-row">
  <span class="replay-meta-label">${escHtml(label)}</span>
  <span class="replay-meta-value">${escHtml(value)}</span>
</div>`
}

function renderStatCard(label: string, value: string): string {
  return `<div class="replay-stat-card">
  <div class="replay-stat-value">${escHtml(value)}</div>
  <div class="replay-stat-label">${escHtml(label)}</div>
</div>`
}

function renderEvent(event: TranscriptEvent): string {
  if (event.kind === 'message') {
    return renderMessageEvent(event)
  }
  if (event.kind === 'reasoning') {
    return renderReasoningEvent(event)
  }
  if (event.kind === 'tool_call') {
    return renderToolCallEvent(event)
  }
  if (event.kind === 'tool_result') {
    return renderToolResultEvent(event)
  }
  if (event.kind === 'token_count') {
    return renderTokenCountEvent(event)
  }
  if (event.kind === 'task_status') {
    return renderTaskStatusEvent(event)
  }
  if (event.kind === 'context') {
    return renderContextEvent(event)
  }
  return renderSystemEvent(event)
}

function renderMessageEvent(event: Extract<TranscriptEvent, { kind: 'message' }>): string {
  const role = event.role.toLowerCase()
  const align =
    role === 'user'
      ? 'align-user'
      : role === 'assistant'
        ? 'align-assistant'
        : 'align-center'
  const bubbleClass =
    role === 'user'
      ? 'timeline-card-user'
      : role === 'assistant'
        ? 'timeline-card-assistant'
        : 'timeline-card-system'
  const fold = shouldCollapseMessage(role, event.text)
  const phase = event.phase ? `<span class="timeline-chip">${escHtml(event.phase)}</span>` : ''
  const preview = `<p class="event-preview">${escHtml(buildPreview(event.text, 220))}</p>`
  const body = fold
    ? `${preview}${renderFoldedBlock('Expand full message', renderMessageBody(event.text))}`
    : `<div class="message-body">${renderMessageBody(event.text)}</div>`

  return `<article class="timeline-item ${align}" data-event-kind="message" data-event-group="message" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card ${bubbleClass}">
    <div class="timeline-meta">
      <span class="timeline-role">${escHtml(role)}</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      ${phase}
      ${renderTime(event.timestamp)}
    </div>
    ${body}
  </div>
</article>`
}

function renderReasoningEvent(event: Extract<TranscriptEvent, { kind: 'reasoning' }>): string {
  const body = event.redacted
    ? `<p class="event-note">Private reasoning captured. Raw content is encrypted and not displayed.</p>`
    : event.text
      ? `<div class="message-body">${renderMessageBody(event.text)}</div>`
      : `<p class="event-note">${escHtml(event.summary || 'Reasoning step recorded.')}</p>`

  return `<article class="timeline-item align-center" data-event-kind="reasoning" data-event-group="reasoning" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-reasoning">
    <div class="timeline-meta">
      <span class="timeline-role">reasoning</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      ${renderTime(event.timestamp)}
    </div>
    <div class="timeline-title">${escHtml(event.summary || 'Reasoning')}</div>
    ${body}
  </div>
</article>`
}

function renderToolCallEvent(event: Extract<TranscriptEvent, { kind: 'tool_call' }>): string {
  return `<article class="timeline-item align-center" data-event-kind="tool_call" data-event-group="tool" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-tool">
    <div class="timeline-meta">
      <span class="timeline-role">Tool Call</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      <span class="timeline-chip">${escHtml(event.tool_name)}</span>
      ${event.call_id ? `<span class="timeline-chip">${escHtml(event.call_id)}</span>` : ''}
      ${renderTime(event.timestamp)}
    </div>
    <div class="timeline-title">${escHtml(event.summary || event.tool_name)}</div>
    ${renderFoldedBlock('Show input payload', renderValueBlock(event.input))}
  </div>
</article>`
}

function renderToolResultEvent(event: Extract<TranscriptEvent, { kind: 'tool_result' }>): string {
  const exitCode = typeof event.exit_code === 'number'
    ? `<span class="timeline-chip">exit ${event.exit_code}</span>`
    : ''
  return `<article class="timeline-item align-center" data-event-kind="tool_result" data-event-group="tool" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-tool-result">
    <div class="timeline-meta">
      <span class="timeline-role">Tool Result</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      <span class="timeline-chip">${escHtml(event.tool_name)}</span>
      ${event.call_id ? `<span class="timeline-chip">${escHtml(event.call_id)}</span>` : ''}
      ${exitCode}
      ${renderTime(event.timestamp)}
    </div>
    <div class="timeline-title">${escHtml(event.summary || `${event.tool_name} result`)}</div>
    ${renderFoldedBlock('Show output payload', renderValueBlock(event.output))}
  </div>
</article>`
}

function renderTokenCountEvent(event: Extract<TranscriptEvent, { kind: 'token_count' }>): string {
  const pills = [
    typeof event.total_tokens === 'number' ? `<span class="timeline-chip">total ${event.total_tokens}</span>` : '',
    typeof event.input_tokens === 'number' ? `<span class="timeline-chip">in ${event.input_tokens}</span>` : '',
    typeof event.output_tokens === 'number' ? `<span class="timeline-chip">out ${event.output_tokens}</span>` : '',
    typeof event.reasoning_tokens === 'number' ? `<span class="timeline-chip">reason ${event.reasoning_tokens}</span>` : '',
  ].filter(Boolean).join('')

  return `<article class="timeline-item align-center" data-event-kind="token_count" data-event-group="system" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-system compact-card">
    <div class="timeline-meta">
      <span class="timeline-role">token_count</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      ${renderTime(event.timestamp)}
    </div>
    <div class="timeline-title">${escHtml(event.summary || 'Token usage updated.')}</div>
    <div class="timeline-pill-stack">${pills}</div>
  </div>
</article>`
}

function renderTaskStatusEvent(event: Extract<TranscriptEvent, { kind: 'task_status' }>): string {
  const tail = event.last_agent_message
    ? renderFoldedBlock('Show task summary', `<div class="message-body">${renderMessageBody(event.last_agent_message)}</div>`)
    : ''
  return `<article class="timeline-item align-center" data-event-kind="task_status" data-event-group="system" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-system compact-card">
    <div class="timeline-meta">
      <span class="timeline-role">task_${escHtml(event.status)}</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      ${event.turn_id ? `<span class="timeline-chip">${escHtml(event.turn_id)}</span>` : ''}
      ${renderTime(event.timestamp)}
    </div>
    <div class="timeline-title">${escHtml(event.summary || `Task ${event.status}`)}</div>
    ${tail}
  </div>
</article>`
}

function renderContextEvent(event: Extract<TranscriptEvent, { kind: 'context' }>): string {
  const preview = renderMetadataPreview(event.metadata)
  return `<article class="timeline-item align-center" data-event-kind="context" data-event-group="system" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-context compact-card">
    <div class="timeline-meta">
      <span class="timeline-role">${escHtml(event.title)}</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      ${renderTime(event.timestamp)}
    </div>
    ${preview ? `<div class="timeline-pill-stack">${preview}</div>` : ''}
    ${renderFoldedBlock('Show context payload', renderValueBlock(event.metadata))}
  </div>
</article>`
}

function renderSystemEvent(event: Extract<TranscriptEvent, { kind: 'system' }>): string {
  const previewText = event.text || event.summary || event.title || 'System event'
  return `<article class="timeline-item align-center" data-event-kind="system" data-event-group="system" data-search-text="${escHtml(eventSearchText(event))}" id="event-${event.sequence}">
  <span class="timeline-marker"></span>
  <div class="timeline-card timeline-card-system compact-card">
    <div class="timeline-meta">
      <span class="timeline-role">${escHtml(event.title || 'system')}</span>
      <span class="timeline-sequence">#${event.sequence + 1}</span>
      ${renderTime(event.timestamp)}
    </div>
    <div class="timeline-title">${escHtml(buildPreview(previewText, 220))}</div>
    ${renderFoldedBlock('Show event payload', renderValueBlock(event.metadata ?? event.text ?? event.summary))}
  </div>
</article>`
}

function renderMessages(messages: RenderedMessage[], t?: Translations): string {
  const heading = t?.transcript.messages ?? 'Messages'
  const noMessages = t?.transcript.noMessages ?? 'No messages available for this session.'
  if (messages.length === 0) {
    return `<div class="card" style="color:var(--text-muted)">${escHtml(noMessages)}</div>`
  }

  const rendered = messages
    .map(msg => {
      const roleClass = msg.role === 'user' ? 'message-user' : 'message-assistant'
      const ts = msg.timestamp ? `<span style="margin-left:auto">${escHtml(msg.timestamp.slice(11, 19))}</span>` : ''
      const body = renderMessageBody(msg.text)
      return `<div class="message ${roleClass}">
  <div class="message-header">
    <span class="message-role">${escHtml(msg.role)}</span>${ts}
  </div>
  <div class="message-body">${body}</div>
</div>`
    })
    .join('\n')

  return `<h2 style="margin-top:1.5rem">${escHtml(heading)}</h2>
<div class="messages">${rendered}</div>`
}

function renderMessageBody(text: string): string {
  const parts: string[] = []
  const codeBlockRe = /```[\w-]*\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderInlineText(text.slice(lastIndex, match.index)))
    }
    const code = match[1] ?? ''
    parts.push(`<pre><code>${escHtml(code)}</code></pre>`)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(renderInlineText(text.slice(lastIndex)))
  }

  return parts.join('')
}

function renderInlineText(text: string): string {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim())
  return paragraphs
    .map(p => `<p>${applyInlineMarkdown(escHtml(p.trim()))}</p>`)
    .join('')
}

function applyInlineMarkdown(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function renderTime(timestamp: string | null | undefined): string {
  if (!timestamp) return ''
  return `<span class="timeline-time">${escHtml(timestamp.slice(11, 19) || timestamp)}</span>`
}

function renderFoldedBlock(summary: string, body: string): string {
  if (!body) return ''
  return `<details class="timeline-fold">
  <summary>${escHtml(summary)}</summary>
  <div class="timeline-fold-body">${body}</div>
</details>`
}

function renderValueBlock(value: unknown): string {
  const formatted = formatValue(value)
  if (!formatted) return '<p class="event-note">No payload captured.</p>'
  return `<pre><code>${escHtml(formatted)}</code></pre>`
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderMetadataPreview(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return ''
  const keys = ['model', 'cwd', 'current_date', 'timezone', 'approval_policy', 'source', 'cli_version', 'model_provider']
  return keys
    .map(key => {
      const value = metadata[key]
      if (value === null || value === undefined || value === '') return ''
      return `<span class="timeline-chip">${escHtml(key)}=${escHtml(String(value))}</span>`
    })
    .filter(Boolean)
    .join('')
}

function eventSearchText(event: TranscriptEvent): string {
  if (event.kind === 'message') {
    return buildPreview(`${event.role} ${event.phase ?? ''} ${event.text}`.trim(), 420)
  }
  if (event.kind === 'reasoning') {
    return buildPreview(`reasoning ${event.summary ?? ''} ${event.text ?? ''}`.trim(), 420)
  }
  if (event.kind === 'tool_call' || event.kind === 'tool_result') {
    return buildPreview(`${event.tool_name} ${event.call_id ?? ''} ${event.summary ?? ''}`.trim(), 420)
  }
  return buildPreview(`${event.title ?? event.kind} ${event.summary ?? ''}`.trim(), 420)
}

function countEventKinds(events: TranscriptEvent[]): {
  messages: number
  tools: number
  reasoning: number
  system: number
} {
  let messages = 0
  let tools = 0
  let reasoning = 0
  let system = 0

  for (const event of events) {
    if (event.kind === 'message') messages++
    else if (event.kind === 'tool_call' || event.kind === 'tool_result') tools++
    else if (event.kind === 'reasoning') reasoning++
    else system++
  }

  return { messages, tools, reasoning, system }
}

function shouldCollapseMessage(role: string, text: string): boolean {
  if (role !== 'user' && role !== 'assistant') return true
  if (text.length > 1400) return true
  return looksLikeContextDump(text)
}

function looksLikeContextDump(text: string): boolean {
  const markers = [
    '<INSTRUCTIONS>',
    '<environment_context>',
    '<permissions instructions>',
    '<collaboration_mode>',
    '# AGENTS.md instructions for',
  ]
  return markers.some(marker => text.includes(marker))
}

function buildPreview(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return normalized.slice(0, limit - 3) + '...'
}

function renderReplayScript(): string {
  return `<script>
(function() {
  var root = document.querySelector('[data-replay-root]');
  if (!root) return;

  var items = Array.prototype.slice.call(root.querySelectorAll('.timeline-item'));
  var details = Array.prototype.slice.call(root.querySelectorAll('.timeline-fold'));
  var countEl = root.querySelector('[data-replay-count]');
  var emptyEl = root.querySelector('[data-replay-empty]');
  var searchInput = root.querySelector('[data-replay-search]');
  var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-filter]'));
  var expandBtn = root.querySelector('[data-expand-all]');
  var collapseBtn = root.querySelector('[data-collapse-all]');
  var state = { filter: 'all', query: '' };

  function applyFilters() {
    var visibleCount = 0;
    items.forEach(function(item) {
      var group = item.getAttribute('data-event-group') || 'system';
      var haystack = (item.getAttribute('data-search-text') || '').toLowerCase();
      var matchesFilter = state.filter === 'all' || group === state.filter;
      var matchesQuery = !state.query || haystack.indexOf(state.query) !== -1;
      var hidden = !(matchesFilter && matchesQuery);
      item.classList.toggle('is-hidden', hidden);
      if (!hidden) visibleCount += 1;
    });

    buttons.forEach(function(button) {
      var active = (button.getAttribute('data-filter') || 'all') === state.filter;
      button.classList.toggle('is-active', active);
    });

    if (countEl) {
      countEl.textContent = visibleCount + ' visible events';
    }
    if (emptyEl) {
      emptyEl.hidden = visibleCount !== 0;
    }
  }

  buttons.forEach(function(button) {
    button.addEventListener('click', function() {
      state.filter = button.getAttribute('data-filter') || 'all';
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      state.query = String(searchInput.value || '').toLowerCase().trim();
      applyFilters();
    });
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', function() {
      details.forEach(function(detail) {
        detail.open = true;
      });
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', function() {
      details.forEach(function(detail) {
        detail.open = false;
      });
    });
  }

  applyFilters();
})();
</script>`
}

function transcriptHref(m: ManifestEntry): string {
  return transcriptUrlFromTranscript(m)
}
