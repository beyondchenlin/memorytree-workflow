# Execution Environment

Use this file when MemoryTree needs to run a bundled Python script inside an arbitrary repository.

## Goal

Run MemoryTree tooling without assuming the target repository already has a Python environment and without polluting the repository by default.

## Preferred Order

1. Use `uv run python ...` when `uv` is already available on the host machine.
2. Otherwise use a working system `python`.
3. If neither runner is available:
   - for fresh init, fall back to direct template scaffolding from `assets/templates/`
   - for upgrade or detection, fall back to conservative manual review and only make low-risk changes
4. Ask the user before creating a project-local virtual environment, installing Python, or adding Python tooling files to the repository.

## Why

- MemoryTree is a repo-level memory workflow, not a language-specific build tool.
- Many target repositories are not Python projects.
- Auto-creating `.venv`, `pyproject.toml`, lockfiles, or other tooling files can pollute the host repository and conflict with its workflow.

## Fresh Init

For `scripts/init-memorytree.py` and first-run scaffolding:

- Prefer running the script through `uv run python` or system `python`.
- If no runner exists, create the initial files directly from `assets/templates/<locale>/`.
- Do not block first-run installation only because Python is unavailable.

## Upgrade And Detection

For `scripts/upgrade-memorytree.py` and `scripts/detect-memorytree-locale.py`:

- Prefer running the script through `uv run python` or system `python`.
- If no runner exists, do not silently create a new environment inside the project.
- Fall back to manual detection using the reference docs and keep the change set minimal.
- If correct upgrade behavior depends on repo-specific policy interpretation, ask the user before proceeding.

## Stop And Ask

Stop and ask the user before environment setup when any of these are true:

1. `uv` is unavailable and `python` is unavailable.
2. Running the scripts would require creating a new `.venv` or installing host tooling.
3. The repo has policies about local tooling, bootstrap scripts, or checked-in environment files.
4. The upgrade is risky enough that manual fallback would be error-prone.
