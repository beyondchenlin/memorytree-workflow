from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location("upgrade_memorytree", str(SCRIPTS_DIR / "upgrade-memorytree.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

extract_goal_version = _mod.extract_goal_version
has_active_todo_rule = _mod.has_active_todo_rule
has_append_only_chat_log_rule = _mod.has_append_only_chat_log_rule
has_auto_merge_rule = _mod.has_auto_merge_rule
has_commit_title_rule = _mod.has_commit_title_rule
has_dedicated_memorytree_pr_flow = _mod.has_dedicated_memorytree_pr_flow
has_memory_layout_signal = _mod.has_memory_layout_signal
has_memorytree_only_scope_rule = _mod.has_memorytree_only_scope_rule
has_read_order_signal = _mod.has_read_order_signal
has_repo_safety_rule = _mod.has_repo_safety_rule
needs_agents_merge = _mod.needs_agents_merge


FULL_EN_AGENTS = """\
# AGENTS.md

## Read Order
- Read this file first.
- Read the latest file in `Memory/01_goals/`.
- Read the latest todo bound to that goal in `Memory/02_todos/`.
- Read `Memory/04_knowledge/` only when needed.
- Read `Memory/03_chat_logs/` and `Memory/05_archive/` only when needed.

## Memory Rules
- Keep the active todo synchronized with the active goal.
- Append chat logs only. Never rewrite or delete prior entries.

## Git Rules
- Obey this repository's branch, PR, CI, review, and release rules.
- Auto-commit and push only MemoryTree-owned changes.
- Use a MemoryTree-scoped commit title: `memorytree(<scope>): <subject>`.
- Use a dedicated branch and PR for MemoryTree-only changes. Enable auto-merge only when repository rules permit it.
- If a diff includes product code, stop and ask the user.
"""

FULL_ZH_AGENTS = """\
# AGENTS.md

## 读取顺序
- 先读本文件。
- 读取 `Memory/01_goals/` 中最新的目标文件。
- 读取与该目标绑定的 `Memory/02_todos/` 最新待办文件。
- 仅在需要时读取 `Memory/03_chat_logs/`。

## 记忆规则
- 当前待办必须与当前目标保持同步。
- 对话日志只追加，禁止重写或删除既有内容。

## Git 规则
- 遵守当前仓库的分支、PR、CI、评审和发布规则。
- 仅自动提交和推送 MemoryTree 自有变更。
- 提交标题使用 memorytree(<scope>): <subject>。
- 对 MemoryTree 专用变更使用专用分支和 PR；仅在仓库规则允许时才开启自动合并。
"""


class ExtractGoalVersionTests(unittest.TestCase):
    def test_none_path(self) -> None:
        self.assertIsNone(extract_goal_version(None))

    def test_valid_goal_file(self) -> None:
        self.assertEqual(extract_goal_version(Path("goal_v003_20260314.md")), "003")

    def test_invalid_name(self) -> None:
        self.assertIsNone(extract_goal_version(Path("random_file.md")))


class HasReadOrderSignalTests(unittest.TestCase):
    def test_english(self) -> None:
        self.assertTrue(has_read_order_signal("## read order"))

    def test_chinese(self) -> None:
        self.assertTrue(has_read_order_signal("## \u8bfb\u53d6\u987a\u5e8f"))

    def test_missing(self) -> None:
        self.assertFalse(has_read_order_signal("no relevant content here"))


class HasMemoryLayoutSignalTests(unittest.TestCase):
    def test_all_three_dirs(self) -> None:
        text = "memory/01_goals memory/02_todos memory/03_chat_logs"
        self.assertTrue(has_memory_layout_signal(text))

    def test_missing_one_dir(self) -> None:
        text = "memory/01_goals memory/02_todos"
        self.assertFalse(has_memory_layout_signal(text))


class HasActiveTodoRuleTests(unittest.TestCase):
    def test_english_sync(self) -> None:
        self.assertTrue(has_active_todo_rule("keep the active todo synchronized with the active goal"))

    def test_chinese_sync(self) -> None:
        self.assertTrue(has_active_todo_rule("\u5f53\u524d\u5f85\u529e\u5fc5\u987b\u4e0e\u5f53\u524d\u76ee\u6807\u4fdd\u6301\u540c\u6b65"))

    def test_missing(self) -> None:
        self.assertFalse(has_active_todo_rule("update your tasks regularly"))


class HasAppendOnlyChatLogRuleTests(unittest.TestCase):
    def test_english(self) -> None:
        self.assertTrue(has_append_only_chat_log_rule("never rewrite or delete prior entries"))

    def test_chinese(self) -> None:
        self.assertTrue(has_append_only_chat_log_rule("\u7981\u6b62\u91cd\u5199\u6216\u5220\u9664\u65e2\u6709\u5185\u5bb9"))


class HasCommitTitleRuleTests(unittest.TestCase):
    def test_conventional_format(self) -> None:
        self.assertTrue(has_commit_title_rule("memorytree(agents): update"))

    def test_docs_format(self) -> None:
        self.assertTrue(has_commit_title_rule("docs(memorytree): sync"))

    def test_scoped_title_text(self) -> None:
        self.assertTrue(has_commit_title_rule("use a memorytree-scoped commit title"))


class HasDedicatedPrFlowTests(unittest.TestCase):
    def test_english(self) -> None:
        self.assertTrue(has_dedicated_memorytree_pr_flow(
            "use a dedicated branch and pr for memorytree-only changes"
        ))

    def test_missing_memorytree(self) -> None:
        self.assertFalse(has_dedicated_memorytree_pr_flow(
            "use a dedicated branch and pr for documentation changes"
        ))


class HasMemoTreeOnlyScopeRuleTests(unittest.TestCase):
    def test_owned_changes(self) -> None:
        self.assertTrue(has_memorytree_only_scope_rule("commit only memorytree-owned changes"))

    def test_owned_files(self) -> None:
        self.assertTrue(has_memorytree_only_scope_rule("push only memorytree-owned files"))


class HasAutoMergeRuleTests(unittest.TestCase):
    def test_english(self) -> None:
        self.assertTrue(has_auto_merge_rule("only when repository rules permit"))

    def test_chinese(self) -> None:
        self.assertTrue(has_auto_merge_rule("\u4ec5\u5728\u4ed3\u5e93\u89c4\u5219\u5141\u8bb8\u65f6\u624d\u5f00\u542f\u81ea\u52a8\u5408\u5e76"))


class HasRepoSafetyRuleTests(unittest.TestCase):
    def test_full_english(self) -> None:
        text = "obey this repository's branch, pr, ci, review, and release rules"
        self.assertTrue(has_repo_safety_rule(text))

    def test_missing_review(self) -> None:
        text = "obey this repository's branch, pr, and ci rules"
        self.assertFalse(has_repo_safety_rule(text))


class NeedsAgentsMergeTests(unittest.TestCase):
    def test_complete_english_agents_does_not_need_merge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "AGENTS.md"
            path.write_text(FULL_EN_AGENTS, encoding="utf-8")
            self.assertFalse(needs_agents_merge(path))

    def test_complete_chinese_agents_does_not_need_merge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "AGENTS.md"
            path.write_text(FULL_ZH_AGENTS, encoding="utf-8")
            self.assertFalse(needs_agents_merge(path))

    def test_empty_agents_needs_merge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "AGENTS.md"
            path.write_text("# AGENTS.md\n\nBasic agent instructions.\n", encoding="utf-8")
            self.assertTrue(needs_agents_merge(path))

    def test_nonexistent_file_needs_merge(self) -> None:
        self.assertTrue(needs_agents_merge(Path("/nonexistent/AGENTS.md")))

    def test_generated_en_template(self) -> None:
        template_path = Path(__file__).resolve().parents[1] / "assets" / "templates" / "en" / "agents.md"
        if template_path.exists():
            self.assertFalse(needs_agents_merge(template_path))

    def test_generated_zh_template(self) -> None:
        template_path = Path(__file__).resolve().parents[1] / "assets" / "templates" / "zh-cn" / "agents.md"
        if template_path.exists():
            self.assertFalse(needs_agents_merge(template_path))


if __name__ == "__main__":
    unittest.main()
