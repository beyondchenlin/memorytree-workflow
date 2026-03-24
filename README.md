<div align="center">

<img src="assets/logo.svg" alt="MemoryTree" width="120" />

# MemoryTree Workflow

**Git-tracked project memory, transcript indexing, worktree-safe heartbeat automation, and report publishing for Claude Code, Codex, and Gemini CLI.**

<p>
  <code>Worktree-Backed Heartbeat</code> &nbsp;&bull;&nbsp;
  <code>Cross-Client Recall</code> &nbsp;&bull;&nbsp;
  <code>Managed Caddy Hosting</code> &nbsp;&bull;&nbsp;
  <code>Static Report Publishing</code>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)

<p>
  <a href="#quick-start">Quick Start</a> &nbsp;&bull;&nbsp;
  <a href="#architecture">Architecture</a> &nbsp;&bull;&nbsp;
  <a href="#capabilities">Capabilities</a> &nbsp;&bull;&nbsp;
  <a href="#heartbeat">Heartbeat</a> &nbsp;&bull;&nbsp;
  <a href="#caddy">Caddy</a> &nbsp;&bull;&nbsp;
  <a href="#cli">CLI</a> &nbsp;&bull;&nbsp;
  <a href="#reference-docs">Docs</a>
</p>

</div>

---

## Overview

MemoryTree gives AI-assisted repositories a durable memory layer that survives across sessions, clients, branches, and machines.

This repository ships two things:

1. A reusable skill defined by [SKILL.md](SKILL.md)
2. A Node.js CLI for workspace setup, transcript import, session recall, report generation, heartbeat automation, and managed local hosting

The current implementation is built around three storage scopes:

- The development repository you actively edit
- A dedicated MemoryTree worktree that the heartbeat can update safely
- A global archive under `~/.memorytree/` for cross-project transcript storage and indexing

That model lets MemoryTree keep your main development flow clean while still importing transcripts, generating reports, and optionally publishing Memory-only updates from an isolated branch.

## Quick Start

### Install as a skill

Claude Code:

```bash
git clone https://github.com/beyondchenlin/memorytree-workflow ~/.claude/skills/memorytree-workflow
cd ~/.claude/skills/memorytree-workflow
npm install
npm run build
```

Codex:

```bash
git clone https://github.com/beyondchenlin/memorytree-workflow ~/.codex/skills/memorytree-workflow
cd ~/.codex/skills/memorytree-workflow
npm install
npm run build
```

Windows PowerShell (Codex):

```powershell
git clone https://github.com/beyondchenlin/memorytree-workflow.git `
  $env:USERPROFILE\.codex\skills\memorytree-workflow

cd $env:USERPROFILE\.codex\skills\memorytree-workflow
npm install
npm run build
```

If your installer expects a skill path, use the repository root. `SKILL.md` lives at the top level.

Optional: expose the CLI as `memorytree` in your shell:

```bash
npm link
```

### Use the skill

In Claude Code, run:

```text
/memorytree-workflow
```

The skill detects whether the current repository is `not-installed`, `partial`, or `installed`, then takes the next appropriate step immediately.

### Use the CLI directly

`memorytree init` and `memorytree upgrade` only create or update repository files. They do not register the repository with heartbeat or modify `~/.memorytree/config.toml` by themselves.

Recommended first-time setup for a repository that should use heartbeat:

```bash
memorytree upgrade --root . --format json
memorytree daemon quick-start --root .
memorytree caddy enable --root .
```

Quick Start keeps the dedicated `memorytree` branch as the shared source of truth and refreshes `AGENTS.md` plus `Memory/**` back into your development directory as local cache mirrors.

Useful day-to-day commands:

```bash
memorytree recall --root .
memorytree discover --root . --client all --scope current-project --format json
memorytree report build --root . --no-ai --locale en
memorytree caddy status --root .
memorytree daemon run-once --root . --force
```

## Architecture

MemoryTree now runs as a worktree-aware single-source system, not just a single-folder transcript importer:

```text
Development repository (local cache mirror)
  AGENTS.md
  Memory/01_goals ... Memory/07_reports
        |
        | sync active context into
        v
Dedicated MemoryTree worktree (shared source of truth)
  isolated memorytree branch
  Memory/06_transcripts
  Memory/07_reports
        |
        | mirror matching transcripts, commit/push Memory-only changes,
        | build report output
        v
Global archive ~/.memorytree/
  config.toml
  alerts.json
  worktrees/
  transcripts/raw
  transcripts/clean
  transcripts/index
  caddy/
```

The dedicated MemoryTree branch is the only Git-backed shared memory source. The development directory is a local cache mirror: heartbeat copies active context into the dedicated worktree, processes transcript imports there, and then syncs refreshed transcript/report outputs back into the directory you are actively using.

### Per-repository layout

After initialization or upgrade, a repository can contain:

```text
AGENTS.md
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
  07_reports/
```

### Global layout

Shared state lives under `~/.memorytree/`:

```text
~/.memorytree/
  config.toml
  alerts.json
  heartbeat.lock
  logs/
  worktrees/
  caddy/
    Caddyfile
    sites/
  transcripts/
    raw/
    clean/
    index/
      manifests/
      sessions.jsonl
      search.sqlite
```

## Capabilities

| Capability | Current behavior |
|---|---|
| Workspace scaffolding | `init` and `upgrade` create `Memory/` plus `AGENTS.md` without overwriting stronger existing repo policy |
| Transcript archive | `discover` scans default client stores, while `import` handles explicit transcript files and mirrors matching sessions into the repo |
| Session recall | `recall` runs an on-demand sync and returns the latest prior session for the current repository across clients |
| Worktree-backed heartbeat | `daemon register` and `daemon quick-start` create an isolated MemoryTree worktree, schedule runs, and keep the shared memory branch plus development cache mirrors in sync |
| Report generation | `report build` creates a multi-page static site with transcripts, goals, todos, knowledge, archive, projects, graph, search, tags, and RSS |
| Managed local hosting | `caddy enable|disable|status` writes project-scoped Caddy fragments for long-running local report hosting |
| Git safety | Automatic repo-local commits stay confined to MemoryTree branches and skip raw transcript mirrors until raw uploads are approved |

## Transcript Sources

Default discovery currently scans these client stores:

| Client | Source patterns |
|---|---|
| Codex | `~/.codex/sessions/**/*.jsonl` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Gemini CLI | `~/.gemini/tmp/*/checkpoints/**/*.json`, `~/.gemini/tmp/*/checkpoints/**/*.jsonl`, `~/.gemini/history/**/*.json`, `~/.gemini/history/**/*.jsonl`, `~/.gemini/chats/**/*.json`, `~/.gemini/chats/**/*.jsonl` |

Explicit one-off import also supports transcript files that are not part of default discovery, including `doubao` exports:

```bash
memorytree import --source /path/to/doubao_export.txt --client doubao --root . --force-repo
```

Import rules:

- Raw transcripts stay unchanged as evidence.
- Clean transcripts are generated deterministically by code.
- Repo-local mirrors are limited to transcripts that belong to the current repository unless `--force-repo` is used deliberately.
- Unrelated transcripts are archived in the global archive only.
- Raw transcript mirrors are excluded from automatic staging until the user approves raw uploads for that repository.

## Session Continuity

When you ask for the most recent prior conversation, MemoryTree can:

1. scan the supported local transcript stores immediately
2. import any new matching transcripts
3. query the global index for the current project
4. exclude the current session by activation time
5. return the latest prior clean transcript content and metadata

This works across clients, so a project session recorded in one assistant can be recalled from another.

## Report Site

`memorytree report build` generates a static HTML site under `Memory/07_reports/`.

Current report coverage includes:

- dashboard
- transcript list and per-session pages
- goals, todos, knowledge, archive, and projects pages
- search, filters, and snippets
- graph view and backlink navigation
- tags and cached AI summaries
- breadcrumbs and table of contents
- RSS feed
- optional GitHub Pages deployment
- optional webhook notification
- English and Simplified Chinese locales

Build it manually:

```bash
memorytree report build --root . --no-ai --locale en --report-base-url https://memory.example.com
```

Temporary fallback preview:

```bash
memorytree report serve --dir ./Memory/07_reports --port 10010
```

`report serve` is intended for temporary preview. For long-running local access, keep Caddy pointed at `Memory/07_reports/`.

## Heartbeat

The heartbeat is the background automation layer. It is now project-aware and worktree-aware.

Recommended setup:

```bash
memorytree daemon quick-start --root .
```

Use this as the quick-install path when you want the current repository to join heartbeat with the recommended defaults.

Quick Start keeps the dedicated `memorytree` branch as the shared source of truth and treats your development directory as a local cache mirror.

If you want more control, install the machine scheduler once and then register each repository with your own branch, heartbeat cadence, and report settings:

```bash
memorytree daemon install --interval 5m --auto-push true
memorytree daemon register --root . --branch memorytree-docs --heartbeat-interval 10m --auto-push false --generate-report true --report-port 10010
memorytree daemon run-once --root . --force
```

The heartbeat now drives both transcript import and cache-mirror refresh timing. `refresh_interval` is no longer part of the runtime or config surface.

Current execution flow:

```text
Acquire lock
  -> load config
  -> select due projects
  -> ensure dedicated MemoryTree worktree
  -> sync AGENTS.md + active Memory context into the worktree
  -> discover and import matching transcripts
  -> build/update Memory/07_reports when report generation is enabled
  -> commit/push Memory-only changes on the MemoryTree branch when allowed
  -> sync transcripts and reports back to the development directory
  -> release lock
```

Important branch-safety rules:

- Repo-local transcript mirroring and automatic commits only happen on a dedicated MemoryTree branch.
- On non-MemoryTree branches, the heartbeat still imports into the global archive but keeps the repository clean.
- If no Git remote exists, push is skipped and an alert is written.
- Push failures alert and retry once.
- Sensitive transcript patterns are logged as warnings only; they are not auto-deleted or auto-redacted.

## Caddy

MemoryTree includes first-stage project-managed Caddy support for local report hosting.

Recommended commands:

```bash
memorytree caddy enable --root .
memorytree caddy status --root .
memorytree caddy disable --root .
```

What it manages:

- `~/.memorytree/caddy/Caddyfile`
- `~/.memorytree/caddy/sites/<project-id>.caddy`
- per-project port and exposure settings taken from `~/.memorytree/config.toml`

Exposure modes:

- `local`: bind to `127.0.0.1` and `localhost` only
- `lan`: bind on the configured port and expose LAN URLs for the machine's IPv4 interfaces

For long-running local access, `caddy enable` is the primary path. `report serve` remains the lightweight fallback.

## Configuration

Global settings live in `~/.memorytree/config.toml`.

Example:

```toml
heartbeat_interval = "5m"
auto_push = true
log_level = "info"
generate_report = true
locale = "en"
gh_pages_branch = "gh-pages"
cname = "memory.example.com"
webhook_url = ""
report_base_url = "https://memory.example.com"
report_port = 10010
report_exposure = "local"

[[projects]]
id = "my-repo"
path = "/path/to/repo"
name = "my-repo"
development_path = "/path/to/repo"
memory_path = "/path/to/.memorytree/worktrees/my-repo"
memory_branch = "memorytree"
heartbeat_interval = "5m"
auto_push = true
generate_report = true
locale = "en"
gh_pages_branch = "gh-pages"
report_base_url = "https://memory.example.com"
report_port = 10010
report_exposure = "local"
```

Fields that matter most:

| Field | Meaning |
|---|---|
| `development_path` | The directory you actively work in |
| `memory_path` | The dedicated MemoryTree worktree used by the heartbeat |
| `memory_branch` | The branch reserved for MemoryTree automation |
| `heartbeat_interval` | Per-project heartbeat cadence |
| `generate_report` | Whether heartbeat should build `Memory/07_reports` after transcript imports |
| `gh_pages_branch` | Branch used for report publishing when configured |
| `report_base_url` | Base URL for RSS and OG metadata |
| `report_port` | Default local report port for this project |
| `report_exposure` | `local` or `lan` exposure for managed Caddy hosting |

`path` is still preserved for compatibility, but the worktree-aware flow is driven by `development_path` and `memory_path`.

## Git Safety

MemoryTree is strict about not taking over your normal development flow.

| Rule | Behavior |
|---|---|
| Branch isolation | Automatic repo-local transcript commits happen only on dedicated MemoryTree branches |
| Worktree isolation | Heartbeat automation can run from a dedicated worktree instead of your main working directory |
| Scope isolation | Repo mirrors include only the current project's transcripts unless you force a repo-local import |
| Raw upload control | Raw transcript files are not auto-staged until explicitly approved |
| Push safety | If no remote exists, push is skipped and an alert is written |
| Failure handling | Push failures alert and retry once; report and webhook failures do not abort the heartbeat cycle |
| Secret scanning | Transcript imports log potential secrets but do not auto-delete or auto-redact them |

## CLI

All commands are available through `node dist/cli.js <subcommand> ...`, or `memorytree <subcommand> ...` if you ran `npm link`.

| Command | Description |
|---|---|
| `memorytree init` | Initialize MemoryTree files in a repository without registering heartbeat |
| `memorytree upgrade` | Upgrade repository files to MemoryTree without registering heartbeat |
| `memorytree import --source <file>` | Import one transcript into the repo mirror and global archive |
| `memorytree discover` | Scan local client stores and import matching transcripts |
| `memorytree locale` | Detect the effective repository locale |
| `memorytree recall` | Run on-demand sync and return the latest prior session |
| `memorytree report build` | Build the static HTML report site |
| `memorytree report serve` | Temporarily preview the generated report over HTTP |
| `memorytree caddy enable` | Write/update the current project's managed Caddy fragment and reload Caddy |
| `memorytree caddy disable` | Remove the current project's managed Caddy fragment and reload Caddy |
| `memorytree caddy status` | Show whether the current project is connected to MemoryTree-managed Caddy |
| `memorytree daemon install` | Register the machine-level heartbeat scheduler |
| `memorytree daemon quick-start` | Quick install: connect the repository to heartbeat with the shared memory branch + local cache mirror defaults |
| `memorytree daemon register` | Advanced heartbeat setup with custom per-project settings |
| `memorytree daemon uninstall` | Remove the scheduled heartbeat task |
| `memorytree daemon run-once` | Execute one heartbeat cycle immediately |
| `memorytree daemon watch` | Development-only continuous heartbeat loop |
| `memorytree daemon status` | Show scheduler registration and lock status |

## Development And Validation

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Validate locally:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Current validation shape:

- Node.js 20+ is required locally
- CI runs on Node.js 20, 22, and 24 across Linux, macOS, and Windows
- The repository includes focused unit coverage for transcript parsing/import, project upgrade, report rendering, heartbeat orchestration, and Caddy management
- The E2E workflow runs the CLI end-to-end on Node.js 20 across Linux, macOS, and Windows
- Both GitHub Actions workflows also support manual `workflow_dispatch` reruns when you want an on-demand cross-platform check before or after a merge

Current cross-platform E2E coverage includes:

- transcript import, discover, recall, and report build/serve
- dedicated worktree registration plus immediate `daemon run-once` execution
- de-tracked development directories staying clean while cache mirrors refresh from the worktree
- snapshot commits when no new transcripts are imported but synced context changes
- raw transcript mirror policy checks for approved vs. unapproved uploads
- ignored `AGENTS.md` and `Memory/**` paths still being committed correctly on the dedicated MemoryTree branch
- branch-safety behavior on non-MemoryTree branches
- report deployment and webhook failure tolerance

## Reference Docs

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | Skill entry point and behavioral contract |
| [docs/memorytree-skill-features-and-startup.md](docs/memorytree-skill-features-and-startup.md) | Chinese walkthrough of the skill layers and startup flow |
| [docs/记忆分支单一真源两阶段改造方案.md](docs/记忆分支单一真源两阶段改造方案.md) | Two-phase proposal for making `memorytree` the only shared memory source and turning the development directory into a local cache mirror |
| [docs/worktree-heartbeat-upgrade-plan.md](docs/worktree-heartbeat-upgrade-plan.md) | Worktree-based heartbeat design and rollout notes |
| [docs/caddy-auto-management-design.md](docs/caddy-auto-management-design.md) | Design notes for managed Caddy support |
| [references/project-detection.md](references/project-detection.md) | Install-state detection |
| [references/memory-layout.md](references/memory-layout.md) | Memory folder layout |
| [references/update-rules.md](references/update-rules.md) | Goal, todo, and chat-log update rules |
| [references/git-policy.md](references/git-policy.md) | Safe Git defaults and policy guidance |
| [references/heartbeat-scheduling.md](references/heartbeat-scheduling.md) | Heartbeat lifecycle and scheduler behavior |
| [references/global-configuration.md](references/global-configuration.md) | `~/.memorytree/` layout and config schema |
| [references/transcript-archive.md](references/transcript-archive.md) | Transcript import, cleaning, indexing, and recall |
| [references/locale-selection.md](references/locale-selection.md) | Locale detection rules |
| [references/response-language.md](references/response-language.md) | Reply-language precedence |
| [references/upgrade-path.md](references/upgrade-path.md) | Non-destructive adoption path |

## Update

Claude Code:

```bash
cd ~/.claude/skills/memorytree-workflow
git pull
npm install
npm run build
```

Codex:

```bash
cd ~/.codex/skills/memorytree-workflow
git pull
npm install
npm run build
```

## Requirements

- Node.js 20 or newer
- npm
- Git
- Claude Code, Codex, or another environment that can consume the skill or CLI

## License

MIT
