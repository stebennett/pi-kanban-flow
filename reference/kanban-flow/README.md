# kanban-flow

A Claude Code plugin: an autonomous, card-driven kanban development system.

## Install

Add this repo as a plugin marketplace, then install `kanban-flow`.

## Use

1. In your project, run `/kanban-init` to scaffold `docs/cards/` (board, templates, config).
2. Edit `docs/cards/config.md` — set `spec_path`, adjust `layers`, set `gh_command` if you use a bot identity.
3. Run `/refine` to populate the backlog from your spec.
4. Run `/kanban` to drive cards through the board (safe under `/loop`).
5. When a new requirement lands mid-project, run `/requirement` — it interviews you, writes the requirement to your spec with a stable `REQ-NNN` id, slices it into cards, and reports what it invalidates on the board. Then run `/kanban` to apply it.

## Contents

- **Skills:** `kanban` (orchestrator), `refine` (whole-backlog intake), `requirement` (add/amend/supersede a single requirement on a running project), `req-ids` (sole authority for REQ ids in the spec), `retro` (process improvement), `adr` (ADR persistence), `kanban-init` (project scaffolder), `migrate` (one-time upgrade of an existing repo to plugin-owned doctrine).
- **Agents — producers:** `card-slicer`, `card-designer`, `card-implementer`, `card-deliverer`.
- **Agents — checkers:** `card-intake-checker`, `card-slice-checker`, `card-design-checker`, `card-deliver-checker`, plus `card-tester` and the `card-lens-reviewer` panel (together, the implementer's checkers). **Checkers are terminal — nothing checks a checker.** That is what stops the regress; the human is their backstop, at the intake and slice gates and at the two PR merges.
- **Templates:** the plugin-owned doctrine (`AGENT-PROTOCOL.md`, `lenses/` — shared etiquette/method plus one file per review lens — `checks/`, `INTAKE.md` — the card doctrine shared by `refine` and `requirement` — and the card/PR templates) that agents read **live from the plugin** — never copied into your repo, so a plugin update reaches every project. `/kanban-init` copies only `config.md`, an empty `PROTOCOL-ADDENDUM.md` (where `/retro` layers project-specific doctrine), and empty board starters.

## Every agent is checked

Each producing agent has a **checker** that verifies it, and checkers are **terminal** — nothing
checks a checker; the human is their backstop. Checkers write and mutate nothing; they return a
verdict the orchestrator persists and reworks against.

The doctrine — stable criterion ids, one cited verdict per criterion, findings that can't point at a
line dropped, `/retro` pruning/escalating by id — lives at **`templates/checks/`** (rationale in
**`RATIONALE.md`**). Blocking findings rework the producer against a per-producer `check_budget`;
`checks` can turn one off, and `/kanban` then warns every pump about what ships unchecked.

### The size budget

`size_limit` (default **500** changed lines including tests; exclusions via `size_exclude`) is the
hard ceiling, enforced at slice (`SLC-SIZE`, blocking — **forces a split**) and deliver (`DLV-SIZE`,
advisory — **proposes a split**). Details in **`templates/checks/`**; the intake path, where a
`right_sized` card is sized once, is in **`INTAKE.md` `## Check`**. Every card records
`estimated_lines` and `actual_lines` so `/retro` catches a systematic under-estimator.

Declared test-harness paths (`testing.harness_paths` in `config.md`) are excluded from the count —
harness is amortised infrastructure; test cases still count. Test doctrine distinguishes
determinism from hermeticity: unit/domain tests are hermetic, higher levels may use the project's
declared test environment (pinned, seeded, readiness-waited).

### Review happens before the PR

The lens panel (`card-lens-reviewer`, one agent per lens, in parallel) reviews the branch diff at the
**review** phase, in the worktree, **before any PR opens** — and blocking findings automatically
rework the implementer. The PR you open has already survived every lens.

No agent comments on a PR. `card-deliverer` is the only one that touches GitHub at all, and only to
push the branch and open the PR. On the PR you review normally: signal review-complete (submit a
review, or comment `REVIEWED`), and every comment you wrote gets addressed and answered with a commit
link. A healthy card needs exactly three actions from you: merge the design PR, complete a review,
merge the implementation PR.

### Test levels (opt-in)

Uncomment the `testing:` block in `config.md` to make integration/contract/functional (and, with
CI, journey/experience) testing first-class: cards **derive** the levels their layer owes, the
designer **selects or declines each in writing** (`DSG-LEVELS/SEAMS/DATA` check it), `card-tester`
runs the selected card-scope levels (zero tests = failure; environments via a trap-guarded
lifecycle; sonnet for the judgement), and the `tests` lens blocks any level gap the design didn't
decline. Unconfigured boards are byte-for-byte unchanged. Doctrine:
`templates/testing/LEVELS.md`, `templates/testing/DIAGNOSIS.md`; spec:
`docs/superpowers/specs/2026-07-23-kanban-testing-levels-design.md` in the marketplace repo.

Scope-`pr` levels (journeys, experience gates) ride the implementation PR's CI — the plugin's §6a
CI gate already refuses a red PR; flakes resolved by rerun land in `QUARANTINE.md` with a linked
defect card and an aging escalation; an optional `nightly_main` workflow probe files defect cards
for what leaked past the PRs. Doctrine: `templates/testing/JOURNEYS.md`.

With an `experience` level configured, `web`-layer cards get a static `[experience]` lens (states,
selectors, keyboard, a11y structure — it dispatches under every `review_panel` tier for web
cards); runtime gates (axe, Core Web Vitals) and the advisory judged artefact stay in CI per
`templates/testing/EXPERIENCE.md`.

## Tuning token cost

Two knobs and two budgets keep the system's token spend in hand:

- **`review_panel`** (`config.md`) — how many lens reviewers the review panel dispatches, and the
  panel is the single most expensive phase. `full` (default) runs the whole lens table; `standard`
  drops to acceptance, functionality, tests, security + the language lenses; `light` to acceptance,
  functionality + the language lenses. Use the reduced tiers on low-risk layers or a small team
  watching spend; keep `full` for `gate_layer` cards and anything security-sensitive (a `gate_layer`
  card under a reduced panel is warned in the report). A repo that never sets the key gets the full
  panel, unchanged.
- **Phase-doc length budgets** (`AGENT-PROTOCOL.md`, advisory) — `design.md` ≤150 lines,
  `implement.md` ≤80, `test.md` ≤60, a review lens's section ≤40, a checker's evidence one line per
  criterion. Over-budget is an advisory finding, not a block.
- **`PROTOCOL-ADDENDUM.md` size budget** — this file rides every dispatch, so keep it under **4 KB**,
  one line per rule.

**The Sonnet-orchestrator experiment (experimental; default unchanged).** The skill says *"Run under
Opus"*, and that stays the default. But after this optimization series the orchestrator is a
~14k-token explicit state machine — its decisions are table lookups, not open-ended reasoning — so
running `/kanban` under Sonnet is a plausible cost experiment. It is explicitly experimental: if you
try it, watch the first few pumps closely, especially **Reconcile** (§0) and the **completeness valve**
(§5) — the two places a weaker driver's degradation would surface first (a mis-read board, or a
rubber-stamped incomplete check). The default stays Opus.

### Which model to run `/kanban` under `/loop`

The session model matters only for the **orchestrator itself** — every dispatched agent's model is
pinned per dispatch by the skill's model table, whatever the session runs. Set it before starting the
loop (`/model opus`, or `claude --model opus`), then `/loop /kanban`.

- **Opus (recommended, the default).** The orchestrator's judgment calls — reconcile after odd merges,
  stamping verdicts, adjudicating dropped findings, the completeness valve — are exactly where a
  cheaper model rubber-stamps, and under `/loop` they run unattended with nobody watching. The
  **pre-flight gate** (§0.0) keeps the quiet-board cost contained: every pump's first action is a cheap
  `pump-gate` **haiku** agent that decides run-vs-idle from cheap probes (merges, WIP slots, open-PR
  CI/reviews, dispatchable and driver cards) in *its own* context — so an idle pump never loads the
  board into the Opus session at all. Set `pump_gate: off` in `config.md` to bypass it for debugging.
- **Sonnet (the experiment above).** Viable on a busy board where loop spend genuinely hurts, with
  the §0/§5 caveats; prefer shortening the loop interval on Opus over dropping the tier first — most
  of a loop's cost is busy pumps, and those are dominated by the dispatched agents, whose models
  don't change with the session.
- **Haiku: don't** — *for the orchestrator.* It executes the tables but misses the judgment the check
  layer leans on; a rubber-stamped valve is worse than no valve. (The pre-flight **gate** runs on haiku
  precisely because it makes no such judgment — it writes no state and errs toward `run`; RATIONALE.)

## Upgrading an existing repo

Doctrine and templates are **plugin-owned** and read live, so updating the plugin
updates every project automatically — no per-repo action for an uncustomized board.

A repo initialized by an **older** kanban-flow still has copies of the doctrine and
templates in its board dir; those copies are now ignored, and any local customization
in them stops taking effect. `/kanban` detects this and nudges you to run **`/migrate`**
— a one-time, idempotent cutover that deletes the redundant copies, folds any local
doctrine edits into `PROTOCOL-ADDENDUM.md`, preserves a customized template via
`template_overrides`, adds any new `config.md` keys, stamps `kanban_flow_version`, and
opens a PR for you to review and merge.
