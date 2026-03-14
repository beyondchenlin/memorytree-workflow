# Response Language

Use this file after locale detection. It governs how the assistant should write replies while using MemoryTree.

## Rule Order

1. If the user explicitly asks for a reply language, obey it.
2. Otherwise prefer the user's current message language.
3. If the message language is unclear, prefer the repository locale.
4. If the repository locale is unclear, prefer the active MemoryTree template locale.
5. If nothing is clear, default to `en`.

## Important Distinction

- Initialization locale controls which templates are written.
- Response language controls how the assistant talks during setup and maintenance.

These usually match, but they do not have to.

Example:

- A repo may use English templates.
- The current user may still prefer Chinese discussion.

In that case:

- Keep template generation in English.
- Reply in Chinese unless the user asks to switch.

## Safety Rules

- Do not rewrite existing MemoryTree files only to translate them.
- Do not change file locale without explicit user confirmation.
- When the repo is mixed-language, keep the existing file language stable and mirror the user's discussion language in replies.
