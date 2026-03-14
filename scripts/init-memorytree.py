#!/usr/bin/env python3
"""
Initialize a minimal MemoryTree workspace inside an arbitrary repository.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from _scaffold_utils import (
    build_datetime,
    create_memory_dirs,
    find_external_policy_sources,
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
    if args.skip_agents:
        raise SystemExit(
            "--skip-agents is not supported for fresh initialization. "
            "Use upgrade-memorytree.py when preserving or merging an existing AGENTS.md."
        )

    agents_path = root / "AGENTS.md"
    if agents_path.exists():
        raise SystemExit(
            "AGENTS.md already exists. Use upgrade-memorytree.py to preserve or merge existing repo policy."
        )

    policy_sources = find_external_policy_sources(root)
    if policy_sources:
        preview = ", ".join(policy_sources[:3])
        if len(policy_sources) > 3:
            preview += ", ..."
        raise SystemExit(
            f"External repo policy files detected ({preview}). "
            "Use upgrade-memorytree.py to preserve host commit and PR rules."
        )

    skill_root = Path(__file__).resolve().parents[1]
    templates = resolve_template_dir(skill_root, root, args.locale)
    dt = build_datetime(args.date, args.time)

    create_memory_dirs(root)
    paths = resolve_scaffold_paths(root, dt)
    scaffold_content_files(paths, templates, args.goal_summary, args.project_name, args.force)
    write_template(templates / "agents.md", agents_path, args.force, {})

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Initialize a MemoryTree workspace.")
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument(
        "--project-name",
        default="this project",
        help="Project name used in the initial chat log.",
    )
    parser.add_argument(
        "--goal-summary",
        default="Describe the long-term project goal here.",
        help="Initial north-star summary for the first goal file.",
    )
    parser.add_argument(
        "--locale",
        default="auto",
        help="Template locale: auto, en, or zh-cn.",
    )
    parser.add_argument("--date", default="", help="Override date as YYYY-MM-DD for deterministic runs.")
    parser.add_argument(
        "--time",
        default="",
        help="Override time as HH:MM. If --date is omitted, use the current local date.",
    )
    parser.add_argument(
        "--skip-agents",
        action="store_true",
        help="Deprecated. Use upgrade-memorytree.py when preserving an existing AGENTS.md.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite generated files if they already exist.")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
