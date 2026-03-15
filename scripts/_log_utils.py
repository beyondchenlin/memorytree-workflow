"""Logging setup for heartbeat — file rotation + stderr output."""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

LOGGER_NAME = "memorytree"


def setup_logging(log_level: str = "info") -> logging.Logger:
    """Configure the memorytree logger with file and stderr handlers."""
    logger = logging.getLogger(LOGGER_NAME)
    if logger.handlers:
        return logger

    level = _resolve_level(log_level)
    logger.setLevel(level)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    # Stderr handler
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(level)
    stderr_handler.setFormatter(formatter)
    logger.addHandler(stderr_handler)

    # File handler (date-based rotation)
    log_file = _log_file_path()
    log_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError:
        logger.warning("Could not open log file: %s", log_file)

    return logger


def get_logger() -> logging.Logger:
    """Get the memorytree logger (must call setup_logging first)."""
    return logging.getLogger(LOGGER_NAME)


def _log_file_path() -> Path:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return Path.home() / ".memorytree" / "logs" / f"heartbeat-{today}.log"


def _resolve_level(level_str: str) -> int:
    mapping = {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warn": logging.WARNING,
        "warning": logging.WARNING,
        "error": logging.ERROR,
    }
    return mapping.get(level_str.lower(), logging.INFO)
