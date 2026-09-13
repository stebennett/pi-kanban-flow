# Phase Agent Protocol

Every `card-*` phase agent MUST follow this protocol. It is the shared contract between the
`/kanban` orchestrator and the phase agents.

## On dispatch you receive
- `card_id`, `card_dir` (e.g. docs/cards/CARD-001-slug), `worktree` (absolute path to this card's git
  worktree), the full text of `card.md`, and the prior phase docs **your phase needs** (the
  orchestrator sends only those).
- **Testing values arrive only when the project configures them:** level definitions/commands, the
  derive map, the seam list, journeys, environment commands, and `templates/testing/*` doctrine
  paths. Their absence means the project has not opted in — never assume or invent them.
- **Doctrine paths:** the plugin's `AGENT-PROTOCOL.md` (this file) and the repo's
  `PROTOCOL-ADDENDUM.md`; `card-lens-reviewer` also receives `templates/lenses/_shared.md` +
  `<lens>.md`. Read the protocol here, then layer the addendum — never a `docs/cards/` copy.
- Exception: the **slice** phase runs before any worktree exists, so `card-slicer` gets no `worktree`
  but instead the card's current **dependents** (ids that `depends_on` it).
- A **rework** dispatch (implement phase only) adds the blocking findings from the tester, the
  reviewer, or a failing CI run (job + log excerpt); fix exactly those, and push when the dispatch
  notes the PR is already open.
- A **PR-comment** dispatch (implementation- or design-PR comments) carries the review-complete comment
  set (id, path, line, body; review-body items flagged summary) — address exactly those, never touch
  the threads; the orchestrator replies with a commit link, the human resolves.
- A **review** dispatch (`card-lens-reviewer`, one per lens, in parallel, at review) carries a `lens`
  and reviews the `worktree` branch diff — before any PR exists.
- A **check** dispatch (a `card-*-checker`) carries the producer's inputs and its output artifact, and
  the plugin's `templates/checks/_method.md` + `templates/checks/<target>.md` paths. The checker
  contract lives in `checks/_method.md`.
- A **deliver** dispatch names its mode: `design` (push the docs+ADRs branch, open the design PR)
  or `implementation` (rebase, confirm green, push, open the implementation PR).

## Always, before doing anything
1. Read `docs/cards/KNOWLEDGE.md` in full, then `card.md` and the phase docs you were given.
2. Read the spec **selectively**: slice and design read whatever they need to judge/design; every
   later phase reads only the sections `design.md` cites under `## Spec references` — never re-read the
   whole spec when the design names its sources.

## Boundaries (sole-writer invariant)
- You MUST NOT write or edit `BOARD.md`, `KNOWLEDGE.md`, or any `card.md`. The orchestrator owns them.
- You MUST NOT write your phase doc to disk. You RETURN its full markdown as `phase_doc` (below);
  the orchestrator persists it **on the card's current branch** — slice/design docs and ADRs ride the
  **design PR**, implement/test/review docs ride the **implementation PR**. The design PR merges before
  the implementation branch is cut, so merged designs and ADRs reach `main` for every later card.
- You MAY create and edit **code** files — but only inside `worktree` (absolute paths under it). The
  slice and design phases produce no code; a design branch is docs-only.
- **GitHub is off-limits to phase agents, with exactly one exception:** the deliver phase pushes the
  branch and opens the PR. The review panel runs **before** the PR opens, against the worktree diff,
  and returns findings to the orchestrator. `card-deliver-checker` reads the PR (`gh pr view`,
  `gh pr checks`) but mutates nothing. No agent ever comments, approves, requests changes, replies to,
  resolves, or reacts to a PR thread — that and the review-complete signal belong to the human; the
  orchestrator alone replies with commit links.

## Doctrine (expertise every agent carries)
Standing knowledge distilled from expert review of this codebase and domain:
- **The spec outranks your training.** Its acceptance criteria are binding. When domain knowledge from
  memory disagrees with the project spec (`spec_path` in `config.md`), the spec wins — check it, don't
  recall it.
- **Numeric precision is a common landmine.** Binary floats and language-default rounding introduce
  representation error, so where the spec defines exact rounding or exact-decimal arithmetic, use the
  project's designated decimal/rounding primitive — never a language default (Python's `round()`) or
  binary `float`, and never compare them with float tolerance.
- **Parallel derived values, never blended.** When the spec defines two related but distinct computed
  quantities for different purposes, using one where the other belongs is a blocking defect. Name which
  one you mean, every time.
- **As-of semantics.** Per-record figures use the values in effect on that record's date, from the
  snapshot stored on the record — not today's values or the current reference data. Replay is
  chronological; same-date ties need a deterministic order (date, then id).
- **Determinism everywhere; isolation by level.** Fixed clock, fixed seed, ordered queries, always.
  A flaky test is a failing test — never re-run it to green. Unit and domain tests reach no I/O and
  no network. Integration, functional and journey tests MAY use real dependencies brought up by the
  project's declared test environment — and must still be deterministic: pinned images, seeded data,
  no public internet, no wall-clock dependence, and no fixed sleeps — wait on a readiness condition.
- **Fakes only at declared seams.** A fake, mock or stub is permitted only at a boundary declared in
  the project's seam list (it arrives in your dispatch when the project declares one; absent, only
  the core-logic-tests-need-no-mocks rule applies). A fake anywhere else is a defect — the system
  under test wearing a disguise.
- **Evidence over claims.** Paste the command and real output; never report a result you did not
  observe. Smallest change that satisfies the criteria; reuse before writing new (YAGNI).

## Your structured return (your final message — nothing else)
Emit exactly one fenced ```result block, valid YAML:

```result
status: complete            # complete | blocked | needs-input
phase: <slice|design|implement|test|review|deliver|check>
card: CARD-NNN
gate: none                  # none | design | slice  (this phase's gate; never "deliver")
summary:
  - "2–4 bullets a human reads at the gate or in the board"
open_questions:             # required when status is needs-input; else []
  - "Blocking question for the driver"
blockers:                   # required when status is blocked; else []
  - "What is broken and the evidence (command + output excerpt)"
knowledge:                  # may be empty — but record any trap or convention your phase hit
  - scope: repo             # repo | personal
    section: Conventions    # Conventions | Gotchas | Glossary  (repo scope; decisions are ADRs, below)
    entry: "Fact to record, prefixed mentally with [CARD-NNN]"
proposed_adrs:              # may be empty — significant architecture/technology decisions only
  - title: "Short decision title"
    context: "The forces at play"
    decision: "What we decided"
    consequences: "What becomes easier/harder"
    supersedes: []          # optional ADR ids this decision replaces, e.g. [ADR-0003]
proposed_cards: []          # SLICE PHASE ONLY (gate: slice) — the child cards to create; full field shape in card-slicer.md
dependents_rewire: []       # SLICE PHASE ONLY — how each card that depends_on the parent is rewired; full shape in card-slicer.md
phase_doc: |
  <full markdown body of this phase's doc — the orchestrator writes it to card_dir/<phase>.md>
```

**Phase-doc length budgets** (advisory — over-budget is an advisory finding): `design.md` ≤150 lines,
`implement.md` ≤80, `test.md` ≤80 (per-level gate sections included); a checker's evidence is one
line per criterion; a review lens's section is ≤40 lines.

- `status: needs-input` → orchestrator surfaces `open_questions` to the driver and re-dispatches you with answers.
- `status: blocked` from the **tester or reviewer** with actionable findings → orchestrator auto-re-dispatches the implementer in rework mode, up to `check_budget.implement` loops (`config.md`; never assume a number), then parks the card.
- `status: blocked` from any other phase → orchestrator parks the card with `blockers` shown on the board.
- `status: complete` + `gate: slice` (slice phase only) → orchestrator applies the gate policy: auto-apply the split, or surface `proposed_cards` + `dependents_rewire` to the driver.
- `status: complete` + `gate: design` → orchestrator applies gate policy: auto-approve, or stop for the driver (domain-layer cards by default).
- The deliver gate triggers when a card reaches `deliver` status, not by any agent `gate` value; no agent emits `gate: deliver`.

## Architecture Decision Records (ADRs)

Significant **architecture or technology decisions** (framework/library choices, data-model
invariants, cross-cutting patterns, expensive-to-reverse trade-offs) are recorded as ADRs in
`docs/adrs/` (Cognitect format: Title · Context · Decision · Status · Consequences), not
`KNOWLEDGE.md`. Small conventions → `KNOWLEDGE.md ## Conventions`; traps → `## Gotchas`.
- Any phase agent MAY return `proposed_adrs` when it makes or surfaces such a decision. You only
  *propose*: the orchestrator persists each ADR (numbering, file, index, `adrs:` card link) via the
  `adr` skill. **Design-phase ADRs are written once the design *check* passes** —
  `card-design-checker`'s `verdict: pass`, before the design gate and the design PR; the orchestrator
  holds them unwritten until then (the `adr` skill reserves a number on write; see `RATIONALE.md`).
- **A design-phase agent records each proposal in its `phase_doc` — a `## Proposed ADRs` section
  (title, context, decision, consequences, any `supersedes`) — as well as in `proposed_adrs`.** The
  result block is not persisted and a pump can end during the checker's hold, so the durable copy the
  checker verdicts and the orchestrator routes from must be on disk. (Why this matters: `RATIONALE.md`.)
- Read `docs/adrs/README.md`'s index before proposing — to reverse a decision, propose a new ADR with
  `supersedes: [ADR-NNNN]`; never duplicate a standing one.
