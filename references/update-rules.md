# Update Rules

Use these rules after the repo is already initialized.

## Goal Updates

Create a new goal version only when the user confirms a real requirement or scope change, such as:

- The long-term objective changed.
- Acceptance criteria changed.
- The project focus moved to a different bounded problem.

Do not create a new goal version for routine execution progress.

## Todo Updates

Update the active todo when:

- Progress changed.
- The next execution step changed.
- A milestone moved from pending to active or done.
- A new task is needed to satisfy the same goal.

Create a new todo subversion when the goal version changes or the todo structure needs a clean reset.

## Chat Log Updates

- Append only.
- Create a new chat file when the session boundary is explicit.
- If the boundary is unclear, continue the active chat file unless the repo already defines a stricter rule.
- Do not replace the active project chat log with imported raw transcripts. Use transcript imports as supporting evidence and search material.

## Knowledge Updates

Move stable, reusable information into `04_knowledge/`, for example:

- Architecture decisions
- External constraints
- Reusable operating notes
- Domain facts that should outlive a single session

## Archive Updates

Move retired or noisy context into `05_archive/` when it no longer belongs in the active files.

## Transcript Import Updates

- Preserve raw transcript files unchanged in both the current project's `Memory/06_transcripts/raw/<client>/` mirror and the global archive.
- Generate cleaned Markdown transcript indexes for discovery and lightweight review using deterministic code, not model-generated rewriting.
- Import one transcript by updating the global archive in every case, and the current project's transcript mirror only when the source belongs to that repository.
- Use `scripts/discover-transcripts.py` when the skill needs to scan local client stores instead of importing one explicit source path.
- During discovery, mirror only transcripts that match the current repository into `Memory/06_transcripts/**`; import unrelated projects into the global archive only.
- Skip snapshot-only or otherwise content-empty transcript files instead of generating empty clean transcripts.
- Keep cleaned transcript indexes in `Memory/06_transcripts/clean/<client>/` and the matching global clean archive synchronized.
- Raw transcript upload approval only controls Git staging and push for `Memory/06_transcripts/raw/**`. It does not block project-local storage.
- When a cleaned transcript result affects an important decision, verify the exact wording against the raw transcript before treating it as evidence.
