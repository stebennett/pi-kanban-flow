# One-card lifecycle specification

**Status:** Authoritative Stage 4 operational contract for schema version 1

**Scope:** one dependency-ready card, one design PR, one pre-code split decision, one product PR, bounded design/implementation rework, and reconciliation to `done`.

This document closes the operational details intentionally left open by the Stage 0 specifications. It does not replace the board schema, state-machine, lock, state-PR, child-runner, structured-result, project-override, readiness, requirements, or legacy-mapping specifications. Those documents remain authoritative for their shared primitives. When this document gives a more specific ordering or lifecycle rule for Stage 4, this document controls.

The implementation in Stage 4 must implement this contract in TypeScript. Prompts, skills, child agents, local branches, open PRs, and model prose are never sources of workflow authority.

## 1. Authority and non-negotiable boundaries

1. `origin/main` after a fresh fetch is the only authoritative board snapshot. An open PR, a local branch, a worktree, a child session, or a proposed state transaction is pending evidence.
2. The parent engine owns repository identity, configuration, saved-trust verification, locks, fetching, marker discovery, scheduling, IDs, paths, Git, GitHub, commands, worktrees, commits, PRs, transitions, artifacts, blockers, and reports.
3. A child may return only its role-specific structured result or, for the implementation producer, edit through the parent-created path-jailed tools and invoke a configured command by name. A child may not select a card, allocate an ID, choose a durable path, run arbitrary shell, use Git/GitHub, create a branch/commit/PR, or choose a transition.
4. A pump selects at most one card and proposes at most one state PR. A reconciliation-only pump selects no card. A pump stops at the first durable boundary and never continues after opening a state PR, opening a product/design PR without a safely recordable state effect, recording a blocker, waiting for external authority, or producing a no-action result.
5. Design, product, and state paths remain disjoint. Design PRs contain exactly one design document; product PRs contain only approved product paths; state PRs contain only state-owned paths. No blanket staging is permitted.
6. No operation merges, approves, dismisses, resolves, or automatically addresses a GitHub review. No operation pushes directly to `main`.
7. A technical failure never becomes success by inference. Durable success requires parent validation of the complete candidate and a merged state PR.

## 2. Versioned inputs, identity, and constants

### 2.1 Pump request

The deterministic pump tool accepts this strict object:

```yaml
schema_version: 1
requested_phase: none                 # none | design | split_decision | implement | review | ship
```

`requested_phase` is an optional diagnostic/manual request. It is not a card selector. `/skill:kanban` sends `none`; `/skill:design`, `/skill:implement`, `/skill:review`, and `/skill:ship` send the corresponding request. Unknown fields, a requested card ID, a path, a command, a model, an approval, or a transition are rejected. The coordinator still runs the complete preflight, reconciliation, scheduler, and legal-next-action checks.

A requested phase is satisfied only when the normal scheduler's one selected card has that exact legal action. If the normal winner has another action, the result is `phase_not_eligible` with no alternate-card selection and no mutation. A phase request never bypasses dependencies, WIP, blockers, pending state PRs, or the card's legal next action.

### 2.2 Operation and run identity

- Generate one cryptographically random `KFOP-*` operation ID before lock acquisition. It identifies the complete pump attempt and is reused in all parent actions in that pump.
- Generate one `KFRUN-*` dispatch ID for each child/result attempt. A producer, checker, split decision, reviewer lens, and ship checker never share a run ID.
- Generate one `KFTX-*` transaction ID only when a final board mutation is ready to be rendered. A pump never allocates a second transaction ID after a failed or rejected candidate.
- Generate `FINDING-*` and `KFH-*` IDs only in the accepted candidate allocation pass. A rejected candidate, cancelled operation, stale base, failed external action, or unmerged PR consumes no durable ID.
- An external design/product marker may contain the current pump's operation ID, but retry discovery is by the complete deterministic identity (class, card, branch, repository, base, marker, trailer, and exact diff), not by assuming the prior operation ID.
- A state marker and commit use the operation and transaction IDs that are known before the state commit. A transaction descriptor never stores an unknown state commit, PR, or merge value.

### 2.3 Fixed package constants

The following values are package constants for schema version 1:

- status order: `backlog`, `designing`, `design_review`, `ready_for_implementation`, `implementing`, `implementation_review`, `ready_to_ship`, `shipping`, `done`, `replaced`;
- project-command order: `test`, `lint`, `typecheck`, `build`;
- design criterion order and ship criterion order: exactly the ordered sets in `spec-structured-results.md`;
- reviewer order: exactly `config.review.lenses`, with no sorting or provider-dependent order;
- project command timeout: five minutes per configured command;
- command stdout and stderr capture limit: 1 MiB per stream before the process group is terminated;
- durable probe detail: at most 16 KiB per stream (first 8 KiB plus last 8 KiB when truncation is necessary); and
- all role, event, artifact, path, and string limits in `spec-child-agent-runner.md` and `spec-structured-results.md`.

## 3. Pump preflight and ordering

The coordinator performs these steps in this order. A failed step stops the operation; no later step is attempted.

1. Validate the request object and the installed Pi/Node compatibility range.
2. Resolve the canonical Git repository root and common Git directory. Derive and independently validate the GitHub `owner/name` identity from `origin` and `gh repo view`; it must agree with the board identity once the board is read. Resolve `origin/main` only after lock acquisition as described below.
3. Generate `KFOP-*` and acquire the common lock with command `kanban`. Lock contention returns the owner summary without mutation. A corrupt, foreign, or unverifiable stale lock fails closed.
4. Immediately heartbeat under ownership. Start the heartbeat schedule and abort signal. The lock is held through all children, immutable archive creation, commands, UI, Git, GitHub queries/mutations, state-PR creation, report construction, and cleanup.
5. Validate the current checkout's owned-path safety and read the minimum board identity needed to validate the lock. This read is only preflight evidence; it is not authoritative. A missing/partial/ambiguous board, identity mismatch, dirty unsafe owned path, symlink escape, special file, or unsupported schema fails before external workflow work.
6. Validate the saved project-trust decision, all considered agent overrides, models/authentication, project config, resource policies, command arrays, review lenses, and package assets. Temporary approval and `defaultProjectTrust: always` never satisfy saved trust. No child is spawned until every required policy is valid.
7. Verify lock ownership immediately before fetching. Invoke `git fetch --prune origin` directly, resolve a fresh `origin/main` object ID, and build an immutable authoritative repository snapshot from it. The snapshot includes board/config/spec/cards/dashboard and the repository tree needed by the selected phase.
8. Query all managed GitHub PRs and action markers through the parent adapter. Validate repository, URL, number, base, head, marker count, marker JSON, branch naming, card IDs, operation/transaction identity, PR state, commit IDs, and duplicate/conflicting candidates. GitHub unavailability is a transient failure; no new external action or state mutation is allowed.
9. Reconcile state PR authority first, then design/product facts, then read the authoritative board snapshot again if reconciliation proved a merged state PR. A pending open state PR or an unresolved closed-unmerged state PR prevents selection. A durable reconciliation effect consumes the pump and is proposed alone.
10. Only after reconciliation has no durable effect, derive the scheduler input from one immutable authoritative board snapshot and the validated managed-PR facts. Run the existing deterministic scheduler: actionable means nonterminal, unblocked, dependency-ready, no conflicting pending transaction, and a legal next action. Prefer actionable WIP cards, then dependency readiness, configured numeric priority, and ascending card ID. Starting backlog is forbidden when WIP is at the configured limit.
11. If there is no selected card, return the stable no-action/wait report. If a phase request does not match the selected card's legal action, return `phase_not_eligible` without selecting another card.
12. Dispatch only the selected action. Heartbeat and recheck ownership before every child, archive, command, UI decision, worktree operation, GitHub mutation, push, and state-PR creation.
13. Build one complete candidate from the original authoritative snapshot plus validated evidence. Allocate IDs once, render all state-owned paths, validate the complete replacement snapshot, re-fetch `origin/main`, and reject a changed base before creating a state branch.
14. Update the held lock with `KFTX-*`, create/verify the exact state worktree and branch from the planned base, stage exact paths, inspect the staged diff, commit with state trailers, push, recheck the base, and open or recover one marked human-only state PR. Stop and release the lock. The transition is pending until that state PR merges.

A heartbeat failure or ownership loss aborts running children/process groups, prevents the next external action, and reports `lock_ownership_lost`. If an external action already completed, the report is `failed_recovery_required` and names only redacted durable identities; it never claims the action was undone.

## 4. Durable-boundary priority and stable pump report

### 4.1 Boundary priority

When more than one fact is observed, the coordinator uses this safety-first priority:

1. corrupt/ambiguous authority, unresolved closed state PR, or lock loss: stop with no new mutation;
2. an open pending state PR: wait and do not inspect proposed content as board authority;
3. a merged state PR or a uniquely provable external merge/close requiring card metadata: propose that reconciliation alone;
4. a uniquely actionable external fact that changes one card's durable status or blocker: propose that one reconciliation transaction alone;
5. an external wait (open design PR, pending checks/review, transient GitHub state): return a wait report with no state PR;
6. the selected card's next legal workflow action: run only until its first boundary;
7. no eligible card/action: return no action.

Multiple independent reconciliation mutations for different cards are not silently sorted or combined by the normal pump. They produce `ambiguous_reconciliation` and require a dedicated recovery/requirements transaction; the one-card coordinator opens no state PR.

### 4.2 Stable report object

The public result is versioned JSON with strict keys, canonical key order, bounded strings, no machine-local absolute paths, no secrets, and deterministic array order. Optional scalar values use the string sentinel `none`; optional objects use the fixed object shape with sentinel values. The shape is:

```yaml
version: 1
workflow: kanban
status: proposed | pending | waiting | no_action | phase_not_eligible | blocked | failed | cancelled | failed_recovery_required
operation_id: KFOP-... | none
base_commit: <git-object-id> | none
requested_phase: none | design | split_decision | implement | review | ship
selected_card_id: CARD-0001 | none
action: design | design_review | split_decision | implement | review | ship | reconcile | none
transition:
  from: <durable-status> | none
  to: <durable-status> | none
boundary: state_pr | external_pr | human_decision | blocker | external_wait | no_action | failure | none
state_pr:
  number: positive-integer | none
  url: https://github.com/.../pull/N | none
  branch: kanban/state/KFTX-... | none
  state: open | merged | closed | none
external_prs: []
blockers: []
waits: []
active_overrides: []
models: []
artifacts: []
evidence_gaps: []
next_human_action: bounded text or none
issues: []
```

The rendered key is `waits` (the space in the illustrative YAML above is not part of the key). `external_prs` entries are sorted by PR number and contain `{kind, card_id, number, url, state, head, head_commit, merge_commit}`. `active_overrides` and `models` use the exact source/hash/identity records required by the runner specs. `artifacts` is sorted in operation order and contains repository-relative artifact paths only. `issues` contains bounded `{code,message}` records sorted by code then message. `evidence_gaps` names missing proof, never a child claim.

`proposed` means a state PR was successfully opened or safely reused and is pending human merge. `pending` means a uniquely marked state PR is already open and blocks work. `waiting` and `no_action` never create a state PR. `blocked` is used for a card already durably blocked or a validated blocker report; when the blocker itself is being recorded, the state-PR result is `proposed` with `boundary: blocker`. `failed` means no external action requiring recovery occurred. `failed_recovery_required` means a branch, PR, comment, push, or correction may exist and must be reconciled before retry. `cancelled` is only a pre-action cancellation; cancellation after an external action is recovery-required.

### 4.3 No-action contract

A successful idle pump:

- fetched and reconciled authority;
- found no pending/unresolved conflict and no durable reconciliation effect;
- selected no card because the board is idle, all candidates are blocked/not dependency-ready, or WIP is full; and
- created no branch, commit, PR, state transaction, artifact, history entry, timestamp-only change, or ID.

It returns `status: no_action`, `action: none`, `boundary: no_action`, empty mutation arrays, `next_human_action: none`, and the authoritative base commit. Timestamp-only dashboard or `last_checked_at` churn is not an action.

## 5. Exact phase artifact and evidence contract

### 5.1 Canonical destinations

The engine derives every destination from role, phase, lens/probe, and run ID. A child-proposed path is never used. Valid paths are:

```text
docs/cards/artifacts/<CARD-ID>/design-producer-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/design-check-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/split-decision-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/implementation-producer-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/review-<lens>-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/ship-producer-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/ship-check-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/probe-project-commands-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/probe-ci-status-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/probe-pr-state-<KFRUN>.yaml
docs/cards/artifacts/<CARD-ID>/probe-diff-policy-<KFRUN>.yaml
```

Every accepted child result has one YAML artifact containing the validated public payload and the complete parent attestation from `spec-structured-results.md`. Every parent probe has the same top-level attestation shape with `tool: parent_probe`, `agent: null`, `model: null`, a logical execution context, and the directly observed exit/status truth. Paths are LF-normalized, canonical-key ordered, regular non-symlink files with one final LF. Artifact content and evidence are bounded and redacted before durable rendering.

### 5.2 Retention and attempts

- A valid completed, blocked, needs-human, fail, changes-requested, inconclusive, or parent-probe result is append-only evidence when the corresponding transition/effect needs to be recorded.
- A malformed payload, wrong-role call, duplicate call, prose-only run, unacceptable stop, nonzero child process, timeout, abort, policy violation, or cleanup failure is not a successful child artifact. Its bounded failure is retained only in the machine-local operation record unless a parent deterministic probe already produced durable evidence for a blocker.
- A producer result is persisted before its checker result when both are valid. A checker fail/inconclusive is persisted with the producer attempt; no hidden retry occurs in the same pump.
- All prior design, split, implementation, review, ship, and probe artifacts remain after rework, replacement, merge, or done. No artifact is overwritten, renamed, compacted, or deleted because a later attempt supersedes it.
- A replaced parent retains its approved design, split judgment, and historical attempts; replacement cards start with only their engine-created card artifacts/history and no product branch.
- Rework clears only fields explicitly named in the state-machine effect. It never clears result paths, finding IDs, branch identity, PR identity, or earlier heads.
- Artifact arrays on cards preserve execution order. Finding IDs are allocated in payload order immediately before each accepted artifact is rendered; within one attempt the order is producer findings, checker findings, then configured reviewer-lens findings. Parent probes have no findings.
- A state candidate must validate that the board finding counter exceeds every historical finding ID in all artifacts. If candidate validation, base validation, push, PR creation, or state-PR merge fails, preview allocations are discarded and can be regenerated from the unchanged authoritative snapshot.

## 6. Design phase

### 6.1 Canonical design document

The design producer returns exactly one `design_document` artifact and a typed `planned_paths` array. The parent, not the child, writes `docs/designs/<CARD-ID>.md`. The canonical document is UTF-8 Markdown, at most 200000 bytes, LF-normalized, and has exactly this heading sequence:

```markdown
# <CARD-ID>: <card title>

## Context

## Scope

### In scope

### Out of scope

## Acceptance mapping

## Interfaces and data flow

## Implementation tasks

## Test-first plan

## Objective verification

## Alternatives

## Decisions

## Risks and compatibility

## Planned paths
```

The first heading is the only level-one heading. Each required level-two heading occurs once, in order; no unknown level-two heading is allowed. The two Scope subsections occur once, in order. Required sections are non-empty except that `Out of scope` may explicitly say `None`. The validator additionally requires:

- `Context` to identify the active/grandfathered requirement text, card constraints, and relevant repository facts without copying mutable machine paths;
- `Acceptance mapping` to mention every card AC ID exactly at least once and map it to one or more ordered task keys and tests;
- `Interfaces and data flow` to name changed inputs/outputs, error behavior, compatibility, persistence, and migration effects;
- `Implementation tasks` to be ordered and contain stable local task keys, file-level intent, and no unapproved path;
- `Test-first plan` to show red/observable failing check, minimal green implementation, verification, and refactor for each applicable task and must not weaken or delete a test to obtain green;
- `Objective verification` to name only configured command names and parent-owned assertions, never executable text or arbitrary shell;
- `Alternatives` to record rejected options and reasons;
- `Decisions` to record durable rationale in this document. ADR files and ADR indexes are forbidden in schema version 1;
- `Risks and compatibility` to identify bounded unresolved risks and the compatibility/migration impact; and
- `Planned paths` to contain one canonical line for each typed producer path/action, in the same order, using `path`, `create|modify|delete`, and a reference to the owning task. The parent compares the parsed lines byte-for-byte with the typed list after normalization.

The document must not contain board frontmatter, card status, IDs other than supplied requirement/AC IDs and local task keys, branches, commits, PR URLs, executable/argv claims, secrets, absolute paths, or instructions to grant child authority. The parent rejects an empty task set, an acceptance criterion without a task/test mapping, a task without a planned path when it changes product code, or a planned path without a task.

### 6.2 Producer and checker dispatch

A fresh design producer receives:

- the authoritative card, active/grandfathered requirement text, acceptance criteria, dependency summaries, and project addendum selected by policy;
- the fresh `origin/main` commit and a bounded repository tree/read view;
- the exact design structure contract, design criterion keys, path classes, and result-tool contract; and
- the resolved agent source/hash, model/thinking identity, and broad-read resource policy.

A design rework producer receives all fresh inputs plus the prior canonical design content, prior producer/checker artifact paths, every blocking finding and evidence location, the current reusable branch/head identity, and the unchanged approved path policy for that attempt. It may correct or narrow planned paths before approval, but it cannot widen an approved design after the design PR has merged. It returns one replacement document, not a patch and not a commit claim.

The strict checker receives the parent-written design commit through an immutable `git archive` snapshot, the exact card/requirements, the typed planned paths, and the complete ordered design criteria. It receives no mutable worktree, producer-only context, shell, write/edit, Git, or GitHub tool. It must verdict every criterion exactly once. The checker snapshot's commit ID is the exact design commit being reviewed.

### 6.3 Parent write, commit, and PR ordering

The design coordinator performs this sequence:

1. heartbeat and resolve/reuse/create the deterministic design worktree;
2. validate the worktree, branch, common Git directory, expected base, cleanliness, and design path class;
3. write exactly `docs/designs/<CARD-ID>.md` with the validated producer content;
4. validate the document and typed paths, inspect the complete working diff, and require exactly one design path with the expected `create` or `modify` action;
5. stage exactly that path and verify the staged path set;
6. parent-commit with message `kanban: design <CARD-ID>` and the required design operation/card trailers;
7. archive the resulting immutable commit and run exactly one complete design checker dispatch;
8. on checker pass, heartbeat, revalidate commit/trailers/diff/base, push the branch without force, and re-fetch;
9. discover or create exactly one design PR with the canonical marker, title, and body; query it again and validate repository, base, head, head commit, marker, and open state; and
10. render one state candidate for `design_review` and open one marked state PR. The pump stops.

A checker fail or inconclusive result persists both valid attempts and requests `backlog|designing → designing`, incrementing `rework.design` exactly once if the configured budget remains. It never opens a design PR after a failed checker and never runs a hidden producer/checker loop. A valid producer `blocked`/`needs_human` result persists the producer artifact and creates a blocker or reports the required human input according to the result contract; no checker is run.

The design PR title is exactly `kanban: design <CARD-ID> — <card title>`. The parent-generated body begins with the canonical design marker, then exactly these headings in order: `## Design`, `## Scope`, `## Verification`, and `## Human merge`. It names the card, checked design commit, approved-base candidate, planned product paths/actions, producer/checker artifact paths, and the required human merge boundary. It contains no machine-local path, secret, unverified claim, second marker, transaction ID, or product/state path.

### 6.4 Design worktree, stale base, orphan, and merge recovery

The design branch is `kanban/design/<CARD-ID>-<slug>`. The slug is lower-case ASCII derived from the card title by replacing non-alphanumeric runs with `-`, collapsing repeated hyphens, trimming to 48 characters without a trailing hyphen, and falling back to the lower-case card ID. Worktree identity is derived from repository identity, class, card ID, and branch; its absolute path is machine-local and never stored in a card, artifact, or report.

Before use the parent enumerates `git worktree list --porcelain` and requires exactly one match with the expected branch, common Git directory, regular safe path, expected head/base, and clean status. Multiple matches, a detached/wrong branch, wrong repository, dirty worktree, symlink escape, special file, or stale metadata fails closed. Creation uses direct Git argv and never a shell.

The first design attempt is based on the fresh `origin/main` OID. If an unpushed local design branch is based on a stale OID, the parent may discard and recreate it from the new base, rewrite the same validated content, produce a new commit, and rerun the checker. It may not silently reuse the old checker verdict. Once a managed design commit is pushed, the parent never force-pushes or rewrites it. A pushed branch with a changed main base is reusable only when its unique marker/trailers and exact one-path diff remain valid; a conflict or inability to prove the base is a blocker.

A uniquely marked branch/commit without a PR is an orphan candidate. The parent validates all identity, trailers, base assumptions, exact path/action, and cleanliness before resuming push or PR creation. It is never success merely because the branch exists. A duplicate branch, duplicate marker, mismatched trailer, or material path change blocks.

An open unchanged design PR is a wait boundary. A changed head/base/path/marker, duplicate, or unreachable merge is ambiguous and blocks. A closed-unmerged design PR is reconciled to `designing` with one design rework increment when budget remains; it is blocked when exhausted. The next valid design attempt may reopen and reuse that same uniquely marked PR only after a fresh checked commit and exact identity validation; a second design PR is forbidden. No generic retry or automatic duplicate is created.

A design merge is authoritative only when GitHub reports `merged`, the merge commit is non-null, the exact PR/marker/head identity matches the card, and the merge commit is reachable from a freshly fetched `origin/main`. A design PR that merged before its state transaction was recorded is adopted through the recovery-only `backlog|designing → ready_for_implementation` state effect, retaining all valid artifacts and merge evidence. It is never recreated, reverted, or treated as a normal producer pass. Cleanup waits for authoritative merge/close reconciliation and validates the expected marker/commit before removing local resources.

## 7. Pre-implementation split decision

### 7.1 Inputs and immutable judgment

The split decider receives strict read-only access to:

- the exact merged approved design commit and its checked design document;
- a fresh immutable `origin/main` snapshot containing the authoritative card, requirements, all dependents, and real repository structure;
- every acceptance criterion and requirement link, the dependency graph, and the grandfathered-requirement flag; and
- the ordered split-result contract and policy metadata.

It receives no mutable product worktree, no branch/commit/PR tools, no ID allocator, and no transition authority. The result is one `submit_split_decision` call.

`no_split` requires zero replacement cards and evidence covering every acceptance criterion, requirement, and dependent. `split_required` requires 2–32 replacement proposals and evidence covering the complete original scope and every dependent. `needs_human` requires no replacements and an evidence-backed unresolved question. A malformed or cross-field-invalid result is not a judgment and cannot transition the card.

### 7.2 Parent validation of `split_required`

For a non-grandfathered card, the parent independently validates a split proposal before allocating any ID:

1. every original acceptance criterion is covered exactly once by the union of replacement criteria; no criterion is omitted, duplicated without an explicit non-overlap rationale, or changed in meaning;
2. every active requirement is represented and no superseded requirement is introduced; replacement criteria reference only active requirements;
3. every replacement is vertical, independently deliverable, non-empty, and not a horizontal layer, shared chores-only card, or empty shell;
4. every temporary key is unique, every title/body is valid, every priority is in range, and every dependency reference resolves to an existing card or sibling key;
5. sibling and external dependencies are preserved, complete, and acyclic in the resulting graph;
6. each replacement receives an engine-allocated `CARD-*` ID, has `status: backlog`, `replaces: [<source>]`, and no product/design/implementation metadata;
7. the source card becomes `replaced`, has `replacement_reason: split_decision`, reciprocal sorted `replaced_by`, retained approved design/split artifacts, no open PR, no blocker, and no implementation/review/ship metadata;
8. each replacement inherits the source's original prerequisites. Every outside card that depended on the source is rewired to depend on every replacement, preserving all other dependencies. Sibling dependencies are then validated for cycles and ordering; and
9. no product branch/worktree, product commit, or product PR is created for a normal split.

The candidate is rendered atomically from one snapshot. Rejected, failed, stale, or cancelled split proposals consume no CARD/AC/FINDING IDs and create no branch. The original result is retained unchanged; the parent does not reinterpret a `split_required` result as `no_split`.

### 7.3 Grandfathered cards and `proceed_unsplit`

A grandfathered card still receives the mandatory split assessment. A valid `no_split` proceeds normally. A valid `split_required` is persisted exactly as returned, the card remains `ready_for_implementation` with a blocker, and no replacement card or product branch is created because new children may not reference superseded requirements.

`proceed_unsplit` is a typed human blocker-resolution decision. It is valid only when the blocker was created by that grandfathered `split_required` result, the result path/timestamp remain present, and the card still satisfies the `ready_for_implementation` invariant. The resolution records the decision, reason, timestamp, operation ID, and `blocker_resolved` history in one state transaction, clears only the blocker, and stops. The next pump—not the resolution pump—creates the product branch and transitions to `implementing`.

In TUI and RPC modes the adapter uses Pi's built-in `ctx.ui.select` with exactly `proceed_unsplit` and `cancel` options bound to the displayed evidence digest. Escape, dismissal, timeout, abort, an unknown value, or a value not equal to the offered option is cancellation. JSON and print modes cannot approve this decision and return a prepared/unsupported no-mutation result. There is no implicit approval from a skill, model, flag, default, or noninteractive caller. Refusal leaves the blocker unchanged.

## 8. Product branch and implementation phase

### 8.1 Branch/worktree creation

After a valid `no_split`, or after a previously recorded grandfathered `proceed_unsplit` override, the product branch is `kanban/card/<CARD-ID>-<slug>` using the same canonical slug algorithm. The parent creates or reuses exactly one clean linked worktree from fresh `origin/main`, validates its common Git directory and path policy, and records only the branch in the `ready_for_implementation → implementing` state transaction. The absolute worktree path is machine-local and never durable. The pump does not dispatch implementation in that transition.

A branch/worktree created before the state PR is merged is pending evidence, not authority. If the state PR is open, later pumps wait. If the state PR is closed-unmerged, the branch is preserved for explicit state-PR recovery and is not adopted as an implementation transition merely because it exists. A clean uncommitted product branch with no managed trailer may be removed and recreated only before any product commit or PR; a pushed/marked branch is never force-rewritten.

### 8.2 Implementation producer contracts

A fresh implementer receives:

- the merged design document and approved design commit;
- the exact card, requirements, acceptance criteria, validated split evidence/override, and typed product planned path/action allowlist;
- the product worktree logical branch/base identity and repository guidance allowed by the broad trusted policy;
- the test-first doctrine (red, minimal green, objective verification, refactor, no test weakening); and
- only named project-command tools, where a call supplies a configured command name and never executable/argv.

A rework implementer additionally receives the current immutable implementation head, the prior implementation/review/probe artifacts, all blocking findings and evidence in configured order, the exact one-time rework counter decision, and the unchanged approved path/action allowlist. It may edit only the product worktree through path-jailed package tools. It must return a valid `implementation_summary` producer result or a typed blocked/needs-human result. The summary, claimed commit, command output, prose, and child timestamps never establish completion.

The parent validates the complete worktree diff after child exit, including tracked, untracked, deleted, renamed, symlink, special-file, `.git`, board-owned, design-owned, outside-worktree, and unplanned paths. The actual path/action set must be a subset of the approved typed list and equal the staged set. A required path outside the allowlist blocks for redesign; the parent never widens policy from child prose. A zero product diff cannot claim implementation complete.

The parent stages exact product paths, verifies the staged diff, and commits with message `kanban: product <CARD-ID>` plus product operation/card trailers. It resolves `HEAD` after the commit, validates the object ID and trailers, and records that immutable head as `workflow.implementation.head_commit`. The implementation result path is appended. On success the legal effect is `implementing → implementation_review`; the review commit/timestamp are cleared for the new head while prior review artifacts remain.

An implementation child/process/path-policy failure creates no success transition. A valid blocked/needs-human result may be persisted with a blocker effect. A technical failure before a valid result returns `failed` without a state PR unless a separately validated parent probe/evidence record is required to make an existing blocker durable. A state/lock/Git failure after a local or pushed commit uses the product branch/trailer recovery rules and never claims the commit is authoritative board state.

## 9. Objective project-command probes

### 9.1 Command set and execution

Review probes run after the parent has committed the immutable implementation head and before strict review aggregation. The parent runs every configured project command exactly once, in this fixed order: `test`, `lint`, `typecheck`, `build`. Keys absent from config are not invented or probed. `test` must be present by schema validation. A configured command is the complete executable/argv array from `config.yaml`; a child cannot select an executable, append arguments, request a shell, or change the environment.

Each command runs directly with `shell: false`, in the clean product worktree at the exact implementation head, in a new process group, with the five-minute timeout and one-MiB per-stream limit. The parent heartbeats before spawn and aborts the process group on timeout, output overflow, cancellation, or lock loss. The parent verifies the worktree is still at the expected head and clean after each command. A command that mutates files, refs, or protected paths is a policy failure; the parent does not silently clean or commit its side effects.

The single `probe-project-commands` artifact contains one parent observation per configured command in fixed order and records the exact configured argv, exit code/signal, timeout/abort state, bounded redacted stdout/stderr, byte counts, logical branch/commit, and a summary. The durable representation replaces machine-local root/worktree paths with logical tokens and redacts credentials, access tokens, private keys, and environment-derived secrets. A command detail never exceeds the parent-probe bounds.

### 9.2 Deterministic classification

- Exit code `0` with a clean worktree is `pass`.
- A completed ordinary nonzero exit code is `fail` and is actionable code/test evidence.
- Missing executable, spawn error, signal without a completed assertion, timeout, output overflow, abort, lock loss, or inability to prove the command's environment is `unknown` and therefore inconclusive.
- A configured optional command is not replaced by a guessed package script. A missing optional config key produces no observation. A configured but unavailable optional command is still recorded as unknown; it does not silently pass.
- The overall parent probe is `success` only when every configured command, including required `test`, passes; `failure` when at least one command has actionable ordinary nonzero evidence and no required unknown supersedes the interpretation; and `inconclusive` when any required observation is unknown or the process truth cannot be established.
- Lock loss, cancellation, and process cleanup failure are pump failures, not code findings. They do not spend implementation rework.

A nonzero configured test/lint/typecheck/build result is routed to implementation rework only after all required probe/process facts are complete and no inconclusive fact exists. The parent never changes a command's truth from child output.

## 10. Independent implementation review panel

### 10.1 Dispatch inputs and isolation

Every configured lens receives the same immutable archive of the exact implementation commit. The parent supplies the approved design commit/document, exact card/requirements/ACs, exact product diff and path/actions, the complete parent project-command probe, and any prior accepted findings. The reviewer receives only its lens doctrine, package read/grep/find/ls tools, one reviewer result tool, and the strict policy. It receives no mutable product worktree, write/edit/shell/Git/GitHub tools, producer-only context, or ability to select another lens.

The parent creates all lens snapshots from the same commit and records that commit in every attestation. A snapshot hash or commit mismatch is a dispatch failure. Full configured order is retained regardless of completion order.

### 10.2 Panel execution and aggregation

The panel dispatches every configured lens exactly once, with bounded parallelism at `config.review.max_parallel`. A technical failure, malformed result, wrong lens, duplicate result, or cleanup failure produces an inconclusive required-lens outcome; it does not become a pass and does not allow the remaining lenses to be omitted. Parent cancellation or lock loss may abort the whole panel. Otherwise independent lenses complete and are aggregated in configured order.

The aggregate rules are:

1. `ready_to_ship` requires a successful complete project-command probe and a `pass` result from every configured lens.
2. A reviewer `changes_requested` result must contain blocking findings. A `pass` result cannot contain a blocking finding. Non-blocking findings and notes are retained and advisory.
3. Any blocking finding or actionable project-command failure with no inconclusive required evidence requests one implementation rework when `rework.implementation` is below its limit. One state transaction changes `implementation_review → implementing` and increments the counter exactly once. All valid panel/probe artifacts and finding IDs are retained. The same pump never re-dispatches the implementer.
4. Any inconclusive required probe/lens, mixed blocking and inconclusive evidence, or exhausted implementation budget creates a blocker in `implementation_review` with the exact evidence paths. The counter is not incremented when exhausted.
5. Advisory-only findings with all required probes/lenses passing complete review and produce `implementation_review → ready_to_ship`.
6. After implementation rework, every configured command and every configured lens runs again against the new immutable head. Partial-lens reruns are not supported in schema version 1.

Finding IDs are allocated in lens configuration order, then payload order within each lens. Parent probe observations are evidence, not findings.

## 11. Ship phase and product PR

### 11.1 Ship producer and body contract

The read-only ship producer receives the approved design, exact implementation/review/probe artifacts, immutable reviewed commit, card/requirements/ACs, exact product diff/path actions, and the product PR body contract. It runs under strict immutable-snapshot policy and returns one bounded `product_pr_body` artifact. It cannot push, edit, create a PR, query GitHub, or invent a claim.

The parent validates and constructs the final body. The body begins with exactly one parent-generated product marker, followed by these headings in order and no level-one heading:

```markdown
<!-- kanban-flow:{canonical product marker} -->

## Summary

## Scope and acceptance

## Verification

## Review

## Merge boundary
```

Each section is non-empty and bounded. Claims must be traceable to the approved design, exact diff, accepted parent probe, or accepted reviewer artifacts. Unsupported claims, unredacted absolute paths, secrets, arbitrary marker-like comments, branch/commit/PR claims not supplied by the parent, or a path/action mismatch are rejected. The parent may remove or replace only deterministic metadata/body content according to the correction rule below; it never silently edits product code.

The product PR title is exactly `kanban: <CARD-ID> — <card title>`. The branch is the deterministic product branch and base is exactly `main`.

### 11.2 Deterministic pre-PR verification and ordering

From `ready_to_ship`, the parent:

1. heartbeats and fetches fresh `origin/main`;
2. validates the product worktree/branch, clean state, reviewed head, product trailers, exact binary/path/action diff, excluded path classes, repository identity, and base;
3. runs the parent `probe-diff-policy` and `probe-pr-state` inputs needed by the ship checker;
4. validates the ship body and ordered complete ship criteria;
5. verifies the expected base OID immediately before push; if it changed and no managed branch action has occurred, discards/replans from fresh main; a pushed branch is never force-rebased;
6. pushes the exact product branch without force, re-fetches, and revalidates base;
7. discovers the unique marked product PR for the card/branch. It creates one only when none exists, reuses one matching open PR, and never creates a duplicate. A merged PR is recovery evidence; a closed-unmerged PR follows the blocker/recovery rules;
8. queries canonical PR metadata, required check rollup, effective review state, and body/marker identity through parent-owned GitHub adapters;
9. dispatches the ship checker exactly once with the complete immutable inputs and supplied evidence; and
10. if and only if structural validation and every ship criterion pass, records all ship producer/checker/probe artifacts and proposes `ready_to_ship → shipping` in one state PR. The pump stops.

Opening or reusing the product PR is an external durable boundary. If a later step fails, the unique PR/branch is retained and the result is recovery-required, wait, rework, or blocker according to the ownership table; a retry discovers the marker and never creates a second PR.

### 11.3 Ship failure ownership

| Evidence | Parent-owned outcome |
|---|---|
| Required project command has actionable ordinary failure, or a required CI result later proves code failure | `shipping → implementing`, preserving the same marked open product PR and spending the implementation budget once; exhausted budget blocks. |
| Product diff contains an unplanned/excluded path, wrong action, missing trailer, or reviewed head cannot match the product branch | implementation/path-policy rework when a bounded code correction is possible; otherwise blocker. The parent never broadens the allowlist. |
| Body claim/format or deterministic parent metadata is wrong while exact supporting evidence exists | One idempotent parent correction for the current operation and semantic criterion. The desired exact body/title/metadata is compared before editing; a canonical correction marker is posted/reused only after exact-state comparison. Re-query and re-run ship validation. A repeated or failed correction blocks. |
| Marker, branch, repository, base, head, duplicate PR, or merge identity is ambiguous | blocker; no selection or duplicate PR. |
| GitHub/network/rate limit or pending CI/review state prevents a conclusion | wait/no mutation; do not infer failure or success. |
| Required CI is pending | `shipping` wait report with no timestamp-only state transaction. |
| Required CI is completed but provider supplies no path-scoped code evidence for a failure, or status/conclusion is unknown/cancelled/infrastructure | inconclusive blocker, not automatic implementation rework. |
| Effective GitHub review state is `CHANGES_REQUESTED` | blocker in `shipping`; comments are not inferred addressed and no review is dismissed/cleared automatically. |
| Product PR is closed-unmerged, conflicts, or has conflicting material metadata | blocker; retain the external identity and require explicit recovery. |

A deterministic correction never edits source code, never spends implementation rework, and is bounded to one operation/criterion. A corrected PR is revalidated against the same reviewed commit before a state transition.

## 12. GitHub and external-state reconciliation

### 12.1 State PRs first

The reconciler fetches `origin/main`, discovers every state marker, and rejects missing/duplicate/malformed/conflicting markers. An open state PR is `pending` and blocks selection. A closed-unmerged state PR without a valid resolution marker is unresolved human refusal: the coordinator reports it and performs no board mutation, external PR mutation, or card selection. A merged state PR is authoritative only when its commit is reachable from fresh `origin/main` and the marker/trailer/descriptor agree; the board snapshot is then reread from main. Recording the state PR's own URL/merge timestamp is not a follow-up mutation.

### 12.2 Design PRs

For each card's deterministic design identity, the reconciler validates unique marker/branch/base/head/diff identity:

- open unchanged means wait;
- open with material head/base/path/marker conflict blocks;
- merged requires GitHub merged state, a non-null merge commit, exact checked head, and reachability from fresh `origin/main`, then proposes only `design_review → ready_for_implementation` (or the specified recovery adoption);
- closed-unmerged requests `design_review → designing` with one counter increment when budget remains, otherwise a blocker; and
- multiple PRs, malformed markers, wrong repository/base, unreachable merge, or a branch/path mismatch block.

The reconciler never dispatches split judgment in the same pump as design merge reconciliation.

### 12.3 Product PRs and check/review interpretation

A shipping card must have exactly one marked product PR. Product PR identity is the stored branch/number/head plus marker and exact diff evidence. Required checks come from the parent GitHub check-rollup adapter:

- `queued`, `requested`, `waiting`, or `in_progress` is pending;
- `success`, `neutral`, and `skipped` are acceptable conclusions when GitHub marks the check required and complete;
- `failure` is actionable code failure only when the adapter has deterministic path-scoped code evidence (for example, a completed check annotation or configured check evidence naming an affected approved product path); otherwise it is inconclusive and blocks;
- `cancelled`, `timed_out`, `action_required`, missing, malformed, or unknown provider data is inconclusive/blocking unless GitHub independently proves a pending state; and
- a transient API/network error is a wait/no-mutation outcome, never a failed check.

Effective review state is computed from the latest non-dismissed review per reviewer. Any effective `CHANGES_REQUESTED` blocks; an approval does not override another reviewer's changes request. Dismissal is observed, not performed. Comments do not become addressed findings through text matching. An open PR with unchanged reviewed head and no blocking review/check state remains a no-change wait report.

Material changes include PR state, repository/base/head/number/URL, marker, head commit, merge commit, required-check conclusion, effective review state, and body/title content used by ship validation. A material metadata change with no legal next transition may be recorded as `shipping → shipping` with a new parent probe/artifact and history entry. Nonmaterial timestamps (`last_checked_at`), ordering churn, and dashboard-only drift do not create a state PR. A changed product head is never timestamp-only; it must return through implementation/review or block according to the ownership table.

A product merge is proven only by all of:

1. GitHub reports the unique marked PR as merged with a non-null merge commit;
2. the merge commit is reachable from freshly fetched `origin/main`;
3. the merged tree is compatible with the reviewed product diff and excludes board/design paths; and
4. the parent can prove inclusion of the reviewed head either by reachability or by a canonical comparison of the PR's reviewed diff to the merge result (to support squash/rebase merge strategies). If the provider cannot supply this proof, the card blocks rather than assuming inclusion.

A proven merge proposes `shipping → done` with `merged_commit` and `delivered_at`, retaining all artifacts. The card is not authoritative `done` until that final state PR merges. A product PR merged before its `ready_to_ship → shipping` state transaction is recorded is adopted only through the recovery-only `ready_to_ship → done` effect after exact marker, reviewed-head, verification, and merge proofs; it is never recreated or reverted.

### 12.4 External-action retry rules

The following recovery identities are mandatory:

| Window | Retry authority and action |
|---|---|
| Before branch/worktree creation | no managed evidence; replan from fresh main. |
| Worktree/branch created with no commit | validate clean expected base; reuse or remove/recreate; no success. |
| Local managed design/product commit, not pushed | validate trailers/diff/base; reuse only if base assumptions remain valid, otherwise discard and replan. |
| Branch pushed, no PR | discover unique remote branch and trailers; validate exact diff and create/recover the marked PR. |
| Design/product PR opened, state transaction absent | discover the unique marked PR; validate it and build the state candidate from fresh main. |
| Design/product PR merged, state transaction absent | prove merge/reachability/diff and use only the specified recovery-adoption effect. |
| Product PR opened before ship checker/state PR | retain and reuse the same PR; route checker outcome by ownership; never create another. |
| Parent correction edited body/title before marker/report | compare exact desired state, reuse if already correct, otherwise perform one idempotent correction and marker; conflicting state blocks. |
| State branch committed/pushed, state PR absent | resume the exact transaction only if the descriptor, trailers, base, and diff remain valid; otherwise block, never silently rewrite. |
| State PR opened | report pending; do no workflow work until merge/recovery. |
| State PR merged | read main as authority; cleanup only after proof; no metadata-only transaction. |
| Cleanup fails after merge/close proof | report cleanup failure and retain resources; never reverse authority or repeat an external action blindly. |
| GitHub unavailable or lock ownership lost | no new external action/state mutation; release if owned and report transient/recovery status. |

## 13. Blockers, explicit resolution, and manual phase skills

### 13.1 Blocker semantics

A blocker retains the current durable status and has the exact schema-version-1 `reason`, `source_phase`, `resume_status`, `created_at`, and evidence paths. Only the engine creates/clears it. Evidence is parent-attested and canonical; a child question is evidence for a required human answer, not permission to transition.

The blocker-resolution surface validates the current authoritative card, current external markers/PRs, artifact invariants, status-pair table, and any supplied human evidence. It creates one state transaction that clears the blocker and sets exactly the recorded `resume_status`; it performs no additional workflow action in the same pump. It never resets a rework counter. A human may authorize another directed producer attempt after exhaustion, but the counter remains exhausted and the next pump still stops at its normal boundary.

Recoverable design/review/shipping blockers require the external correction or human decision to be independently visible first (for example, a reopened uniquely marked PR, a resolved GitHub review state, a new CI result, or a repaired branch). The resolution transaction does not accept prose claiming that the condition is fixed. Ambiguous state-PR adopt/abandon remains the separate explicit state-recovery procedure and cannot be inferred from blocker resolution.

### 13.2 Skills

`/skill:kanban` is a thin explanation plus one call to the deterministic pump tool. The phase skills are thin diagnostic/manual front doors to the same coordinator:

- `/skill:design` requests `design`;
- `/skill:implement` requests `split_decision` when the selected legal action is the mandatory split gate and `implement` only for an already-entered `implementing` card;
- `/skill:review` requests `review`; and
- `/skill:ship` requests `ship`.

They do not call children, inspect/write board files, run Git/GitHub/commands, approve, allocate IDs, choose a card, or bypass reconciliation. If the requested phase is not the normal legal action, they return the stable `phase_not_eligible` report and perform no mutation. Unsupported/noninteractive blocker decisions return no-mutation refusal.

## 14. Failure and no-mutation contracts

The engine distinguishes these classes:

- **Pre-action failure:** no child result or external action exists. Release the lock and return `failed` with bounded issues; no state PR and no durable artifact.
- **Valid bounded result:** a role result passed all structural/cross-field checks. Persist it only if the selected transition/effect records the attempt; apply the exact state-machine effect and retain it append-only.
- **Valid failing/inconclusive/blocked result:** persist the result and evidence when the corresponding rework/blocker/split effect is durable. Never treat it as success.
- **Child/process failure:** no valid child artifact and no success transition. A pre-existing external identity is preserved for marker recovery; a durable blocker is created only from parent-attested evidence and a legal state effect.
- **Parent deterministic failure before external action:** no state mutation. This includes invalid document/body/diff/paths, unavailable model/trust/policy, and stale base before push.
- **External action failure after an action:** return `failed_recovery_required` or `waiting`, preserve marker/trailer/branch/PR identity, and let the next pump reconcile. Never create a duplicate or claim rollback.
- **State transaction failure after no push:** remove only the uncommitted matching temporary worktree; no board mutation. After a state branch/commit is pushed, preserve it and follow state-PR recovery rather than silently recreating it.
- **Cancellation/abort:** before any external action, `cancelled` with no mutation; after an action, `failed_recovery_required` with exact safe recovery evidence. Lock ownership loss is never reported as ordinary cancellation.
- **No mutation:** `no_action`, `phase_not_eligible`, `waiting`, technical `failed`, unsupported noninteractive decision, and unresolved ambiguity do not create a state PR, alter board files, consume durable IDs, or modify `main`.

## 15. Required pure effects and invariants

Every Stage 4 candidate is built from one frozen authoritative snapshot and validated before any state branch is written. The effect must:

- append history with the current operation/transaction IDs for every changed card;
- append, never overwrite, accepted artifact paths and findings;
- set `started_at` once on the first backlog design effect;
- retain approved design/requirements assumptions and explicitly grandfathered metadata;
- clear only `reviewed_commit`/`completed_at` when implementation rework replaces the reviewed head;
- preserve the same marked open product PR across shipping-to-implementing rework and later reuse it on the same branch;
- set `delivered_at` only from a proven product merge reconciliation;
- set `done`/`replaced` only with their complete schema invariants and no blocker; and
- regenerate canonical `BOARD.md` only for semantic state changes, never for timestamp-only churn.

The normal one-card transition effects are:

| Current action | Durable effect | Selection/boundary |
|---|---|---|
| backlog/designing design pass | producer/checker artifacts, design branch/PR, `design_review`, `started_at` | selected; state PR after design PR |
| backlog/designing design fail/rework | valid attempt artifacts, `designing`, one design counter increment | selected; state PR |
| design review merge | approved commit/merge evidence, `ready_for_implementation` | reconciliation-only; state PR |
| ready split `no_split` | split result, product branch, `implementing` | selected; state PR, no implementation |
| ready split valid `split_required` | source `replaced` plus allocated backlog replacements and rewired dependencies | selected; one atomic state PR |
| grandfathered split required | split result plus blocker | selected; state PR |
| implementing completion | implementation artifact/head, `implementation_review` | selected; state PR |
| implementation/review actionable rework | findings/probe evidence, `implementing`, one counter increment | selected/reconciliation-only; state PR |
| implementation/review inconclusive or exhausted | blocker retained at legal status | state PR |
| review pass | complete probe/panel artifacts, `ready_to_ship` | selected; state PR |
| ship pass | product PR plus verification artifacts, `shipping` | selected; state PR |
| shipping material metadata reconciliation | refreshed parent evidence, same `shipping` status | reconciliation-only; state PR only when material |
| product merge proof | merged PR/commit, `done`, `delivered_at` | reconciliation-only; final state PR |
| blocker resolution | clear blocker, exact recorded resume status, history | reconciliation-only; state PR and stop |

## 16. Explicitly deferred behavior

Schema version 1 does not add unattended looping, post-review multi-PR splitting, partial review-lens reruns, ADR files/indexes, arbitrary child shell/Git/GitHub access, automatic state/design/product merge, automatic review-comment handling, testing levels/coverage/quarantine/nightly probes, migration from unsupported Claude boards, personal memory writes, distributed locks, or Windows support. Any return of these behaviors requires a new specification and stage gate.

## 17. Stage 4 acceptance boundary

A sequence of manually invoked pumps may move one unsplit card through `backlog → design_review → ready_for_implementation → implementing → implementation_review → ready_to_ship → shipping → done`, with human merges at every PR boundary, one mandatory split decision, one bounded implementation rework, complete immutable artifacts, and no child/skill-owned authority. A valid split instead atomically produces replacement backlog cards; a grandfathered split requires explicit `proceed_unsplit`. Every external crash window is recovered by marker/trailer/commit evidence or stops safely with no inferred success.
