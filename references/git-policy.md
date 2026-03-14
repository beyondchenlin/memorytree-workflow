# Git Policy

MemoryTree must adapt to the host repository. It does not get to override it.

## Safe Defaults

- Do not mix MemoryTree-owned changes with product code changes by default.
- Do not stage or push unrelated user work.
- Do not assume direct commits to protected branches are allowed.
- Do not bypass review, CI, E2E, or release controls.
- Keep raw transcript files in the current project's transcript mirror by default, but exclude them from automatic staging unless the user explicitly approved raw transcript uploads for the current repository.
- Do not mirror or stage transcript files from unrelated projects inside the current repository.

## Policy Merge

When the repo already has branch or PR rules:

1. Keep the repo's stricter rule.
2. Treat MemoryTree as documentation and process support.
3. Only add MemoryTree-specific guidance that does not weaken repo controls.

## MemoryTree-Owned Files

Default whitelist:

- `Memory/**`, except `Memory/06_transcripts/raw/**` until the user explicitly approved raw transcript uploads for this repository
- `AGENTS.md` only when the file is managed by MemoryTree or the user approved the merge

If the diff includes files outside this whitelist, stop and ask before staging or pushing.

## Default MemoryTree Flow

Use this flow only for MemoryTree-only changes and only when the host repo does not forbid it:

1. Stage only the MemoryTree-owned files created or updated by the skill.
2. Create or reuse a dedicated branch such as `memorytree/<scope>-<yyyymmdd>-<slug>`.
3. Use a MemoryTree-scoped commit title. Prefer `memorytree(<scope>): <subject>`, but if the host repo enforces a commit convention, use a compatible equivalent such as `docs(memorytree): <subject>`.
4. Push that dedicated branch if the repository allows the current actor to push.
5. Open a dedicated PR instead of merging directly into a protected branch.
6. Enable auto-merge only when the repository still enforces its required approvals and checks.
7. If transcript files are included, keep the PR scoped to one repository's transcript mirror only. Do not mix cross-project transcript archives into the same PR.
8. Keep the global transcript archive updated in the same import operation, but never stage or push that user-level global archive as part of a repo PR.

## Commit Guidance

- Keep the title concise and specific.
- Prefer scopes such as `agents`, `goals`, `todos`, `chat-logs`, `transcripts`, `knowledge`, `archive`, `policy`, or `bootstrap`.
- If a body is needed, keep it lightweight: reason, affected files, and whether the change is MemoryTree-only.
- If the host repo requires Conventional Commits or another enforced prefix, keep `memorytree` visible as the scope or memory tag rather than bypassing the repo rule.

Example title:

```text
memorytree(todos): sync active todo progress
```

Host-compatible example:

```text
docs(memorytree): sync active todo progress
```

Example body:

```text
Reason:
- align the active todo with confirmed progress

Files:
- Memory/02_todos/todo_v001_003_20260314.md
- Memory/03_chat_logs/2026-03-14_09-30.md

Notes:
- memorytree-only change
- no product code included
```

## PR Guidance

- Reuse the commit title as the PR title when it still describes the change accurately.
- Keep the PR scoped to MemoryTree-owned files only.
- State whether the PR is MemoryTree-only and whether auto-merge was enabled.
- State whether raw transcripts were included or intentionally left unstaged in the repo mirror.
- Follow the repository's required target branch, review policy, and CI gates.

## Stop And Ask

Stop and ask the user before committing, pushing, or opening a PR when any of these are true:

1. The diff touches product code or files outside the MemoryTree whitelist.
2. `AGENTS.md` has user-managed policy content that cannot be safely merged automatically.
3. The target branch, base branch, or PR destination is unclear.
4. The repository forbids bot pushes, automated PRs, or auto-merge.
5. The repository's review or CI rules conflict with the default MemoryTree-only flow.
6. Raw transcript upload permission for the repository is unknown.
7. The diff includes raw transcripts or cleaned transcript indexes from other projects.
