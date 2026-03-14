#!/usr/bin/env python3
"""
Upgrade a repository to MemoryTree without overwriting existing repo policy files.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from _locale_utils import normalize_locale
from _scaffold_utils import (
    build_datetime,
    create_memory_dirs,
    find_external_policy_sources,
    find_latest_chat_log_file,
    find_latest_goal_file,
    find_latest_todo_file,
    resolve_scaffold_paths,
    resolve_template_dir,
    scaffold_content_files,
    write_template,
)


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"root does not exist: {root}")

    skill_root = Path(__file__).resolve().parents[1]
    templates = resolve_template_dir(skill_root, root, args.locale)
    effective_locale = normalize_locale(args.locale, root)
    initial_state = detect_state(root)

    dt = build_datetime(args.date, args.time)

    created_dirs = create_memory_dirs(root)
    paths = resolve_scaffold_paths(root, dt)
    created_files, preserved_files = scaffold_content_files(
        paths, templates, args.goal_summary, args.project_name, force=False,
    )

    agents_path = root / "AGENTS.md"
    agents_action = "preserved_existing"
    if not agents_path.exists():
        if write_template(templates / "agents.md", agents_path, False, {}):
            created_files.append("AGENTS.md")
            agents_action = "created"
    else:
        preserved_files.append("AGENTS.md")
    merge_required = agents_action == "preserved_existing" and needs_agents_merge(agents_path)

    result = {
        "state_before": initial_state,
        "state_after": detect_state(root),
        "requested_locale": args.locale,
        "effective_locale": effective_locale,
        "created_dirs": created_dirs,
        "created_files": created_files,
        "preserved_files": preserved_files,
        "agents_action": agents_action,
        "agents_merge_required": merge_required,
    }

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(format_result_text(result))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upgrade a repository to MemoryTree safely.")
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument("--project-name", default="this project", help="Project name used in generated chat logs.")
    parser.add_argument(
        "--goal-summary",
        default="Describe the long-term project goal here.",
        help="Fallback north-star summary when a goal file must be created.",
    )
    parser.add_argument("--locale", default="auto", help="Requested locale: auto, en, or zh-cn.")
    parser.add_argument("--date", default="", help="Override date as YYYY-MM-DD for deterministic runs.")
    parser.add_argument(
        "--time",
        default="",
        help="Override time as HH:MM. If --date is omitted, use the current local date.",
    )
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    return parser.parse_args()


def detect_state(root: Path) -> str:
    memory_dir = root / "Memory"
    goal_dir = root / "Memory" / "01_goals"
    todo_dir = root / "Memory" / "02_todos"
    chat_dir = root / "Memory" / "03_chat_logs"
    agents_path = root / "AGENTS.md"
    policy_sources = find_external_policy_sources(root)

    latest_goal = find_latest_goal_file(goal_dir)
    goal_version = extract_goal_version(latest_goal)
    has_goal = latest_goal is not None
    has_todo = goal_version is not None and find_latest_todo_file(todo_dir, goal_version) is not None
    has_chat = find_latest_chat_log_file(chat_dir) is not None
    has_agents = agents_path.is_file()
    agents_ready = has_agents and not needs_agents_merge(agents_path)

    if not memory_dir.exists():
        return "partial" if has_agents or policy_sources else "not-installed"
    if has_goal and has_todo and has_chat and agents_ready:
        return "installed"
    return "partial"


def extract_goal_version(path: Path | None) -> str | None:
    if path is None:
        return None
    match = re.fullmatch(r"goal_v(\d{3})_\d{8}\.md", path.name)
    if match is None:
        return None
    return match.group(1)


def needs_agents_merge(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return True

    required_checks = [
        has_read_order_signal(text),
        has_memory_layout_signal(text),
        has_active_todo_rule(text),
        has_append_only_chat_log_rule(text),
        has_repo_safety_rule(text),
        has_commit_title_rule(text),
        has_dedicated_memorytree_pr_flow(text),
        has_memorytree_only_scope_rule(text),
        has_auto_merge_rule(text),
    ]
    return not all(required_checks)


def matches_any(text: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, text) for pattern in patterns)


def matches_all_concepts(text: str, concept_groups: tuple[tuple[str, ...], ...]) -> bool:
    return all(matches_any(text, patterns) for patterns in concept_groups)


def has_read_order_signal(text: str) -> bool:
    return matches_any(
        text,
        (
            r"\bread order\b",
            r"\bread .* in order\b",
            r"\u8bfb\u53d6\u987a\u5e8f",
            r"\u6309\u6b64\u987a\u5e8f\u8bfb\u53d6",
        ),
    )


def has_memory_layout_signal(text: str) -> bool:
    required_paths = (
        (r"memory/01_goals", r"\b01_goals\b"),
        (r"memory/02_todos", r"\b02_todos\b"),
        (r"memory/03_chat_logs", r"\b03_chat_logs\b"),
    )
    return matches_all_concepts(text, required_paths)


def has_active_todo_rule(text: str) -> bool:
    return matches_any(
        text,
        (
            r"keep .*todo .*synchron",
            r"todo .*aligned .*active goal",
            r"(sync|align|keep|maintain|bind).{0,50}(active|current).{0,20}todo.{0,50}(active|current).{0,20}goal",
            r"(active|current).{0,20}todo.{0,50}(sync|align|match|bound).{0,50}(active|current).{0,20}goal",
            r"\u5f53\u524d\u5f85\u529e\u5fc5\u987b\u4e0e\u5f53\u524d\u76ee\u6807\u4fdd\u6301\u540c\u6b65",
            r"\u5f85\u529e\u5fc5\u987b\u4e0e\u5f53\u524d\u76ee\u6807\u4fdd\u6301\u540c\u6b65",
        ),
    )


def has_append_only_chat_log_rule(text: str) -> bool:
    return matches_any(
        text,
        (
            r"append[- ]only .*chat log",
            r"append[- ]only records",
            r"treat chat logs as append[- ]only",
            r"never rewrite or delete prior entries",
            r"\u5bf9\u8bdd\u65e5\u5fd7\u53ea\u8ffd\u52a0",
            r"\u7981\u6b62\u91cd\u5199\u6216\u5220\u9664\u65e2\u6709\u5185\u5bb9",
        ),
    )


def has_repo_safety_rule(text: str) -> bool:
    concept_groups = (
        (r"\bpr\b", r"\bpull request\b", r"\bmerge request\b", r"\u62c9\u53d6\u8bf7\u6c42", r"\u5408\u5e76\u8bf7\u6c42"),
        (r"\bci\b", r"\bchecks?\b", r"\bpipeline\b", r"\be2e\b", r"\u68c0\u67e5", r"\u6d41\u6c34\u7ebf"),
        (r"\breview(?:er|ers)?\b", r"\bapproval(?:s)?\b", r"\u8bc4\u5ba1", r"\u5ba1\u6279"),
        (r"\bbranch(?:es)?\b", r"\bprotected branch(?:es)?\b", r"\u5206\u652f"),
    )
    return matches_all_concepts(text, concept_groups) and matches_any(
        text,
        (
            r"\brepository\b",
            r"\brepo\b",
            r"\bproject\b",
            r"\bhost\b",
            r"\brule(?:s)?\b",
            r"\brequirement(?:s)?\b",
            r"\bpolicy\b",
            r"\bcontrol(?:s)?\b",
            r"\u4ed3\u5e93",
            r"\u89c4\u5219",
            r"\u8981\u6c42",
        ),
    )


def has_commit_title_rule(text: str) -> bool:
    return matches_any(
        text,
        (
            r"\bmemorytree\([^)]*\):",
            r"\b[a-z]+\((memorytree)\):",
            r"\bmemorytree:",
            r"memorytree-scoped commit title",
            r"memorytree-specific commit title",
            r"use .*memorytree.*commit title",
            r"\u63d0\u4ea4\u6807\u9898.*memorytree",
        ),
    )


def has_dedicated_memorytree_pr_flow(text: str) -> bool:
    concept_groups = (
        (r"\bmemorytree\b", r"\u8bb0\u5fc6"),
        (r"\bbranch(?:es)?\b", r"\u5206\u652f"),
        (r"\bpr\b", r"\bpull request\b", r"\bmerge request\b", r"\u62c9\u53d6\u8bf7\u6c42", r"\u5408\u5e76\u8bf7\u6c42"),
        (r"\bdedicated\b", r"\bseparate\b", r"\bisolated\b", r"\bown\b", r"\u4e13\u7528", r"\u72ec\u7acb"),
    )
    return matches_all_concepts(text, concept_groups)


def has_memorytree_only_scope_rule(text: str) -> bool:
    return matches_any(
        text,
        (
            r"memorytree[- ]owned changes",
            r"memorytree[- ]owned files",
            r"memorytree-managed files",
            r"(stage|push|commit).{0,40}only.{0,40}memorytree[- ]owned.{0,20}(files|changes)?",
            r"(stage|push|commit).{0,40}only.{0,40}memorytree.{0,20}(files|changes|diff)",
            r"only.{0,40}memorytree.{0,20}(files|changes|diff)",
            r"\u4ec5\u81ea\u52a8\u63d0\u4ea4\u548c\u63a8\u9001.*memorytree.*\u53d8\u66f4",
            r"\u7531 memorytree \u7ba1\u7406",
        ),
    )


def has_auto_merge_rule(text: str) -> bool:
    return matches_any(
        text,
        (
            r"auto-merge only when .*permit",
            r"only when repository rules permit",
            r"only when repo rules permit",
            r"only enable auto-merge when.{0,60}(required )?(approvals|checks|reviews?)",
            r"auto-merge.{0,60}(required approvals|required checks|repository rules)",
            r"\u4ec5\u5728\u4ed3\u5e93\u89c4\u5219\u5141\u8bb8\u65f6\u624d\u5f00\u542f\u81ea\u52a8\u5408\u5e76",
        ),
    )


def format_result_text(result: dict) -> str:
    lines = [
        f"state_before: {result['state_before']}",
        f"state_after: {result['state_after']}",
        f"effective_locale: {result['effective_locale']}",
        f"agents_action: {result['agents_action']}",
        f"agents_merge_required: {str(result['agents_merge_required']).lower()}",
    ]
    if result["created_dirs"]:
        lines.append("created_dirs:")
        lines.extend(f"- {item}" for item in result["created_dirs"])
    if result["created_files"]:
        lines.append("created_files:")
        lines.extend(f"- {item}" for item in result["created_files"])
    if result["preserved_files"]:
        lines.append("preserved_files:")
        lines.extend(f"- {item}" for item in result["preserved_files"])
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
