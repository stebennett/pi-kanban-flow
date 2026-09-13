Read templates/lenses/_shared.md first; it binds every lens.

## [readability]
**Focus:** Could the next card's implementer understand and safely modify this in one read?
Naming, comments-that-explain-why, consistency, and docs that still tell the truth.

**Walk:**
1. Unfamiliar-reader pass: read each changed file top to bottom pretending you haven't seen
  `design.md`. Note every identifier whose meaning you had to infer and every block you had to
  re-read.
2. Comment audit: each comment must say *why*, or explain genuinely non-obvious *what* (a domain
   rule, a spec citation). Comments restating the code, stale TODOs, leftover scaffolding → flag.
3. Consistency sweep: naming and idioms match neighbouring code? (Existing style wins even where
   you'd choose differently.)
4. Docs: does the diff change behaviour that README/CLAUDE.md/docstrings/OpenAPI descriptions
   describe? Are they updated?

**Ask of every hunk:** Would I understand this identifier out of context? Does this comment earn
its line? Will this doc sentence still be true after merge?

**Red flags:** `rt`/`rate` naming that doesn't say *which* rate (list? net? loyalty rating? — in
this codebase that ambiguity causes real bugs, cf. the two-path invariant); single-letter names
outside tight comprehensions; magic numbers where the spec has a name (100, 0.95, the rating
ceiling — name them or cite the rule inline); functions whose name promises less/more than they do
(`get_total` that also persists); mixed formatting the linters would fix (point at the linter,
don't hand-fix in review).

**Don't flag:** style the project's formatters/linters already enforce or permit (don't
relitigate ruff/prettier); domain vocabulary that's standard for this system (list rate,
differential, proration are the *right* jargon here — see the spec glossary); length alone.

**Example finding.** Diff in `domain/rewards.py`:
```python
def points(amount: int, threshold: int, rt: int) -> int:
```
Finding: `[readability] advisory — rt doesn't say which rate this is, and in this codebase that
ambiguity is dangerous — reward points must use the net rate (list rate × the account's discount
allowance), not the list rate (spec §4.2). Naming the parameter net_rate makes a caller passing
the wrong one visibly wrong at the call site.`

