---
name: kanban
description: "Orchestrate the kanban board: reconcile merged PRs, schedule ready cards, run each through slice→design→implement→test→review→deliver via the card-* agents. Sole writer of BOARD.md, KNOWLEDGE.md, card.md. Safe under /loop. Run under Opus."
---

# /kanban — orchestrator & dashboard

You drive cards through the board, one **pump cycle** per invocation: reconcile merged PRs → load →
render → resolve gates/blockers → schedule & advance the card-* agents (in waves) → re-render → report.
Once a card leaves `backlog` you are its **sole writer** of `BOARD.md`, `KNOWLEDGE.md`, and every
`card.md`. Safe under `/loop`.

This file is a lean **front-door**: it runs the cheap pre-flight gate and, only when there is real work,
loads the full pump body. That keeps a quiet board under `/loop` from paying to load the whole state
machine on a pump that would do nothing.

## 0.0 Pre-flight gate (run this FIRST, before anything else)

Most pumps under `/loop` have nothing to do. Loading the board to discover that is the recurring cost
this gate removes. **Your very first action is the gate** (after one cheap read of `config.md`'s
`pump_gate` flag — `off`, default `on`, bypasses it: skip straight to "proceed to the pump body" below):
**dispatch the `pump-gate` agent (haiku)**, passing `board_dir` (default `docs/cards`), and do nothing
else until it returns. It runs the cheap probes — merges landed, open-PR CI/reviews, WIP slots,
dispatchable/driver cards, amendments — in its own cheap context and returns `decision: run | idle` with
a `summary`.

- **`decision: idle`** → print `idle — {summary.in_flight} in flight awaiting human/CI,
  {summary.backlog} in backlog` and **STOP**. Load nothing further — no pump body, no cards, no doctrine,
  no id-sets.
- **`decision: run`** → **proceed to the pump body**: read
  `${CLAUDE_PLUGIN_ROOT}/skills/kanban/references/pump.md` and execute it (§0 Reconcile → §7 Report,
  plus its dispatch/model table and Rules). You may thread `summary.merged_urls`/`ci_failing_urls` into
  the body's §0/§6 to skip re-probing PRs the gate already resolved; §0 re-derives authoritative git
  state regardless, so trusting them is an optimization, not a dependency. The gate's `git fetch origin
  main` updated the shared working tree — §0's fetch reuses it.

The gate **errs toward `run`** and writes no state, so a `run` you'd have called idle costs one pump and
nothing more; only *you* (in the pump body) reconcile, stamp verdicts, and mutate cards. If the gate
dispatch itself fails, treat it as `run` (never skip a pump on a tooling error).

**`pump_gate: off`** (default `on`) bypasses the gate entirely and goes straight to the pump body — a
debugging escape hatch, not the normal path.
