from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from _locale_utils import normalize_locale


DIRS = [
    "Memory/01_goals",
    "Memory/02_todos",
    "Memory/03_chat_logs",
    "Memory/04_knowledge",
    "Memory/05_archive",
]

CONTENT_POLICY_SOURCE_PATTERNS = [
    "CONTRIBUTING",
    "CONTRIBUTING.md",
    "CONTRIBUTING.*",
    ".github/CONTRIBUTING",
    ".github/CONTRIBUTING.*",
    ".github/CONTRIBUTING/*.md",
    "docs/CONTRIBUTING*.md",
    "docs/**/CONTRIBUTING*.md",
]

ALWAYS_POLICY_SOURCE_PATTERNS = [
    "CODEOWNERS",
    ".github/CODEOWNERS",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE/*.md",
    ".github/pull_request_template/*.md",
    ".gitlab/merge_request_templates/*.md",
    ".commitlintrc",
    ".commitlintrc.json",
    ".commitlintrc.yaml",
    ".commitlintrc.yml",
    ".commitlintrc.js",
    ".commitlintrc.cjs",
    "commitlint.config.js",
    "commitlint.config.cjs",
    "commitlint.config.mjs",
    ".pre-commit-config.yaml",
    ".pre-commit-config.yml",
]

POLICY_TEXT_PATTERNS = (
    r"\bpull request\b",
    r"\bmerge request\b",
    r"\bpr\b",
    r"\bbranch(?:es)?\b",
    r"\bprotected branch(?:es)?\b",
    r"\btarget branch\b",
    r"\bbase branch\b",
    r"\bcommit(?: message)?\b",
    r"\bconventional commit(?:s)?\b",
    r"\bcommitlint\b",
    r"\breview(?:er|ers)?\b",
    r"\bapproval(?:s)?\b",
    r"\bci\b",
    r"\be2e\b",
    r"\bpipeline(?:s)?\b",
    r"\bauto-merge\b",
    r"\bsquash merge\b",
    r"\bpre-push\b",
    r"\bpre-commit\b",
    r"\bcodeowners\b",
    r"\bstatus checks?\b",
    r"\brequired checks?\b",
    r"\brequired approvals?\b",
    r"\bmerge strategy\b",
    r"\u62c9\u53d6\u8bf7\u6c42",
    r"\u5408\u5e76\u8bf7\u6c42",
    r"\u5206\u652f",
    r"\u63d0\u4ea4\u4fe1\u606f",
    r"\u63d0\u4ea4\u6807\u9898",
    r"\u8bc4\u5ba1",
    r"\u5ba1\u6279",
    r"\u6d41\u6c34\u7ebf",
    r"\u68c0\u67e5",
    r"\u81ea\u52a8\u5408\u5e76",
    r"\u63d0\u4ea4\u89c4\u8303",
    r"\u9884\u63a8\u9001",
    r"\u9884\u63d0\u4ea4",
)


def build_datetime(date_value: str, time_value: str) -> datetime:
    if date_value and time_value:
        return datetime.strptime(f"{date_value} {time_value}", "%Y-%m-%d %H:%M")
    if date_value:
        return datetime.strptime(f"{date_value} 00:00", "%Y-%m-%d %H:%M")
    if time_value:
        today = datetime.now().strftime("%Y-%m-%d")
        return datetime.strptime(f"{today} {time_value}", "%Y-%m-%d %H:%M")
    return datetime.now()


def resolve_template_dir(skill_root: Path, root: Path, locale_value: str) -> Path:
    templates_root = skill_root / "assets" / "templates"
    locale_name = normalize_locale(locale_value, root)
    template_dir = templates_root / locale_name
    if not template_dir.exists():
        raise SystemExit(f"unsupported locale: {locale_value}")
    return template_dir


def find_external_policy_sources(root: Path) -> list[str]:
    matches: set[str] = set()
    for pattern in ALWAYS_POLICY_SOURCE_PATTERNS:
        for path in root.glob(pattern):
            if path.is_file():
                matches.add(path.relative_to(root).as_posix())
    for pattern in CONTENT_POLICY_SOURCE_PATTERNS:
        for path in root.glob(pattern):
            if path.is_file() and has_policy_content(path):
                matches.add(path.relative_to(root).as_posix())
    return sorted(matches)


def has_policy_content(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return True
    return any(re.search(pattern, text) for pattern in POLICY_TEXT_PATTERNS)


def find_latest_version(folder: Path, pattern: str) -> str | None:
    regex = re.compile(pattern)
    versions = []
    if folder.exists():
        for path in folder.iterdir():
            match = regex.fullmatch(path.name)
            if match:
                versions.append(match.group(1))
    return max(versions) if versions else None


def find_latest_goal_file(folder: Path) -> Path | None:
    regex = re.compile(r"goal_v(\d{3})_(\d{8})\.md")
    matches: list[tuple[str, str, Path]] = []
    if folder.exists():
        for path in folder.iterdir():
            match = regex.fullmatch(path.name)
            if match:
                matches.append((match.group(1), match.group(2), path))
    if not matches:
        return None
    matches.sort()
    return matches[-1][2]


def find_latest_todo_version(folder: Path, goal_version: str) -> str | None:
    regex = re.compile(rf"todo_v{goal_version}_(\d{{3}})_\d{{8}}\.md")
    versions = []
    if folder.exists():
        for path in folder.iterdir():
            match = regex.fullmatch(path.name)
            if match:
                versions.append(match.group(1))
    return max(versions) if versions else None


def find_latest_todo_file(folder: Path, goal_version: str) -> Path | None:
    regex = re.compile(rf"todo_v{goal_version}_(\d{{3}})_(\d{{8}})\.md")
    matches: list[tuple[str, str, Path]] = []
    if folder.exists():
        for path in folder.iterdir():
            match = regex.fullmatch(path.name)
            if match:
                matches.append((match.group(1), match.group(2), path))
    if not matches:
        return None
    matches.sort()
    return matches[-1][2]


def find_latest_chat_log_file(folder: Path) -> Path | None:
    regex = re.compile(r"(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})\.md")
    matches: list[tuple[str, str, Path]] = []
    if folder.exists():
        for path in folder.iterdir():
            match = regex.fullmatch(path.name)
            if match:
                matches.append((match.group(1), match.group(2), path))
    if not matches:
        return None
    matches.sort()
    return matches[-1][2]


def write_template(template_path: Path, target_path: Path, force: bool, values: dict[str, str]) -> bool:
    if target_path.exists() and not force:
        return False
    content = template_path.read_text(encoding="utf-8")
    for key, value in values.items():
        content = content.replace(f"{{{{{key}}}}}", value)
    target_path.write_text(content, encoding="utf-8")
    return True


@dataclass
class ScaffoldPaths:
    root: Path
    goal_dir: Path
    todo_dir: Path
    chat_dir: Path
    goal_path: Path
    todo_path: Path
    chat_path: Path
    goal_version: str
    todo_version: str
    previous_version: str
    date_label: str
    time_label: str


def resolve_scaffold_paths(root: Path, dt: datetime) -> ScaffoldPaths:
    date_token = dt.strftime("%Y%m%d")
    date_label = dt.strftime("%Y-%m-%d")
    time_label = dt.strftime("%H:%M")
    chat_filename = dt.strftime("%Y-%m-%d_%H-%M.md")

    goal_dir = root / "Memory" / "01_goals"
    todo_dir = root / "Memory" / "02_todos"
    chat_dir = root / "Memory" / "03_chat_logs"

    goal_version = find_latest_version(goal_dir, r"goal_v(\d{3})_\d{8}\.md")
    if goal_version is None:
        goal_version = "001"
    previous_version = f"v{int(goal_version) - 1:03d}" if int(goal_version) > 1 else "none"

    todo_version = find_latest_todo_version(todo_dir, goal_version)
    if todo_version is None:
        todo_version = "001"

    goal_path = find_latest_goal_file(goal_dir) or goal_dir / f"goal_v{goal_version}_{date_token}.md"
    todo_path = (
        find_latest_todo_file(todo_dir, goal_version)
        or todo_dir / f"todo_v{goal_version}_{todo_version}_{date_token}.md"
    )
    chat_path = find_latest_chat_log_file(chat_dir) or chat_dir / chat_filename

    return ScaffoldPaths(
        root=root,
        goal_dir=goal_dir,
        todo_dir=todo_dir,
        chat_dir=chat_dir,
        goal_path=goal_path,
        todo_path=todo_path,
        chat_path=chat_path,
        goal_version=goal_version,
        todo_version=todo_version,
        previous_version=previous_version,
        date_label=date_label,
        time_label=time_label,
    )


def create_memory_dirs(root: Path) -> list[str]:
    created: list[str] = []
    for rel in DIRS:
        path = root / rel
        if not path.exists():
            created.append(path.relative_to(root).as_posix())
        path.mkdir(parents=True, exist_ok=True)
    return created


def scaffold_content_files(
    paths: ScaffoldPaths,
    templates: Path,
    goal_summary: str,
    project_name: str,
    force: bool,
) -> tuple[list[str], list[str]]:
    created: list[str] = []
    preserved: list[str] = []
    pairs = [
        (
            templates / "goal.md",
            paths.goal_path,
            {
                "GOAL_VERSION": paths.goal_version,
                "DATE": paths.date_label,
                "PREVIOUS_VERSION": paths.previous_version,
                "GOAL_SUMMARY": goal_summary.strip(),
            },
        ),
        (
            templates / "todo.md",
            paths.todo_path,
            {
                "GOAL_VERSION": paths.goal_version,
                "TODO_SUBVERSION": paths.todo_version,
                "DATE": paths.date_label,
            },
        ),
        (
            templates / "chat-log.md",
            paths.chat_path,
            {
                "DATE": paths.date_label,
                "TIME": paths.time_label,
                "PROJECT_NAME": project_name.strip(),
            },
        ),
    ]
    for template_path, target_path, values in pairs:
        if write_template(template_path, target_path, force, values):
            created.append(target_path.relative_to(paths.root).as_posix())
        else:
            preserved.append(target_path.relative_to(paths.root).as_posix())
    return created, preserved
