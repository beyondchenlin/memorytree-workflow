"""Shared constants, data-access helpers, and text-extraction utilities."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from _transcript_parse import TranscriptMessage, TranscriptToolEvent


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CLIENTS = {"codex", "claude", "gemini"}
TEXT_BLOCK_TYPES = {"input_text", "output_text", "text"}
SKIP_BLOCK_TYPES = {"thinking", "reasoning"}
TOOL_USE_TYPES = {"tool_use"}
TOOL_RESULT_TYPES = {"tool_result"}


# ---------------------------------------------------------------------------
# Generic utilities
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Text extraction helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Deduplication helpers
# ---------------------------------------------------------------------------


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def deduplicate_messages(messages: list[TranscriptMessage]) -> list[TranscriptMessage]:
    """Deduplicate based on (timestamp, role, content_sha256_prefix). Keep first."""
    seen: set[tuple[str | None, str, str]] = set()
    result: list[TranscriptMessage] = []
    for msg in messages:
        sig = (msg.timestamp, msg.role, _content_hash(msg.text))
        if sig not in seen:
            seen.add(sig)
            result.append(msg)
    return result


def deduplicate_tool_events(events: list[TranscriptToolEvent]) -> list[TranscriptToolEvent]:
    """Deduplicate based on (timestamp, summary_sha256_prefix). Keep first."""
    seen: set[tuple[str | None, str]] = set()
    result: list[TranscriptToolEvent] = []
    for evt in events:
        sig = (evt.timestamp, _content_hash(evt.summary))
        if sig not in seen:
            seen.add(sig)
            result.append(evt)
    return result
