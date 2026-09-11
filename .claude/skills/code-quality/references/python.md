# Python Quality Reference

## Tooling
Dev tools below are fine to add - they don't ship. Runtime dependencies follow the package policy in SKILL.md: stdlib first.

- Format + lint with **ruff** (`ruff format`, `ruff check`). Replaces black, isort, flake8 for most projects.
- Type check with **mypy** or **pyright** on public code at minimum.
- Tests with **pytest**. Fixtures over setup/teardown classes.
- Project config in `pyproject.toml`. Pin app deps in a lockfile (uv, poetry, pip-tools).

## Style
- PEP 8 naming: `snake_case` functions/vars, `PascalCase` classes, `UPPER_SNAKE` constants.
- Type hints on all function signatures. Use modern syntax: `list[str]`, `dict[str, int]`, `X | None` (3.10+).
- f-strings for formatting. Never `%` or `.format()` in new code.
- `pathlib.Path` over `os.path` string juggling.

## Idioms
- Use `dataclass` (often `frozen=True`) instead of loose dicts for structured data. Reach for `pydantic` only if the project already uses it or needs heavy runtime validation of external data.
- Context managers (`with`) for files, locks, connections - guarantees cleanup.
- Comprehensions for simple transforms; switch to a loop once it needs more than one condition or nested logic.
- `enumerate()` instead of `range(len(x))`; `zip()` for parallel iteration.
- `dict.get(key, default)` and `collections.defaultdict` / `Counter` over manual existence checks.
- Generators for large or streaming data.

## Pitfalls
- **Mutable default args**: `def f(items=[])` shares one list across calls. Use `items: list | None = None`.
- **Bare `except:`** catches `KeyboardInterrupt` and `SystemExit`. Catch specific exceptions; `except Exception` only at top-level boundaries, and log it.
- **`is` vs `==`**: `is` only for `None`, `True`, `False`, sentinels.
- **Late-binding closures** in loops capture the variable, not the value.
- **Floating point money**: use `decimal.Decimal` or integer cents.
- Don't shadow builtins (`list`, `id`, `type`, `input`).

## Errors
- Define project-specific exceptions subclassing a base (`class AppError(Exception)`), raise specific ones.
- Chain with `raise NewError(...) from err` to keep the original traceback.
- Use `logging` with module loggers (`logger = logging.getLogger(__name__)`), not `print`, in anything beyond throwaway scripts.

## Structure
- `if __name__ == "__main__":` guard for runnable modules; keep logic in functions so it's importable and testable.
- Keep `__init__.py` light; avoid heavy import-time side effects.
- CLI: `argparse` by default. `typer`/`click` only if already a dependency or the CLI has many nested commands.
