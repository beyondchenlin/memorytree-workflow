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

When the skill activates in an interactive session, it reads `alerts.json`, displays pending alerts to the user, and clears acknowledged entries.

## Project Registration

- **Automatic**: When the memorytree-workflow skill activates in a repository, it adds the repo to `config.toml` `projects` if not already present.
- **Manual**: The user can edit `config.toml` directly to add or remove projects.
- **Deregistration**: Removing a project entry stops the heartbeat from scanning it. Existing transcripts in the global archive are not deleted.

## Stop And Ask

Stop and ask the user before proceeding when any of these are true:

1. `config.toml` does not exist and would be created for the first time. Confirm default values.
2. A project registration would add a path that does not look like a Git repository.
3. Changing `auto_push` from `false` to `true` would enable pushing for all registered projects.
