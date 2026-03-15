"""Unit tests for P0 heartbeat modules: config, lock, alert, log."""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from _alert_utils import (  # noqa: E402
    FAILURE_THRESHOLD,
    read_alerts,
    reset_failure_count,
    write_alert,
    write_alert_with_threshold,
)
from _config_utils import (  # noqa: E402
    Config,
    ProjectEntry,
    interval_to_seconds,
    load_config,
    register_project,
    save_config,
)
from _lock_utils import acquire_lock, read_lock_pid, release_lock  # noqa: E402
from _log_utils import LOGGER_NAME, setup_logging  # noqa: E402


# ---------------------------------------------------------------------------
# _config_utils tests
# ---------------------------------------------------------------------------


class LoadConfigDefaultsTest(unittest.TestCase):
    """load_config() returns defaults when config.toml is missing."""

    def test_returns_defaults_when_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("_config_utils.config_path", return_value=Path(tmp) / "config.toml"):
                cfg = load_config()
        self.assertEqual(cfg.heartbeat_interval, "5m")
        self.assertTrue(cfg.auto_push)
        self.assertEqual(cfg.log_level, "info")
        self.assertEqual(cfg.projects, [])
        self.assertEqual(cfg.watch_dirs, [])


class LoadConfigParseTest(unittest.TestCase):
    """load_config() parses valid TOML correctly."""

    def test_parses_valid_toml(self) -> None:
        toml_content = (
            'heartbeat_interval = "10m"\n'
            "auto_push = false\n"
            'log_level = "debug"\n'
            'watch_dirs = ["/a", "/b"]\n'
            "\n"
            "[[projects]]\n"
            'path = "/home/user/repo"\n'
            'name = "my-repo"\n'
        )
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = Path(tmp) / "config.toml"
            cfg_path.write_text(toml_content, encoding="utf-8")
            with patch("_config_utils.config_path", return_value=cfg_path):
                cfg = load_config()
        self.assertEqual(cfg.heartbeat_interval, "10m")
        self.assertFalse(cfg.auto_push)
        self.assertEqual(cfg.log_level, "debug")
        self.assertEqual(cfg.watch_dirs, ["/a", "/b"])
        self.assertEqual(len(cfg.projects), 1)
        self.assertEqual(cfg.projects[0].path, "/home/user/repo")
        self.assertEqual(cfg.projects[0].name, "my-repo")

    def test_invalid_toml_returns_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = Path(tmp) / "config.toml"
            cfg_path.write_text("{{invalid toml", encoding="utf-8")
            with patch("_config_utils.config_path", return_value=cfg_path):
                cfg = load_config()
        self.assertEqual(cfg.heartbeat_interval, "5m")


class IntervalToSecondsTest(unittest.TestCase):
    """interval_to_seconds() converts various formats."""

    def test_5m_is_300(self) -> None:
        self.assertEqual(interval_to_seconds("5m"), 300)

    def test_300s_is_300(self) -> None:
        self.assertEqual(interval_to_seconds("300s"), 300)

    def test_1h_is_3600(self) -> None:
        self.assertEqual(interval_to_seconds("1h"), 3600)

    def test_invalid_falls_back_to_default(self) -> None:
        self.assertEqual(interval_to_seconds("abc"), 300)

    def test_whitespace_is_trimmed(self) -> None:
        self.assertEqual(interval_to_seconds("  10m  "), 600)


class SaveLoadRoundTripTest(unittest.TestCase):
    """save_config() + load_config() round-trip preserves values."""

    def test_round_trip(self) -> None:
        original = Config(
            heartbeat_interval="10m",
            watch_dirs=["/dir1", "/dir2"],
            projects=[ProjectEntry(path="/repo/a", name="alpha")],
            auto_push=False,
            log_level="debug",
        )
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = Path(tmp) / "config.toml"
            with patch("_config_utils.config_path", return_value=cfg_path):
                save_config(original)
                loaded = load_config()
        self.assertEqual(loaded.heartbeat_interval, original.heartbeat_interval)
        self.assertEqual(loaded.auto_push, original.auto_push)
        self.assertEqual(loaded.log_level, original.log_level)
        self.assertEqual(loaded.watch_dirs, original.watch_dirs)
        self.assertEqual(len(loaded.projects), 1)
        self.assertEqual(loaded.projects[0].path, "/repo/a")
        self.assertEqual(loaded.projects[0].name, "alpha")


class RegisterProjectTest(unittest.TestCase):
    """register_project() adds new entries and deduplicates."""

    def test_adds_new_project(self) -> None:
        cfg = Config()
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "my-repo"
            repo.mkdir()
            new_cfg = register_project(cfg, repo)
        self.assertEqual(len(new_cfg.projects), 1)
        self.assertEqual(new_cfg.projects[0].name, "my-repo")

    def test_deduplicates_existing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "my-repo"
            repo.mkdir()
            cfg = Config(projects=[ProjectEntry(path=repo.resolve().as_posix(), name="my-repo")])
            new_cfg = register_project(cfg, repo)
        self.assertEqual(len(new_cfg.projects), 1)

    def test_does_not_mutate_original(self) -> None:
        cfg = Config()
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "my-repo"
            repo.mkdir()
            new_cfg = register_project(cfg, repo)
        self.assertEqual(len(cfg.projects), 0)
        self.assertEqual(len(new_cfg.projects), 1)


# ---------------------------------------------------------------------------
# _lock_utils tests
# ---------------------------------------------------------------------------


class AcquireLockTest(unittest.TestCase):
    """Lock acquisition, release, and stale detection."""

    def test_acquire_first_time_succeeds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock_file = Path(tmp) / "heartbeat.lock"
            with patch("_lock_utils.lock_path", return_value=lock_file):
                self.assertTrue(acquire_lock())
                pid = read_lock_pid()
                self.assertEqual(pid, os.getpid())
                release_lock()
                self.assertFalse(lock_file.exists())

    def test_acquire_while_locked_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock_file = Path(tmp) / "heartbeat.lock"
            with patch("_lock_utils.lock_path", return_value=lock_file):
                self.assertTrue(acquire_lock())
                # Same PID is alive, so second acquire fails
                self.assertFalse(acquire_lock())
                release_lock()

    def test_release_allows_reacquire(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock_file = Path(tmp) / "heartbeat.lock"
            with patch("_lock_utils.lock_path", return_value=lock_file):
                self.assertTrue(acquire_lock())
                release_lock()
                self.assertTrue(acquire_lock())
                release_lock()

    def test_stale_lock_auto_reclaimed(self) -> None:
        """A lock with a non-existent PID is treated as stale."""
        with tempfile.TemporaryDirectory() as tmp:
            lock_file = Path(tmp) / "heartbeat.lock"
            # Write a PID that almost certainly doesn't exist
            lock_file.write_text("999999999", encoding="utf-8")
            with (
                patch("_lock_utils.lock_path", return_value=lock_file),
                patch("_lock_utils._is_process_alive", return_value=False),
            ):
                self.assertTrue(acquire_lock())
                release_lock()

    def test_corrupt_lock_treated_as_stale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock_file = Path(tmp) / "heartbeat.lock"
            lock_file.write_text("not-a-pid", encoding="utf-8")
            with patch("_lock_utils.lock_path", return_value=lock_file):
                self.assertTrue(acquire_lock())
                release_lock()


# ---------------------------------------------------------------------------
# _alert_utils tests
# ---------------------------------------------------------------------------


class WriteAlertTest(unittest.TestCase):
    """Alert creation, dedup, and count increment."""

    def test_creates_alert_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            alerts_file = Path(tmp) / "alerts.json"
            with (
                patch("_alert_utils.alerts_path", return_value=alerts_file),
                patch("_alert_utils._save_alerts") as mock_save,
            ):
                write_alert("proj-a", "push_failed", "Push failed.")
                self.assertTrue(mock_save.called)
                saved = mock_save.call_args[0][0]
                self.assertEqual(len(saved), 1)
                self.assertEqual(saved[0]["project"], "proj-a")
                self.assertEqual(saved[0]["type"], "push_failed")
                self.assertEqual(saved[0]["count"], 1)

    def test_dedup_increments_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            alerts_file = Path(tmp) / "alerts.json"
            # Pre-seed with existing alert
            existing = [{"project": "proj-a", "type": "push_failed", "message": "old", "count": 2, "timestamp": "t0"}]
            alerts_file.parent.mkdir(parents=True, exist_ok=True)
            alerts_file.write_text(json.dumps(existing), encoding="utf-8")
            with patch("_alert_utils.alerts_path", return_value=alerts_file):
                write_alert("proj-a", "push_failed", "Push failed again.")
                alerts = json.loads(alerts_file.read_text(encoding="utf-8"))
                self.assertEqual(len(alerts), 1)
                self.assertEqual(alerts[0]["count"], 3)
                self.assertEqual(alerts[0]["message"], "Push failed again.")


class ReadAlertsTest(unittest.TestCase):
    """read_alerts() edge cases."""

    def test_returns_empty_when_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("_alert_utils.alerts_path", return_value=Path(tmp) / "no-such.json"):
                self.assertEqual(read_alerts(), [])

    def test_returns_empty_on_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bad_file = Path(tmp) / "alerts.json"
            bad_file.write_text("{not json array}", encoding="utf-8")
            with patch("_alert_utils.alerts_path", return_value=bad_file):
                self.assertEqual(read_alerts(), [])


class WriteAlertWithThresholdTest(unittest.TestCase):
    """write_alert_with_threshold() respects FAILURE_THRESHOLD."""

    def test_no_alert_before_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            alerts_file = Path(tmp) / "alerts.json"
            failure_file = Path(tmp) / "failure_counts.json"
            with (
                patch("_alert_utils.alerts_path", return_value=alerts_file),
                patch("_alert_utils._failure_state_path", return_value=failure_file),
            ):
                for _ in range(FAILURE_THRESHOLD - 1):
                    write_alert_with_threshold("proj", "push_failed", "fail")
                self.assertFalse(alerts_file.exists())

    def test_alert_at_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            alerts_file = Path(tmp) / "alerts.json"
            failure_file = Path(tmp) / "failure_counts.json"
            with (
                patch("_alert_utils.alerts_path", return_value=alerts_file),
                patch("_alert_utils._failure_state_path", return_value=failure_file),
            ):
                for _ in range(FAILURE_THRESHOLD):
                    write_alert_with_threshold("proj", "push_failed", "fail")
                self.assertTrue(alerts_file.exists())
                alerts = json.loads(alerts_file.read_text(encoding="utf-8"))
                self.assertEqual(len(alerts), 1)


class ResetFailureCountTest(unittest.TestCase):
    """reset_failure_count() clears the counter."""

    def test_clears_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            failure_file = Path(tmp) / "failure_counts.json"
            failure_file.write_text(json.dumps({"proj::push_failed": 5}), encoding="utf-8")
            with patch("_alert_utils._failure_state_path", return_value=failure_file):
                reset_failure_count("proj", "push_failed")
                data = json.loads(failure_file.read_text(encoding="utf-8"))
                self.assertNotIn("proj::push_failed", data)

    def test_noop_when_no_existing_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            failure_file = Path(tmp) / "failure_counts.json"
            with patch("_alert_utils._failure_state_path", return_value=failure_file):
                reset_failure_count("proj", "push_failed")  # should not raise


# ---------------------------------------------------------------------------
# _log_utils tests
# ---------------------------------------------------------------------------


class SetupLoggingTest(unittest.TestCase):
    """setup_logging() returns a configured logger."""

    def setUp(self) -> None:
        # Clear handlers before each test to avoid idempotency side effects
        logger = logging.getLogger(LOGGER_NAME)
        logger.handlers.clear()

    def test_returns_logger_with_handlers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_file = Path(tmp) / "heartbeat-test.log"
            with patch("_log_utils._log_file_path", return_value=log_file):
                logger = setup_logging("debug")
            self.assertEqual(logger.name, LOGGER_NAME)
            self.assertGreaterEqual(len(logger.handlers), 1)
            self.assertEqual(logger.level, logging.DEBUG)
            # Close handlers before temp dir cleanup (Windows holds file locks)
            self._close_handlers(logger)

    def test_idempotent_no_duplicate_handlers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_file = Path(tmp) / "heartbeat-test.log"
            with patch("_log_utils._log_file_path", return_value=log_file):
                logger1 = setup_logging("info")
                handler_count = len(logger1.handlers)
                logger2 = setup_logging("info")
            self.assertIs(logger1, logger2)
            self.assertEqual(len(logger2.handlers), handler_count)
            self._close_handlers(logger2)

    def tearDown(self) -> None:
        self._close_handlers(logging.getLogger(LOGGER_NAME))

    @staticmethod
    def _close_handlers(logger: logging.Logger) -> None:
        for handler in logger.handlers[:]:
            handler.close()
            logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
