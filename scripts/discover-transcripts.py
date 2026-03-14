#!/usr/bin/env python3
"""
Discover local Codex, Claude Code, and Gemini transcript sources and import them
into MemoryTree using deterministic code-based cleaning.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from _transcript_utils import (
    CLIENTS,
    default_global_transcript_root,
    discover_source_files,
    import_transcript,
    infer_project_slug,
    parse_transcript,
    slugify,
    transcript_has_content,
    transcript_matches_repo,
)


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"root does not exist: {root}")

    repo_slug = slugify(args.project_name.strip() or root.name, fallback="project")
    global_root = resolve_global_root(args.global_root)
    requested_clients = CLIENTS if args.client == "all" else {args.client}
    discovered = discover_source_files(requested_clients)

    results: list[dict[str, object]] = []
    skipped: list[dict[str, str]] = []

    for client, source in discovered:
        if args.limit and len(results) >= args.limit:
            break
        try:
            parsed = parse_transcript(client, source)
        except Exception as exc:
            skipped.append(
                {
                    "client": client,
                    "source": source.as_posix(),
                    "reason": "parse-error",
                    "error": summarize_exception(exc),
                }
            )
            continue

        candidate_project = infer_project_slug(parsed)
        matches_current_repo = transcript_matches_repo(parsed, root, repo_slug)
        if not transcript_has_content(parsed):
            skipped.append(
                {
                    "client": client,
                    "source": source.as_posix(),
                    "reason": "no-importable-content",
                    "project": candidate_project,
                }
            )
            continue

        if args.scope == "current-project" and not matches_current_repo:
            skipped.append(
                {
                    "client": client,
                    "source": source.as_posix(),
                    "reason": "unrelated-project",
                    "project": candidate_project,
                }
            )
            continue

        try:
            result = import_transcript(
                parsed=parsed,
                root=root,
                global_root=global_root,
                project_slug=repo_slug if matches_current_repo else candidate_project,
                raw_upload_permission=args.raw_upload_permission if matches_current_repo else "not-applicable",
                mirror_to_repo=matches_current_repo,
            )
        except Exception as exc:
            skipped.append(
                {
                    "client": client,
                    "source": source.as_posix(),
                    "reason": "import-error",
                    "project": candidate_project,
                    "error": summarize_exception(exc),
                }
            )
            continue
        result["matches_current_repo"] = matches_current_repo
        results.append(result)

    payload = {
        "repo": root.as_posix(),
        "repo_project": repo_slug,
        "scope": args.scope,
        "client_filter": args.client,
        "discovered_count": len(discovered),
        "imported_count": len(results),
        "repo_mirror_count": sum(1 for item in results if item["matches_current_repo"]),
        "global_only_count": sum(1 for item in results if not item["matches_current_repo"]),
        "skipped_count": len(skipped),
        "imports": results,
        "skipped": skipped,
    }

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print(format_result_text(payload))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discover and import local AI transcripts into MemoryTree.")
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument(
        "--client",
        choices=("all", *sorted(CLIENTS)),
        default="all",
        help="Transcript client family to scan.",
    )
    parser.add_argument(
        "--scope",
        choices=("current-project", "all-projects"),
        default="all-projects",
        help="Import only transcripts related to the current repo, or also backfill other projects into the global archive.",
    )
    parser.add_argument(
        "--project-name",
        default="",
        help="Project label for the current repository. Defaults to the repo folder name.",
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
    parser.add_argument("--limit", type=int, default=0, help="Optional limit on discovered source files.")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    return parser.parse_args()


def resolve_global_root(path_value: str) -> Path:
    if path_value:
        return Path(path_value).expanduser().resolve()
    return default_global_transcript_root()


def format_result_text(payload: dict[str, object]) -> str:
    lines = [
        f"repo: {payload['repo']}",
        f"repo_project: {payload['repo_project']}",
        f"scope: {payload['scope']}",
        f"client_filter: {payload['client_filter']}",
        f"discovered_count: {payload['discovered_count']}",
        f"imported_count: {payload['imported_count']}",
        f"repo_mirror_count: {payload['repo_mirror_count']}",
        f"global_only_count: {payload['global_only_count']}",
        f"skipped_count: {payload['skipped_count']}",
    ]

    imports = payload["imports"]
    if isinstance(imports, list) and imports:
        lines.append("imports:")
        for item in imports[:10]:
            if isinstance(item, dict):
                lines.append(
                    f"- {item.get('client')} {item.get('project')} {item.get('session_id')} repo_mirror={str(item.get('matches_current_repo')).lower()}"
                )
        if len(imports) > 10:
            lines.append(f"- ... {len(imports) - 10} more")
    return "\n".join(lines)


def summarize_exception(exc: Exception) -> str:
    return str(exc).strip() or exc.__class__.__name__


if __name__ == "__main__":
    raise SystemExit(main())
