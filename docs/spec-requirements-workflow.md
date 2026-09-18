# Requirements workflow specification

**Status:** Authoritative Stage 3 contract for schema version 1

## 1. Purpose and authority

This specification closes the operational contract for `/skill:kanban-init` and `/skill:requirements`. It refines the Stage 0 requirements rules without moving authority into a skill, parent conversation, or child model.

`origin/main` is the only board authority. The parent engine owns repository identity, reconciliation, locking, proposal normalization, impact derivation, ID allocation, rendering, approval binding, external actions, and state-PR creation. A child result is evidence. A skill supplies bounded intent. Neither can write board, Git, or GitHub state.

Where this document is more specific than a Stage 0 summary, this document controls the Stage 3 workflow. The schema, state-machine, lock, state-PR, child-runner, and structured-result specifications still control their respective shared primitives.

## 2. Common preconditions

Both workflows require:

- Pi `>=0.85.0 <0.86.0`, Node.js `>=22.19.0`, Git `>=2.39.0`, and `gh >=2.45.0`;
- a canonical Git worktree whose configured remote is exactly `origin` and whose authoritative branch is exactly `main`;
- a GitHub repository whose canonical identity is independently derived as described below;
- an applicable persisted `yes` decision in Pi's trust store for the canonical repository root or a parent; temporary approval and `defaultProjectTrust: always` do not qualify;
- no unsafe symlink, special file, dirty owned path, ambiguous managed marker, open state PR, or unresolved closed state PR; and
- direct executable/argv process invocation without shell interpolation.

The parent generates one `KFOP-*` operation ID before lock acquisition. It acquires the common-Git-directory lock with command `kanban-init` or `requirements` and starts a heartbeat before the first fetch or GitHub query.

## 3. Canonical repository identity

The parent derives identity; no tool input or model payload may supply it.

1. Resolve the canonical repository root and common Git directory with Git.
2. Require exactly one configured `origin` URL and normalize only these GitHub forms: `https://github.com/OWNER/NAME[.git]` and `git@github.com:OWNER/NAME[.git]`.
3. Invoke the configured first-release executable `gh` directly as `gh repo view --json nameWithOwner,url` in the repository. Initialization has no config yet, so its executable is the literal `gh`.
4. Normalize `nameWithOwner` to lowercase and require it to satisfy the board repository-ID schema.
5. Require the normalized origin owner/name, GitHub-reported owner/name, and GitHub URL owner/name to agree exactly after lowercase normalization.
6. Fetch `origin`, require `refs/remotes/origin/main`, and require the checked repository's common Git directory to own the current worktree.

A redirect, fork mismatch, non-GitHub remote, multiple origin URLs, missing `origin/main`, or ambiguous case/URL is a refusal. The canonical lowercase `owner/name` becomes `board.yaml.project.repository_id` and the lock repository identity.

## 4. `/skill:kanban-init`

### 4.1 Skill and tool input

The skill explains prerequisites and invokes `kanban_initialize` with this exact public input:

```yaml
schema_version: 1
```

The TypeBox object rejects unknown fields. There is no repository ID, config override, command, path, approval flag, or initial requirement input.

Initialization is LLM-free. It does not create `docs/spec.md`, cards, requirements artifacts, or child runs. Initial requirements always use a later, separately reviewed state PR after the initialization PR merges.

### 4.2 Layout classification

The initialization planner classifies the authoritative `origin/main` tree, not merely the mutable checkout:

- **uninitialized** — none of `docs/cards/board.yaml`, `docs/cards/config.yaml`, `docs/cards/BOARD.md`, `docs/cards/PROTOCOL-ADDENDUM.md`, `docs/cards/artifacts`, or `docs/cards/CARD-*.md` exists, and `docs/cards` is either absent or an empty real directory;
- **initialized** — `readBoardRepository()` succeeds, identity matches, and canonical dashboard bytes match;
- **partial** — at least one board-owned control file exists but a complete board cannot be read;
- **migrated** — a valid board has non-null migration metadata;
- **ambiguous** — any owned path is a symlink/special file, `docs/cards` contains an unrecognized entry, identity cannot be proved, or local and authoritative layouts differ in an owned path.

`initialized` returns a no-op report and performs no Git/GitHub action. `migrated` is also already initialized and returns a no-op report. `partial` and `ambiguous` fail closed. Initialization never repairs or adopts partial state.

The mutable checkout may contain unrelated dirty paths, but every prospective initialized path and each ancestor from the root through `docs/cards` must be clean and safe. A dirty/untracked `docs/spec.md` also blocks initialization because it is state-owned even though initialization does not create it.

### 4.3 Fixed schema-version-1 defaults

Initialization creates exactly these files:

- `docs/cards/board.yaml`;
- `docs/cards/config.yaml`; and
- `docs/cards/BOARD.md`.

It may create the real `docs` and `docs/cards` directories as worktree containers, but directories are not descriptor paths. Exact config values are:

```yaml
repository:
  forge: github
  gh_command: gh
  remote: origin
  base_branch: main
state_prs:
  merge_policy: human
lock:
  ttl_seconds: 1800
  heartbeat_seconds: 30
scheduler:
  wip_limit: 1
  priority_order: ascending
rework:
  design_limit: 2
  implementation_limit: 2
review:
  lenses:
    - acceptance
    - functionality
    - tests
    - readability
    - security
    - simplicity
  max_parallel: 4
project_commands:
  test: [npm, test]
  lint: [npm, run, lint]
  typecheck: [npm, run, typecheck]
  build: [npm, run, build]
agent_models:
  default: inherit
  overrides: {}
agents:
  allow_project_overrides: true
  report_overrides: true
resources:
  broad_policy_allowed_skills: []
```

These are package constants, not inferred from repository files. A project with different commands edits the initialization PR before merge or changes config through a later reviewed state transaction; the workflow never probes package scripts to broaden command authority.

`board.yaml` uses the derived identity, all four counters at `1`, `migration: null`, the package version, and the operation's reconciliation timestamp. Its `last_state_transaction` descriptor names no cards and exactly the three paths above. `BOARD.md` is the canonical empty dashboard from the board renderer.

### 4.4 Initialization transaction seam

Normal state transactions continue to require `readBoardRepository()`. Initialization uses a separate typed coordinator entry point whose repository interface has `classifyUninitialized(root, baseCommit)`, `buildInitializationCandidate(...)`, and `validateInitializationCandidate(...)`. It must not make normal reads accept a missing or partial board.

The initialization coordinator:

1. fetches and resolves fresh `origin/main`;
2. performs the layout classification and managed-state-PR preflight;
3. builds and validates the complete in-memory candidate;
4. allocates one `KFTX-*` and updates the held lock with it;
5. re-resolves `origin/main`;
6. creates `kanban/state/<KFTX-ID>` from that exact commit in an isolated worktree;
7. writes and stages exactly the three paths;
8. verifies the full diff and descriptor path equality;
9. commits with state trailers, pushes, rechecks the base, and opens one human-only marked state PR; and
10. reports the PR as pending, never as authoritative.

An existing matching branch/commit/PR follows the shared crash matrix. No initialization code writes the user's checkout or `main`.

## 5. `/skill:requirements` input boundary

### 5.1 Interview responsibility

The skill conducts a model-led, one-question-at-a-time interview. It may ask about users, observable behavior, constraints, exclusions, and dependencies. It stops when the request is testable or the user cancels. Interview prose is untrusted and is not persisted.

The skill cannot inspect or mutate board files by instruction, allocate IDs, select paths, run shell/Git/GitHub, declare status effects, approve, or request an approval bypass. It invokes exactly the deterministic `kanban_requirements` tool.

The interview occurs before tool execution and therefore before lock acquisition. It owns no mutable resource and has no authority to promise that the later authoritative base remains unchanged. Once the tool starts, all validation and any approval occur under the lock.

### 5.2 Exact tool input

```yaml
schema_version: 1
brief: bounded interview summary
```

The object rejects unknown fields. `brief` is trimmed UTF-8 text of 1–20000 Unicode code points, with NUL and unpaired surrogates rejected. It may contain Markdown. It is producer input only and never becomes an approval or durable artifact by itself. There is no mode, path, ID, model, agent, retry, approval, command, branch, PR, or transition field.

The tool runs only on a complete initialized board. Initial requirements are represented by an absent `docs/spec.md` and zero cards; a partially present spec/card set is invalid board state, not an initialization shortcut.

## 6. Reconciliation and preflight order

After acquiring the lock, the requirements coordinator:

1. verifies the lock still belongs to the operation;
2. fetches `origin` and resolves `origin/main`;
3. reads and validates the board, config, optional spec, cards, dashboard, counters, and repository identity;
4. discovers every managed state/design/product PR and action marker;
5. refuses an open state PR or unresolved closed state PR;
6. derives reconciliation effects before producer dispatch; and
7. if reconciliation requires durable mutation, proposes only that reconciliation state PR and returns `reconciliation_proposed`.

A requirements producer/checker is never dispatched in the same operation as a reconciliation mutation. A marked requirements-design-close action whose board effect was not recorded is treated as incomplete requirements closure, not generic design-PR closure: it is reported to a later requirements run and handled under section 13 after fresh validation and approval.

## 7. Agent and model preparation

Before the first child spawn, the parent:

- proves persisted trust again;
- discovers and validates all considered requirements producer/checker overrides;
- resolves both models and authentication with no fallback;
- records the active agent source/path/hash and actual planned model/thinking identity;
- assembles approved producer project context and allowlisted skills;
- fixes the checker criterion array to the ordered `REQUIREMENTS_CRITERIA` package constant; and
- validates resource policies, limits, snapshot inputs, and cleanup paths.

The producer runs sequentially with broad-read policy at the canonical repository. The checker runs sequentially with strict policy against an immutable exact-commit snapshot plus parent-rendered proposal inputs. It receives no arbitrary project context or skills.

## 8. Canonical requirements criteria

Production code defines and exports one deeply immutable ordered constant named `REQUIREMENTS_CRITERIA`. It contains these exact keys and meanings, in order:

1. `REQ-OBSERVABLE`;
2. `REQ-ACTIVE-LINKS`;
3. `REQ-COVERAGE`;
4. `REQ-NO-OVERLAP`;
5. `REQ-VERTICAL`;
6. `REQ-SIZED`;
7. `REQ-DAG`;
8. `REQ-SUPERSESSION`; and
9. `REQ-GRANDFATHER-COVERAGE`.

The descriptions are the normative descriptions in `spec-structured-results.md`. Dispatch prompt assembly and checker result validation import this same constant; neither duplicates a hand-maintained list. Every key appears exactly once in this order.

## 9. Proposal normalization

### 9.1 General rules

The parent first validates the public producer payload, then converts it into a deeply frozen normalized proposal without mutating the payload or authoritative snapshot. It rejects unknown fields and any prose that attempts to select IDs, paths, grandfathering, histories, commits, branches, PRs, counters, timestamps, board fields, or approval.

Text normalization is deterministic:

- convert CRLF/CR to LF before schema validation when content came from the model event decoder;
- trim outer whitespace on single-line fields and reject embedded newlines;
- trim leading/trailing blank lines from Markdown while preserving internal bytes;
- trim acceptance text and collapse no internal whitespace;
- reject NUL, unpaired surrogates, over-limit values, empty required values, or duplicate normalized values.

Temporary keys match `[a-z][a-z0-9-]{0,31}` and are unique across their own requirement/card namespace. Existing durable IDs and temporary keys are disjoint typed references; a string cannot resolve by best effort.

Normalized requirement changes are sorted by action class (`amend_same_meaning`, `retire`, `supersede`, `create`), then existing target/superseded ID, then temporary key. New durable requirement IDs are allocated in this order. Normalized card changes are sorted by existing target card ID first, then action, then temporary key. New/replacement card IDs are allocated in this order. Acceptance proposals preserve their explicit array order; dependencies and durable ID arrays are sorted after resolution.

### 9.2 Requirement actions

- `create`: one temporary key, no target, no superseded IDs, and complete new content.
- `amend_same_meaning`: no temporary key, one active target, no superseded IDs, and complete replacement content. The target ID is retained.
- `supersede`: one temporary key, no target, one or more existing active/superseded IDs in ascending order, and complete replacement content. Every target becomes superseded and the new requirement is active.
- `retire`: no temporary key, one active target, no superseded IDs, and byte-equivalent retained content. The target becomes retired and must have no resulting active-card reference.

A target may participate in only one semantic action. Supersession must be acyclic and every newly superseded requirement must have active replacement coverage in the same candidate. A same-meaning action whose normalized content and resulting links are unchanged is a no-op and is rejected. A request containing no semantic requirement or card change is rejected.

### 9.3 Card actions and references

- `create`: one card temporary key, target `none`, complete content, and only active existing/new requirement references.
- `update`: no temporary key and one existing `backlog`, `designing`, or `design_review` target.
- `replace`: no temporary key and one existing `backlog` target; the replace action itself proposes one newly allocated reciprocal replacement card using its complete content. Existing dependants are rewired by the impact planner.

A card target appears once. Every requirement/dependency reference resolves exactly once against the authoritative snapshot or a sibling temporary key. Forward references are allowed. References to terminal or unknown cards are rejected except that existing terminal cards may remain immutable dependencies when otherwise legal. The complete resulting dependency graph must resolve and be acyclic.

For an updated pre-design card, an existing AC ID is retained only when the normalized pair `(resolved requirement ID, text)` is exactly equal and unique. New or changed pairs receive new AC IDs; removed pairs disappear only where the state-machine amendment row permits scope replacement. Child ordering cannot reassign IDs.

A card update that produces no semantic field, requirement, criterion, dependency, body, priority, or required status effect change is rejected. Model-proposed updates to grandfathered or terminal cards are rejected; the impact planner alone handles them.

## 10. Provisional ID allocation and findings

The planner previews monotonic `REQ`, `CARD`, `AC`, and `FINDING` IDs from the authoritative counters. It first proves each counter is strictly greater than every authoritative historical suffix. It fails before approval if any namespace would exceed `9999`.

Preview allocation is pure and consumes nothing. Rejection, checker failure, revision, cancellation, abort, stale approval, or transaction failure does not alter counters. Final rendering reruns allocation from an unchanged authoritative snapshot and requires byte-for-byte equality with the approved preview mapping.

The engine assigns one `FINDING-*` in checker finding order for every finding in the accepted producer/checker artifact set, including non-blocking and note findings. Durable attestations add an engine-owned `finding_ids` array parallel to `payload.findings`; children still cannot submit IDs. Roles with no findings store `finding_ids: []`. A requirements checker failure may receive provisional finding IDs for display, but they are not persisted or consumed.

## 11. Candidate rendering

### 11.1 Requirements document

A newly created spec starts exactly:

```markdown
# Product specification
```

Requirements render in ascending numeric ID order using the exact heading and metadata grammar from `spec-board-schema.md`. Existing requirements retain their IDs and relative numeric order. Unchanged requirement sections preserve semantic content; the canonical renderer normalizes section separators to one blank line and ends the file with one LF. Superseded and retired sections remain in place by ID.

Requirement body is normalized Markdown followed by exactly one `### Acceptance` subsection. Each acceptance string renders as `- <text>` in producer array order. The producer's explanatory `requirements_document` artifact never supplies authoritative document bytes.

### 11.2 Card bytes

New backlog cards have exact schema-complete metadata: active requirements, allocated AC IDs, resolved dependencies, reciprocal replacement lineage, null blocker, null timestamps except `created_at`/`updated_at`, empty later workflow fields, zero rework, and one `card_created` history entry for the transaction. The Markdown body is:

```markdown
# CARD-0001: Title

## Why

<normalized why>

## Notes

<normalized notes or empty section>
```

Changed cards receive `updated_at` and exactly one transaction history entry selected by the impact planner. Unchanged cards are not rewritten. YAML and Markdown use package canonical key order, LF endings, and one final newline.

### 11.3 Artifacts and complete candidate

Only the accepted producer run and passing checker run from the approved proposal are candidates for commit. Their parent-attested canonical YAML paths are derived from role and run ID. Artifact bytes include `finding_ids` as defined above and contain no absolute machine path or secret.

Before approval, the parent builds the complete in-memory repository candidate: spec, changed/new cards, accepted artifacts, counters, transaction metadata preview, package version, reconciliation timestamp, and canonical dashboard. It runs the same strict repository/schema/semantic validation used for a worktree. Approval is impossible if the candidate is not complete and valid.

## 12. Checker outcomes and local retention

There is no requirements rework budget and no automatic producer retry.

- Producer `blocked` or `needs_human` returns `revision_required` with bounded questions/findings and no checker run.
- Checker `fail` or `inconclusive` returns `revision_required` with complete verdicts/findings.
- Malformed output, process failure, timeout, abort, cleanup failure, or policy failure returns `failed`.
- Only producer `completed` plus checker `pass` can reach approval.

Each operation stores a machine-local, mode-`0700` operation directory under `<git-common-dir>/kanban-flow/operations/<KFOP-ID>/`; files are mode `0600`. It may retain normalized dispatch metadata, validated payloads, bounded stderr, and approval decision metadata. It never retains the interview transcript, credentials, unredacted argv, full child event stream, or machine paths in a durable artifact. Accepted, failed, revised, superseded, and cancelled attempt records are retained locally for seven days, then purged at the start of a later lock-owning operation. Purge failure is reported and blocks a new external action. Machine-local records are diagnostic only and never board authority.

Only the accepted producer/checker pair for an approved transaction is committed. Failed, inconclusive, revised, superseded, cancelled, or stale attempts never enter `docs/cards/artifacts/**`.

## 13. Requirements impact and design-PR closure

The pure impact planner implements every requirements-amendment row in `spec-state-machine.md`. Grandfathering, history kinds, dependency rewiring, replacement lineage, affected-card sets, and closure actions are derived from authoritative status, never proposed by a child.

For a `design_review` target, the checked/approved preview names the exact PR number, URL, head commit, and required `requirements-design-close` action. No GitHub mutation occurs before approval.

After approval and stale-state revalidation:

1. re-read comments and require zero or one canonical matching closure marker for the card;
2. query the PR and require the approved repository/base/head identity;
3. if merged, perform no closure and return `stale`, requiring reconciliation in a later operation;
4. if open and no marker exists, post the canonical marker before closing;
5. if open with one valid prior requirements-design-close marker, reuse it; a conflicting/duplicate marker blocks;
6. close the exact PR;
7. query it again and require closed-unmerged with the same head commit; and
8. re-fetch `origin/main` and prove the PR did not merge before state-transaction rendering.

A crash after marker or close is recovered from GitHub. A later requirements run may reuse one valid prior closure marker only after a fresh checked proposal and fresh approval names the same card/PR. A marked closed-unmerged PR does not spend design rework and is not processed by generic closed-design reconciliation; the approved requirements transaction records `requirements_scope_updated` and moves the authoritative card to `designing`. If it merged, reconciliation takes precedence and consumes an operation.

## 14. Approval document and digest

### 14.1 Canonical approval input

The parent builds a canonical JSON value with explicit version and fixed key order containing:

- authoritative repository ID and base commit;
- authoritative board semantic hash and managed-PR/action-marker snapshot;
- normalized brief hash (not the unbounded brief text);
- normalized requirement/card actions and all prospective IDs;
- dependency rewires, replacement lineage, status effects, affected cards, and grandfathering assumptions;
- closure actions with exact PR identities;
- checker verdicts, allocated finding previews, and evidence hashes;
- producer/checker agent names, source paths, hashes, provider/model/thinking identities, and policy names;
- accepted artifact destinations and SHA-256 hashes;
- exact proposed state paths and SHA-256 hashes of their preview bytes; and
- package version.

Canonical JSON is UTF-8, recursively uses the specified object key order, uses array order from normalized planning, contains no insignificant whitespace, and ends with no LF for hashing. The digest is lowercase `sha256:<64-hex>` over those exact bytes.

Display text is rendered from this value but is not itself hashed. Display truncation never removes information from the digest input. If the full report exceeds 100000 UTF-8 bytes, approval is refused as `revision_required`; the workflow does not ask approval for a partial summary.

### 14.2 Display document

The bounded Markdown document has these sections in order:

1. title and digest;
2. authoritative base;
3. requirement additions/amendments/supersessions/retirements;
4. card creates/updates/replacements and acceptance criteria;
5. dependency and lineage rewires;
6. per-card status effects;
7. grandfathered cards and retained assumptions;
8. design PRs to close;
9. checker verdicts and findings;
10. active agent overrides and model identities;
11. exact proposed paths; and
12. statement that approval opens a human-reviewed state PR but does not merge it.

Machine-local absolute paths, prompts, environment values, credentials, and unredacted argv are prohibited.

### 14.3 Decision state machine

The interaction adapter accepts only `approve`, `revise`, or `cancel` and receives the digest separately from display text.

- In TUI and RPC modes, use Pi's built-in `ctx.ui.select`, not `custom()`, because `select` has protocol support in both modes. The approve option includes the digest suffix and the prompt states that selecting it binds the full digest and base.
- `approve` is valid only when the returned option exactly equals the generated approve option for this invocation.
- `revise` returns `revision_required` and the bounded report; a later request starts fresh producer/checker runs.
- `cancel`, Escape/dismissal, timeout, missing response, abort, adapter exception, or any other value returns `cancelled` or `failed` and is not approval.
- JSON and print modes return `prepared_noninteractive` with the approval document/digest and perform no project, Git, or GitHub mutation. Schema version 1 defines no authenticated out-of-band approval token.

There is exactly one approval prompt. The parent model or skill cannot approve on the user's behalf.

### 14.4 Post-approval revalidation

After `approve`, while retaining the lock, the workflow fetches and rechecks the base commit, complete board semantic hash, counters, managed PRs/markers, active overrides and hashes, model resolutions, artifact bytes, candidate bytes, closure identities, and digest. Any difference returns `stale`; it does not silently redispatch, reapprove, close a PR, push, or open a state PR.

Approval cannot be replayed in a new operation. It is held only in memory and machine-local diagnostics; it is not a reusable token.

## 15. Mutation boundary and transaction

Before explicit approval, the workflow may create only secure machine-local lock, snapshot, prompt, dispatch, and operation-record files. It may fetch/read Git/GitHub and run children. It may not change the user checkout, board-owned paths, refs, branches, commits, remotes, PRs, or comments.

After approval and revalidation, the workflow may perform only the approved design-PR closure actions and one state transaction. It finalizes IDs from the unchanged counters, renders the byte-identical approved candidate with final operation/transaction metadata, updates the lock with the transaction ID, and invokes the normal state coordinator. The descriptor path set equals the complete diff. The coordinator never merges the PR.

If the base changes before push or PR creation, shared state-PR crash rules apply. An unpushed transaction is discarded and reported stale. A pushed branch or completed external action is recovered by exact markers; it is never overwritten or duplicated.

## 16. Heartbeat, cancellation, and shutdown

The coordinator schedules heartbeat at `lock.heartbeat_seconds` from successful lock acquisition through final report cleanup. It also performs an ownership-checking heartbeat immediately before every child spawn, approval prompt, GitHub mutation, branch creation, push, and PR creation.

A heartbeat or ownership failure aborts active children through their process group, dismisses/ignores any pending approval result, prevents new external actions, and enters cleanup. The workflow does not claim cancellation if ownership was lost; it returns `failed` with `lock_ownership_lost`.

Abort while dispatching terminates children and waits for cleanup. Abort while awaiting approval treats the decision as cancellation. Abort after an approved GitHub action or pushed branch cannot erase that action: the workflow records bounded machine-local recovery evidence, releases the lock if still owned, and returns `failed_recovery_required`. A retry starts with marker reconciliation. Shutdown uses the same path.

Release is attempted on success, no-op, revision, noninteractive preparation, cancellation, stale refusal, handled failure, abort, and shutdown. A release/cleanup failure is surfaced and prevents a success outcome.

## 17. Stable tool result contracts

`kanban_initialize` returns a strict versioned object:

```yaml
version: 1
workflow: initialize
status: proposed | already_initialized | pending | blocked | cancelled | failed
operation_id: KFOP-... | none
transaction_id: KFTX-... | none
base_commit: <object-id> | none
state_pr_url: <url> | none
repository_id: owner/repo | none
affected_cards: []
active_overrides: []
next_action: bounded text
issues: []
```

`kanban_requirements` returns:

```yaml
version: 1
workflow: requirements
status: proposed | pending | reconciliation_proposed | revision_required | prepared_noninteractive | stale | blocked | cancelled | failed | failed_recovery_required
operation_id: KFOP-... | none
transaction_id: KFTX-... | none
base_commit: <object-id> | none
state_pr_url: <url> | none
approval_digest: sha256:... | none
affected_cards: [CARD-...]
grandfathered_cards: [CARD-...]
active_overrides:
  - name: requirements-checker
    path: .pi/agents/requirements-checker.md
    sha256: ...
models:
  - agent: requirements-checker
    provider: ...
    model: ...
    thinking: ...
next_action: bounded text
issues: []
```

Every object and issue record rejects unknown fields. IDs/URLs absent for an outcome use the string sentinel `none`, not omitted or null. Arrays are deterministic. `issues` contains bounded exact `{code,message}` records and never secrets or absolute machine paths.

The user-visible report states that an open state PR is pending human review and that no proposed content is authoritative until merge. It never claims design or implementation began.

## 18. Prohibited behavior

Stage 3 does not:

- merge a state, design, or product PR;
- create requirements and initialization in one PR;
- retry a producer automatically after requirements check failure;
- accept noninteractive approval, `--approve`, a skill statement, or model inference;
- persist interview transcripts;
- permit child-selected IDs, paths, histories, grandfathering, commands, branches, commits, or PR actions;
- modify `reference/`;
- run design, split, implementation, review, ship, migration, or pump scheduling; or
- continue after a state PR is proposed.
