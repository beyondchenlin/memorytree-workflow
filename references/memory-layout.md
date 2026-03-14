# Memory Layout

Use this layout unless the host repo already has an equivalent structure.

```text
Memory/
  01_goals/
  02_todos/
  03_chat_logs/
  04_knowledge/
  05_archive/
  06_transcripts/
    clean/
    manifests/
    raw/
```

## Naming

- Goal: `goal_vNNN_YYYYMMDD.md`
- Todo: `todo_vNNN_SSS_YYYYMMDD.md`
- Chat log: `YYYY-MM-DD_HH-MM.md`

Where:

- `NNN` is the zero-padded goal version.
- `SSS` is the zero-padded todo subversion bound to one goal version.

## Required Files

- One active goal file in `01_goals/`.
- One active todo file bound to the latest goal in `02_todos/`.
- One current chat log in `03_chat_logs/`.

## Optional Files

- `04_knowledge/` for durable project notes, specs, and decisions.
- `05_archive/` for retired goals, todos, and old logs.
- `06_transcripts/clean/` for project-facing cleaned transcript indexes grouped by client.
- `06_transcripts/manifests/` for per-session metadata such as raw source path, hash, import time, and client.
- `06_transcripts/raw/` for project-local raw transcript mirrors grouped by client. Keep these files in the repo even when raw transcript uploads are not approved; approval controls Git staging and push, not local storage.

## Transcript Notes

- Keep a synchronized global transcript archive outside the repository in a user-level MemoryTree store.
- Organize transcript imports by `client / project / session`, both in the current repository and in the global archive.
- Keep the repository mirror limited to the current project's transcripts. Cross-project backfills belong in the global archive only.
- Use deterministic code to generate `clean/` files from `raw/` files. Do not rely on model output for transcript normalization.
- Supported client families are `codex`, `claude`, and `gemini`.
