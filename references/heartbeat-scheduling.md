# Heartbeat Scheduling

Use this file when MemoryTree needs to automate transcript import, cleaning, and push without human intervention or model tokens.

## Goal

Complete transcript discovery, import, cleaning, commit, and push without consuming model tokens or requiring human intervention.

## Core Rules

1. `heartbeat.py` executes once and exits. It is stateless and idempotent — safe to re-run at any interval.
2. The OS-native scheduler invokes `heartbeat.py` on a fixed interval. Use cron (Linux), launchd (macOS), or Task Scheduler (Windows).
3. One computer runs exactly one scheduled heartbeat task. Multiple registrations on the same machine are not supported.
4. The machine keeps one explicit heartbeat owner. The most recent successful `install` or `quick-start` takes ownership and replaces the previous runtime binding.
5. Each execution scans all three supported client directories (Codex, Claude Code, Gemini CLI).
6. Each execution follows the sequence: scan → incremental import → clean → commit + push → exit.
7. The `memorytree-daemon watch` mode (continuous loop) exists only for development and debugging. Production use must rely on the OS scheduler.

## Daemon CLI

The `memorytree-daemon` command manages the heartbeat lifecycle:

| Subcommand  | Description |
|-------------|-------------|
| `install`   | Register the heartbeat task with the OS scheduler at the configured interval. If another runtime currently owns the scheduler, replace it and take ownership. |
| `uninstall` | Remove the heartbeat task from the OS scheduler. |
| `run-once`  | Execute a single heartbeat cycle immediately, then exit. |
| `watch`     | Run a continuous loop for development and debugging only. |
| `status`    | Show whether a heartbeat task is registered, who owns it, and its last execution result. |

## OS Scheduler Integration

`memorytree-daemon install` detects the current platform and registers the heartbeat using the native scheduler:

The active owner metadata lives in `~/.memorytree/heartbeat-owner.json`. When a user starts MemoryTree from Claude Code, Codex, or another supported runtime, the successful scheduler install records that runtime as the owner. A later install from another runtime first removes the previous scheduler registration, then rewrites it to the new runtime's `dist/cli.js` entrypoint so the machine still keeps only one heartbeat.

### Linux (cron)

```text
*/5 * * * * /path/to/python /path/to/heartbeat.py >> ~/.memorytree/logs/heartbeat-cron.log 2>&1
```

Detection: check for existing entry with `crontab -l | grep memorytree`.
Removal: `crontab -l | grep -v memorytree | crontab -`.

### macOS (launchd)

Write a plist to `~/Library/LaunchAgents/com.memorytree.heartbeat.plist`:

```xml
<key>ProgramArguments</key>
<array>
  <string>/path/to/python</string>
  <string>/path/to/heartbeat.py</string>
</array>
<key>StartInterval</key>
<integer>300</integer>
```

Load with `launchctl load`, unload with `launchctl unload`.

### Windows (Task Scheduler)

```text
schtasks /create /tn "MemoryTree Heartbeat" /sc minute /mo 5 /tr "python heartbeat.py" /f
```

Detection: `schtasks /query /tn "MemoryTree Heartbeat"`.
Removal: `schtasks /delete /tn "MemoryTree Heartbeat" /f`.

## Execution Flow

1. Acquire `~/.memorytree/heartbeat.lock`. If the lock is held by a live process, exit immediately.
2. Load `~/.memorytree/config.toml`. If the file is missing or malformed, use built-in defaults and log a warning.
3. Iterate over registered projects in `config.toml`.
4. For each project: discover new transcripts → import → clean → commit. If any step fails for one project, log the error, write an alert, and continue to the next project. Never abort the entire heartbeat run because of a single project failure.
5. If `auto_push = true` and a Git remote exists, push. If the push fails, retry once. On second failure, write an alert and continue.
6. Release the lock and exit.

## Lock Mechanism

The heartbeat uses a PID-based lock file at `~/.memorytree/heartbeat.lock`:

1. On startup, check if the lock file exists.
2. If it exists, read the PID from the file. Check whether that PID is still alive (`os.kill(pid, 0)` on Unix, `OpenProcess` on Windows).
3. If the PID is alive, the lock is held — exit immediately with a `lock_held` alert.
4. If the PID is not alive (stale lock from a crashed process), delete the lock file, log a warning, and proceed.
5. Write the current PID to the lock file.
6. On exit (normal or error), always delete the lock file. Use `try/finally` to ensure cleanup.

## Error Handling

- **Per-project isolation**: A failure in one project must not prevent other projects from being processed. Catch exceptions at the project level, log the error, write an alert, and continue.
- **Failure threshold**: After 3 consecutive failures for the same project across heartbeat runs, write a `push_failed` or relevant alert to `~/.memorytree/alerts.json`. The count resets on a successful run.
- **Config errors**: If `config.toml` contains invalid values (e.g., negative interval, non-existent path), use built-in defaults for those fields and log a warning. Do not abort.
- **Git errors**: If `git add` or `git commit` fails, skip the push for that project and write an alert. Do not attempt to push uncommitted state.

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
4. Exclude the current session: record the skill activation timestamp when the session starts. Any transcript with `started_at` >= activation timestamp is considered the current session and excluded. This approach is cross-client and does not require knowing client-specific session IDs.
5. If no matching previous session is found, inform the user: "No previous session found for this project." Do not generate a summary.
6. Load the matched transcript and generate a continuation summary using model tokens.

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
3. An existing heartbeat registration would be replaced by a new `install` and ownership would move to another runtime.

## Cross-Client Compatibility

All interactive prompts in this skill (heartbeat install, configuration, on-demand sync confirmation) must work across every AI assistant that supports the skill:

1. Use plain-text questions and wait for the user's text reply. Do not use client-specific UI components.
2. Follow the user's language or the repo locale for prompt text. Do not hardcode a single language.
3. Keep script CLI interfaces uniform regardless of which client invokes them.
