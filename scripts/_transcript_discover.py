"""Transcript discovery — file scanning and project matching."""

from __future__ import annotations

import re
from pathlib import Path

from _transcript_common import CLIENTS, slugify
from _transcript_parse import ParsedTranscript


def default_global_transcript_root() -> Path:
    return Path.home() / ".memorytree" / "transcripts"


def default_client_roots() -> dict[str, Path]:
    home = Path.home()
    return {
        "codex": home / ".codex",
        "claude": home / ".claude",
        "gemini": home / ".gemini",
    }


def discover_source_files(clients: set[str] | None = None) -> list[tuple[str, Path]]:
    requested = clients or CLIENTS
    roots = default_client_roots()
    patterns = {
        "codex": ["sessions/**/*.jsonl"],
        "claude": ["projects/**/*.jsonl"],
        "gemini": [
            "tmp/*/checkpoints/**/*.json",
            "tmp/*/checkpoints/**/*.jsonl",
            "history/**/*.json",
            "history/**/*.jsonl",
            "chats/**/*.json",
            "chats/**/*.jsonl",
        ],
    }
    matches: list[tuple[str, Path]] = []
    seen: set[str] = set()
    for client in sorted(requested):
        root = roots.get(client)
        if root is None or not root.exists():
            continue
        for pattern in patterns[client]:
            for path in root.glob(pattern):
                if not path.is_file():
                    continue
                key = path.resolve().as_posix().lower()
                if key in seen:
                    continue
                seen.add(key)
                matches.append((client, path.resolve()))
    matches.sort(
        key=lambda item: (safe_file_mtime(item[1]), item[1].as_posix().lower()),
        reverse=True,
    )
    return matches


def infer_project_slug(parsed: ParsedTranscript) -> str:
    if parsed.cwd:
        try:
            cwd_path = Path(parsed.cwd)
            return slugify(cwd_path.name, fallback="project")
        except OSError:
            pass
    if parsed.client == "claude":
        parent_name = parsed.source_path.parent.name
        parent_name = re.sub(r"^[a-z]--", "", parent_name.lower())
        return slugify(parent_name, fallback="project")
    if parsed.client == "gemini" and parsed.source_path.parent.name:
        return slugify(parsed.source_path.parent.name, fallback="project")
    return "unknown-project"


def transcript_matches_repo(parsed: ParsedTranscript, repo_root: Path, repo_slug: str) -> bool:
    repo_root = repo_root.resolve()
    if parsed.cwd:
        try:
            cwd_path = Path(parsed.cwd).resolve()
            if cwd_path == repo_root:
                return True
            if repo_root in cwd_path.parents:
                return True
        except OSError:
            pass
    return project_slugs_match(infer_project_slug(parsed), repo_slug)


def project_slugs_match(left: str, right: str) -> bool:
    return bool(left and right and left == right and left != "unknown-project")


def safe_file_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0
