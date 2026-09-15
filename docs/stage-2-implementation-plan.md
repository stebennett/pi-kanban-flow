# Stage 2 implementation plan

**Status:** Ready for implementation after the Stage 1 completion baseline and Stage 2 prerequisite gate are confirmed on `main`
**Prepared from:** `docs/migration-plan.md`, `docs/stage-0-specifications.md`, and the completed Stage 1 plan/checkpoint
**Authoritative `main` at implementation start:** `8ade90b`
**Completed Stage 1 baseline:** merged on protected `main` through PR #22
**Stage objective:** Child runner and structured output

## 1. Purpose

This document is the execution plan for Stage 2. It is written so a new agent can implement the child-process, resource-policy, agent-discovery, model-selection, structured-result, and attestation layers without reconstructing their sequencing or weakening the deterministic Stage 1 core.

This plan is an implementation aid, not a replacement for the detailed `docs/spec-*.md` documents. Detailed specifications are authoritative. Stop and resolve contradictions in the specifications before coding around them.

## 2. Required reading before editing

Read these files completely and in this order:

1. `AGENTS.md`
2. `docs/migration-plan.md`
3. `docs/stage-0-specifications.md`
4. `docs/spec-development-process.md`
5. `docs/spec-child-agent-runner.md`
6. `docs/spec-structured-results.md`
7. `docs/spec-project-overrides-config.md`
8. `docs/spec-board-schema.md`, especially artifact paths, attestations, config, model selectors, and project commands
9. `docs/spec-state-machine.md`, only to preserve the engine/agent authority boundary
10. `docs/spec-readiness-review.md`
11. `docs/stage-0-review-matrix.md`
12. the completed Stage 1 implementation plan and completion checkpoint
13. this plan

Before implementing Pi extension, process, custom-tool, JSON-event, resource-loading, model, or trust behavior, read the installed Pi documentation and examples identified by `AGENTS.md`. At minimum verify the currently installed versions of:

- `docs/extensions.md` and the structured-output example;
- `docs/json.md`;
- `docs/security.md`;
- `docs/usage.md` for non-interactive and resource flags;
- `docs/skills.md` for explicit skill loading; and
- `examples/extensions/subagent/` as a behavioral starting point, not production code to copy blindly.

Read `docs/spec-legacy-behavior-mapping.md` before consulting `reference/kanban-flow/`. Never edit, format, rename, or generate files under `reference/`.

## 3. Baseline and prerequisites

### 3.1 Repository baseline

At preparation time, `origin/main` is `deefeb0`. It contains the deterministic Stage 1 package, board/config schemas, repository, renderer, state machine, scheduler, lock, state-PR primitives, transaction coordinator, and read-only diagnostics through merged PR #15.

The reviewed Stage 1 completion tip is `270ed5c`. Relative to current `main`, it also contains:

- `extensions/kanban-flow/board/result-schemas.ts`;
- result-schema tests;
- real-Git transaction integration coverage;
- extension-registration coverage;
- state transaction Git hardening; and
- `docs/checkpoint-stage-1-complete.md` with Stage 1 validation and partial spike evidence.

Do not begin Stage 2 production work from a baseline that omits completed Stage 1 changes. Before the first Stage 2 implementation branch:

1. fetch `origin`;
2. confirm all accepted Stage 1 PRs are merged into protected `main`;
3. rebase the Stage 2 branch on fresh `origin/main`;
4. run the complete Stage 1 gate; and
5. update this document's baseline if file names or public APIs changed during merge.

Do not merge or cherry-pick the completion stack implicitly as part of unrelated Stage 2 work.

### 3.2 Stage 2 prerequisite gate

The Stage 1 checkpoint records a successful minimal producer/checker result-tool spike, but it does not close the complete gate in `docs/spec-development-process.md`. The following remain prerequisites, not optional end-of-stage tests:

- every required structured-result rejection case;
- persisted-trust detection that excludes temporary approval and `defaultProjectTrust: always`;
- exact strict/broad resource loading and absence tests;
- archive and path-jail escape tests;
- broad write/diff and named-command policy tests;
- descendant process-group cleanup on supported macOS and Linux; and
- proof that normalized durable attestations contain no absolute machine paths or secrets.

Complete Work unit 0 before production agent workflow code. If either spike fails, revise the relevant specification and readiness record before continuing.

### 3.3 Specification clarification required before exposing checker tools

`docs/spec-structured-results.md` says common payloads use `card_id: none` for requirements-level work, but its checker schema example currently requires `CARD-*` even when `phase: requirements`. Resolve this in the specification before implementing the public checker tool. The recommended resolution is:

- requirements checker dispatches require `card_id: none`;
- design and ship checker dispatches require the exact dispatched `CARD-*` ID; and
- engine cross-field validation enforces the phase/card relationship.

Also audit the completed Stage 1 result-schema primitives against the complete detailed specification before exposing them as provider-facing tools. In particular, preserve the specification that a completed requirements producer may return typed changes without an artifact, include Pi's supported `max` thinking level where inherited, and avoid provider-hostile public unions.

The baseline audit must also resolve these existing specification-conformance mismatches before Stage 2 builds on the affected types:

- `spec-one-way-migration.md` defines exact migration fields `source_harness`, `source_version`, `source_commit`, and `migrated_at`, while the current Stage 1 `MigrationSchema` uses `source`, `source_version`, `migrated_at`, and `operation_id`;
- the current `MODEL_SELECTOR` rejects `/` or `:` inside model IDs, while the approved contract allows non-whitespace Pi provider/model identifiers and requires semantic parsing of only a recognized final thinking suffix; and
- `spec-legacy-behavior-mapping.md` says a closed design PR can return to `backlog`, while the authoritative legal transition is `design_review → designing` in `spec-state-machine.md`.

Treat these as focused Stage 1/specification-conformance follow-ups, not permission to implement Stage 5 migration or Stage 4 workflow behavior in Stage 2.

## 4. Binding Stage 2 boundaries

Stage 2 builds a typed adapter between Pi children and the deterministic engine. It does not hand engine authority to a model.

The parent engine owns:

- saved-trust verification;
- agent and override discovery;
- role and resource-policy selection;
- model resolution;
- dispatch identity and limits;
- snapshot/worktree identity;
- process lifecycle and cleanup;
- deterministic parent probes;
- JSON-event extraction and result validation;
- attestation and artifact destinations;
- worktree diff validation; and
- every board transition or state mutation.

Children may produce artifacts and bounded judgments only. They never mutate board state, choose durable paths, perform Git/GitHub operations, attest their own runtime, or authorize transitions.

Do not implement during Stage 2:

- `/skill:kanban-init`, `/skill:requirements`, or requirements approval/state-PR orchestration;
- design, implementation, review, ship, or pump workflows;
- product/design branch and PR lifecycle orchestration beyond reusable parent-owned primitives already in Stage 1;
- automatic state PR merge;
- arbitrary child shell access;
- arbitrary project extensions, prompts, context, or skills;
- partial review-lens reruns;
- migration, looping, ADR persistence, telemetry, quarantine, or nightly probes;
- Windows support; or
- any direct write under `reference/`.

Stage 2 may port one producer and one read-only checker as end-to-end runner fixtures. They must stop before workflow approval or board mutation.

## 5. Architectural dependency direction

Keep dependencies moving in this direction:

```text
thin Pi parent adapter
        |
        +--> saved-trust adapter
        +--> parent model/auth adapter
        +--> canonical repository/package paths
        |
agent discovery --> validated agent definition + source/hash
        |
model resolution + role policy assembly
        |
        +--> strict snapshot materializer --> jailed read tools
        +--> broad trusted path policy --> jailed read/write/edit/named-command tools
        +--> one role-result tool
        |
dispatch plan --> streaming child process --> LF JSON event validator
                                      |
                                      +--> exactly one validated typed result
                                      +--> authoritative model/usage/stop metadata
                                      +--> cleanup outcome
                                                    |
                                     normalized parent attestation
                                                    |
                         deterministic artifact renderer/writer
                                                    |
                           existing engine consumes typed evidence later
```

Agent discovery, model selection, policy assembly, path authorization, result validation, attestation normalization, and event-state evaluation should be pure or adapter-injected where practical. The streaming process layer must not import board transition or state-PR orchestration.

A reasonable module layout is:

```text
extensions/kanban-flow/agents/
├── definitions.ts              # fixed names, roles, parser, normalized hash
├── discover.ts                 # package/project precedence and reporting
├── trust.ts                    # persisted-trust adapter
├── models.ts                   # inheritance and explicit override resolution
├── policy.ts                   # strict/broad policy assembly and dispatch limits
├── prompts.ts                  # bounded system/task envelope assembly
├── snapshots.ts                # exact-commit archive and secure extraction
├── path-policy.ts              # shared canonical path authorization
├── role-extensions/            # five package-owned role entry points
│   ├── producer.ts
│   ├── checker.ts
│   ├── reviewer.ts
│   ├── split-decision.ts
│   └── probe.ts
├── result-tools.ts             # shared role-specific terminating tool definitions
├── repository-tools.ts         # jailed read/grep/find/ls/write/edit tools
├── project-command.ts          # engine-selected named command execution
├── json-stream.ts              # byte-bounded LF-delimited event parser
├── process-group.ts            # spawn, abort, timeout, descendant cleanup
├── attestation.ts              # parent-owned normalized attestation
├── artifacts.ts                # deterministic result artifact rendering
└── runner.ts                   # single and bounded-parallel coordination
```

This layout is guidance. Prefer narrower modules if responsibilities remain explicit, and reuse Stage 1 IDs, paths, schemas, package resolution, canonical YAML, and direct-process conventions rather than creating parallel primitives.

## 6. Delivery plan

Implement each coherent unit from fresh protected `main` on a focused feature branch. Tests land with behavior. Do not push directly to `main`.

### Work unit 0 — Close the mandatory spike gate and resolve specification deltas

#### Spike work

- Build a disposable, non-production spike harness around the installed supported Pi version.
- Complete the role-result spike matrix from `docs/spec-development-process.md`:
  - valid producer and checker calls;
  - prose-only completion;
  - missing, duplicate, invalid, wrong-role, and sibling result calls;
  - a result call with a nonterminating sibling tool;
  - later conflicting output;
  - malformed JSON, oversized line/event/stdout/stderr/artifact output;
  - missing final events, nonzero exit, and unacceptable stop reason;
  - authoritative provider/model/thinking/usage extraction; and
  - no child board mutation.
- Complete the trust/resource-policy spike matrix:
  - canonical current-directory and ancestor saved `yes` decisions;
  - saved `no`, no decision, temporary `--approve`, and global `always` do not qualify as persisted trust;
  - non-interactive child reuse of an applicable saved decision without `--approve`;
  - all four resource-disable flags plus explicit extension/tool/skill loading;
  - strict snapshot/archive/path-jail failures;
  - broad protected-path, unplanned-path, wrong-action, and worktree-escape failures;
  - named project commands with engine-selected executable/argv only;
  - absence of unrelated global/project resources; and
  - package assets from checkout, symlink, pinned Git, and npm-packed installs.
- Prove SIGTERM, five-second grace, SIGKILL escalation, descendant cleanup, and no post-close signalling on current/minimum supported macOS and Linux environments.
- Record sanitized commands, versions, event samples, platform evidence, and conclusions in a Stage 2 spike checkpoint.

#### Specification work

- Resolve the requirements-checker `card_id` contradiction.
- Define the producer requirement/card temporary-key pattern explicitly; the recommended resolution is to reuse `[a-z][a-z0-9-]{0,31}` consistently for all sibling references.
- Correct the Stage 1 migration-record schema and model-selector parser to the exact already-approved specifications without implementing later workflows.
- Correct the stale closed-design-PR row in the legacy mapping to agree with the authoritative `design_review → designing` transition.
- Record the supported persisted-trust adapter/API and its compatibility boundary.
- If authoritative Pi event fields or successful stop semantics differ, update the versioned result specification rather than adding permissive parsing.
- If resource isolation or process-group cleanup cannot be proved, stop; do not weaken the role policy silently.

#### Exit

Both mandatory spikes pass and the readiness record explicitly permits production Stage 2 runner work.

### Work unit 1 — Complete structured-result contracts and result-tool extension

#### Modules

- completed `extensions/kanban-flow/board/result-schemas.ts` from Stage 1;
- `extensions/kanban-flow/agents/result-tools.ts`;
- five thin package-owned entry points under `extensions/kanban-flow/agents/role-extensions/`.

#### Implementation

- Audit every public producer, checker, reviewer, split-decision, and probe schema against `docs/spec-structured-results.md`.
- Keep every object strict with unknown fields rejected at every nesting level.
- Use provider-compatible `StringEnum`/string constraints for public enums and sentinels.
- Implement complete engine cross-field validation, including:
  - expected dispatch, card, role, phase, lens, probe, and criterion identities;
  - phase-permitted artifact types;
  - producer status/artifact/question/change/path relationships;
  - requirement/card temporary-key and reference relationships;
  - complete checker criterion order, derived status, and per-failure blocking finding;
  - reviewer status/finding/evidence relationships;
  - split replacement counts, sibling references, coverage input, and needs-human evidence;
  - probe required-observation semantics; and
  - duplicate normalized path/key rejection.
- Register five separate terminating result tools through five thin role extension entry points. Each child loads one entry point, and a dispatch exposes exactly one expected result tool rather than registering sibling result tools and relying only on hiding them.
- Implement `submit_probe_result` for schema completeness, but do not invent a model-probe agent: schema-version-1 objective project/Git/GitHub probes remain parent-owned and have no discoverable agent definition.
- Treat `terminate: true` only as a transport hint; do not encode successful completion in tool execution alone.
- Return the validated payload to the parent channel without allowing a child-selected artifact or board path.

#### Tests

- One positive boundary fixture and focused negative cases for every role.
- Unknown-field rejection at every nested level.
- Provider-facing schema serialization tests that reject unsupported unions/discriminators.
- Requirements-level `none` and card-level identity tests.
- Wrong-role and sibling-result-tool exposure tests.
- Result payload maximum sizes and Unicode/NUL/unpaired-surrogate boundaries.

#### Exit

All five result tools can expose provider-compatible schemas and return a typed payload, while full run success remains impossible to claim without the runner's final-event checks.

### Work unit 2 — Persisted trust and deterministic agent discovery

#### Modules

- `extensions/kanban-flow/agents/trust.ts`;
- `extensions/kanban-flow/agents/definitions.ts`;
- `extensions/kanban-flow/agents/discover.ts`.

#### Implementation

- Implement the persisted-trust adapter proven in Work unit 0.
- Canonicalize the repository root and dispatch cwd before trust or discovery.
- Distinguish a saved applicable `yes` from temporary approval, global defaults, absence, and saved denial.
- Define the fixed schema-version-1 workflow-agent catalog in one place.
- Parse packaged and considered project definitions with exact frontmatter/body rules.
- Search `.pi/agents/*.md` from dispatch cwd upward only to the canonical Git root.
- Consider only exact known filenames; ignore unrelated agent files.
- Resolve real paths, permit only in-repository symlinks to regular files, reject escapes/cycles/special files, and normalize LF before SHA-256.
- Apply nearest in-repository same-name precedence and reject duplicate same-precedence definitions.
- Validate every considered override before lock-protected mutation or external action.
- Return deterministic active/ignored override reports with package- or repository-relative paths and hashes; never durable absolute paths.
- When overrides are disabled or trust is absent, do not activate project definitions; report matching ignored files diagnostically where permitted.

#### Tests

- Package-only, nearest override, nested cwd, and ancestor-precedence cases.
- Exact frontmatter, name/filename, UTF-8, line-ending, body-size, and unknown-field failures.
- Same-level duplicate, symlink cycle/escape, special file, and Git-root boundary cases.
- Repositories whose only customization is `.pi/agents`.
- Saved yes/no/absent/ancestor decisions, temporary approval, and global-default cases.
- Stable LF-normalized hashes and deterministic reporting order.

#### Exit

A dispatch can resolve one auditable agent definition or fail before mutation, and no project override can activate without proven persisted trust.

### Work unit 3 — Strict immutable snapshots and jailed read tools

#### Modules

- `extensions/kanban-flow/agents/snapshots.ts`;
- `extensions/kanban-flow/agents/path-policy.ts`;
- read-only portions of `extensions/kanban-flow/agents/repository-tools.ts`.

#### Implementation

- Materialize the exact explicit Git commit with direct-argv `git archive` into a parent-owned temporary root.
- Select and document the minimal archive implementation/dependency; never pipe through an interpolated shell.
- Reject archive absolute paths, `..`, duplicate normalized paths, special files, and escaping links before exposure.
- Set extracted files to `0444` and directories to `0555`; retain symlinks only when fully resolved inside the snapshot.
- Register package-owned `kanban_read`, `kanban_grep`, `kanban_find`, and `kanban_ls` with canonical path checks on every call.
- Bound file count, match count, per-file bytes, and aggregate tool output so the read tools cannot bypass runner limits.
- Ensure strict tools expose no shell, write, edit, Git, GitHub, credentials, checkout, or parent filesystem path.
- Make the parent temporarily writable only for verified cleanup after child exit.

#### Tests

- Real Git archive of a disposable exact commit.
- Absolute/traversal/duplicate-normalized/special-file/link escape fixtures.
- Post-extraction symlink swap and canonicalization tests.
- Read/grep/find/ls happy paths, deterministic ordering, binary/large-file limits, and output truncation semantics.
- Mode checks and cleanup failure injection.
- Proof that a mutable checkout change after archive creation is invisible to the strict child.

#### Exit

A strict child can inspect only a bounded immutable commit snapshot through the four package tools.

### Work unit 4 — Broad trusted tools, path policy, and deterministic project commands

#### Modules

- broad portions of `extensions/kanban-flow/agents/repository-tools.ts`;
- `extensions/kanban-flow/agents/project-command.ts`;
- shared policy data in `extensions/kanban-flow/agents/path-policy.ts`.

#### Implementation

- Define role-specific broad policies:
  - requirements/design producers receive jailed repository reads and return proposed content;
  - implementers receive jailed read/grep/find/ls/write/edit rooted at the exact product worktree;
  - no broad child receives unrestricted shell;
  - Git, GitHub, branch, commit, and PR actions remain parent-owned.
- Require persisted trust before any broad policy is assembled.
- Reject `.git`, board-owned, design-owned, unplanned, wrong-action, symlink, and worktree-escape access.
- Bind implementation write/edit authorization to the parent-approved normalized planned path/action set.
- Make writes atomic where applicable and validate the exact resulting worktree diff after each producer.
- Implement `kanban_run_project_command` with a package-owned enum of configured command names for the dispatch. Resolve executable/argv from validated parent config; accept no model-provided executable, argv, shell text, cwd, or environment.
- Bound stdout/stderr/time and execute directly in the exact product worktree.
- Keep package/result extensions and approved skills outside product write authority.

#### Tests

- Read-only requirements/design producer policies cannot write.
- Planned create/modify/delete actions and all wrong-action combinations.
- `.git`, board/design ownership, absolute/traversal/symlink, nested-worktree, and unplanned-path denial.
- Named-command selection, unknown names, malicious configured arguments, timeout/abort, and no-shell proof.
- Exact-diff acceptance/rejection, including out-of-policy side effects from an allowed command.
- Cleanup and partial-write failure cases.

#### Exit

Every broad role has a code-assembled least-authority policy, and implementation writes/commands cannot exceed parent-approved paths or argv.

### Work unit 5 — Model resolution, policy assembly, and dispatch planning

#### Modules

- `extensions/kanban-flow/agents/models.ts`;
- `extensions/kanban-flow/agents/policy.ts`;
- `extensions/kanban-flow/agents/prompts.ts`;
- dispatch types in `extensions/kanban-flow/agents/runner.ts` or a dedicated module.

#### Implementation

- Accept parent provider/model/effective thinking through a small injected Pi adapter.
- Replace the overly restrictive Stage 1 model-selector regex with structural control/whitespace bounds plus semantic parsing of a recognized optional final thinking suffix, preserving legal `/` and `:` characters inside provider/model IDs.
- Default to parent inheritance; apply only a matching resolved-agent override.
- Resolve and authenticate explicit overrides before spawn and require custom-tool capability.
- Fail unavailable, ambiguous, unauthenticated, or non-tool-capable overrides with no fallback.
- Record actual model/thinking later from final authoritative events and compare it with the dispatch plan.
- Map the engine-owned role to strict/broad policy, one result tool, allowed package tools, fixed timeout/event/byte/artifact limits, cwd kind, and approved skills.
- Validate every allowlisted skill as an in-repository trusted path; add one separate `--skill` argument per approved skill.
- Define and assemble the exact approved context set: applicable `AGENTS.md`, package protocol/doctrine, the optional project `PROTOCOL-ADDENDUM.md`, explicitly allowlisted skills, agent body, and dispatch inputs. Normalize and bound it before writing a mode-`0600` temporary system prompt; project guidance may inform the producer but cannot override engine policy.
- Keep the user prompt to a bounded task envelope and dispatch ID.
- Construct deterministic direct argv containing `--mode json -p --no-session`, all four resource-disable flags, `--no-builtin-tools`, the one explicit extension, exact `--tools`, model/thinking flags, prompt path, and approved skills. Never pass `--approve`.
- Create a machine-local KFRUN dispatch record with redacted argv and parent-owned inputs/limits without treating it as board state.

#### Tests

- Parent inheritance across every thinking level.
- Per-agent override parsing, auth/tool capability, failure, and no-fallback behavior.
- Role-to-policy/limits/tool/result/cwd mapping for every role.
- Exact argv snapshots, repeated skill arguments, resource-disable flags, and absence of shell interpolation/`--approve`.
- Mode/ownership of temporary prompts and cleanup.
- Prompt/context size limits, deterministic ordering, and secret/path redaction.

#### Exit

A validated agent plus engine-owned role/config can produce one complete, auditable dispatch plan without starting a child.

### Work unit 6 — Streaming child process and successful-completion state machine

#### Modules

- `extensions/kanban-flow/agents/json-stream.ts`;
- `extensions/kanban-flow/agents/process-group.ts`;
- single-dispatch execution in `extensions/kanban-flow/agents/runner.ts`.

#### Implementation

- Spawn Pi directly with no shell as a new process group on macOS/Linux.
- Consume stdout as bytes and split only on LF; enforce the 1 MiB unterminated-line limit before UTF-8/JSON decoding.
- Enforce the fixed role timeout, event count, combined stdout JSON bytes, stderr bytes, and artifact content bytes from the specification.
- Validate the session header and every event; do not silently ignore malformed or unknown required records.
- Treat final `message_end`, `tool_execution_end`, and `agent_end` records as authoritative.
- Track exact result-tool calls and reject missing, duplicate, invalid, wrong-role, sibling-result, nonterminating sibling, and post-result conflict cases.
- Require matching dispatch/card/phase/lens/probe/criteria context, accepted exit code, and versioned stop reason.
- Capture nested usage and actual provider/model/thinking deterministically. Keep usage in machine-local runner/report data unless a versioned durable schema explicitly adds it; the exact attestation shape does not currently include usage.
- Accept an injected parent liveness/abort signal so later pump integration can keep the board-lock heartbeat active and abort the child if lock ownership is lost; Stage 2 must not make the runner own board locking.
- On abort, timeout, malformed/oversized stream, policy failure, or parent cancellation, SIGTERM the process group, wait five seconds, then SIGKILL surviving descendants.
- Retain the live child handle, never signal after close, remove temporary resources, and treat cleanup failure as dispatch failure.
- Return typed success/failure data only; do not transition or mutate the board.

#### Tests

- A deterministic fake child executable for every event sequence and failure window.
- Chunk boundaries inside UTF-8, JSON, CRLF, and LF delimiters.
- Missing header/final events, malformed records, early close, nonzero exit, and stderr overflow.
- Every successful-completion acceptance/rejection rule.
- Limit boundaries for each role.
- Parent abort before spawn, during output, after result call, and during cleanup.
- Descendant/grandchild SIGTERM and SIGKILL behavior plus PID/process-group reuse guards.
- Real Pi opt-in tests pinned to the supported compatibility range.

#### Exit

One child Pi process can return a validated typed result and authoritative runtime evidence, or fail without leaking descendants/resources or claiming success.

### Work unit 7 — Parent attestation and deterministic artifact preparation

#### Modules

- `extensions/kanban-flow/agents/attestation.ts`;
- `extensions/kanban-flow/agents/artifacts.ts`;
- final result/attestation semantics in board schemas;
- typed artifact validation in `extensions/kanban-flow/board/repository.ts`.

#### Implementation

- Build the attestation exclusively from parent-known discovery, policy, process, and final-event data.
- Enforce exact child and parent-probe attestation shapes and cross-field rules.
- Normalize package/snapshot/worktree/temp argv roots to the specified literal tokens.
- Redact credentials and environment-derived secrets without making success depend on child prose.
- Persist package/project agent paths only relative to their logical root.
- Store logical repository, branch, and commit identity; never persist an absolute checkout/worktree/snapshot/temp path.
- Render validated result plus attestation into deterministic bytes and derive the exact card or requirements artifact path from `docs/spec-board-schema.md`.
- Make artifact destination and kind engine-owned and verify payload role/phase against it.
- Return proposed artifact path/bytes to the future state-transaction integration seam. Stage 2 must not write them directly into the authoritative checkout or bypass a state PR.
- Extend board repository reads to parse and validate every existing permitted artifact's typed payload, attestation, kind, and deterministic path instead of validating only its filesystem location.
- Allocate durable finding IDs only in the parent integration seam; never accept child-provided finding IDs.
- Keep Stage 2 integration tests in disposable repositories and stop before state transition/state PR orchestration.

#### Tests

- Golden normalized child and parent-probe artifacts, plus repository rejection of malformed, wrong-role, wrong-path, and unknown-field artifact contents.
- Absolute path and secret canaries across argv, errors, context, evidence, and metadata.
- Agent/model/policy/context/tool/payload mismatch failures.
- Timestamp, exit, stop-reason, snapshot, branch, and commit invariants.
- Deterministic YAML and exact artifact path derivation.
- Failure injection around temporary artifact rendering/validation and proof that no authoritative board write occurs on successful or failed dispatch.

#### Exit

A successful run produces one deterministic, parent-attested typed artifact proposal with no machine-local path or secret leakage; later workflow code remains responsible for placing it through a state transaction.

### Work unit 8 — Bounded parallel strict dispatch

#### Module

- parallel coordination in `extensions/kanban-flow/agents/runner.ts`.

#### Implementation

- Permit parallelism only for independent strict checkers/reviewers.
- Cap active children at validated `review.max_parallel` and the number of configured tasks.
- Keep all producers sequential.
- Propagate parent abort to every active process group and await cleanup.
- Preserve configured agent/lens order in returned results regardless of completion order.
- Keep per-child IDs, policies, limits, streams, failures, usage, and cleanup independent.
- Define fail-fast versus drain-and-report behavior explicitly: stop launching new work after a terminal orchestration failure, abort unsafe active work, and retain every completed/cleanup outcome needed for diagnostics.
- Sum nested usage without changing result ordering or treating usage as transition authority.

#### Tests

- Concurrency cap and queued-start order.
- Out-of-order completion with configured-order results.
- One child failure, timeout, malformed stream, and cleanup failure while peers run.
- Parent abort with queued and active children.
- No producer parallelism and no strict/broad policy mixing.
- Stable aggregate usage and diagnostics.

#### Exit

Independent strict roles run with bounded concurrency and deterministic output while every process remains individually accountable and cleanable.

### Work unit 9 — Producer/checker vertical slice

Use the requirements pair unless the specification clarification in section 3.3 chooses another pair. This prepares Stage 3 while keeping Stage 2 free of requirements approval and board mutation.

#### Packaged assets

- `agents/requirements-producer.md`;
- `agents/requirements-checker.md`;
- only the package doctrine/templates strictly needed by those two agents.

Do not add placeholder prompts for unported agents. Keep the fixed agent-name catalog in code, and fail clearly if a later-stage package agent is dispatched before its asset is implemented.

#### Producer scenario

- Run `requirements-producer` under the broad trusted read-only producer policy.
- Prove the child receives the selected packaged or project agent body, approved normalized project context, and one explicitly allowlisted project skill.
- Prove unrelated extensions, skills, prompts, context files, built-in shell/write/edit tools, and board mutation are absent.
- Validate a typed requirements producer result, parent attestation, override report, inherited model, and one explicit model-override scenario.

#### Checker scenario

- Materialize one exact commit snapshot and run `requirements-checker` under the strict policy.
- Supply the complete ordered requirements criterion set and deterministic parent evidence.
- Prove the checker can use only jailed read/grep/find/ls plus `submit_checker_result`.
- Prove it cannot see a mutable checkout change, project skill, project context, unrelated extension, shell/write/edit tool, credential, or host path.
- Validate complete criteria, evidence, typed findings, authoritative runtime metadata, and attestation.

#### Negative scenarios

- Malformed project override before spawn.
- Missing persisted trust for broad producer.
- Unavailable explicit model override with no fallback.
- Prose-only and duplicate/wrong-role result calls.
- Strict snapshot/path escape.
- Timeout/abort and child cleanup.
- A model-proposed board mutation/path claim.

#### Exit

Trusted project context reaches the producer; the checker remains isolated to its immutable inputs; both return validated typed results and parent attestations; neither mutates board state.

### Work unit 10 — Package, diagnostics, integration gate, and Stage 3 handoff

#### Integration and package work

- Keep the parent extension entry point thin and compatibility-gated.
- Ensure npm-packed, pinned-Git, symlinked, and local installs contain all runner modules, child-extension entries, two agent prompts, and required doctrine/templates.
- Ensure temporary/spike fixtures, tests, logs, snapshots, prompts, dispatch records, and `reference/` do not ship.
- Extend read-only diagnostics only after defining a stable output contract. At minimum report:
  - persisted-trust readiness without treating temporary trust as saved;
  - packaged agent availability;
  - active/ignored project override sources and hashes;
  - inherited/default model tool capability;
  - explicit override resolution failures; and
  - required executable/platform support.
- Diagnostics must not spawn a model unless an explicit opt-in probe is specified, acquire the board lock, write files, or mutate Git/GitHub.

#### End-to-end validation

- Run the complete Stage 1 regression gate.
- Run all Stage 2 unit/integration tests.
- Run real Pi producer/checker acceptance with sanitized event evidence.
- Run process-group cleanup on supported macOS and Linux, including declared minimum/current versions where CI permits.
- Run local, symlinked, pinned-Git, and npm-packed vertical slices.
- Verify before/after that failed and successful Stage 2 runs do not mutate board files, refs, worktrees, locks, or GitHub state.
- Run `npm run typecheck`, `npm test`, `npm run package`, `npm run package:check`, and `git diff --check`.

#### Completion handoff

Add a Stage 2 completion checkpoint recording:

- merged PRs and important commit IDs;
- implemented modules and public entry points;
- exact test commands/results and platform matrix;
- complete spike evidence and any specification revisions;
- packaged agent/policy/model/override scenarios exercised;
- process cleanup and package-install evidence;
- active known gaps and deferred agents;
- proof that no board transition was model-owned; and
- the first permitted Stage 3 requirements work item.

#### Exit

The Stage 2 migration-plan exit condition and every gate in section 10 are satisfied from installed-package as well as checkout execution.

## 7. Cross-cutting implementation rules

- Reuse Stage 1 IDs, normalized paths, canonical serialization, package-root resolution, and direct-argv conventions.
- Do not use the Stage 1 buffered `ProcessRunner` as proof for streaming child safety; share validation conventions but implement an injected streaming/process-group boundary.
- Use direct executable/argv invocation only. Never interpolate configured values through a shell.
- Disable unrelated child resources explicitly; trust is not a sandbox.
- Never pass `--approve` or treat `ctx.isProjectTrusted()` alone as persisted trust.
- Treat child cwd, snapshot, package, prompt, dispatch-log, and worktree paths as machine-local.
- Store only logical repository/branch/commit identity and normalized path tokens durably.
- Resolve all considered overrides, models, skills, paths, and policies before mutation or external action.
- Use the engine-owned role—not agent frontmatter—to select tools, policy, limits, result tool, and cwd.
- Project agents may replace prompt behavior only; they cannot select model, role, tools, policy, result tool, cwd, limits, or resources.
- A child payload is evidence, not permission to transition.
- Parent probes are deterministic evidence and are never misrepresented as child output.
- Fail closed on malformed streams, missing authority, ambiguous model/agent identity, policy drift, unauthorized diff, cleanup failure, or unavailable credentials.
- Preserve fixed configured ordering in schemas, criteria, tools, agents, lenses, results, reports, and artifacts.
- Keep package and project path ownership separate from board/design/product path authority.
- Keep `reference/` read-only and do not import Claude-specific execution mechanics.

## 8. Test organization

Use:

- `test/unit/` for result schemas, cross-field validators, definition parsing, trust decisions, model selection, policy assembly, argv construction, path authorization, event-state evaluation, attestation normalization, artifact rendering, and parallel ordering;
- `test/fixtures/agents/` for valid/malformed package and project definitions;
- `test/fixtures/json-events/` for accepted and rejected Pi streams;
- `test/fixtures/archives/` for traversal/link/special-file cases, if fixtures can be stored safely without extraction side effects;
- `test/fixtures/projects/` for trust, override precedence, skills, worktrees, and package-install scenarios;
- `test/helpers/` for deterministic fake Pi children and process trees; and
- `test/integration/` for exact-commit snapshots, child tools, real process groups, installed-package execution, and opt-in real Pi/provider tests.

Generated spike evidence, temporary prompts, snapshots, logs, and dispatch records must remain outside tracked source unless a deliberately sanitized small fixture is needed.

Tests must prove policy behavior, not merely assert an argv snapshot. Include canary resources and paths that would be visible if a disable flag, jail, trust check, or cleanup step failed.

## 9. Per-PR validation

Before opening each PR:

1. run focused tests for the changed behavior;
2. run full typecheck;
3. run the complete test suite when shared schemas, path policy, process handling, or package contents changed;
4. run real-process integration tests for process/path-policy changes;
5. run `git diff --check`;
6. run package checks when agents, templates, child extensions, dependencies, or package contents changed;
7. stage exact paths and inspect the staged diff; and
8. state what remains unproved, especially provider, authentication, minimum-version, Linux, or descendant-cleanup behavior.

Mocks and child-reported success are evidence, not gate authority.

## 10. Stage 2 completion gate

Stage 2 is complete only when all of the following are true:

- completed Stage 1 changes and checkpoint are present on protected `main`;
- both mandatory spikes are fully passed and recorded;
- the requirements-checker `card_id` and temporary-key ambiguities, Stage 1 migration/model-selector/legacy-row mismatches, and any discovered Pi event/API deltas are resolved against versioned specifications;
- all five public result tools have provider-compatible strict schemas and complete cross-field validation;
- exactly one expected result call plus authoritative final events is required for success;
- prose-only, missing, duplicate, invalid, wrong-role, sibling-tool, conflicting-output, unacceptable-stop, malformed-stream, and every size-limit case fails;
- persisted saved trust is distinguished from temporary/global trust and is required for overrides/broad policy;
- packaged/project agent precedence, validation, source/hash attestation, ignored override reporting, and path containment pass;
- parent model/thinking inheritance works;
- one explicit authenticated override works, and a broken override fails without fallback;
- strict children see only an immutable exact-commit snapshot through jailed read tools;
- broad policies receive only approved context/skills/tools and never unrestricted shell;
- implementation write/edit and named-command policies reject every prohibited path/action/argv/diff case;
- child timeouts, aborts, malformed streams, and cleanup failures cannot produce success;
- process-group cleanup kills descendants on supported macOS and Linux;
- bounded strict parallelism honors `review.max_parallel` and returns configured order;
- parent attestations use authoritative runtime data, deterministic artifact paths, normalized logical identity, and no absolute machine paths/secrets;
- one producer receives trusted project context and one checker remains isolated;
- both vertical agents return validated typed results from checkout and installed-package scenarios;
- no vertical scenario mutates board state, Git refs/worktrees, or GitHub;
- Stage 1 regressions, Stage 2 tests, typecheck, package checks, and `git diff --check` pass; and
- a Stage 2 completion checkpoint gives Stage 3 an exact starting point.

## 11. Stop conditions

Stop and request direction instead of weakening the design when any of these occurs:

- a detailed specification contradiction;
- the completed Stage 1 baseline is not merged or its public APIs differ materially;
- persisted saved trust cannot be distinguished through the proven supported adapter;
- Pi's resource flags leak an unapproved resource;
- a provider cannot support the public result schema or authoritative final-event contract;
- a successful child stop reason cannot be identified unambiguously;
- child process descendants cannot be cleaned up reliably on a supported platform;
- strict snapshot or broad worktree jailing can be bypassed;
- implementation would require arbitrary child shell access;
- an explicit model override would require silent fallback;
- an attestation would persist a machine-local absolute path or secret;
- a child would need board, Git, GitHub, branch, commit, PR, or transition authority;
- package installation cannot resolve the child extension/agent assets; or
- implementation would modify `reference/`.

When escalation is required, summarize completed work, present three alternatives, recommend one, and wait for direction.

## 12. First action for the next agent

Start with the prerequisite gate, not the production runner:

1. fetch and verify that the completed Stage 1 stack is merged into fresh protected `main`;
2. run the complete Stage 1 gate and record the exact baseline;
3. create a focused spike/specification branch;
4. resolve the requirements-checker `card_id` and temporary-key ambiguities plus the Stage 1 migration/model-selector/legacy-row mismatches;
5. implement disposable spike harnesses for saved trust, resource loading, structured-result rejection, and process-group cleanup;
6. run the spike matrix on the current supported Pi/macOS environment and establish the Linux/minimum-version job;
7. record sanitized evidence and update readiness/specifications if required; and
8. only after the gate passes, begin Work unit 1 on the production result-tool extension.
