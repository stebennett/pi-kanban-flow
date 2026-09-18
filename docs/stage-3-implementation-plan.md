# Stage 3 implementation plan

**Status:** Ready for specification closure and implementation after the Stage 2 completion checkpoint is present on protected `main`
**Prepared from:** `docs/migration-plan.md`, the authoritative Stage 0 specifications, and `docs/checkpoint-stage-2-complete.md`
**Authoritative `main` at preparation:** `d85bb88`
**Completed Stage 2 baseline:** merged through PR #69
**Stage objective:** Parent-owned requirements initialization and amendment workflow

## 1. Purpose

This document is the execution plan for Stage 3. It is written so a new agent can implement `/skill:kanban-init` and `/skill:requirements` without moving state authority into prompts or child models.

Stage 3 must prove two related paths:

1. a trusted new repository can move from no board to an initialized schema-version-1 board and then to an approved requirements specification with backlog cards; and
2. an initialized project can amend requirements atomically, including backlog updates, pre-approval design invalidation, and post-design grandfathering.

The durable boundary remains one human-reviewed state PR. Children propose typed changes and check them. The parent validates, allocates IDs, derives board effects, asks for one explicit approval, and creates the state transaction. No child, skill, or parent conversation writes board state directly.

This plan is an implementation aid, not a replacement for detailed `docs/spec-*.md` documents. Detailed specifications are authoritative. Stop and resolve contradictions or missing durable semantics before coding around them.

## 2. Required reading before editing

Read these files completely and in this order:

1. `AGENTS.md`
2. `docs/migration-plan.md`
3. `docs/stage-0-specifications.md`
4. `docs/spec-development-process.md`
5. `docs/spec-board-schema.md`
6. `docs/spec-state-machine.md`
7. `docs/spec-state-pr-protocol.md`
8. `docs/spec-lock-lease.md`
9. `docs/spec-child-agent-runner.md`
10. `docs/spec-structured-results.md`
11. `docs/spec-project-overrides-config.md`
12. `docs/spec-readiness-review.md`
13. `docs/stage-0-review-matrix.md`
14. `docs/spec-legacy-behavior-mapping.md`
15. `docs/checkpoint-stage-2-complete.md`
16. this plan

Before implementing Pi skills, commands, tools, interactive approval, extension registration, or package behavior, read the installed Pi documentation and relevant examples identified by `AGENTS.md`. At minimum verify the currently installed versions of:

- `docs/skills.md` for `/skill:*` discovery and frontmatter;
- `docs/extensions.md` for commands, custom tools, UI prompts, cancellation, and mode behavior;
- `docs/packages.md` for packaged resource discovery;
- `examples/extensions/question.ts` and `questionnaire.ts` for user interaction;
- `examples/extensions/structured-output.ts` for terminating tools; and
- `examples/extensions/subagent/` only as a behavioral reference for process integration.

Read `docs/spec-legacy-behavior-mapping.md` before consulting `reference/kanban-flow/`. Relevant read-only behavioral sources include `skills/refine`, `skills/requirement`, `skills/req-ids`, `agents/card-intake-checker.md`, and `templates/checks/intake.md`. Preserve their useful intent, not their Claude-specific mechanics, old schemas, milestone model, direct commits, or amendment queue. Never edit, format, rename, or generate files under `reference/`.

## 3. Baseline and prerequisite assessment

### 3.1 Stage 2 baseline

At preparation, protected `main` is `d85bb88` and contains:

- the strict board/config/card/requirements schemas and repository;
- deterministic rendering, transitions, scheduler, lock, Git/GitHub primitives, and state transaction coordinator;
- persisted-trust and agent-discovery adapters;
- requirements producer/checker definitions;
- strict and broad-read policies;
- model resolution, prompt assembly, child dispatch, JSON event validation, and process cleanup;
- parent attestation and deterministic requirements artifact rendering; and
- a requirements producer/checker isolation vertical slice.

The checkout gate passes with 91 tests and 8 opt-in real-Pi tests skipped by default:

```text
npm run typecheck
npm test
npm run package
npm run package:check
git diff --check
```

Before each Stage 3 implementation branch:

1. fetch `origin`;
2. confirm the prior accepted Stage 3 PR is merged into protected `main`;
3. create the next branch from fresh `origin/main`;
4. run the complete baseline gate; and
5. do not merge or cherry-pick unrelated stacks implicitly.

### 3.2 Specification closure required before production workflow code

The Stage 0 documents define the requirements invariants and transition effects but do not yet define enough operational detail to expose a mutating Stage 3 workflow. Work unit 0 must add one authoritative requirements-workflow specification and align existing specifications where necessary.

The closure must define, at minimum:

- the exact `/skill:kanban-init` input, default schema-version-1 config, repository-identity derivation, no-board preconditions, initialized file set, and whether initialization may include requirements/cards or must be a separate state PR;
- how a state transaction is proposed when `readBoardRepository()` cannot yet read an uninitialized repository;
- the exact `/skill:requirements` parent-tool contract and the boundary between model-led interview text and deterministic workflow inputs;
- the one approval surface, including approve, revise, and cancel behavior; digest binding; stale-base rejection; non-interactive behavior; and the prohibition on writes before approval;
- whether a failed/inconclusive requirements check returns findings for a new user revision or permits a bounded automatic producer retry. No requirements rework budget currently exists in schema version 1, so implementation must not invent one;
- the canonical package-owned requirements criterion list as a reusable code constant;
- exact normalization and semantic rules that turn typed temporary references into allocated REQ/CARD/AC/FINDING IDs;
- rendering rules for a newly created or amended `docs/spec.md` and card Markdown bytes;
- the exact requirements-level artifact retention policy for producer/checker attempts, including failed and superseded proposals;
- the reconciliation behavior that must run before initialization or amendment;
- the ordering and idempotency of closing an open design PR for an amended `design_review` card;
- lock heartbeat/lost-ownership behavior while interviewing, dispatching, checking, awaiting approval, and creating a PR;
- cancellation and process failure semantics after a parent-owned external action but before state-PR creation; and
- the stable report/tool result contract returned to the skill and shown to the user.

Recommended decisions, subject to the specification review:

- `/skill:kanban-init` creates only the empty board/config/dashboard control plane through its own state PR. `/skill:requirements` runs only after that PR merges and creates `docs/spec.md` plus cards through a second state PR. This keeps every human review small and avoids teaching the transaction coordinator two unrelated mutations at once.
- Requirements check failure or inconclusive status returns a checked proposal and findings to the user for revision; it does not consume a hidden retry budget. A revised request starts a fresh producer/checker run.
- The parent computes a canonical approval document and SHA-256 digest from the fully normalized, checked, ID-previewed proposal. Approval binds to that digest and the authoritative base commit. Any changed base, proposal, external PR state, or user edit invalidates approval and requires revalidation.
- Interactive approval is required for Stage 3 mutation. Print/JSON modes may prepare and return a proposal but must not approve or create a state PR unless a later specification defines an authenticated approval input.
- Child artifacts from the accepted producer/checker runs are committed with the same state transaction. Rejected or cancelled attempts remain machine-local and do not become board authority.

The specification review selected these recommendations. `docs/spec-requirements-workflow.md` is authoritative and additionally fixes initialization defaults, temporary-reference normalization, stable AC matching, finding-ID attestation, seven-day local attempt retention, marker-first design-PR closure, built-in `ctx.ui.select` approval in TUI/RPC, and stable result objects. The prerequisite evidence is in `docs/checkpoint-stage-3-prerequisites.md`, and durable/crash coverage is mapped in `docs/stage-3-review-matrix.md`.

## 4. Binding Stage 3 boundaries

The parent engine owns:

- persisted saved-trust verification;
- canonical repository and authoritative `origin/main` identity;
- board initialization preconditions and defaults;
- reconciliation and pending-state checks;
- lock acquisition, heartbeat, ownership-loss abort, transaction-ID update, and release;
- packaged/project agent and approved context discovery;
- producer/checker dispatch identity, policy, model, limits, and cleanup;
- structural validation of every typed proposal;
- requirement/card impact derivation;
- all REQ/CARD/AC/FINDING/KFOP/KFTX/KFH allocation;
- dependency, supersession, replacement, grandfathering, and history effects;
- design-PR closure actions and markers;
- approval rendering and digest binding;
- exact artifact and board destinations;
- state-transaction rendering, Git, GitHub, and reporting; and
- every durable mutation and transition meaning.

The user-facing skill may:

- explain the workflow;
- gather intent one question at a time;
- stop once the request is testable;
- pass a bounded requirements brief to the deterministic tool; and
- report the tool outcome and next human action.

Children may:

- propose requirement and card changes through `submit_producer_result`;
- return complete criterion verdicts through `submit_checker_result`;
- identify questions, findings, and evidence; and
- provide optional explanatory requirements/card artifacts.

Children and skills may not:

- allocate durable IDs;
- choose or write durable paths;
- mutate the board, spec, cards, Git, GitHub, lock, branches, or PRs;
- decide grandfathering or lifecycle transitions;
- authorize their own proposal;
- bypass the checker or approval;
- approve on behalf of the user; or
- treat a state PR as authoritative before merge.

Do not implement during Stage 3:

- `/skill:kanban` scheduling/pump execution;
- design, split, implementation, review, or ship workflows;
- product/design branch creation except the specified idempotent closure of stale unmerged design PRs during an amendment;
- blocker-resolution or closed-state-PR recovery UI beyond refusing and reporting the existing condition;
- automatic state PR merge;
- migration from Claude boards;
- milestone persistence;
- `AMENDMENTS.md`, `KNOWLEDGE.md`, intake line estimates, or legacy direct commits;
- partial checker reruns, unattended loops, telemetry, quarantine, nightly probes, or Windows support; or
- any edit under `reference/`.

## 5. Architectural dependency direction

Keep dependencies moving in this direction:

```text
/skill:kanban-init          /skill:requirements
         |                         |
         +------ thin Pi workflow tool/command adapters ------+
                                      |
                         bounded human-input / approval adapter
                                      |
                 trust + canonical root + parent model adapter
                                      |
              lock + fetch + reconcile + authoritative snapshot
                         |                         |
                initialization planner     requirements coordinator
                                                   |
                         producer dispatch --> proposal normalizer
                                                   |
                         checker dispatch --> checked proposal
                                                   |
                           deterministic impact + ID allocation
                                                   |
                         canonical approval report + digest
                                                   |
                      explicit user approval / revise / cancel
                                                   |
               optional marked design-PR closure and revalidation
                                                   |
                 state mutation renderer + transaction coordinator
                                                   |
                           human-reviewed state PR boundary
```

Pure proposal normalization, impact planning, ID allocation, rendering, and approval-document generation must not depend on Pi UI, live GitHub, or child processes. The Pi entry point and skills remain thin.

A reasonable module layout is:

```text
extensions/kanban-flow/
├── requirements/
│   ├── criteria.ts             # fixed ordered checker criteria
│   ├── proposal.ts             # typed proposal normalization and references
│   ├── allocate.ts             # deterministic preview/final ID allocation
│   ├── impact.ts               # status-specific amendment effects
│   ├── render.ts               # spec/card/artifact/approval bytes
│   ├── initialize.ts           # no-board initialization candidate
│   ├── approval.ts             # digest-bound approval document and adapter
│   ├── dispatch.ts             # producer/checker preparation and execution
│   └── workflow.ts             # parent-owned init/requirements coordination
├── reconciliation/
│   └── requirements.ts         # pending state and design-PR preflight/closure
├── tools/
│   ├── initialize.ts           # Pi-facing deterministic workflow surface
│   └── requirements.ts
└── index.ts                    # thin registration only

skills/
├── kanban-init/SKILL.md
└── requirements/SKILL.md
```

The exact layout may differ, but do not combine UI, child execution, semantic planning, and state mutation in one untestable module.

## 6. Delivery plan

Each work unit is one focused PR. Every PR is created from fresh protected `main` after the preceding PR merges. Tests land with behavior. Do not push directly to `main`, and do not keep a long-lived feature stack whose base is an unmerged feature branch.

### Work unit 0 — Requirements-workflow specification closure

#### Documentation

- Add `docs/spec-requirements-workflow.md` covering every issue in section 3.2.
- Update the related board, state-machine, state-PR, lock, structured-result, migration-plan, readiness, and legacy-mapping text only where needed for consistency.
- Define exact initialization defaults and byte-owned paths.
- Define the Stage 3 approval state machine and non-interactive refusal behavior.
- Define accepted/rejected artifact persistence and requirements-check failure behavior.
- Add a Stage 3 review matrix mapping each durable effect and crash window to its owning module/test.

#### Spikes

- Build a disposable Pi interaction spike proving a custom workflow tool can show a bounded approval summary, receive explicit confirmation/cancellation, and react to abort without continuing mutation.
- Prove the selected interaction works in TUI and RPC if both are claimed; explicitly fail closed in unsupported modes.
- Prove a skill can gather a brief and invoke only the intended package tool without becoming mutation authority.
- Record sanitized evidence and installed Pi version in a Stage 3 prerequisite checkpoint.

#### Exit

There is one authoritative, internally consistent requirements-workflow specification. Initialization, approval, checker-failure behavior, lock scope, and crash recovery have no unresolved semantics.

### Work unit 1 — Deterministic proposal model and fixed criteria

#### Modules

- `extensions/kanban-flow/requirements/criteria.ts`
- `extensions/kanban-flow/requirements/proposal.ts`
- focused shared schema changes, if required by the specification

#### Implementation

- Define the exact ordered `REQ-*` checker criterion set once and reuse it for dispatch and result validation.
- Convert a validated requirements producer payload into an immutable normalized proposal.
- Resolve temporary requirement/card/dependency references without allocating durable IDs yet.
- Reject duplicate normalized keys, paths, criteria, semantically conflicting actions, unsupported target statuses, stale targets, and references outside the proposal/authoritative snapshot.
- Verify create, same-meaning amendment, supersession, retirement, card create/update/replace, and no-op semantics.
- Reject model-proposed grandfathering, histories, artifact destinations, IDs, commits, branches, PRs, or board fields.
- Produce deterministic ordering independent of payload object insertion order while preserving package-defined criterion and user-visible card ordering where specified.

#### Tests

- One positive fixture for initial creation and each amendment action.
- Temporary sibling-reference graphs, including forward references.
- Duplicate, missing, ambiguous, cyclic, conflicting, and no-op changes.
- Existing target status constraints.
- Unicode, size, normalized-text, and unknown-field boundaries inherited from the public schema.
- Assert the authoritative snapshot and child payload remain unchanged.

#### Exit

A producer result can become one deterministic, engine-owned proposal or fail before checking, approval, mutation, or external action.

### Work unit 2 — ID allocation, requirements/card rendering, and semantic preview

#### Modules

- `extensions/kanban-flow/requirements/allocate.ts`
- `extensions/kanban-flow/requirements/render.ts`
- reusable canonical card rendering in the board layer where needed

#### Implementation

- Preview and finalize monotonic REQ/CARD/AC/FINDING allocations from the authoritative counters.
- Never trust proposed IDs and never reuse an allocation already authoritative on `origin/main`.
- Resolve every temporary key to its previewed durable ID deterministically.
- Render exact `docs/spec.md` requirement sections and complete card Markdown/frontmatter.
- Preserve unchanged requirement/card bytes semantically and avoid reorder-only churn.
- Create complete schema-valid backlog card workflow records, timestamps, histories, lineage, and empty later-phase metadata.
- Derive requirements producer/checker artifact paths and canonical bytes from parent attestations.
- Build a complete in-memory candidate and run existing repository/semantic validation before approval.
- Keep preview allocation provisional: no counter or file changes occur until the approved state transaction is rendered from the same validated plan.

#### Tests

- Counter boundaries, exhaustion, gaps, and existing historical IDs.
- Mixed temporary/existing references and stable ordering.
- Golden initial and amendment `spec.md`/card/artifact bytes.
- Parse/render/parse and candidate semantic validation.
- No ID consumption after reject/cancel/failure.
- FINDING allocation for checker findings without accepting child IDs.

#### Exit

A normalized proposal can be rendered as a fully valid, deterministic preview with stable prospective IDs and no writes.

### Work unit 3 — Requirements impact planner

#### Module

- `extensions/kanban-flow/requirements/impact.ts`

#### Implementation

Implement every requirements-amendment row in `docs/spec-state-machine.md` as a pure immutable planner:

- `backlog`: update or requirements-driven replace; rewire dependencies atomically; no grandfathering;
- `designing`: update scope, retain historical artifacts, append `requirements_scope_updated`, keep `designing`, and do not increment rework;
- `design_review`: plan marked PR closure, update scope, append history, return to `designing`, and do not increment rework;
- `ready_for_implementation` through `shipping`: retain requirements, criteria, design, status, branches, and PRs; derive exact grandfathered IDs and `requirements_grandfathered` history;
- `done` and `replaced`: keep historical records immutable and require separate active backlog coverage where behavior changes.

Also:

- require complete active replacement coverage;
- require follow-up dependencies on grandfathered cards where behavior is modified or relied upon;
- preserve reciprocal replacement lineage;
- reject dangling dependencies and cycles after all rewrites;
- allocate one KFH entry per semantically changed card using the transaction metadata;
- update `updated_at` only for semantically changed cards; and
- return the exact affected-card set and required external design-PR closure actions.

#### Tests

- Every durable status, including blocked variants where permitted by the new specification.
- Same-meaning amendment, supersession, retirement, create-only, and mixed amendment sets.
- Backlog replacement and dependent rewiring.
- Designing history/artifact retention.
- Design-review closure plan and merge-race response.
- Every grandfathered status and follow-up dependency rule.
- Terminal historical retention.
- Multi-card atomicity: one invalid card rejects the whole plan.

#### Exit

All board effects of an accepted requirements proposal are derivable and schema-valid without filesystem, GitHub, Pi, or child-process access.

### Work unit 4 — Board initialization planner and initialization transaction seam

#### Modules

- `extensions/kanban-flow/requirements/initialize.ts`
- focused extensions to the repository/state-transaction seam

#### Implementation

- Detect exact uninitialized, initialized, partially initialized, migrated, and ambiguous repository states.
- Derive canonical GitHub repository identity through direct Git/GitHub adapters as specified; do not accept a child/model-supplied identity.
- Build the exact schema-version-1 `board.yaml`, `config.yaml`, and canonical empty `BOARD.md` candidate with transaction metadata.
- Apply secure default config from the specification; do not infer commands from package files unless explicitly specified.
- Extend the transaction repository/coordinator with a typed initialization path that does not weaken normal `readBoardRepository()` validation.
- Ensure the state descriptor path set exactly equals the initialized diff.
- Refuse existing conflicting files, dirty owned paths, symlinks, special files, non-GitHub/origin/main layouts, or a pending/unresolved state transaction.
- Keep initialization LLM-free and do not create `docs/spec.md` or cards unless Work unit 0 explicitly specifies combined initialization.

#### Tests

- Empty valid repository initialization through fake GitHub and real disposable Git.
- Existing initialized board is an idempotent report/no-op, not a rewrite.
- Every partial/conflicting layout fails closed.
- Repository identity, remote/base, path, symlink, dirty-tree, and stale-base failures.
- Crash windows before/after worktree, commit, push, and PR creation.
- Exact initial bytes, descriptor, trailers, marker, and human-only PR.

#### Exit

An uninitialized trusted repository can propose one deterministic initialization state PR without an LLM or direct `main` write.

### Work unit 5 — Producer/checker dispatch service

#### Module

- `extensions/kanban-flow/requirements/dispatch.ts`

#### Implementation

- Discover and validate both requirements agents and all considered overrides before mutation/external action.
- Require persisted saved trust for the broad producer and any project override.
- Resolve parent model inheritance and each explicit override before spawn, with no fallback.
- Assemble only approved project context and allowlisted skills for the producer.
- Dispatch the producer sequentially under broad-read policy against the canonical repository.
- Normalize and structurally validate its proposal through Work units 1–3.
- Materialize the exact authoritative commit snapshot containing deterministic proposal inputs for the strict checker as defined by the specification.
- Dispatch the checker with the complete ordered criterion set and no arbitrary project context/skills.
- Validate complete criterion order, derived status, evidence, blocking findings, final events, actual model identity, cleanup, and parent attestation.
- Render accepted producer/checker artifact proposals without writing board state.
- On `blocked`, `needs_human`, `fail`, or `inconclusive`, return a typed non-mutating outcome. Do not invent an automatic retry budget.
- Wire lock-owner abort into both child runs, but keep locking itself in the workflow coordinator.

#### Tests

- Initial proposal and amendment proposal pass paths.
- Producer needs-human/blocked and checker fail/inconclusive paths.
- Malformed override, missing saved trust, unavailable model, invalid payload, missing result, timeout, abort, and cleanup failure.
- Producer receives approved context; checker sees only immutable inputs.
- Exact criteria and artifact/attestation identity.
- Before/after proof of no board, ref, worktree, lock, or GitHub mutation by this service.

#### Exit

The service returns a checked typed proposal plus parent-attested artifact bytes, or a bounded non-mutating failure/revision outcome.

### Work unit 6 — Approval document and interaction adapter

#### Modules

- `extensions/kanban-flow/requirements/approval.ts`
- Pi UI adapter in `extensions/kanban-flow/tools/requirements.ts`

#### Implementation

- Render one canonical approval document containing:
  - exact requirement additions/amendments/supersessions/retirements;
  - prospective stable IDs;
  - card creates/updates/replacements and acceptance criteria;
  - dependency rewires;
  - per-card status effects;
  - every grandfathered card and retained assumption;
  - design PRs that must be closed;
  - checker verdicts/findings;
  - active project-agent overrides and model identities;
  - exact proposed state paths; and
  - the authoritative base commit.
- Compute a digest over the complete normalized approval input, not display text alone.
- Expose an injected `approve|revise|cancel` adapter for deterministic tests.
- Require explicit user approval of the digest. Silence, UI dismissal, abort, timeout, revise, or unsupported mode is not approval.
- After approval, re-fetch/reconcile and reject stale base, changed board, changed proposal, changed external PR state, lost lock, or changed digest.
- Ensure no file, Git, or GitHub mutation occurs before approval.
- Keep proposal text bounded and redact machine-local paths/secrets.

#### Tests

- Golden initial/amendment approval documents and digests.
- Approve, revise, cancel, dismissal, abort, unsupported-mode, and oversized-display cases.
- One-bit proposal/base/override/model/artifact changes alter the digest.
- Approval replay and stale-base rejection.
- Path/secret canaries.
- UI adapter smoke test on the supported Pi modes recorded in Work unit 0.

#### Exit

Exactly one explicit, auditable approval binds one fully checked proposal to one authoritative base; nothing mutates before it.

### Work unit 7 — Locked requirements workflow and state-transaction integration

#### Modules

- `extensions/kanban-flow/requirements/workflow.ts`
- `extensions/kanban-flow/reconciliation/requirements.ts`
- focused state-transaction/GitHub adapter extensions

#### Implementation

- Generate one operation ID and acquire the common-Git-directory lock with command `requirements`.
- Keep heartbeat active while dispatching and awaiting UI; lost ownership aborts children and prevents new external actions.
- Fetch and reconcile before planning. Pending/open or unresolved closed state PRs stop the workflow.
- If reconciliation itself requires durable mutation, propose only reconciliation and stop; do not run requirements work.
- For a `design_review` amendment, post/reuse the canonical `requirements-design-close` action marker, close the exact unmerged design PR, confirm closure, and revalidate that it did not merge first.
- If the PR merged first, stop and require retry from the newly authoritative reconciled status; do not grandfather from stale status in the same operation.
- Build one immutable approved mutation from fresh `origin/main`.
- Finalize IDs, histories, artifacts, spec/cards, counters, `last_writer_package_version`, `last_reconciled_at`, `last_state_transaction`, and canonical `BOARD.md`.
- Update the held lock with the allocated transaction ID.
- Propose exactly one human-only state PR using the existing coordinator.
- Release the lock on success, cancel, handled failure, abort, and shutdown; surface release/cleanup failures.
- Return typed outcomes for proposed, pending, merged/no-op, revision required, blocked, cancelled, and failed states.

#### Tests

- Initial requirements creation and each amendment status path through fake GitHub plus real Git.
- Pending/unresolved state PR and reconciliation-only boundaries.
- Design PR closure success, duplicate marker reuse, crash after close, close/merge race, conflicting marker, and GitHub failure.
- Lock contention, heartbeat, ownership loss during producer/checker/approval/transaction, and release.
- Base changes before approval, after approval, before push, and before PR creation.
- Exact state diff and artifact inclusion.
- Failure injection proving atomic board behavior and no direct `main` mutation.

#### Exit

An approved proposal becomes at most one pending state PR, and no success is inferred before that PR merges.

### Work unit 8 — Pi-facing tools, skills, and thin extension wiring

#### Assets/modules

- `skills/kanban-init/SKILL.md`
- `skills/requirements/SKILL.md`
- `extensions/kanban-flow/tools/initialize.ts`
- `extensions/kanban-flow/tools/requirements.ts`
- final wiring in `extensions/kanban-flow/index.ts`

#### Implementation

- Add valid packaged skill frontmatter and concise Pi-native instructions.
- `/skill:kanban-init` explains trust/prerequisites and invokes only the deterministic initialization surface.
- `/skill:requirements` conducts a one-question-at-a-time interview, stops when the request is testable, and invokes the deterministic requirements surface with a bounded brief.
- Keep both skills free of direct write, shell, Git, GitHub, ID-allocation, or state-transition instructions.
- Register narrowly named tools with strict TypeBox inputs and stable structured outputs as defined in Work unit 0.
- Keep the extension entry point thin and compatibility-gated.
- Refuse mutation without saved trust even if the interactive parent is temporarily approved.
- In unsupported/non-interactive modes, return the specified preparation/refusal outcome rather than silently approving.
- Report the state PR URL, affected cards, active overrides, and next action without claiming the unmerged state is authoritative.

#### Tests

- Skill discovery, frontmatter, package provenance, and command names.
- Extension registration snapshots.
- Tool input unknown-field and size rejection.
- Skill/tool authority-boundary lint tests: no direct board edits, arbitrary shell, `--approve`, or model-owned IDs/transitions.
- Local, symlinked, pinned-Git, and npm-packed skill/tool loading.
- TUI/RPC/non-interactive behavior according to the specification.

#### Exit

The native `/skill:kanban-init` and `/skill:requirements` surfaces are discoverable and delegate all mutation authority to deterministic code.

### Work unit 9 — End-to-end initial and amendment acceptance

#### Scenarios

Run complete disposable-repository scenarios:

1. **Initialization**
   - trusted repository with no board;
   - initialize through one state PR;
   - verify no direct `main` write;
   - simulate human merge; and
   - validate the authoritative empty board.

2. **Initial requirements**
   - interview brief for a new product;
   - real producer and strict checker;
   - one approval surface;
   - stable REQ/CARD/AC/FINDING allocation;
   - one state PR containing spec, cards, artifacts, counters, histories, and dashboard;
   - simulate human merge; and
   - validate an actionable backlog.

3. **Same-meaning amendment**
   - retain the requirement ID;
   - update affected pre-design cards; and
   - prove unrelated IDs/bytes remain stable.

4. **Changed-meaning supersession**
   - allocate a replacement REQ;
   - replace/update backlog cards and rewire dependencies;
   - revise `designing` cards;
   - close and return a `design_review` card to `designing`; and
   - grandfather cards at and beyond `ready_for_implementation` with complete follow-up coverage.

5. **Negative/recovery**
   - missing trust;
   - malformed override;
   - checker failure and revision;
   - approval cancellation;
   - stale approval;
   - pending/closed state PR;
   - design PR merge race;
   - child timeout/abort;
   - lock ownership loss; and
   - GitHub unavailability.

#### Evidence

- Use real Pi/provider acceptance as an explicit opt-in test and keep event logs outside tracked source.
- Capture sanitized provider/model/tool/stop metadata.
- Verify before/after refs, worktrees, locks, board paths, and fake/live GitHub state.
- Prove the checker cannot see mutable checkout changes or project-only producer context.

#### Exit

Both Stage 3 happy paths and the amendment matrix work from installed-package and checkout execution without direct board mutation or model-owned authority.

### Work unit 10 — Package, documentation, completion gate, and Stage 4 handoff

#### Package/documentation

- Document installation, saved trust, restart expectations, initialization, requirements interviews, approval, state PR review/merge, overrides, model inheritance, and failure recovery.
- Make clear that merging a state PR is the authority boundary and that Stage 3 does not run design or implementation.
- Ensure packed contents include both skills and all required runtime modules/assets.
- Exclude test fixtures, event logs, temporary prompts/snapshots, dispatch records, and `reference/`.
- Extend read-only diagnostics only where a stable Stage 3 readiness contract is defined.

#### Final validation

```text
npm run typecheck
npm test
npm run package
npm run package:check
git diff --check
```

Also run:

- real Git initialization and requirements state transactions;
- opt-in real Pi producer/checker acceptance;
- supported macOS/Linux and minimum/current Node/Pi matrix where CI permits;
- local, symlinked, pinned-Git, and npm-packed workflows; and
- before/after mutation-authority checks.

#### Completion checkpoint

Add `docs/checkpoint-stage-3-complete.md` recording:

- merged PRs and important commit IDs;
- specification decisions and any revised contracts;
- implemented modules, tools, and skills;
- exact tests and platform/package matrix;
- initialization and initial/amendment acceptance evidence;
- real provider/model scenarios;
- override/trust/checker/approval/design-closure scenarios;
- known gaps and deferred behavior;
- proof that no child or skill owned board/Git/GitHub transitions; and
- the first permitted Stage 4 design-workflow item.

#### Exit

The Stage 3 migration-plan exit condition is satisfied: a new trusted repository can move from no board to an approved backlog through human-reviewed state PRs, and later requirement changes apply the specified atomic status-dependent effects.

## 7. Cross-cutting implementation rules

- Start every plan from fresh `origin/main`; proposed state is never authority.
- Acquire the common lock before reconciliation or mutating workflow work.
- Keep the lock heartbeat active during long child/UI operations and abort on ownership loss.
- Validate all considered overrides, models, skills, paths, and config before external actions.
- Use saved trust, never temporary approval or `defaultProjectTrust: always`.
- Use direct executable/argv invocation only; never interpolate configured values through a shell.
- Keep interview prose untrusted and bounded. It is input to a producer, not a state mutation.
- Treat child payloads and checker verdicts as evidence. The engine independently validates the complete candidate.
- Allocate durable IDs only in the parent and only from authoritative counters.
- Never consume an ID because a proposal was rejected, revised, cancelled, or failed.
- Never permit a child/model-selected path to authorize a write.
- Preserve exact path-class ownership: state PRs only for `docs/spec.md` and `docs/cards/**`.
- Stage exact files only and validate descriptor paths against the complete diff.
- Keep requirements artifacts parent-attested and free of absolute machine paths/secrets.
- Make approval explicit, digest-bound, base-bound, and invalid after any relevant change.
- Do not persist interview transcripts or child prose unless a versioned durable schema explicitly requires it.
- Do not infer a requirements retry budget from design/implementation rework limits.
- Preserve historical requirements and terminal cards; never renumber or reuse IDs.
- Derive grandfathering mechanically from authoritative status; never accept it from the child.
- A design PR closure is parent-owned, idempotently marked, and revalidated against GitHub.
- A state PR remains pending until human merge. Report it; do not continue to design.
- Keep package assets resolvable from checkout, symlink, pinned Git, and npm-packed installs.
- Keep `reference/` read-only.

## 8. Test organization

Use:

- `test/unit/requirements-criteria.test.ts` for fixed criterion order;
- `test/unit/requirements-proposal.test.ts` for typed proposal normalization;
- `test/unit/requirements-allocation.test.ts` for preview/final IDs and references;
- `test/unit/requirements-impact.test.ts` for every status-dependent amendment effect;
- `test/unit/requirements-render.test.ts` for canonical bytes and approval documents;
- `test/unit/requirements-approval.test.ts` for digest and decision behavior;
- `test/unit/initialization.test.ts` for no-board planning/defaults;
- `test/unit/requirements-workflow.test.ts` for orchestration with injected boundaries;
- `test/integration/initialization-state-pr.test.ts` for real Git initialization;
- `test/integration/requirements-state-pr.test.ts` for real Git initial/amendment transactions;
- `test/integration/requirements-design-close.test.ts` for marked GitHub closure/recovery;
- `test/integration/requirements-pi-surface.test.ts` for skill/tool loading and interaction; and
- opt-in installed-package/real-provider tests for the complete vertical path.

Fixtures should cover:

- uninitialized, partially initialized, and initialized repositories;
- initial specs and every requirement action;
- cards in every durable status;
- dependency rewires and cycles;
- producer/checker pass, fail, inconclusive, blocked, and needs-human payloads;
- canonical approval documents;
- pending/merged/closed state PRs; and
- open/merged/closed design PR races.

Generated prompts, snapshots, dispatch records, provider event streams, and temporary worktrees remain outside tracked source.

## 9. Per-PR validation

Before opening each PR:

1. run focused tests for the changed behavior;
2. run `npm run typecheck`;
3. run the complete test suite when shared schemas, repository semantics, transitions, locking, process handling, transaction behavior, extension registration, or package contents changed;
4. run real-process/Git tests for lock, path, process, or transaction changes;
5. run `npm run package` and `npm run package:check` when skills, runtime modules, agents, templates, or package contents changed;
6. run `git diff --check`;
7. stage exact paths and inspect the staged diff; and
8. state what remains unproved, especially live GitHub, real provider/authentication, RPC UI, minimum versions, Linux, or installed-package behavior.

Mocks, child-reported success, UI notifications, and unmerged PR content are not gate authority.

## 10. Stage 3 completion gate

Stage 3 is complete only when all of the following are true:

- protected `main` includes the Stage 2 completion checkpoint;
- the requirements-workflow specification and Stage 3 prerequisite checkpoint are merged;
- initialization defaults, no-board transaction behavior, approval semantics, checker-failure behavior, and lock scope are exact;
- `/skill:kanban-init` and `/skill:requirements` are discoverable from checkout and installed packages;
- saved trust is required and temporary/global trust does not qualify;
- initialization proposes one human-only state PR and never writes `main` directly;
- an initialized board can create its first spec and backlog through producer, checker, approval, and one state PR;
- initial creation does not assume `docs/spec.md` exists;
- stable REQ/CARD/AC/FINDING IDs are parent-allocated, monotonic, and not consumed by failed/cancelled attempts;
- requirements checker dispatch includes every fixed criterion exactly once and complete evidence;
- checker fail/inconclusive/needs-human outcomes cannot create a state PR;
- one explicit approval is required, digest/base bound, and invalidated by stale state;
- same-meaning amendments retain requirement IDs;
- changed meaning creates active replacements and preserves superseded history;
- backlog, designing, design-review, grandfathered in-flight, done, and replaced card effects match the state-machine specification;
- dependency rewiring, replacement lineage, active coverage, and DAG validation are atomic;
- design PR closure is exact, idempotently marked, race-safe, and parent-owned;
- accepted producer/checker artifacts are parent-attested and stored at deterministic requirements paths;
- pending or unresolved state transactions block new requirements work;
- reconciliation-only mutation consumes the operation;
- lock contention, heartbeat, ownership loss, cancellation, abort, and release semantics pass;
- no child or skill receives board, Git, GitHub, ID-allocation, path-selection, approval, or transition authority;
- successful and failed workflows leave no leaked process, prompt, snapshot, lock, or unsafe worktree;
- local, symlinked, pinned-Git, and npm-packed scenarios pass;
- typecheck, tests, package checks, and `git diff --check` pass; and
- the Stage 3 completion checkpoint gives Stage 4 an exact starting point.

## 11. Stop conditions

Stop and request direction instead of weakening the design when any of these occurs:

- a detailed specification contradiction or an unresolved Work unit 0 question;
- initialization would require accepting partial/ambiguous board state;
- the workflow cannot distinguish explicit user approval from model inference;
- non-interactive mode would need implicit approval;
- an approval cannot be bound to an exact proposal and authoritative base;
- a requirements checker failure would require inventing an unspecified retry budget;
- persisted saved trust cannot be proved;
- reconciliation or a pending/closed state transaction is ambiguous;
- a design PR closure cannot be made idempotent or races with merge;
- a child/model would need to allocate IDs, choose durable paths, mutate files, run Git/GitHub, or authorize a transition;
- a state transaction would include paths outside `docs/spec.md` and `docs/cards/**`;
- a durable artifact would expose a machine-local absolute path or secret;
- lock heartbeat/ownership loss cannot abort safely;
- a package install cannot resolve the Stage 3 skills/tools/assets;
- implementation would require arbitrary child shell access; or
- implementation would modify `reference/`.

When escalation is required, summarize completed work, present three alternatives, recommend one, and wait for direction.

## 12. First action for the next agent

Start with Work unit 0 from fresh protected `main`:

1. create a focused specification branch;
2. verify `origin/main` still contains the Stage 2 completion checkpoint;
3. inspect the current state transaction, lock, repository, Pi UI, and skill/tool seams;
4. write `docs/spec-requirements-workflow.md` with exact initialization, approval, checker-failure, artifact, lock, reconciliation, and crash semantics;
5. run the disposable Pi approval/skill interaction spike;
6. add the Stage 3 review matrix and prerequisite checkpoint;
7. run documentation/package validation and `git diff --check`; and
8. open the specification PR before implementing proposal normalization or any mutating workflow.
