"""Manage ~/.memorytree/alerts.json — create, dedup, read, clear."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

MAX_ALERTS = 100
ALERT_TYPES = {"no_remote", "sensitive_match", "push_failed", "lock_held"}
FAILURE_THRESHOLD = 3


def alerts_path() -> Path:
    return Path.home() / ".memorytree" / "alerts.json"


def _failure_state_path() -> Path:
    return Path.home() / ".memorytree" / "failure_counts.json"


def read_alerts() -> list[dict]:
    """Read all pending alerts. Returns empty list if file missing or malformed."""
    path = alerts_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return data


def write_alert(
    project: str,
    alert_type: str,
    message: str,
) -> None:
    """Append or dedup an alert. Dedup key is (project, type)."""
    alerts = read_alerts()
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    # Dedup: find existing alert with same project+type, build new list
    found = False
    new_alerts = []
    for alert in alerts:
        if alert.get("project") == project and alert.get("type") == alert_type:
            new_alerts.append(
                {
                    **alert,
                    "timestamp": now,
                    "message": message,
                    "count": alert.get("count", 1) + 1,
                }
            )
            found = True
        else:
            new_alerts.append(alert)

    if not found:
        new_alerts.append(
            {
                "timestamp": now,
                "project": project,
                "type": alert_type,
                "message": message,
                "count": 1,
            }
        )

    # Cap at MAX_ALERTS, drop oldest first
    if len(new_alerts) > MAX_ALERTS:
        new_alerts = new_alerts[-MAX_ALERTS:]

    _save_alerts(new_alerts)


def write_alert_with_threshold(
    project: str,
    alert_type: str,
    message: str,
) -> None:
    """Write an alert only after FAILURE_THRESHOLD consecutive failures for the same project+type."""
    counts = _read_failure_counts()
    key = f"{project}::{alert_type}"
    current = counts.get(key, 0) + 1
    new_counts = {**counts, key: current}
    _save_failure_counts(new_counts)

    if current >= FAILURE_THRESHOLD:
        write_alert(project, alert_type, message)


def reset_failure_count(project: str, alert_type: str) -> None:
    """Reset the consecutive failure counter on success."""
    counts = _read_failure_counts()
    key = f"{project}::{alert_type}"
    if key in counts:
        new_counts = {k: v for k, v in counts.items() if k != key}
        _save_failure_counts(new_counts)


def clear_alerts() -> None:
    """Remove all alerts (called after displaying to user)."""
    path = alerts_path()
    if path.exists():
        try:
            path.unlink()
        except OSError:
            pass


def format_alerts_for_display(alerts: list[dict]) -> str:
    """Format alerts as a human-readable text block."""
    if not alerts:
        return ""
    lines = []
    for alert in alerts:
        count_suffix = f" (x{alert['count']})" if alert.get("count", 1) > 1 else ""
        lines.append(
            f"  [{alert.get('type', 'unknown')}] {alert.get('project', '?')}: "
            f"{alert.get('message', '')}{count_suffix}"
        )
    return "\n".join(lines)


def _save_alerts(alerts: list[dict]) -> None:
    path = alerts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(alerts, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_failure_counts() -> dict[str, int]:
    path = _failure_state_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _save_failure_counts(counts: dict[str, int]) -> None:
    path = _failure_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(counts, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
