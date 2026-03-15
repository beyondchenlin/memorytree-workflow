"""Manage ~/.memorytree/alerts.json — create, dedup, read, clear."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

MAX_ALERTS = 100
ALERT_TYPES = {"no_remote", "sensitive_match", "push_failed", "lock_held"}


def alerts_path() -> Path:
    return Path.home() / ".memorytree" / "alerts.json"


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

    # Dedup: find existing alert with same project+type
    for alert in alerts:
        if alert.get("project") == project and alert.get("type") == alert_type:
            alert["timestamp"] = now
            alert["message"] = message
            alert["count"] = alert.get("count", 1) + 1
            _save_alerts(alerts)
            return

    # New alert
    alerts.append(
        {
            "timestamp": now,
            "project": project,
            "type": alert_type,
            "message": message,
            "count": 1,
        }
    )

    # Cap at MAX_ALERTS, drop oldest first
    if len(alerts) > MAX_ALERTS:
        alerts = alerts[-MAX_ALERTS:]

    _save_alerts(alerts)


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
