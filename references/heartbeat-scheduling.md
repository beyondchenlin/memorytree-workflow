# Heartbeat Scheduling

Use this file when MemoryTree needs to automate transcript import, cleaning, and push without human intervention or model tokens.

> **Contract**: `heartbeat.py` and `memorytree-daemon` are specifications for code that does not yet exist. The rules below define the intended behavior.

## Goal

Complete transcript discovery, import, cleaning, commit, and push without consuming model tokens or requiring human intervention.

## Core Rules

1. `heartbeat.py` executes once and exits. It is stateless and idempotent — safe to re-run at any interval.
2. The OS-native scheduler invokes `heartbeat.py` on a fixed interval. Use cron (Linux), launchd (macOS), or Task Scheduler (Windows).
3. One computer runs exactly one scheduled heartbeat task. Multiple registrations on the same machine are not supported.
4. Each execution scans all three supported client directories (Codex, Claude Code, Gemini CLI).
5. Each execution follows the sequence: scan → incremental import → clean → commit + push → exit.
6. The `memorytree-daemon watch` mode (continuous loop) exists only for development and debugging. Production use must rely on the OS scheduler.

## Daemon CLI

The `memorytree-daemon` command manages the heartbeat lifecycle:

| Subcommand  | Description |
|-------------|-------------|
| `install`   | Register the heartbeat task with the OS scheduler at the configured interval. Refuses to overwrite an existing registration. |
| `uninstall` | Remove the heartbeat task from the OS scheduler. |
| `run-once`  | Execute a single heartbeat cycle immediately, then exit. |
| `watch`     | Run a continuous loop for development and debugging only. |
| `status`    | Show whether a heartbeat task is registered and its last execution result. |

## Execution Flow

1. Acquire `~/.memorytree/heartbeat.lock`. If the lock is held, exit immediately.
2. Load `~/.memorytree/config.toml`.
3. Iterate over registered projects in `config.toml`.
4. For each project: discover new transcripts → import → clean → commit.
5. If `auto_push = true` and a Git remote exists, push.
6. Release the lock and exit.

## Sensitive Info Scanning

During the cleaning step, scan each transcript for patterns that match API keys, passwords, tokens, and other secrets. When a match is found:

- Log a warning with the file path and match location.
- Write an alert to `~/.memorytree/alerts.json`.
- Do **not** automatically delete or redact the content.

The user reviews alerts and decides how to handle sensitive content.

## Git Remote Pre-Check

Before pushing, verify that the target repository has a configured Git remote:

- If a remote exists, push the current branch.
- If no remote is configured, skip the push, log a warning, and write an alert to `~/.memorytree/alerts.json`.

## First Install

When the skill activates for the first time and `memorytree-daemon` is not registered, use an interactive prompt to configure the heartbeat before installing. Ask the user for:

1. Heartbeat interval (default: 5 minutes).
2. Whether `auto_push` should be enabled (default: true).
3. Confirmation of the project scope (which directories to scan).

After confirmation, run `memorytree-daemon install` with the chosen settings.

The prompt must use plain-text questions and wait for the user's reply. Do not rely on client-specific UI components (buttons, checkboxes, multi-select widgets) — the same prompt must work in Claude Code, Codex, and Gemini CLI.

Do not register the heartbeat task silently during initialization.

## On-Demand Sync

When the user asks to see their most recent conversation (e.g., "look at my last chat"), trigger an immediate sync instead of waiting for the next scheduled heartbeat:

1. Scan all three client transcript directories for the current project.
2. Incrementally import any new transcripts into the global archive and project mirror.
3. Query the global index (`sessions.jsonl` / `search.sqlite`) with `project = current directory`, sorted by timestamp descending.
4. Exclude the current session to avoid returning the session that just started.
5. Load the matched transcript and generate a continuation summary using model tokens.

The continuation summary should extract:

- What problem was being discussed.
- What approaches were tried.
- How far the work progressed.
- What remains unresolved and where it got stuck.

This path is distinct from the scheduled heartbeat: it is user-triggered, immediate, scoped to one project, and produces a model-generated summary. The scheduled heartbeat is background-only and never consumes model tokens.

See `references/transcript-archive.md` for the session continuity search flow.

## Stop And Ask

Stop and ask the user before proceeding when any of these are true:

1. The `install` subcommand would register a new OS-level scheduled task. Confirm the interval, auto_push preference, and scope first.
2. A push target has no configured Git remote.
3. An existing heartbeat registration would be overwritten by a new `install`.

## Cross-Client Compatibility

All interactive prompts in this skill (heartbeat install, configuration, on-demand sync confirmation) must work across every AI assistant that supports the skill:

1. Use plain-text questions and wait for the user's text reply. Do not use client-specific UI components.
2. Follow the user's language or the repo locale for prompt text. Do not hardcode a single language.
3. Keep script CLI interfaces uniform regardless of which client invokes them.
