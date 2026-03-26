/**
 * CLI: memorytree import — import one transcript file.
 * Port of scripts/import-transcripts.py
 */

import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { slugify } from '../transcript/common.js'
import { defaultGlobalTranscriptRoot, inferProjectSlug, transcriptMatchesRepo } from '../transcript/discover.js'
import { importTranscript, transcriptHasContent } from '../transcript/import.js'
import { inferClient, parseTranscript } from '../transcript/parse.js'

export interface ImportOptions {
  root: string
  source: string
  client: string
  projectName: string
  globalRoot: string
  rawUploadPermission: string
  format: string
  forceRepo: boolean
}

export async function cmdImport(options: ImportOptions): Promise<number> {
  const root = resolve(options.root)
  const source = resolve(options.source)

  if (!existsSync(root)) {
    process.stderr.write(`root does not exist: ${root}\n`)
    return 1
  }
  if (!existsSync(source)) {
    process.stderr.write(`source transcript does not exist: ${source}\n`)
    return 1
  }

  const client = inferClient(options.client, source)
  const globalRoot = options.globalRoot ? resolve(options.globalRoot) : defaultGlobalTranscriptRoot()
  const repoSlug = slugify(options.projectName.trim() || basename(root), 'project')

  const parsed = parseTranscript(client, source)
  if (!transcriptHasContent(parsed)) {
    process.stderr.write(`source transcript does not contain any importable messages or tool events: ${source}\n`)
    return 1
  }

  const detectedProject = inferProjectSlug(parsed)
  const matchesCurrentRepo = options.forceRepo || transcriptMatchesRepo(parsed, root, repoSlug)

  const result = await importTranscript(
    parsed,
    root,
    globalRoot,
    matchesCurrentRepo ? repoSlug : detectedProject,
    matchesCurrentRepo ? options.rawUploadPermission : 'not-applicable',
    matchesCurrentRepo,
  )

  const output = {
    ...result,
    matches_current_repo: matchesCurrentRepo,
    detected_project: detectedProject,
  } as Record<string, unknown>

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(output) + '\n')
  } else {
    process.stdout.write(formatImportText(output) + '\n')
  }
  return 0
}

function formatImportText(result: Record<string, unknown>): string {
  return [
    `client: ${result['client'] ?? ''}`,
    `project: ${result['project'] ?? ''}`,
    `session_id: ${result['session_id'] ?? ''}`,
    `status: ${result['status'] ?? ''}`,
    `started_at: ${result['started_at'] ?? ''}`,
    `detected_project: ${result['detected_project'] ?? ''}`,
    `matches_current_repo: ${String(result['matches_current_repo'] ?? false).toLowerCase()}`,
    `raw_upload_permission: ${result['raw_upload_permission'] ?? ''}`,
    `message_count: ${result['message_count'] ?? 0}`,
    `tool_event_count: ${result['tool_event_count'] ?? 0}`,
    `repo_raw_path: ${result['repo_raw_path'] ?? ''}`,
    `repo_clean_path: ${result['repo_clean_path'] ?? ''}`,
    `repo_manifest_path: ${result['repo_manifest_path'] ?? ''}`,
    `global_raw_path: ${result['global_raw_path'] ?? ''}`,
    `global_clean_path: ${result['global_clean_path'] ?? ''}`,
  ].join('\n')
}
