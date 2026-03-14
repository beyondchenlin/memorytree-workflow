#!/usr/bin/env python3
"""
Detect the effective locale for MemoryTree initialization and maintenance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from _locale_utils import detect_repo_locale, detect_system_locale, normalize_locale


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else None

    result = {
        "requested": args.locale,
        "repo_locale": detect_repo_locale(root),
        "system_locale": detect_system_locale(),
        "effective_locale": normalize_locale(args.locale, root),
    }

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(result["effective_locale"])
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect MemoryTree locale.")
    parser.add_argument("--root", default=".", help="Target repository root.")
    parser.add_argument("--locale", default="auto", help="Requested locale: auto, en, or zh-cn.")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
