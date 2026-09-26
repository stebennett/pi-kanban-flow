# pi-kanban-flow

`pi-kanban-flow` is a Pi-native deterministic workflow package for:

```text
requirements → design → split decision → implement → review → ship
```

## Install and trust

Install a pinned Git ref or npm release with Pi's package manager, then restart Pi so the extension and skills are discovered:

```text
pi install git:github.com/stebennett/pi-kanban-flow@<tag-or-commit>
```

The repository must be trusted with Pi's saved `/trust` decision. Temporary approval and `defaultProjectTrust: always` do not satisfy the workflow's saved-trust requirement. Runtime prerequisites are Pi `>=0.85.0 <0.86.0`, Node `>=22.19.0`, Git `>=2.39.0`, GitHub CLI `>=2.45.0`, and macOS or maintained Linux. A canonical `origin` and protected `main` are required.

## One pump, one durable boundary

`/skill:kanban` invokes exactly one deterministic pump. The parent engine fetches fresh `origin/main`, reconciles state/design/product facts, acquires the common lock, selects at most one dependency-ready card, and runs only its legal next action. It stops at one boundary: a state PR, external PR, human decision, blocker, external wait, failure, or no-action result.

Board state is authoritative only after a human merges a marked state PR. The user manually reviews and merges state, design, and product PRs in their prescribed order. Open or proposed PRs never become board authority, and the pump never auto-merges, approves, dismisses, resolves review comments, or continues to a second card.

The normal unsplit lifecycle is:

```text
backlog → design_review → ready_for_implementation → implementing
→ implementation_review → ready_to_ship → shipping → done
```

A checked design is followed by the mandatory split decision. A valid split atomically replaces the source card with vertical backlog cards and rewires dependents; it does not create product work. A `no_split` decision creates a parent-managed product worktree. Grandfathered `split_required` cards require an explicit typed `proceed_unsplit` decision. Implementation is test-first, path-jailed, and limited to approved planned paths. Parent-owned command probes and every configured review lens inspect one immutable commit. One bounded implementation rework is supported, with append-only evidence. Shipping reuses one uniquely marked product PR and waits for CI/review/merge authority; merge reconciliation proves inclusion from fresh `origin/main` before `done`.

## Native commands

- `/skill:kanban-init` — propose the empty control plane through one state PR.
- `/skill:requirements` — produce and check requirements/cards with explicit approval.
- `/skill:kanban` — run one normal pump.
- `/skill:design`, `/skill:implement`, `/skill:review`, `/skill:ship` — request a phase diagnostically through the same coordinator; none can bypass scheduling or transitions.
- `/kanban-validate [--markers]` — read-only diagnostics.

`kanban_blocker_resolution` is a typed, human-only resolution surface. Noninteractive modes prepare or refuse a decision; they cannot implicitly approve `proceed_unsplit`.

## Trust, overrides, and models

Broad producer context requires saved project trust. Packaged agents are the defaults; a trusted project may override an agent through the configured project override location. Overrides are validated, hashed, reported in artifacts/reports, and can change behavior, so they are part of the review surface. Models inherit the active Pi parent provider/model/thinking level unless a validated project-level override selects another authenticated model. An unresolved override fails closed; there is no silent fallback.

Children return role-specific structured results. Strict checkers/reviewers receive immutable snapshots and read-only tools. Producers receive only their role's policy; implementers may use path-jailed package tools and named configured project commands. No child receives arbitrary shell, Git, GitHub, board, ID, transition, or durable-path authority. Commands are direct executable/argv invocations owned by the parent, with bounded and redacted evidence.

## Package contents and guarantees

The package manifest exposes `extensions/kanban-flow` and `skills/`. It includes all lifecycle runtime modules, Stage 4 skills, specialist agents, and doctrine assets. Tests, `reference/` fixtures, dispatch logs, snapshots, temporary worktrees, provider events, and other generated artifacts are excluded from packed installs. Asset resolution is tested from a checkout, symlink, pinned Git checkout, and npm-packed archive.

## Deferred behavior

This release intentionally does **not** provide an unattended loop controller, ADR files or indexes, post-review multi-PR split shipping, partial review-lens reruns, Claude-board migration, automatic human-review handling, automatic merging, retro/testing-level telemetry, or Windows support. Live provider authentication, live GitHub mutation, and unrun platform/version matrices remain environment-dependent evidence gaps; unknown external facts fail closed.

See `docs/spec-one-card-lifecycle.md` for the authoritative operational contract, `docs/stage-4-review-matrix.md` for crash/effect coverage, and `docs/checkpoint-stage-4-complete.md` for the Stage 5 handoff.
