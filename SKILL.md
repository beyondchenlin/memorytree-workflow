---
name: memorytree-workflow
description: Detect, initialize, and maintain a reusable MemoryTree project-memory workspace for any code repository. On activation, immediately detect and report the repo's MemoryTree state.
---

# MemoryTree

Use this skill for repo-level project memory. Do not treat it as an application runtime feature unless the user explicitly asks to productize it.

## On Activation

When this skill is invoked, immediately perform these steps without waiting for further user input:

1. Detect the repo state (`not-installed`, `partial`, or `installed`) using `references/project-detection.md`.
2. Run `memorytree alerts` to acknowledge pending alerts before proceeding. If the global command is unhealthy, run `node <installed-skill-root>/dist/cli.js alerts` instead. This displays pending alerts to the user and clears the acknowledged entries. Use `--keep` only when the user explicitly wants to inspect alerts without acknowledging them.
3. If `not-installed`: run `memorytree init` to scaffold the workspace, then report what was created.
4. If `partial`: run `memorytree upgrade` to add missing pieces, then report what was added.
5. If `installed`: read the active goal, bound todo, and latest chat log. Report the current state (goal summary, todo progress, pending tasks) and ask the user what they want to work on next. Before recommending daemon setup, verify that the resolved `memorytree` command is real and healthy. When the command is missing, silent, zero-byte, or resolves into an unrelated install directory, run `node <installed-skill-root>/dist/cli.js doctor` and fall back to direct `node <installed-skill-root>/dist/cli.js ...` invocation instead of repeating the broken global command. If `memorytree daemon status` shows the heartbeat is not registered and command resolution is healthy, ask the user whether they want the recommended current-repository setup via `memorytree daemon quick-start --root <repo>` or only a machine-level scheduler restore via `memorytree daemon install --interval 5m --auto-push true`. Use `memorytree daemon register` only when they explicitly want custom branch, interval, report-port, or worktree settings. Use plain-text questions compatible with all AI assistants, not client-specific UI components.

Do not stop after detection to ask whether you should proceed. Act on the result immediately.

## Core Behavior

1. Detect the repo state before changing files. Use `references/project-detection.md`.
2. If MemoryTree is missing, initialize it with `memorytree init`. If the CLI is not available, create the files from `assets/templates/`.
3. If MemoryTree is partial, upgrade it with `memorytree upgrade` before manual maintenance.
4. If MemoryTree is already installed, maintain only the active goal, bound todo, and current chat log. Use `references/update-rules.md`.
5. Keep the installation compatible with the host repo's branch, PR, CI, and review rules. Use `references/git-policy.md`.
6. Prefer safe defaults: do not add reply suffix requirements unless the host repository already requires them, do not mix code-and-memory commits by default, and do not override branch policy. MemoryTree-only git automation is allowed only inside the isolated flow in `references/git-policy.md`.
7. When locale is not explicit, choose it from repo language first, then system language. Use `references/locale-selection.md`.
8. Keep reply language aligned with user language first, then repo locale. Use `references/response-language.md`.
9. For partial repos, use the non-destructive upgrade path before manual maintenance. Use `references/upgrade-path.md`.
10. When transcript archival is enabled, import transcripts with deterministic code, preserve raw transcripts as evidence in both the current repo mirror and the global archive, generate cleaned Markdown for indexing, keep cross-project backfills and ambiguous ownership cases in the global archive only, and ask once per repository whether raw transcript files may be committed or pushed. Use `references/transcript-archive.md`.
11. When CLI commands are needed, use `memorytree <subcommand>` (requires Node.js ≥ 20). If Node.js is not available, fall back to manual scaffolding from `assets/templates/`. See `references/execution-environment.md`.
12. Transcript discovery, import, cleaning, and push are handled by the background heartbeat process. The model only writes chat log summaries and updates goals and todos. See `references/heartbeat-scheduling.md`.
13. Global configuration is stored in `~/.memorytree/config.toml`. See `references/global-configuration.md`.
14. When the user asks to see their most recent conversation, trigger an on-demand transcript sync for the current project, locate the latest session across all three clients, and generate a continuation summary. See `references/transcript-archive.md` and `references/heartbeat-scheduling.md`.
15. All interactive prompts (heartbeat install, configuration, session continuity) must use plain-text questions compatible with every AI assistant that supports this skill. Do not rely on client-specific UI components. See `references/heartbeat-scheduling.md`.

## Read Order

1. Repo `AGENTS.md`, if present.
2. Latest file in `Memory/01_goals/`.
3. Latest todo bound to that goal in `Memory/02_todos/`.
4. `Memory/04_knowledge/` only when needed.
5. `Memory/06_transcripts/clean/`, transcript manifests, and repo-local raw transcript mirrors only when transcript history or cross-project memory search is relevant.
6. `Memory/03_chat_logs/` and `Memory/05_archive/` only when needed.

## Detect

1. Check whether `Memory/` exists and matches the layout in `references/memory-layout.md`.
2. Classify the repo as `not-installed`, `partial`, or `installed`.
3. If the repo already has stronger rules than the generated templates, preserve the repo rules and only add missing MemoryTree pieces.

## Upgrade

1. Use `memorytree upgrade` for repositories that already have `AGENTS.md`, custom policy files, or partial `Memory/` content.
2. Preserve existing repo policy files by default.
3. Create only the missing MemoryTree pieces.
4. Read the upgrade result and treat `agents_merge_required=true` as a manual review task, not an overwrite instruction.

## Initialize

1. Run `memorytree init --root <repo>` and pass `--project-name`, `--goal-summary`, and `--locale` when the user already provided them.
2. Use fresh init only when the repo does not already have `AGENTS.md` or another repo policy source such as a policy-bearing `CONTRIBUTING.md`, PR templates, `CODEOWNERS`, or commitlint config. If repo policy already exists, switch to `memorytree upgrade` instead of trying to skip `AGENTS.md`.
3. Review the generated `AGENTS.md` before keeping it. Merge it with the repo's existing policy if needed.
4. Keep the initial installation minimal: `Memory/01_goals`, `02_todos`, `03_chat_logs`, optional `04_knowledge`, `05_archive`, and `06_transcripts` only when transcript archival is enabled for the repo or needed for transcript import.
5. Use the locale-specific template files in `assets/templates/<locale>/` as the source of truth for first-run scaffolding.
6. Prefer `--locale auto` when the user did not request a language explicitly.
7. Use `memorytree locale` when you need a deterministic locale check without scaffolding files.
8. If Node.js is not available, create first-run files directly from `assets/templates/` instead of requiring a runtime installation.
9. If transcript archival is enabled for the repo, use `memorytree import --source <file>` for one explicit source file and `memorytree discover` when scanning local client stores. Matching transcripts must update both the repo mirror and the global archive, while unrelated projects, ambiguous ownership cases, or mismatched explicit sources are archived in the global archive only. Let the CLI generate cleaned transcripts deterministically without spending model tokens on the cleaning step.
10. Ask once whether raw transcript files may also be committed to the repository. Record the answer in `AGENTS.md`, keep the files in the repo either way, and exclude `raw` files from automatic staging until the user says yes.

## Maintain

1. Change the active goal only after explicit user confirmation of a scope or requirement change.
2. Update the active todo when progress changes, milestones move, or the next task becomes clearer.
3. Append chat logs only. Never rewrite or delete prior entries.
4. Keep active files small. Move stale context to archive or knowledge files instead of bloating the active goal or todo.
5. Treat product ideas, architecture decisions, and operating constraints as goal or knowledge content. Treat step-by-step execution state as todo content.
6. Treat cleaned transcript indexes as discovery aids, not as the final source of truth. When exact wording matters, confirm against the raw transcript archive.
7. Prefer deterministic CLI-based transcript cleaning over manual rewriting. Do not spend model tokens to restate or normalize transcript content when `memorytree import` can do it.
8. Reply in the user's language when clear; otherwise align with repo locale without rewriting existing files just to translate them.

## Git And Safety

1. Never assume MemoryTree can override the repo's branch model.
2. Default to isolated MemoryTree-only Git operations: stage only MemoryTree-owned files, use a MemoryTree-scoped commit title, push to a dedicated branch, and open a dedicated PR.
3. Enable auto-merge only for MemoryTree-only PRs, and only when the repository still enforces its required review and CI checks.
4. Keep repo-local raw transcript mirrors and the global transcript archive synchronized on every import. The global index must remain safe for concurrent multi-project updates.
5. Keep the repository mirror limited to transcripts that belong to the current repository. Unrelated or ambiguous transcripts belong in the global archive only.
6. Keep raw transcript files under `Memory/06_transcripts/raw/**` in the repo, but exclude them from automatic staging until the user explicitly approved raw transcript uploads for that repository.
7. If the diff mixes product code, shared policy files, cross-project transcript archives, or unclear ownership, stop and ask the user before committing or pushing.
8. If the repo has protected branches or PR-only rules, follow them even if older MemoryTree rules say otherwise.
9. When `auto_push` is enabled, the heartbeat process pushes automatically after committing. If no Git remote is configured, the push is skipped. If a push fails, the heartbeat retries once. In either case an alert is written to `~/.memorytree/alerts.json`. See `references/git-policy.md`.
10. During transcript cleaning, the heartbeat scans for sensitive information (API keys, passwords, tokens). Matches are logged as warnings only — no automatic deletion or redaction. See `references/heartbeat-scheduling.md`.

11. Do not modify the host repository's CI or E2E workflow definitions by default. If the user explicitly approves a MemoryTree-only optimization, prefer path-filtered or lightweight workflows for `Memory/**` and managed `AGENTS.md` PRs without weakening required branch protection.

## Resources

- `references/project-detection.md`: detect install state and choose init vs maintain.
- `references/memory-layout.md`: folder and file naming rules.
- `references/update-rules.md`: when to version goals, todos, and session logs.
- `references/git-policy.md`: safe Git defaults and policy merge guidance.
- `references/locale-selection.md`: locale choice rules and alias behavior.
- `references/response-language.md`: reply-language precedence and translation safety.
- `references/transcript-archive.md`: raw transcript archival, clean transcript indexing, per-client source rules, and repo upload confirmation rules.
- `references/upgrade-path.md`: safe adoption flow for partial repos.
- `references/execution-environment.md`: how to run MemoryTree CLI (requires Node.js ≥ 20).
- `references/heartbeat-scheduling.md`: background heartbeat architecture, daemon CLI, and execution flow.
- `references/global-configuration.md`: `~/.memorytree/` directory layout, `config.toml` schema, and `alerts.json` format.
- `assets/templates/en/` and `assets/templates/zh-cn/`: seed files for English and Simplified Chinese initialization.
- CLI commands: `memorytree init`, `memorytree upgrade`, `memorytree import`, `memorytree discover`, `memorytree locale`, `memorytree recall`, `memorytree doctor`, `memorytree daemon install|uninstall|run-once|watch|status|quick-start|register`.
