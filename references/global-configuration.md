# Global Configuration

Use this file when MemoryTree needs to read or write user-level configuration, state, or cross-project data outside any single repository.

> **Contract**: The `~/.memorytree/` directory and its contents are specifications for infrastructure that does not yet exist. The layout and schemas below define the intended structure.

## Goal

Provide a single user-level location for global state, configuration, and cross-project data so that heartbeat, daemon, and multi-project features have a shared, predictable root.

## Directory Layout

```text
~/.memorytree/
  config.toml              # User-level settings
  alerts.json              # Pending notifications for the next interactive session
  heartbeat.lock           # Single-instance lock for the heartbeat process
  logs/
    heartbeat-<date>.log   # Heartbeat execution logs, rotated by date
  transcripts/             # Global transcript archive (see references/transcript-archive.md)
    raw/
    clean/
    index/
      sessions.jsonl
      search.sqlite
```

Path roots:

- Windows: `%USERPROFILE%`
- macOS and Linux: `$HOME`

## config.toml Schema

| Field                | Type       | Default          | Description |
|----------------------|------------|------------------|-------------|
| `heartbeat_interval` | string     | `"5m"`           | Interval between heartbeat executions. Passed to the OS scheduler. |
| `watch_dirs`         | string[]   | `[]`             | Additional directories to scan for transcript sources beyond the default client stores. |
| `projects`           | table[]    | `[]`             | Registered project entries. Each entry has `path` (repo root) and optional `name`. |
| `auto_push`          | boolean    | `true`           | Whether the heartbeat pushes after committing. See `references/git-policy.md`. |
| `log_level`          | string     | `"info"`         | Log verbosity: `debug`, `info`, `warn`, `error`. |

Projects are added automatically when the skill activates in a repository and can also be added manually.

### Validation

If `config.toml` contains invalid values, the heartbeat uses built-in defaults for those fields and logs a warning:

- `heartbeat_interval`: must be a positive duration string (e.g., `"5m"`, `"300s"`). Invalid or zero values fall back to `"5m"`.
- `watch_dirs`: non-existent directories are silently skipped during scanning.
- `projects`: entries with non-existent `path` values are skipped during the heartbeat run (not removed from config).
- `auto_push`: non-boolean values fall back to `true`.
- `log_level`: unrecognized values fall back to `"info"`.

If the file itself is malformed TOML, the heartbeat logs an error, uses all built-in defaults, and continues.

## alerts.json

A JSON array of alert objects. Each object has:

```json
{
  "timestamp": "2026-03-15T08:30:00Z",
  "project": "/path/to/repo",
  "type": "no_remote",
  "message": "Push skipped: no Git remote configured.",
  "count": 1
}
```

Alert types:

| Type              | Trigger |
|-------------------|---------|
| `no_remote`       | Push skipped because the repository has no configured Git remote. |
| `sensitive_match` | A transcript contains a pattern that looks like a secret. |
| `push_failed`     | Push attempted but failed (network, auth, protected branch). |
| `lock_held`       | Heartbeat exited because another instance held the lock. |

When the skill activates in an interactive session, it reads `alerts.json`, displays pending alerts to the user, and clears all displayed entries (display = acknowledgement, no explicit dismiss required).

Alert lifecycle rules:

1. **Deduplication**: Before appending a new alert, check if an existing alert with the same `project` and `type` exists. If so, increment its `count` and update its `timestamp` instead of adding a duplicate.
2. **Maximum entries**: Keep at most 100 alert entries. When the limit is reached, drop the oldest entries first.
3. **Clearing**: After the skill displays alerts to the user, remove all displayed entries from the file. If the file becomes empty, delete it.
4. **Failure threshold**: The heartbeat writes a `push_failed` alert only after 3 consecutive failures for the same project. The count resets on a successful push.

## Python Version

Scripts in this project require Python 3.11 or later. The `tomllib` module (stdlib in 3.11+) is used for `config.toml` parsing. No third-party TOML packages are needed.

## Project Registration

- **Automatic**: When the memorytree-workflow skill activates in a repository, it adds the repo to `config.toml` `projects` if not already present.
- **Manual**: The user can edit `config.toml` directly to add or remove projects.
- **Deregistration**: Removing a project entry stops the heartbeat from scanning it. Existing transcripts in the global archive are not deleted.

## Stop And Ask

Stop and ask the user before proceeding when any of these are true:

1. `config.toml` does not exist and would be created for the first time. Confirm default values.
2. A project registration would add a path that does not look like a Git repository.
3. Changing `auto_push` from `false` to `true` would enable pushing for all registered projects.
