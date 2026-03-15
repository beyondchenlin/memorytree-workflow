"""Integration tests — end-to-end workflows across multiple modules."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from _scaffold_utils import DIRS, create_memory_dirs  # noqa: E402
from _transcript_discover import discover_source_files  # noqa: E402
from _transcript_import import import_transcript, transcript_has_content  # noqa: E402
from _transcript_parse import (  # noqa: E402
    ParsedTranscript,
    TranscriptMessage,
    TranscriptToolEvent,
    parse_claude_transcript,
)

# heartbeat imports
from heartbeat import SENSITIVE_PATTERNS, _scan_sensitive  # noqa: E402


def _make_claude_jsonl(path: Path, cwd: str = "") -> None:
    """Write a minimal Claude transcript JSONL file."""
    records = [
        {
            "type": "user",
            "sessionId": "test-session-1",
            "timestamp": "2026-03-14T10:00:00Z",
            "cwd": cwd,
            "gitBranch": "main",
            "message": {"role": "user", "content": "Hello world"},
        },
        {
            "type": "assistant",
            "sessionId": "test-session-1",
            "timestamp": "2026-03-14T10:00:05Z",
            "cwd": cwd,
            "gitBranch": "main",
            "message": {"role": "assistant", "content": "Hi! How can I help?"},
        },
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(r) for r in records) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Scenario 1: init → import end-to-end
# ---------------------------------------------------------------------------


class InitImportE2ETest(unittest.TestCase):
    """create_memory_dirs → parse → import round-trip."""

    def test_init_parse_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            root.mkdir()
            global_root = Path(tmp) / "global"
            global_root.mkdir()

            # Step 1: create Memory dir structure
            created = create_memory_dirs(root)
            for d in DIRS:
                self.assertTrue((root / d).is_dir(), f"Missing dir: {d}")

            # Step 2: create mock Claude transcript + parse
            transcript_path = Path(tmp) / "transcript.jsonl"
            _make_claude_jsonl(transcript_path, cwd=root.as_posix())
            parsed = parse_claude_transcript(transcript_path)
            self.assertEqual(parsed.client, "claude")
            self.assertTrue(transcript_has_content(parsed))
            self.assertEqual(len(parsed.messages), 2)

            # Step 3: import transcript
            result = import_transcript(
                parsed=parsed,
                root=root,
                global_root=global_root,
                project_slug="project",
                raw_upload_permission="not-set",
                mirror_to_repo=True,
            )

            # Verify raw copy exists in repo mirror
            repo_raw = root / result["repo_raw_path"]
            self.assertTrue(repo_raw.exists(), f"Missing repo raw: {repo_raw}")

            # Verify clean markdown exists
            repo_clean = root / result["repo_clean_path"]
            self.assertTrue(repo_clean.exists(), f"Missing repo clean: {repo_clean}")

            # Verify manifest
            repo_manifest = root / result["repo_manifest_path"]
            self.assertTrue(repo_manifest.exists(), f"Missing manifest: {repo_manifest}")
            manifest_data = json.loads(repo_manifest.read_text(encoding="utf-8"))
            self.assertEqual(manifest_data["client"], "claude")
            self.assertEqual(manifest_data["project"], "project")

            # Verify global copies
            self.assertTrue(Path(result["global_raw_path"]).exists())
            self.assertTrue(Path(result["global_clean_path"]).exists())


# ---------------------------------------------------------------------------
# Scenario 2: discover batch scan
# ---------------------------------------------------------------------------


class DiscoverBatchScanTest(unittest.TestCase):
    """discover_source_files() finds transcripts from all 3 client layouts."""

    def test_discovers_all_clients(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)

            # Claude layout: .claude/projects/<slug>/<session>.jsonl
            claude_root = base / ".claude"
            claude_file = claude_root / "projects" / "my-proj" / "session1.jsonl"
            _make_claude_jsonl(claude_file)

            # Codex layout: .codex/sessions/<id>.jsonl
            codex_root = base / ".codex"
            codex_file = codex_root / "sessions" / "sess-abc.jsonl"
            codex_file.parent.mkdir(parents=True, exist_ok=True)
            codex_file.write_text('{"type":"session_meta","payload":{"id":"abc"}}\n', encoding="utf-8")

            # Gemini layout: .gemini/history/<id>.json
            gemini_root = base / ".gemini"
            gemini_file = gemini_root / "history" / "chat1.json"
            gemini_file.parent.mkdir(parents=True, exist_ok=True)
            gemini_file.write_text('{"role":"user","text":"hello"}', encoding="utf-8")

            mock_roots = {
                "claude": claude_root,
                "codex": codex_root,
                "gemini": gemini_root,
            }
            with patch("_transcript_discover.default_client_roots", return_value=mock_roots):
                results = discover_source_files()

            clients_found = {client for client, _ in results}
            self.assertIn("claude", clients_found)
            self.assertIn("codex", clients_found)
            self.assertIn("gemini", clients_found)
            self.assertEqual(len(results), 3)


# ---------------------------------------------------------------------------
# Scenario 3: heartbeat sensitive info scanning
# ---------------------------------------------------------------------------


class SensitiveScanTest(unittest.TestCase):
    """SENSITIVE_PATTERNS + _scan_sensitive() detect/skip correctly."""

    def _make_parsed(self, text: str) -> ParsedTranscript:
        return ParsedTranscript(
            client="claude",
            session_id="s1",
            title="test",
            started_at="2026-03-14T00:00:00Z",
            cwd="",
            branch="main",
            messages=[TranscriptMessage(role="user", text=text)],
            tool_events=[],
            source_path=Path("test.jsonl"),
        )

    def test_detects_api_key(self) -> None:
        parsed = self._make_parsed("my api_key = sk-abc123secretvalue")
        self.assertTrue(any(p.search(parsed.messages[0].text) for p in SENSITIVE_PATTERNS))

    def test_detects_password(self) -> None:
        parsed = self._make_parsed("password=hunter2")
        self.assertTrue(any(p.search(parsed.messages[0].text) for p in SENSITIVE_PATTERNS))

    def test_detects_bearer_token(self) -> None:
        parsed = self._make_parsed("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6")
        self.assertTrue(any(p.search(parsed.messages[0].text) for p in SENSITIVE_PATTERNS))

    def test_detects_github_pat(self) -> None:
        parsed = self._make_parsed("Use ghp_1234567890abcdefghij for auth")
        self.assertTrue(any(p.search(parsed.messages[0].text) for p in SENSITIVE_PATTERNS))

    def test_ignores_safe_text(self) -> None:
        parsed = self._make_parsed("Please fix the login form")
        self.assertFalse(any(p.search(parsed.messages[0].text) for p in SENSITIVE_PATTERNS))

    def test_scan_sensitive_writes_alert(self) -> None:
        """_scan_sensitive writes an alert when a pattern matches."""
        parsed = self._make_parsed("token = mysecrettoken123")
        with tempfile.TemporaryDirectory() as tmp:
            project_path = Path(tmp) / "proj"
            project_path.mkdir()
            alerts_file = Path(tmp) / "alerts.json"
            # Suppress log output; redirect alert writes
            with (
                patch("heartbeat.get_logger", return_value=logging.getLogger("test.heartbeat")),
                patch("heartbeat.write_alert") as mock_alert,
            ):
                _scan_sensitive(parsed, project_path)
                mock_alert.assert_called_once()
                call_args = mock_alert.call_args
                self.assertEqual(call_args[1].get("alert_type") or call_args[0][1], "sensitive_match")


# ---------------------------------------------------------------------------
# Scenario 4: heartbeat integration (git init → import → commit)
# ---------------------------------------------------------------------------


class HeartbeatIntegrationTest(unittest.TestCase):
    """Full heartbeat cycle: discover → import → git commit."""

    def test_heartbeat_imports_and_commits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project_root = Path(tmp) / "myrepo"
            project_root.mkdir()
            global_root = Path(tmp) / "global_transcripts"

            # Init git repo
            subprocess.run(["git", "init"], cwd=project_root, capture_output=True, check=True)
            subprocess.run(
                ["git", "config", "user.email", "test@test.com"],
                cwd=project_root, capture_output=True, check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=project_root, capture_output=True, check=True,
            )

            # Create Memory/ structure + a placeholder so git has something to commit
            create_memory_dirs(project_root)
            (project_root / "Memory" / ".gitkeep").write_text("", encoding="utf-8")

            # Create initial commit so HEAD exists
            subprocess.run(["git", "add", "."], cwd=project_root, capture_output=True, check=True)
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=project_root, capture_output=True, check=True,
            )

            # Create mock Claude transcript pointing at this project
            claude_root = Path(tmp) / ".claude"
            slug = "myrepo"
            transcript_file = claude_root / "projects" / slug / "session.jsonl"
            _make_claude_jsonl(transcript_file, cwd=project_root.as_posix())

            mock_roots = {
                "claude": claude_root,
                "codex": Path(tmp) / ".codex",
                "gemini": Path(tmp) / ".gemini",
            }

            # Import heartbeat modules
            from _config_utils import Config, ProjectEntry  # noqa: E402
            from _log_utils import LOGGER_NAME  # noqa: E402

            config = Config(
                projects=[ProjectEntry(path=project_root.as_posix(), name="myrepo")],
                auto_push=False,
            )

            # Suppress logging noise
            logger = logging.getLogger(LOGGER_NAME)
            logger.handlers.clear()
            logger.addHandler(logging.NullHandler())

            from heartbeat import _process_project  # noqa: E402

            with (
                patch("_transcript_discover.default_client_roots", return_value=mock_roots),
                patch("heartbeat.setup_logging", return_value=logger),
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat.write_alert"),
                patch("heartbeat.write_alert_with_threshold"),
                patch("heartbeat.reset_failure_count"),
            ):
                from _transcript_discover import discover_source_files as _discover  # noqa: E402
                from _transcript_import import import_transcript as _import  # noqa: E402
                from _transcript_parse import parse_transcript as _parse  # noqa: E402
                from _transcript_discover import transcript_matches_repo as _matches  # noqa: E402
                from _transcript_import import transcript_has_content as _has_content  # noqa: E402

                discovered = _discover()
                imported = 0
                for client, source in discovered:
                    try:
                        parsed = _parse(client, source)
                    except Exception:
                        continue
                    if not _has_content(parsed):
                        continue
                    if not _matches(parsed, project_root, slug):
                        continue
                    _import(
                        parsed=parsed,
                        root=project_root,
                        global_root=global_root,
                        project_slug=slug,
                        raw_upload_permission="not-set",
                        mirror_to_repo=True,
                    )
                    imported += 1

            self.assertGreater(imported, 0, "Should have imported at least 1 transcript")

            # Verify files were created in Memory/
            transcript_dir = project_root / "Memory" / "06_transcripts"
            self.assertTrue(transcript_dir.exists(), "06_transcripts dir should exist")

            # Git add + commit
            subprocess.run(["git", "add", "Memory/"], cwd=project_root, capture_output=True, check=True)
            status = subprocess.run(
                ["git", "status", "--porcelain", "Memory/"],
                cwd=project_root, capture_output=True, text=True, check=True,
            )
            if status.stdout.strip():
                result = subprocess.run(
                    ["git", "commit", "-m", f"memorytree(transcripts): import {imported} transcript(s)"],
                    cwd=project_root, capture_output=True, text=True, check=True,
                )
                self.assertEqual(result.returncode, 0)

                # Verify git log has the commit
                log_result = subprocess.run(
                    ["git", "log", "--oneline", "-1"],
                    cwd=project_root, capture_output=True, text=True, check=True,
                )
                self.assertIn("memorytree(transcripts)", log_result.stdout)


if __name__ == "__main__":
    unittest.main()
