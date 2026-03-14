from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from _scaffold_utils import (  # noqa: E402
    ScaffoldPaths,
    build_datetime,
    create_memory_dirs,
    find_external_policy_sources,
    find_latest_chat_log_file,
    find_latest_goal_file,
    find_latest_todo_file,
    find_latest_todo_version,
    find_latest_version,
    resolve_scaffold_paths,
    scaffold_content_files,
    write_template,
)


class FindExternalPolicySourcesTests(unittest.TestCase):
    def test_detects_policy_bearing_github_contributing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / ".github" / "CONTRIBUTING.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Pull request rules: open a PR before merge.", encoding="utf-8")

            self.assertEqual(find_external_policy_sources(root), [".github/CONTRIBUTING.md"])

    def test_ignores_generic_contributing_without_policy_terms(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "docs" / "CONTRIBUTING.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Thanks for contributing. Please be kind and ask questions.", encoding="utf-8")

            self.assertEqual(find_external_policy_sources(root), [])

    def test_detects_codeowners(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "CODEOWNERS"
            path.write_text("* @team-lead", encoding="utf-8")
            self.assertIn("CODEOWNERS", find_external_policy_sources(root))

    def test_detects_commitlintrc(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / ".commitlintrc.json"
            path.write_text('{"extends": ["@commitlint/config-conventional"]}', encoding="utf-8")
            self.assertIn(".commitlintrc.json", find_external_policy_sources(root))

    def test_empty_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(find_external_policy_sources(Path(tmp)), [])


class BuildDatetimeTests(unittest.TestCase):
    def test_both_date_and_time(self) -> None:
        result = build_datetime("2026-03-14", "09:30")
        self.assertEqual(result, datetime(2026, 3, 14, 9, 30))

    def test_date_only(self) -> None:
        result = build_datetime("2026-03-14", "")
        self.assertEqual(result, datetime(2026, 3, 14, 0, 0))

    def test_time_only(self) -> None:
        result = build_datetime("", "14:30")
        self.assertEqual(result.hour, 14)
        self.assertEqual(result.minute, 30)

    def test_neither_returns_now(self) -> None:
        before = datetime.now()
        result = build_datetime("", "")
        after = datetime.now()
        self.assertGreaterEqual(result, before)
        self.assertLessEqual(result, after)


class WriteTemplateTests(unittest.TestCase):
    def test_basic_substitution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            template = Path(tmp) / "template.md"
            target = Path(tmp) / "output.md"
            template.write_text("Hello {{NAME}}, date: {{DATE}}", encoding="utf-8")

            result = write_template(template, target, False, {"NAME": "World", "DATE": "2026-03-14"})
            self.assertTrue(result)
            self.assertEqual(target.read_text(encoding="utf-8"), "Hello World, date: 2026-03-14")

    def test_skip_existing_file_without_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            template = Path(tmp) / "template.md"
            target = Path(tmp) / "output.md"
            template.write_text("new content", encoding="utf-8")
            target.write_text("existing content", encoding="utf-8")

            result = write_template(template, target, False, {})
            self.assertFalse(result)
            self.assertEqual(target.read_text(encoding="utf-8"), "existing content")

    def test_overwrite_with_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            template = Path(tmp) / "template.md"
            target = Path(tmp) / "output.md"
            template.write_text("new content", encoding="utf-8")
            target.write_text("existing content", encoding="utf-8")

            result = write_template(template, target, True, {})
            self.assertTrue(result)
            self.assertEqual(target.read_text(encoding="utf-8"), "new content")

    def test_empty_values_dict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            template = Path(tmp) / "template.md"
            target = Path(tmp) / "output.md"
            template.write_text("No placeholders here.", encoding="utf-8")

            write_template(template, target, False, {})
            self.assertEqual(target.read_text(encoding="utf-8"), "No placeholders here.")


class FindLatestVersionTests(unittest.TestCase):
    def test_no_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(find_latest_version(Path(tmp), r"goal_v(\d{3})_\d{8}\.md"))

    def test_single_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "goal_v001_20260314.md").write_text("", encoding="utf-8")
            self.assertEqual(find_latest_version(folder, r"goal_v(\d{3})_\d{8}\.md"), "001")

    def test_multiple_versions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "goal_v001_20260301.md").write_text("", encoding="utf-8")
            (folder / "goal_v003_20260314.md").write_text("", encoding="utf-8")
            (folder / "goal_v002_20260310.md").write_text("", encoding="utf-8")
            self.assertEqual(find_latest_version(folder, r"goal_v(\d{3})_\d{8}\.md"), "003")

    def test_nonexistent_folder(self) -> None:
        self.assertIsNone(find_latest_version(Path("/nonexistent"), r"goal_v(\d{3})_\d{8}\.md"))


class FindLatestGoalFileTests(unittest.TestCase):
    def test_picks_highest_version_then_date(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            p1 = folder / "goal_v001_20260301.md"
            p2 = folder / "goal_v002_20260314.md"
            p1.write_text("", encoding="utf-8")
            p2.write_text("", encoding="utf-8")
            self.assertEqual(find_latest_goal_file(folder), p2)

    def test_empty_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(find_latest_goal_file(Path(tmp)))


class FindLatestTodoVersionTests(unittest.TestCase):
    def test_finds_version_for_goal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "todo_v001_001_20260314.md").write_text("", encoding="utf-8")
            (folder / "todo_v001_002_20260314.md").write_text("", encoding="utf-8")
            self.assertEqual(find_latest_todo_version(folder, "001"), "002")

    def test_no_matching_goal_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "todo_v001_001_20260314.md").write_text("", encoding="utf-8")
            self.assertIsNone(find_latest_todo_version(folder, "002"))


class FindLatestTodoFileTests(unittest.TestCase):
    def test_picks_latest_subversion(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            p1 = folder / "todo_v001_001_20260301.md"
            p2 = folder / "todo_v001_003_20260314.md"
            p1.write_text("", encoding="utf-8")
            p2.write_text("", encoding="utf-8")
            self.assertEqual(find_latest_todo_file(folder, "001"), p2)


class FindLatestChatLogFileTests(unittest.TestCase):
    def test_picks_latest_by_date_and_time(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            p1 = folder / "2026-03-14_09-00.md"
            p2 = folder / "2026-03-14_14-30.md"
            p1.write_text("", encoding="utf-8")
            p2.write_text("", encoding="utf-8")
            self.assertEqual(find_latest_chat_log_file(folder), p2)

    def test_empty_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(find_latest_chat_log_file(Path(tmp)))


class CreateMemoryDirsTests(unittest.TestCase):
    def test_creates_all_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            created = create_memory_dirs(root)
            self.assertEqual(len(created), 5)
            for rel in created:
                self.assertTrue((root / rel).is_dir())

    def test_existing_dirs_not_in_created(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Memory" / "01_goals").mkdir(parents=True)
            created = create_memory_dirs(root)
            self.assertNotIn("Memory/01_goals", created)
            self.assertEqual(len(created), 4)


class ResolveScaffoldPathsTests(unittest.TestCase):
    def test_fresh_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Memory" / "01_goals").mkdir(parents=True)
            (root / "Memory" / "02_todos").mkdir(parents=True)
            (root / "Memory" / "03_chat_logs").mkdir(parents=True)
            dt = datetime(2026, 3, 14, 9, 30)
            paths = resolve_scaffold_paths(root, dt)

            self.assertEqual(paths.goal_version, "001")
            self.assertEqual(paths.todo_version, "001")
            self.assertEqual(paths.previous_version, "none")
            self.assertEqual(paths.date_label, "2026-03-14")
            self.assertEqual(paths.time_label, "09:30")
            self.assertIn("goal_v001_20260314.md", paths.goal_path.name)
            self.assertIn("todo_v001_001_20260314.md", paths.todo_path.name)
            self.assertIn("2026-03-14_09-30.md", paths.chat_path.name)

    def test_existing_goal_reused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            goal_dir = root / "Memory" / "01_goals"
            goal_dir.mkdir(parents=True)
            (root / "Memory" / "02_todos").mkdir(parents=True)
            (root / "Memory" / "03_chat_logs").mkdir(parents=True)
            existing = goal_dir / "goal_v002_20260310.md"
            existing.write_text("existing", encoding="utf-8")

            dt = datetime(2026, 3, 14, 10, 0)
            paths = resolve_scaffold_paths(root, dt)

            self.assertEqual(paths.goal_version, "002")
            self.assertEqual(paths.previous_version, "v001")
            self.assertEqual(paths.goal_path, existing)


class ScaffoldContentFilesTests(unittest.TestCase):
    def test_creates_all_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_memory_dirs(root)
            dt = datetime(2026, 3, 14, 9, 30)
            paths = resolve_scaffold_paths(root, dt)

            skill_root = Path(__file__).resolve().parents[1]
            templates = skill_root / "assets" / "templates" / "en"

            created, preserved = scaffold_content_files(
                paths, templates, "Test goal", "test-project", force=False,
            )

            self.assertEqual(len(created), 3)
            self.assertEqual(len(preserved), 0)
            for rel in created:
                self.assertTrue((root / rel).is_file())

    def test_preserves_existing_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_memory_dirs(root)
            dt = datetime(2026, 3, 14, 9, 30)
            paths = resolve_scaffold_paths(root, dt)

            skill_root = Path(__file__).resolve().parents[1]
            templates = skill_root / "assets" / "templates" / "en"

            # First run creates files
            scaffold_content_files(paths, templates, "Test goal", "test-project", force=False)

            # Second run preserves them
            paths2 = resolve_scaffold_paths(root, dt)
            created, preserved = scaffold_content_files(
                paths2, templates, "Different goal", "test-project", force=False,
            )

            self.assertEqual(len(created), 0)
            self.assertEqual(len(preserved), 3)

    def test_goal_content_has_substituted_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_memory_dirs(root)
            dt = datetime(2026, 3, 14, 9, 30)
            paths = resolve_scaffold_paths(root, dt)

            skill_root = Path(__file__).resolve().parents[1]
            templates = skill_root / "assets" / "templates" / "en"

            scaffold_content_files(paths, templates, "Build the memory system", "test-project", force=False)

            content = paths.goal_path.read_text(encoding="utf-8")
            self.assertIn("Build the memory system", content)
            self.assertIn("2026-03-14", content)
            self.assertNotIn("{{GOAL_SUMMARY}}", content)
            self.assertNotIn("{{DATE}}", content)


if __name__ == "__main__":
    unittest.main()
