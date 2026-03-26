/**
 * CLI: memorytree discover — scan and import local transcripts.
 * Port of scripts/discover-transcripts.py
 */

import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { CLIENTS, slugify } from '../transcript/common.js'
import { defaultGlobalTranscriptRoot, discoverSourceFiles, inferProjectSlug, transcriptMatchesRepo } from '../transcript/discover.js'
import { importTranscript, transcriptHasContent } from '../transcript/import.js'
import { parseTranscript } from '../transcript/parse.js'
import { toPosixPath } from '../utils/path.js'

export interface DiscoverOptions {
  root: string
  client: string
  scope: string
  projectName: string
  globalRoot: string
  rawUploadPermission: string
  limit: number
  format: string
}

export async function cmdDiscover(options: DiscoverOptions): Promise<number> {
  const root = resolve(options.root)
  if (!existsSync(root)) {
    process.stderr.write(`root does not exist: ${root}\n`)
    return 1
  }

  const repoSlug = slugify(options.projectName.trim() || basename(root), 'project')
  const globalRoot = options.globalRoot ? resolve(options.globalRoot) : defaultGlobalTranscriptRoot()
  const requestedClients = options.client === 'all' ? CLIENTS : new Set([options.client])
  const discovered = discoverSourceFiles(requestedClients)

  const results: Record<string, unknown>[] = []
  const skipped: Record<string, string>[] = []

  for (const [client, source] of discovered) {
    if (options.limit > 0 && results.length >= options.limit) break

    let parsed
    try {
      parsed = parseTranscript(client, source)
    } catch (err: unknown) {
      skipped.push({
        client,
        source,
        reason: 'parse-error',
        error: summarizeException(err),
      })
      continue
    }

    const candidateProject = inferProjectSlug(parsed)
    const matchesCurrentRepo = transcriptMatchesRepo(parsed, root, repoSlug)

    if (!transcriptHasContent(parsed)) {
      skipped.push({ client, source, reason: 'no-importable-content', project: candidateProject })
      continue
    }

    if (options.scope === 'current-project' && !matchesCurrentRepo) {
      skipped.push({ client, source, reason: 'unrelated-project', project: candidateProject })
      continue
    }

    try {
      const result = await importTranscript(
        parsed,
        root,
        globalRoot,
        matchesCurrentRepo ? repoSlug : candidateProject,
        matchesCurrentRepo ? options.rawUploadPermission : 'not-applicable',
        matchesCurrentRepo,
      )
      if (result.status === 'unchanged') {
        skipped.push({ client, source, reason: 'already-imported', project: candidateProject })
      } else {
        results.push({ ...result, matches_current_repo: matchesCurrentRepo })
      }
    } catch (err: unknown) {
      skipped.push({
        client,
        source,
        reason: 'import-error',
        project: candidateProject,
        error: summarizeException(err),
      })
    }
  }

  const payload = {
    repo: toPosixPath(root),
    repo_project: repoSlug,
    scope: options.scope,
    client_filter: options.client,
    discovered_count: discovered.length,
    imported_count: results.length,
    repo_mirror_count: results.filter(r => r['matches_current_repo']).length,
    global_only_count: results.filter(r => !r['matches_current_repo']).length,
    skipped_count: skipped.length,
    imports: results,
    skipped,
  }

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(payload) + '\n')
  } else {
    process.stdout.write(formatDiscoverText(payload) + '\n')
  }
  return 0
}

function formatDiscoverText(payload: Record<string, unknown>): string {
  const lines = [
    `repo: ${payload['repo'] ?? ''}`,
    `repo_project: ${payload['repo_project'] ?? ''}`,
    `scope: ${payload['scope'] ?? ''}`,
    `client_filter: ${payload['client_filter'] ?? ''}`,
    `discovered_count: ${payload['discovered_count'] ?? 0}`,
    `imported_count: ${payload['imported_count'] ?? 0}`,
    `repo_mirror_count: ${payload['repo_mirror_count'] ?? 0}`,
    `global_only_count: ${payload['global_only_count'] ?? 0}`,
    `skipped_count: ${payload['skipped_count'] ?? 0}`,
  ]

  const imports = payload['imports']
  if (Array.isArray(imports) && imports.length > 0) {
    lines.push('imports:')
    for (const item of imports.slice(0, 10)) {
      const rec = item as Record<string, unknown>
      lines.push(`- ${rec['client']} ${rec['project']} ${rec['session_id']} repo_mirror=${String(rec['matches_current_repo']).toLowerCase()}`)
    }
    if (imports.length > 10) lines.push(`- ... ${imports.length - 10} more`)
  }
  return lines.join('\n')
}

function summarizeException(err: unknown): string {
  if (err instanceof Error) return err.message.trim() || err.constructor.name
  return String(err)
}
