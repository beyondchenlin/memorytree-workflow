# Git Policy

MemoryTree must adapt to the host repository. It does not get to override it.

## Safe Defaults

- Do not mix MemoryTree-owned changes with product code changes by default.
- Do not stage or push unrelated user work.
- Do not assume direct commits to protected branches are allowed.
- Do not bypass review, CI, E2E, or release controls.
- Do not modify the host repository's CI, E2E, branch protection, or required-check configuration by default.
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

## Auto Push

When `auto_push = true` in `~/.memorytree/config.toml`:

1. The heartbeat process pushes the current branch after each commit.
2. Before pushing, verify that a Git remote is configured. If no remote exists, skip the push and write an alert to `~/.memorytree/alerts.json`.
3. If a push fails (network, authentication, rejected by server), retry once. On second failure, write an alert and continue to the next project.
4. On the very first push for a newly registered project, confirm with the user that the remote and branch are correct.
5. Do not force-push. Use only fast-forward pushes.

When `auto_push = false`:

1. The heartbeat commits locally but does not push.
2. The user pushes manually or through the interactive skill session.

Rationale: project memory is a user asset. Local-only storage risks data loss from hardware failure or accidental deletion. Automatic push to a remote provides a durable backup.

## Historical Exposure Boundary

- The single-source rollout is future-facing by default. De-tracked cache mirrors and raw-upload approval rules reduce future exposure, but they do not rewrite older Git history.
- Do not rewrite history or force-push by default just because older commits once tracked `AGENTS.md` or `Memory/**`.
- If older reachable history is confirmed to contain live credentials, regulated personal data, or other content that must be purged, treat it as a security or compliance incident rather than routine MemoryTree cleanup.

Recommended incident order:

1. Revoke or rotate exposed credentials first.
2. Pause new MemoryTree pushes or PRs that would continue spreading the affected mirror paths.
3. Assess the full reachability scope: protected branches, open branches, tags, releases, workflow artifacts, and known forks.
4. Rewrite history only with repository-owner approval and coordinated collaborator communication.
5. After cleanup, re-check `.gitignore`, de-track state, and raw transcript upload policy so the same exposure path does not reopen.

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

## Optional CI Optimization For MemoryTree-Only PRs

- If the repository owner explicitly approves it, MemoryTree-only PRs may use lighter CI for `Memory/**` and managed `AGENTS.md` changes.
- Prefer repo-native path filters or dedicated lightweight workflows over disabling CI wholesale.
- Keep branch protection and required checks coherent with the repository's governance model. Do not silently remove protections just to make MemoryTree PRs merge faster.
- If the repository still requires full CI or E2E for documentation-only PRs, follow that stricter rule.
- Ask the user before creating or editing workflow files, path filters, or required-check settings for this optimization.

## Stop And Ask

Stop and ask the user before committing, pushing, or opening a PR when any of these are true:

1. The diff touches product code or files outside the MemoryTree whitelist.
2. `AGENTS.md` has user-managed policy content that cannot be safely merged automatically.
3. The target branch, base branch, or PR destination is unclear.
4. The repository forbids bot pushes, automated PRs, or auto-merge.
5. The repository's review or CI rules conflict with the default MemoryTree-only flow.
6. Raw transcript upload permission for the repository is unknown.
7. The diff includes raw transcripts or cleaned transcript indexes from other projects.
8. `auto_push` is enabled but the target branch is a protected branch that refuses direct pushes.
9. Enabling lighter CI for MemoryTree-only PRs would require changing workflow files, path filters, or required-check settings.
