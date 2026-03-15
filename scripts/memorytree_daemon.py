#!/usr/bin/env python3
"""
memorytree-daemon — CLI for managing the MemoryTree heartbeat lifecycle.

Subcommands:
  install    Register the heartbeat with the OS scheduler.
  uninstall  Remove the heartbeat scheduled task.
  run-once   Execute a single heartbeat cycle immediately.
  watch      Continuous loop for development/debugging only.
  status     Show whether the heartbeat is registered and its lock state.
"""

from __future__ import annotations

import argparse
import platform
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

from _config_utils import Config, config_path, interval_to_seconds, load_config, save_config
from _lock_utils import read_lock_pid


TASK_NAME = "MemoryTree Heartbeat"
LAUNCHD_LABEL = "com.memorytree.heartbeat"


def main() -> int:
    args = parse_args()
    return args.func(args)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="memorytree-daemon",
        description="Manage the MemoryTree heartbeat lifecycle.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    install_cmd = sub.add_parser("install", help="Register heartbeat with the OS scheduler.")
    install_cmd.add_argument("--interval", default="", help='Override heartbeat interval (e.g., "5m").')
    install_cmd.add_argument("--auto-push", choices=("true", "false"), default="", help="Override auto_push setting.")
    install_cmd.set_defaults(func=cmd_install)

    uninstall_cmd = sub.add_parser("uninstall", help="Remove the heartbeat scheduled task.")
    uninstall_cmd.set_defaults(func=cmd_uninstall)

    runonce_cmd = sub.add_parser("run-once", help="Execute a single heartbeat cycle now.")
    runonce_cmd.set_defaults(func=cmd_run_once)

    watch_cmd = sub.add_parser("watch", help="Continuous loop (development only).")
    watch_cmd.add_argument("--interval", default="", help='Override interval (e.g., "5m").')
    watch_cmd.set_defaults(func=cmd_watch)

    status_cmd = sub.add_parser("status", help="Show heartbeat registration and lock state.")
    status_cmd.set_defaults(func=cmd_status)

    return parser.parse_args()


# ── Subcommands ──────────────────────────────────────────────────────────────


def cmd_install(args: argparse.Namespace) -> int:
    config = load_config()

    if args.interval:
        config = Config(
            heartbeat_interval=args.interval,
            watch_dirs=config.watch_dirs,
            projects=list(config.projects),
            auto_push=config.auto_push,
            log_level=config.log_level,
        )
    if args.auto_push:
        config = Config(
            heartbeat_interval=config.heartbeat_interval,
            watch_dirs=config.watch_dirs,
            projects=list(config.projects),
            auto_push=args.auto_push == "true",
            log_level=config.log_level,
        )

    save_config(config)
    seconds = interval_to_seconds(config.heartbeat_interval)
    heartbeat_script = _heartbeat_script_path()

    system = platform.system()
    if system == "Linux":
        return _install_cron(heartbeat_script, seconds)
    if system == "Darwin":
        return _install_launchd(heartbeat_script, seconds)
    if system == "Windows":
        return _install_schtasks(heartbeat_script, seconds)

    print(f"Unsupported platform: {system}", file=sys.stderr)
    return 1


def cmd_uninstall(_args: argparse.Namespace) -> int:
    system = platform.system()
    if system == "Linux":
        return _uninstall_cron()
    if system == "Darwin":
        return _uninstall_launchd()
    if system == "Windows":
        return _uninstall_schtasks()

    print(f"Unsupported platform: {system}", file=sys.stderr)
    return 1


def cmd_run_once(_args: argparse.Namespace) -> int:
    heartbeat_script = _heartbeat_script_path()
    python = _python_path()
    result = subprocess.run([*python, str(heartbeat_script)], cwd=heartbeat_script.parent)
    return result.returncode


def cmd_watch(args: argparse.Namespace) -> int:
    config = load_config()
    interval_str = args.interval or config.heartbeat_interval
    seconds = interval_to_seconds(interval_str)
    heartbeat_script = _heartbeat_script_path()
    python = _python_path()

    print(f"Watch mode: running heartbeat every {seconds}s. Press Ctrl+C to stop.")
    try:
        while True:
            subprocess.run([*python, str(heartbeat_script)], cwd=heartbeat_script.parent)
            time.sleep(seconds)
    except KeyboardInterrupt:
        print("\nWatch mode stopped.")
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    system = platform.system()

    # Check scheduler registration
    registered = False
    if system == "Linux":
        registered = _is_cron_registered()
    elif system == "Darwin":
        registered = _is_launchd_registered()
    elif system == "Windows":
        registered = _is_schtasks_registered()

    print(f"Platform:   {system}")
    print(f"Registered: {'yes' if registered else 'no'}")

    # Check lock state
    pid = read_lock_pid()
    if pid is not None:
        print(f"Lock:       held by PID {pid}")
    else:
        print("Lock:       not held")

    # Config summary
    if config_path().exists():
        config = load_config()
        print(f"Interval:   {config.heartbeat_interval}")
        print(f"Auto-push:  {config.auto_push}")
        print(f"Projects:   {len(config.projects)}")
    else:
        print("Config:     not found (using defaults)")

    return 0


# ── Linux (cron) ─────────────────────────────────────────────────────────────


def _install_cron(heartbeat_script: Path, seconds: int) -> int:
    if _is_cron_registered():
        print("Heartbeat is already registered in cron. Use 'uninstall' first.", file=sys.stderr)
        return 1

    python = _python_path()
    minutes = max(1, seconds // 60)
    log_dir = Path.home() / ".memorytree" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    python_cmd = " ".join(shlex.quote(p) for p in python)
    cron_line = (
        f"*/{minutes} * * * * "
        f"cd {shlex.quote(str(heartbeat_script.parent))} && "
        f"{python_cmd} {shlex.quote(str(heartbeat_script))} "
        f">> {shlex.quote(str(log_dir / 'heartbeat-cron.log'))} 2>&1 "
        f"# memorytree"
    )

    existing = _get_crontab()
    new_crontab = existing.rstrip("\n") + "\n" + cron_line + "\n" if existing.strip() else cron_line + "\n"

    result = subprocess.run(["crontab", "-"], input=new_crontab, text=True, capture_output=True)
    if result.returncode != 0:
        print(f"Failed to install cron job: {result.stderr}", file=sys.stderr)
        return 1

    print(f"Heartbeat registered in cron (every {minutes}m).")
    return 0


def _uninstall_cron() -> int:
    existing = _get_crontab()
    filtered = "\n".join(line for line in existing.splitlines() if "memorytree" not in line)
    subprocess.run(["crontab", "-"], input=filtered + "\n", text=True, capture_output=True)
    print("Heartbeat removed from cron.")
    return 0


def _is_cron_registered() -> bool:
    return "memorytree" in _get_crontab()


def _get_crontab() -> str:
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ""


# ── macOS (launchd) ──────────────────────────────────────────────────────────


def _launchd_plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"


def _install_launchd(heartbeat_script: Path, seconds: int) -> int:
    plist_path = _launchd_plist_path()
    if plist_path.exists():
        print("Heartbeat plist already exists. Use 'uninstall' first.", file=sys.stderr)
        return 1

    python = _python_path()
    log_dir = Path.home() / ".memorytree" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    program_args = "\n".join(f"        <string>{p}</string>" for p in [*python, str(heartbeat_script)])

    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
{program_args}
    </array>
    <key>StartInterval</key>
    <integer>{seconds}</integer>
    <key>WorkingDirectory</key>
    <string>{heartbeat_script.parent}</string>
    <key>StandardOutPath</key>
    <string>{log_dir}/heartbeat-launchd.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/heartbeat-launchd.log</string>
</dict>
</plist>
"""
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    plist_path.write_text(plist_content, encoding="utf-8")

    result = subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Failed to load plist: {result.stderr}", file=sys.stderr)
        return 1

    print(f"Heartbeat registered via launchd (every {seconds}s).")
    return 0


def _uninstall_launchd() -> int:
    plist_path = _launchd_plist_path()
    if plist_path.exists():
        subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
        plist_path.unlink(missing_ok=True)
    print("Heartbeat removed from launchd.")
    return 0


def _is_launchd_registered() -> bool:
    return _launchd_plist_path().exists()


# ── Windows (Task Scheduler) ────────────────────────────────────────────────


def _install_schtasks(heartbeat_script: Path, seconds: int) -> int:
    if _is_schtasks_registered():
        print("Heartbeat is already registered in Task Scheduler. Use 'uninstall' first.", file=sys.stderr)
        return 1

    python = _python_path()
    minutes = max(1, seconds // 60)

    tr_command = " ".join(f'"{p}"' for p in [*python, str(heartbeat_script)])

    result = subprocess.run(
        [
            "schtasks", "/create",
            "/tn", TASK_NAME,
            "/sc", "minute",
            "/mo", str(minutes),
            "/tr", tr_command,
            "/f",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Failed to create scheduled task: {result.stderr}", file=sys.stderr)
        return 1

    print(f"Heartbeat registered in Task Scheduler (every {minutes}m).")
    return 0


def _uninstall_schtasks() -> int:
    subprocess.run(
        ["schtasks", "/delete", "/tn", TASK_NAME, "/f"],
        capture_output=True,
        text=True,
    )
    print("Heartbeat removed from Task Scheduler.")
    return 0


def _is_schtasks_registered() -> bool:
    result = subprocess.run(
        ["schtasks", "/query", "/tn", TASK_NAME],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


# ── Helpers ──────────────────────────────────────────────────────────────────


def _heartbeat_script_path() -> Path:
    return Path(__file__).resolve().parent / "heartbeat.py"


def _python_path() -> list[str]:
    uv = shutil.which("uv")
    if uv:
        return [uv, "run", "python"]
    return [sys.executable]


if __name__ == "__main__":
    sys.exit(main())
