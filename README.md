<div align="center">

<img src="https://raw.githubusercontent.com/beyondchenlin/memorytree-workflow/master/assets/logo.svg" alt="MemoryTree" width="120" />

# MemoryTree Workflow

**Persistent, Git-tracked project memory for AI coding assistants.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Skill-cc785c.svg?logo=anthropic&logoColor=white)](https://claude.ai/claude-code)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)

<p>
  <a href="#install">Install</a> &nbsp;&bull;&nbsp;
  <a href="#usage">Usage</a> &nbsp;&bull;&nbsp;
  <a href="#features">Features</a> &nbsp;&bull;&nbsp;
  <a href="#background-heartbeat">Heartbeat</a> &nbsp;&bull;&nbsp;
  <a href="#cli">CLI</a> &nbsp;&bull;&nbsp;
  <a href="#reference-docs">Docs</a>
</p>

</div>

---

## What It Does

MemoryTree gives AI coding assistants (Claude Code, Codex, Gemini CLI) a structured memory layer that survives across sessions:

| | Feature | Description |
|---|---------|-------------|
| :dart: | **Goals** | Track your project's north star across sessions |
| :white_check_mark: | **Todos** | Version-bound task lists that stay in sync with goals |
| :speech_balloon: | **Chat Logs** | Append-only session records for full traceability |
| :books: | **Knowledge** | Durable notes, specs, and architecture decisions (also stored in goals when scope-relevant) |
| :inbox_tray: | **Transcripts** | Import and archive AI chat history from Codex, Claude Code, and Gemini CLI |

All stored as plain Markdown files under `Memory/`, tracked by Git, minimal dependencies.

## Install

```bash
git clone https://github.com/beyondchenlin/memorytree-workflow ~/.claude/skills/memorytree-workflow
cd ~/.claude/skills/memorytree-workflow && npm install && npm run build
```

On Windows (Git Bash):
```bash
git clone https://github.com/beyondchenlin/memorytree-workflow "$USERPROFILE/.claude/skills/memorytree-workflow"
cd "$USERPROFILE/.claude/skills/memorytree-workflow" && npm install && npm run build
```

## Usage

In any Claude Code session, run:

```
/memorytree-workflow
```

The skill will immediately:
1. **Detect** — check if the current repo has MemoryTree installed
2. **Alert** — display pending notifications from `~/.memorytree/alerts.json`
3. **Init** — if missing, scaffold `AGENTS.md` and `Memory/` folders
4. **Upgrade** — if partial, add missing pieces without overwriting existing policy
5. **Maintain** — if installed, read the active goal/todo and report current state

No manual confirmation needed — the skill acts on the detection result immediately.

## Architecture

### Per-Repository Structure

After initialization, your repo will have:

```
AGENTS.md                    # AI behavior rules for this repo
Memory/
  01_goals/                  # Versioned project goals
  02_todos/                  # Task lists bound to goals
  03_chat_logs/              # Append-only session logs
  04_knowledge/              # (optional) Durable project notes
  05_archive/                # (optional) Retired goals/todos
  06_transcripts/            # (optional) AI chat history archive
    clean/                   #   Cleaned Markdown indexes
    manifests/               #   Import metadata
    raw/                     #   Raw transcript mirrors
```

### Global Directory (`~/.memorytree/`)

Cross-project shared state:

```
~/.memorytree/
  config.toml                # User-level settings
  alerts.json                # Pending notifications
  heartbeat.lock             # Single-instance lock
  logs/                      # Heartbeat execution logs
  transcripts/               # Global transcript archive
    raw/                     #   By client/project/year/month
    clean/                   #   Cleaned Markdown
    index/
      sessions.jsonl         #   Session metadata
      search.sqlite          #   Search index
```

For the full schema see [`references/global-configuration.md`](references/global-configuration.md).

## Features

### Memory Management

| Memory Type | Behavior |
|-------------|----------|
| **Goals** | Changed only after explicit user confirmation of a scope or requirement change. Versioned. |
| **Todos** | Kept in sync with the active goal. Updated when progress changes or next task becomes clearer. |
| **Chat Logs** | Append-only. Never rewritten or deleted. |
| **Knowledge** | Stores architecture decisions, product ideas, operating constraints. Goals may also hold scope-relevant items. |
| **Archive** | Stale context moved here or to knowledge files to keep active files concise. |

### Multi-Client Transcript Import

Import AI chat history from three clients:

| Client | Source |
|--------|--------|
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl` |
| **Claude Code** | `~/.claude/projects/<project>/*.jsonl` |
| **Gemini CLI** | `~/.gemini/tmp/<hash>/checkpoints`, `~/.gemini/history`, `~/.gemini/chats` |

Key principles:

- Raw transcripts preserved unchanged as source of truth
- Cleaned Markdown generated by **deterministic code** (not model tokens)
- Current repo only stores transcripts belonging to this project; others go to global archive only
- First import asks once whether raw transcripts may be committed to the repo

### Cross-Project Search

When searching all memories or chat history:

1. Query `search.sqlite` for fast lookup
2. Use `sessions.jsonl` for session-level metadata filtering (client, project, date range)
3. Load matching cleaned Markdown for context; confirm exact wording against raw transcripts
4. Combine with the current repo's `Memory/` files
5. Fall back to scanning `clean/` directory if the index does not exist

### Session Continuity

When you open a new session and want to continue where you left off, ask MemoryTree to show your most recent conversation:

> "Look at my last chat" / "看看我最近的聊天" / "Continue where I left off"

The skill will:

1. **Instant sync** — immediately scan all three client directories (not waiting for the scheduled heartbeat)
2. **Locate** — find the latest session for the current project across Claude Code, Codex, and Gemini CLI
3. **Summarize** — generate a continuation summary: what was discussed, what was tried, and what remains unresolved
4. **Handoff** — you can say "continue" and pick up exactly where the previous session stopped

This works **cross-client**: a Codex session can be recovered from Claude Code, and vice versa.

For details see [`references/transcript-archive.md`](references/transcript-archive.md) and [`references/heartbeat-scheduling.md`](references/heartbeat-scheduling.md).

### Git Safety

MemoryTree follows strict isolation rules to never interfere with your repo's workflow:

| Rule | Description |
|------|-------------|
| File isolation | Only stages/commits `Memory/**` (excluding `raw/` until approved) and `AGENTS.md` (when managed by MemoryTree) |
| Branch isolation | Uses dedicated branch `memorytree/<scope>-<date>-<slug>` |
| Commit format | `memorytree(<scope>): <subject>` or repo-compatible equivalent |
| PR isolation | Separate PR for MemoryTree-only changes |
| Auto-merge | Only when repo still enforces its review and CI checks |
| Auto-push | On by default; skips if no remote; fast-forward only |
| Protected branches | Never overrides branch protection or CI rules |

The skill stops and asks before proceeding in 8 scenarios: mixed product code, AGENTS.md conflicts, unclear target branch, repo forbids bot pushes, CI conflicts, unknown raw transcript permission, cross-project transcripts, or protected branch refusal.

For the full policy see [`references/git-policy.md`](references/git-policy.md).

### Sensitive Info Scanning

During transcript cleaning, the heartbeat scans for API keys, passwords, tokens, and other secrets:

- Matches are logged as warnings and written to `alerts.json`
- **No automatic deletion or redaction** — the user decides how to handle them

### Locale Support

| Feature | Description |
|---------|-------------|
| Templates | English (`en`) and Simplified Chinese (`zh-cn`) |
| Auto-detect | Detects language from repo content first, then system locale |
| Reply language | Follows user explicit request > message language > repo locale > template locale > `en` |
| Non-destructive | Never rewrites existing files just to translate them |

## Background Heartbeat

The heartbeat automates transcript discovery, import, cleaning, commit, and push without consuming model tokens or requiring human intervention.

**Execution flow**:

```
Acquire lock → Load config.toml → Iterate projects → Discover → Import
→ Clean → Commit → (auto_push) Push → Release lock → Exit
```

### Install the daemon

```bash
memorytree daemon install
```

### Key settings (`~/.memorytree/config.toml`)

| Setting              | Default  | Description |
|----------------------|----------|-------------|
| `auto_push`          | `true`   | Push to remote after each commit. Skips if no remote is configured. |
| `heartbeat_interval` | `"5m"`   | Interval between heartbeat executions. |
| `log_level`          | `"info"` | Log verbosity (`debug`, `info`, `warn`, `error`). |

### Design constraints

- Single execution, stateless, idempotent — safe to re-run at any interval
- One computer = one scheduled heartbeat task
- Will not silently register — always confirms before `install`

For details see [`references/heartbeat-scheduling.md`](references/heartbeat-scheduling.md) and [`references/global-configuration.md`](references/global-configuration.md).

## Design Principles

| Principle | How |
|-----------|-----|
| **Zero intrusion** | Never changes the repo's branch model, CI, or review process |
| **Minimal dependencies** | Built on Node.js stdlib + sql.js (WASM); no native compilation required |
| **Deterministic** | Transcript cleaning done by code, not model tokens |
| **Single source of truth** | Each concept defined in one reference file, others cross-reference |
| **Spec-driven** | Reference docs define the contract; code implements it faithfully |
| **User asset** | Memory belongs to the user; auto_push on by default to prevent local data loss |

## CLI

All commands are available via `memorytree <subcommand>`:

| Command | Description |
|---------|-------------|
| `memorytree init` | Scaffold `Memory/` and `AGENTS.md` for a new repository |
| `memorytree upgrade` | Add missing MemoryTree pieces to a partial repository |
| `memorytree import --source <file>` | Import one transcript into repo mirror and global archive |
| `memorytree discover` | Scan local client stores and import matching transcripts |
| `memorytree locale` | Print the effective locale for a target repository |
| `memorytree recall` | On-demand transcript sync and latest session recall |
| `memorytree daemon install` | Register heartbeat with the OS scheduler (cron / launchd / Task Scheduler) |
| `memorytree daemon uninstall` | Remove the scheduled heartbeat task |
| `memorytree daemon run-once` | Run a single heartbeat cycle immediately |
| `memorytree daemon watch` | Continuous loop for development and debugging only |
| `memorytree daemon status` | Show registration state and lock info |

## Reference Docs

| File | Purpose |
|------|---------|
| [`references/project-detection.md`](references/project-detection.md) | Detect install state |
| [`references/memory-layout.md`](references/memory-layout.md) | Folder and file naming rules |
| [`references/update-rules.md`](references/update-rules.md) | When to version goals, todos, and session logs |
| [`references/git-policy.md`](references/git-policy.md) | Git defaults, auto-push, and policy merge |
| [`references/heartbeat-scheduling.md`](references/heartbeat-scheduling.md) | Heartbeat architecture, daemon CLI, execution flow |
| [`references/global-configuration.md`](references/global-configuration.md) | `~/.memorytree/` layout, `config.toml` schema, `alerts.json` format |
| [`references/transcript-archive.md`](references/transcript-archive.md) | Transcript archival, cleaning, search, and upload rules |
| [`references/locale-selection.md`](references/locale-selection.md) | Locale choice rules |
| [`references/response-language.md`](references/response-language.md) | Reply-language precedence |
| [`references/execution-environment.md`](references/execution-environment.md) | Runtime requirements (Node.js >= 20) |
| [`references/upgrade-path.md`](references/upgrade-path.md) | Safe adoption flow for partial repos |

## Update

```bash
cd ~/.claude/skills/memorytree-workflow && git pull && npm install && npm run build
```

## Requirements

- [Claude Code](https://claude.ai/claude-code) CLI
- Node.js 20+ (minimum supported version)
- CI-verified on Node.js 20, 22, and 24
- Git

## License

MIT
