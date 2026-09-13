# Stage 1 implementation handoff checkpoint

**Checkpoint:** 2026-09-13
**Stage 0 merge:** `ccd4471` (PR #1)
**Next stage:** Stage 1 — package and deterministic core
**Production implementation status:** not started

## Purpose

This checkpoint gives a new agent enough repository and sequencing context to begin Stage 1 safely. It is a navigation and execution aid, not a replacement for the specifications. If this document differs from a detailed `docs/spec-*.md` document, the detailed specification is authoritative.

## Required reading before editing

Read these files in order and completely:

1. `AGENTS.md`
2. `docs/migration-plan.md`
3. `docs/stage-0-specifications.md`
4. `docs/spec-development-process.md`
5. the detailed specifications relevant to the work item
6. `docs/spec-readiness-review.md`
7. `docs/stage-0-review-matrix.md`

For Stage 1, the most important detailed specifications are:

- `docs/spec-board-schema.md`
- `docs/spec-state-machine.md`
- `docs/spec-lock-lease.md`
- `docs/spec-state-pr-protocol.md`
- `docs/spec-structured-results.md` for result-schema types only
- `docs/spec-child-agent-runner.md` where package paths and future boundaries affect the core

Use `docs/spec-legacy-behavior-mapping.md` before porting any behavior from `reference/kanban-flow/`.

## Repository state at handoff

- Stage 0 is approved in `docs/spec-readiness-review.md`.
- PR #1 merged the complete specification baseline into `main`.
- `main` is protected:
  - changes require a pull request;
  - protection applies to administrators;
  - stale reviews are dismissed;
  - conversations must be resolved;
  - force pushes and branch deletion are disabled;
  - there are currently no required approvals or status checks.
- The package manifest and directory scaffold exist.
- There are no production TypeScript files, skills, agent prompts, or tests yet.
- Empty implementation directories are placeholders, not implemented behavior.
- `reference/kanban-flow/` is committed as a read-only behavioral source and migration fixture. Never edit, format, rename, or generate files under it.
- `npm pack --dry-run` currently excludes `reference/` and `test/` through `.npmignore`.

Current local validation environment at Stage 0 close:

- Pi 0.85.1
- Node.js 24.18.1
- Git 2.54.0
- GitHub CLI 2.97.0
- macOS 26.6.2

The supported minimums remain those in `docs/spec-development-process.md`.

## Binding architecture boundaries

Do not weaken these constraints during implementation:

- TypeScript owns parsing, validation, transitions, scheduling, locking, reconciliation, rendering, and board mutation.
- Models produce artifacts and bounded judgments; they never mutate board state.
- `origin/main` is authoritative.
- Every durable board mutation goes through a human-merged state PR.
- Design and product changes use separate PR classes with disjoint exact path ownership.
- One pump selects at most one card. A reconciliation-only durable mutation selects no card and consumes the pump.
- Worktree paths and other machine-local absolute paths are never durable.
- `docs/cards/BOARD.md` is canonical derived output and contains no independent state.
- `board.yaml.state.last_state_transaction` is a pre-commit descriptor. Commit, PR, and merge outcomes are discovered through trailers and markers.
- Board, config, card, result, marker, lock, and history schemas are strict and reject unknown fields.
- Process invocation uses executable plus argv directly; never interpolate configured commands through a shell.
- Stage 1 must remain LLM-free.
- Do not implement deferred behavior merely because it exists in the reference package.

## Stage 1 objective

Implement the package and deterministic core so a fixture board can be:

1. read and strictly validated;
2. deterministically scheduled;
3. legally transitioned without an LLM;
4. rendered byte-for-byte as canonical Markdown;
5. protected by the common-Git-directory lock; and
6. proposed idempotently through a human-only state PR.

Also expose a diagnostic Pi command/tool that validates a board without mutation.

## Required implementation order

Follow the order mandated by `docs/spec-development-process.md`. Do not skip ahead to skills or agent workflows.

### 1. Package manifest and extension skeleton

Implement a loadable TypeScript entry point under `extensions/kanban-flow/`.

Required outcomes:

- package loads from a local path without Pi diagnostics;
- extension startup checks the supported Pi range `>=0.85.0 <0.86.0` before registering mutating commands;
- Pi-bundled core packages and `typebox` retain `"*"` peer ranges;
- non-Pi runtime libraries are declared in `dependencies`, not assumed from the host;
- test/build/typecheck scripts and required development dependencies are explicit;
- extension registration remains thin and delegates deterministic behavior to engine modules.

Do not add user-facing workflow skills yet.

### 2. Package asset resolver

Implement one package-root/asset resolver used everywhere.

It must support:

- a local checkout;
- a symlinked installation;
- a pinned Git package installation;
- an npm-packed installation;
- ESM/module URL resolution without `${CLAUDE_PLUGIN_ROOT}`;
- normalized paths and clear missing-asset errors.

Add a packed-install test that builds or packs the package into a temporary project and proves required assets resolve. Preserve the package boundary: `reference/` and tests must not ship.

### 3. Exact schemas

Translate `docs/spec-board-schema.md` and the deterministic portions of `docs/spec-structured-results.md` into strict TypeBox schemas plus semantic validators.

At minimum implement types/validation for:

- `board.yaml`;
- `config.yaml`;
- requirement lines in `docs/spec.md`;
- card frontmatter and fixed Markdown body sections;
- IDs and monotonic counters;
- blocker, workflow, PR, artifact, history, migration, transaction-descriptor, and split-override records;
- legal status-specific cross-field invariants;
- dependency existence and cycle detection;
- normalized repository-relative paths;
- marker and commit-trailer objects needed by Stage 1 state transactions.

TypeBox validates shape. Engine code must enforce cross-field, chronological, graph, reciprocal-lineage, status, and filesystem constraints that JSON Schema cannot express.

Create focused valid and malformed fixtures as each schema lands. Never infer or normalize ambiguous durable state silently.

### 4. Board repository and canonical rendering

Implement repository operations under `extensions/kanban-flow/board/` and rendering under `extensions/kanban-flow/engine/`.

Required behavior:

- read UTF-8 YAML/Markdown from the exact layout;
- reject symlinks, special files, duplicate IDs, unknown files where prohibited, malformed frontmatter, invalid line endings where specified, and path escapes;
- parse all state before permitting mutation;
- keep an in-memory typed snapshot separate from file writes;
- render cards and `docs/cards/BOARD.md` exactly as specified;
- sort all IDs, cards, dependencies, paths, and sections deterministically;
- perform atomic exact-path writes;
- prove parse/render stability and byte-for-byte fixture output.

The optional `docs/cards/PROTOCOL-ADDENDUM.md` is trusted guidance but cannot change engine authority.

### 5. State machine and scheduler

Implement legal transitions and deterministic selection from `docs/spec-state-machine.md`.

Required tests include:

- every legal table row;
- representative illegal source/target, guard, and effect combinations;
- blocked/resume status-pair validation;
- no extra transition during blocker clearing;
- design and implementation rework counter boundaries;
- dependency cycle rejection and dependency completion guards;
- priority then card-ID ordering;
- `designing` semantics;
- requirement grandfathering by durable status;
- requirement-driven versus split-driven replacement;
- grandfathered `split_required` plus explicit immutable `proceed_unsplit` override;
- recovery-only transitions after externally merged PRs;
- one selected card maximum and zero cards for reconciliation-only work.

Keep transition functions pure where possible: typed snapshot plus typed event should produce a proposed typed snapshot/effects without filesystem, GitHub, or model side effects.

### 6. Common-Git-directory lock

Implement `docs/spec-lock-lease.md` exactly under `extensions/kanban-flow/board/`.

Required behavior/tests:

- derive identity using direct Git argv and the canonical common Git directory;
- secure file/directory modes;
- exclusive short-lived mutation mutex;
- atomic create/replace;
- exact owner-token revalidation for heartbeat/release;
- contention reporting;
- stale-lock confirmation and audited break;
- corrupt JSON and symlink refusal;
- pid/token races and lost ownership;
- force-unlock confirmation;
- release on normal failure, abort, and shutdown paths.

A local lock does not solve multi-clone/multi-host concurrency; do not broaden the support claim.

### 7. Git/GitHub marker discovery and state transaction protocol

Implement the Stage 1 subset of `docs/spec-state-pr-protocol.md` under `extensions/kanban-flow/state-pr/`.

Required behavior/tests:

- direct executable/argv invocation for Git and `gh`;
- deterministic state branch `kanban/state/<KFTX-ID>`;
- canonical PR marker and commit trailers;
- exact descriptor path set equal to the state-owned diff;
- isolated state worktree from fresh `origin/main`;
- exact-path staging, post-stage diff validation, commit, push, and PR creation;
- at most one open or unresolved closed state transaction;
- unique reuse of an existing marked branch/PR after interruption;
- no duplicate external action after crash windows;
- human-only merge policy;
- fail closed on unavailable GitHub, changed base OID, conflicting markers, ambiguous branches, or malformed trailers;
- no follow-up transaction merely to record a state PR's own commit/PR/merge metadata.

Implement external command adapters so tests can use deterministic fakes/fixtures. Do not require live GitHub for the core test suite. A disposable-repository integration test may exercise real `git`; live `gh` validation should remain explicit and opt-in.

### 8. Diagnostic validation command/tool

Expose a non-mutating Pi-facing diagnostic command/tool under `extensions/kanban-flow/tools/`.

It should:

- locate the canonical repository root;
- report runtime compatibility and required executable availability;
- read and fully validate board/config/spec/cards;
- render in memory and report drift without writing;
- report pending/ambiguous marker state only when explicitly asked and GitHub authority is available;
- return deterministic structured diagnostics with paths relative to the repository;
- never acquire a mutation lock, create branches, write files, or invoke a model.

Choose the final command/tool name consistently and document it when the extension skeleton is introduced.

## Suggested module boundaries

The repository layout in `AGENTS.md` is binding at the directory level. A reasonable internal split is:

```text
extensions/kanban-flow/
├── index.ts
├── board/
│   ├── schemas.ts
│   ├── semantic-validation.ts
│   ├── repository.ts
│   ├── requirements.ts
│   ├── cards.ts
│   ├── config.ts
│   └── lock.ts
├── engine/
│   ├── ids.ts
│   ├── paths.ts
│   ├── transitions.ts
│   ├── scheduler.ts
│   └── render.ts
├── state-pr/
│   ├── process.ts
│   ├── git.ts
│   ├── github.ts
│   ├── markers.ts
│   └── transaction.ts
└── tools/
    └── validate.ts
```

This is guidance, not permission to contradict a specification. Prefer small modules with explicit typed inputs over one large orchestrator.

## Test strategy for Stage 1

Add focused tests concurrently with each component under:

- `test/unit/` for schemas, semantic validation, IDs, paths, transitions, scheduling, rendering, lock record logic, and marker parsing;
- `test/fixtures/boards/` for valid and malformed board snapshots plus canonical render outputs;
- `test/fixtures/projects/` for Git/worktree/packaging cases;
- `test/integration/` for repository round trips, real local Git state transactions, lock contention, interruption/retry, and extension loading.

Minimum deterministic-core exit evidence:

- unknown fields and malformed fixtures fail;
- valid fixtures round-trip without semantic drift;
- canonical rendering is byte-stable;
- every legal transition and key illegal guard is covered;
- scheduler order and dependency rules pass;
- lock contention, stale, corrupt, ownership-loss, and release cases pass;
- an LLM-free state PR can be created idempotently using a fake GitHub adapter;
- package assets resolve from an npm tarball;
- the diagnostic command validates without mutation;
- typecheck and all tests pass.

Do not claim Stage 1 complete with placeholder implementations or tests that merely restate fixtures.

## Stage boundary and mandatory spikes

The two feasibility spikes in `docs/spec-development-process.md` remain mandatory. They are not permission to mix agent workflow behavior into the deterministic core.

After the deterministic core and diagnostic tool are working:

1. run the role-specific structured-result spike;
2. run the trust/resource-policy spike;
3. record exact commands, Pi version, provider/model where applicable, event samples with secrets/absolute paths removed, and pass/fail conclusions;
4. if a spike fails, stop and update the relevant specification before continuing;
5. only after both pass may Stage 2 production runner/agent work proceed.

The unresolved trust fact is important: `ctx.isProjectTrusted()` includes temporary approval and cannot by itself prove persisted trust. Do not silently substitute `--approve`, `defaultProjectTrust: always`, or a weaker trust interpretation.

## Deferred work — do not start in Stage 1

- user-facing `requirements`, `design`, `implement`, `review`, `ship`, or `kanban` skills;
- packaged specialist prompts;
- production child-process runner or model dispatch;
- project agent override loading;
- product/design PR workflows beyond deterministic shared primitives;
- automatic state PR merge;
- unattended loops;
- post-review multi-PR split shipping;
- ADR persistence;
- retro/testing-level telemetry;
- Windows support;
- Claude board migration code before the Stage 5 exact-field mapping appendix exists.

## Known risks and stop conditions

Stop and request direction rather than coding around any of these:

- a detailed specification contradiction;
- a required durable field that cannot be known at commit time;
- inability to make a state transaction idempotent across a documented crash window;
- a proposal to persist worktree or temporary absolute paths;
- ambiguous Git/GitHub authority;
- a need to broaden product/state/design path ownership;
- a need for shell interpolation of configured commands;
- a Pi API incompatibility with the declared range;
- a failed mandatory spike;
- any need to modify `reference/`.

When direction is needed, summarize completed work, present three alternatives, recommend one, and wait.

## Working and review process

- Start each coherent unit from fresh protected `main` on a feature branch.
- Keep PRs focused; Stage 1 does not need to be one large PR.
- Add tests in the same PR as behavior.
- Do not push directly to `main`.
- Before each PR run the relevant tests, full typecheck, `git diff --check`, and package checks when package contents change.
- Use exact path staging and inspect the staged diff.
- State what remains unproved; do not mark a gate complete based only on mocks.
- Update this checkpoint or add a successor checkpoint when ownership changes or Stage 1 completes.

## Recommended first work unit

Begin with one small PR containing:

1. extension entry point and startup compatibility check;
2. package-root/asset resolver;
3. explicit test/typecheck scripts and minimal tooling;
4. local and npm-packed asset-resolution tests;
5. a basic non-mutating extension-load smoke test.

Then proceed to schema and repository PRs. This establishes package mechanics before core modules depend on path assumptions.

## Completion handoff

When Stage 1 is complete, leave a new checkpoint that records:

- merged PRs and important commit IDs;
- implemented modules and public entry points;
- exact test commands and results;
- fixture coverage and known gaps;
- state transaction integration evidence;
- package/install smoke-test evidence;
- whether each mandatory spike passed and links to sanitized evidence;
- any specification revisions;
- the next permitted Stage 2 work item.
