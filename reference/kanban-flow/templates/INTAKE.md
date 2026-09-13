# Intake doctrine — turning requirements into cards

Read **live from the plugin** by `/refine` (whole-backlog intake) and `/requirement`
(single-requirement intake). Never copied into a project.

Requirement **identity** — REQ ids, spec headings, supersede markers — is **not** here.
That belongs to the `req-ids` skill. This file is about **cards**.

## Card numbering

`CARD-NNN`, zero-padded to three digits. The next id is `max + 1` across existing
`docs/cards/CARD-*` directories; start at `CARD-001` when there are none. Ids are never
reused and never renumbered. A card lives at `docs/cards/CARD-NNN-<slug>/card.md`, where
`<slug>` is a short kebab-case of the title.

## Slice vertically

Each card must be **independently shippable and testable**. Prefer a thin vertical slice
over a horizontal layer. Apply YAGNI — propose only what the requirement actually demands.

## Classify `type`

- `feature` — a new user-facing capability
- `task` — internal scaffolding or refactor, no direct user value
- `defect` — fixing broken behaviour, **including behaviour a changed requirement has
  made wrong**

## Annotate `layer`

One of `config.layers`. Tag a vertical slice by the **lowest** layer where it does
substantive work — a card adding a domain rule plus the API endpoint that exposes it is
`domain`. `/kanban` orders ready cards by position in that list, so this drives scheduling.

## Link `reqs`

Every card carries `reqs: [REQ-NNN, …]` — the requirement ids it implements. This is the
machine-readable index `/requirement` uses for impact analysis.

**An empty `reqs` means _unknown_, not _unaffected_.** Only cards written before this
field existed should be empty. Never propose a new card without at least one REQ id.

## Write acceptance criteria

Observable, testable bullets. Each cites the requirement it enforces:

```markdown
- [ ] Export produces one CSV row per card, with id, title, status and milestone (REQ-012)
- [ ] A user without read access on the board gets 403 (REQ-012)
```

## Set `depends_on`

The card ids that must be `done` before this card starts — an `api` card depends on its
`domain` and `db` cards. **Keep the graph acyclic.**

## Set `right_sized`

`true` **only** when the card is obviously atomic: a single small change you cannot
imagine splitting. `true` makes `/kanban` skip the slice phase entirely, so use it only
when you are sure. Otherwise leave it `""` and the slice phase decides.

You are the **coarse** slicer. `/kanban`'s `card-slicer` re-checks every non-right-sized
card at pickup and splits anything still too big — so do not agonise over perfect
atomicity here.

## Milestones

A milestone is a **delivery increment** — a coherent set of cards that together ship a
capability. (Distinct from a card's workflow *phase*, slice→deliver.) `MILESTONES.md`
holds one `## M<N> — <title>` heading per milestone **in delivery order**, each with
`**Goal:**` (one line), `**Exit criteria:**` (observable), and `**Cards:**` (member ids).

Two invariants, validated **before** you present a proposal:

1. **Coverage** — every **live** card, new and existing, belongs to **exactly one**
   milestone. None orphaned, none in two.

   **Terminal cards belong to no milestone.** `/kanban` computes a milestone's progress as
   `done members / total members`, and a `split` or `superseded` card can never be `done` —
   leaving one on a `**Cards:**` line makes that milestone permanently unreachable. When a
   card becomes terminal it **leaves** its milestone's `**Cards:**` line, and its
   successor(s) — the split children, or the replacement card — take its place. (`/kanban`
   does this swap itself for splits; for supersedes, `/requirement` does it at the moment
   it queues the amendment.)
2. **Dependency consistency** — no card may `depends_on` a card in a **later** milestone.
   Same or earlier is fine.

Report and fix any violation before presenting — rework the grouping or the card's
milestone until both hold.

`/refine` and `/requirement` are the only writers of `MILESTONES.md`. `/kanban` reads it
and never writes it, except for the mechanical parent→children swap on an applied split.

## Check

Both `/refine` and `/requirement` run this before showing the driver anything — one
protocol, run per this section.

Unless `config.md`'s `checks.intake` is `off`, dispatch **`card-intake-checker`** (opus)
with: the proposed cards, their milestone placement, the existing board's cards and
milestones, the requirement(s) in scope, `spec_path`, **`size_limit` and `size_exclude`**
(the ceiling and exclusions for `INT-SIZED`), and the doctrine paths it reads —
`${CLAUDE_PLUGIN_ROOT}/templates/AGENT-PROTOCOL.md`,
`${CLAUDE_PLUGIN_ROOT}/templates/checks/_method.md`,
`${CLAUDE_PLUGIN_ROOT}/templates/checks/intake.md`,
`${CLAUDE_PLUGIN_ROOT}/templates/INTAKE.md`, and `<board_dir>/PROTOCOL-ADDENDUM.md`.

**Budget loop.** `verdict: fail` → rework the proposal against the blocking findings
**verbatim** and re-check, up to `check_budget.intake` (default 2). Budget exhausted →
present anyway, the unresolved findings shown to the driver as open questions — never
silently. `verdict: pass` → proceed, showing the advisory findings alongside the proposal.

**Persist `estimated_lines` onto every card** from the checker's `INT-SIZED` output.
**Never leave it empty:** a card born `right_sized: true` skips the slice phase, so
`SLC-SIZE` never runs — this is its only pre-code size check, and the sole moment its
estimate can be recorded. Empty, and `DLV-SIZE` has no baseline for `actual_lines` and
`/retro`'s under-estimation signal loses the card. (`checks.intake: off` → no estimate
exists; tell the driver those cards reach the board unsized.)

**Persist the report:** write the checker's `phase_doc` to
`<board_dir>/intake-checks/YYYY-MM-DD-<slug>.md` (`<slug>` naming this run), creating the
directory if needed, and commit it with the cards. `/retro` aggregates every check doc **by
criterion id** and reads this directory — without it the `INT-*` verdicts leave no durable
record. Persist a budget-exhausted failing run too; it is the most informative one.

## Never

- Bundle multiple cards into one `card.md`. One card = one file.
- Write `BOARD.md` or `KNOWLEDGE.md` — `/kanban` is their sole writer.
- Touch a card that is **not** in `backlog`. A card beyond backlog owns a branch, a
  worktree and possibly an open PR; only `/kanban` may change it. `/requirement` reaches
  those cards through the amendment queue instead.
- Create branches or worktrees, or write code. Intake is intake.
