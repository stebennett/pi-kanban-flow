# Specification readiness review

## Status

**Approved as the Stage 0 implementation baseline.** The final consistency review found no unresolved specification contradiction. Stage 1 may begin in the order defined by `spec-development-process.md`; workflow implementation remains gated by the mandatory provider/result and saved-trust/resource-policy spikes.

## Integrated decisions

- One pump runs at most one card workflow and proposes at most one final state transaction.
- Agent-running steps are transient; durable statuses do not represent a currently running child.
- Design uses a required dedicated branch/worktree and PR. An independent child checker reviews the design before PR creation; implementation waits for human merge.
- `blocked` is a nullable flag retaining lifecycle status and validated resume metadata.
- Board/config/card nested records, timestamp conventions, artifact paths, scheduler, review, and rework defaults are specified.
- Child payloads are separated from authoritative parent attestation.
- Structured completion uses role-specific provider-compatible result tools.
- `terminate: true` is treated as a hint and final events/process outcome are validated.
- Strict agents use path-jailed read tools over immutable snapshots and receive no shell/write/edit tools.
- The lock lives under the canonical common Git directory and uses operation/owner identity.
- State, design, and product PRs use deterministic branches, disjoint path ownership, and idempotency markers.
- Operational Git/GitHub settings live only in `config.yaml`; board metadata stores repository identity.
- Schema version 1 supports human state-PR merge only.
- Requirements have machine-readable status/supersession lines.
- Requirement, card, acceptance criterion, checker criterion, run, finding, operation, transaction, and history identifiers have separate namespaces.
- Project agent discovery stops at the canonical repository root and rejects path escapes.
- Saved trust must be distinguished from temporary approval and is covered by a required spike.
- Exact legacy field mappings and fixtures are a prerequisite for Stage 5 migration code.
- This repository root is the production package root; `reference/kanban-flow` is read-only.
- Pi/Node/Git/gh/platform minimums and compatibility testing are documented.
- Machine-local worktree paths are not durable; exact branch/commit/operation identity drives discovery.
- `BOARD.md` is canonical derived committed output.
- `last_state_transaction` is a pre-commit descriptor; self-unknown outcome data remains marker/trailer evidence.
- `designing` represents durable design WIP without claiming a child process is running.
- Design approval freezes requirement scope. Grandfathered cards retain old assumptions and active replacements receive complete follow-up coverage.
- A grandfathered `split_required` result blocks until explicit human `proceed_unsplit` approval; the original verdict is immutable.
- Typed design planned paths form the maximum product write allowlist.
- Checker criterion sets, review-lens scopes, and lock/mutex records are exact.
- Shipping has no generic rework budget; failures route by implementation, deterministic-parent, transient, or ambiguous ownership.

## Required pre-production validation

The role-result and trust/resource-policy spikes in `spec-development-process.md` remain implementation feasibility gates. A failed spike requires specification revision before workflow code continues.

## Final gate result

1. **Satisfied:** summary documents agree with the authoritative detailed specs.
2. **Satisfied for specification:** every durable status has exact invariants and legal normal, blocked, and recovery transitions.
3. **Satisfied for specification:** state/design/product crash windows have idempotent marker/trailer recovery and explicit ambiguity handling.
4. **Conditionally satisfied:** Pi's documented CLI/API supports the designed resource composition; mandatory executable spikes must prove final provider events and persisted trust. A failed spike stops implementation and reopens this review.
5. **Satisfied for specification:** manifest peer/engine policy, runtime preflight, minimum/current platform matrix, and release validation are aligned.

Stage 0 is complete. This approval does not waive Stage 1 fixtures, the two mandatory spikes, the Stage 5 legacy mapping appendix, manual end-to-end acceptance, or release gates.
