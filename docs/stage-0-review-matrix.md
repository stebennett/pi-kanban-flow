# Stage 0 consistency review matrix

**Status:** Complete — approved Stage 0 baseline

This document tracks the final review required by `spec-readiness-review.md`. Detailed specifications are authoritative when a summary differs. `reference/kanban-flow/` is a read-only behavioral source, not a target architecture.

## Deliverable matrix

| # | Stage 0 deliverable | Authoritative document | Current assessment | Open review items |
|---|---|---|---|---|
| 1 | Simplified lifecycle | `stage-0-specifications.md` | Complete | Reconciliation-only mutations consume the pump; otherwise one card advances to one durable boundary. Summary alignment completed. |
| 2 | Board/card/config schemas | `spec-board-schema.md` | Complete for Stage 0 | Exact fields, bounds, paths, IDs, history kinds, rendering, worktree portability, grandfathering, split override, and status invariants are specified. Convert them to schemas/fixtures in Stage 1. |
| 3 | State/design/product PR protocol | `spec-state-pr-protocol.md` | Complete for Stage 0 | Crash/retry, exact path ownership, transaction descriptors, action markers, and closed-state-PR resolution are specified. Convert them to fixtures in Stage 1. |
| 4 | Lock/lease semantics | `spec-lock-lease.md` | Complete as a target design | Secure modes, mutation serialization, corrupt-state handling, ownership checks, stale recovery, and force unlock are specified; implementation fixtures remain Stage 1 work. |
| 5 | Child runner and role policies | `spec-child-agent-runner.md` | Complete as a target design; feasibility unproved | Exact resource flags, role assignments, limits, snapshot construction, and process-group cleanup are specified. Preserve both mandatory feasibility spikes. |
| 6 | Structured result schemas | `spec-structured-results.md` | Complete as a target design; feasibility unproved | Public payloads, criterion/lens sets, cross-field rules, typed planned paths, evidence/finding shapes, attestation, parent probes, and completion conditions are specified. Provider feasibility remains gated by the result spike. |
| 7 | Project overrides/model config | `spec-project-overrides-config.md` | Complete as a target design; trust adapter unproved | Agent frontmatter, known-name scoping, precedence, path/hash rules, and model syntax are specified. Saved-trust verification remains a mandatory spike question. |
| 8 | One-way migration | `spec-one-way-migration.md` | Stage 0 policy complete | Exact legacy field mapping and fixtures are explicitly a Stage 5 prerequisite, not a Stage 0 deliverable. |
| 9 | Legal lifecycle transitions | `spec-state-machine.md` | Complete for Stage 0 | Guards/effects, requirements amendments, designing state, grandfathered split override, budget boundaries, blocker resolution, shipping rework, recovery transitions, and reconciliation boundaries are specified. |
| 10 | Legacy behavior mapping | `spec-legacy-behavior-mapping.md` | Complete for Stage 0 | Row-level disposition now covers pump entry, loading, reconciliation, scheduling, phase workflows, shipping, persistence, and advanced behavior. Exact source-field migration remains the documented Stage 5 prerequisite. |
| 11 | Development sequence and spikes | `spec-development-process.md` | Complete for Stage 0 | Installed Pi 0.85 documentation was audited. Provider/result and saved-trust/resource-policy uncertainties are explicit mandatory stop-the-line spikes before workflow implementation. |

## Readiness gates

| Gate | Status | Evidence needed |
|---|---|---|
| Summary documents agree with detailed specs | Satisfied | `migration-plan.md`, `stage-0-specifications.md`, and `migration-assumptions.md` reflect the final detailed decisions. Detailed specs remain authoritative. |
| Every durable status has complete invariants and transitions | Satisfied for specification | Status/field and transition guard/effect matrices include blocked, recovery, grandfathering, replacement, and split-override cases. Fixture implementation is Stage 1. |
| State/design/product PR crash windows are recoverable | Satisfied for specification | Crash/retry matrix defines authority, retry action, blocker behavior, marker identity, closed-state resolution, and audit effect. |
| Strict and broad policies are enforceable with Pi | Conditionally satisfied | Pi 0.85 documentation supports explicit resource disabling/loading and custom tools. The two mandatory executable spikes must prove provider result behavior and persisted-trust/resource integration before workflow implementation; failure reopens Stage 0. |
| Runtime prerequisites match manifest and CI plans | Specified; execution is a release gate | `engines.node` matches Node minimum; Pi-bundled peers use documented `*` ranges and runtime preflight enforces the tested Pi range. Minimum/current macOS/Linux matrix is explicit in `spec-development-process.md`. Local audit: Pi 0.85.1, Node 24.18.1, Git 2.54.0, gh 2.97.0, macOS 26.6.2. |

## Issue register

| ID | Area | Issue | Required resolution |
|---|---|---|---|
| S0-01 | State PR recovery | Resolved: a closed-unmerged state PR globally blocks mutation until explicit adopt, abandon, or manual repair. Merged external actions cannot be abandoned; adoption uses recovery-only transitions and never recreates the external PR. | Test resolution markers, reopen/recreate rules, external-open/merged cases, and idempotent resolution. |
| S0-02 | Reconciliation | Resolved: any reconciliation requiring durable board mutation produces a reconciliation-only state PR and consumes the pump. Selection occurs only when reconciliation has no durable mutation. | Carry this rule into crash-window fixtures and pump tests. |
| S0-03 | Shipping rework | Resolved: the marked product PR remains open through implementation/review rework and is updated/reverified in place; `ready_to_ship → shipping` prohibits creating a duplicate. | Test branch-head updates, marker continuity, and duplicate rejection. |
| S0-04 | Ship budget | Resolved: schema version 1 has no generic ship counter. Code/CI findings use implementation rework; parent-owned metadata gets one idempotent correction; transient state waits; ambiguity or failed correction blocks. | Reflect the routing in transition and crash-recovery fixtures. |
| S0-05 | Blocker clearing | Resolved: blocker resolution is its own state transaction, sets exactly the validated `resume_status`, performs no additional workflow action, and never resets counters implicitly. | Fixture-test every permitted status pair and invalid prerequisite. |
| S0-06 | Schema completeness | Resolved in specification: schema version 1 rejects unknown fields and defines exact field/bounds/cross-status rules. | Convert directly to strict TypeBox schemas and malformed fixtures in Stage 1. |
| S0-07 | Worktree metadata | Resolved: worktree paths are not persisted. The engine discovers or creates a uniquely validated worktree from durable branch/operation identity. | Add exact runtime discovery/error cases to the implementation tests in Stage 1. |
| S0-12 | Rendered board | Resolved: `docs/cards/BOARD.md` is canonical derived output committed whenever board state changes; it contains no independent state or wall-clock-only timestamp. | Finalize and fixture-test the exact byte format in Stage 1. |
| S0-13 | Design rework state | Resolved: `designing` is a durable WIP status meaning design production/rework is next, never that a child is running. First-pass success may go directly from `backlog` to `design_review`. | Include direct-pass, repeated-rework, exhausted-budget, and closed-design-PR fixtures. |
| S0-14 | Requirement changes during delivery | Resolved: merged design approval is the scope-freeze boundary. Earlier cards are revised/replaced; `ready_for_implementation` and later cards are explicitly grandfathered to finish under retained assumptions, with replacement-requirement backlog coverage. | Fixture-test each status, design-merge race, follow-up dependencies, and schema exceptions. |
| S0-15 | Last state transaction | Resolved: board state stores only the pre-commit transaction descriptor known before commit. Commit, PR, and merge evidence are discovered by matching trailers/markers, avoiding a self-referential follow-up transaction. | Fixture-test descriptor/diff equality and trailer/marker lookup. |
| S0-16 | Split of grandfathered card | Resolved: split assessment still runs, but `split_required` blocks for explicit human approval to finish unsplit. The original verdict is retained and a typed `proceed_unsplit` override is recorded; no backlog children inherit superseded requirements. | Fixture-test no-split, split-required, approve/refuse, dashboard warning, and immutable verdict behavior. |
| S0-08 | Result completeness | Resolved in specification: public nested payloads, role constraints, parent attestation, logical execution identity, and parent-probe form are defined. | Validate provider compatibility and final stop semantics in the required result spike. |
| S0-09 | Lock failures | Resolved: lock mutations use a short-lived exclusive mutex, secure file modes, token revalidation, atomic replace, explicit corrupt-lock handling, and confirmed force unlock. | Fixture-test permissions, symlinks, corrupt JSON, mutex death, token races, and lost ownership. |
| S0-10 | Pi trust | `ctx.isProjectTrusted()` includes temporary approval and cannot prove a persisted decision. | Keep the trust-store adapter as a mandatory spike and fail closed if no stable method is available. |
| S0-11 | Legacy inventory | Resolved: detailed disposition tables now classify pump, reconciliation, scheduling, workflow, shipping, persistence, and recovery rules. | Keep exact legacy field mappings as the documented Stage 5 prerequisite. |

## Pi 0.85 documentation audit notes

Confirmed in the installed documentation:

- packages may explicitly declare extension and skill roots;
- skill commands use `/skill:<name>` and `SKILL.md` frontmatter;
- child execution supports `--mode json -p --no-session`;
- resource discovery can be disabled with `--no-extensions`, `--no-skills`, `--no-prompt-templates`, and `--no-context-files`;
- extensions and skills can be added explicitly with `-e` and `--skill`;
- JSON mode emits an LF-delimited session header followed by agent, message, and tool-execution events;
- final `message_end` records are authoritative messages and `agent_end` terminates the stream;
- custom tool string enums should use `StringEnum`;
- `terminate: true` is only an early-termination hint for an otherwise valid tool batch;
- `ctx.isProjectTrusted()` includes temporary and CLI trust decisions;
- Pi trust controls resource loading and is not a sandbox;
- package runtime dependencies must be in `dependencies`; Pi core packages and `typebox` belong in `peerDependencies` with `*` ranges, while extension preflight enforces the tested Pi compatibility range.

## Final documentation/package validation

- JSON manifests parse successfully.
- Markdown validation reports no structural errors with repository-style exceptions for long specification lines, compact tables, answer-heading punctuation, and intentional leading/trailing spaces inside literal render fragments.
- Relative-link validation passes except the intentional rendered-board example `./CARD-0001.md`, whose target exists only in generated project boards.
- `npm pack --dry-run` includes 34 scaffold/specification assets and excludes `reference/`.
- Documentation has no trailing whitespace or CRLF content.
- No path under `reference/` was modified.
- Production source/test count remains zero, as expected at the Stage 0 gate.

Still requiring executable proof:

- reliable persisted-trust detection without accepting temporary `--approve`;
- strict resource composition with only package-jailed tools and one result tool;
- immutable snapshot and symlink/path traversal enforcement;
- broad write guards over product worktrees;
- exact final-event validation for terminating role-result calls;
- process-group termination on supported macOS/Linux versions;
- package asset resolution after local, symlinked, Git, and npm-packed installation.
