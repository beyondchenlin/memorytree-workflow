# Upgrade Path

Use this file when the target repository already has some project policy or partial MemoryTree files.

## Goal

Introduce MemoryTree without overwriting the host repository's existing rules.

## When To Upgrade Instead Of Init

Use the upgrade path when any of these are true:

- The repo already has an `AGENTS.md`.
- The repo already has a `Memory/` directory but is missing some required subfolders or active files.
- The repo already has custom branch, PR, CI, or review policies that must remain the source of truth.

## Safe Upgrade Rules

1. Create missing `Memory/` directories.
2. Create missing goal, todo, and chat-log files.
3. Preserve an existing `AGENTS.md` by default.
4. Report whether `AGENTS.md` still needs a manual merge to mention MemoryTree read order, active-file rules, isolated commit/PR flow, and repo-safety rules.
5. Do not rewrite existing goals, todos, chat logs, or repo docs unless the user asked for it.

## Script

Use `scripts/upgrade-memorytree.py`.

Recommended defaults:

```text
--root <repo> --locale auto --format json
```

## Expected Output

The upgrade script should tell you:

- what state it found
- which files it created
- which files it preserved
- whether `AGENTS.md` needs a manual merge

Current merge detection is intentionally conservative. An existing `AGENTS.md` is only treated as ready when it already covers these concepts, even if the wording differs:

- MemoryTree read order
- `Memory/01_goals`, `Memory/02_todos`, and `Memory/03_chat_logs`
- active todo synchronization
- append-only chat logs
- a MemoryTree-scoped commit title such as `memorytree(<scope>): <subject>` or `docs(memorytree): <subject>`
- a dedicated MemoryTree branch and PR flow
- repo safety rules such as no direct-branch bypass and only enabling auto-merge when repo rules permit it
