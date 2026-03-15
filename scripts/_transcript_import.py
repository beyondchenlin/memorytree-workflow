"""Transcript import — orchestration, cleaning, and manifest management."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _transcript_common import (
    load_json,
    normalize_timestamp,
    sha256_file,
    slugify,
    timestamp_partition,
    yaml_escape,
)
from _transcript_index import upsert_search_index
from _transcript_parse import ParsedTranscript


def import_transcript(
    parsed: ParsedTranscript,
    root: Path,
    global_root: Path,
    project_slug: str,
    raw_upload_permission: str,
    mirror_to_repo: bool = True,
) -> dict[str, Any]:
    imported_at = normalize_timestamp(datetime.now(timezone.utc))
    raw_sha256 = sha256_file(parsed.source_path)
    session_label = slugify(parsed.session_id, fallback=slugify(parsed.source_path.stem, fallback="session"))
    artifact_stem = f"{session_label}__{raw_sha256[:8]}"
    source_suffix = parsed.source_path.suffix or ".txt"

    year_token, month_token = timestamp_partition(parsed.started_at or imported_at)

    repo_root = root / "Memory" / "06_transcripts"
    repo_raw_path = repo_root / "raw" / parsed.client / year_token / month_token / f"{artifact_stem}{source_suffix}"
    repo_clean_path = repo_root / "clean" / parsed.client / year_token / month_token / f"{artifact_stem}.md"
    repo_manifest_path = repo_root / "manifests" / parsed.client / year_token / month_token / f"{artifact_stem}.json"

    global_raw_path = global_root / "raw" / parsed.client / project_slug / year_token / month_token / f"{artifact_stem}{source_suffix}"
    global_clean_path = global_root / "clean" / parsed.client / project_slug / year_token / month_token / f"{artifact_stem}.md"
    global_manifest_path = global_root / "index" / "manifests" / parsed.client / project_slug / year_token / month_token / f"{artifact_stem}.json"
    global_event_log_path = global_root / "index" / "sessions.jsonl"
    global_db_path = global_root / "index" / "search.sqlite"

    for path in (
        global_raw_path,
        global_clean_path,
        global_manifest_path,
        global_event_log_path,
        global_db_path,
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
    if mirror_to_repo:
        for path in (repo_raw_path, repo_clean_path, repo_manifest_path):
            path.parent.mkdir(parents=True, exist_ok=True)

    if mirror_to_repo:
        copy_file(parsed.source_path, repo_raw_path)
    copy_file(parsed.source_path, global_raw_path)

    manifest = {
        "client": parsed.client,
        "project": project_slug,
        "session_id": parsed.session_id,
        "title": parsed.title,
        "started_at": parsed.started_at,
        "imported_at": imported_at,
        "cwd": parsed.cwd,
        "branch": parsed.branch,
        "raw_source_path": parsed.source_path.as_posix(),
        "raw_sha256": raw_sha256,
        "raw_upload_permission": raw_upload_permission,
        "repo_raw_path": repo_raw_path.relative_to(root).as_posix() if mirror_to_repo else "",
        "repo_clean_path": repo_clean_path.relative_to(root).as_posix() if mirror_to_repo else "",
        "repo_manifest_path": repo_manifest_path.relative_to(root).as_posix() if mirror_to_repo else "",
        "global_raw_path": global_raw_path.as_posix(),
        "global_clean_path": global_clean_path.as_posix(),
        "global_manifest_path": global_manifest_path.as_posix(),
        "message_count": len(parsed.messages),
        "tool_event_count": len(parsed.tool_events),
        "cleaning_mode": "deterministic-code",
        "repo_mirror_enabled": mirror_to_repo,
    }
    existing_global_manifest = load_json(global_manifest_path)
    manifest = preserve_existing_import_timestamp(existing_global_manifest, manifest)

    if mirror_to_repo:
        write_clean_markdown(parsed, manifest, repo_clean_path)
    write_clean_markdown(parsed, manifest, global_clean_path)
    if mirror_to_repo:
        write_json(repo_manifest_path, manifest)
    append_to_event_log = existing_global_manifest is None or existing_global_manifest != manifest
    write_json(global_manifest_path, manifest)
    if append_to_event_log:
        append_jsonl(global_event_log_path, manifest)
    upsert_search_index(global_db_path, manifest)

    result = dict(manifest)
    result["global_index_db"] = global_db_path.as_posix()
    return result


def transcript_has_content(parsed: ParsedTranscript) -> bool:
    return bool(parsed.messages or parsed.tool_events)


def write_clean_markdown(parsed: ParsedTranscript, manifest: dict[str, Any], path: Path) -> None:
    lines = [
        "---",
        f"client: {manifest['client']}",
        f"project: {manifest['project']}",
        f"session_id: {manifest['session_id']}",
        f"title: {yaml_escape(manifest['title'])}",
        f"started_at: {manifest['started_at']}",
        f"imported_at: {manifest['imported_at']}",
        f"cwd: {yaml_escape(manifest['cwd'])}",
        f"branch: {yaml_escape(manifest['branch'])}",
        f"raw_source_path: {yaml_escape(manifest['raw_source_path'])}",
        f"raw_sha256: {manifest['raw_sha256']}",
        f"raw_upload_permission: {manifest['raw_upload_permission']}",
        f"cleaning_mode: {manifest['cleaning_mode']}",
        "---",
        "",
        f"# {manifest['title'] or manifest['session_id']}",
        "",
        "## Metadata",
        f"- Client: `{manifest['client']}`",
        f"- Project: `{manifest['project']}`",
        f"- Session ID: `{manifest['session_id']}`",
        f"- Started At: `{manifest['started_at']}`",
        f"- Imported At: `{manifest['imported_at']}`",
        f"- Raw SHA256: `{manifest['raw_sha256']}`",
        f"- Raw Source: `{manifest['raw_source_path']}`",
        f"- Repo Raw Path: `{manifest['repo_raw_path']}`",
        f"- Repo Clean Path: `{manifest['repo_clean_path']}`",
        "",
        "## Messages",
    ]

    if parsed.messages:
        for index, message in enumerate(parsed.messages, start=1):
            lines.extend(
                [
                    f"### {index}. {message.role}",
                    f"- Timestamp: `{message.timestamp or manifest['started_at']}`",
                    "",
                    message.text,
                    "",
                ]
            )
    else:
        lines.extend(
            [
                "No user or assistant messages were extracted deterministically from the source transcript.",
                "",
            ]
        )

    lines.append("## Tool Events")
    if parsed.tool_events:
        for event in parsed.tool_events:
            lines.append(f"- `{event.timestamp or manifest['started_at']}` {event.summary}")
    else:
        lines.append("- No tool events were extracted.")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def preserve_existing_import_timestamp(existing: dict[str, Any] | None, payload: dict[str, Any]) -> dict[str, Any]:
    if existing is None:
        return payload
    if manifest_signature(existing) != manifest_signature(payload):
        return payload
    preserved = dict(payload)
    imported_at = existing.get("imported_at")
    if isinstance(imported_at, str) and imported_at:
        preserved["imported_at"] = imported_at
    return preserved


def manifest_signature(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key != "imported_at"}


def manifest_changed(path: Path, payload: dict[str, Any]) -> bool:
    if not path.exists():
        return True
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    return current != payload


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def copy_file(source: Path, destination: Path) -> None:
    if source.resolve() == destination.resolve():
        return
    shutil.copy2(source, destination)
