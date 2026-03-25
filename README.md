<div align="center">

<img src="assets/logo.svg" alt="MemoryTree" width="120" />

# MemoryTree Workflow

**Git-tracked project memory, transcript indexing, worktree-safe heartbeat automation, and static report publishing for Claude Code, Codex, and Gemini CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#requirements)

</div>

MemoryTree gives an AI-assisted repository a durable memory layer that survives across sessions, clients, branches, and machines.

It combines:

- a reusable skill defined by [SKILL.md](SKILL.md)
- a Node.js CLI for setup, transcript import, recall, reports, and daemon management
- a dedicated MemoryTree worktree for safe automation
- a global archive under `~/.memorytree/` for cross-project transcript storage and indexing

## The Guides

- [SKILL.md](SKILL.md): skill entry point and behavioral contract
- [docs/memorytree-skill-features-and-startup.md](docs/memorytree-skill-features-and-startup.md): Chinese walkthrough of the skill layers and startup flow
- [docs/worktree-heartbeat-upgrade-plan.md](docs/worktree-heartbeat-upgrade-plan.md): worktree-based heartbeat design and rollout notes
- [docs/caddy-auto-management-design.md](docs/caddy-auto-management-design.md): design notes for managed Caddy support
- [references/heartbeat-scheduling.md](references/heartbeat-scheduling.md): daemon lifecycle and scheduler behavior
- [references/transcript-archive.md](references/transcript-archive.md): transcript import, cleaning, indexing, and recall

## What's New

### Worktree-backed heartbeat

The heartbeat now runs against a dedicated `memory_path` worktree instead of directly mutating your active development checkout. That keeps transcript import, report generation, and Memory-only commits isolated from normal product work.

### Single-source memory branch

The `memorytree` branch is treated as the shared memory source of truth. Your development directory keeps a local cache mirror for `AGENTS.md` and active Memory files, while transcript and report outputs sync back from the worktree.

### Cross-client transcript recall

Transcript discovery and recall work across Claude Code, Codex, and Gemini CLI stores, with deterministic cleaning and a global searchable archive under `~/.memorytree/`.

### Static report publishing

`memorytree report build` generates a static HTML report site, and `memorytree caddy enable` can wire that output into managed local hosting for long-running access.

## Quick Start

### Step 1: Install the skill

You need Node.js 20 or newer.

Windows PowerShell:

```powershell
git clone https://github.com/beyondchenlin/memorytree-workflow "$env:USERPROFILE\.codex\skills\memorytree-workflow"
cd "$env:USERPROFILE\.codex\skills\memorytree-workflow"
npm install
npm run build
npm link
```

macOS:

```bash
git clone https://github.com/beyondchenlin/memorytree-workflow ~/.codex/skills/memorytree-workflow
cd ~/.codex/skills/memorytree-workflow
npm install
npm run build
npm link
```

Ubuntu:

```bash
git clone https://github.com/beyondchenlin/memorytree-workflow ~/.codex/skills/memorytree-workflow
cd ~/.codex/skills/memorytree-workflow
npm install
npm run build
npm link
```

If you use Claude Code, replace `.codex` with `.claude` in the path above.

### Step 2: Connect a repository

Open the repository you want to manage and run:

```bash
memorytree daemon quick-start --root .
```

Recommended defaults:

- `memory_branch = "memorytree"`
- `heartbeat_interval = "5m"`
- `auto_push = true`
- `generate_report = true`
- `raw_upload_permission = "not-set"`

### Step 3: Start using MemoryTree

Useful day-to-day commands:

```bash
memorytree recall --root .
memorytree discover --root . --client all --scope current-project --format json
memorytree daemon run-once --root . --force
memorytree report build --root . --no-ai --locale en
memorytree caddy status --root .
```

In Claude Code, you can also invoke the skill directly:

```text
/memorytree-workflow
```

## Cross-Platform Support

Supported environments:

- Windows PowerShell
- macOS
- Ubuntu and other modern Linux distributions

The installation path differs by platform, but the core repository command stays the same:

```bash
memorytree daemon quick-start --root .
```

## What's Inside

| Component | What it does |
|---|---|
| Skill layer | Guides repo detection, initialization, upgrade, and ongoing MemoryTree maintenance |
| CLI | Provides `init`, `upgrade`, `discover`, `import`, `recall`, `report`, `caddy`, and `daemon` commands |
| Dedicated worktree | Gives heartbeat a safe automation directory on a MemoryTree-only branch |
| Global archive | Stores transcripts, indexes, alerts, logs, worktrees, and shared configuration under `~/.memorytree/` |
| Report builder | Generates a static site under `Memory/07_reports/` with transcripts, goals, todos, search, graph, and RSS |
| Managed Caddy integration | Exposes the report over a long-running local server without custom hand wiring |

Current high-level layout:

```text
Development repository
  AGENTS.md
  Memory/01_goals ... Memory/05_archive
        |
        | sync active context
        v
Dedicated MemoryTree worktree
  isolated memorytree branch
  Memory/06_transcripts
  Memory/07_reports
        |
        | mirror outputs and shared memory state
        v
Global archive ~/.memorytree/
  config.toml
  alerts.json
  worktrees/
  transcripts/
  caddy/
```

## Requirements

- Node.js 20 or newer
- npm
- Git
- Claude Code, Codex, Gemini CLI, or another environment that can consume the skill or CLI

## Installation

### Option 1: Install as a skill

Use this when you want the `memorytree` command available across repositories.

Windows PowerShell:

```powershell
git clone https://github.com/beyondchenlin/memorytree-workflow "$env:USERPROFILE\.codex\skills\memorytree-workflow"
cd "$env:USERPROFILE\.codex\skills\memorytree-workflow"
npm install
npm run build
npm link
```

macOS / Ubuntu:

```bash
git clone https://github.com/beyondchenlin/memorytree-workflow ~/.codex/skills/memorytree-workflow
cd ~/.codex/skills/memorytree-workflow
npm install
npm run build
npm link
```

Quick check:

Windows PowerShell:

```powershell
Get-Command memorytree
```

macOS / Ubuntu:

```bash
command -v memorytree
```

### Option 2: Run from source locally

Use this when you want to work on the repository itself or run the CLI without installing a global link.

```bash
npm install
npm run build
node dist/cli.js daemon quick-start --root .
```

### Update

If the skill directory already exists, update it with the commands below instead of running `git clone` again.

Claude Code:

```bash
cd ~/.claude/skills/memorytree-workflow
git pull
npm install
npm run build
npm link
```

Codex:

```bash
cd ~/.codex/skills/memorytree-workflow
git pull
npm install
npm run build
npm link
```

## Key Concepts

### Development repository

This is the directory you actively edit. MemoryTree keeps `AGENTS.md` and `Memory/01_goals` through `Memory/05_archive` readable there as a local cache mirror.

### Dedicated MemoryTree worktree

This is the automation directory recorded as `memory_path` in `~/.memorytree/config.toml`. Heartbeat runs there, commits there, and pushes from there when `auto_push = true`.

### Global archive

Shared state lives under `~/.memorytree/`, including `config.toml`, `alerts.json`, logs, transcript indexes, and per-project worktrees.

### Transcript policy

Raw transcripts stay unchanged as evidence. Clean transcript indexes are generated deterministically by code. Repo-local raw transcript mirrors stay out of automatic staging until `raw_upload_permission` is explicitly approved.

### Report output

`memorytree report build` writes a static site to `Memory/07_reports/`. That output can be previewed temporarily with `report serve` or exposed long-term through managed Caddy integration.

## FAQ

### Does quick-start change my current development branch?

Not directly. Heartbeat operates in the dedicated `memory_path` worktree on the MemoryTree branch, not in your normal product branch. With `auto_push = true`, it will commit and push MemoryTree-owned changes from that dedicated branch.

### Why are raw transcripts not auto-pushed by default?

Because the default is `raw_upload_permission = "not-set"`. The repository keeps raw transcript mirrors locally, but automatic staging and pushing of `Memory/06_transcripts/raw/**` stays disabled until you explicitly approve it.

### Where does the report live?

The generated static site is written to `Memory/07_reports/`.

### How do I refresh imported transcripts immediately?

Run:

```bash
memorytree daemon run-once --root . --force
```

### How do I update an installed skill?

Use the commands in [Installation](#installation) under `Update`.

## Running Tests

Install dependencies:

```bash
npm install
```

Validate locally:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Current validation includes:

- unit coverage for transcript parsing, import, upgrade, report rendering, heartbeat orchestration, and Caddy management
- cross-platform CI on Node.js 20, 22, and 24
- end-to-end checks for worktree registration, heartbeat execution, branch safety, raw transcript policy, and report publishing

## Contributing

Contributions are welcome, especially in these areas:

- transcript import coverage for more clients and export formats
- report UX, navigation, search, and visualization improvements
- heartbeat safety, scheduling, and Git ergonomics
- installation flow, docs, and cross-platform polish

Before opening a PR, run the local validation commands in [Running Tests](#running-tests).

## Links

- Repository: https://github.com/beyondchenlin/memorytree-workflow
- Issues: https://github.com/beyondchenlin/memorytree-workflow/issues
- Skill entry point: [SKILL.md](SKILL.md)
- Heartbeat reference: [references/heartbeat-scheduling.md](references/heartbeat-scheduling.md)
- Transcript reference: [references/transcript-archive.md](references/transcript-archive.md)

## License

MIT
