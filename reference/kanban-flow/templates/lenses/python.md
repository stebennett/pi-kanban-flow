Read templates/lenses/_shared.md first; it binds every lens.

## [python]
*This lens assumes a Python/FastAPI/SQLAlchemy stack — project-specific rules belong in
`<board_dir>/PROTOCOL-ADDENDUM.md`.*

**Focus:** Language-expert review of `*.py` changes — idioms, typing, and the specific traps of
this stack (Decimal/money maths, SQLAlchemy 2.x, FastAPI, Pydantic v2, Alembic+SQLite, pytest/Hypothesis).

**Walk:**
1. Numeric audit first (highest-stakes): every money/precision value is `Decimal` end to end —
   constructed from `str`/`int`, compared exactly, rounded only via the `domain/` primitive. `grep -n
   'round(\|float(\|Decimal(' ` over the diff and inspect each hit.
2. Typing pass: signatures precise enough for mypy strict in `domain/` (no implicit `Any`,
   `Optional` explicit, return types on everything public).
3. Framework pass: SQLAlchemy 2.x style (`select()`, typed `Mapped[]`, session lifecycle owned by
   the request, relationship loading explicit — hunt N+1s in list endpoints); FastAPI (correct
   `response_model`, dependencies over globals, **no blocking DB/CPU work in `async def` paths**);
   Pydantic v2 (`model_config`, `field_validator`, no v1 idioms).
4. Migration pass (if Alembic files): SQLite ALTERs need `batch_alter_table`; downgrade defined;
   no data-destroying autogen surprises; seed stays idempotent.
5. General idiom sweep: mutable default args, bare `except:`/over-broad `except Exception`,
   resources without context managers, `os.path` where `pathlib` is the codebase norm, dict access
   chains that should be a dataclass.

**Ask of every hunk:** Would mypy strict accept this? Is this how SQLAlchemy 2.x / Pydantic v2
wants it written? What does this line do with a `float` that looks like an int?

**Red flags:** `Decimal(0.1)` (float constructor — the value is already wrong before rounding);
bare `round()` on any money figure; `dict`-typed payloads crossing layer boundaries; `async def`
endpoint calling a sync session; `Session()` created ad hoc instead of the dependency;
`.query(...)` legacy API; comparing dates as strings; Hypothesis strategies over unconstrained
floats/text for domain values; `# type: ignore` without an issue reference.

**Don't flag:** stdlib `round()` on non-money values where banker's is harmless and no project
convention applies (verify it's truly non-money first); style ruff already enforces; `assert` in
tests (that's pytest idiom, not production `assert` misuse).

**Example finding.** Diff in `domain/rates.py`:
```python
return round_half_up(Decimal(rating * factor / 100) + (base_rate - reference_rate), 0)
```
Finding: `[python] blocking — rating * factor / 100 is computed in float before Decimal sees it, so
the value carries binary representation error into the half-up rounding — exactly the class of bug
the Decimal convention exists to prevent (a true x.5 can arrive as x.4999…). Keep the arithmetic in
Decimal end to end:`
```suggestion
return round_half_up(Decimal(rating) * factor / Decimal(100) + (base_rate - reference_rate), 0)
```

