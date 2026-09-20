# Stage 4 completion checkpoint

**Status:** Stage 4 one-card lifecycle implementation complete; ready for Stage 5 hardening
**Branch:** `stage-4/unit-13-completion`
**Base:** `stage-4/unit-12-acceptance` (`5238eb0abcde3fb5bc8a0b09114b9d5d598c0a17`)

## Scope and authority

Stage 4 provides a deterministic, manually invoked one-card pump. Every pump fetches and reconciles fresh `origin/main`, acquires the common lock, selects at most one eligible card, and stops at its first durable boundary. Board state is authoritative only after a human merges the marked state PR. Design and product PRs are separate external evidence and never replace a state transaction.

The normal unsplit path is:

```text
backlog → design_review → ready_for_implementation → implementing
→ implementation_review → ready_to_ship → shipping → done
```

The design phase writes and checks one exact design path before opening a design PR. The mandatory pre-code split decision either creates validated replacement backlog cards atomically, blocks a grandfathered `split_required` result until explicit `proceed_unsplit`, or creates a parent-managed product branch. Implementation edits only approved product paths with named configured commands. Parent probes and an immutable review panel run before shipping. One blocking implementation rework is supported; all attempts and findings remain append-only. Product merge is reconciled from GitHub plus fresh-main reachability before the final state transition to `done`.

## Delivered modules and assets

- `extensions/kanban-flow/engine/` — pump, scheduler, transitions, rendering, and reconciliation.
- `extensions/kanban-flow/lifecycle/` — criteria, artifacts, design, split, implementation, review, ship, and pure effects.
- `extensions/kanban-flow/git/` — deterministic managed worktrees.
- `extensions/kanban-flow/agents/` — trust, policy, snapshots, direct processes, path-jailed tools, named commands, and structured results.
- `extensions/kanban-flow/state-pr/` — markers, exact Git transactions, and GitHub adapters.
- `extensions/kanban-flow/tools/` — one-pump and typed blocker-resolution surfaces.
- `agents/` — design producer/checker, split decider, implementer, ship producer/checker, and requirements roles.
- `skills/` — `kanban`, `design`, `implement`, `review`, `ship`, initialization, requirements, and migration front doors.

All skills are thin requests to the same coordinator. Children never own IDs, scheduling, board state, transitions, commands, Git, GitHub, branches, commits, or durable paths. Saved project trust is required for broad trusted context. Models inherit the active parent by default; validated project overrides and effective identities are reported.

## Operation and merge responsibilities

A user invokes `/skill:kanban` once per pump. The engine owns lock heartbeat, fresh fetch, authority reconciliation, eligibility, IDs, candidate validation, exact staging, state PR creation, and stable reports. The user reviews and manually merges state, design, and product PRs in their prescribed order. Open PRs are waits, not board authority. Pending CI or human review is a later-pump wait; ambiguous, closed-unmerged, unreachable, or provider-unknown facts fail closed. Lock loss, child failure, command failure, and cleanup failure never infer success.

Phase skills are diagnostic requests only. `/skill:design`, `/skill:implement`, `/skill:review`, and `/skill:ship` cannot choose another card or bypass the legal next action. `kanban_blocker_resolution` records only an explicit typed human decision, and never continues the workflow in that pump.

## Evidence and validation

The automated acceptance suite covers the real-Git one-card lifecycle, one bounded implementation rework, split validation and dependency rewiring, worktree/path enforcement, direct command probes, immutable review fanout, product PR recovery, state reconciliation, lock loss, and Pi/package surfaces. The Stage 4 review matrix (`docs/stage-4-review-matrix.md`) indexes durable effects and crash windows.

Validation run on this completion branch:

```text
npm run typecheck   # pass
npm test            # 189 tests: 180 passed, 9 explicit opt-in skips
npm run package    # pass (npm pack --dry-run)
npm run package:check # pass
 git diff --check   # pass
```

The package boundary includes every Stage 4 runtime module, agent, doctrine, and skill and excludes `test/`, `reference/`, operation logs, snapshots, worktrees, and provider events. Checkout, symlink, pinned-Git, and packed-install asset resolution are covered by package tests.

## Deferred and known gaps

The following are deliberately deferred: unattended looping; ADR files/indexes; post-review multi-PR split shipping; partial review-lens reruns; Claude-board migration; automatic handling of human review comments, approvals, or dismissals; retro/testing-level features; Windows; and automatic merge. Live paid-provider runs, live GitHub mutation, Linux/minimum-version matrices, and the opt-in sibling terminating-tool Pi spike remain environment-dependent evidence gaps; the engine fails closed when they cannot be proved.

## Stage 5 handoff

Stage 5 starts from this checkpoint and should harden interrupted-run and closed-PR recovery with additional real-provider-independent scenarios first. Any expansion of looping, partial reruns, ADR persistence, migration, or post-review splitting requires an updated specification and focused authority-boundary tests before implementation.
