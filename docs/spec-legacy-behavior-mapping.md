# Legacy behavior mapping specification

## Purpose

Classify behavior from `reference/kanban-flow` so the Pi rewrite preserves intentional safety properties while deliberately simplifying the lifecycle.

Classification values:

- **Retained**: same intent must exist in first Pi iteration.
- **Changed**: intent remains, mechanics change.
- **Deferred**: not in first iteration; may return later by explicit design.
- **Removed**: intentionally not carried forward.

## Lifecycle/status mapping

| Claude behavior/status | Pi mapping | Classification | Notes |
|---|---|---|---|
| `backlog` | `backlog` | Retained | Ready/dependency scheduling remains deterministic. |
| `slice` pre-design sizing | post-design split decision plus requirements decomposition | Changed | First Pi gate is after merged design and before implementation. Requirements still aims for right-sized cards. |
| `design` phase | `backlog` → `designing`/`design_review` → `ready_for_implementation` | Retained/Changed | Running the producer/checker is transient. `designing` durably means production/rework is next and holds WIP; it does not claim a child is running. |
| design PR before implementation | checked design branch and required design PR | Retained/Changed | Independent child checker runs before opening the design PR; human merge is required before implementation. |
| `implement` | `implementing` | Retained | Test-first implementation doctrine retained. |
| `test` | `implementation_review` probes/checkers | Changed | Separate status collapsed into review workflow. |
| `review` lens panel | `implementation_review` | Retained/Changed | Parallel focused lenses retained; result transport changes. |
| `deliver` | `ready_to_ship` → `shipping` | Retained/Changed | PR creation/checking/reconciliation retained; state goes through state PRs. |
| `done` | `done` | Retained | Only after product merge and final authoritative state transaction. |
| `blocked` | nullable `blocked` flag on the current durable status | Changed | Human/environment blockers remain durable without erasing lifecycle position. |
| `split` post-review PR splitting | deferred advanced split shipping | Deferred | First iteration supports one implementation PR per card. |
| `superseded` | `replaced` for cards; requirement status metadata for requirements | Changed | Terminal lineage remains explicit. |

## Orchestration mechanics

| Legacy behavior | Pi behavior | Classification | Notes |
|---|---|---|---|
| Prompt-heavy `/kanban` orchestrator owns mechanics by prose | Deterministic TypeScript state machine | Changed | Core migration goal. |
| One pump cycle per invocation | One pump per `/skill:kanban` | Retained/Changed | Pi pump selects at most one card; Claude could advance waves. |
| `/loop /kanban` unattended pumping | External runner later | Deferred | No package loop controller in first iteration. |
| Haiku `pump-gate` preflight | deterministic reconcile/scheduler; optional cheap probe later | Changed/Deferred | Loop optimization less important without loop support. |
| Idle fast path | deterministic no-action report | Retained/Changed | Engine reports idle after reconcile/scheduler. |
| Model-specific agent tiers (`opus`, `sonnet`, `haiku`) | parent-model inheritance plus project overrides | Removed/Changed | No built-in provider-specific mapping. |
| Fenced YAML result blocks | role-specific result tools | Changed | Provider-compatible TypeBox validation plus parent attestation is mandatory. |
| Parent model parses state and YAML | TypeScript parser/schemas | Changed | Models do not own board mutation. |

## Board and Git mechanics

| Legacy behavior | Pi behavior | Classification | Notes |
|---|---|---|---|
| Markdown/frontmatter card files | Markdown/frontmatter card files under `docs/cards` | Retained | Schema changes are versioned. |
| `BOARD.md`, `KNOWLEDGE.md`, card docs as board surface | `board.yaml`, `config.yaml`, card files, rendered views later | Changed | Engine owns rendering. |
| Direct state commits/pushes to `main` | state branches and state PRs | Changed | No board-state direct pushes. |
| Exact-path staging, never blanket `git add -A` | exact allowed-path commits | Retained | Applies to state transaction worktrees. |
| GitHub CLI integration | `gh`/`gh_command` | Retained | First release remains GitHub-specific. |
| Assumes `origin` and `main` | validates `origin` and `main` first iteration | Retained | Config present; other layouts unsupported initially. |
| Worktrees for product/design work | required design and product worktrees with deterministic names | Retained/Changed | Design and product PR classes have disjoint allowed paths. |
| PR merge reconciliation | reconcile before selection | Retained | State PRs add a control-plane reconciliation layer. |

## Agent behavior and doctrine

| Legacy behavior | Pi behavior | Classification | Notes |
|---|---|---|---|
| `card-intake-checker` | requirements checker behavior | Retained/Changed | Folded into `/skill:requirements`. |
| `card-slicer` / `card-slice-checker` | split decision after design | Changed | Same sizing/scope intent, different timing. |
| `card-designer` / `card-design-checker` | design producer/checker | Retained | Prompts rewritten for Pi/tools. |
| `card-implementer` | implement producer | Retained | TDD and scope discipline inlined. |
| `card-tester` | review/test probe | Retained/Changed | May be a checker/probe under review workflow. |
| `card-lens-reviewer` panel | reviewer results under `implementation_review` | Retained | Bounded reruns retained. |
| `card-deliverer` / `card-deliver-checker` | ship workflow | Retained/Changed | PR opening/checking retained; state PRs mediate board state. |
| `pr-splitter` / `card-split-checker` | none first iteration | Deferred | Multi-PR split shipping may return later. |
| Superpowers skill calls | inlined package doctrine | Changed | No runtime dependency. |
| `PROTOCOL-ADDENDUM.md` | selected project addendum/guidance | Retained/Changed | Exact schema may replace it later. |
| Automatic personal memory writes | pump report suggestions only | Removed/Deferred | No automatic personal writes first release. |

## Skills/commands

| Legacy command/workflow | Pi command/workflow | Classification | Notes |
|---|---|---|---|
| `/kanban` | `/skill:kanban` | Changed | No Claude-style aliases. |
| `/refine`, `/requirement`, `/req-ids` | `/skill:requirements` | Changed | Consolidated requirements workflow. |
| `/adr` | design/implementation ADR persistence later | Deferred | ADR support is Stage 5 unless needed earlier. |
| `/retro` | later metrics/retro feature | Deferred | Not first iteration. |
| `/migrate` | `/skill:migrate` | Retained/Changed | One-way cutover only. |
| `/kanban-init` | `/skill:kanban-init` | Retained/Changed | LLM-free Pi initialization creates only the empty control plane through its own state PR; exact behavior is in `spec-requirements-workflow.md`. |

## Recovery and safety behavior

| Legacy behavior | Pi behavior | Classification | Notes |
|---|---|---|---|
| Dead pump recovery through persisted card/check docs | state PR reconciliation plus structured child failure semantics | Retained/Changed | Never infer success from child session or local branch alone. |
| Check docs as durable evidence | phase artifacts/result metadata | Changed | Evidence remains durable but schema-owned. |
| Bounded checker/reviewer rework loops | engine-owned rework counters | Retained | Atomic counters in card metadata. |
| Review-complete/addressed human markers | GitHub review reconciliation without automatic addressed markers | Changed/Deferred | First iteration treats `CHANGES_REQUESTED` as a durable blocker requiring explicit human resolution; automatic comment-to-rework handling is deferred. |
| Quarantine/nightly probes/testing levels | none first iteration | Deferred | To be restored only by explicit spec. |

## Detailed pump and recovery disposition

The following tables classify the operational rules in the legacy pump, including rules that do not map one-to-one to a durable status.

### Pump entry, authority, and state loading

| Legacy rule | Classification | Pi disposition |
|---|---|---|
| Cheap model-driven `pump-gate` decides whether to load the pump | Changed/Deferred | The deterministic reconciler and scheduler always run. A later loop runner may add a deterministic idle optimization; no model may suppress reconciliation. |
| One invocation advances waves of multiple cards | Changed | One Pi pump selects at most one card and stops at its next durable boundary. |
| Parent model parses config/frontmatter and owns state writes | Changed | Strict TypeScript schemas, repository code, and transition functions own parsing and mutation. |
| State survives from phase-document presence and verdict headers | Changed | Durable card metadata and typed artifact paths are explicit; child execution itself remains transient. Missing typed success never implies completion. |
| Load complete checker criterion sets and reject omissions | Retained/Changed | Dispatch supplies the exact criterion set; typed checker results must verdict every key exactly once. |
| Plugin doctrine plus project addendum is supplied to agents | Retained/Changed | Package doctrine and selected trusted project guidance are assembled by role policy and parent-attested. |
| Template overrides and copied plugin doctrine migration checks | Deferred/Removed | Internal assets resolve from the package. Arbitrary template overrides and copied-doctrine drift checks are not in schema version 1. |
| `KNOWLEDGE.md` is loaded and automatically mutated | Changed | Relevant project guidance may be supplied; automatic personal writes are removed and durable repository knowledge needs a later explicit schema if retained. |
| Milestone file controls scheduler ordering and rendered progress | Deferred | First iteration schedules by WIP, dependency readiness, numeric priority, and card ID. Milestone automation is not part of schema version 1. |
| Optional testing levels alter criteria, commands, telemetry, quarantine, and nightly probes | Deferred | Schema version 1 has fixed parent-owned project commands and review lenses. Testing-level telemetry/quarantine/nightly behavior requires a later specification. |

### Reconciliation and recovery

| Legacy rule | Classification | Pi disposition |
|---|---|---|
| Fetch and reconcile before scheduling | Retained | Fetch `origin/main`, query GitHub by validated markers, and reconcile before selection. |
| Local branch, cached URL, or merge-subject pattern may help discover work | Changed | Deterministic branches, commit trailers, and strict PR markers aid discovery; only GitHub plus `origin/main` prove merge. |
| Design merge creates implementation branch immediately | Changed | Design merge is first recorded through a state transaction; product branch/worktree creation occurs in the later split-decision transition. |
| Product merge marks done only after completeness checks | Retained/Changed | GitHub merge evidence and card invariants are required; the final `done` mutation becomes authoritative only when its state PR merges. Post-review split completeness is deferred. |
| Closed-unmerged design PR retries; ambiguous PR state blocks | Retained/Changed | Closed design PR returns from `design_review` to `designing` within budget; ambiguity blocks. Recovery uses markers rather than URL fields alone. |
| Closed-unmerged implementation/slice PR recovery | Changed | Unsplit product PR closure blocks unless a specified retry transition applies. Sequential slice recovery is deferred with multi-PR shipping. |
| Orphan branch/PR adoption after a crash | Retained/Changed | Discover by deterministic branch, trailers, and PR marker; validate exact diff and identity before reuse. Never infer success from existence. |
| Normalize historical fields during every pump | Removed/Changed | Normal operation rejects unsupported schema. Explicit, one-way, fixture-backed migrations perform supported normalization through a migration PR. |
| Drain `AMENDMENTS.md` into in-flight cards | Changed | Requirements changes are fresh checked, digest-approved typed state transactions, not a persisted free-form queue or hidden retry loop. Unapproved design work is revised; cards at or beyond merged design approval are explicitly grandfathered to finish under retained assumptions while follow-up backlog cards cover the replacement requirement. |
| Preserve branch holding unshipped post-review slices | Deferred | Multi-PR split shipping and its original-branch preservation rules are deferred. |
| Detect unshipped additions and deletions in both directions | Deferred/Retained principle | The exact split backstop is deferred; the retained principle is that merge/diff reconciliation must account for deletions and must not rely on rename inference or `HEAD`. |
| Cleanup only after authoritative merge/close reconciliation | Retained | Cleanup validates expected marker, branch, and commit; cleanup failure is reported and never reverses authority. |

### Scheduling, gates, and blockers

| Legacy rule | Classification | Pi disposition |
|---|---|---|
| Dependencies must be `done`; dangling terminal dependencies are drift | Retained | Repository validation rejects missing references/cycles; scheduler requires all dependencies `done`. |
| WIP is held through design, implementation, review, and delivery | Retained/Changed | The configured in-flight status set holds WIP. `blocked` is now a flag and blocked cards are excluded from scheduling without losing lifecycle position. |
| Scheduler orders by milestone, layer, then card ID | Changed | Order is in-flight reconciliation first, then dependency readiness, configured numeric priority, then card ID. |
| Prompt-level manual slice/design/deliver gates | Changed/Removed | Required human boundaries are design, state, and product PR merges. Additional prompt gates are not in schema version 1. |
| Driver responses are appended verbatim to `feedback.md` | Changed | Human decisions that affect state must be represented by typed blocker resolution/history. A general feedback artifact is not yet retained. |
| `needs-input` is an ephemeral alternate state | Changed | Durable uncertainty is a blocker flag with evidence and validated resume metadata; child `needs_human` is a typed result interpreted by the engine. |
| Exhausted bounded rework parks a card | Retained | Engine-managed atomic counters set a blocker when the configured phase budget is exhausted. |

### Requirements, design, split, implementation, and review

| Legacy rule | Classification | Pi disposition |
|---|---|---|
| Intake checks observable criteria, coverage, overlap, verticality, sizing, milestones, and DAG | Retained/Changed | Requirements workflow retains observable criteria, coverage, overlap, sizing, active requirement links, and dependency validity. Milestone checks are deferred. |
| Pre-design slicer and independent slice checker | Changed | Requirements decomposition remains, but the mandatory split decision moves after approved design and uses a dedicated typed result. |
| Split creates terminal parent and rewires dependants atomically | Retained/Changed | `ready_for_implementation → replaced` atomically creates replacement backlog cards, preserves scope, and rewires dependencies through a state PR. |
| Design producer maps acceptance criteria to file-level TDD tasks and alternatives | Retained | Rewritten Pi producer returns proposed design content; parent owns the design file and Git operations. |
| Independent design checker derives before comparing and verifies every stable criterion | Retained | Strict immutable-snapshot checker with complete typed criterion verdicts runs before design PR creation. |
| ADR proposals are held until design passes | Deferred principle retained | ADR persistence is Stage 5. Until specified, architecture decisions remain in the approved design artifact rather than allocating ADR IDs. |
| Human merges a docs-only design PR before implementation | Retained/Changed | Design PR has a strict single allowed path, an operation marker, and human merge; implementation waits for authoritative reconciliation. |
| Implementer uses TDD, exact scope, frequent commits, and reports deviations | Retained/Changed | Doctrine is inlined; package write/edit and named-command tools replace unrestricted shell and Git ownership. Parent validates and commits exact diff. |
| Tester executes objective gates and records real command evidence | Retained/Changed | Deterministic parent runs configured argv commands; probe outputs are typed and supplied to strict reviewers. Models do not select arbitrary shell commands. |
| Parallel review lenses inspect an immutable branch diff | Retained/Changed | Bounded strict reviewer children inspect an immutable commit snapshot; configured result order is preserved. |
| Only failed review lenses rerun | Deferred initially | First implementation may rerun the configured panel; bounded partial reruns can be added in Stage 5 after their exact artifact semantics are specified. |
| Post-review oversized implementation is carved into sequential PRs | Deferred | Replaced by the mandatory post-design, pre-code split decision. First iteration ships one product PR per card. |
| Rename handling, whole-file slice set equality, and never-split-a-split rules | Deferred | Apply only if advanced post-review split shipping is deliberately reintroduced. |

### Shipping, CI, and human review

| Legacy rule | Classification | Pi disposition |
|---|---|---|
| Delivery agent owns push and PR creation | Changed | Parent deterministic Git/GitHub code owns push and PR creation. Agents may produce PR content or bounded judgments only. |
| Deliver checker validates base, body truth, docs, purity, CI, and size | Retained/Changed | Ship verification retains base/body/content/CI checks, using parent probes and typed checker evidence; path-class validation is deterministic. |
| Deliver-check findings route to different producers/self-fixes | Changed | The engine maps typed findings to a listed legal transition. No model chooses board state or arbitrary remediation. |
| CI pending waits; actionable failure reworks code; infrastructure/ambiguity blocks or retries | Retained/Changed | GitHub check rollup is authoritative. Pending holds `shipping`; actionable code evidence may return to `implementing`; inconclusive infrastructure state blocks or reports without inferring failure. |
| Human review-complete signal authorizes automatic comment addressing | Deferred/Changed | First release treats effective `CHANGES_REQUESTED` as a blocker. It does not infer comments are addressed or automatically clear human review blockers. |
| Human merges design and product PRs | Retained | Schema version 1 also requires human merge of state PRs. The engine observes and never approves, dismisses, or merges. |
| PR creation and mutation are idempotent after crashes | Retained/Changed | Machine markers, commit trailers, deterministic branches, and exact-diff validation replace model/session memory. |

### Persistence, reports, and advanced behavior

| Legacy rule | Classification | Pi disposition |
|---|---|---|
| Direct exact-path state commits and pushes to `main` | Changed | Exact-path state commits occur only on isolated state branches and reach `main` through human-reviewed state PRs. |
| Phase docs live on design/product branches while control state lives on main | Retained/Changed | Design content is design-PR-owned; result artifacts and card metadata are state-PR-owned; product PRs cannot alter either path class. |
| Rendered `BOARD.md` is rewritten every pump | Retained/Changed | `docs/cards/BOARD.md` is committed as strictly derived output whenever a state transaction changes board state. It contains no independent state or wall-clock-only churn. |
| Repo knowledge is automatically appended; personal memory is written | Removed/Deferred | Personal suggestions appear only in reports. Automatic knowledge mutation is absent in the first release unless separately specified. |
| Retros, flow metrics, quarantine, and defect auto-filing | Deferred | May return in Stage 5 with explicit schemas and transitions. |
| Idle, action, override, blocker, and unchecked-work reporting | Retained/Changed | Deterministic pump report includes action/boundary, blockers, pending PRs, active project-agent overrides, and failures. Disabled-check policy is not exposed in schema version 1. |
| Model-specific dispatch table | Removed | Children inherit parent provider/model/thinking unless an explicit project override resolves successfully. |
| Fenced YAML result parsing | Removed/Changed | Exactly one role-specific structured result tool plus parent attestation is required. |

## First-iteration retained safety invariants

The Pi implementation must retain these invariants even when mechanics differ:

- only the engine mutates board state;
- all board writes are schema-validated;
- no success is inferred from prose-only child output;
- all checker/reviewer findings include evidence;
- exact paths are committed;
- PR/merge state is reconciled from GitHub, not local assumptions;
- IDs are stable and never reused;
- blockers and human questions survive pump boundaries;
- project agent overrides are visible and auditable.
