# MemoryTree Worktree Heartbeat Upgrade Plan

## Purpose

This document defines a worktree-based upgrade path for MemoryTree heartbeat.

The goal is to isolate automatic MemoryTree activity from the user's main development directory and main branch rules, while still making MemoryTree outputs visible inside the active development directory.

## Problem Statement

The current behavior couples heartbeat too closely to the repository path that is registered in `~/.memorytree/config.toml`.

That creates two practical issues:

1. If heartbeat runs in the main development directory, its automatic transcript imports and report outputs can interfere with the user's normal branch and commit flow.
2. If heartbeat does not run on a dedicated MemoryTree branch, repo-local transcript mirroring is skipped, which can leave the in-repo report looking empty even though data exists in the global archive.

## Target Outcome

After this upgrade:

1. Heartbeat runs only inside a dedicated Git worktree.
2. The main development directory does not run heartbeat.
3. The main development branch keeps its normal GitHub upload, review, and merge rules.
4. MemoryTree outputs generated in the worktree are copied back into the main development directory so the user can read and use them locally.
5. The system never relies on branch merges between the main development branch and the MemoryTree branch.
6. Project behavior is configured per project, while the operating system still runs a single global heartbeat task.

## Terms

- `development directory`: the directory where the user is actively editing product code
- `memory worktree`: a dedicated Git worktree used only for MemoryTree automation
- `heartbeat`: the background process that discovers transcripts, imports them, and optionally builds reports
- `directory sync`: copying selected files between the development directory and the memory worktree without merging branches

## Config Scope

### Current Limitation

The current implementation stores several behavior switches as global top-level fields in `~/.memorytree/config.toml`.

Examples:

- `heartbeat_interval`
- `auto_push`
- `generate_report`
- `report_port`
- `gh_pages_branch`
- `report_base_url`

That means a quick-start action for one project can accidentally change behavior for another registered project.

### Upgrade Direction

The target model is:

- one global scheduler
- per-project execution settings

In other words:

- the operating system still runs one heartbeat task
- each project entry carries its own behavior flags
- the heartbeat loop decides project by project whether work is due and which options apply

### Why A Single Global Scheduler

The upgrade should not create one OS scheduler task per project.

Reason:

- the current heartbeat runtime already assumes single-instance execution
- one scheduler avoids lock contention and duplicate runs
- one scheduler is simpler to operate across Windows, macOS, and Linux

Recommended model:

1. install one global heartbeat task
2. run it on a short fixed cadence
3. evaluate each registered project independently
4. execute only the projects whose own interval and settings say they are due

## Proposed Architecture

### Development Directory

The development directory remains the user's normal working copy.

Responsibilities:

- product code editing
- normal branch workflow
- user-driven commits and pushes
- reading MemoryTree outputs after they are copied back from the memory worktree

It must not run automatic heartbeat commits.

### Memory Worktree

The memory worktree is a separate local folder created with `git worktree`.

Recommended characteristics:

- checked out on a dedicated branch, defaulting to `memorytree`
- optionally allowed to use a custom branch name in detailed settings
- registered as the project path used by heartbeat
- allowed to run automatic MemoryTree writes, transcript imports, and report builds

Recommended path pattern:

- `~/.memorytree/worktrees/<repo-name>`

## Why Worktree Instead Of Branch Merge

The intended model is not:

- run heartbeat on a side branch
- merge that branch into the user's current development branch every 30 minutes

That approach would pollute branch history, create unnecessary merge commits, and mix MemoryTree automation with product-development Git flow.

The intended model is:

- keep heartbeat isolated in the memory worktree
- copy selected MemoryTree files into the development directory
- let the user decide how and when those files are committed on their active branch

This is directory-level synchronization, not branch-level merge automation.

## Sync Model

### Source Of Truth Rules

To avoid conflicts, each file group has only one source of truth.

#### Development Directory Is Source Of Truth

These files should be pushed from the development directory into the memory worktree before heartbeat runs:

- `AGENTS.md`
- `Memory/01_goals/**`
- `Memory/02_todos/**`
- `Memory/03_chat_logs/**`
- `Memory/04_knowledge/**`
- `Memory/05_archive/**`

Reason:

These files reflect user-confirmed project context and active session state.

#### Memory Worktree Is Source Of Truth

These files should be copied from the memory worktree back into the development directory after heartbeat runs:

- `Memory/06_transcripts/**`
- `Memory/07_reports/**`

Reason:

These files are the direct products of heartbeat-driven transcript import and report generation.

### Visibility And Commit Semantics

When `Memory/06_transcripts/**` and `Memory/07_reports/**` are copied back into the development directory, they are expected to be visible to the user there.

`Memory/06_transcripts/**` is also expected to be committable from the development directory when the user decides that those files belong in the current branch.

This is an intentional product behavior, not a synchronization accident.

The only explicit exception remains any raw-transcript path that the repository policy keeps out of automatic staging until the user approves uploads.

### Explicit Non-Goal

The same path must not be edited independently in both directories and then merged heuristically.

This upgrade should use directional copy rules, not two-way merge logic.

## Sync Triggers

### Background Sync

Recommended default behavior:

1. One global heartbeat task runs on a short fixed interval.
2. Each project decides independently whether its own heartbeat interval has elapsed, for example `5m`.
3. A development-directory refresh runs on a slower per-project interval, for example `30m`.
4. That refresh copies the latest `Memory/06_transcripts/**` and `Memory/07_reports/**` from the memory worktree into the development directory.

This allows the user to see current MemoryTree data locally without running heartbeat in the development directory.

### Manual Trigger

When the user manually triggers heartbeat from the directory they are currently editing, the system should perform the following sequence:

1. Detect the current development directory.
2. Copy `AGENTS.md` and `Memory/01-05` from the development directory to the memory worktree.
3. Run heartbeat in the memory worktree.
4. Copy `Memory/06-07` from the memory worktree back to the current development directory.

This keeps the memory worktree aligned with the user's latest active context before running import and build operations.

## Git Rules

### Memory Worktree

The memory worktree may:

- run heartbeat
- auto-import transcripts
- auto-build reports
- auto-commit MemoryTree-owned changes
- auto-push its dedicated MemoryTree branch if enabled

### Development Directory

The development directory must not:

- run automatic heartbeat commits
- receive automatic branch merges from the memory worktree
- have its normal branch protection or review rules bypassed

All GitHub upload behavior for the development directory remains under the user's existing branch logic.

Files copied back into the development directory may appear in `git status`, and that is expected.

## Onboarding Flow

The intended activation flow should be:

1. User enables MemoryTree for a repository.
2. System detects that the repository is not yet backed by a dedicated memory worktree.
3. System offers:
   - `Quick Start`
   - `Detailed Settings`
4. On confirmation, the system:
   - creates or reuses a dedicated Git worktree
   - checks out a dedicated MemoryTree branch inside that worktree
   - registers the worktree path in `~/.memorytree/config.toml`
   - preserves the user's development directory as the non-heartbeat working copy

### Quick Start

Recommended defaults:

- global scheduler already installed or installed once during activation
- project heartbeat interval: `5m`
- project development-directory refresh interval: `30m`
- project `auto_push = true`
- project `generate_report = true`
- project memory branch: `memorytree`
- worktree-backed heartbeat enabled

### Detailed Settings

The user may customize:

- project heartbeat interval
- project development-directory refresh interval
- project auto-push behavior
- project report generation
- project report publishing settings
- dedicated memory branch name
- raw transcript upload permission

## Implementation Phases

### Phase 1: Config Model

Add explicit configuration for:

- stable project identifier
- development directory path
- memory worktree path
- project heartbeat interval
- project development-directory refresh interval
- project sync mode flags
- project auto-push and report settings
- per-project report publishing settings
- last-run timestamps needed for due-check evaluation under one global scheduler

Example shape:

```toml
heartbeat_tick = "1m"

[[projects]]
id = "memorytree-workflow"
development_path = "D:/demo1/memorytree-workflow"
memory_path = "C:/Users/ai/.memorytree/worktrees/memorytree-workflow"
memory_branch = "memorytree"
heartbeat_interval = "5m"
refresh_interval = "30m"
auto_push = true
generate_report = true
report_port = 10010
gh_pages_branch = "gh-pages"
report_base_url = "https://example.github.io/memorytree-workflow"
```

### Phase 2: Worktree Bootstrap

Add a bootstrap step that:

- verifies the repository is Git-backed
- creates or reuses a dedicated worktree
- ensures the worktree is on the project's configured MemoryTree branch, defaulting to `memorytree`

### Phase 3: Directional Sync Engine

Add a file sync mechanism with whitelist-based copy rules:

- development directory to worktree for `AGENTS.md` and `Memory/01-05`
- worktree to development directory for `Memory/06-07`

### Phase 4: Manual Trigger Integration

Wire manual heartbeat execution so it always:

1. syncs latest context into the worktree
2. runs heartbeat there
3. syncs outputs back to the invoking development directory

### Phase 5: Background Refresh

Add a scheduled refresh path that copies worktree outputs back into the development directory on a slower cadence than heartbeat.

## Current CLI Surface

The current implementation now exposes two concrete entry points for this design:

1. `memorytree daemon register --root <repo> --quick-start`
2. `memorytree daemon register --root <repo> --heartbeat-interval <x> --refresh-interval <y> --auto-push <true|false> --generate-report <true|false> --branch <name>`

What `daemon register` now does:

- registers or updates the project in `~/.memorytree/config.toml`
- writes both `development_path` and `memory_path`
- creates or reuses the dedicated Git worktree
- stores `memory_branch` per project
- ensures the worktree is on the configured branch
- uses `memorytree` for Quick Start by default, while detailed settings may override the branch name
- auto-configures the first upstream binding when `auto_push` is enabled and a remote exists

The current implementation also extends manual execution:

- `memorytree daemon run-once --root <repo> --force`

That command targets the matching project directly, bypasses due checks, and runs the worktree-backed sync-and-heartbeat flow immediately.

## Risks And Guardrails

### Risk: Conflicting Edits

If both directories edit the same file family, the system can overwrite newer local content.

Guardrail:

- keep strict source-of-truth ownership by directory

### Risk: Hidden Sync Failures

If copy steps fail silently, the user may believe heartbeat is working while the development directory stays stale.

Guardrail:

- surface sync status in logs and alerts

### Risk: Wrong Registered Path

If heartbeat remains registered against the main development directory instead of the worktree, the isolation model breaks.

Guardrail:

- store and display both paths explicitly during activation and status checks

### Risk: Cross-Project Identity Collisions

If project identity depends only on directory basename or slug matching, similarly named repositories can interfere with routing or transcript matching.

Guardrail:

- add a stable project identifier in project configuration
- prefer exact configured paths over inferred names whenever possible

## Current Recommendation

Use a dedicated memory worktree as the only heartbeat execution target.

Do not merge the MemoryTree branch into the user's active development branch on a timer.

Instead, copy MemoryTree output files from the worktree back into the development directory so the user can read them and decide how they participate in the normal Git workflow.

Keep the scheduler global, but make runtime behavior project-specific.
