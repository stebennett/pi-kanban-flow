# Check method (every checker)

One `card-*-checker` is dispatched per producer. Every checker reads **this file** plus **only its own
target's file** (`checks/<target>.md`, at the path your dispatch provides) — never the whole set —
then layers the repo's `PROTOCOL-ADDENDUM.md` `## Check criteria — <target>` section on top if present
(project-specific criteria, `LOCAL-` id prefix, owned by `/retro`; `checks/` criteria are
plugin-owned).

Criterion ids are **stable and permanent** — `/retro` aggregates verdicts by id across cards, so an id
is never renamed, reused, or renumbered once shipped; retiring one deletes its row, never repurposes
its id. (`checks/ids.md` is the generated per-target index.)

**Checkers are terminal: nothing checks a checker** — the backstop is the human, at the intake and
slice gates and the two PR merges. Never add one.

The **return format below binds only the five dedicated `card-*-checker` agents** (intake, slice,
design, split, deliver — one per producer, hence no `implement` value for `checks`). `card-implementer`
is checked instead by `card-tester` and the `card-lens-reviewer` panel, which keep their own contract
(`status: blocked` + `blockers`). *The discipline* below binds every checker.

## The discipline (this is how you avoid rubber-stamping)

An LLM checking an LLM tends to agree; each rule is the defence against that (the fuller argument is
in `RATIONALE.md`).

1. **Derive independently, then compare.** The producer's output argues its own case — read it first
   and you tend to agree. Form your own answer **from the inputs, before you open the artifact** (what
   tasks this design should have, how big this card should be), then diff the producer's against yours;
   a disagreement you reached independently is a finding.
2. **Verdict every criterion — this is enforced.** Return a verdict (`pass`/`fail`/`na`) for **every**
   id in your set (plus every `LOCAL-` id the addendum adds); `na` needs evidence for *why*. An
   omission is a **malformed result**: the orchestrator holds the same id set and, on any missing id,
   re-dispatches you with the omitted ids named — without advancing the card, applying the gate, or
   persisting your doc. A `pass` over a partial table is not a pass.
3. **Evidence, not adjectives.** Each verdict's evidence cites a line and says what you checked:
   `"design.md:31-58 — 6 tasks; AC-3 (offline retry) maps to none"`, never "looks complete". A
   passing criterion with no evidence of the check is a skim `/retro` reads as one.
4. **Every finding cites a location.** A finding with no `location` in the artifact is invalid — the
   orchestrator drops it. If you cannot point at a line you have a suspicion, not a finding: say so in
   the evidence and pass.
5. **The blocking bar.** `blocking` means shipping this artifact as-is causes a defect, a rework, or a
   lie; everything else is `advisory`. Do not inflate — each blocking finding costs a rework loop from
   a finite budget. **`verdict: fail` iff at least one finding is blocking.** Advisory
   findings ride the PR and never trigger rework; blocking findings auto-rework the producer
   (re-dispatched with your findings verbatim, up to its `check_budget`, then parked), so make each
   actionable — what is wrong, where, what right looks like.
6. **Rebuttal test.** Before a blocking finding, imagine the producer's strongest one-line defence
   ("the spec scopes that out", "task 4 covers it"): if it wins, drop it; if you cannot tell, make it
   advisory.

## What you return

You **write nothing and mutate nothing** — no files, no GitHub. Your verdicts live in two shapes —
**never the full table twice**.

**The check doc** (`phase_doc` — the orchestrator persists it) opens with YAML frontmatter, then
carries the full criteria table:

```markdown
---
verdict: fail
criteria: {DSG-AC-COVERED: fail, DSG-SPEC-FIDELITY: pass, DSG-SCOPE: na, …}
---
## Criteria
| id | verdict | evidence |
|---|---|---|
| DSG-AC-COVERED | fail | design.md:31-58 — no task for AC-3 (offline retry) |
```

The frontmatter is machine-greppable — `/retro` and the completeness valve read `verdict:` and
`criteria:` without parsing prose. Every id in your set appears in both map and table; evidence is
**one line per criterion**.

**The result block** carries only the verdict and blocking-finding detail — **not** the criteria table:

```result
status: complete
phase: check
checks: design              # intake | slice | design | split | deliver
card: CARD-NNN
gate: none                  # a checker never triggers a gate
verdict: fail               # pass | fail
findings:                   # [] when verdict is pass
  - criterion: DSG-AC-COVERED
    severity: blocking      # blocking | advisory
    location: "design.md:31"
    detail: "AC-3 'retries when offline' has no design task."
    remedy: "Add a task covering the retry path, or scope AC-3 out."
phase_doc: |
  <full markdown of the check doc, frontmatter first>
```

## Appendix — the size estimate (`INT-SIZED` and `SLC-SIZE`)

Intake and slice sizing use **one method**; `checks/intake.md` and `checks/slice.md` point here.

**Produce your own estimate before you read the producer's — a number you inherit is unchecked.** For
each card in scope (intake: every proposed card; slice: the parent on keep-as-one, each child on a
split): walk its acceptance criteria, name the files that must change via `Grep`/`Glob`
on the real codebase, judge each as *new file* vs *edit*, estimate changed lines per file **counting
tests** (TDD project — a test file roughly matches the code it drives), and sum. Show the per-file
working in `evidence`, not a bare number. Only `size_exclude` paths are omitted (lock files, vendored
deps — `config.md`).

**Any card whose estimate exceeds `size_limit`** (`config.md`, default 500) → **blocking**; the
producer slices it smaller and each resulting card is sized in turn (two over-budget children do not
pass). A producer estimate indefensible against yours → blocking even if both numbers land under the
limit, because the next card is estimated the same way.

**Don't flag:** an estimate under the limit you'd merely have pitched differently (you check for a
*ceiling breach* and defensible reasoning, not arithmetic); a card you cannot size because the codebase
doesn't exist yet (greenfield first card) — say so, bound it from the acceptance criteria alone, fail
only if that bound breaches.
