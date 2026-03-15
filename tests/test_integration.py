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
from unittest.mock import MagicMock, patch

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
from heartbeat import (  # noqa: E402
    SENSITIVE_PATTERNS,
    _git,
    _git_commit_and_push,
    _process_project,
    _run_heartbeat,
    _scan_sensitive,
    _try_push,
    main as heartbeat_main,
)
from _config_utils import Config, ProjectEntry  # noqa: E402
from _log_utils import LOGGER_NAME  # noqa: E402


def _null_logger() -> logging.Logger:
    """Return a silent logger for test isolation."""
    logger = logging.getLogger(LOGGER_NAME)
    logger.handlers.clear()
    logger.addHandler(logging.NullHandler())
    logger.setLevel(logging.DEBUG)
    return logger


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
# Scenario 4: heartbeat integration — calling heartbeat.py functions directly
# ---------------------------------------------------------------------------


class HeartbeatMainTest(unittest.TestCase):
    """Tests for heartbeat.main() — lock, dispatch, release."""

    def test_lock_failure_returns_zero(self) -> None:
        logger = _null_logger()
        with (
            patch("heartbeat.load_config", return_value=Config()),
            patch("heartbeat.setup_logging", return_value=logger),
            patch("heartbeat.acquire_lock", return_value=False),
            patch("heartbeat.write_alert") as mock_alert,
            patch("heartbeat.release_lock") as mock_release,
        ):
            result = heartbeat_main()
        self.assertEqual(result, 0)
        mock_alert.assert_called_once()
        mock_release.assert_not_called()

    def test_lock_acquired_runs_and_releases(self) -> None:
        logger = _null_logger()
        config = Config()  # no projects → _run_heartbeat returns 0 quickly
        with (
            patch("heartbeat.load_config", return_value=config),
            patch("heartbeat.setup_logging", return_value=logger),
            patch("heartbeat.acquire_lock", return_value=True),
            patch("heartbeat.release_lock") as mock_release,
            patch("heartbeat.get_logger", return_value=logger),
        ):
            result = heartbeat_main()
        self.assertEqual(result, 0)
        mock_release.assert_called_once()


class RunHeartbeatTest(unittest.TestCase):
    """Tests for heartbeat._run_heartbeat()."""

    def test_no_projects_returns_zero(self) -> None:
        logger = _null_logger()
        with patch("heartbeat.get_logger", return_value=logger):
            result = _run_heartbeat(Config())
        self.assertEqual(result, 0)

    def test_with_projects_calls_process_project(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "repo"
            proj.mkdir()
            config = Config(projects=[ProjectEntry(path=proj.as_posix(), name="repo")])
            with (
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat._process_project") as mock_pp,
            ):
                _run_heartbeat(config)
            mock_pp.assert_called_once()

    def test_missing_project_path_skipped(self) -> None:
        logger = _null_logger()
        config = Config(projects=[ProjectEntry(path="/nonexistent/path/xyz", name="ghost")])
        with (
            patch("heartbeat.get_logger", return_value=logger),
            patch("heartbeat._process_project") as mock_pp,
        ):
            _run_heartbeat(config)
        mock_pp.assert_not_called()

    def test_process_project_exception_writes_alert(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "repo"
            proj.mkdir()
            config = Config(projects=[ProjectEntry(path=proj.as_posix(), name="repo")])
            with (
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat._process_project", side_effect=RuntimeError("boom")),
                patch("heartbeat.write_alert_with_threshold") as mock_alert,
            ):
                _run_heartbeat(config)
            mock_alert.assert_called_once()


class ProcessProjectTest(unittest.TestCase):
    """Tests for heartbeat._process_project() — full discover→import→git cycle."""

    def test_process_project_imports_and_commits(self) -> None:
        """End-to-end: real file system, real git, calling _process_project directly."""
        with tempfile.TemporaryDirectory() as tmp:
            project_root = Path(tmp) / "myrepo"
            project_root.mkdir()
            home_dir = Path(tmp) / "fakehome"
            home_dir.mkdir()

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

            # Create Memory/ + initial commit
            create_memory_dirs(project_root)
            (project_root / "Memory" / ".gitkeep").write_text("", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=project_root, capture_output=True, check=True)
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=project_root, capture_output=True, check=True,
            )

            # Create mock Claude transcript
            claude_root = Path(tmp) / ".claude"
            transcript_file = claude_root / "projects" / "myrepo" / "session.jsonl"
            _make_claude_jsonl(transcript_file, cwd=project_root.as_posix())

            mock_roots = {
                "claude": claude_root,
                "codex": Path(tmp) / ".codex",
                "gemini": Path(tmp) / ".gemini",
            }
            config = Config(auto_push=False)
            logger = _null_logger()

            with (
                patch("_transcript_discover.default_client_roots", return_value=mock_roots),
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat.write_alert"),
                patch("heartbeat.write_alert_with_threshold"),
                patch("heartbeat.reset_failure_count"),
                patch("pathlib.Path.home", return_value=home_dir),
            ):
                _process_project(config, project_root, "myrepo")

            # Verify transcript files imported into Memory/
            transcript_dir = project_root / "Memory" / "06_transcripts"
            self.assertTrue(transcript_dir.exists())

            # Verify git committed the imports
            log_result = subprocess.run(
                ["git", "log", "--oneline"],
                cwd=project_root, capture_output=True, text=True, check=True,
            )
            self.assertIn("memorytree(transcripts)", log_result.stdout)

    def test_no_new_transcripts_skips_commit(self) -> None:
        logger = _null_logger()
        config = Config()
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "repo"
            proj.mkdir()
            home_dir = Path(tmp) / "fakehome"
            home_dir.mkdir()
            # No transcripts to discover
            mock_roots = {
                "claude": Path(tmp) / ".claude",
                "codex": Path(tmp) / ".codex",
                "gemini": Path(tmp) / ".gemini",
            }
            with (
                patch("_transcript_discover.default_client_roots", return_value=mock_roots),
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat._git_commit_and_push") as mock_git,
                patch("pathlib.Path.home", return_value=home_dir),
            ):
                _process_project(config, proj, "repo")
            mock_git.assert_not_called()


class GitCommitAndPushTest(unittest.TestCase):
    """Tests for heartbeat._git_commit_and_push()."""

    def _git_repo(self, tmp: str) -> Path:
        proj = Path(tmp) / "repo"
        proj.mkdir()
        subprocess.run(["git", "init"], cwd=proj, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "t@t.com"], cwd=proj, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.name", "T"], cwd=proj, capture_output=True, check=True)
        (proj / "Memory").mkdir()
        (proj / "Memory" / ".gitkeep").write_text("", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=proj, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=proj, capture_output=True, check=True)
        return proj

    def test_no_changes_skips_commit(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._git_repo(tmp)
            with patch("heartbeat.get_logger", return_value=logger):
                _git_commit_and_push(Config(), proj, "repo", 1)
            # Should not have a second commit
            log = subprocess.run(
                ["git", "log", "--oneline"], cwd=proj, capture_output=True, text=True, check=True
            )
            self.assertEqual(log.stdout.strip().count("\n"), 0)  # only "init"

    def test_commits_when_changes_exist(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._git_repo(tmp)
            # Create a change in Memory/
            (proj / "Memory" / "new_file.txt").write_text("data", encoding="utf-8")
            with patch("heartbeat.get_logger", return_value=logger):
                _git_commit_and_push(Config(auto_push=False), proj, "repo", 1)
            log = subprocess.run(
                ["git", "log", "--oneline"], cwd=proj, capture_output=True, text=True, check=True
            )
            self.assertIn("memorytree(transcripts)", log.stdout)

    def test_auto_push_false_skips_push(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._git_repo(tmp)
            (proj / "Memory" / "new.txt").write_text("x", encoding="utf-8")
            with (
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat._try_push") as mock_push,
            ):
                _git_commit_and_push(Config(auto_push=False), proj, "repo", 1)
            mock_push.assert_not_called()

    def test_no_remote_writes_alert(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._git_repo(tmp)
            (proj / "Memory" / "new.txt").write_text("x", encoding="utf-8")
            with (
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat.write_alert") as mock_alert,
            ):
                _git_commit_and_push(Config(auto_push=True), proj, "repo", 1)
            # No remote configured → alert
            mock_alert.assert_called_once()
            self.assertEqual(mock_alert.call_args[1].get("alert_type") or mock_alert.call_args[0][1], "no_remote")

    def test_push_success_resets_failure(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._git_repo(tmp)
            (proj / "Memory" / "new.txt").write_text("x", encoding="utf-8")
            # Add a fake remote so push path is taken
            subprocess.run(
                ["git", "remote", "add", "origin", "https://example.com/repo.git"],
                cwd=proj, capture_output=True, check=True,
            )
            with (
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat._try_push", return_value=True) as mock_push,
                patch("heartbeat.reset_failure_count") as mock_reset,
            ):
                _git_commit_and_push(Config(auto_push=True), proj, "repo", 1)
            mock_push.assert_called_once()
            mock_reset.assert_called_once()

    def test_push_fail_retry_then_alert(self) -> None:
        logger = _null_logger()
        with tempfile.TemporaryDirectory() as tmp:
            proj = self._git_repo(tmp)
            (proj / "Memory" / "new.txt").write_text("x", encoding="utf-8")
            subprocess.run(
                ["git", "remote", "add", "origin", "https://example.com/repo.git"],
                cwd=proj, capture_output=True, check=True,
            )
            with (
                patch("heartbeat.get_logger", return_value=logger),
                patch("heartbeat._try_push", return_value=False) as mock_push,
                patch("heartbeat.write_alert_with_threshold") as mock_alert,
            ):
                _git_commit_and_push(Config(auto_push=True), proj, "repo", 1)
            self.assertEqual(mock_push.call_count, 2)  # initial + 1 retry
            mock_alert.assert_called_once()


class TryPushTest(unittest.TestCase):
    """Tests for heartbeat._try_push()."""

    def test_success(self) -> None:
        logger = _null_logger()
        with (
            patch("heartbeat.get_logger", return_value=logger),
            patch("heartbeat._git", return_value=""),
        ):
            self.assertTrue(_try_push(Path("/repo"), "proj"))

    def test_failure(self) -> None:
        logger = _null_logger()
        with (
            patch("heartbeat.get_logger", return_value=logger),
            patch("heartbeat._git", side_effect=subprocess.CalledProcessError(1, "git push")),
        ):
            self.assertFalse(_try_push(Path("/repo"), "proj"))


class GitHelperTest(unittest.TestCase):
    """Tests for heartbeat._git() subprocess wrapper."""

    def test_returns_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            subprocess.run(["git", "init"], cwd=proj, capture_output=True, check=True)
            output = _git(proj, "status", "--porcelain")
            self.assertIsInstance(output, str)

    def test_non_zero_raises_for_non_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            subprocess.run(["git", "init"], cwd=proj, capture_output=True, check=True)
            with self.assertRaises(subprocess.CalledProcessError):
                _git(proj, "log")  # no commits → error

    def test_status_and_remote_tolerate_non_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            subprocess.run(["git", "init"], cwd=proj, capture_output=True, check=True)
            # These should not raise even on non-zero exit
            _git(proj, "status", "--porcelain", "nonexistent/")
            _git(proj, "remote")


if __name__ == "__main__":
    unittest.main()
