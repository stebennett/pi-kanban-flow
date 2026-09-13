# Reconcile edge cases

Loaded by `pump.md` §0 on any of: a CLOSED-unmerged PR, an `AMENDMENTS.md` block, a legacy field,
or a non-empty completeness backstop. Assumes you hold `pump.md`; off-happy-path procedures only.
Step numbers are §0's.

## Closed PR recovery (§0 step 4)

For every not-yet-merged url a card carries (`design_pr_url` + each `pr_urls` entry):
`{gh_command} pr view <url> --json state,mergedAt`. `MERGED` → §0 step 2/3. `CLOSED` (unmerged) →
`status: blocked`, blocker "PR closed without merge"; split card:
`PR closed without merge — slice k/N (<url>)`. **Any** slice PR closed unmerged blocks the card.

**Recovering a closed slice PR is yours, not the driver's.** Slice `k`'s url is still in `pr_urls`,
so `k = len(pr_urls)+1` would compute `k+1` and **skip the closed slice**. Recovery: **remove the
closed url from `pr_urls`** (note on `## Notes`: `slice k PR closed unmerged — <url> — re-shipping`),
delete slice `k`'s branch and worktree if they survive, then clear the blocker. `len(pr_urls)` is
now `k-1`; the deliver row re-derives `k` and re-ships from current `origin/main`. **Never clear the
blocker without shortening the list** — the sequence is keyed on that length.

## Amendment drain (§0 step 6)

Read `{board_dir}/AMENDMENTS.md` (absent → skip). Written by `/requirement` when a changed
requirement invalidates a non-backlog card. For each `## CARD-NNN — <action>` block, apply then
**delete the block**:

- **`supersede`** — the card is dead. Close **every** open PR it owns — the design PR and each
  unmerged `pr_urls` entry (merged slices stay merged) — with
  `{gh_command} pr close <url> --comment "Superseded by <REQ-NNN> — <reason>"`, tear down its
  worktrees and delete its local branches, set `status: superseded`/`phase: superseded`, append the
  block's `**Reason:**` verbatim to `## Notes`. Keep `pr_urls`/`design_pr_url` for traceability.
  **Terminal:** never scheduled, holds no WIP, never reopened.
  - **Split-with-merged-slices exception — KEEP the original branch, local and remote. Never delete
    it.** Slices `1..k` are on `main`; slices `k+1..N` exist **only** on that branch (committed,
    panel-approved code). Deleting it leaves `main` carrying a partial change, neither completable
    nor cleanly revertible. Close the open slice PR, tear down the **slice** branches/worktrees,
    leave the original branch and worktree standing (on `origin` too). Report **loudly**:
    `⚠ CARD-NNN superseded with slices 1..k of N already MERGED — main now holds a PARTIAL change.
    The rest is on <original-branch> (local + origin), NOT deleted. Decide: finish it, revert the
    merged slices, or delete the branch deliberately.` The driver decides; never delete for them.
- **`revisit`** — still wanted, scope moved. `status: blocked`, blocker
  `requirement changed — <REQ-NNN>`, append `**Reason:**` to `## Notes`. **Leave the branch,
  worktree and open PR intact** — §3's blocked conversation asks the driver.

Any other action value, or a block naming a nonexistent card or one already
`done`/`split`/`superseded`: **leave the block** and surface it as drift (§0 step 7). Never guess.
Commit the drained queue and card changes with the state commit (e.g. `chore(kanban): apply
amendments — CARD-007 superseded`); list what you applied.

## Legacy normalization (§0 step 5)

Normalize state from older lifecycle versions on disk:
- scalar **`pr_url: <url>` → `pr_urls: [<url>]`** with **`split_slices: 0`** (N=1); `pr_url: ""` →
  `pr_urls: []`.
- **`split_slices: 1` → `0`** — a carve of one is a no-op matching no row; `pr-splitter` never
  returns `1`, so a `1` is drift.
- scalar **`reworks: N` → `{implement: N}`** (rest `0`); missing `split` key reads as `0`.
- **`status: plan` → `status: design`** (an existing `plan.md` stays as designer input).
- any **non-enum status** (e.g. `awaiting-input`) → restore the card to the phase whose input it
  awaits and surface what was asked.
- a **`retro:`** field is inert (per-card retros consolidated into `/retro`).
- Cards at `implement` or later when the two-PR flow shipped have design docs on `main` already —
  **skip the design PR**, carry only the implementation PR.
- **A `test.md` or `review.md` with no `verdict:` header is legacy — delete it.** Every state-table
  row keys those docs on the `verdict:` header, so an unstamped doc matches **no** row and the card
  sits at `status: test`/`review` forever. `/migrate` cannot reach these (they live on a branch).
  Deleting is safe: the doc's absence is the "not yet run" state, so `card-tester`/the full panel
  re-runs and produces a stamped doc. **Do not infer a verdict from the old doc's prose** — a
  mis-inferred `pass` ships the very findings the panel raised. Report each doc you deleted.
- **A `*-check*.md` with no YAML-frontmatter `verdict:` (pre-0.5 `## Verdict` form) — same rule,
  same reason: delete it** on an in-flight card. The gate predicates key on the frontmatter, so the
  old form matches no row and a card parked at a gate stalls. Deletion re-arms "not yet checked";
  the checker re-runs and regenerates the doc in current form, spending nothing. Done cards' merged
  docs stay — `/retro` reads their body tables.

## Orphan-PR adoption (reconcile side)

The slice-ship re-entrancy check (`references/split-shipping.md`, step 0) may adopt a **MERGED**
orphan — a PR a dead pump created and the human merged before the next pump ran. Once its url is
appended to `pr_urls`, process it this same pump as any merged slice url (§0 step 3): tear down
slice `k`'s branch, reset the rework counters, open slice `k+1`. Report the adoption.

## Completeness backstop — the two-direction procedure (§0 step 3, k=N)

Runs when the last url merged (`k=N`, or `N` is 0/1), **BEFORE any teardown** (it checks the
original branch and worktree). The quick probe
(`git -C <worktree> diff --numstat origin/main...<original-branch>`, excluding `size_exclude`) being
**non-empty is not yet a verdict** — a squash/rebase merge leaves the merge base behind, so a
three-dot diff reports the branch's changes even when `main` holds every byte.

Re-ask content-first, over exactly the paths the branch touched (`split.md`'s `## Coverage`, or
`git -C <worktree> diff --no-renames --name-status origin/main...<original-branch>` for an unsplit
card), in **BOTH directions**:

1. **Unshipped additions** — `git -C <worktree> diff origin/main <original-branch> -- <those paths>`,
   reading **only the lines the branch has that `main` lacks**. (Lines `main` has and the branch
   lacks are *other cards'* work — not lost.)
2. **Unshipped deletions** — for every path the branch's `--no-renames --name-status` marked **`D`**,
   ask whether it **still exists on `origin/main`**: `git -C <worktree> cat-file -e origin/main:<path>`.
   A path the card deleted that is still on `main` is a deletion **no slice performed**, invisible to
   direction (1) — where a rename/refactor card loses work (new files ship, old ones never removed).
   `--no-renames` makes it askable (without it the rename is a single `R`, no `D`).

**Scope both questions to the branch's own touched paths, never the whole tree** — an unrelated file
`main` has that the branch never touched is another card's.

**Neither direction finds anything → `status: done`**, `phase: done`, `delivered` = merge date;
**append the card's `RETRO-INBOX.md` line exactly as §0 step 3's done-path does** (same commit);
**now** tear down the original worktree, delete the original branch **locally and on `origin`** (the
only moment either may be deleted), and any leftover slice worktrees. **Either direction finds
something → work was lost**: `status: blocked`, blocker `split incomplete — <original-branch> still
holds changes main does not, after all PRs merged` (name whether unshipped content, deletions, or
both), **keep the original branch and worktree** (local + remote — the only copy), surface **loudly**
(§7). A **serious defect** — the splitter dropped a change and `SPL-NO-LOSS` missed it.

## Un-actioned-findings check

Stated inline at `pump.md` §0 step 3 — it runs on every merged implementation PR, not only behind
this file's trigger.
