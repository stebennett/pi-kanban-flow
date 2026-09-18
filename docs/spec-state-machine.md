# State machine specification

## Purpose

Define legal durable card transitions. Agent execution is transient. A scheduled pump proposes at most one final state transaction for one selected card; a reconciliation-only pump selects none, and an explicitly approved requirements transaction may atomically affect multiple cards.

## Transaction rule

A pump starts from authoritative `origin/main` and performs reconciliation before workflow selection. If reconciliation requires any durable board mutation, the pump proposes only those reconciliation effects in one state PR and stops; it does not select or dispatch a card workflow. Only when reconciliation produces no durable mutation may the pump select at most one card workflow and propose one final durable transition in one state PR. Intermediate agent activity is not persisted as a status. Once a state PR is opened, the pump stops. No later pump relies on that transition until it merges.

External actions completed before the state PR—such as opening a design or product PR—use operation markers so a retry can discover them idempotently.

## Statuses

| Status | Meaning |
|---|---|
| `backlog` | Card has not started and awaits dependencies and design selection. |
| `designing` | Design production or rework is the next action. No child is implied to be currently running. |
| `design_review` | Design PR is open and awaits human merge/reconciliation. |
| `ready_for_implementation` | Design PR merged; split decision is next. |
| `implementing` | Split decision passed and the product branch is established for implementation/rework. A validated local worktree is derived at runtime. |
| `implementation_review` | Implementation completed; objective checks and review lenses are next. |
| `ready_to_ship` | Review passed; product PR is next. |
| `shipping` | Product PR is open and awaits CI/review/merge reconciliation. |
| `done` | Product PR merged and final state transaction merged. |
| `replaced` | Card was atomically replaced by split cards. Terminal. |

`blocked` is a nullable card flag, not a status. A blocked card retains its durable status and is excluded from scheduling until explicitly resolved.

## Legal transition table

| From | To | Trigger and work in this pump | Required final effects | Boundary |
|---|---|---|---|---|
| none | `backlog` | approved requirements workflow creates card | card, active requirement links, AC IDs, dependencies | state PR |
| `backlog` | `design_review` | first design producer returns content; parent writes/commits it; independent checker passes against that commit; design PR is opened | design branch/PR metadata; result artifacts; `started_at` | state PR |
| `backlog` | `designing` | first design checker requests changes and design budget remains | `started_at`; findings; design rework increment; reusable marked design branch | state PR |
| `backlog` | `backlog` + blocked flag | design cannot start because required human input or environment is unavailable | blocker and evidence; no design metadata is inferred | state PR |
| `designing` | `design_review` | design producer reworks content; independent checker passes against the new immutable commit; design PR is opened or a valid marked open PR is reused | updated result artifacts and marked design PR metadata | state PR |
| `designing` | `designing` | design checker requests changes and design budget remains | findings; design rework increment; reusable marked design branch | state PR |
| `designing` | same + blocked flag | producer/checker needs human input, environment blocks, or design budget is exhausted | blocker and evidence | state PR |
| `design_review` | `ready_for_implementation` | reconciler proves design PR merged | approved design commit and merge evidence | reconciliation-only state PR |
| `design_review` | `designing` | design PR closed unmerged, design counter is below its limit, and retry is valid | closed PR evidence; design rework increment | reconciliation-only state PR |
| `design_review` | `design_review` + blocked flag | design PR ambiguous or design rework budget exhausted | blocker and evidence | reconciliation-only state PR |
| `backlog` or `designing` | `ready_for_implementation` | explicit adoption after a closed/unrecorded state transaction proves the checked design PR already merged and its merge is on `origin/main` | complete design artifacts, marked merged PR, approved design commit, recovery history | recovery-only state PR |
| `ready_for_implementation` | `implementing` | split-decision agent returns `no_split`, or a grandfathered `split_required` result has an explicit `proceed_unsplit` override; product branch and its local worktree are created | split result/override and deterministic product branch metadata; the local worktree path is not persisted | state PR |
| `ready_for_implementation` | `replaced` plus new `backlog` cards | non-grandfathered split-decision agent returns valid `split_required` | original `replacement_reason: split_decision`; replacement cards and dependencies rewired atomically | state PR |
| `ready_for_implementation` | same + blocked flag | split decision needs human input or fails validation, or a grandfathered card receives `split_required` without a human override | split result when valid; blocker and evidence | state PR |
| `implementing` | `implementation_review` | implementer completes and commits product work | implementation result and immutable head commit | state PR |
| `implementing` | same + blocked flag | implementer/environment needs intervention | blocker and evidence | state PR |
| `implementation_review` | `ready_to_ship` | engine-owned tests pass and independent review lenses pass | probe/reviewer results and reviewed commit | state PR |
| `implementation_review` | `implementing` | blocking findings and implementation budget remains | findings; rework increment | state PR |
| `implementation_review` | same + blocked flag | checks inconclusive, environment fails, or budget exhausted | blocker and evidence | state PR |
| `ready_to_ship` | `shipping` | ship workflow verifies the branch and creates a product PR, or verifies and reuses the card's existing marked open PR after shipping rework | marked product PR metadata and verification evidence; no duplicate PR | state PR |
| `ready_to_ship` | same + blocked flag | ship preparation has a non-transient conflict, ambiguity, policy violation, or failed deterministic correction | blocker and evidence; retain/record a uniquely validated product PR if creation already succeeded | state PR |
| `shipping` | `implementing` | required CI fails with actionable code evidence and implementation budget remains | findings; implementation rework increment; retain the same marked open product PR | reconciliation-only state PR |
| `shipping` | `shipping` | open PR metadata materially changes but no next transition is valid | reconciled PR metadata | reconciliation-only state PR when durable metadata changed; otherwise report only |
| `shipping` | same + blocked flag | PR closed unmerged, conflict, GitHub `CHANGES_REQUESTED`, ambiguity, or implementation budget exhausted | blocker and evidence | reconciliation-only state PR |
| `shipping` | `done` | reconciler proves product PR merged | merged commit and `delivered_at` | reconciliation-only state PR |
| `ready_to_ship` | `done` | explicit adoption after a closed/unrecorded state transaction proves the uniquely marked product PR already merged into `origin/main` | marked merged product PR, verification/merge evidence, merged commit, `delivered_at`, recovery history | recovery-only state PR |
| any nonterminal | blocker `resume_status` | human explicitly resolves blocker | blocker cleared; status set exactly to validated `resume_status`; resolution history; no other workflow transition | state PR |

Technical child-process failure before a valid result causes no success transition. The pump may report failure without opening a state PR unless durable blocker evidence needs recording.

## Requirements-amendment transitions

`/skill:requirements` is an explicit user workflow, not card scheduling, so one approved requirements transaction may update multiple affected cards atomically. It still acquires the same lock, reconciles first, opens at most one state PR, and stops at that boundary.

| Authoritative card status | Required amendment effect |
|---|---|
| `backlog` | update the card to active requirement IDs/criteria/dependencies or atomically replace it with validated backlog cards using `replacement_reason: requirements_change`; no grandfathering |
| `designing` | update scope to active requirements, append `requirements_scope_updated`, retain prior artifacts as historical, and keep `designing`; the next producer replaces stale design content; no rework increment |
| `design_review` | idempotently close the unmerged design PR with an operation marker, update scope to active requirements, append `requirements_scope_updated`, and transition to `designing`; no rework increment |
| `ready_for_implementation`, `implementing`, `implementation_review`, `ready_to_ship`, `shipping` | retain requirements, criteria, approved design, status, branch, and PR; add each newly superseded referenced requirement to `grandfathered_requirements` and append `requirements_grandfathered` |
| `done`, `replaced` | retain immutable historical card state; create/update backlog coverage for the active replacement requirement as needed |

The transaction must create or identify complete backlog coverage for every active replacement requirement. Follow-up cards that alter or depend on grandfathered behavior depend on the grandfathered card. The approval report names every grandfathered card and states that it will finish under superseded assumptions. If a design PR merged before the amendment is planned, reconciliation consumes the operation first; the requirements transaction is retried from the resulting authoritative status.

A `design_review` amendment follows the marker-first closure and race rules in `spec-requirements-workflow.md`. A valid prior `requirements-design-close` marker plus a closed-unmerged PR is incomplete requirements work, not generic design rejection: after a fresh checked proposal and explicit approval, the requirements transaction returns the card to `designing` without spending design rework. A merged PR always gives reconciliation precedence.

## Global transition effects

Every state mutation is built from one immutable authoritative snapshot and validated as a complete replacement snapshot before commit. A transition:

- changes only fields named by its transition effect plus `updated_at`, history, ID counters when allocating IDs, `last_writer_package_version`, and canonical `BOARD.md`;
- sets `updated_at` to the transaction timestamp only when that card has a semantic change;
- appends immutable result/probe paths rather than overwriting prior evidence;
- appends at least one history record for each changed card, all carrying the current operation and transaction IDs;
- allocates all board IDs before rendering and never reuses an allocation after it becomes authoritative;
- validates external branch/commit/PR evidence against operation markers immediately before the state branch is pushed;
- never clears historical branch, commit, result, or closed/merged PR identity merely because a local worktree or remote branch was cleaned up;
- regenerates `BOARD.md` and rejects any changed path outside the transaction's allowed state path set.

`started_at` is set once when a card first transitions from `backlog` to `designing` or `design_review`, and never changes. `delivered_at` is set only by merged-product reconciliation. Rework preserves old artifacts: entering `implementing` from review clears only the current `reviewed_commit` and `completed_at`; it does not delete prior result paths or the previous implementation head. A later successful producer result appends its artifact and replaces `implementation.head_commit` with the newly verified commit. Schema version 1 reruns the objective probes and every configured review lens against that new commit; partial-lens reruns are deferred.

A same-status transition is legal only when listed: design rework, material shipping reconciliation, blocker creation, or blocker resolution whose resume status equals current status. Timestamp-only, reordered-only, or re-render-only changes are not semantic transitions and cannot create a state PR, except that canonical dashboard drift may be repaired by an explicit `deterministic_correction` transaction.

## Design PR gate

The parent creates `kanban/design/<CARD-ID>-<slug>` and its worktree. The design producer returns proposed content; the parent writes and commits `docs/designs/<CARD-ID>.md`. A separate checker reviews that immutable commit in an isolated child before the design PR opens. The design PR then provides the human approval/merge boundary. Implementation cannot start until reconciliation proves it merged. ADR persistence remains deferred to Stage 5.

The design branch may modify only design-owned paths. Card status, result artifacts, and PR URL are recorded separately by the state transaction.

## Scheduler

A card is actionable when it is nonterminal, unblocked, has all dependencies `done`, has no conflicting pending state PR, and has a legal next transition with satisfied prerequisites.

Order:

1. reconcile cards already holding WIP, including `designing`, before starting backlog cards;
2. dependency readiness;
3. configured numeric priority order;
4. card ID ascending.

Starting a backlog card must not exceed `scheduler.wip_limit`.

## Rework and blockers

Only design and implementation producer rework have counters. A limit is the number of automatic producer re-dispatches allowed: if the counter is below the limit, the requesting transaction increments it once and reworks; if it equals the limit, the engine retains the current status and sets `blocked` without incrementing. A limit of zero disables automatic rework.

Shipping failures are routed by ownership rather than charged to a generic ship budget:

- actionable code or required-CI failures transition to `implementing` and spend the implementation budget;
- invalid parent-owned PR body or metadata receives at most one idempotent deterministic correction for the operation and failed criterion, recorded in history;
- transient GitHub, CI, or network state produces no transition and is retried by a later pump;
- conflicts, duplicate/inconsistent markers, closed-unmerged PRs, policy violations, ambiguity, or a failed/repeated deterministic correction set a blocker.

No child agent mutates Git or GitHub, and schema version 1 has no `rework.ship` or `ship_limit` field.

After code rework, `ready_to_ship → shipping` must update and reuse the same validated open product PR rather than create another.

Clearing `blocked` is its own state transaction and pump boundary. The engine validates `resume_status`, current artifacts, external PR state, and the status-pair table in `spec-board-schema.md`; it clears the flag and sets exactly that status, with no additional workflow transition in the same pump. Typed human resolution may establish the grandfathered `proceed_unsplit` override required by the resumed status, but cannot rewrite the original split result. It never silently resets a rework counter.

## Terminal behavior

`done` and `replaced` are immutable during normal operation. Corrections require an explicit schema migration or audited manual-repair workflow.
