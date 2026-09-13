# Split shipping — the split sub-step and shipping N implementation PRs

Loaded by `pump.md` §5 when: `review.md` is `verdict: pass` **and complete** and the branch diff
> `size_limit` (`checks.split: on`); OR `split_slices ≥ 2` at deliver; OR any slice PR is open.
Assumes you hold `pump.md` — its split-sub-step state table (the authority on which row fires) and
its check-loop discipline (a failing check doc stays on disk as the rework's input; delete it only
in the commit that persists the work answering it).

## Measuring the branch

The moment `review.md` is `verdict: pass` and complete, and **before advancing to `deliver`**,
measure the branch diff in the worktree, **naming the branch, never `HEAD`** (any agent may have
moved the worktree):

```bash
git -C <worktree> fetch origin main
git -C <worktree> diff --numstat                  origin/main...<branch>
git -C <worktree> diff --no-renames --name-status origin/main...<branch>   # paths AND change types
```

Sum `added + deleted` across every path, **excluding every `size_exclude` path** (which already
excludes `docs/cards/**`, so the card's own phase docs never push it over). Over `size_limit`
**and `checks.split: on`** → stay at `status: review`, dispatch `pr-splitter`. Otherwise advance to
`deliver` with `split_slices: 0` (`checks.split: off` on an oversized diff advances too — report
loudly, §7). The `--name-status` form carries each path's change type; a slice's unit is a **path
plus its change type**.

## `--no-renames` doctrine

Every `--name-status` in the split layer carries **`--no-renames`** — in the orchestrator,
`pr-splitter` (ground truth *and* scratch builds), `card-split-checker`, and the completeness
backstop. Rename detection is on by default and collapses a rename into a single `R100 old new`.
The change-type vocabulary of this layer is `added`/`modified`/`deleted`: `pr-splitter` returns
only those three, a slice branch is populated with exactly two commands (below), and `SPL-NO-LOSS`
is set-equality of `(path, type)` pairs. **Nothing here can consume an `R`** — improvised it leaves
the old path undeleted on `main`; notated inconsistently between splitter and checker it fails
set-equality both ways on a perfect carve and parks the card. **With `--no-renames` a rename is
always `D old` + `A new`**, and `SPL-FILES` requires **both halves in the same slice** (split them
and the intermediate `main` carries neither copy, or both).

## Dispatching `pr-splitter`, its checker, and the acceptance re-run

The split uses the **same dispatch-vs-handle loop as every producer/checker pair**; the state
table in `pump.md` is its statement. The card stays at **`status: review`** throughout (no `split`
status).

1. **`pr-splitter` returns → persist `split.md`** on the implementation branch like any phase doc.
   `split_slices` is recorded on the card only when the *check* passes; `split.md` is the durable
   record and rides slice 1's PR. Inputs: `worktree`, **the original branch by name** (ground truth
   `git diff --no-renames --name-status origin/main...<original-branch>` — never `HEAD`, never
   without `--no-renames`), `design.md`, `implement.md`, `review.md`, `size_limit`, `size_exclude`
   (+ blocking findings on rework).
2. **`split.md` present + `split-check.md` absent → dispatch `card-split-checker`** (inputs per
   `pump.md` §5's checker contract — it re-derives the change set from the named branch, never
   `HEAD`). Its result goes through the **completeness valve** (all six `SPL-*` ids — `SPL-NO-LOSS`,
   `SPL-GREEN`, `SPL-SIZE`, `SPL-ORDER`, `SPL-FILES`, `SPL-COHERENT` — or malformed → re-dispatch
   the checker naming the omitted ids, spend no budget) and the location-or-dropped rule.
3. **`verdict: fail` → a `pr-splitter` rework** against `reworks.split` / `check_budget.split`
   (default **1**). Leave the failing `split-check.md` on disk; delete it in the same state commit
   that persists the reworked `split.md`. Budget spent → `status: blocked` with the failing `SPL-*`
   ids.
4. **`verdict: pass` with N ≥ 2 → record `split_slices: N` AND push the original branch to
   `origin`**, in that same state commit, then re-run the `[acceptance]` lens once per slice.

   **Push the original branch — no PR, just the branch:**
   `git -C <worktree> push -u origin <original-branch>`. It is the **SOLE copy of every unshipped
   slice** for the whole sequence. Nothing else pushes it — `card-deliverer` pushes only the slice
   branch it is dispatched into — so unpushed, slices 2..N live only in one local worktree, which a
   `git worktree prune`, fresh clone, or `/kanban` from another checkout destroys, and Reconcile
   cannot rebuild. A free backup. Do **not** delete it from `origin` until the last slice merges and
   the backstop passes (§0 step 3) — the moment the local branch dies.

   **Then re-run `[acceptance]` once per slice, in SLICE MODE** — one `card-lens-reviewer` per
   slice, in parallel, each given `lens: acceptance`, **`slice: k`, `slices: N`**, **that slice's
   path list with change types** and the criteria it claims (both from `split.md`), the `worktree`
   and the original branch by name (to scope its diff:
   `git diff origin/main...<original-branch> -- <slice k's paths>`), **`split.md`**, `card.md`,
   `design.md`. Those inputs make the gate real: a reviewer with no slice number reviews the whole
   branch diff, so N of them return N identical whole-diff reviews — a gate that cannot fail. In
   slice mode it reviews **only that slice's paths** and answers two questions — does the slice
   **trace to the criteria it claims**, and does it **stand alone** against a `main` holding slices
   `1..k-1` — returning `## [acceptance] — slice k`.

   **You stamp the verdict** on the merged **`split-acceptance.md`** (one section per slice;
   `verdict: fail` iff any section carries a blocking finding). **`verdict: pass` → advance to
   `deliver`** — the card ships **N** PRs. `verdict: fail` is a defect **in the carve, not the
   code**, so it reworks **`pr-splitter`**, spending `reworks.split`, `split-acceptance.md` left on
   disk until the reworked `split.md` is persisted. **Dispatching `card-implementer` on a slice-mode
   finding is a serious defect — read the mode, not the agent name.** `split-acceptance.md` makes
   the re-run recoverable from disk.

## Refusal and blocked — first-class outcomes

- **Refusal** (`split: none`, `split_slices: 0`, with a reason: no carve stays green, or a file
  cannot be cut) is a **true finding about the code, not a failure and NOT a rework.**
  `card-split-checker` checks it like any result (a real entanglement → `pass`; a carve that would
  have worked → `fail`). On a checked refusal (or a stray `split_slices: 1`): **record
  `split_slices: 0`, advance to `deliver`, ship ONE oversized PR**, spend **no** `reworks.split`, do
  **not** re-dispatch. The report warns **prominently, reason verbatim.** **An oversized PR is bad;
  a red `main` is worse.**
- **Blocked** (`pr-splitter` returned `blocked`: it could not build its throwaway worktree even with
  the **FULL** original change applied — a broken environment, **not** entangled code) →
  `status: blocked` with the real command output; **no rework, no `reworks.split`, NOT a refusal.**
  The driver fixes the environment. Never paraphrase as "refused" or say "entangled".

`pr-splitter` writes nothing to disk and touches no GitHub, and **never moves the card's own
worktree off its branch** — that worktree is the sole copy of every unshipped slice. (It proves
each slice green in a throwaway worktree it bootstraps and removes.)

## Shipping N slices — sequential, one open at a time (§5 deliver, `split_slices: N ≥ 2`)

The next slice is read off disk: **`k = len(pr_urls) + 1`**. Preparing slice `k` is **your** work
(only `card-deliverer` mutates GitHub; cutting a local branch does not):

0. **First, ask GitHub whether slice `k`'s PR already exists — the ship path must be re-entrant.**
   `{gh_command} pr list --head <type>/NNN-slug-<k> --state all --json url,state`. A hit means a
   previous pump died inside `card-deliverer`, after `gh pr create` succeeded and before the url was
   appended — on disk **byte-identical** to "slice `k` never shipped"; a naive re-ship then fails on
   the existing worktree, branch, and PR, and Reconcile never finds the orphan (it only inspects
   urls the card carries). **Ask `--state all`, never `--state open`** — **adopt a `MERGED` hit
   exactly as an `OPEN` one** (a merged orphan is invisible to an open-only query and *more* urgent:
   `main` already carries slice `k`).

   **Adopt it:** append the returned url to `pr_urls` as if `card-deliverer` had handed it to you,
   keep the existing branch and worktree, note the adoption (and state) in the report, and
   **continue from step 4 — skipping its append: the url is already recorded** (a double append
   makes `len(pr_urls)=k+1` and slice `k+1` never ships). `deliver.md` is lost with the dead pump —
   record its absence, don't fabricate one; the deliver **check** still runs. **On a `MERGED` hit**,
   skip the deliver check too and let **Reconcile** process it this same pump as any merged slice
   url (§0 step 3 — tears down slice `k`, resets counters, opens slice `k+1`). A `CLOSED`-unmerged
   hit is §0 step 4's blocker (append and run the closed-slice recovery). Only on **no** hit proceed
   to step 1.
1. `git fetch origin main`, then create the slice branch **`<type>/NNN-slug-<k>` off fresh
   `origin/main`** — for `k > 1` a `main` that **already contains slices 1..k-1** — in its own
   worktree (`../<repo>-worktrees/CARD-NNN-slice-<k>`, via **superpowers:using-git-worktrees**).
   Both names are deterministic in `k`, so a pump dying here re-derives them.
2. **Populate from the original branch — two change types, two commands:**
   - **`added` / `modified` paths → `git -C <slice-worktree> checkout <original-branch> -- <those paths>`.**
   - **`deleted` paths → `git -C <slice-worktree> rm -- <those paths>`.**

   There is no third command and no third change type (`--no-renames` doctrine, above).
   `git checkout <branch> -- <path>` **cannot delete a file the branch deleted** — the path is not
   on the branch, so the file survives from `origin/main` and the card's deletion never reaches
   `main` (a stale duplicate while the card is `done`). Read each path's change type from
   **`split.md`'s `## Slices` section on the original branch** and apply the matching command. A
   rename arrives as `D old` + `A new` (both in one slice): `git rm` deletes the old, `git checkout`
   brings the new.

   On **slice 1 only**, also check out the card's phase docs (`implement.md`, `test.md`,
   `review.md`, `split.md`, `split-check.md`, `split-acceptance.md`) so they ride the first PR
   (`DLV-DOCS`); slices 2..N reach a `main` that already carries them.
3. Commit on the slice branch (`feat(card): CARD-NNN slice k/N — <slice name>`) — **`git add` the
   checked-out paths, let `git rm` stage its removals; never `git add -A`**. Assemble slice `k`'s
   `pr-body.md` (§3) and dispatch **`card-deliverer` in implementation mode** against the **slice
   worktree and slice branch** (rebase, confirm green, push, `gh pr create`).
4. **Append** the returned url to `pr_urls` (order = shipping order = slice number), commit
   `card-deliverer`'s returned `deliver.md` to `main` as **`deliver-<k>.md`**, then dispatch
   `card-deliver-checker` in implementation mode and persist its check as **`deliver-check-<k>.md`**
   on `main` (the per-slice suffix is load-bearing — pump.md §5 deliver row: a shared
   `deliver-check.md` is pre-present on slice `k+1`'s branch and leaves slices 2..N unchecked). The
   card stays at `status: deliver` with that PR open; **Reconcile opens slice `k+1` when slice `k`
   merges** (§0 step 3), from the `main` that now contains it.

**The original branch and worktree stay alive for the whole sequence** — the source of truth for
every unshipped slice; `split.md` is read off them. Torn down (local **and** `origin`) **only when
the last slice merges and the backstop passes** (§0 step 3): early teardown loses the unshipped
slices.

## The slice-PR dispatch contract (canonical)

**Every dispatch that acts on an OPEN SLICE PR carries that slice's branch and worktree — not the
card's.** The card's `branch`/`worktree` still name the **original** branch throughout the
sequence, so a dispatch that passes "the card's worktree" sends the agent at the **wrong branch**.
It binds **`card-implementer` in every mode that can fire while a slice PR is open**: §6a's CI
rework, §6b's comment-addressing, any `DLV-*` finding routed from `deliver-check-<k>.md`. Give it:

- `worktree`: **slice `k`'s worktree** (`../<repo>-worktrees/CARD-NNN-slice-<k>`)
- `branch`: **slice `k`'s branch** (`<type>/NNN-slug-<k>`) — the branch the open PR is built from
- context: *"this is slice `k` of `N`; the open PR is `<url>`; commit and push here"*

Get it wrong and two things break: **the fix never reaches the open PR** (CI stays red, §6a's
budget burns, the card parks on a failure nobody fixed), **and the original branch — closed to
changes since the carve was checked — is mutated with code no lens and no `SPL-NO-LOSS` ever saw**,
which slice `k+1` inherits when cut from it.

## Never split a split

If `card-deliver-checker` reports **`DLV-SIZE` breaching on a slice PR**, `pr-splitter` failed its
own `SPL-SIZE` check. **Park the card** (`status: blocked`, blocker `slice k/N still over
size_limit — the split failed`). Do **not** re-dispatch `pr-splitter`, do not carve the slice
further: `pr-splitter` never runs on an already-split card. No recursion. (`DLV-SIZE` is normally
advisory; this is the one place a breach parks a card — evidence of a defect in a step that already
passed its own check.)
