from __future__ import annotations

import locale
import os
import re
from pathlib import Path


TEXT_EXTENSIONS = {".md", ".txt"}
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
MIN_LATIN_SIGNAL = 3


def normalize_locale(value: str, root: Path | None = None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in ("", "auto"):
        normalized = detect_repo_locale(root) or detect_system_locale()

    mapping = {
        "en": "en",
        "en-us": "en",
        "en-gb": "en",
        "zh": "zh-cn",
        "zh-cn": "zh-cn",
        "zh-sg": "zh-cn",
        "zh-hans": "zh-cn",
        "zh-hant": "zh-cn",
        "zh-tw": "zh-cn",
        "zh-hk": "zh-cn",
    }
    return mapping.get(normalized, normalized)


def detect_repo_locale(root: Path | None) -> str | None:
    if root is None or not root.exists():
        return None

    zh_score = 0
    en_score = 0

    for path in iter_repo_text_candidates(root):
        name = path.name.lower()
        if "zh-cn" in name or "zh_cn" in name:
            zh_score += 12

        sample = read_text_sample(path)
        if not sample:
            continue

        cjk_count = len(CJK_RE.findall(sample))
        latin_count = len(LATIN_RE.findall(sample))

        if cjk_count >= 8 and cjk_count >= max(4, latin_count // 4):
            zh_score += cjk_count
        if cjk_count == 0 and latin_count >= MIN_LATIN_SIGNAL:
            en_score += max(latin_count, 12)
            continue
        if latin_count >= 40 and latin_count >= max(40, cjk_count * 4):
            en_score += latin_count

    if zh_score == 0 and en_score == 0:
        return None
    if zh_score == 0:
        return "en"
    if en_score == 0:
        return "zh-cn"
    if zh_score >= en_score * 1.25:
        return "zh-cn"
    if en_score >= zh_score * 1.25:
        return "en"
    return None


def detect_system_locale() -> str:
    candidates = [
        locale.getlocale()[0],
        os.environ.get("LC_ALL"),
        os.environ.get("LANG"),
    ]
    for candidate in candidates:
        text = str(candidate or "").lower()
        if text.startswith("zh") or "chinese" in text:
            return "zh-cn"
    return "en"


def iter_repo_text_candidates(root: Path):
    seen: set[Path] = set()

    for rel in ("AGENTS.md", "README.md", "README.zh-CN.md", "README.zh_CN.md"):
        path = root / rel
        if path.is_file():
            seen.add(path)
            yield path

    top_level = sorted(
        path
        for path in root.iterdir()
        if path.is_file() and path.suffix.lower() in TEXT_EXTENSIONS and path not in seen
    )
    for path in top_level[:8]:
        seen.add(path)
        yield path

    docs_dir = root / "docs"
    if docs_dir.is_dir():
        count = 0
        for path in sorted(docs_dir.rglob("*")):
            if count >= 12:
                break
            if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS or path in seen:
                continue
            seen.add(path)
            count += 1
            yield path


def read_text_sample(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:4096]
    except OSError:
        return ""
