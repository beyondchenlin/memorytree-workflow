from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from _transcript_utils import (  # noqa: E402
    ParsedTranscript,
    TranscriptMessage,
    TranscriptToolEvent,
    earliest_timestamp,
    import_transcript,
    infer_client,
    infer_project_slug,
    join_paragraphs,
    load_jsonl,
    normalize_timestamp,
    parse_claude_transcript,
    parse_codex_transcript,
    parse_gemini_transcript,
    preserve_existing_import_timestamp,
    slugify,
    summarize_value,
    timestamp_partition,
    transcript_has_content,
    transcript_matches_repo,
    yaml_escape,
)


def make_transcript(
    *, cwd: str = "", source_path: str = "C:/Users/ai/.claude/projects/demo-repo/session.jsonl",
) -> ParsedTranscript:
    return ParsedTranscript(
        client="claude",
        session_id="session-1",
        title="demo",
        started_at="2026-03-14T00:00:00Z",
        cwd=cwd,
        branch="main",
        messages=[],
        tool_events=[],
        source_path=Path(source_path),
    )


class TranscriptMatchesRepoTests(unittest.TestCase):
    def test_matches_exact_repo_cwd(self) -> None:
        parsed = make_transcript(cwd="D:/work/demo-repo")
        self.assertTrue(transcript_matches_repo(parsed, Path("D:/work/demo-repo"), "demo-repo"))

    def test_matches_child_directory_cwd(self) -> None:
        parsed = make_transcript(cwd="D:/work/demo-repo/packages/api")
        self.assertTrue(transcript_matches_repo(parsed, Path("D:/work/demo-repo"), "demo-repo"))

    def test_rejects_parent_directory_cwd(self) -> None:
        parsed = make_transcript(cwd="D:/work")
        self.assertFalse(transcript_matches_repo(parsed, Path("D:/work/demo-repo"), "demo-repo"))

    def test_matches_exact_project_slug_without_cwd(self) -> None:
        parsed = make_transcript(cwd="", source_path="C:/Users/ai/.claude/projects/demo-repo/session.jsonl")
        self.assertTrue(transcript_matches_repo(parsed, Path("D:/work/demo-repo"), "demo-repo"))

    def test_rejects_prefix_suffix_slug_match_without_cwd(self) -> None:
        parsed = make_transcript(cwd="", source_path="C:/Users/ai/.claude/projects/acme-backend/session.jsonl")
        self.assertFalse(transcript_matches_repo(parsed, Path("D:/work/backend"), "backend"))


class SlugifyTests(unittest.TestCase):
    def test_simple_name(self) -> None:
        self.assertEqual(slugify("demo-repo"), "demo-repo")

    def test_spaces_converted(self) -> None:
        self.assertEqual(slugify("My Project Name"), "my-project-name")

    def test_special_chars_stripped(self) -> None:
        self.assertEqual(slugify("project@v2!"), "project-v2")

    def test_empty_returns_fallback(self) -> None:
        self.assertEqual(slugify("", fallback="default"), "default")

    def test_all_non_ascii_returns_fallback(self) -> None:
        self.assertEqual(slugify("\u4e2d\u6587\u9879\u76ee", fallback="project"), "project")

    def test_mixed_ascii_non_ascii(self) -> None:
        result = slugify("my-\u9879\u76ee-v2")
        self.assertEqual(result, "my--v2")

    def test_leading_trailing_dots_stripped(self) -> None:
        self.assertEqual(slugify("..hello.."), "hello")


class NormalizeTimestampTests(unittest.TestCase):
    def test_unix_float(self) -> None:
        result = normalize_timestamp(1710374400.0)
        self.assertIn("2024-03-1", result)
        self.assertTrue(result.endswith("Z"))

    def test_unix_int(self) -> None:
        result = normalize_timestamp(1710374400)
        self.assertTrue(result.endswith("Z"))

    def test_iso_string(self) -> None:
        result = normalize_timestamp("2026-03-14T09:30:00Z")
        self.assertEqual(result, "2026-03-14T09:30:00Z")

    def test_iso_with_offset(self) -> None:
        result = normalize_timestamp("2026-03-14T09:30:00+08:00")
        self.assertEqual(result, "2026-03-14T01:30:00Z")

    def test_empty_string_uses_fallback(self) -> None:
        result = normalize_timestamp("", "2026-01-01T00:00:00Z")
        self.assertEqual(result, "2026-01-01T00:00:00Z")

    def test_none_uses_fallback(self) -> None:
        result = normalize_timestamp(None, "2026-01-01T00:00:00Z")
        self.assertEqual(result, "2026-01-01T00:00:00Z")

    def test_unparseable_string_returned_as_is(self) -> None:
        result = normalize_timestamp("not-a-date")
        self.assertEqual(result, "not-a-date")


class EarliestTimestampTests(unittest.TestCase):
    def test_earlier_candidate_wins(self) -> None:
        result = earliest_timestamp("2026-03-14T10:00:00Z", "2026-03-14T08:00:00Z")
        self.assertEqual(result, "2026-03-14T08:00:00Z")

    def test_later_candidate_loses(self) -> None:
        result = earliest_timestamp("2026-03-14T08:00:00Z", "2026-03-14T10:00:00Z")
        self.assertEqual(result, "2026-03-14T08:00:00Z")

    def test_none_candidate_keeps_current(self) -> None:
        result = earliest_timestamp("2026-03-14T08:00:00Z", None)
        self.assertEqual(result, "2026-03-14T08:00:00Z")


class TimestampPartitionTests(unittest.TestCase):
    def test_valid_timestamp(self) -> None:
        self.assertEqual(timestamp_partition("2026-03-14T09:30:00Z"), ("2026", "03"))

    def test_invalid_timestamp(self) -> None:
        self.assertEqual(timestamp_partition("invalid"), ("unknown", "unknown"))


class JoinParagraphsTests(unittest.TestCase):
    def test_joins_with_double_newline(self) -> None:
        self.assertEqual(join_paragraphs(["Hello", "World"]), "Hello\n\nWorld")

    def test_strips_whitespace(self) -> None:
        self.assertEqual(join_paragraphs(["  Hello  ", "  World  "]), "Hello\n\nWorld")

    def test_skips_empty(self) -> None:
        self.assertEqual(join_paragraphs(["Hello", "", "  ", "World"]), "Hello\n\nWorld")


class SummarizeValueTests(unittest.TestCase):
    def test_none(self) -> None:
        self.assertEqual(summarize_value(None), "none")

    def test_short_string(self) -> None:
        self.assertEqual(summarize_value("hello"), "hello")

    def test_long_string_truncated(self) -> None:
        result = summarize_value("x" * 200, limit=10)
        self.assertEqual(len(result), 10)
        self.assertTrue(result.endswith("..."))

    def test_dict_serialized(self) -> None:
        result = summarize_value({"key": "value"})
        self.assertIn("key", result)


class YamlEscapeTests(unittest.TestCase):
    def test_simple(self) -> None:
        self.assertEqual(yaml_escape("hello"), '"hello"')

    def test_quotes(self) -> None:
        self.assertEqual(yaml_escape('say "hi"'), '"say \\"hi\\""')

    def test_newline(self) -> None:
        self.assertEqual(yaml_escape("line1\nline2"), '"line1\\nline2"')

    def test_backslash(self) -> None:
        self.assertEqual(yaml_escape("C:\\path"), '"C:\\\\path"')


class InferClientTests(unittest.TestCase):
    def test_explicit_client(self) -> None:
        self.assertEqual(infer_client("codex", Path("any/path")), "codex")

    def test_codex_from_path(self) -> None:
        self.assertEqual(infer_client("auto", Path("/home/user/.codex/sessions/file.jsonl")), "codex")

    def test_claude_from_path(self) -> None:
        self.assertEqual(infer_client("auto", Path("/home/user/.claude/projects/test/file.jsonl")), "claude")

    def test_gemini_from_path(self) -> None:
        self.assertEqual(infer_client("auto", Path("/home/user/.gemini/tmp/checkpoint.json")), "gemini")


class InferProjectSlugTests(unittest.TestCase):
    def test_from_cwd(self) -> None:
        parsed = make_transcript(cwd="D:/work/my-project")
        self.assertEqual(infer_project_slug(parsed), "my-project")

    def test_from_claude_source_path(self) -> None:
        parsed = make_transcript(cwd="", source_path="C:/Users/ai/.claude/projects/demo-repo/session.jsonl")
        self.assertEqual(infer_project_slug(parsed), "demo-repo")


class TranscriptHasContentTests(unittest.TestCase):
    def test_no_content(self) -> None:
        parsed = make_transcript()
        self.assertFalse(transcript_has_content(parsed))

    def test_has_messages(self) -> None:
        parsed = make_transcript()
        parsed.messages.append(TranscriptMessage(role="user", text="hello"))
        self.assertTrue(transcript_has_content(parsed))

    def test_has_tool_events(self) -> None:
        parsed = make_transcript()
        parsed.tool_events.append(TranscriptToolEvent(summary="read file"))
        self.assertTrue(transcript_has_content(parsed))


class LoadJsonlTests(unittest.TestCase):
    def test_valid_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.jsonl"
            path.write_text('{"a": 1}\n{"b": 2}\n', encoding="utf-8")
            result = load_jsonl(path)
            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["a"], 1)

    def test_skips_malformed_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.jsonl"
            path.write_text('{"a": 1}\nNOT JSON\n{"b": 2}\n', encoding="utf-8")
            result = load_jsonl(path)
            self.assertEqual(len(result), 2)

    def test_skips_empty_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.jsonl"
            path.write_text('{"a": 1}\n\n\n{"b": 2}\n', encoding="utf-8")
            result = load_jsonl(path)
            self.assertEqual(len(result), 2)


class ParseCodexTranscriptTests(unittest.TestCase):
    def test_basic_codex_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.jsonl"
            records = [
                {"type": "session_meta", "payload": {"id": "sess-1", "thread_name": "Test Session", "cwd": "/work/repo", "git": {"branch": "main"}}},
                {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hello"}]}},
                {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Hi there"}]}},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_codex_transcript(path)
            self.assertEqual(parsed.client, "codex")
            self.assertEqual(parsed.session_id, "sess-1")
            self.assertEqual(parsed.title, "Test Session")
            self.assertEqual(parsed.cwd, "/work/repo")
            self.assertEqual(parsed.branch, "main")
            self.assertEqual(len(parsed.messages), 2)
            self.assertEqual(parsed.messages[0].role, "user")
            self.assertEqual(parsed.messages[0].text, "Hello")

    def test_tool_call_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.jsonl"
            records = [
                {"type": "response_item", "payload": {"type": "function_call", "name": "read_file", "arguments": "/path/to/file"}},
                {"type": "response_item", "payload": {"type": "function_call_output", "name": "read_file", "output": "file contents"}},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_codex_transcript(path)
            self.assertEqual(len(parsed.tool_events), 2)
            self.assertIn("read_file", parsed.tool_events[0].summary)


class ParseClaudeTranscriptTests(unittest.TestCase):
    def test_basic_claude_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.jsonl"
            records = [
                {"type": "user", "sessionId": "sess-claude-1", "cwd": "/work/project", "gitBranch": "feature",
                 "message": {"role": "user", "content": "What is this?"}},
                {"type": "assistant", "sessionId": "sess-claude-1",
                 "message": {"role": "assistant", "content": [{"type": "text", "text": "This is a project."}]}},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_claude_transcript(path)
            self.assertEqual(parsed.client, "claude")
            self.assertEqual(parsed.session_id, "sess-claude-1")
            self.assertEqual(parsed.cwd, "/work/project")
            self.assertEqual(parsed.branch, "feature")
            self.assertEqual(len(parsed.messages), 2)

    def test_tool_use_extracted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.jsonl"
            records = [
                {"type": "assistant", "message": {"role": "assistant", "content": [
                    {"type": "tool_use", "name": "Read", "input": {"path": "/a.txt"}},
                ]}},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_claude_transcript(path)
            self.assertEqual(len(parsed.tool_events), 1)
            self.assertIn("Read", parsed.tool_events[0].summary)


class ParseGeminiTranscriptTests(unittest.TestCase):
    def test_basic_gemini_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chat.json"
            data = [
                {"role": "user", "text": "Hello from Gemini", "timestamp": "2026-03-14T10:00:00Z"},
                {"role": "model", "text": "Hello! How can I help?", "timestamp": "2026-03-14T10:00:01Z"},
            ]
            path.write_text(json.dumps(data), encoding="utf-8")

            parsed = parse_gemini_transcript(path)
            self.assertEqual(parsed.client, "gemini")
            self.assertEqual(len(parsed.messages), 2)
            self.assertEqual(parsed.messages[0].role, "user")
            self.assertEqual(parsed.messages[1].role, "assistant")

    def test_gemini_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chat.jsonl"
            records = [
                {"role": "user", "text": "Question"},
                {"role": "model", "text": "Answer"},
            ]
            path.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_gemini_transcript(path)
            self.assertEqual(len(parsed.messages), 2)


class PreserveExistingImportTimestampTests(unittest.TestCase):
    def test_none_existing_returns_payload(self) -> None:
        payload = {"session_id": "s1", "imported_at": "2026-03-14T10:00:00Z"}
        result = preserve_existing_import_timestamp(None, payload)
        self.assertEqual(result, payload)

    def test_preserves_old_imported_at_when_signature_matches(self) -> None:
        existing = {"session_id": "s1", "imported_at": "2026-03-01T00:00:00Z", "raw_sha256": "abc"}
        payload = {"session_id": "s1", "imported_at": "2026-03-14T10:00:00Z", "raw_sha256": "abc"}
        result = preserve_existing_import_timestamp(existing, payload)
        self.assertEqual(result["imported_at"], "2026-03-01T00:00:00Z")

    def test_uses_new_imported_at_when_signature_differs(self) -> None:
        existing = {"session_id": "s1", "imported_at": "2026-03-01T00:00:00Z", "raw_sha256": "abc"}
        payload = {"session_id": "s1", "imported_at": "2026-03-14T10:00:00Z", "raw_sha256": "def"}
        result = preserve_existing_import_timestamp(existing, payload)
        self.assertEqual(result["imported_at"], "2026-03-14T10:00:00Z")


class ImportTranscriptTests(unittest.TestCase):
    def test_full_import_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            global_root = Path(tmp) / "global"
            root.mkdir()
            global_root.mkdir()

            source = Path(tmp) / "source.jsonl"
            records = [
                {"type": "user", "sessionId": "sess-1", "cwd": str(root),
                 "message": {"role": "user", "content": "Test message"}},
                {"type": "assistant", "sessionId": "sess-1",
                 "message": {"role": "assistant", "content": "Response"}},
            ]
            source.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_claude_transcript(source)
            result = import_transcript(
                parsed=parsed,
                root=root,
                global_root=global_root,
                project_slug="test-project",
                raw_upload_permission="not-set",
                mirror_to_repo=True,
            )

            self.assertEqual(result["client"], "claude")
            self.assertEqual(result["project"], "test-project")
            self.assertEqual(result["message_count"], 2)
            self.assertTrue(Path(result["global_raw_path"]).exists())
            self.assertTrue(Path(result["global_clean_path"]).exists())
            self.assertTrue((root / result["repo_raw_path"]).exists())
            self.assertTrue((root / result["repo_clean_path"]).exists())

    def test_global_only_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            global_root = Path(tmp) / "global"
            root.mkdir()
            global_root.mkdir()

            source = Path(tmp) / "source.jsonl"
            records = [
                {"type": "user", "message": {"role": "user", "content": "Test"}},
            ]
            source.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_claude_transcript(source)
            result = import_transcript(
                parsed=parsed,
                root=root,
                global_root=global_root,
                project_slug="other-project",
                raw_upload_permission="not-applicable",
                mirror_to_repo=False,
            )

            self.assertFalse(result["repo_mirror_enabled"])
            self.assertTrue(Path(result["global_raw_path"]).exists())
            self.assertEqual(result["repo_raw_path"], "")

    def test_idempotent_reimport(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            global_root = Path(tmp) / "global"
            root.mkdir()
            global_root.mkdir()

            source = Path(tmp) / "source.jsonl"
            records = [
                {"type": "user", "message": {"role": "user", "content": "Test"}},
            ]
            source.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")

            parsed = parse_claude_transcript(source)
            result1 = import_transcript(
                parsed=parsed, root=root, global_root=global_root,
                project_slug="test", raw_upload_permission="not-set", mirror_to_repo=True,
            )
            result2 = import_transcript(
                parsed=parsed, root=root, global_root=global_root,
                project_slug="test", raw_upload_permission="not-set", mirror_to_repo=True,
            )

            self.assertEqual(result1["raw_sha256"], result2["raw_sha256"])
            self.assertEqual(result1["imported_at"], result2["imported_at"])


if __name__ == "__main__":
    unittest.main()
