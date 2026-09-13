# Stage 0 migration specifications

This document records the Stage 0 architecture decisions that resolve the early assumptions in `migration-assumptions.md` and constrain the implementation plan in `migration-plan.md`.

## 1. Pump granularity and durable boundaries

`/skill:kanban` runs one pump per invocation in the first iteration.

A pump:

- reconciles authoritative external state before selection;
- if reconciliation needs a durable board mutation, proposes a reconciliation-only state PR and stops;
- otherwise selects at most one actionable card;
- may execute multiple internal mechanical substeps for that card;
- must stop at the next durable boundary;
- must not select a second card in the same invocation.

Durable boundaries include:

- state PR opened or updated;
- human approval or decision required;
- blocker recorded;
- rework requested;
- product PR opened;
- product PR/CI/review state requires later reconciliation;
- card marked done through an authoritative state transaction.

The TypeScript engine owns pump granularity. Prompts and child agents may not decide to continue to another card.

## 2. Split timing and first-iteration delivery shape

Splitting is primarily a post-design, pre-implementation decision.

After design is approved and before implementation begins, the engine dispatches the split decision workflow using the approved design and the real repository structure. If the card is too large or contains separable delivery units, implementation does not begin. Instead, the engine creates replacement cards and dependency updates through a state transaction PR.

The first iteration supports one unsplit implementation PR per card. It does not support post-review split shipping or multi-PR delivery for a single card. Those behaviors are deferred to later stages and must be deliberately redesigned before reintroduction.

Requirements-time decomposition still creates reasonably sized cards, but it is not the final mandatory split gate. The implementation split decision is the durable enforcement point before code work begins.

## 3. Structured child result tools

Children complete through role-specific tools: `submit_producer_result`, `submit_checker_result`, `submit_reviewer_result`, `submit_split_decision`, or `submit_probe_result`.

Schemas use provider-compatible string enums plus engine cross-field validation. Prose-only, missing, duplicate, wrong-role, and invalid calls fail. Pi's `terminate: true` is only a hint; final JSON events and process outcome must satisfy `spec-structured-results.md`.

The child supplies findings/artifacts/evidence. The parent attests agent source/hash, actual model/thinking, resource policy, cwd, timestamps, and process outcome. The engine alone maps typed results to transitions.

## 4. Child resource policies

Child policies are assembled by code and recorded in result metadata.

### Strict policy

Used for checkers, read-only reviewers, split-decision agents, and the read-only ship producer.

Strict children:

- disable unrelated extensions, skills, prompts, and context discovery;
- receive only package-owned path-jailed read/grep/find/ls tools and one role-result tool;
- receive no shell, write, or edit tool;
- inspect a temporary immutable snapshot of an explicit commit;
- receive deterministic test/static/Git/GitHub probe outputs from the parent when needed.

### Broad trusted policy

Used for requirements, design, and implementation producers.

Broad children:

- require saved project trust;
- may receive trusted project `AGENTS.md` and selected project guidance;
- may use approved project skills where explicitly allowlisted;
- still do not inherit arbitrary unrelated extensions;
- retain explicit role tool restrictions;
- receive package protocol and current card inputs.

Malformed policies or malformed project overrides fail before mutation.

## 5. Agent model configuration

Agents and skills are model-agnostic by default. Child agents inherit the parent Pi session provider, model, and thinking level unless project configuration specifies an override.

The project configuration shape is:

```yaml
agent_models:
  default: inherit
  overrides:
    design-checker: anthropic/claude-opus-4-6:high
    implementer: openai/gpt-5.4:high
```

Rules:

- `default: inherit` is the first-iteration default;
- per-agent overrides are keyed by resolved agent name;
- an explicit override that cannot be resolved or authenticated fails that dispatch clearly;
- there is no silent fallback chain;
- removing the override restores parent-model inheritance;
- documentation may recommend stronger models for architecture, requirements, and independent checking, but the package does not hard-code provider-specific tiers.

## 6. State PR authority and pending state

The board state on `origin/main` is authoritative.

A pump may open or update one pending state PR for its transaction. Until that PR merges:

- the transaction is not authoritative;
- later pumps may reconcile it;
- later pumps must not create a conflicting state transaction;
- local pending state must not masquerade as mainline board state.

The engine must reconcile pending state PRs before selecting new work.

Board schema version 1 supports human merge only for state, design, and product PRs. Automated merge policies are deferred until separately specified and versioned.

## 7. Lock and lease scope

The first iteration assumes one machine and one checkout per board.

A local atomic filesystem lock is sufficient for the first release. The lock contains process/session metadata and supports stale recovery and audited force unlock.

The local lock protects against concurrent pumps in the same checkout. It does not protect against a second clone on another host. Multi-host or distributed operation requires a remote lease, such as a GitHub-backed lock, and is deferred.

## 8. One-way Claude-to-Pi cutover

Migration is a one-way cutover.

`/skill:migrate` marks the board as Pi-owned by adding `harness: pi` and `board_schema_version`. Pi kanban-flow refuses to operate on a board without the expected Pi marker and supported schema version.

The previous Claude plugin may not understand this marker, so migration documentation must instruct users to stop using, uninstall, or disable the Claude kanban-flow plugin after the migration PR merges.

No simultaneous Claude/Pi pumping is supported. Rollback is by reverting the migration PR and returning to the old harness operationally, not by dual operation.

## 9. Final consistency decisions

The final Stage 0 review adds these binding clarifications:

- `designing` is a durable WIP status meaning design production/rework is next; it never claims a child is currently running.
- Any reconciliation requiring durable mutation creates a reconciliation-only state PR and consumes the pump.
- A closed-unmerged state PR blocks automation until explicit human adopt, abandon, or manual repair; merged external actions cannot be abandoned automatically.
- Worktree and absolute execution paths are machine-local and never committed. Durable identity uses repository, branch, commit, operation, and PR markers.
- `docs/cards/BOARD.md` is committed canonical derived output with no independent state or render-time-only churn.
- Board state stores a pre-commit descriptor for its writing transaction; self-unknown commit/PR/merge values remain trailer/marker evidence.
- Schema version 1 has design and implementation rework budgets only. Shipping failures route to implementation, one idempotent parent correction, wait, or blocker according to ownership.
- Merged design approval freezes scope for requirement amendments. Earlier work is revised; approved/in-flight work is explicitly grandfathered to complete under retained assumptions while follow-up backlog cards cover the active replacement requirement.
- A grandfathered card still receives the mandatory split assessment. `split_required` needs an explicit human `proceed_unsplit` override; schema version 1 does not create unapproved backlog children under superseded requirements.

## 10. Related detailed specifications

Detailed Stage 0 specifications:

- `spec-board-schema.md`
- `spec-state-pr-protocol.md`
- `spec-lock-lease.md`
- `spec-child-agent-runner.md`
- `spec-structured-results.md`
- `spec-project-overrides-config.md`
- `spec-one-way-migration.md`
- `spec-state-machine.md`
- `spec-legacy-behavior-mapping.md`
- `spec-development-process.md`

## 11. Stage 0 exit condition

Stage 0 exits when the above decisions are reflected in the implementation docs and there is no unresolved architectural contradiction between:

- state PR authority;
- local locking;
- child process isolation;
- product branches/worktrees;
- structured child results;
- one-card pump granularity;
- one-way migration.
