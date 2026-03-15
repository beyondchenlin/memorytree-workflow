# Transcript Archive

Use this file when the user wants MemoryTree to preserve local AI chat history from Codex, Claude Code, or Gemini CLI.

## Goal

Keep a trustworthy transcript record by preserving the current project's transcript mirror and a synchronized global archive at the same time, without mixing unrelated projects into the current repository.

## Core Rules

1. Preserve raw transcripts unchanged as the source of truth.
2. Generate cleaned Markdown transcript indexes for discovery, lightweight review, and cross-project search.
3. Keep both the current repository mirror and the user-level global archive updated on every transcript import.
4. Keep the repository mirror scoped to the current project only. When batch discovery sees other projects, archive them in the global archive only.
5. If current-project ownership is ambiguous, treat the transcript as global-only until stronger evidence exists.
6. Ask once per repository whether raw transcript files may also be committed and pushed with MemoryTree.
7. Record that repository-specific answer in `AGENTS.md`.
8. If the answer is not an explicit yes, keep raw transcripts in the repository mirror but exclude them from automatic staging and push.
9. Use deterministic code for transcript cleaning. Do not spend model tokens to normalize transcript content when a parser script can do it.

## Import Script

Use `scripts/import-transcripts.py` for one known source file.

The script must:

1. Copy the raw transcript into the current repository mirror only when the source belongs to the current repository.
2. Copy the raw transcript into the global archive.
3. Generate the cleaned Markdown transcript in both places with deterministic code when the source matches the current repository, or in the global archive only when it does not.
4. Write manifests and update the global search index in the same operation.
5. Use a concurrency-safe global index, such as SQLite WAL mode, so multiple projects can update the global archive without corrupting it.
6. Refuse snapshot-only or otherwise content-empty sources instead of archiving empty transcript shells.
7. Treat missing or fuzzy project signals as not matched; do not mirror them into the repository on name similarity alone.

## Discovery Script

Use `scripts/discover-transcripts.py` when MemoryTree should scan the supported local client stores automatically.

The script must:

1. Discover supported transcript files from local Codex, Claude Code, and Gemini stores.
2. Mirror transcripts that belong to the current repository into both the repository and the global archive.
3. Backfill transcripts from unrelated projects into the global archive only.
4. Skip unreadable or malformed transcript files without aborting the full discovery run.
5. Skip snapshot-only or otherwise content-empty files instead of generating empty clean transcripts.
6. Keep deterministic cleaning, manifest generation, and global index updates in the same operation.
7. Support a current-project-only mode when the user wants to avoid global backfill during that run.
8. Keep ambiguous ownership cases out of the repository mirror unless path-level evidence confirms they belong to the current repo.

## Global Archive Layout

Recommended user-level layout:

```text
~/.memorytree/transcripts/
  raw/
    codex/<project>/<yyyy>/<mm>/<session-id>.jsonl
    claude/<project>/<yyyy>/<mm>/<session-id>.jsonl
    gemini/<project>/<yyyy>/<mm>/<session-id>.json
  clean/
    codex/<project>/<yyyy>/<mm>/<session-id>.md
    claude/<project>/<yyyy>/<mm>/<session-id>.md
    gemini/<project>/<yyyy>/<mm>/<session-id>.md
  index/
    sessions.jsonl
    search.sqlite
```

Path roots:

- Windows: `%USERPROFILE%`
- macOS and Ubuntu: `$HOME`

## Project Mirror Layout

Inside a repository, keep the current project's full mirror:

```text
Memory/06_transcripts/
  clean/<client>/
  manifests/
  raw/<client>/
```

Do not place other projects' transcript mirrors inside the current repository.

For the complete `~/.memorytree/` directory structure, see `references/global-configuration.md`.

## Client Sources

### Codex

- Prefer full session files from `~/.codex/sessions/**/rollout-*.jsonl`.
- Use `~/.codex/session_index.jsonl` for session discovery when helpful.
- Treat `~/.codex/history.jsonl` as lightweight history, not the preferred full transcript source.

### Claude Code

- Prefer `transcript_path` when the client exposes it.
- Otherwise prefer `~/.claude/projects/<project>/*.jsonl`.
- Treat `~/.claude/history.jsonl` as lightweight history, not the preferred full transcript source.
- Remember that local transcript retention may be limited by the client's cleanup policy.

### Gemini CLI

- Gemini transcript import is supported, but availability depends on saved chats or enabled checkpointing.
- Prefer saved chat or resume-friendly sources first.
- If checkpointing is enabled, use the checkpoint history under `~/.gemini/tmp/<project_hash>/checkpoints` and related Git snapshots under `~/.gemini/history/<project_hash>`.
- If no saved chat or checkpoint source exists, report that no importable Gemini transcript is currently available.

## Import Rules

1. Store the raw source unchanged in the global archive, and in the current repository only when the transcript belongs to that repository.
2. Compute and record a content hash for the raw file.
3. Generate a cleaned Markdown file with deterministic code, not model-generated paraphrasing.
4. During batch discovery, mirror only current-project transcripts into the repository. Unrelated projects go to the global archive only.
5. Each cleaned Markdown file must include:
   - client
   - project
   - session id
   - start time
   - cwd or repo path when available
   - branch when available
   - raw source path
   - raw content hash
6. Keep user messages, assistant messages, and useful tool summaries in the cleaned transcript.
7. Drop or fold noisy events such as queue operations, repeated metadata, telemetry, and large low-signal tool dumps.
8. Never treat the cleaned transcript as stronger evidence than the raw transcript.

## Search Rules

When the user asks to search all memories or all chat history:

1. Search `~/.memorytree/transcripts/index/search.sqlite` first for fast full-text lookup.
2. Use `sessions.jsonl` for session-level metadata filtering (client, project, date range).
3. Load the matching cleaned Markdown files for context. When exact wording matters, confirm against the raw transcript.
4. Combine transcript results with the active repository's `Memory/` files when answering.
5. If the search index does not exist, fall back to scanning the `clean/` directory directly.

## Session Continuity

When the user opens a new session and asks to see their most recent conversation, the skill provides cross-session context recovery:

1. Trigger an on-demand sync: immediately scan all three client transcript directories for the current project, bypassing the scheduled heartbeat interval. See `references/heartbeat-scheduling.md`.
2. Query the global index with `project = current directory` and `client IN (claude, codex, gemini)`, sorted by timestamp descending.
3. Exclude the current session: any transcript with `started_at` >= the skill's activation timestamp is considered the current session and excluded. This is cross-client and does not require client-specific session ID knowledge.
4. Load the located transcript: prefer cleaned Markdown for readability, confirm against raw when exact wording matters.
5. Supplement with the latest `Memory/03_chat_logs/` entry if the previous session wrote a chat log summary.
6. Generate a continuation summary (consumes model tokens) that extracts: the problem under discussion, approaches tried, progress made, and what remains unresolved.
7. Include source metadata in the output: client name, session timestamp, approximate duration.
8. If no matching previous session is found for the current project, inform the user: "No previous session found for this project." Do not generate a summary.

This feature covers all three clients. A user who worked in Codex and then opens Claude Code can recover the Codex session context, and vice versa.

## Git Rules

1. Cleaned transcript indexes may be committed as MemoryTree-owned documentation for the current repository.
2. Raw transcript files stay in the current repository mirror regardless of upload approval.
3. Raw transcript files may be staged, committed, and pushed only after the user explicitly approved raw transcript uploads for that repository.
4. Even when raw transcript uploads are approved, keep the PR limited to the current repository's transcript mirror. Do not mix transcript files from unrelated projects.
