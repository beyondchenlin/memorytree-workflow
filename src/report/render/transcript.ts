/**
 * Individual transcript page: metadata, AI summary, backlinks, messages.
 */

import type { ManifestEntry } from '../../types/transcript.js'
import { clientBadge, escHtml, htmlShell, renderNav, transcriptUrlFromTranscript } from './layout.js'

// ---------------------------------------------------------------------------
// Parsed message for rendering
// ---------------------------------------------------------------------------

export interface RenderedMessage {
  role: string
  timestamp: string
  text: string
}

// ---------------------------------------------------------------------------
// Transcript page
// ---------------------------------------------------------------------------

export function renderTranscript(
  messages: RenderedMessage[],
  manifest: ManifestEntry,
  summary: string,
  backlinks: ManifestEntry[],
): string {
  const nav = renderNav('transcripts', false)

  const content = [
    renderHeader(manifest),
    summary ? renderSummaryCard(summary) : '',
    backlinks.length > 0 ? renderBacklinks(backlinks) : '',
    renderMessages(messages),
  ]
    .filter(Boolean)
    .join('\n')

  const title = manifest.title || manifest.session_id
  return htmlShell(title, content, nav)
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function renderHeader(m: ManifestEntry): string {
  const badge = clientBadge(m.client)
  const date = m.started_at.slice(0, 10)
  const time = m.started_at.slice(11, 19)

  return `<div class="page-header">
  <h1>${escHtml(m.title || m.session_id)}</h1>
</div>
<table class="meta-table card">
<tbody>
  <tr><td>Client</td><td>${badge}</td></tr>
  <tr><td>Date</td><td>${escHtml(date)} ${escHtml(time)}</td></tr>
  <tr><td>Session ID</td><td><code>${escHtml(m.session_id)}</code></td></tr>
  <tr><td>Messages</td><td>${m.message_count}</td></tr>
  <tr><td>Tool Events</td><td>${m.tool_event_count}</td></tr>
  <tr><td>Branch</td><td><code>${escHtml(m.branch || '—')}</code></td></tr>
  <tr><td>Working Dir</td><td><code style="font-size:0.8rem">${escHtml(m.cwd || '—')}</code></td></tr>
  <tr><td>SHA256</td><td><code style="font-size:0.75rem">${escHtml(m.raw_sha256.slice(0, 16))}…</code></td></tr>
</tbody>
</table>`
}

function renderSummaryCard(summary: string): string {
  return `<div class="summary-card">
  <div class="summary-label">AI Summary</div>
  <div>${escHtml(summary)}</div>
</div>`
}

function renderBacklinks(backlinks: ManifestEntry[]): string {
  const items = backlinks
    .map(m => {
      const url = transcriptHref(m)
      return `<li><a href="${escHtml(url)}">${escHtml(m.title || m.session_id)}</a></li>`
    })
    .join('')
  return `<div class="backlinks">
  <div class="backlinks-title">Referenced by ${backlinks.length} session(s)</div>
  <ul>${items}</ul>
</div>`
}

function renderMessages(messages: RenderedMessage[]): string {
  if (messages.length === 0) {
    return `<div class="card" style="color:var(--text-muted)">No messages available for this session.</div>`
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

  return `<h2 style="margin-top:1.5rem">Messages</h2>
<div class="messages">${rendered}</div>`
}

/**
 * Render message text to HTML with code block support.
 * Input text is plain text from clean markdown.
 */
function renderMessageBody(text: string): string {
  // Process code blocks first (they contain preformatted content)
  const parts: string[] = []
  const codeBlockRe = /```[\w]*\n?([\s\S]*?)```/g
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

/** Render inline text (paragraphs + inline formatting). */
function renderInlineText(text: string): string {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim())
  return paragraphs
    .map(p => `<p>${applyInlineMarkdown(escHtml(p.trim()))}</p>`)
    .join('')
}

/** Apply inline markdown to already-HTML-escaped text. */
function applyInlineMarkdown(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function transcriptHref(m: ManifestEntry): string {
  return transcriptUrlFromTranscript(m)
}
