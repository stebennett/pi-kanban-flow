# Stage 1 implementation plan

**Status:** Ready for implementation
**Prepared from:** `docs/checkpoint-stage-1-handoff.md`
**Authoritative base at preparation:** `main` at `4af39c4`
**Stage objective:** Package and deterministic core

## 1. Purpose

This document is the execution plan for completing Stage 1. It is written so a new agent can begin work without reconstructing sequencing or delivery boundaries.

It is an implementation aid, not a replacement for the detailed specifications. If this plan differs from a detailed `docs/spec-*.md` document, the detailed specification is authoritative. Stop and resolve specification contradictions rather than coding around them.

## 2. Required reading before editing

Read these files completely and in this order:

1. `AGENTS.md`
2. `docs/migration-plan.md`
3. `docs/stage-0-specifications.md`
4. `docs/spec-development-process.md`
5. the detailed specifications relevant to the current work unit
6. `docs/spec-readiness-review.md`
7. `docs/stage-0-review-matrix.md`
8. `docs/checkpoint-stage-1-handoff.md`
9. this plan

The primary Stage 1 specifications are:

- `docs/spec-board-schema.md`
- `docs/spec-state-machine.md`
- `docs/spec-lock-lease.md`
- `docs/spec-state-pr-protocol.md`
- the deterministic schema portions of `docs/spec-structured-results.md`
- the package-path and future-boundary portions of `docs/spec-child-agent-runner.md`
- `docs/spec-project-overrides-config.md` where it constrains config validation

Read `docs/spec-legacy-behavior-mapping.md` before using `reference/kanban-flow/` as a behavioral source. Never edit, format, rename, or generate files under `reference/`.

When implementing Pi package, extension, command, or tool behavior, also read the installed Pi documentation and relevant examples identified in `AGENTS.md`.

## 3. Current baseline

At `main` commit `4af39c4`:

- the worktree is clean and matches `origin/main`;
- the package manifest and directory scaffold exist;
- no production TypeScript files, tests, skills, prompts, or runtime assets are implemented;
- `package.json` has the package identity, Pi resource roots, Node baseline, and required wildcard Pi/TypeBox peers;
- `package.json` has no scripts, runtime dependencies, development dependencies, or lockfile;
- `tsconfig.json` is strict, ESM/NodeNext, and no-emit;
- `.npmignore` excludes `reference/` and `test/`;
- `npm pack --dry-run` currently proves only the scaffold/package boundary, not runtime loadability or asset resolution.

Empty directories and `.gitkeep` files are placeholders, not implemented behavior.

## 4. Binding Stage 1 boundaries

Stage 1 must remain LLM-free. The TypeScript core owns parsing, validation, transitions, scheduling, rendering, locking, reconciliation, and state mutation.

Do not implement during Stage 1:

- user-facing requirements/design/implement/review/ship/kanban workflow skills;
- packaged specialist prompts;
- production child-process execution or model dispatch;
- project-agent override loading;
- automatic state PR merge;
- unattended loops;
- post-review multi-PR split shipping;
- ADR persistence;
- telemetry, quarantine, or nightly probes;
- Windows support;
- Claude board migration code.

Stage 1 may define the strict result, evidence, finding, probe, marker, and attestation schema types needed by deterministic artifacts. It must not implement the production child runner.

## 5. Architectural dependency direction

Keep dependencies moving in this direction:

```text
thin Pi entry point and diagnostic registration
        |
        +--> package-root and asset resolver
        |
        +--> diagnostic service
                |
                +--> board repository --> strict schemas and semantic validators
                |                         |
                |                         +--> canonical in-memory rendering
                +--> optional marker discovery through injected adapters

pure transitions and scheduler <-- immutable typed board snapshot

state transaction coordinator
        +--> proposed typed snapshot and canonical renderer
        +--> common-Git-directory lock
        +--> direct-argv Git adapter
        +--> GitHub adapter and marker discovery
```

Core schemas, validation, rendering, scheduling, and transitions must not depend on Pi or live GitHub. The extension entry point remains thin.

A reasonable module layout is:

```text
extensions/kanban-flow/
├── index.ts
├── paths.ts
├── board/
│   ├── schemas.ts
│   ├── semantic-validation.ts
│   ├── requirements.ts
│   ├── cards.ts
│   ├── config.ts
│   ├── repository.ts
│   └── lock.ts
├── engine/
│   ├── ids.ts
│   ├── paths.ts
│   ├── render.ts
│   ├── transitions.ts
│   └── scheduler.ts
├── state-pr/
│   ├── process.ts
│   ├── git.ts
│   ├── github.ts
│   ├── markers.ts
│   └── transaction.ts
└── tools/
    └── validate.ts
```

This split is guidance. Detailed specifications control behavior.

## 6. Delivery plan

Implement each coherent unit from fresh protected `main` on a focused feature branch. Tests land in the same PR as behavior. Do not push directly to `main`.

### Work unit 1 — Package mechanics and asset resolution

#### Implementation

- Add explicit scripts for:
  - tests;
  - typechecking;
  - build/package validation;
  - package-content verification.
- Add explicit runtime and development dependencies plus a lockfile.
- Keep Pi-bundled packages and `typebox` as `"*"` peer dependencies.
- Put every non-Pi runtime library in `dependencies`; do not rely on host transitive modules.
- Add `extensions/kanban-flow/index.ts` as a loadable, thin Pi extension.
- Implement startup compatibility checking for Pi `>=0.85.0 <0.86.0` before any future mutating command/tool registration.
- Add one canonical package-root/asset resolver, preferably `extensions/kanban-flow/paths.ts`.
- Use ESM/module URL resolution and realpath-aware normalization; do not introduce `${CLAUDE_PLUGIN_ROOT}`.
- Return clear, bounded missing-asset errors.
- Reserve these diagnostic names consistently:
  - extension command: `/kanban-validate`;
  - read-only tool: `kanban_validate`.
- Do not add workflow skills.

#### Tests

- Local extension-load smoke test with no Pi diagnostics.
- Compatible and incompatible Pi-version behavior.
- Package-root and required-asset resolution from:
  - a local checkout;
  - a symlinked installation;
  - a pinned local Git installation fixture;
  - an npm tarball installed in a temporary project.
- Assert the packed package contains the extension and required runtime assets.
- Assert `reference/` and `test/` do not ship.

#### Exit

Package mechanics and path assumptions are proven before other modules depend on them.

### Work unit 2 — Schema and validation primitives

#### Modules

- `extensions/kanban-flow/engine/ids.ts`
- `extensions/kanban-flow/engine/paths.ts`
- `extensions/kanban-flow/board/schemas.ts`
- initial `extensions/kanban-flow/board/semantic-validation.ts`

#### Implementation

- Implement exact parsing and generation for REQ, CARD, AC, FINDING, KFRUN, KFOP, KFTX, and KFH IDs.
- Implement UTC RFC 3339 and 40-/64-character Git object ID validation.
- Implement strict normalized repository-relative path validation.
- Translate exact durable shapes into strict TypeBox schemas with unknown fields rejected at every nesting level.
- Cover at least:
  - `board.yaml`;
  - `config.yaml`;
  - transaction descriptors;
  - blockers;
  - PR records;
  - history records;
  - workflow records;
  - split overrides;
  - lock and lease-mutex records;
  - PR, action, and resolution markers;
  - commit trailer objects;
  - evidence and findings;
  - deterministic parent probes;
  - Stage 1 artifact and attestation records.
- Use provider-compatible string enums for public result schema types.
- Enforce config constraints including lock timing, direct argv commands, fixed agent names, review lenses, model-selector syntax, and allowed skill paths.

#### Tests

- Boundary tests for every identifier and bounded field.
- Unknown-field rejection at each nesting level.
- Invalid timestamps, object IDs, paths, argv, marker records, counters, and enums.
- Canonical marker JSON and trailer parsing/serialization.

#### Exit

All foundational shapes are exact, strict, and independently testable.

### Work unit 3 — Requirements, cards, and complete semantic validation

#### Modules

- `extensions/kanban-flow/board/requirements.ts`
- `extensions/kanban-flow/board/cards.ts`
- `extensions/kanban-flow/board/config.ts`
- completed `extensions/kanban-flow/board/semantic-validation.ts`

#### Implementation

- Parse the exact machine-readable requirement format in `docs/spec.md`.
- Parse strict card frontmatter and the fixed Markdown body sections.
- Enforce cross-field rules that TypeBox cannot express:
  - filename and ID agreement;
  - ID uniqueness and counter monotonicity;
  - active, superseded, retired, and grandfathered requirement relationships;
  - requirement supersession cycles;
  - dependency existence and cycles;
  - reciprocal replacement lineage;
  - chronological constraints;
  - artifact destination derivation;
  - PR, branch, operation, and commit relationships;
  - every durable status invariant;
  - every legal blocker `(source_phase, resume_status)` pair.
- Reject ambiguous durable state rather than silently inferring or normalizing it.

#### Fixtures and tests

Build complete fixtures incrementally for:

- a minimal valid board;
- every durable card status;
- blocked variants;
- grandfathered requirement cases;
- a valid `proceed_unsplit` override;
- requirement supersession;
- split-driven and requirement-driven replacement lineage;
- malformed frontmatter and card bodies;
- dangling and cyclic dependencies;
- invalid counters, chronology, artifact paths, and PR metadata.

#### Exit

A complete in-memory board snapshot can be shape- and semantically validated without filesystem mutation.

### Work unit 4 — Board repository and canonical rendering

#### Modules

- `extensions/kanban-flow/board/repository.ts`
- `extensions/kanban-flow/engine/render.ts`

#### Implementation

- Locate the canonical repository root.
- Read exact UTF-8 YAML and Markdown layout into one immutable typed snapshot.
- Reject:
  - symlinks and special files;
  - path escapes;
  - prohibited unknown files;
  - duplicate YAML keys;
  - malformed frontmatter;
  - invalid line endings;
  - partial or otherwise invalid board state.
- Parse and validate the complete board before exposing mutation operations.
- Keep typed in-memory snapshots separate from filesystem writes.
- Implement canonical rendering for cards, YAML/artifacts, and `docs/cards/BOARD.md`.
- For `BOARD.md`, enforce:
  - every section is present;
  - blocked cards appear only in Blocked;
  - ordering is priority then card ID;
  - suffix precedence is blocker, design PR, then product PR;
  - LF endings and one final newline;
  - no render timestamp or independent state.
- Implement drift detection without writing.
- Implement atomic exact-path writes as a separate repository operation.

#### Tests

- Parse/render/parse semantic stability.
- Golden byte-for-byte card and dashboard output.
- In-memory render-drift detection.
- Symlink, special-file, unknown-file, CRLF, and path-escape fixtures.
- Failure injection around atomic writes.

#### Exit

A fixture board can be strictly read and rendered byte-for-byte canonically.

### Work unit 5 — Pure state machine and scheduler

The detailed development process does not separately list these modules, while the handoff requires them before the lock/state protocol. Implement them after the typed repository and before transaction orchestration.

#### Modules

- `extensions/kanban-flow/engine/transitions.ts`
- `extensions/kanban-flow/engine/scheduler.ts`

#### Implementation

- Model transitions as typed immutable snapshot plus typed event producing a proposed snapshot/effects.
- Implement every legal transition row in `docs/spec-state-machine.md`.
- Enforce:
  - at most one selected card;
  - zero selected cards for reconciliation-only work;
  - no reliance on unmerged state PR content;
  - same-status transitions only where explicitly specified;
  - blocker clearing as its own state transaction and pump boundary;
  - design and implementation rework budgets;
  - no ship rework counter;
  - immutable terminal cards;
  - requirement amendments by durable status;
  - requirement-driven and split-driven replacement;
  - mandatory split assessment for grandfathered cards;
  - immutable `split_required` plus typed `proceed_unsplit` override;
  - recovery-only transitions after externally proven merges.
- Implement scheduler ordering:
  1. reconcile existing WIP, including `designing`, before backlog;
  2. require dependency readiness;
  3. order by numeric priority;
  4. order by card ID.
- Apply the WIP limit only when starting backlog work.

#### Tests

- Every legal transition table row.
- Representative illegal source, target, guard, and effect combinations.
- Rework counts below, at, and above configured limits.
- Every blocker/resume pair and invalid prerequisites.
- Dependency completion, dangling references, and cycles.
- Priority/ID ties and WIP saturation.
- Grandfathering, split replacement, and recovery-only transitions.
- Assert input snapshots are unchanged and outputs deterministic.

#### Exit

A fixture board can be deterministically scheduled and legally transitioned without filesystem, GitHub, or model side effects.

### Work unit 6 — Common-Git-directory lock

#### Module

- `extensions/kanban-flow/board/lock.ts`

#### Implementation

- Resolve the canonical common Git directory with direct argv:

  ```text
  git rev-parse --path-format=absolute --git-common-dir
  ```

- Store lock state only under `<git-common-dir>/kanban-flow/`.
- Implement secure `0700` directory and `0600` file handling.
- Reject symlinks, special files, insecure ownership/permissions, and unexpected link counts.
- Implement the 10-second exclusive `lease-mutex.json` protocol.
- Implement atomic lock acquisition, heartbeat, transaction-ID update, and release.
- Revalidate repository identity and the 256-bit owner token immediately before replacement/removal.
- Implement contention reporting, stale recovery, corrupt-lock diagnostics, and interactive force unlock.
- Ensure release is attempted on success, handled failure, abort, and shutdown.

#### Tests

- Linked worktrees resolve to the same common lock.
- Contention and bounded owner reporting.
- Heartbeat and release ownership races.
- PID reuse and lost ownership.
- Same-host expired lock with proven-dead process.
- Foreign-host and unverifiable process refusal.
- Corrupt JSON, symlinks, permission drift, hard links, and temporary-file cleanup failure.
- Force-unlock confirmation and exact cleanup scope.

#### Exit

The lock satisfies the full ownership and stale/corrupt-state protocol without claiming multi-host protection.

### Work unit 7 — Process, Git/GitHub, and marker discovery primitives

#### Modules

- `extensions/kanban-flow/state-pr/process.ts`
- `extensions/kanban-flow/state-pr/git.ts`
- `extensions/kanban-flow/state-pr/github.ts`
- `extensions/kanban-flow/state-pr/markers.ts`

#### Implementation

- Create one executable-plus-argv process abstraction; never interpolate configured commands through a shell.
- Inject process, Git, and GitHub adapters for deterministic tests.
- Implement Git operations for fetch, authoritative base resolution, branch/worktree discovery, exact diff inspection, exact staging, commit trailers, push, and reachability.
- Implement the Stage 1 GitHub adapter for PR lookup/creation, comments, state, merge evidence, effective reviews, and check rollups.
- Serialize and parse strict canonical PR, action, and resolution markers plus commit trailers.
- Match candidates by repository, kind, operation/transaction/card IDs, branch, base, marker, trailers, commit, and exact diff.
- Fail closed on missing, duplicate, malformed, or conflicting evidence.
- Discover at most one open state transaction and at most one unresolved closed state transaction.

#### Tests

- Marker/trailer round trips and malformed inputs.
- Pagination and multiple-candidate ambiguity.
- Branch without PR, PR without authoritative metadata, merged PR, and closed-unmerged PR cases.
- GitHub unavailable/rate-limited behavior.
- Real disposable Git repositories, including linked worktrees.
- Exercise SHA-256 Git object IDs where the installed Git supports them.
- Keep live GitHub out of the normal test suite.

#### Exit

External authority can be discovered uniquely through deterministic adapters before transaction side effects are introduced.

### Work unit 8 — Idempotent state transaction protocol

#### Module

- `extensions/kanban-flow/state-pr/transaction.ts`

#### Implementation

- Begin from freshly fetched `origin/main`.
- Reconcile managed markers before selection or mutation.
- Block on a pending or unresolved closed state transaction.
- If reconciliation requires durable mutation, create only a reconciliation transaction and select no card.
- Otherwise accept at most one selected card transition.
- Build one complete proposed snapshot from the original authoritative snapshot.
- Allocate KFTX only after a durable mutation is planned.
- Populate `last_state_transaction` only with pre-commit facts.
- Create `kanban/state/<KFTX-ID>` from fresh `origin/main` in an isolated worktree.
- Render and validate the complete snapshot.
- Require descriptor paths to equal the exact state-owned diff.
- Stage exact paths only and inspect the staged diff.
- Re-fetch and verify the base OID immediately before push and PR creation.
- Commit canonical trailers, push, and create or uniquely reuse the marked human-only state PR.
- Never create a follow-up state transaction solely to record that transaction's own commit, PR, or merge metadata.
- Implement every crash/retry window from `docs/spec-state-pr-protocol.md`.

#### Tests

Use fake GitHub plus real disposable Git repositories to inject interruption:

- before branch creation;
- after branch creation;
- after local commit;
- after push;
- after PR creation;
- after authoritative merge;
- expected base changing before push;
- orphan marked branches;
- duplicate or mismatched markers;
- closed-unmerged state PR adopt/abandon/manual-repair paths;
- merged design/product action recovery;
- exact-diff and path-class violations.

The acceptance scenario must take a fixture board through a legal transition and idempotently propose one state PR without an LLM.

#### Exit

A fixture board can be selected, transitioned, rendered, committed, pushed, and proposed through a human-only state PR idempotently.

### Work unit 9 — Diagnostic command/tool and deterministic-core gate

#### Modules

- `extensions/kanban-flow/tools/validate.ts`
- final wiring in `extensions/kanban-flow/index.ts`

#### Diagnostic behavior

Both `/kanban-validate` and `kanban_validate` delegate to the same read-only diagnostic service. It must:

- locate the canonical repository root;
- report Pi/Node compatibility and Git/`gh` availability;
- read and fully validate board, config, requirements, cards, and artifacts;
- render entirely in memory and report canonical drift;
- use only repository-relative paths in durable/structured output;
- query marker state only when explicitly requested and GitHub authority is available;
- return stable structured diagnostics with deterministic ordering;
- never acquire the mutation lock;
- never write files, create branches/worktrees, invoke a model, or mutate GitHub.

#### Tests

- Valid and malformed fixture diagnostics.
- Stable structured output ordering.
- Render-drift reporting.
- Missing/unavailable executable handling.
- Explicit marker-query opt-in.
- Before/after proof that no files, refs, locks, worktrees, or GitHub state changed.

#### Exit

The complete deterministic core and diagnostic surface satisfy the Stage 1 objective.

### Work unit 10 — Mandatory spikes and completion handoff

After the deterministic core and diagnostic tool work:

1. Run the role-specific structured-result spike from `docs/spec-development-process.md`.
2. Run the saved-trust/resource-policy spike.
3. Record sanitized evidence:
   - exact commands;
   - Pi version;
   - provider/model where relevant;
   - final event samples;
   - macOS/Linux process-group cleanup results;
   - pass/fail conclusions.
4. If either spike fails, stop and revise the relevant specification before any Stage 2 implementation.
5. Add a successor checkpoint recording merged PRs, commit IDs, modules, public entry points, exact test results, fixture coverage, state-transaction evidence, package/install evidence, spike outcomes, known gaps, and the next permitted Stage 2 work item.

The spikes prove feasibility. They must not introduce production child workflows into Stage 1.

## 7. Cross-cutting implementation rules

- Use one immutable typed board snapshot across validation, rendering, transitions, scheduling, and state transactions.
- Keep Pi registration thin; deterministic modules must run in tests without Pi.
- Inject clocks, randomness, filesystem/process operations, Git, and GitHub where deterministic testing requires it.
- Use cryptographically secure randomness in production.
- Support both 40- and 64-character Git object IDs.
- Never persist package, checkout, worktree, snapshot, temporary, or other machine-local absolute paths.
- Use direct executable/argv invocation only.
- Never blanket-stage files.
- Treat `origin/main` and validated GitHub markers as authority; local branches and cached metadata are not merge proof.
- Do not select candidates by recency when identity is ambiguous.
- A closed-unmerged state PR blocks mutation until explicit adopt, abandon, or manual repair.
- A reconciliation-only durable mutation consumes the pump and selects no card.
- Blocker clearing is its own transaction and performs no additional workflow transition.
- `board.yaml.state.last_state_transaction` contains pre-commit facts only.
- `docs/cards/BOARD.md` is canonical derived output with no independent state.
- Preserve worktree and reference-package boundaries.

## 8. Test organization

Use:

- `test/unit/` for schemas, semantic validation, IDs, paths, transitions, scheduling, rendering, lock-record logic, and marker parsing;
- `test/fixtures/boards/` for complete valid/malformed board snapshots and canonical outputs;
- `test/fixtures/projects/` for package, Git, worktree, and filesystem-security cases;
- `test/integration/` for repository round trips, real local Git transactions, lock contention, interruption/retry, extension loading, package installation, and diagnostic non-mutation.

Tests must prove behavior rather than merely restating fixtures.

## 9. Per-PR validation

Before opening each PR:

1. run focused tests for the changed behavior;
2. run the full typecheck;
3. run the complete test suite when shared schemas or core behavior changed;
4. run `git diff --check`;
5. run package checks when manifest or package contents changed;
6. stage exact paths and inspect the staged diff;
7. state what remains unproved, especially live GitHub, minimum-version, or cross-platform behavior.

Do not mark a gate complete based only on mocks.

## 10. Stage 1 completion gate

Stage 1 is complete only when all of the following are true:

- the package loads locally without Pi diagnostics;
- local, symlinked, pinned-Git, and npm-packed asset resolution works;
- packed contents include required runtime assets and exclude `reference/` and `test/`;
- malformed and unknown board data fails closed;
- valid boards round-trip without semantic drift;
- canonical card and `BOARD.md` rendering is byte-stable;
- every legal transition and key illegal guard is tested;
- scheduler, dependency, WIP, blocker, rework, grandfathering, and replacement rules pass;
- lock contention, stale/corrupt state, ownership loss, heartbeat/release races, and shutdown release pass;
- marker discovery and documented state-transaction crash windows are idempotent;
- an LLM-free fixture transition creates or uniquely reuses one human-only state PR through fake GitHub;
- diagnostics validate and report drift without mutation;
- typecheck, tests, build/package checks, and `git diff --check` pass;
- live-`gh`, platform, and minimum-version gaps are explicitly recorded;
- both mandatory spikes have recorded outcomes before Stage 2 begins.

## 11. Stop conditions

Stop and request direction instead of weakening the design when any of these occurs:

- a detailed specification contradiction;
- a Pi API incompatibility with `>=0.85.0 <0.86.0`;
- a required durable field cannot be known before its state commit;
- a documented crash window cannot be made idempotent;
- Git/GitHub authority or marker identity is unavailable or ambiguous;
- a proposal would persist machine-local paths;
- path ownership would need to be broadened;
- a configured command would require shell interpolation;
- implementation would require changing `reference/`;
- persisted trust cannot be distinguished from temporary approval;
- either mandatory spike fails.

When escalation is required, summarize completed work, present three alternatives, recommend one, and wait for direction.

## 12. First action for the next agent

Start Work unit 1 from fresh protected `main`:

1. create a focused feature branch;
2. inspect `package.json`, `tsconfig.json`, `.npmignore`, and the installed Pi package/extension documentation;
3. choose and record the minimal dependency/tooling set;
4. implement the thin extension preflight and shared package-root resolver;
5. add local, symlinked, pinned-Git, and packed-install tests;
6. run typecheck, tests, `git diff --check`, and package-content validation;
7. open a focused PR without adding workflow skills or deterministic board behavior prematurely.
