"""Load, validate, and manage ~/.memorytree/config.toml."""

from __future__ import annotations

import logging
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("memorytree")


DEFAULT_HEARTBEAT_INTERVAL = "5m"
DEFAULT_AUTO_PUSH = True
DEFAULT_LOG_LEVEL = "info"
VALID_LOG_LEVELS = {"debug", "info", "warn", "error"}


@dataclass
class ProjectEntry:
    path: str
    name: str = ""

    def resolved_path(self) -> Path:
        return Path(self.path).expanduser().resolve()


@dataclass
class Config:
    heartbeat_interval: str = DEFAULT_HEARTBEAT_INTERVAL
    watch_dirs: list[str] = field(default_factory=list)
    projects: list[ProjectEntry] = field(default_factory=list)
    auto_push: bool = DEFAULT_AUTO_PUSH
    log_level: str = DEFAULT_LOG_LEVEL


def memorytree_root() -> Path:
    return Path.home() / ".memorytree"


def config_path() -> Path:
    return memorytree_root() / "config.toml"


def load_config() -> Config:
    """Load config.toml, falling back to defaults on any error."""
    path = config_path()
    if not path.exists():
        log.info("config.toml not found, using defaults.")
        return Config()
    try:
        with path.open("rb") as fh:
            raw = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        log.error("Failed to parse config.toml: %s. Using defaults.", exc)
        return Config()
    return _parse_raw(raw)


def _parse_raw(raw: dict) -> Config:
    interval = raw.get("heartbeat_interval", DEFAULT_HEARTBEAT_INTERVAL)
    if not isinstance(interval, str) or not _is_valid_interval(interval):
        log.warning("Invalid heartbeat_interval '%s', using default '%s'.", interval, DEFAULT_HEARTBEAT_INTERVAL)
        interval = DEFAULT_HEARTBEAT_INTERVAL

    auto_push = raw.get("auto_push", DEFAULT_AUTO_PUSH)
    if not isinstance(auto_push, bool):
        log.warning("Invalid auto_push value '%s', using default %s.", auto_push, DEFAULT_AUTO_PUSH)
        auto_push = DEFAULT_AUTO_PUSH

    log_level = raw.get("log_level", DEFAULT_LOG_LEVEL)
    if not isinstance(log_level, str) or log_level.lower() not in VALID_LOG_LEVELS:
        log.warning("Invalid log_level '%s', using default '%s'.", log_level, DEFAULT_LOG_LEVEL)
        log_level = DEFAULT_LOG_LEVEL
    log_level = log_level.lower()

    watch_dirs: list[str] = []
    raw_dirs = raw.get("watch_dirs", [])
    if isinstance(raw_dirs, list):
        for d in raw_dirs:
            if isinstance(d, str):
                watch_dirs.append(d)

    projects: list[ProjectEntry] = []
    raw_projects = raw.get("projects", [])
    if isinstance(raw_projects, list):
        for entry in raw_projects:
            if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                projects.append(
                    ProjectEntry(
                        path=entry["path"],
                        name=str(entry.get("name", "")),
                    )
                )

    return Config(
        heartbeat_interval=interval,
        watch_dirs=watch_dirs,
        projects=projects,
        auto_push=auto_push,
        log_level=log_level,
    )


def interval_to_seconds(interval: str) -> int:
    """Convert an interval string like '5m' or '300s' to seconds."""
    match = re.fullmatch(r"(\d+)\s*(s|m|h)", interval.strip().lower())
    if not match:
        return interval_to_seconds(DEFAULT_HEARTBEAT_INTERVAL)
    value = int(match.group(1))
    unit = match.group(2)
    if value <= 0:
        return interval_to_seconds(DEFAULT_HEARTBEAT_INTERVAL)
    multiplier = {"s": 1, "m": 60, "h": 3600}
    return value * multiplier[unit]


def save_config(cfg: Config) -> None:
    """Write config back to config.toml."""
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f'heartbeat_interval = "{cfg.heartbeat_interval}"',
        f"auto_push = {'true' if cfg.auto_push else 'false'}",
        f'log_level = "{cfg.log_level}"',
    ]
    if cfg.watch_dirs:
        items = ", ".join(f'"{d}"' for d in cfg.watch_dirs)
        lines.append(f"watch_dirs = [{items}]")
    else:
        lines.append("watch_dirs = []")

    lines.append("")
    for project in cfg.projects:
        lines.append("[[projects]]")
        lines.append(f'path = "{project.path}"')
        if project.name:
            lines.append(f'name = "{project.name}"')
        lines.append("")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def register_project(cfg: Config, repo_path: Path) -> Config:
    """Add a project to the config if not already registered. Returns new Config."""
    resolved = repo_path.resolve().as_posix()
    for entry in cfg.projects:
        if entry.resolved_path().as_posix() == resolved:
            return cfg
    new_projects = [*cfg.projects, ProjectEntry(path=resolved, name=repo_path.name)]
    return Config(
        heartbeat_interval=cfg.heartbeat_interval,
        watch_dirs=list(cfg.watch_dirs),
        projects=new_projects,
        auto_push=cfg.auto_push,
        log_level=cfg.log_level,
    )


def _is_valid_interval(value: str) -> bool:
    match = re.fullmatch(r"(\d+)\s*(s|m|h)", value.strip().lower())
    if not match:
        return False
    return int(match.group(1)) > 0
