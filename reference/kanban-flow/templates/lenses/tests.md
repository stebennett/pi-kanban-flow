Read templates/lenses/_shared.md first; it binds every lens.

## [tests]
**Focus:** Would these tests fail if the code were wrong? Tests that mirror the implementation,
assert too weakly, or skip the boundaries are worse than missing — they certify bugs.

**Walk:**
1. **Read the tests before the production code.** For each test, predict what implementation bug
   it would catch. A test you can't name a caught-bug for is decoration.
2. Provenance-check every expected value: it must come from a spec worked example, the shipped
   fixture, or hand arithmetic you can reproduce in the comment. If the expected value could only
   have been produced by running the code under test, flag it.
3. Map acceptance criteria → tests (design.md lists both). Criterion with no test → finding.
4. Boundary audit: for every clamp/cap/threshold in the diff, look for the test at the boundary,
   just inside, and just outside (the rating's valid-range floor/ceiling, `.5` cases, the cap
   formula's edge, 20th/21st order).
5. Hypothesis check: strategies constrained to valid domain ranges; asserts real invariants
   (bounds, monotonicity, idempotency), not just "doesn't raise"; fixed profile/seed for CI.
6. **Branch & outcome coverage (esp. UI and adapter code).** Enumerate the distinct outcomes and
   render variants the unit under test can take, and confirm each has its own test:
   - **Every failure OUTCOME gets its own stub.** A handler that branches on *why* it failed has
     more outcomes than "ok vs not-ok" — e.g. a fetch wrapper with a distinct not-found path has
     three (not-found, other-error, network-reject), and a single not-found stub leaves the
     generic error branch unexercised.
   - **Render EVERY variant, not one representative.** Both sides of a two-way split, each
     status/state a row can render, each visual mark — a variant no test renders is a mutation
     that survives.
   - **Pick DISCRIMINATING fixtures and assertions.** No substring assertion whose negative case
     contains the positive (`"inactive".includes("active")`); no fixture symmetric across the very
     branch the test means to distinguish (both branches computing the same number). The expected
     value must differ between the branch under test and its sibling, or the assertion can't fail
     on a swap.
7. **Level delivery (only when `design.md` has a `### Levels` block).** For each level that block
   marks *selected*, confirm `test.md`'s `## Levels` shows it ran with a non-zero test count, and
   that the tests exist in the diff. A selected level with no tests is blocking — the tester should
   have caught it; you are the backstop.
8. **Seam audit.** For every fake/mock/stub in the diff, name the declared seam it stands at (the
   seam list is in your dispatch when the project declares one). A double at an undeclared seam is
   blocking. No seam list in the dispatch → apply only the core-logic-no-mocks rule.

**Ask of every hunk (of test code):** What bug slips through this assertion? Where did this
expected value come from? What happens at the boundary ±1?

**Red flags:** expected values computed with the same formula as the implementation (`assert
differential == round((100/factor)*(total-reference), 1)` proves nothing); `pytest.approx`/float
tolerance on money values (they're exact `Decimal`s); asserting only types/lengths/"is not None";
mocking pure domain functions; tests asserting private call order (implementation-coupled); a
single happy-path test for a function full of branches; `@settings(deadline=None)` hiding a slow
strategy; a `toContain`/substring assertion whose negative case contains the positive; a fixture
symmetric across the very branch it means to discriminate; only one of a component's render
variants exercised; a multi-outcome error handler tested with a single failure stub; a skipped test (`.skip`, `.only`,
`xit`, `t.Skip`) with no matching row in the board's `QUARANTINE.md`, when the board keeps one
(skipping is quarantine's job, and quarantine is written by the orchestrator, not by a diff; a
board with no `QUARANTINE.md` is judged by the pre-existing rules alone).

**Don't flag:** coverage % by itself (card-tester owns the number — you own whether the tests
*mean* anything). On a card whose `design.md` has a `### Levels` block: a gap at a level that block
explicitly *declines* with a rationale — the design check verdicted it; your job is gaps the block
does not account for. On a card whose `design.md` has **no** `### Levels` block (pre-opt-in design,
or a project without levels configured): E2E gaps when the card's test strategy explicitly defers
them.

**Example finding.** Diff in `tests/domain/test_price_differential.py`:
```python
def test_price_differential():
    assert price_differential(total=85, reference=Decimal("70.2"), factor=125) == \
        round_half_up(Decimal(100) / 125 * (85 - Decimal("70.2")), 1)
```
Finding: `[tests] blocking — The expected value is computed with the same formula and helpers as
the implementation, so this test passes even if the formula itself is wrong (e.g. factor and the
scaling constant inverted — both sides invert together). Assert the literal: the spec's worked
example gives (100/125)×(85−70.2) = 11.84 → 11.8. `
```suggestion
    assert price_differential(total=85, reference=Decimal("70.2"), factor=125) == Decimal("11.8")
```

