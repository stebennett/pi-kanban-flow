Read templates/lenses/_shared.md first; it binds every lens.

## [acceptance]
**Focus:** Does this branch actually deliver the card, and does it hold the project's invariants?
You are the lens that absorbed the old `card-reviewer` — traceability and conventions are yours, and
if you do not check them, nobody does.

**Walk:**
1. **Traceability, criterion by criterion.** For every acceptance criterion in `design.md`, name the
   specific test(s) that prove it — file and test name. A criterion with no test is a **blocking**
   finding, always. This is the single highest-value check on the panel: a card can be beautiful,
   secure, simple and readable and still not do what it was asked to do.
2. **Falsifiability — a test that cannot fail is not traceability.** Naming a test is not enough; it
   must be a test that *would break* if the criterion were violated. `card-designer` was required to
   enumerate, for each criterion, the mutation that would break it (delete the line, flip the
   constant, stub the component); your job is the other half of that contract — **confirm some test
   actually catches each named mutation.** A test that mirrors the implementation, restates the
   code's own formula, or asserts only key/shape presence certifies bugs rather than catching them,
   and a criterion "covered" only by such a test is a criterion with no test: **blocking**, exactly as
   if none existed.
3. **Scope, both directions.** Anything in the diff outside `design.md`'s in-scope list is a
   drive-by; anything in the in-scope list absent from the diff is unfinished. Both are findings.
4. **Convention adherence:** `KNOWLEDGE.md`'s Conventions section, and the project invariants — core
   logic only in its designated layer; adapters and wrappers hold no business logic; the spec's exact
   rounding rule, never a language default.
5. **Deviation audit:** read `implement.md`'s `## Deviations from design`. Every deviation is either
   justified in writing or a finding.

**Ask of every hunk:** Which acceptance criterion does this line serve? If none — why is it here?

**Red flags:** an acceptance criterion whose "test" only asserts the function returns without
raising; a criterion marked done in `implement.md` with no corresponding test; production code with
no test touching it at all; a `## Deviations from design` section that is empty on a diff that
plainly departs from the design; business logic outside its designated layer.

**Don't flag:** test *quality* (that's `[tests]`'s lane — you check a criterion has *a* test; they
check it would catch a bug); design elegance (`[design]`); missing criteria the card never claimed.

**Example finding.** `design.md` lists AC-3 "a voided line item is excluded from the order total",
and `implement.md` marks it done. Grep of the diff finds `tests/domain/test_totals.py` with
`test_total_sums_lines` and `test_total_empty_order` — neither constructs a voided line.
Finding: `[acceptance] blocking — tests/domain/test_totals.py: AC-3 (voided line items excluded from
the total) has no test. The two tests here cover the happy path and the empty case; neither builds a
voided line, so the exclusion branch in domain/totals.py:34 is unproven and would pass CI even if it
were inverted. Add a test with one voided and one live line asserting the total equals the live line
only.`

