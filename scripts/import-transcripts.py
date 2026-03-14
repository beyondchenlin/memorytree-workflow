#!/usr/bin/env python3
"""
Import one local AI transcript into MemoryTree using deterministic code-based
cleaning. Current-project sources mirror into both the repo and the user-level
global archive; unrelated sources archive globally only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from _transcript_utils import (
    CLIENTS,
    default_global_transcript_root,
    infer_client,
    infer_project_slug,
    import_transcript,
    parse_transcript,
    slugify,
    transcript_has_content,
    transcript_matches_repo,
)


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    source = Path(args.source).resolve()
    if not root.exists():
        raise SystemExit(f"root does not exist: {root}")
    if not source.exists():
        raise SystemExit(f"source transcript does not exist: {source}")

    client = infer_client(args.client, source)
    global_root = resolve_global_root(args.global_root)
    repo_slug = slugify(args.project_name.strip() or root.name, fallback="project")

    parsed = parse_transcript(client, source)
    if not transcript_has_content(parsed):
        raise SystemExit(f"source transcript does not contain any importable messages or tool events: {source}")
    detected_project = infer_project_slug(parsed)
    matches_current_repo = transcript_matches_repo(parsed, root, repo_slug)
    result = import_transcript(
        parsed=parsed,
        root=root,
        global_root=global_root,
        project_slug=repo_slug if matches_current_repo else detected_project,
        raw_upload_permission=args.raw_upload_permission if matches_current_repo else "not-applicable",
        mirror_to_repo=matches_current_repo,
    )
    result["matches_current_repo"] = matches_current_repo
    result["detected_project"] = detected_project

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(format_result_text(result))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import one local transcript into MemoryTree archives.")
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument("--source", required=True, help="Raw transcript source file path.")
    parser.add_argument(
        "--client",
        choices=("auto", *sorted(CLIENTS)),
        default="auto",
        help="Transcript client family.",
    )
    parser.add_argument(
        "--project-name",
        default="",
        help="Project label used for the global transcript archive. Defaults to the repo folder name.",
    )
    parser.add_argument(
        "--global-root",
        default="",
        help="Override the user-level global transcript root. Defaults to ~/.memorytree/transcripts.",
    )
    parser.add_argument(
        "--raw-upload-permission",
        choices=("not-set", "approved", "denied"),
        default="not-set",
        help="Current repository permission for committing raw transcript files.",
    )
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    return parser.parse_args()


def resolve_global_root(path_value: str) -> Path:
    if path_value:
        return Path(path_value).expanduser().resolve()
    return default_global_transcript_root()


def format_result_text(result: dict[str, object]) -> str:
    lines = [
        f"client: {result['client']}",
        f"project: {result['project']}",
        f"session_id: {result['session_id']}",
        f"started_at: {result['started_at']}",
        f"detected_project: {result['detected_project']}",
        f"matches_current_repo: {str(result['matches_current_repo']).lower()}",
        f"raw_upload_permission: {result['raw_upload_permission']}",
        f"message_count: {result['message_count']}",
        f"tool_event_count: {result['tool_event_count']}",
        f"repo_raw_path: {result['repo_raw_path']}",
        f"repo_clean_path: {result['repo_clean_path']}",
        f"repo_manifest_path: {result['repo_manifest_path']}",
        f"global_raw_path: {result['global_raw_path']}",
        f"global_clean_path: {result['global_clean_path']}",
        f"global_index_db: {result['global_index_db']}",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
