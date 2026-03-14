# Project Detection

Use this file before changing any MemoryTree files.

## States

### `not-installed`

Treat the repo as `not-installed` when any of these are true:

- No `Memory/` directory exists.
- No `AGENTS.md` exists and there are no active goal, bound todo, or chat-log files to preserve.

Action:

1. Run `scripts/init-memorytree.py`.
2. Review the generated files.
3. Use fresh init only when there is no `AGENTS.md` or other repo policy source to preserve. If repo policy already exists, switch to `scripts/upgrade-memorytree.py`.

### `partial`

Treat the repo as `partial` when MemoryTree exists but one or more expected pieces are missing:

- `Memory/` exists but one of `01_goals`, `02_todos`, or `03_chat_logs` is missing.
- `AGENTS.md` already exists even if `Memory/` does not yet exist. Use upgrade to avoid overwriting repo policy.
- Common repo policy sources already exist, such as policy-bearing `CONTRIBUTING.md`, PR templates, `CODEOWNERS`, or commitlint config. Use upgrade to avoid conflicting Git guidance.
- Goal files exist but there is no bound todo for the latest goal.
- A chat-log directory exists but no current chat-log file exists.
- `AGENTS.md` is missing or does not mention the MemoryTree read order, isolated commit/PR flow, and safety rules.

Action:

1. Run `scripts/upgrade-memorytree.py`.
2. Preserve stricter repo policies already present in `AGENTS.md`.

### `installed`

Treat the repo as `installed` when these are all true:

- `Memory/01_goals/`, `Memory/02_todos/`, and `Memory/03_chat_logs/` exist.
- At least one goal file exists.
- At least one todo file bound to the latest goal exists.
- At least one current chat-log file exists.
- `AGENTS.md` exists and already carries MemoryTree read-order, isolated commit/PR, and safety guidance.

Action:

1. Read active files in order.
2. Update only the active goal, active todo, and current session log as needed.

## Detection Notes

- Do not require `04_knowledge` or `05_archive` for a valid install.
- Do not require `06_transcripts/` for a valid install. Transcript archival is optional; when enabled, keep the current-project mirror and the user-level global archive synchronized together.
- Fresh init now checks common non-`AGENTS.md` policy files such as PR templates, `CODEOWNERS`, commitlint config, and policy-bearing `CONTRIBUTING.md`. Generic contributor docs without Git or PR rules do not block fresh init by themselves.
- Do not replace an existing `AGENTS.md` blindly. Merge carefully.
- If the repo already has its own memory system, ask before adding a second one.
