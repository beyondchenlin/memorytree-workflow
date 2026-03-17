<div align="center">

<img src="assets/logo.svg" alt="MemoryTree" width="120" />

# MemoryTree Workflow

**Persistent, Git-tracked project memory and transcript workflows for Claude Code, Codex, and Gemini CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)

<p>
  <a href="#quick-start">Quick Start</a> &nbsp;&bull;&nbsp;
  <a href="#what-you-get">What You Get</a> &nbsp;&bull;&nbsp;
  <a href="#report-site">Report Site</a> &nbsp;&bull;&nbsp;
  <a href="#heartbeat">Heartbeat</a> &nbsp;&bull;&nbsp;
  <a href="#cli">CLI</a> &nbsp;&bull;&nbsp;
  <a href="#reference-docs">Docs</a>
</p>

</div>

---

## Overview

MemoryTree gives AI-assisted projects a durable memory layer that survives across sessions, branches, and clients.

This repository ships two things:

1. A reusable skill defined by [SKILL.md](SKILL.md)
2. A Node.js CLI for initialization, transcript import, session recall, reporting, and heartbeat automation

The workflow is designed around two storage scopes:

- Per-repository memory in `Memory/`
- Cross-project transcript archives in `~/.memorytree/`

The result is a Git-native memory system that can:

- scaffold and maintain project memory files
- archive raw AI transcripts plus cleaned Markdown indexes
- recall the latest prior session for the current project
- generate a static HTML report site
- publish reports to GitHub Pages through the heartbeat pipeline

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

### Use the skill

In Claude Code, run:

```text
/memorytree-workflow
```

The skill will detect whether the current repository is `not-installed`, `partial`, or `installed`, then immediately take the appropriate next step.

If you prefer to work directly through the CLI, build the project and run commands with `node dist/cli.js ...`.

Optional: make the CLI available as `memorytree` from your shell:

```bash
npm link
```

### First CLI examples

```bash
node dist/cli.js upgrade --root . --format json
node dist/cli.js discover --root . --client all --scope current-project --format json
node dist/cli.js recall --root . --format text
node dist/cli.js report build --root . --no-ai --locale en
node dist/cli.js report serve --dir ./Memory/07_reports --port 4321
```

## What You Get

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

### Global archive layout

Shared state lives under `~/.memorytree/`:

```text
~/.memorytree/
  config.toml
  alerts.json
  heartbeat.lock
  logs/
  transcripts/
    raw/
    clean/
    index/
      sessions.jsonl
      search.sqlite
```

### Core capabilities

| Capability | What it does |
|---|---|
| Workspace scaffolding | Creates or upgrades `AGENTS.md` and the `Memory/` workspace without overwriting stronger existing repo policy |
| Transcript archive | Imports raw transcripts from supported clients and generates cleaned Markdown plus manifests |
| Session recall | Finds the latest prior session for the current project across clients |
| Static report site | Builds a multi-page HTML site from the repository memory and transcript archive |
| Heartbeat automation | Runs discovery, import, report generation, commit, and optional push on a schedule |
| Git-safe behavior | Keeps automatic repo writes on dedicated `memorytree/*` branches and avoids polluting normal product branches |

## Transcript Sources

MemoryTree currently discovers transcripts from these default client stores:

| Client | Source patterns |
|---|---|
| Codex | `~/.codex/sessions/**/*.jsonl` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Gemini CLI | `~/.gemini/tmp/*/checkpoints/**/*.json`, `~/.gemini/tmp/*/checkpoints/**/*.jsonl`, `~/.gemini/history/**/*.json`, `~/.gemini/history/**/*.jsonl`, `~/.gemini/chats/**/*.json`, `~/.gemini/chats/**/*.jsonl` |

Import rules:

- Raw transcripts stay unchanged as evidence.
- Clean transcripts are generated deterministically by code.
- Repo-local mirrors are limited to transcripts that belong to the current repository.
- Unrelated transcripts are archived in the global archive only.
- Raw transcript mirrors are excluded from automatic staging until the user approves raw uploads for that repository.

## Session Continuity

When you ask for your latest prior conversation, MemoryTree can:

1. scan the supported local transcript stores immediately
2. import any new matching transcripts
3. query the global index for the current project
4. exclude the current session by activation time
5. return the latest prior clean transcript content and metadata

This works across clients, so a project session recorded in one client can be recalled from another.

## Report Site

`memorytree report build` generates a static HTML site under `Memory/07_reports/`.

Current report coverage includes:

- dashboard
- transcript list and per-session pages
- goals, todos, knowledge, archive, and projects pages
- client and project filters in search
- graph view
- tags and AI summaries
- breadcrumbs and table of contents
- RSS feed
- OG metadata when `report_base_url` is configured
- English and Simplified Chinese locales

Serve the generated site locally:

```bash
node dist/cli.js report serve --dir ./Memory/07_reports --port 4321
```

Build it manually:

```bash
node dist/cli.js report build --root . --no-ai --locale en --report-base-url https://memory.example.com
```

## Heartbeat

The heartbeat is the background automation layer. It can discover transcripts, import them, generate reports, commit repo-local memory updates, and optionally push.

Execution flow:

```text
Acquire lock -> load config -> iterate projects -> discover -> import -> build report -> commit -> push -> release lock
```

Important branch-safety rule:

- On `memorytree/*` branches, the heartbeat can mirror transcripts into the repository and commit MemoryTree changes.
- On non-`memorytree/*` branches, the heartbeat still imports into the global archive, but keeps the repository clean.

Install the heartbeat:

```bash
node dist/cli.js daemon install
```

Run it once right now:

```bash
node dist/cli.js daemon run-once
```

### Example config

`~/.memorytree/config.toml`

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

[[projects]]
path = "/path/to/repo"
name = "repo"
```

Config fields that matter most for report publishing:

| Field | Default | Meaning |
|---|---|---|
| `generate_report` | `false` | Generate `Memory/07_reports/` during heartbeat runs |
| `locale` | `"en"` | Report locale |
| `gh_pages_branch` | `""` | Publish the generated report to a dedicated branch when set |
| `cname` | `""` | Write a `CNAME` file into the published report output |
| `webhook_url` | `""` | Send a report update notification after report generation |
| `report_base_url` | `""` | Base URL for RSS and OG metadata |

## Git Safety

MemoryTree is strict about not taking over your main development flow.

| Rule | Behavior |
|---|---|
| Branch isolation | Automatic repo-local transcript commits happen only on dedicated `memorytree/*` branches |
| Scope isolation | Repo mirrors include only the current project's transcripts |
| Raw upload control | Raw transcript files are not auto-staged until explicitly approved |
| Push safety | If no remote exists, push is skipped and an alert is written |
| Failure handling | Push failures alert and retry once; report deploy failures never abort the heartbeat |
| Secret scanning | Transcript imports log potential secrets but do not auto-delete or auto-redact them |

## CLI

All commands are available through `node dist/cli.js <subcommand> ...`, or `memorytree <subcommand> ...` if you ran `npm link`.

| Command | Description |
|---|---|
| `memorytree init` | Initialize a MemoryTree workspace in a repository |
| `memorytree upgrade` | Upgrade a partial repository without overwriting stronger repo policy |
| `memorytree import --source <file>` | Import one transcript into the repo mirror and global archive |
| `memorytree discover` | Scan local client stores and import matching transcripts |
| `memorytree locale` | Detect the effective repository locale |
| `memorytree recall` | Run on-demand sync and return the latest prior session |
| `memorytree report build` | Build the static HTML report site |
| `memorytree report serve` | Serve the generated report locally over HTTP |
| `memorytree daemon install` | Register the heartbeat with the OS scheduler |
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

Current validation expectations:

- Node.js 20+ is required
- CI is verified on Node.js 20, 22, and 24
- Black-box E2E covers upgrade, import, discover, recall, report serve, heartbeat branch safety, GitHub Pages publish, and webhook resilience

## Reference Docs

| File | Purpose |
|---|---|
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
