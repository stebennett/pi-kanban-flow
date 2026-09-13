# Migration decisions and remaining assumptions

This document distinguishes decisions confirmed in `migration-questions.md` from assumptions that still need validation. Confirmed decisions are no longer treated as assumptions.

## 1. Confirmed decisions

| ID | Decision | Source |
|---|---|---|
| D-01 | Deliver kanban-flow as an installable Pi package. | Q1 |
| D-02 | Use staged delivery and redesign the mechanics around requirements → design → implement → review → ship rather than require strict `0.10.0` parity. | Q2 |
| D-03 | Run specialist agents as isolated child Pi processes. | Q3 |
| D-04 | Allow project-local agents to override package agents and document this behavior. | Q4 |
| D-05 | Use Pi-native `/skill:<name>` commands; do not preserve Claude-style aliases. | Q5 |
| D-06 | First iteration runs one pump per invocation. Defer loop support; later prefer an external runner. | Q6 |
| D-07 | Inline the intent of the Superpowers workflows into kanban-flow skills, agents, and engine behavior. | Q7 |
| D-08 | Remove built-in model-to-agent alignment. Agents are model-agnostic, inherit the parent model by default, and may use driver-defined project overrides. | Q8–Q9 |
| D-09 | Replace `${CLAUDE_PLUGIN_ROOT}` with relative package references and extension-resolved paths. | Q10 |
| D-10 | Replace fenced YAML returns with a proper structured-output tool. | Q11 |
| D-11 | Apply role-based child resource policies: strict isolation for checkers/read-only agents and broader trusted context for designers/implementers. | Q12 |
| D-12 | Require saved project trust before operation. | Q13 |
| D-13 | Route board-state changes through a state branch and PR rather than pushing directly to `main`. | Q14 |
| D-14 | Add an atomic project lock/lease. | Q15 |
| D-15 | Separate package version from board schema version. | Q16 |
| D-16 | Migration is a one-way cutover; do not support concurrent Claude and Pi pumping. | Q17 |
| D-17 | Disable automatic personal-knowledge writes initially and report suggestions to the driver. | Q18 |
| D-18 | Support macOS and Linux first. | Q19 |
| D-19 | Release through Git prereleases before npm. | Q20 |
| D-20 | Rewrite the orchestrator as a deterministic TypeScript state machine. | Q21 |
| D-21 | Use manual happy-path testing as the first acceptance bar. | Q22 |

## 2. Remaining assumptions

| ID | Assumption | Why the plan relies on it | Validation / consequence if false |
|---|---|---|---|
| A-01 | The first compatibility range is Pi `>=0.85.0 <0.86.0`, whose local documentation was reviewed. | Extension, package, skill, tool, trust, and JSON event APIs are version-sensitive. | Recheck APIs and widen the range only after compatibility tests. |
| A-02 | The repository root is the production package root and `reference/kanban-flow` remains read-only. | The reference is the behavioral source and migration fixture; this repository contains only the new package and its supporting docs/tests. | Confirmed for implementation. |
| A-03 | The simplified lifecycle will use first-class skills named `requirements`, `design`, `implement`, `review`, `ship`, and `kanban`. | The revised plan and command documentation are organized around these workflows. | Rename before package publication if a different UX is desired. |
| A-04 | `/skill:kanban` selects at most one actionable card per pump. | This bounds state transactions and makes first-iteration manual operation understandable. | If one pump should process multiple cards or waves, scheduler, locking, and state PR semantics must expand. |
| A-05 | A pump may advance its selected card through several internal steps until the next durable boundary. | This avoids requiring a user invocation for every mechanical sub-step. | Define “one transition only” instead if stricter pump granularity is wanted. |
| A-06 | The split decision occurs after design and before implementation in the simplified lifecycle. | The driver explicitly wants each pump to determine whether splitting is needed before progressing to implementation. | Clarify whether a coarse requirements-time split also remains mandatory and whether post-review splitting survives later. |
| A-07 | The first iteration handles one unsplit implementation PR per card. | Multi-PR split shipping is deferred to reduce initial scope. | If large-card split shipping is required immediately, restore and redesign those state-machine branches in Stage 4. |
| A-08 | Markdown/YAML under `docs/cards` remains the human-readable durable board format even though TypeScript owns parsing and mutation. | This preserves inspectability, Git history, and a migration path from existing boards. | A database or pure JSON store would require a different migration and review model. |
| A-09 | Separate stable namespaces for requirements, cards, acceptance criteria, checker criteria, runs, findings, operations, transactions, and history remain useful. | Traceability and historical evidence depend on durable, non-repurposed identity. | Namespace rules are specified in `spec-board-schema.md`. |
| A-10 | Project overrides use the nearest `.pi/agents/*.md` between dispatch cwd and the canonical trusted repository root; same-name project agents replace package defaults. | This enables customization without loading prompts outside the repository trust boundary. | Canonicalize paths and reject symlink escapes. |
| A-11 | Every project override will be reported with its source path and recorded in result metadata. | Documentation alone is insufficient to audit which checker ran. | If this is considered too noisy, retain at least artifact metadata and startup diagnostics. |
| A-12 | Child agents are ephemeral (`--no-session`) and return all durable output to the parent engine. | Board files and PRs, not child sessions, are the recovery source. | Persistent child sessions would require retention, privacy, resume, and branch semantics. |
| A-13 | Child output can be consumed reliably through Pi JSON mode using LF-delimited records. | The selected process-based runner follows Pi's supported subagent example. | If event behavior is inadequate, use RPC or the SDK while retaining process isolation. |
| A-14 | Dedicated child extensions can register role-specific terminating result tools. | Typed completion depends on callable producer/checker/reviewer/split/probe tools in children. | Prove this in the required structured-result spike before porting prompts. |
| A-15 | Provider-compatible role-specific TypeBox schemas plus engine cross-field validation represent all required results. | A shared discriminated union conflicts with some provider tool-schema constraints. | The spike must test supported provider behavior and fail closed. |
| A-16 | Trusted producers receive selected in-repository project guidance/skills; strict checkers receive only immutable-snapshot read tools and exact inputs. | This implements the chosen two-policy resource model. | Exact first-release policies are specified in `spec-child-agent-runner.md`. |
| A-17 | Unrelated project/global extensions are not inherited by children in the first release. | Extension side effects could alter tools or recursively dispatch agents. | Children start with extension discovery disabled and load only package-owned role/result/path-guard extensions. |
| A-18 | Parent-model inheritance includes provider, model, and thinking level. | “Model agnostic” needs a precise default behavior. | If thinking level should vary independently, add it to project agent configuration. |
| A-19 | Project model configuration may override individual agents and has no implicit fallback chain. | Q8 removes fixed mappings and Q9 defers to that model. | Confirm the proposed `agent_models` shape; a failed explicit override currently means that dispatch fails. |
| A-20 | The project has at least one authenticated custom-tool-capable Pi model when no overrides are set. | Every child otherwise inherits an unusable model. | Setup diagnostics and capability-based recommendations are specified in `spec-project-overrides-config.md`. |
| A-21 | `gh` or configured `gh_command` remains the GitHub integration mechanism. | PR creation, CI, reviews, comments, and reconciliation still target GitHub. | A forge-neutral adapter would be a separate feature and interface design. |
| A-22 | The target repository uses an `origin` remote and `main` default branch in the first release. | The reference branch/worktree and GitHub commands assume them. | Add configurable remote/base branch before supporting other repository layouts. |
| A-23 | Product/design work continues on dedicated branches and worktrees even though board state moves through separate state PRs. | This separates product review from control-plane state review. | If state and product changes should share PRs, transaction and recovery semantics must be redesigned. |
| A-24 | A state transaction is not authoritative until its state PR merges. | This prevents local/pushed-but-unmerged state from masquerading as `main` state. | Pending state is discovered from PR markers; later pumps reconcile it and do not select new work until it resolves. |
| A-25 | Only one conflicting state PR may be pending for a board at a time. | Multiple state branches from the same base would conflict and duplicate external actions. | If concurrency is needed, define mergeable transaction partitions and stronger locking. |
| A-26 | Board schema version 1 requires human merge for every state PR. | This is the safest initial authority model. | Automated merge policies require a later specification and schema version. |
| A-27 | The lock can be implemented as an atomic filesystem lease with process/session metadata and stale recovery. | The first release targets one checkout on macOS/Linux. | Multiple machines sharing a remote require a remote/distributed lease, not just a local file. |
| A-28 | A single machine/check-out is the expected first-iteration operating environment. | A local lock cannot protect a second clone on another host. | If multi-host runners are expected, move lock ownership to GitHub or another shared service. |
| A-29 | Project trust is saved before both the parent pump and its non-interactive children run. | Child modes cannot prompt for trust. | Setup must verify trust and fail before mutation rather than passing blanket approval silently. |
| A-30 | Internal templates remain package assets and are not registered as Pi prompt templates. | Registering them would pollute slash completion and expose internal doctrine as commands. | Explicitly register only true user workflows as skills. |
| A-31 | Relative links plus a central package path resolver work under local, symlinked, Git, and npm-packed installs. | Pi has no assumed `${CLAUDE_PLUGIN_ROOT}` equivalent. | Prove this with packed-install smoke tests before relying on it in child dispatches. |
| A-32 | The intent of the Superpowers dependencies can be captured without importing those skills. | Self-contained TDD, verification, branch finishing, and worktree behavior is required. | Compare the rewritten doctrine against the original skills if their exact source becomes available. |
| A-33 | Automatic personal memory writes are not necessary for first-iteration workflow correctness. | Personal suggestions will only appear in reports. | Add an explicit opt-in global knowledge mechanism later if users miss this behavior. |
| A-34 | Existing Claude boards can be migrated only from explicitly supported schema shapes and may be refused when ambiguous. | The lifecycle and state mechanism are changing significantly. | Publish a supported-version matrix and retain manual migration guidance for unsupported boards. |
| A-35 | `harness: pi` plus `board_schema_version` is sufficient to prevent accidental Claude pumping after cutover. | Dual operation is explicitly unsupported. | The Claude plugin itself will not understand the marker unless updated; operational docs may also need uninstall/disable steps. |
| A-36 | Package semver and integer board schema versions advance independently under the policy in `spec-board-schema.md`. | Package-only fixes should not force board migration. | Packages declare readable/writable/migratable schemas; unknown newer schemas fail closed. |
| A-37 | First release can be declared usable after the documented manual end-to-end walkthrough, even without exhaustive legacy parity testing. | Q22 selected manual happy-path acceptance. | Clearly label unsupported recovery and advanced paths in prerelease notes. |
| A-38 | Focused automated tests are still desirable for deterministic schemas, transitions, locking, result validation, and packaging. | Manual acceptance does not efficiently validate low-level edge cases in a TypeScript state machine. | If no automated tests are wanted at all, explicitly accept higher regression risk and remove those tasks from the plan. |
| A-39 | The documented minimum Pi, Node, Git, gh, macOS, and Linux environments provide required worktree/process behavior. | Windows is deferred. | Minimums and cross-platform test policy are specified in `spec-development-process.md`. |
| A-40 | `RATIONALE.md` remains maintainer documentation and is not injected into routine agent context. | The reference explicitly separates reasons from operational doctrine. | Update it to explain redesigned enforcement, but keep normal prompts focused. |

## 3. Stage 0 assumptions confirmed

The following assumptions affected architecture enough to confirm during Stage 0. They are now specified in `stage-0-specifications.md`:

1. **A-04/A-05:** `/skill:kanban` selects at most one card; a pump may advance that card to the next durable boundary.
2. **A-06/A-07:** split enforcement occurs after design and before implementation; first iteration supports one unsplit implementation PR per card and defers post-review multi-PR split shipping.
3. **A-14/A-15:** children complete through provider-compatible role-specific result tools; final event/process validation and a feasibility spike are required.
4. **A-16/A-17:** child resource policies are code-assembled; strict roles receive only path-jailed read tools over an immutable snapshot, producers receive broader trusted context with path guards, and arbitrary extension inheritance is disabled.
5. **A-19:** project `agent_models` supports `default: inherit` plus per-agent overrides; unresolved explicit overrides fail clearly with no silent fallback.
6. **A-24/A-26:** `origin/main` board state is authoritative; pending state PRs are reconciled before new work, conflicting transactions are prohibited, and schema version 1 requires human merge.
7. **A-27/A-28:** the first iteration assumes one machine/checkout and uses a local atomic filesystem lock; remote/distributed leases are deferred.
8. **A-35:** Pi migration uses `harness: pi` plus `board_schema_version`, refuses unsupported markers, and documentation instructs users to stop/uninstall/disable the Claude plugin after cutover.
9. **A-23:** worktree paths are machine-local discovery data and are never durable; branches, commits, repositories, operations, and PR markers provide durable identity.
10. **A-24/A-25:** any durable reconciliation consumes the pump; a closed-unmerged state PR requires explicit adopt, abandon, or manual repair.
11. **A-06:** design approval is the requirement-amendment freeze boundary. Grandfathered `split_required` cards need explicit human approval to finish unsplit and never generate backlog cards tied to superseded requirements.
12. **A-08:** `docs/cards/BOARD.md` is a committed canonical rendering derived only from validated schema state.
13. **A-09:** board state records only the writing transaction's pre-commit descriptor; commit/PR/merge outcomes are external marker/trailer evidence.
14. **A-11/A-40:** selected override and protocol-addendum inputs are prominently reported and hash-attested; package rationale remains outside routine child context.
15. **A-37/A-38:** manual end-to-end acceptance remains required, while focused deterministic tests and the two mandatory feasibility spikes are non-optional release gates.
