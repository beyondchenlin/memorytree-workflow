"""Transcript parsing — dataclasses, client inference, and format-specific parsers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from _transcript_common import *  # noqa: F401,F403
from _transcript_common import (
    SKIP_BLOCK_TYPES,
    TEXT_BLOCK_TYPES,
    TOOL_RESULT_TYPES,
    TOOL_USE_TYPES,
    deduplicate_messages,
    deduplicate_tool_events,
    earliest_timestamp,
    ensure_dict,
    ensure_list,
    extract_gemini_text,
    extract_text_blocks,
    find_first_mapping_with_keys,
    get_nested,
    join_paragraphs,
    load_jsonl,
    normalize_timestamp,
    summarize_value,
)


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


# ---------------------------------------------------------------------------
# Client inference + dispatch
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Codex parser
# ---------------------------------------------------------------------------


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

    messages = deduplicate_messages(messages)
    tool_events = deduplicate_tool_events(tool_events)

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


# ---------------------------------------------------------------------------
# Claude parser
# ---------------------------------------------------------------------------


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

    messages = deduplicate_messages(messages)
    tool_events = deduplicate_tool_events(tool_events)

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


# ---------------------------------------------------------------------------
# Gemini parser
# ---------------------------------------------------------------------------


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
            if text:
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

    messages = deduplicate_messages(messages)
    tool_events = deduplicate_tool_events(tool_events)

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
