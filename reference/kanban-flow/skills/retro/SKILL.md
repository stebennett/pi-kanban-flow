---
name: retro
description: Continuous process improvement for a kanban-flow project. Mines done cards' phase docs, check docs, and flow metrics for systemic patterns, then ships approved process changes as a PR.
---

# /retro — process improvement loop

You improve the delivery system from its own record — the phase docs — so the *next* cards are cheaper and better. Improve the system, not the cards; code fixes go on defect cards via `/refine`.

## 1. Gather evidence
Cover every `status: done` card (and any long-`blocked` card) not in a previous retro (`docs/cards/RETRO.md`).

**Start from the index.** Read `<board_dir>/RETRO-INBOX.md` FIRST — one line per done card, appended by `/kanban` at `done`:
`CARD-NNN | delivered YYYY-MM-DD | reworks {slice:0,design:1,implement:2,split:0,deliver:0} | elapsed Nd | est/actual lines E/A | slices N | human-comments M | levels S/D`
The line is a triage index, not a substitute for the docs. **Open a card's full phase docs only when its line flags something** — any `reworks > 0`, an est/actual divergence, `slices > 1`, or `human-comments > 0`; a card clean on every field is covered with no deep read. A done card with **no line at all** (pre-0.5, or an inbox gap) is always deep-read. For a flagged card, read:

**The system's trace:**
- `card.md` metrics: `reworks` (the per-producer map — *which* producer, not the total), `started` → `delivered` elapsed, phase count, `estimated_lines` vs `actual_lines`.
- Phase docs `slice.md` … `deliver.md` — especially `## Rework` in `implement.md`, blocking findings in `review.md`, failures in `test.md`, `## Deviations from design`. On a split card the deliver record is per slice (`deliver-1.md` … `deliver-N.md`); `split.md` + `split-acceptance.md` record the carve and the `[acceptance]` lens's per-slice verdicts.
- **The check docs:** every `*-check*.md` and `split-acceptance.md` for the card (per-slice `deliver-check-<k>.md` included) — **glob, never hardcode**. Each opens with YAML frontmatter `verdict:` + a `criteria: {ID: pass|fail|na}` map: **grep those maps for the by-criterion tally (§2), not the whole doc** — open a body only when a verdict needs its evidence. (A doc with no frontmatter map is pre-0.5 — read its body's criteria table for the tally instead.) `SPL-*` ids feed that tally like `SLC-*`/`DSG-*`/`DLV-*`.
- **The intake check reports** — `{board_dir}/intake-checks/YYYY-MM-DD-<slug>.md`, written by `/refine`/`/requirement`; the **`INT-*`** and your `LOCAL-` intake verdicts live here, tunable nowhere else. Grep their `criteria:` maps by id too; read **every report covering any card in this retro's set**.
- `KNOWLEDGE.md` (already captured) and `docs/cards/` git history for gate revisions and blocked episodes.

**The human's trace — every channel, every card (highest-value):**
1. `card_dir/feedback.md` and board-level `docs/cards/feedback.md` — the driver's verbatim words at gates, `needs-input` answers, unblock guidance.
2. **Both PRs'** comment threads — design (`design_pr_url`) and implementation (`pr_url`): `{gh_command} pr view <url> --json comments,reviews,state` plus `{gh_command} api .../pulls/{n}/comments`; both urls stay on done cards (legacy: recover PR numbers from merge subjects). The panel runs pre-PR (findings in `review.md`), so **every remaining PR comment is human-authored.** Extract: (a) the human's own review comments (each something no agent or checker caught) and whether the orchestrator replied `[kanban] Addressed …` or `[kanban] Not actioned — <reason>` (a gap the machine couldn't carry out); (b) everything on the **design PR** (design feedback; is the designer arriving review-ready?); (c) human review verdicts, the review-complete signal (submitted review or `REVIEWED`), any PR closed unmerged.
3. Gate outcomes at manual gates: approved first-time vs revised.

**Coverage is verifiable, not assumed:** the retro is not complete until every channel above is read for every covered card. `RETRO.md` records each channel per card and what it held (explicit empties included, "no feedback.md"), so a skipped channel shows as a gap.

## 2. Find systemic patterns, not incidents
Ask, XP/lean style — **human signal first**:
- **What does the driver keep having to say?** Feedback repeated across 2+ cards is a prompt defect, not a card fact — recurring design-gate revisions → encode that judgment into the designer prompt; repeated `needs-input` of the same shape → the upstream phase should resolve or ask it earlier.
- **What did the human catch that the system missed?** The sharpest signal — the panel runs **before** the PR, so every human PR comment is something the panel and three checkers missed. Map each to its lane — a lens (extend its Walk/Red flags), a checker (a `LOCAL-` criterion, or report a plugin one), or the design check/designer prompt for a late design objection.
- **Rework causes:** what class of finding keeps sending cards back? (e.g. lint failing at test → the implementer should run it first.)
- **Flow:** where do cards wait? Which phase is the bottleneck? Are splits happening at slice that `/refine` should have made at intake?
- **Waste:** phases that add nothing for a card type; docs nobody reads downstream; spec re-reads the `## Spec references` rule should prevent.
- **Knowledge leaks:** traps hit twice because no `knowledge` entry was recorded the first time.
- **Gate value:** did manual gates change outcomes? Did auto gates let anything bad through to PR review?
- **Panel signal:** per lens in `review.md`, how many **blocking** findings, and did they hold? Blockers that keep landing point at an upstream phase to strengthen; a lens that never blocks needs a sharper brief in `templates/lenses/<lens>.md` or retirement; a lens the implementer keeps rebutting is miscalibrated — tighten its **Don't flag**.
- **Is the check layer earning its keep?** From the §1 by-criterion tally (across every covered card's check docs and intake reports) — three signals, three *different* remedies: a criterion that **never fails** isn't paying its dispatch → prune (`LOCAL-` you own, plugin you report — §3); one that **fails on most cards** means the **producer** is wrong → edit that producer's prompt/doctrine, not more checking (RATIONALE `## /retro`); a defect that **reached the human or shipped uncaught** → propose a new criterion, with an id, in the right section.
- **Are levels being declined into oblivion?** From `design.md` `### Levels` blocks and
  `DSG-LEVELS` verdicts across covered cards: the deferral rate per level. Ninety percent of cards
  declining `journey` is either an honest architecture fact or the old escape hatch wearing a
  rationale — read the rationales and decide which. Tally level-gate blockers by classification
  (`test.md` `## Levels`): recurring `environment` blockers are a harness card, not a card defect;
  recurring `test` classifications point at the designer's examples, not the implementer.
 Read `QUARANTINE.md` ages (an aging row is a card nobody pulled), nightly-probe defect filings
  (the escaped-defect feed — the real measure of whether any of this works), and whether flake
  rate breaches `testing.telemetry.flake_rate_max` — all advisory, all human-decided.
- **Who is under-estimating — the slicer, or intake?** Compare `estimated_lines` with `actual_lines`; tally the slicer (`SLC-SIZE`, sliced cards) and intake (`INT-SIZED`, `right_sized: true` cards) populations **separately** and aim each remedy at the estimator that made the call (RATIONALE `## /retro`). A **`pr-splitter` firing** (`split_slices > 0`) is that miss surfacing post-code — fix the estimator, never the splitter. A **refusal** (`split_slices: 0`) is a **design** signal (entangled code) — route a recurring one to a `KNOWLEDGE.md` Gotcha or a card aimed at the boundaries `split.md`'s `## Verdict` names.
- **Which checker rubber-stamps?** Thin `evidence` on a passing criterion ("looks complete") is skimming — the Method demands evidence of what was checked.

## 3. Answer the four questions, then propose changes
Frame the findings as the classic four, **every bullet citing a concrete artifact** (a phase-doc line, feedback.md, a PR comment, a commit): *What went well? What went wrong? What did we learn? What should we change?* If any of the first three has an answer, at least one concrete change must follow — never manufacture a finding.

Each change is the **smallest edit that prevents recurrence**, shaped as `target` (exact file), `kind` (`skill | agent | protocol | lens | knowledge | template | board-tunable | card`), an evidence-linked `rationale`, and the exact `edit`:
- `KNOWLEDGE.md` entries (Conventions/Gotchas) — for content lessons. Significant architecture/technology decisions are **not** retro output — they belong in `docs/adrs/` via a phase agent's `proposed_adrs`.
- Process lessons by scope: **project-specific** → append to `<board_dir>/PROTOCOL-ADDENDUM.md` (prefix `[retro-YYYY-MM-DD]`; layers on plugin doctrine for this repo only). **Universal** ones — the plugin's `AGENT-PROTOCOL.md`, `templates/lenses/`, `templates/checks/`, templates, agents, skills — are **never edited in place**: describe the change and flag it as a **plugin PR**. `BOARD.md` header tunables (WIP limit, gate policy) stay editable in-repo.
- **Check criteria — bounded authority.** Add/edit/prune **`LOCAL-`** criteria in `<board_dir>/PROTOCOL-ADDENDUM.md` under a `## Check criteria — <target>` heading (`target` ∈ `intake | slice | design | split | deliver`), each with a stable never-reused `LOCAL-` id, shipped in your PR. A **plugin** criterion you may only *report* for the driver (e.g. "`SLC-NO-LOSS` failed on 6 of 8 splits — the slicer's prompt is the problem, not the check").
- New `defect`/`task` cards (via `/refine`) — for product problems; do not fix product code here.
**Non-duplication check:** before proposing, confirm the rule isn't already in the target (check `docs/adrs/README.md` for standing decisions). If the only improvement already exists, propose nothing.

Draft the `## Retro YYYY-MM-DD` section (§4's contract) and present **that draft** to the driver — metrics table, coverage table, four answers, changes with rationale — iterating until approved. Do not re-render its content a second time.

## 4. Apply
- Append approved KNOWLEDGE entries (prefix `[retro-YYYY-MM-DD]`).
- Write `docs/cards/RETRO.md` — append the approved `## Retro YYYY-MM-DD` section (cards covered, the per-card **channel coverage** table from §1, metrics, the four answers, changes made — including proposed-but-rejected ones).
- Apply approved **in-repo** edits (`PROTOCOL-ADDENDUM.md` appends, `BOARD.md` tunables) **on a branch** `task/retro-YYYY-MM-DD` — Conventional Commits, push, open a PR against this project's `main` via `{gh_command} pr create`. **Universal lessons** are **not** committed here — only recorded in `RETRO.md` and surfaced as a proposed **plugin PR**.

## Rules
- Evidence first: every proposed change cites the cards/docs/comments that motivated it.
- No human input left behind: every §1 channel read for every covered card, coverage recorded in RETRO.md.
- Small batches: prefer 2–4 high-leverage changes over a rewrite.
- Never edit card status, `BOARD.md` state, or `MILESTONES.md` — `/kanban` and `/refine` own those.
- Never change the product spec or acceptance criteria — product truth lives at `spec_path`.
