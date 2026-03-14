# AGENTS.md

## Read Order
- Read this file first.
- Read the latest file in `Memory/01_goals/`.
- Read the latest todo bound to that goal in `Memory/02_todos/`.
- Read `Memory/04_knowledge/` only when needed.
- Read `Memory/06_transcripts/clean/` and transcript manifests only when needed.
- Read `Memory/03_chat_logs/` and `Memory/05_archive/` only when needed.

## Memory Rules
- Change the active goal only after explicit user confirmation of a requirement or scope change.
- Keep the active todo synchronized with the active goal.
- Append chat logs only. Never rewrite or delete prior entries.
- Keep active files concise and move stale context to knowledge or archive files.
- Treat cleaned transcript indexes as search aids. Confirm exact wording against the raw transcript archive when precision matters.

## Transcript Rules
- If transcript archival is enabled, archive transcripts by client, project, and session.
- Keep raw transcripts in both this repository's `Memory/06_transcripts/raw/` mirror and the user-level MemoryTree archive.
- Keep this repository mirror limited to transcripts that belong to the current project. Archive unrelated projects in the global MemoryTree archive only.
- Generate cleaned transcript indexes with deterministic code, not model-generated rewriting.
- Raw transcript upload permission for this repository: not set. Ask the user before the first raw transcript commit or push, then record the answer here.
- If raw transcript uploads are not approved, keep `Memory/06_transcripts/raw/**` unstaged and commit only cleaned transcript indexes or manifests for this repository.

## Git Rules
- Obey this repository's branch, PR, CI, review, and release rules.
- Auto-commit and push only MemoryTree-owned changes (`Memory/**` and this file when it is managed by MemoryTree), excluding `Memory/06_transcripts/raw/**` until raw transcript uploads are approved for this repository.
- Use a MemoryTree-scoped commit title. Prefer `memorytree(<scope>): <subject>`, or the repository-required equivalent such as `docs(memorytree): <subject>`.
- Use a dedicated branch and PR for MemoryTree-only changes. Enable auto-merge only when repository rules permit it.
- If a diff includes product code, shared policy files, cross-project transcript files, or unclear ownership, stop and ask the user before staging or pushing.
