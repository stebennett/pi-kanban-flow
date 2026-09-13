# split — check criteria

Read `checks/_method.md` first (the discipline and the return format); this file is your criterion
set. Checks `pr-splitter`, dispatched at the end of the review phase once the lens panel has passed and
**before any PR exists**. Your inputs: the **named original branch** and its change set
(`git diff --no-renames --name-status origin/main...<original-branch>`), `split.md` (the ordered slices
— paths, why, estimated lines, the green evidence for each, and the `## Environment` proof that the
scratch worktree builds), `design.md`, `implement.md`, `review.md`, and `size_limit` / `size_exclude`.

**Derive the ground truth from the NAMED ORIGINAL BRANCH — never from `HEAD`.** `HEAD` in the card's
worktree is **not trustworthy**: `pr-splitter` may have moved it onto a scratch branch, and a pump can
die and leave it there. A ground truth from a scratch `HEAD` is a strict subset of the card's work —
the slice union matches it exactly, and `SPL-NO-LOSS` passes on a carve that dropped whole slices.

**Rename detection is OFF — `--no-renames` on EVERY `--name-status`, yours and the splitter's.** The
change-type vocabulary is `A` / `M` / `D` and nothing else: `pr-splitter`'s contract permits only those
three, and the orchestrator populates a slice branch with exactly `git checkout` (added/modified) and
`git rm` (deleted) — **nothing here can consume an `R`**. With `--no-renames` a rename is **always `D
old` + `A new`**, so set-equality against the splitter's union is mechanical. The unit of a slice is a
**path plus its change type**, never a bare filename: a slice that must *delete* a path is not
satisfied by one that merely lists it, and a rename's two halves (`D old` + `A new`) sit in the **same**
slice.

| id | criterion | severity when failed |
|---|---|---|
| `SPL-NO-LOSS` | the union of the slices equals the original branch's change set **exactly** — same paths, **same change types**, in both directions: nothing dropped, nothing invented, no deletion left undone | blocking |
| `SPL-GREEN` | each slice's green evidence is **real command output**, not a claim | blocking |
| `SPL-SIZE` | every slice is within `size_limit` | blocking |
| `SPL-ORDER` | no slice depends on a later one | blocking |
| `SPL-FILES` | whole files only; no path appears in two slices; and a rename's `D old` + `A new` never straddles a slice boundary (see above) | blocking |
| `SPL-COHERENT` | each slice is reviewable on its own | advisory |

**What `SPL-NO-LOSS` actually is: set-equality of the `(path, change-type)` set, in BOTH directions,
against the original branch.** Take the original branch's `--no-renames --name-status` (minus
`size_exclude`) as a set of `(path, type)` pairs; take the union of every slice's declared `(path,
type)` pairs from `split.md`. The two sets must be **equal**. Compute both directions and say so in
your evidence:
- **original \ union** — a change the branch made that no slice ships. An **added or modified** path no
  slice checks out is lost code. **A path the branch DELETED that no slice deletes is lost too**, and it
  hides: the deletion never happens, the file survives on `main`, and nothing else looks in that
  direction (a renamed module ships new, never removes old — a stale, maybe build-breaking duplicate).
  **Blocking.**
- **union \ original** — a path a slice claims that the branch never touched: invented content.
  **Blocking.**

Whole-file granularity makes this sound: a slice is *these paths at this change type*, so equality of
the `(path, type)` sets **is** equality of content. Do **not** byte-diff a slice's version against the
branch — at check time **no slice branch exists** (`pr-splitter` deleted its scratch worktree; slice
branches are cut later, at deliver). (Why `SPL-NO-LOSS` is the criterion that matters most, and why the
split is safe *after* the panel reviewed the whole diff, is in `RATIONALE.md`.)

**Walk:** Before opening `split.md`, run the original branch's `--no-renames --name-status` yourself
and form your own view of a defensible carve — which paths are cohesive, which large file is awkward,
which are deletions, which `D`/`A` pairs are really a rename. Only then read `split.md`.
- **`SPL-NO-LOSS`:** build the two `(path, type)` sets and show both set differences, with numbers.
- **`SPL-GREEN`:** for each slice confirm the evidence is a pasted command **plus its real output**,
  gathered against the scratch build the spec describes — a **throwaway worktree** off fresh
  `origin/main`, **bootstrapped**, with slices `1..k`'s added/modified paths checked out of the
  original branch **and their deleted paths `git rm`'d** — not a bare "passes", not a gate against the
  full branch (proves nothing about slice `k` alone) or a build that skipped the deletions (models a
  `main` that will never exist). **Read `## Environment` as part of `SPL-GREEN`:** a fresh worktree has
  no `node_modules`/venv, so a splitter that never bootstrapped finds *every* carve red for reasons
  unrelated to the carve. `pr-splitter` must prove the worktree builds **with the whole original change
  applied** before judging any slice; a red slice or refusal offered without that proof is a blocking
  `SPL-GREEN` finding — the evidence cannot tell entangled code from a broken box. (A genuinely broken
  environment is `status: blocked`, never a refusal.)
- **`SPL-SIZE`:** sum `added + deleted` per slice from its own `--numstat` against `origin/main`,
  excluding `size_exclude`, and compare against `size_limit` yourself.
- **`SPL-ORDER`:** walk the slices in order and confirm no earlier slice references (import, call,
  extend) something only a later slice introduces.
- **`SPL-FILES`:** confirm every path in the original change set appears in exactly one slice — zero is
  `SPL-NO-LOSS`, two or more is `SPL-FILES` — and no rename straddles a boundary (a `D a` in slice 1
  with `A b` in slice 3 leaves an intermediate `main` with neither copy; the reverse, both). Both
  halves in one slice.
- **`SPL-COHERENT`:** read each slice's stated "why" and judge whether a human handed only that slice's
  diff could review it without needing another slice.

**Don't flag:** a slice boundary you would have drawn differently but that still leaves every slice
coherent and within budget (taste is not a defect); a refusal (`split: none`) that names a real,
checkable reason a file could not be divided without cutting it, **backed by a green `## Environment`**
— that is the safety net working; green evidence gathered against a scratch build matching the spec's
construction even when the prose describing it is terse (evidence is the command and its output).
