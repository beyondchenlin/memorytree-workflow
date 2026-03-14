from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from _locale_utils import detect_repo_locale, detect_system_locale, normalize_locale  # noqa: E402


class NormalizeLocaleTests(unittest.TestCase):
    def test_explicit_en(self) -> None:
        self.assertEqual(normalize_locale("en"), "en")

    def test_explicit_zh_cn(self) -> None:
        self.assertEqual(normalize_locale("zh-cn"), "zh-cn")

    def test_alias_en_us(self) -> None:
        self.assertEqual(normalize_locale("en-us"), "en")

    def test_alias_en_gb(self) -> None:
        self.assertEqual(normalize_locale("en-gb"), "en")

    def test_alias_zh(self) -> None:
        self.assertEqual(normalize_locale("zh"), "zh-cn")

    def test_alias_zh_hant(self) -> None:
        self.assertEqual(normalize_locale("zh-hant"), "zh-cn")

    def test_alias_zh_tw(self) -> None:
        self.assertEqual(normalize_locale("zh-tw"), "zh-cn")

    def test_alias_zh_sg(self) -> None:
        self.assertEqual(normalize_locale("zh-sg"), "zh-cn")

    def test_case_insensitive(self) -> None:
        self.assertEqual(normalize_locale("EN"), "en")
        self.assertEqual(normalize_locale("ZH-CN"), "zh-cn")

    def test_empty_falls_back_to_system(self) -> None:
        result = normalize_locale("")
        self.assertIn(result, ("en", "zh-cn"))

    def test_auto_falls_back(self) -> None:
        result = normalize_locale("auto")
        self.assertIn(result, ("en", "zh-cn"))

    def test_unknown_locale_returned_as_is(self) -> None:
        self.assertEqual(normalize_locale("fr"), "fr")
        self.assertEqual(normalize_locale("ja"), "ja")


class DetectRepoLocaleTests(unittest.TestCase):
    def test_none_root_returns_none(self) -> None:
        self.assertIsNone(detect_repo_locale(None))

    def test_nonexistent_root_returns_none(self) -> None:
        self.assertIsNone(detect_repo_locale(Path("/nonexistent/path/12345")))

    def test_english_readme(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_text(
                "This is a project README with enough English text to trigger detection.",
                encoding="utf-8",
            )
            result = detect_repo_locale(root)
            self.assertEqual(result, "en")

    def test_chinese_readme(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_text(
                "这是一个项目的自述文件，包含足够多的中文文字来触发中文语言检测。"
                "项目目标是构建一个完整的记忆管理系统。",
                encoding="utf-8",
            )
            result = detect_repo_locale(root)
            self.assertEqual(result, "zh-cn")

    def test_empty_directory_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = detect_repo_locale(Path(tmp))
            self.assertIsNone(result)

    def test_zh_cn_filename_boosts_score(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.zh-CN.md").write_text(
                "简体中文说明文档。",
                encoding="utf-8",
            )
            result = detect_repo_locale(root)
            self.assertEqual(result, "zh-cn")


class DetectSystemLocaleTests(unittest.TestCase):
    def test_returns_string(self) -> None:
        result = detect_system_locale()
        self.assertIsInstance(result, str)
        self.assertIn(result, ("en", "zh-cn"))


if __name__ == "__main__":
    unittest.main()
