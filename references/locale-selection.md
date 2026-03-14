# Locale Selection

Use this file when initializing MemoryTree for a repo that did not specify a language.

## Rule Order

1. If the user explicitly provides `--locale`, use it.
2. Otherwise use `--locale auto`.
3. In `auto` mode, inspect the repository first.
4. If the repository language is unclear, fall back to the system locale.
5. If both are unclear, fall back to `en`.

## Repo Inspection

Prefer these files and locations:

- `AGENTS.md`
- `README.md`
- `README.zh-CN.md`
- `README.zh_CN.md`
- top-level Markdown or text files
- `docs/**/*.md`

If the inspected content is mostly Chinese, choose `zh-cn`.
If it is mostly English or no Chinese signal exists, choose `en`.
Treat short Latin-only repo text, such as a small English `README.md`, as an English signal.
If the repository is mixed-language and neither side clearly dominates, treat the repo language as unclear and fall back to the system locale.

## Supported Locales

- `en`
- `zh-cn`

## Aliases

Map these aliases to `en`:

- `en-us`
- `en-gb`

Map these aliases to `zh-cn`:

- `zh`
- `zh-cn`
- `zh-sg`
- `zh-hans`
- `zh-hant`
- `zh-tw`
- `zh-hk`

Current behavior intentionally collapses all Chinese variants to `zh-cn` because the skill currently ships Simplified Chinese templates only.
