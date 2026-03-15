#!/usr/bin/env python3
"""
recall-session — On-demand transcript sync + latest session lookup.

Scans all three client transcript directories for the current project,
imports any new transcripts, queries the global index to find the most
recent previous session, and outputs its metadata and clean transcript
path so the model can generate a continuation summary.

Usage:
  uv run python recall-session.py --root /path/to/repo
  uv run python recall-session.py --root . --activation-time 2026-03-15T10:00:00Z
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from _transcript_utils import (
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
    activation_time = args.activation_time or _now_iso()

    # Step 1: On-demand sync — discover and import for current project only
    imported = _sync_current_project(root, repo_slug, global_root)

    # Step 2: Query global index for latest session
    session = _find_latest_session(global_root, root, repo_slug, activation_time)

    if session is None:
        payload = {
            "found": False,
            "project": repo_slug,
            "repo": root.as_posix(),
            "imported_count": imported,
            "message": "No previous session found for this project.",
        }
    else:
        clean_path = session.get("global_clean_path", "")
        clean_content = ""
        if clean_path and Path(clean_path).exists():
            try:
                clean_content = Path(clean_path).read_text(encoding="utf-8")
            except OSError:
                pass

        payload = {
            "found": True,
            "project": repo_slug,
            "repo": root.as_posix(),
            "imported_count": imported,
            "client": session.get("client", ""),
            "session_id": session.get("session_id", ""),
            "title": session.get("title", ""),
            "started_at": session.get("started_at", ""),
            "cwd": session.get("cwd", ""),
            "branch": session.get("branch", ""),
            "message_count": session.get("message_count", 0),
            "tool_event_count": session.get("tool_event_count", 0),
            "global_clean_path": clean_path,
            "clean_content": clean_content,
        }

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print(format_text(payload))
    return 0


def _sync_current_project(root: Path, repo_slug: str, global_root: Path) -> int:
    """Discover and import transcripts for the current project only."""
    discovered = discover_source_files()
    imported = 0

    for client, source in discovered:
        try:
            parsed = parse_transcript(client, source)
        except Exception:
            continue

        if not transcript_has_content(parsed):
            continue

        if not transcript_matches_repo(parsed, root, repo_slug):
            continue

        try:
            import_transcript(
                parsed=parsed,
                root=root,
                global_root=global_root,
                project_slug=repo_slug,
                raw_upload_permission="not-set",
                mirror_to_repo=True,
            )
            imported += 1
        except Exception:
            continue

    return imported


def _find_latest_session(
    global_root: Path,
    root: Path,
    repo_slug: str,
    activation_time: str,
) -> dict | None:
    """Query the SQLite index for the latest session before activation_time."""
    db_path = global_root / "index" / "search.sqlite"
    if not db_path.exists():
        # Fallback: try sessions.jsonl
        return _find_latest_from_jsonl(global_root, root, repo_slug, activation_time)

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            """
            SELECT * FROM transcripts
            WHERE started_at < ?
            ORDER BY started_at DESC
            LIMIT 20
            """,
            (activation_time,),
        )
        rows = cursor.fetchall()
        conn.close()
    except (sqlite3.Error, OSError):
        return _find_latest_from_jsonl(global_root, root, repo_slug, activation_time)

    resolved_root = root.resolve().as_posix()
    for row in rows:
        row_dict = dict(row)
        cwd = row_dict.get("cwd", "")
        project = row_dict.get("project", "")
        # Match by cwd path or project slug
        if _cwd_matches(cwd, resolved_root) or project == repo_slug:
            return row_dict

    return None


def _find_latest_from_jsonl(
    global_root: Path,
    root: Path,
    repo_slug: str,
    activation_time: str,
) -> dict | None:
    """Fallback: scan sessions.jsonl when SQLite index doesn't exist."""
    jsonl_path = global_root / "index" / "sessions.jsonl"
    if not jsonl_path.exists():
        return None

    resolved_root = root.resolve().as_posix()
    candidates: list[dict] = []

    try:
        with jsonl_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                started = entry.get("started_at", "")
                if started >= activation_time:
                    continue

                cwd = entry.get("cwd", "")
                project = entry.get("project", "")
                if _cwd_matches(cwd, resolved_root) or project == repo_slug:
                    candidates.append(entry)
    except OSError:
        return None

    if not candidates:
        return None

    # Sort by started_at descending, return latest
    candidates.sort(key=lambda e: e.get("started_at", ""), reverse=True)
    return candidates[0]


def _cwd_matches(cwd: str, resolved_root: str) -> bool:
    """Check if a transcript's cwd matches the repo root."""
    if not cwd:
        return False
    try:
        cwd_resolved = Path(cwd).resolve().as_posix()
        return cwd_resolved == resolved_root or resolved_root in cwd_resolved
    except OSError:
        return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="On-demand transcript sync and latest session recall for MemoryTree.",
    )
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument(
        "--project-name",
        default="",
        help="Project label. Defaults to the repo folder name.",
    )
    parser.add_argument(
        "--global-root",
        default="",
        help="Override the global transcript root. Defaults to ~/.memorytree/transcripts.",
    )
    parser.add_argument(
        "--activation-time",
        default="",
        help="ISO timestamp of session activation. Transcripts started at or after this time are excluded.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format.",
    )
    return parser.parse_args()


def resolve_global_root(path_value: str) -> Path:
    if path_value:
        return Path(path_value).expanduser().resolve()
    return default_global_transcript_root()


def format_text(payload: dict) -> str:
    if not payload.get("found"):
        return (
            f"project: {payload.get('project', '?')}\n"
            f"imported: {payload.get('imported_count', 0)}\n"
            f"result: {payload.get('message', 'No previous session found.')}"
        )

    lines = [
        f"project: {payload.get('project', '')}",
        f"client: {payload.get('client', '')}",
        f"session_id: {payload.get('session_id', '')}",
        f"title: {payload.get('title', '')}",
        f"started_at: {payload.get('started_at', '')}",
        f"cwd: {payload.get('cwd', '')}",
        f"branch: {payload.get('branch', '')}",
        f"messages: {payload.get('message_count', 0)}",
        f"tool_events: {payload.get('tool_event_count', 0)}",
        f"imported_this_sync: {payload.get('imported_count', 0)}",
        f"clean_transcript: {payload.get('global_clean_path', '')}",
    ]

    content = payload.get("clean_content", "")
    if content:
        lines.append("")
        lines.append("--- clean transcript content ---")
        lines.append(content)

    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
