"""Unit tests for memorytree_daemon.py — OS scheduler integration.

All tests mock subprocess.run and platform.system() to avoid
touching real OS schedulers (cron / launchd / schtasks).
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import memorytree_daemon as daemon  # noqa: E402


def _ns(**kwargs) -> argparse.Namespace:
    """Build an argparse.Namespace with defaults for install args."""
    defaults = {"interval": "", "auto_push": "", "func": None}
    defaults.update(kwargs)
    return argparse.Namespace(**defaults)


# ---------------------------------------------------------------------------
# cmd_install
# ---------------------------------------------------------------------------


class CmdInstallLinuxTest(unittest.TestCase):
    """cmd_install on Linux delegates to _install_cron."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Linux")
    @patch("memorytree_daemon.save_config")
    @patch("memorytree_daemon.load_config")
    def test_linux_calls_install_cron(
        self, mock_load: MagicMock, mock_save: MagicMock, _sys: MagicMock, mock_run: MagicMock
    ) -> None:
        from _config_utils import Config

        mock_load.return_value = Config()
        # _get_crontab returns empty (no existing registration)
        mock_run.side_effect = [
            MagicMock(returncode=1, stdout=""),  # crontab -l (no crontab)
            MagicMock(returncode=1, stdout=""),  # _is_cron_registered re-check
            MagicMock(returncode=0),  # crontab - (install)
        ]
        result = daemon.cmd_install(_ns())
        self.assertEqual(result, 0)
        # Last subprocess.run should be crontab - (pipe install)
        last_call = mock_run.call_args_list[-1]
        self.assertEqual(last_call[0][0], ["crontab", "-"])


class CmdInstallMacOSTest(unittest.TestCase):
    """cmd_install on macOS delegates to _install_launchd."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Darwin")
    @patch("memorytree_daemon.save_config")
    @patch("memorytree_daemon.load_config")
    def test_macos_calls_install_launchd(
        self, mock_load: MagicMock, mock_save: MagicMock, _sys: MagicMock, mock_run: MagicMock
    ) -> None:
        from _config_utils import Config

        mock_load.return_value = Config()
        with tempfile.TemporaryDirectory() as tmp:
            plist_path = Path(tmp) / "com.memorytree.heartbeat.plist"
            with patch("memorytree_daemon._launchd_plist_path", return_value=plist_path):
                mock_run.return_value = MagicMock(returncode=0)
                result = daemon.cmd_install(_ns())
        self.assertEqual(result, 0)
        # launchctl load should have been called
        mock_run.assert_called_once()
        self.assertIn("launchctl", mock_run.call_args[0][0])


class CmdInstallWindowsTest(unittest.TestCase):
    """cmd_install on Windows delegates to _install_schtasks."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    @patch("memorytree_daemon.save_config")
    @patch("memorytree_daemon.load_config")
    def test_windows_calls_install_schtasks(
        self, mock_load: MagicMock, mock_save: MagicMock, _sys: MagicMock, mock_run: MagicMock
    ) -> None:
        from _config_utils import Config

        mock_load.return_value = Config()
        # _is_schtasks_registered returns False, then schtasks /create succeeds
        mock_run.side_effect = [
            MagicMock(returncode=1),  # /query → not registered
            MagicMock(returncode=0),  # /create → success
        ]
        result = daemon.cmd_install(_ns())
        self.assertEqual(result, 0)
        create_call = mock_run.call_args_list[-1]
        self.assertIn("/create", create_call[0][0])


class CmdInstallIntervalOverrideTest(unittest.TestCase):
    """--interval flag updates config before install."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    @patch("memorytree_daemon.save_config")
    @patch("memorytree_daemon.load_config")
    def test_interval_override(
        self, mock_load: MagicMock, mock_save: MagicMock, _sys: MagicMock, mock_run: MagicMock
    ) -> None:
        from _config_utils import Config

        mock_load.return_value = Config()
        mock_run.side_effect = [
            MagicMock(returncode=1),  # not registered
            MagicMock(returncode=0),  # create
        ]
        daemon.cmd_install(_ns(interval="10m"))
        saved_cfg = mock_save.call_args[0][0]
        self.assertEqual(saved_cfg.heartbeat_interval, "10m")


class CmdInstallAutoPushOverrideTest(unittest.TestCase):
    """--auto-push false updates config."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    @patch("memorytree_daemon.save_config")
    @patch("memorytree_daemon.load_config")
    def test_auto_push_false(
        self, mock_load: MagicMock, mock_save: MagicMock, _sys: MagicMock, mock_run: MagicMock
    ) -> None:
        from _config_utils import Config

        mock_load.return_value = Config()
        mock_run.side_effect = [
            MagicMock(returncode=1),
            MagicMock(returncode=0),
        ]
        daemon.cmd_install(_ns(auto_push="false"))
        saved_cfg = mock_save.call_args[0][0]
        self.assertFalse(saved_cfg.auto_push)


class CmdInstallDuplicateRejectedTest(unittest.TestCase):
    """Install is rejected when already registered."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    @patch("memorytree_daemon.save_config")
    @patch("memorytree_daemon.load_config")
    def test_duplicate_install_returns_1(
        self, mock_load: MagicMock, mock_save: MagicMock, _sys: MagicMock, mock_run: MagicMock
    ) -> None:
        from _config_utils import Config

        mock_load.return_value = Config()
        # _is_schtasks_registered returns True (already registered)
        mock_run.return_value = MagicMock(returncode=0)
        result = daemon.cmd_install(_ns())
        self.assertEqual(result, 1)


# ---------------------------------------------------------------------------
# cmd_uninstall
# ---------------------------------------------------------------------------


class CmdUninstallLinuxTest(unittest.TestCase):
    """cmd_uninstall on Linux filters crontab."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Linux")
    def test_linux_uninstall(self, _sys: MagicMock, mock_run: MagicMock) -> None:
        # _get_crontab returns existing crontab with memorytree line
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="0 * * * * echo hello\n*/5 * * * * heartbeat # memorytree\n"),
            MagicMock(returncode=0),  # crontab - (write filtered)
        ]
        result = daemon.cmd_uninstall(_ns())
        self.assertEqual(result, 0)
        # Verify the memorytree line was filtered out
        write_call = mock_run.call_args_list[-1]
        self.assertNotIn("memorytree", write_call[1].get("input", ""))


class CmdUninstallMacOSTest(unittest.TestCase):
    """cmd_uninstall on macOS calls launchctl unload + deletes plist."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Darwin")
    def test_macos_uninstall(self, _sys: MagicMock, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0)
        with tempfile.TemporaryDirectory() as tmp:
            plist_path = Path(tmp) / "com.memorytree.heartbeat.plist"
            plist_path.write_text("<plist/>", encoding="utf-8")
            with patch("memorytree_daemon._launchd_plist_path", return_value=plist_path):
                result = daemon.cmd_uninstall(_ns())
        self.assertEqual(result, 0)
        # launchctl unload was called
        self.assertIn("unload", mock_run.call_args[0][0])


class CmdUninstallWindowsTest(unittest.TestCase):
    """cmd_uninstall on Windows calls schtasks /delete."""

    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    def test_windows_uninstall(self, _sys: MagicMock, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0)
        result = daemon.cmd_uninstall(_ns())
        self.assertEqual(result, 0)
        self.assertIn("/delete", mock_run.call_args[0][0])


# ---------------------------------------------------------------------------
# cmd_run_once
# ---------------------------------------------------------------------------


class CmdRunOnceTest(unittest.TestCase):
    """cmd_run_once invokes heartbeat.py via subprocess."""

    @patch("memorytree_daemon.subprocess.run")
    def test_calls_heartbeat_script(self, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0)
        result = daemon.cmd_run_once(_ns())
        self.assertEqual(result, 0)
        called_args = mock_run.call_args[0][0]
        # Last arg should be the heartbeat.py path
        self.assertTrue(called_args[-1].endswith("heartbeat.py"))


# ---------------------------------------------------------------------------
# cmd_status
# ---------------------------------------------------------------------------


class CmdStatusRegisteredTest(unittest.TestCase):
    """Status output when registered and locked."""

    @patch("memorytree_daemon.config_path")
    @patch("memorytree_daemon.read_lock_pid", return_value=12345)
    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    def test_registered_and_locked(
        self, _sys: MagicMock, mock_run: MagicMock, _lock: MagicMock, mock_cfg_path: MagicMock
    ) -> None:
        # _is_schtasks_registered returns True
        mock_run.return_value = MagicMock(returncode=0)
        # config_path().exists() → False to skip config section
        mock_cfg_path.return_value = Path("/nonexistent/config.toml")
        with patch("builtins.print") as mock_print:
            result = daemon.cmd_status(_ns())
        self.assertEqual(result, 0)
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("yes", output)
        self.assertIn("12345", output)


class CmdStatusUnregisteredTest(unittest.TestCase):
    """Status output when not registered and unlocked."""

    @patch("memorytree_daemon.config_path")
    @patch("memorytree_daemon.read_lock_pid", return_value=None)
    @patch("memorytree_daemon.subprocess.run")
    @patch("memorytree_daemon.platform.system", return_value="Windows")
    def test_unregistered_and_unlocked(
        self, _sys: MagicMock, mock_run: MagicMock, _lock: MagicMock, mock_cfg_path: MagicMock
    ) -> None:
        # _is_schtasks_registered returns False
        mock_run.return_value = MagicMock(returncode=1)
        mock_cfg_path.return_value = Path("/nonexistent/config.toml")
        with patch("builtins.print") as mock_print:
            result = daemon.cmd_status(_ns())
        self.assertEqual(result, 0)
        output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("no", output)
        self.assertIn("not held", output)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


class HeartbeatScriptPathTest(unittest.TestCase):
    """_heartbeat_script_path returns scripts/heartbeat.py absolute path."""

    def test_returns_heartbeat_path(self) -> None:
        path = daemon._heartbeat_script_path()
        self.assertTrue(path.is_absolute())
        self.assertEqual(path.name, "heartbeat.py")
        self.assertEqual(path.parent, SCRIPTS_DIR)


class PythonPathWithUvTest(unittest.TestCase):
    """_python_path returns uv wrapper when uv is available."""

    @patch("memorytree_daemon.shutil.which", return_value="/usr/bin/uv")
    def test_with_uv(self, _which: MagicMock) -> None:
        result = daemon._python_path()
        self.assertEqual(result, ["/usr/bin/uv", "run", "python"])


class PythonPathWithoutUvTest(unittest.TestCase):
    """_python_path falls back to sys.executable without uv."""

    @patch("memorytree_daemon.shutil.which", return_value=None)
    def test_without_uv(self, _which: MagicMock) -> None:
        result = daemon._python_path()
        self.assertEqual(result, [sys.executable])


# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------


class IsCronRegisteredTest(unittest.TestCase):
    """_is_cron_registered checks crontab for memorytree marker."""

    @patch("memorytree_daemon.subprocess.run")
    def test_registered(self, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="*/5 * * * * cmd # memorytree\n")
        self.assertTrue(daemon._is_cron_registered())

    @patch("memorytree_daemon.subprocess.run")
    def test_not_registered(self, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="0 * * * * echo hello\n")
        self.assertFalse(daemon._is_cron_registered())


class IsLaunchdRegisteredTest(unittest.TestCase):
    """_is_launchd_registered checks plist file existence."""

    def test_registered(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plist = Path(tmp) / "test.plist"
            plist.write_text("<plist/>", encoding="utf-8")
            with patch("memorytree_daemon._launchd_plist_path", return_value=plist):
                self.assertTrue(daemon._is_launchd_registered())

    def test_not_registered(self) -> None:
        with patch("memorytree_daemon._launchd_plist_path", return_value=Path("/nonexistent.plist")):
            self.assertFalse(daemon._is_launchd_registered())


class IsSchtasksRegisteredTest(unittest.TestCase):
    """_is_schtasks_registered checks schtasks /query return code."""

    @patch("memorytree_daemon.subprocess.run")
    def test_registered(self, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=0)
        self.assertTrue(daemon._is_schtasks_registered())

    @patch("memorytree_daemon.subprocess.run")
    def test_not_registered(self, mock_run: MagicMock) -> None:
        mock_run.return_value = MagicMock(returncode=1)
        self.assertFalse(daemon._is_schtasks_registered())


if __name__ == "__main__":
    unittest.main()
