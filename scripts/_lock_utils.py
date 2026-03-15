"""PID-based lock file for heartbeat single-instance enforcement."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def lock_path() -> Path:
    return Path.home() / ".memorytree" / "heartbeat.lock"


def acquire_lock() -> bool:
    """Try to acquire the heartbeat lock. Returns True on success."""
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        try:
            stored_pid = int(path.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            # Corrupt lock file — treat as stale
            _remove_lock(path)
        else:
            if _is_process_alive(stored_pid):
                return False
            # Stale lock from a dead process
            _remove_lock(path)

    try:
        path.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        return False
    return True


def release_lock() -> None:
    """Release the heartbeat lock."""
    _remove_lock(lock_path())


def read_lock_pid() -> int | None:
    """Read the PID from the lock file, or None if not locked."""
    path = lock_path()
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _is_process_alive(pid: int) -> bool:
    """Check whether a process with the given PID is still running."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        return _is_process_alive_windows(pid)
    return _is_process_alive_unix(pid)


def _is_process_alive_unix(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we can't signal it
        return True


def _is_process_alive_windows(pid: int) -> bool:
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    except Exception:
        return False


def _remove_lock(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
