from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CLIENTS = {"codex", "claude", "gemini"}
TEXT_BLOCK_TYPES = {"input_text", "output_text", "text"}
SKIP_BLOCK_TYPES = {"thinking", "reasoning"}
TOOL_USE_TYPES = {"tool_use"}
TOOL_RESULT_TYPES = {"tool_result"}


@dataclass
class TranscriptMessage:
    role: str
    text: str
    timestamp: str | None = None


@dataclass
class TranscriptToolEvent:
    summary: str
    timestamp: str | None = None


@dataclass
class ParsedTranscript:
    client: str
    session_id: str
    title: str
    started_at: str
    cwd: str
    branch: str
    messages: list[TranscriptMessage]
    tool_events: list[TranscriptToolEvent]
    source_path: Path


def default_global_transcript_root() -> Path:
    return Path.home() / ".memorytree" / "transcripts"


def default_client_roots() -> dict[str, Path]:
    home = Path.home()
    return {
        "codex": home / ".codex",
        "claude": home / ".claude",
        "gemini": home / ".gemini",
    }


def slugify(value: str, fallback: str = "session") -> str:
    ascii_value = value.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9._-]+", "-", ascii_value).strip("-._")
    return slug or fallback


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def infer_client(client: str, source: Path) -> str:
    if client != "auto":
        return client
    normalized = source.as_posix().lower()
    if "/.codex/" in normalized or "rollout-" in source.name.lower():
        return "codex"
    if "/.claude/" in normalized or "/projects/" in normalized:
        return "claude"
    if "/.gemini/" in normalized or "checkpoint" in normalized:
        return "gemini"
    raise SystemExit(f"could not infer transcript client from source path: {source}")


def parse_transcript(client: str, source: Path) -> ParsedTranscript:
    if client == "codex":
        return parse_codex_transcript(source)
    if client == "claude":
        return parse_claude_transcript(source)
    if client == "gemini":
        return parse_gemini_transcript(source)
    raise SystemExit(f"unsupported transcript client: {client}")


def parse_codex_transcript(path: Path) -> ParsedTranscript:
    records = load_jsonl(path)
    session_id = path.stem
    title = path.stem
    started_at = normalize_timestamp(path.stat().st_mtime)
    cwd = ""
    branch = ""
    messages: list[TranscriptMessage] = []
    tool_events: list[TranscriptToolEvent] = []

    for record in records:
        record_type = str(record.get("type") or "")
        timestamp = normalize_timestamp(record.get("timestamp"), started_at)
        if record_type == "session_meta":
            payload = ensure_dict(record.get("payload"))
            session_id = str(payload.get("id") or session_id)
            title = str(payload.get("thread_name") or payload.get("title") or title)
            started_at = earliest_timestamp(started_at, payload.get("timestamp"))
            cwd = str(payload.get("cwd") or cwd)
            branch = str(get_nested(payload, "git", "branch") or branch)
            continue

        if record_type not in {"response_item", "event_msg"}:
            continue

        payload = ensure_dict(record.get("payload"))
        payload_type = str(payload.get("type") or "")
        if payload_type == "message":
            role = str(payload.get("role") or "").lower()
            if role in {"user", "assistant"}:
                text = extract_text_blocks(payload.get("content"))
                if text:
                    messages.append(TranscriptMessage(role=role, text=text, timestamp=timestamp))
            continue

        if payload_type in {"user_message", "agent_message"}:
            role = "user" if payload_type == "user_message" else "assistant"
            text = str(payload.get("message") or "").strip()
            if text:
                messages.append(TranscriptMessage(role=role, text=text, timestamp=timestamp))
            continue

        if payload_type == "function_call":
            name = str(payload.get("name") or "function_call")
            arguments = payload.get("arguments") or payload.get("input")
            tool_events.append(
                TranscriptToolEvent(
                    summary=f"{name} input={summarize_value(arguments)}",
                    timestamp=timestamp,
                )
            )
            continue

        if payload_type == "custom_tool_call":
            name = str(payload.get("name") or payload.get("call_id") or "custom_tool_call")
            tool_events.append(
                TranscriptToolEvent(
                    summary=f"{name} input={summarize_value(payload.get('input'))}",
                    timestamp=timestamp,
                )
            )
            continue

        if payload_type == "function_call_output":
            name = str(payload.get("name") or payload.get("call_id") or "function_call_output")
            output = payload.get("output") or payload.get("content")
            tool_events.append(
                TranscriptToolEvent(
                    summary=f"{name} output={summarize_value(output)}",
                    timestamp=timestamp,
                )
            )
            continue

        if payload_type == "custom_tool_call_output":
            name = str(payload.get("name") or payload.get("call_id") or "custom_tool_call_output")
            output = payload.get("output") or payload.get("content")
            tool_events.append(
                TranscriptToolEvent(
                    summary=f"{name} output={summarize_value(output)}",
                    timestamp=timestamp,
                )
            )

    return ParsedTranscript(
        client="codex",
        session_id=session_id,
        title=title,
        started_at=started_at,
        cwd=cwd,
        branch=branch,
        messages=messages,
        tool_events=tool_events,
        source_path=path,
    )


def parse_claude_transcript(path: Path) -> ParsedTranscript:
    records = load_jsonl(path)
    session_id = path.stem
    title = path.stem
    started_at = normalize_timestamp(path.stat().st_mtime)
    cwd = ""
    branch = ""
    messages: list[TranscriptMessage] = []
    tool_events: list[TranscriptToolEvent] = []

    for record in records:
        record_type = str(record.get("type") or "")
        timestamp = normalize_timestamp(record.get("timestamp"), started_at)
        session_id = str(record.get("sessionId") or session_id)
        started_at = earliest_timestamp(started_at, record.get("timestamp"))
        cwd = str(record.get("cwd") or cwd)
        branch = str(record.get("gitBranch") or branch)

        if record_type not in {"user", "assistant"}:
            continue

        message = ensure_dict(record.get("message"))
        role = str(message.get("role") or record_type).lower()
        text_parts: list[str] = []
        content = message.get("content")
        if isinstance(content, str):
            text = content.strip()
            if role in {"user", "assistant"} and text:
                messages.append(TranscriptMessage(role=role, text=text, timestamp=timestamp))
            continue

        for block in ensure_list(content):
            if isinstance(block, str):
                if block.strip():
                    text_parts.append(block.strip())
                continue
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type") or "").lower()
            if block_type in TEXT_BLOCK_TYPES:
                text = str(block.get("text") or "").strip()
                if text:
                    text_parts.append(text)
                continue
            if block_type in SKIP_BLOCK_TYPES:
                continue
            if block_type in TOOL_USE_TYPES:
                name = str(block.get("name") or "tool_use")
                tool_events.append(
                    TranscriptToolEvent(
                        summary=f"{name} input={summarize_value(block.get('input'))}",
                        timestamp=timestamp,
                    )
                )
                continue
            if block_type in TOOL_RESULT_TYPES:
                tool_use_id = str(block.get("tool_use_id") or "tool_result")
                tool_events.append(
                    TranscriptToolEvent(
                        summary=f"{tool_use_id} output={summarize_value(block.get('content'))}",
                        timestamp=timestamp,
                    )
                )

        text = join_paragraphs(text_parts)
        if role in {"user", "assistant"} and text:
            messages.append(TranscriptMessage(role=role, text=text, timestamp=timestamp))

    return ParsedTranscript(
        client="claude",
        session_id=session_id,
        title=title,
        started_at=started_at,
        cwd=cwd,
        branch=branch,
        messages=messages,
        tool_events=tool_events,
        source_path=path,
    )


def parse_gemini_transcript(path: Path) -> ParsedTranscript:
    session_id = path.stem
    title = path.stem
    started_at = normalize_timestamp(path.stat().st_mtime)
    cwd = ""
    branch = ""
    messages: list[TranscriptMessage] = []
    tool_events: list[TranscriptToolEvent] = []

    if path.suffix.lower() == ".jsonl":
        payload: Any = load_jsonl(path)
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))

    message_signatures: set[tuple[str, str, str | None]] = set()
    first_meta = find_first_mapping_with_keys(payload, {"sessionId", "chatId", "cwd", "branch", "timestamp"})
    if first_meta:
        session_id = str(first_meta.get("sessionId") or first_meta.get("chatId") or first_meta.get("id") or session_id)
        started_at = earliest_timestamp(started_at, first_meta.get("timestamp"))
        cwd = str(first_meta.get("cwd") or first_meta.get("projectRoot") or cwd)
        branch = str(first_meta.get("branch") or branch)

    def visit(node: Any) -> None:
        nonlocal session_id, started_at, cwd, branch
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return

        session_id = str(node.get("sessionId") or node.get("chatId") or node.get("id") or session_id)
        started_at = earliest_timestamp(started_at, node.get("timestamp"))
        cwd = str(node.get("cwd") or node.get("projectRoot") or cwd)
        branch = str(node.get("branch") or branch)

        role = str(node.get("role") or node.get("author") or node.get("sender") or "").lower()
        timestamp = normalize_timestamp(node.get("timestamp"), started_at)
        if role in {"user", "assistant", "model"}:
            normalized_role = "assistant" if role == "model" else role
            text = extract_gemini_text(node)
            signature = (normalized_role, text, timestamp)
            if text and signature not in message_signatures:
                message_signatures.add(signature)
                messages.append(TranscriptMessage(role=normalized_role, text=text, timestamp=timestamp))

        tool_name = (
            get_nested(node, "toolUse", "name")
            or node.get("toolName")
            or node.get("functionName")
            or node.get("tool")
        )
        if tool_name:
            tool_events.append(
                TranscriptToolEvent(
                    summary=f"{tool_name} input={summarize_value(node.get('args') or node.get('input'))}",
                    timestamp=timestamp,
                )
            )

        for value in node.values():
            visit(value)

    visit(payload)

    return ParsedTranscript(
        client="gemini",
        session_id=session_id,
        title=title,
        started_at=started_at,
        cwd=cwd,
        branch=branch,
        messages=messages,
        tool_events=tool_events,
        source_path=path,
    )


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


def upsert_search_index(db_path: Path, manifest: dict[str, Any]) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transcripts (
                client TEXT NOT NULL,
                project TEXT NOT NULL,
                session_id TEXT NOT NULL,
                raw_sha256 TEXT NOT NULL,
                title TEXT NOT NULL,
                started_at TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                cwd TEXT NOT NULL,
                branch TEXT NOT NULL,
                raw_source_path TEXT NOT NULL,
                raw_upload_permission TEXT NOT NULL,
                global_raw_path TEXT NOT NULL,
                global_clean_path TEXT NOT NULL,
                repo_raw_path TEXT NOT NULL,
                repo_clean_path TEXT NOT NULL,
                repo_manifest_path TEXT NOT NULL,
                message_count INTEGER NOT NULL,
                tool_event_count INTEGER NOT NULL,
                PRIMARY KEY (client, project, session_id, raw_sha256)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO transcripts (
                client,
                project,
                session_id,
                raw_sha256,
                title,
                started_at,
                imported_at,
                cwd,
                branch,
                raw_source_path,
                raw_upload_permission,
                global_raw_path,
                global_clean_path,
                repo_raw_path,
                repo_clean_path,
                repo_manifest_path,
                message_count,
                tool_event_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(client, project, session_id, raw_sha256) DO UPDATE SET
                title = excluded.title,
                started_at = excluded.started_at,
                imported_at = excluded.imported_at,
                cwd = excluded.cwd,
                branch = excluded.branch,
                raw_source_path = excluded.raw_source_path,
                raw_upload_permission = excluded.raw_upload_permission,
                global_raw_path = excluded.global_raw_path,
                global_clean_path = excluded.global_clean_path,
                repo_raw_path = excluded.repo_raw_path,
                repo_clean_path = excluded.repo_clean_path,
                repo_manifest_path = excluded.repo_manifest_path,
                message_count = excluded.message_count,
                tool_event_count = excluded.tool_event_count
            """,
            (
                manifest["client"],
                manifest["project"],
                manifest["session_id"],
                manifest["raw_sha256"],
                manifest["title"],
                manifest["started_at"],
                manifest["imported_at"],
                manifest["cwd"],
                manifest["branch"],
                manifest["raw_source_path"],
                manifest["raw_upload_permission"],
                manifest["global_raw_path"],
                manifest["global_clean_path"],
                manifest["repo_raw_path"],
                manifest["repo_clean_path"],
                manifest["repo_manifest_path"],
                manifest["message_count"],
                manifest["tool_event_count"],
            ),
        )
        conn.commit()
    finally:
        conn.close()


def copy_file(source: Path, destination: Path) -> None:
    if source.resolve() == destination.resolve():
        return
    shutil.copy2(source, destination)


def transcript_has_content(parsed: ParsedTranscript) -> bool:
    return bool(parsed.messages or parsed.tool_events)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def manifest_changed(path: Path, payload: dict[str, Any]) -> bool:
    if not path.exists():
        return True
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    return current != payload


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


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def ensure_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def ensure_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def get_nested(payload: dict[str, Any], *keys: str) -> Any:
    current: Any = payload
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def extract_text_blocks(blocks: Any) -> str:
    parts: list[str] = []
    for block in ensure_list(blocks):
        if isinstance(block, str):
            text = block.strip()
            if text:
                parts.append(text)
            continue
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "").lower()
        if block_type in SKIP_BLOCK_TYPES | TOOL_USE_TYPES | TOOL_RESULT_TYPES:
            continue
        if block_type in TEXT_BLOCK_TYPES:
            text = str(block.get("text") or "").strip()
            if text:
                parts.append(text)
            continue
        fallback_text = extract_simple_text(block)
        if fallback_text:
            parts.append(fallback_text)
    return join_paragraphs(parts)


def extract_simple_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return join_paragraphs(extract_simple_text(item) for item in value)
    if isinstance(value, dict):
        for key in ("text", "content", "value"):
            if key in value and isinstance(value[key], str):
                return value[key].strip()
        return ""
    return ""


def extract_gemini_text(node: dict[str, Any]) -> str:
    parts: list[str] = []
    for candidate in (node.get("parts"), node.get("content"), node.get("text"), node.get("message")):
        parts.extend(extract_gemini_parts(candidate))
    return join_paragraphs(parts)


def extract_gemini_parts(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            parts.extend(extract_gemini_parts(item))
        return parts
    if isinstance(value, dict):
        block_type = str(value.get("type") or "").lower()
        if block_type in SKIP_BLOCK_TYPES | TOOL_USE_TYPES | TOOL_RESULT_TYPES:
            return []
        if "text" in value and isinstance(value["text"], str):
            text = value["text"].strip()
            return [text] if text else []
        parts: list[str] = []
        for key in ("parts", "content"):
            if key in value:
                parts.extend(extract_gemini_parts(value[key]))
        return parts
    return []


def find_first_mapping_with_keys(value: Any, keys: set[str]) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if keys & set(value.keys()):
            return value
        for candidate in value.values():
            result = find_first_mapping_with_keys(candidate, keys)
            if result is not None:
                return result
        return None
    if isinstance(value, list):
        for candidate in value:
            result = find_first_mapping_with_keys(candidate, keys)
            if result is not None:
                return result
    return None


def normalize_timestamp(value: Any, fallback: str | None = None) -> str:
    if isinstance(value, (int, float)):
        return (
            datetime.fromtimestamp(float(value), tz=timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
    if isinstance(value, datetime):
        normalized = value.astimezone(timezone.utc) if value.tzinfo else value
        return normalized.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return fallback or normalize_timestamp(datetime.now(timezone.utc))
        iso_candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
        try:
            parsed = datetime.fromisoformat(iso_candidate)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc)
            return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except ValueError:
            return text
    return fallback or normalize_timestamp(datetime.now(timezone.utc))


def earliest_timestamp(current: str, candidate: Any) -> str:
    normalized = normalize_timestamp(candidate, current)
    current_dt = parse_iso_timestamp(current)
    normalized_dt = parse_iso_timestamp(normalized)
    if current_dt is not None and normalized_dt is not None:
        return normalized if normalized_dt < current_dt else current
    if normalized_dt is not None:
        return normalized
    return current or normalized


def parse_iso_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    candidate = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def timestamp_partition(timestamp: str) -> tuple[str, str]:
    try:
        candidate = timestamp[:-1] + "+00:00" if timestamp.endswith("Z") else timestamp
        parsed = datetime.fromisoformat(candidate)
        return parsed.strftime("%Y"), parsed.strftime("%m")
    except ValueError:
        return "unknown", "unknown"


def join_paragraphs(parts: Any) -> str:
    cleaned = [str(part).strip() for part in parts if str(part).strip()]
    return "\n\n".join(cleaned)


def summarize_value(value: Any, limit: int = 180) -> str:
    if value is None:
        return "none"
    if isinstance(value, str):
        text = " ".join(value.split())
        return truncate(text, limit)
    try:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        text = str(value)
    text = " ".join(text.split())
    return truncate(text, limit)


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 3] + "..."


def yaml_escape(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


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
