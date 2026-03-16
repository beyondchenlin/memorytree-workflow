/**
 * Report build orchestrator.
 * Generates a self-contained multi-page HTML website in Memory/07_reports/.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import type { BuildReportOptions } from '../types/report.js'
import type { ManifestEntry } from '../types/transcript.js'
import { computeStats, extractToolNames, accumulateToolCounts } from './stats.js'
import { renderDashboard } from './render/dashboard.js'
import { renderTranscriptList } from './render/transcript-list.js'
import { renderTranscript } from './render/transcript.js'
import type { RenderedMessage } from './render/transcript.js'
import { renderKnowledge } from './render/knowledge.js'
import type { KnowledgeFile } from './render/knowledge.js'
import { renderGoals } from './render/goals.js'
import type { GoalFile } from './render/goals.js'
import { buildSearchIndex, renderSearchPage } from './render/search.js'
import { buildLinkGraph } from './render/links.js'
import { getSummary } from './summarize.js'
import type { SummaryOptions } from './summarize.js'

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function buildReport(options: BuildReportOptions): Promise<void> {
  const { root, output } = options
  const noAi = options.noAi ?? false
  const model = options.model ?? DEFAULT_MODEL
  // Cache lives outside the gitignored output dir so it survives rm -rf
  const cacheDir = join(root, 'Memory', '.report-cache')

  // Ensure output dirs exist
  mkdirSync(output, { recursive: true })
  mkdirSync(join(output, 'transcripts'), { recursive: true })
  mkdirSync(join(output, 'goals'), { recursive: true })
  mkdirSync(join(output, 'knowledge'), { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  // Ensure Memory/07_reports is gitignored
  ensureGitignore(root, 'Memory/07_reports/')

  // Load all manifests
  const manifests = loadManifests(root)

  // Build link graph from clean markdown
  const linkGraph = buildLinkGraph(manifests, root)

  // Accumulate tool counts while processing transcripts
  let toolCounts: Record<string, number> = {}

  // Summary options
  const summaryOptions: SummaryOptions = { cacheDir, noAi, model }

  // Process each transcript: parse → summarize → render → write → discard
  const snippets: Record<string, string> = {}
  const summaryPromises: Array<Promise<void>> = []

  for (const m of manifests) {
    const messages = parseCleanMarkdownMessages(m, root)

    // Tool events from parsed transcript (try raw path)
    const rawPath = resolveRawPath(m, root)
    if (rawPath && existsSync(rawPath)) {
      try {
        const toolSummaries = extractToolSummariesFromRaw(rawPath, m.client)
        const names = extractToolNames(toolSummaries)
        toolCounts = accumulateToolCounts(toolCounts, names)
      } catch {
        // Skip if raw parsing fails
      }
    }

    // Search snippet from first message text
    const firstMsg = messages[0]
    snippets[m.session_id] = firstMsg ? firstMsg.text.slice(0, 300) : ''

    // Summarize + render (deferred to allow parallel API calls)
    const manifest = m
    const msgs = messages
    summaryPromises.push(
      (async () => {
        const summary = await getSummary(manifest.raw_sha256, msgs, summaryOptions)
        const backlinkIds = linkGraph.backlinks[manifest.session_id] ?? []
        const backlinkManifests = backlinkIds
          .map(id => manifests.find(x => x.session_id === id))
          .filter((x): x is ManifestEntry => x !== undefined)

        const html = renderTranscript(msgs, manifest, summary, backlinkManifests)
        const outPath = transcriptOutputPath(output, manifest)
        mkdirSync(dirname(outPath), { recursive: true })
        writeFileSync(outPath, html, 'utf-8')
      })(),
    )
  }

  // Wait for all transcript renders (parallel, bounded by semaphore in summarize.ts)
  await Promise.all(summaryPromises)

  // Compute final stats with accumulated tool counts
  const stats = computeStats(manifests, toolCounts)

  // Dashboard
  writeFileSync(join(output, 'index.html'), renderDashboard(stats, manifests), 'utf-8')

  // Session list
  writeFileSync(
    join(output, 'transcripts', 'index.html'),
    renderTranscriptList(manifests),
    'utf-8',
  )

  // Goals page
  const goalFiles = loadMarkdownFiles(join(root, 'Memory', '01_goals'))
  writeFileSync(
    join(output, 'goals', 'index.html'),
    renderGoals(goalFiles),
    'utf-8',
  )

  // Knowledge page
  const knowledgeFiles = loadMarkdownFiles(join(root, 'Memory', '04_knowledge'))
  writeFileSync(
    join(output, 'knowledge', 'index.html'),
    renderKnowledge(knowledgeFiles),
    'utf-8',
  )

  // Search
  const searchIndex = buildSearchIndex(manifests, m => snippets[m.session_id] ?? '')
  writeFileSync(join(output, 'search.html'), renderSearchPage(searchIndex), 'utf-8')
}

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

function loadManifests(root: string): ManifestEntry[] {
  const manifestsDir = join(root, 'Memory', '06_transcripts', 'manifests')
  if (!existsSync(manifestsDir)) return []

  const manifests: ManifestEntry[] = []
  loadManifestsRecursive(manifestsDir, manifests)
  return manifests
}

function loadManifestsRecursive(dir: string, out: ManifestEntry[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    if (entry.endsWith('.json')) {
      try {
        const raw = readFileSync(fullPath, 'utf-8')
        const parsed = JSON.parse(raw) as ManifestEntry
        if (parsed.session_id && parsed.client) {
          out.push(parsed)
        }
      } catch {
        // Skip malformed manifests
      }
    } else {
      // Recurse into subdirectories
      loadManifestsRecursive(fullPath, out)
    }
  }
}

// ---------------------------------------------------------------------------
// Clean markdown message parsing
// ---------------------------------------------------------------------------

/** Parse messages from a clean markdown file. */
export function parseCleanMarkdownMessages(m: ManifestEntry, root: string): RenderedMessage[] {
  const cleanPath = m.repo_clean_path
    ? join(root, m.repo_clean_path)
    : m.global_clean_path
  if (!cleanPath || !existsSync(cleanPath)) return []

  let content: string
  try {
    content = readFileSync(cleanPath, 'utf-8')
  } catch {
    return []
  }

  return parseMessagesFromMarkdown(content)
}

/** Extract role/timestamp/text from clean markdown format. */
export function parseMessagesFromMarkdown(content: string): RenderedMessage[] {
  const messages: RenderedMessage[] = []

  // Find ## Messages section
  const msgSection = content.indexOf('\n## Messages')
  if (msgSection === -1) return []

  const body = content.slice(msgSection + 12) // after "## Messages\n"

  // Split on ### N. role headers
  const msgRe = /^### \d+\.\s+(\w+)/gm
  let match: RegExpExecArray | null
  const starts: Array<{ index: number; role: string }> = []

  while ((match = msgRe.exec(body)) !== null) {
    starts.push({ index: match.index, role: match[1] ?? 'unknown' })
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    if (!start) continue
    const nextStart = starts[i + 1]
    const chunk = nextStart
      ? body.slice(start.index, nextStart.index)
      : body.slice(start.index)

    const lines = chunk.split('\n')
    // First line is the header, second may be timestamp
    let timestamp = ''
    const textLines: string[] = []
    let pastHeader = false

    for (const line of lines) {
      if (!pastHeader && line.startsWith('### ')) {
        pastHeader = true
        continue
      }
      if (!pastHeader) continue
      const tsMatch = line.match(/^- Timestamp:\s*`([^`]+)`/)
      if (tsMatch && !timestamp) {
        timestamp = tsMatch[1] ?? ''
        continue
      }
      textLines.push(line)
    }

    // Remove leading/trailing blank lines from text
    const text = textLines.join('\n').trim()
    if (text || timestamp) {
      messages.push({ role: start.role, timestamp, text })
    }
  }

  return messages
}

// ---------------------------------------------------------------------------
// Raw transcript tool extraction
// ---------------------------------------------------------------------------

/** Best-effort extraction of tool event summaries from a raw JSONL file. */
function extractToolSummariesFromRaw(rawPath: string, _client: string): string[] {
  const summaries: string[] = []
  let content: string
  try {
    content = readFileSync(rawPath, 'utf-8')
  } catch {
    return []
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>
      // Codex: function_call type
      const type = record['type'] as string | undefined
      if (type === 'function_call' || type === 'custom_tool_call') {
        const name = (record['name'] as string | undefined) ?? type
        summaries.push(name)
        continue
      }
      // Claude: tool_use content blocks
      const payload = record['message'] as Record<string, unknown> | undefined
      const content2 = (payload?.['content'] ?? record['content']) as unknown[] | undefined
      if (Array.isArray(content2)) {
        for (const block of content2) {
          if (
            block !== null &&
            typeof block === 'object' &&
            (block as Record<string, unknown>)['type'] === 'tool_use'
          ) {
            const name = ((block as Record<string, unknown>)['name'] as string | undefined) ?? 'tool_use'
            summaries.push(name)
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return summaries
}

// ---------------------------------------------------------------------------
// Output path helpers
// ---------------------------------------------------------------------------

function transcriptOutputPath(output: string, m: ManifestEntry): string {
  const cleanPath = m.repo_clean_path || m.global_clean_path || ''
  const stem = cleanPath ? basename(cleanPath, '.md') : m.session_id
  return join(output, 'transcripts', m.client, `${stem}.html`)
}

function resolveRawPath(m: ManifestEntry, root: string): string | null {
  if (m.repo_raw_path) {
    return join(root, m.repo_raw_path)
  }
  if (m.global_raw_path) {
    return m.global_raw_path
  }
  return null
}

// ---------------------------------------------------------------------------
// Markdown file loader (for goals/knowledge)
// ---------------------------------------------------------------------------

function loadMarkdownFiles(dir: string): Array<{ filename: string; title: string; content: string }> {
  if (!existsSync(dir)) return []

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  return entries
    .filter(e => e.endsWith('.md'))
    .sort()
    .map(filename => {
      const fullPath = join(dir, filename)
      let content = ''
      try {
        content = readFileSync(fullPath, 'utf-8')
      } catch {
        // empty
      }
      const title = extractMarkdownTitle(content) || basename(filename, '.md')
      return { filename, title, content }
    })
}

function extractMarkdownTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() ?? ''
}

// ---------------------------------------------------------------------------
// .gitignore management
// ---------------------------------------------------------------------------

export function ensureGitignore(root: string, entry: string): void {
  const gitignorePath = join(root, '.gitignore')
  let existing = ''
  if (existsSync(gitignorePath)) {
    try {
      existing = readFileSync(gitignorePath, 'utf-8')
    } catch {
      return
    }
  }
  // Check if already present (normalize line endings)
  const lines = existing.replace(/\r\n/g, '\n').split('\n')
  if (lines.some(l => l.trim() === entry.trim())) return

  // Append with trailing newline
  const append = existing.endsWith('\n') ? entry + '\n' : '\n' + entry + '\n'
  try {
    appendFileSync(gitignorePath, append, 'utf-8')
  } catch {
    // Best-effort
  }
}
