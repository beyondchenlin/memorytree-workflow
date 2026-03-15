"""Transcript search index — SQLite upsert for the global transcript catalog."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


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
