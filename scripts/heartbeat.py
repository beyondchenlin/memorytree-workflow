#!/usr/bin/env python3
"""
MemoryTree heartbeat — single execution, stateless, idempotent.

Discovers new transcripts across Codex, Claude Code, and Gemini CLI,
imports them into the global archive and per-project mirrors, commits
MemoryTree changes, and optionally pushes. Designed to be invoked by
an OS scheduler (cron / launchd / Task Scheduler) every 5 minutes.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from _alert_utils import reset_failure_count, write_alert, write_alert_with_threshold
from _config_utils import Config, load_config
from _lock_utils import acquire_lock, release_lock
from _log_utils import get_logger, setup_logging
from _transcript_discover import (
    discover_source_files,
    infer_project_slug,
    transcript_matches_repo,
)
from _transcript_import import import_transcript, transcript_has_content
from _transcript_parse import ParsedTranscript, parse_transcript, slugify

SENSITIVE_PATTERNS = [
    re.compile(r"(?:api[_-]?key|apikey)\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"(?:password|passwd|pwd)\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"(?:secret|token)\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"(?:sk-|pk_live_|sk_live_|ghp_|gho_|glpat-)\S{10,}"),
    re.compile(r"Bearer\s+\S{20,}", re.IGNORECASE),
]


def main() -> int:
    config = load_config()
    logger = setup_logging(config.log_level)

    if not acquire_lock():
        logger.info("Another heartbeat instance is running. Exiting.")
        write_alert("global", "lock_held", "Heartbeat exited: another instance held the lock.")
        return 0

    try:
        return _run_heartbeat(config)
    finally:
        release_lock()


def _run_heartbeat(config: Config) -> int:
    logger = get_logger()

    if not config.projects:
        logger.info("No projects registered in config.toml. Nothing to do.")
        return 0

    logger.info("Heartbeat started. %d project(s) registered.", len(config.projects))

    for entry in config.projects:
        project_path = entry.resolved_path()
        if not project_path.exists():
            logger.warning("Project path does not exist, skipping: %s", project_path)
            continue
        try:
            _process_project(config, project_path, entry.name or project_path.name)
        except Exception:
            logger.exception("Error processing project: %s", project_path)
            write_alert_with_threshold(
                project=project_path.as_posix(),
                alert_type="push_failed",
                message=f"Heartbeat error for project: {project_path.name}",
            )

    logger.info("Heartbeat finished.")
    return 0


def _process_project(config: Config, project_path: Path, project_name: str) -> None:
    logger = get_logger()
    repo_slug = slugify(project_name, fallback="project")
    global_root = Path.home() / ".memorytree" / "transcripts"

    # Discover and import new transcripts
    discovered = discover_source_files()
    imported_count = 0

    for client, source in discovered:
        try:
            parsed = parse_transcript(client, source)
        except Exception:
            logger.debug("Failed to parse %s, skipping.", source)
            continue

        if not transcript_has_content(parsed):
            continue

        if not transcript_matches_repo(parsed, project_path, repo_slug):
            continue

        # Sensitive info scan on cleaned content
        _scan_sensitive(parsed, project_path)

        try:
            import_transcript(
                parsed=parsed,
                root=project_path,
                global_root=global_root,
                project_slug=repo_slug,
                raw_upload_permission="not-set",
                mirror_to_repo=True,
            )
            imported_count += 1
        except Exception:
            logger.exception("Failed to import transcript: %s", source)

    if imported_count == 0:
        logger.info("[%s] No new transcripts to import.", project_name)
        return

    logger.info("[%s] Imported %d transcript(s).", project_name, imported_count)

    # Git commit + push
    _git_commit_and_push(config, project_path, project_name, imported_count)


def _scan_sensitive(parsed: ParsedTranscript, project_path: Path) -> None:
    """Scan transcript messages for sensitive patterns. Warn only, never delete."""
    logger = get_logger()
    for msg in parsed.messages:
        for pattern in SENSITIVE_PATTERNS:
            if pattern.search(msg.text):
                logger.warning(
                    "Sensitive pattern detected in transcript %s (project: %s, role: %s)",
                    parsed.source_path,
                    project_path.name,
                    msg.role,
                )
                write_alert(
                    project=project_path.as_posix(),
                    alert_type="sensitive_match",
                    message=f"Sensitive pattern in transcript: {parsed.source_path.name}",
                )
                return  # One alert per transcript is enough


def _git_commit_and_push(config: Config, project_path: Path, project_name: str, count: int) -> None:
    logger = get_logger()

    # Check for changes in Memory/
    status = _git(project_path, "status", "--porcelain", "Memory/")
    if not status.strip():
        logger.info("[%s] No git changes in Memory/.", project_name)
        return

    # Stage and commit
    _git(project_path, "add", "Memory/")
    _git(
        project_path,
        "commit",
        "-m",
        f"memorytree(transcripts): import {count} transcript(s)",
    )
    logger.info("[%s] Committed %d transcript import(s).", project_name, count)

    if not config.auto_push:
        logger.info("[%s] auto_push disabled, skipping push.", project_name)
        return

    # Remote pre-check
    remotes = _git(project_path, "remote")
    if not remotes.strip():
        logger.warning("[%s] No git remote configured, skipping push.", project_name)
        write_alert(
            project=project_path.as_posix(),
            alert_type="no_remote",
            message="Push skipped: no Git remote configured.",
        )
        return

    # Push with one retry
    if not _try_push(project_path, project_name):
        logger.warning("[%s] Push failed, retrying once...", project_name)
        if not _try_push(project_path, project_name):
            logger.error("[%s] Push failed after retry.", project_name)
            write_alert_with_threshold(
                project=project_path.as_posix(),
                alert_type="push_failed",
                message="Push failed after retry.",
            )
            return

    reset_failure_count(project_path.as_posix(), "push_failed")


def _try_push(project_path: Path, project_name: str) -> bool:
    try:
        _git(project_path, "push")
        get_logger().info("[%s] Pushed successfully.", project_name)
        return True
    except subprocess.CalledProcessError:
        return False


def _git(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0 and args[0] not in ("status", "remote"):
        raise subprocess.CalledProcessError(
            result.returncode, ["git", *args], result.stdout, result.stderr
        )
    return result.stdout


if __name__ == "__main__":
    sys.exit(main())
