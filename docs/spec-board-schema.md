# Board, card, requirements, and config schema specification

## Purpose

Define the durable human-readable format owned by the TypeScript engine. All reads and writes pass through strict schemas. Schema version 1 defines no extension container: every unknown field is rejected. A later schema may add an explicit namespaced `extensions` object, but prefixes alone never make an unknown field valid.

## Storage layout

The first release uses fixed paths:

```text
docs/
├── spec.md                         # requirements
├── designs/
│   └── CARD-0001.md                # approved design, delivered by design PR
├── adr/                            # reserved for deferred Stage 5 ADR support
└── cards/
    ├── board.yaml                  # identity, ID allocation, merged history
    ├── config.yaml                 # operational policy
    ├── BOARD.md                    # canonical derived dashboard
    ├── PROTOCOL-ADDENDUM.md        # optional trusted project guidance
    ├── CARD-0001.md                # one durable card record per file
    └── artifacts/
        └── CARD-0001/              # typed result/evidence records
```

`docs/cards/**` and `docs/spec.md` are board-owned and change only through state PRs. `docs/cards/BOARD.md` is derived output, never an independent source of state. In the first iteration, `docs/designs/**` changes through design PRs; `docs/adr/**` remains reserved until Stage 5 defines ADR persistence. Product PRs must not alter board-owned or design-owned paths.

## Board metadata

`docs/cards/board.yaml`:

```yaml
harness: pi
board_schema_version: 1
last_writer_package_version: 0.0.0-dev
project:
  repository_id: owner/repo
ids:
  next_requirement: 1
  next_card: 1
  next_acceptance_criterion: 1
  next_finding: 1
state:
  last_reconciled_at: 2026-01-15T10:30:00Z
  last_state_transaction:
    id: KFTX-000001
    operation_id: KFOP-000001
    planned_at: 2026-01-15T10:30:00Z
    base_commit: 0123456789abcdef0123456789abcdef01234567
    card_ids: []
    paths:
      - docs/cards/BOARD.md
      - docs/cards/board.yaml
      - docs/cards/config.yaml
migration: null
```

Rules:

- `harness` must equal `pi`.
- `board_schema_version` advances independently of package semver.
- `last_writer_package_version` records the package that produced the most recent merged state transaction; package upgrades alone do not mutate the board.
- `project.repository_id` is immutable repository identity, not operational Git configuration.
- ID counters are monotonic and never reused.
- `last_state_transaction` is the pre-commit descriptor of the transaction that wrote the current authoritative snapshot. It is null only while constructing an in-memory initialization candidate; initialization sets it before commit. It becomes authoritative only when that state PR merges. Pending state is discovered from GitHub PR markers.
- `migration` is either null for Pi-initialized boards or a validated immutable source/migration record defined in `spec-one-way-migration.md`.
- `last_reconciled_at` may be null only while constructing an in-memory initialization candidate; initialization sets it before commit. Every later state transaction records the time its required Git/GitHub reconciliation completed; idle reconciliation alone does not mutate it or open a timestamp-only PR.

### Exact board field constraints

All objects use `additionalProperties: false`. String limits below count Unicode code points after YAML parsing. Strings reject NUL and unpaired surrogate characters.

| Field | Exact constraint |
|---|---|
| `harness` | constant `pi` |
| `board_schema_version` | constant integer `1` for this schema |
| `last_writer_package_version` | non-empty semver string, including valid prerelease/build suffixes |
| `project.repository_id` | lowercase GitHub `owner/name`, each component 1–100 characters from `[a-z0-9._-]`, no leading/trailing dot |
| each `ids.next_*` | integer `1..9999`; strictly greater than every numeric suffix already used in that namespace; exhaustion fails closed and requires a later schema version |
| `state.last_reconciled_at` | UTC RFC 3339 timestamp; `null` only in a pre-commit initialization candidate |
| `state.last_state_transaction` | authoritative transaction descriptor below; `null` only in a pre-commit initialization candidate |
| `migration` | immutable migration record from `spec-one-way-migration.md` or `null` |

An authoritative transaction descriptor has exactly `id`, `operation_id`, `planned_at`, `base_commit`, `card_ids`, and `paths`. All values are known before the state commit is created: IDs use their namespace patterns; `planned_at` is UTC RFC 3339; `base_commit` is the fresh authoritative `origin/main` object ID used for planning; `card_ids` is a unique ascending array and may be empty for a requirements/config-only transaction; and `paths` is a unique lexically ascending non-empty array containing the complete planned state-owned diff, including `docs/cards/board.yaml` and canonical `BOARD.md` when changed.

The descriptor intentionally contains no state commit hash, PR number/URL, or merge timestamp because those do not exist when its content is committed. Once the state PR merges, its commit is found by the matching transaction trailer and its PR/merge evidence by the matching marker. A descriptor read from an unmerged branch is never authoritative.

## Project config

`docs/cards/config.yaml` is authoritative for operational behavior:

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

First-release constraints:

- `forge` must be `github`.
- `remote` must be `origin` and `base_branch` must be `main`.
- `state_prs.merge_policy` accepts only `human`. Automated policies require a later schema version/specification.
- `gh_command` is an executable path/name, not an arbitrary shell fragment. Arguments are passed without a shell.
- `project_commands` maps fixed names to non-empty executable/argv arrays. Child models may select a configured name but may not supply shell text or arbitrary arguments.
- `wip_limit` is at least 1. In-flight statuses are `designing`, `design_review`, `ready_for_implementation`, `implementing`, `implementation_review`, `ready_to_ship`, and `shipping`.
- Lower numeric priority is selected first when `priority_order` is `ascending`.

### Exact config constraints

All config objects use `additionalProperties: false`.

| Field | Exact constraint |
|---|---|
| `repository.forge` | constant `github` |
| `repository.gh_command` | non-empty executable name or absolute path, maximum 4096 code points; no NUL/newline; never parsed as shell text |
| `repository.remote` | constant `origin` |
| `repository.base_branch` | constant `main` |
| `state_prs.merge_policy` | constant `human` |
| `lock.ttl_seconds` | integer `60..86400` |
| `lock.heartbeat_seconds` | integer `5..300` and strictly less than one third of `ttl_seconds` |
| `scheduler.wip_limit` | integer `1..32` |
| `scheduler.priority_order` | constant `ascending` in schema version 1 |
| `rework.design_limit` | integer `0..10`; number of automatic producer reworks permitted |
| `rework.implementation_limit` | integer `0..10`; number of automatic producer reworks permitted |
| `review.lenses` | non-empty unique array in execution order, containing only `acceptance`, `functionality`, `tests`, `readability`, `security`, or `simplicity` |
| `review.max_parallel` | integer `1..16` |
| `project_commands` | object with keys only `test`, `lint`, `typecheck`, `build`; `test` is required, others optional |
| each project command | non-empty argv array of 1–64 strings; each string maximum 4096 code points and contains no NUL/newline; element zero is the executable |
| `agent_models.default` | constant `inherit` |
| `agent_models.overrides` | map keyed only by the fixed agent names in `spec-project-overrides-config.md`; unknown keys rejected |
| model selector | `provider/model` with an optional recognized final thinking suffix from `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; provider and model are non-empty and contain no whitespace/control characters. A `:` not forming one of those final suffixes remains part of the model identifier. |
| `agents.allow_project_overrides` | boolean |
| `agents.report_overrides` | constant `true`; active overrides are always reported even when project overrides are disabled |
| `resources.broad_policy_allowed_skills` | unique lexically sorted array of at most 32 repository-relative skill-directory paths; no absolute path, empty segment, `.`/`..`, backslash, or symlink escape |

A rework limit is the maximum number of automatic producer re-dispatches. When the current counter is less than the limit, the requesting transaction increments it once and reworks. When it equals the limit, the engine sets a blocker without incrementing it. A limit of zero disables automatic rework for that phase.

## Card schema

Each `docs/cards/CARD-0001.md` has strict YAML frontmatter and human-readable body:

```markdown
---
id: CARD-0001
title: Example card
status: backlog
requirements: [REQ-0001]
grandfathered_requirements: []
acceptance_criteria:
  - id: AC-0001
    text: Observable outcome
    requirement: REQ-0001
dependencies: []
replaces: []
replaced_by: []
replacement_reason: null
priority: 100
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-01-01T00:00:00Z
started_at: null
delivered_at: null
blocked: null
workflow:
  design:
    branch: null
    pr: null
    producer_result_paths: []
    checker_result_paths: []
    approved_commit: null
  split_decision:
    result_path: null
    decided_at: null
    override: null
  implementation:
    branch: null
    result_paths: []
    head_commit: null
  review:
    result_paths: []
    reviewed_commit: null
    completed_at: null
  ship:
    product_pr: null
    verification_result_paths: []
    merged_commit: null
rework:
  design: 0
  implementation: 0
history: []
---

# CARD-0001: Example card

## Why

...

## Notes

...
```

### Nested records

A blocker is a flag, not a status:

```yaml
blocked:
  reason: Human-readable reason
  source_phase: implementation_review
  resume_status: implementing
  created_at: 2026-01-01T00:00:00Z
  evidence: []
```

Only the engine sets/clears it. `resume_status` must be a legal transition target for the current durable status and phase. Clearing requires explicit resolution recorded in history.

A PR link is a structured record:

```yaml
number: 123
url: https://github.com/owner/repo/pull/123
head: kanban/card/CARD-0001-example-card
base: main
state: open                       # open | merged | closed
operation_id: KFOP-...
head_commit: 0123456789abcdef0123456789abcdef01234567
merge_commit: null
last_checked_at: 2026-01-01T00:00:00Z
```

A history entry is:

```yaml
id: KFH-<timestamp>-<short-random>
at: 2026-01-01T00:00:00Z
kind: design_pr_opened
from_status: backlog
to_status: design_review
operation_id: KFOP-...
transaction_id: KFTX-...
summary: Design PR opened
```

Optional values are explicit `null`; absent required keys fail validation. All timestamps are UTC RFC 3339 strings named `*_at`.

### Exact card field constraints

All frontmatter and nested objects use `additionalProperties: false`.

| Field | Exact constraint |
|---|---|
| `id` | `CARD-` plus exactly four digits in schema version 1; numeric part `0001..9999`; must match filename |
| `title` | trimmed single line, 1–200 code points |
| `status` | one durable status listed below |
| `requirements` | non-empty, unique, ascending array of requirement IDs |
| `grandfathered_requirements` | unique ascending subset of `requirements`; normally empty; exact exception below |
| `acceptance_criteria` | non-empty array of exact `{id,text,requirement}` objects, ordered by AC ID |
| acceptance text | trimmed, single line, 1–1000 code points |
| acceptance requirement | requirement present in the card's `requirements`; active except on terminal historical or explicitly grandfathered cards |
| `dependencies` | unique ascending card IDs; no self-reference; every target exists |
| `replaces`, `replaced_by` | unique ascending card IDs; no self-reference; lineage is reciprocal |
| `replacement_reason` | one of `null`, `requirements_change`, or `split_decision`; non-null exactly when status is `replaced` |
| `priority` | integer `0..1000000`; lower values schedule first |
| `created_at`, `updated_at` | UTC RFC 3339; `updated_at >= created_at` |
| `started_at`, `delivered_at` | UTC RFC 3339 or `null`; chronological when present |
| `blocked` | exact blocker record or `null` |
| workflow result paths | unique arrays in execution order of canonical artifact paths for this card |
| `rework.design`, `rework.implementation` | integers `0..10`, each no greater than its configured limit |
| `history` | chronological array of exact history records; IDs unique globally |

Commit fields are `null` or lowercase 40-/64-character hexadecimal Git object IDs. Branches are `null` or canonical package-owned names: `kanban/design/<CARD-ID>-<slug>` for design and `kanban/card/<CARD-ID>-<slug>` for product, where the lowercase slug is 1–48 characters from `[a-z0-9-]` with no leading, trailing, or repeated hyphen.

A split override is null except for the grandfathered exception below. When present it has exactly `decision`, `reason`, `decided_at`, and `operation_id`; decision is constant `proceed_unsplit`, reason is a trimmed 1–2000-code-point human statement, and timestamp/operation ID follow their standard formats.

A PR record has exactly `number`, `url`, `head`, `base`, `state`, `operation_id`, `head_commit`, `merge_commit`, and `last_checked_at`. `number` is a positive integer; URL repository and number must match board identity and `number`; `base` is `main`; `head` matches the owning workflow branch; `state` is `open|merged|closed`. `head_commit` is always present. `merge_commit` is non-null exactly when state is `merged`. A closed-unmerged record has `merge_commit: null`.

A blocker has exactly `reason`, `source_phase`, `resume_status`, `created_at`, and `evidence`. `reason` is a trimmed 1–2000-code-point string. `source_phase` and `resume_status` are durable statuses; their permitted pairs are defined below. `evidence` is a unique array of at most 32 canonical artifact paths. Deterministic Git/GitHub/command evidence that must survive a boundary is first stored as a parent-probe artifact. Evidence may be empty only for an explicitly recorded human blocker.

A history record has exactly `id`, `at`, `kind`, `from_status`, `to_status`, `operation_id`, `transaction_id`, and `summary`. `from_status` is nullable only for `card_created`; `to_status` is always a durable status. `summary` is one trimmed line of 1–500 code points. `kind` is one of: `card_created`, `requirements_grandfathered`, `requirements_scope_updated`, `design_started`, `design_rework_requested`, `design_pr_opened`, `design_pr_merged`, `design_pr_closed`, `split_not_required`, `split_override_approved`, `card_replaced`, `implementation_started`, `implementation_completed`, `implementation_rework_requested`, `review_completed`, `product_pr_opened`, `product_pr_reconciled`, `product_pr_merged`, `product_pr_closed`, `card_blocked`, `blocker_resolved`, or `deterministic_correction`.

The Markdown body must begin exactly `# <CARD-ID>: <title>`, followed by `## Why` and `## Notes` exactly once and in that order. Both sections may contain Markdown, but malformed frontmatter delimiters, another level-one heading, or another `## Why`/`## Notes` heading fail validation. The engine preserves normalized body content unless a typed transaction changes it.

### Local worktree resources

Worktree paths are not durable card fields. They are machine-local execution resources and must not be committed to board state.

The engine derives the expected deterministic worktree identity from repository identity, PR class, card ID, and branch. Before use it resolves actual worktrees with `git worktree list --porcelain`, validates the branch and common Git directory, and either reuses exactly one valid match or creates one. No match permits creation; multiple matches, a mismatched branch, an unexpected repository, or a dirty worktree fails closed. Machine-local operation records may be stored under `<git-common-dir>/kanban-flow/`, outside board state.

Branch, commit, operation marker, and PR evidence—not a cached filesystem path—are the durable recovery identity. Removing or relocating a checkout therefore does not require a board transaction.

## Durable statuses

- `backlog`
- `designing`
- `design_review`
- `ready_for_implementation`
- `implementing`
- `implementation_review`
- `ready_to_ship`
- `shipping`
- `done`
- `replaced`

Running agents are transient operations, not statuses. `done` and `replaced` are terminal. A blocked card retains its status and has non-null `blocked`.

### Complete status invariants

The following table is cross-field validation in addition to the field schemas. “Design approved” means a merged design PR, non-null `approved_commit` equal to that PR's final `head_commit`, and at least one passing checker artifact for that commit. “Implementation complete” means non-empty implementation results and non-null `head_commit`. “Review complete” means non-empty probe/reviewer results, `reviewed_commit == implementation.head_commit`, and non-null `completed_at`.

| Status | Required and prohibited metadata |
|---|---|
| `backlog` | `started_at`, `delivered_at`, and all workflow branch/result/commit/PR/timestamp fields are null or empty. `replaced_by` is empty. A replacement backlog card may have non-empty `replaces`. |
| `designing` | `started_at` and design branch present; at least one producer and checker artifact; design PR is null or closed-unmerged; approved commit null; all later workflow metadata empty/null. |
| `design_review` | `started_at`, design branch, passing checker artifact, and open design PR present; approved commit null; all later workflow metadata empty/null. |
| `ready_for_implementation` | design approved; implementation/review/ship metadata empty/null. Split-decision metadata is empty before assessment; it may contain a valid `needs_human` result, or a grandfathered `split_required` result while blocked/awaiting or after recording `proceed_unsplit`. |
| `implementing` | design approved; split result is validated `no_split`, or is `split_required` with a valid grandfathered `proceed_unsplit` override; `decided_at` and product branch are present. Implementation results/head may be empty/null for fresh work or present for rework. Review metadata is cleared for the commit being reworked. Product PR is normally null but may remain open only after a recorded `shipping → implementing` rework transition. |
| `implementation_review` | design approved, validated `no_split`, product branch, and implementation complete. Review metadata is empty/null before review or may contain prior superseded review artifacts; any `reviewed_commit` must equal the current implementation head. An open product PR is permitted only on a recorded shipping-rework path. |
| `ready_to_ship` | design approved, accepted split outcome/override, implementation complete, and review complete. Product PR is normally null, but may be the uniquely marked open PR created during the current failed/incomplete ship attempt or retained during shipping rework. When present its branch is unchanged and its head must equal the reviewed commit before entering `shipping`. |
| `shipping` | all `ready_to_ship` invariants plus a marked open product PR and non-empty verification artifacts. PR `head_commit` equals `reviewed_commit`. `merged_commit` and `delivered_at` are null. |
| `done` | all completed design/implementation/review metadata retained; product PR is merged; `merged_commit` equals its `merge_commit`; `delivered_at` is non-null and not earlier than review completion. No blocker. |
| `replaced` | `replaced_by` is non-empty; implementation/review/ship metadata is empty/null; no open PR; `delivered_at` null; no blocker; lineage is reciprocal. With `replacement_reason: split_decision`, design is approved and the split result is validated `split_required`. With `replacement_reason: requirements_change`, the source status was `backlog`, design/split/later workflow metadata is empty/null, and the requirements transaction supplies active replacement coverage. |

`done` and `replaced` must have `blocked: null`. Every other status may be blocked only with one of these `(source_phase, resume_status)` pairs:

| Current status | Allowed source phase | Allowed resume status |
|---|---|---|
| `backlog` | `backlog` | `backlog` |
| `designing` | `designing` | `designing` |
| `design_review` | `design_review` | `design_review` or `designing` |
| `ready_for_implementation` | `ready_for_implementation` | `ready_for_implementation` |
| `implementing` | `implementing` | `implementing` |
| `implementation_review` | `implementation_review` | `implementation_review` or `implementing` |
| `ready_to_ship` | `ready_to_ship` | `ready_to_ship` or `implementing` |
| `shipping` | `shipping` | `shipping` or `implementing` |

An explicit blocker-resolution state transaction clears `blocked` and sets status to exactly `resume_status`, which may equal the current status. It performs no other workflow transition and ends the pump. Resolution may authorize a human-directed rework after an automatic budget is exhausted, but it does not decrement or reset the counter. All target-status invariants must already hold or be established by the resolution's typed human input; otherwise resolution is refused.

### Grandfathered requirement references

A nonterminal card may reference a superseded requirement only when all of these hold:

- its status was `ready_for_implementation`, `implementing`, `implementation_review`, `ready_to_ship`, or `shipping` in the authoritative snapshot where the requirement was superseded;
- the superseded ID is present in both `requirements` and `grandfathered_requirements`;
- the same requirements transaction appends a `requirements_grandfathered` history event;
- the original requirement text and the card's acceptance criteria are retained unchanged;
- the approved design commit remains the card's execution contract;
- the approved requirements proposal creates or identifies backlog coverage for the active replacement requirement and adds a dependency on the grandfathered card wherever the follow-up modifies or relies on its delivered behavior.

Grandfathering never happens implicitly and is not available to `backlog`, `designing`, or `design_review`. Cards in those statuses are updated or replaced to reference active requirements. A `design_review` PR is closed by an idempotently marked parent action, then the card returns to `designing` without spending design rework; its old artifacts remain historical and the next producer must replace the stale design content. If GitHub proves the design PR merged before amendment planning, reconciliation takes precedence and the resulting `ready_for_implementation` card is eligible for grandfathering on a later requirements transaction.

A grandfathered card completes normally under its retained criteria/design. Its `grandfathered_requirements` remain as audit metadata after `done`.

The mandatory split decision still runs. A `no_split` result proceeds normally. A `split_required` result cannot create backlog children under superseded requirements: the engine stores the result, sets a blocker, and asks whether to finish the approved card unsplit. Explicit approval records the split override above during blocker resolution; the next pump may create the product branch and proceed. Refusal leaves the card blocked for audited cancellation/manual handling. The engine never converts or rewrites the agent's original split verdict. Every pump and the canonical dashboard identify nonterminal grandfathered cards prominently. Explicit audited cancellation/replacement remains available as a separate human action for safety-critical changes; it is never inferred from the amendment.

The repository rejects a card whose required metadata is absent or whose PR/commit relationships conflict.

## Project protocol addendum

`docs/cards/PROTOCOL-ADDENDUM.md` is optional trusted project guidance, not schema/config state and not an agent override. When present it is board-owned and changes only through an explicitly reviewed state PR. It is valid UTF-8 Markdown of at most 100000 bytes, has no frontmatter, begins with exactly `# Kanban protocol addendum`, uses LF endings, and is a regular non-symlink file. It may add project conventions and doctrine but cannot alter schemas, legal transitions, path/resource policies, required checker criteria, or engine authority; conflicting instructions are ignored and reported. Role policy decides whether all or selected sections are injected, and attestation hashes the normalized bytes. Migration may preserve a compatible legacy addendum after validating these constraints.

## Requirements format

`docs/spec.md` stores requirements as parseable Markdown sections:

```markdown
# Product specification

## REQ-0001 — User can create a board

Status: active
Supersedes: none

Observable requirement text.

### Acceptance

- The user can initialize board files.
```

Rules:

- the first non-empty line is one level-one product title; no other level-one heading is allowed;
- heading syntax is exactly `## REQ-0001 — Title`;
- the first two non-empty body lines are `Status: active|superseded|retired` and `Supersedes: none|REQ-...[, REQ-...]`;
- IDs are allocated only by the engine and never renamed/reused;
- amendment retains an ID only when its meaning remains the same;
- changed meaning creates a new requirement and marks prior requirements `superseded`;
- every superseded requirement is referenced by at least one active replacement unless explicitly `retired`;
- cards may reference only active requirements, except terminal historical cards and explicitly grandfathered cards satisfying the complete rule above.

Requirement IDs use exactly four digits from `0001..9999`; headings are unique and ordered by numeric ID. Titles are trimmed single lines of 1–200 code points. Each requirement has non-empty prose between its metadata lines and `### Acceptance`, and exactly one `### Acceptance` subsection containing at least one non-empty Markdown bullet. Other level-three subsections may follow acceptance but may not imitate machine metadata.

`Supersedes` is `none` or a comma-and-space-separated ascending unique list of older requirement IDs. An active requirement may supersede active or superseded historical requirements in the same transaction; those targets become `superseded`. A superseded requirement is referenced by at least one active requirement's `Supersedes` list. A retired requirement has `Supersedes: none` and is not referenced by an active card. Supersession cycles and self-reference are invalid.

## Identifier namespaces

- requirements: `REQ-0001`
- cards: `CARD-0001`
- acceptance criteria: `AC-0001`
- package checker criteria: stable semantic keys such as `DESIGN-COVERAGE`
- dispatch/result runs: `KFRUN-<timestamp>-<short-random>`
- findings: `FINDING-0001`
- operations: `KFOP-<timestamp>-<short-random>`
- state transactions: `KFTX-<timestamp>-<short-random>`
- history events: `KFH-<timestamp>-<short-random>`

Execution run IDs and semantic checker criterion keys are not allocated from board counters. Legacy IDs are preserved in migration metadata when they cannot map without changing meaning.

REQ, CARD, AC, and FINDING IDs use four decimal digits from `0001..9999`. Runtime/audit IDs use a compact UTC timestamp and random suffix:

```text
KFRUN-YYYYMMDDTHHMMSSmmmZ-rrrrrrrr
KFOP-YYYYMMDDTHHMMSSmmmZ-rrrrrrrr
KFTX-YYYYMMDDTHHMMSSmmmZ-rrrrrrrr
KFH-YYYYMMDDTHHMMSSmmmZ-rrrrrrrr
```

`rrrrrrrr` is eight lowercase unambiguous base32 characters from `[0-9a-hjkmnp-tv-z]`, generated with a cryptographically secure random source. IDs are validated case-sensitively. Collision causes regeneration before external action; an existing durable collision fails closed.

## Artifact records

Validated child results are stored as deterministic YAML under `docs/cards/artifacts/<CARD-ID>/`, named `<artifact-kind>-<run-id>.yaml`. Allowed artifact kinds are `design-producer`, `design-check`, `split-decision`, `implementation-producer`, `review-<lens>`, `ship-producer`, `ship-check`, `probe-project-commands`, `probe-ci-status`, `probe-pr-state`, and `probe-diff-policy`. Requirements-level artifacts not tied to one existing card use `docs/cards/artifacts/requirements/<artifact-kind>-<run-id>.yaml`, where kind is `requirements-producer` or `requirements-check`.

Every path is repository-relative in metadata, uses `/`, and must byte-for-byte equal the destination derived from payload role/phase/lens/probe and attested run ID. Symlinks are prohibited anywhere under `docs/cards/artifacts`. The file contains the child payload plus parent attestation defined in `spec-structured-results.md`; parent probes use its specified parent form. The parent receives JSON events but renders canonical human-readable YAML with stable key order, LF endings, and one final newline. Model-proposed paths never authorize writes; the engine chooses every destination.

## Stage 3 initialization and requirements artifacts

`spec-requirements-workflow.md` defines the schema-version-1 initialization defaults and rendering semantics. Initialization is a separate LLM-free state transaction that creates exactly `board.yaml`, `config.yaml`, and the canonical empty `BOARD.md`; it does not create `docs/spec.md` or cards.

For durable child attestations, the parent adds required `finding_ids` immediately before `payload`. It is an ordered array parallel to `payload.findings`; the engine allocates each ID and roles with no findings store `[]`. Public child payloads still prohibit finding IDs. Repository validation requires the counter to exceed every ID in these mappings.

## Version policy

Package releases use semver independently from board schema:

- package patches/minors may read and write the same board schema without board migration;
- a package must declare the exact schema versions it can read, write, and migrate;
- `board_schema_version` is a positive integer increased only for durable-format or semantic incompatibility;
- schema migration is explicit, one-way per migration step, idempotent, and proposed through a human-reviewed state PR;
- a package may read an older supported schema for diagnostics but must not mutate it until migrated;
- unknown newer schemas fail closed;
- `last_writer_package_version` is audit metadata, not schema compatibility.

## Canonical board rendering

Every state transaction that changes authoritative board state regenerates `docs/cards/BOARD.md`. The file begins with:

```markdown
# Kanban board

> Generated by pi-kanban-flow from validated card records. Do not edit manually.
```

It then renders, in this fixed order:

1. `## Blocked`
2. `## Backlog`
3. `## Designing`
4. `## Design review`
5. `## Ready for implementation`
6. `## Implementing`
7. `## Implementation review`
8. `## Ready to ship`
9. `## Shipping`
10. `## Done`
11. `## Replaced`

Every section is present, including empty sections. A blocked card appears only under `## Blocked`, not also under its lifecycle-status section, and its bullet appends ` · status: <status>` before the blocker suffix. Unblocked cards appear under their status section. Cards are ordered by configured priority and then card ID, except that rendering never changes scheduling semantics. The exact bullet format is:

```markdown
- [CARD-0001](./CARD-0001.md) — Example card · priority 100 · requirements REQ-0001 · dependencies none
```

After the base bullet, append ` · grandfathered: <REQ IDs>` when the list is non-empty and ` · split override: proceed unsplit` when that override exists. Then append exactly one applicable state suffix: ` · blocked: <escaped reason>`, ` · design PR: <url>`, or ` · product PR: <url>`, in that precedence order. Multiple requirements/dependencies are comma-and-space separated. Values are escaped as plain inline Markdown and may not introduce headings or raw HTML.

The dashboard contains no wall-clock render timestamp or independently editable metadata. A byte-for-byte mismatch from canonical rendering is board drift: diagnostics report it, and a mutating transaction replaces it with canonical output. The repository validates the regenerated file before commit. LF line endings and one final newline are mandatory.

## Validation and rendering

The repository layer must reject:

- duplicate/malformed IDs;
- missing or invalid references;
- dependency cycles;
- illegal status/artifact/blocker combinations;
- paths escaping owned roots;
- dirty or partially written board files before transaction start;
- timestamps not in UTC RFC 3339;
- counters that would reuse an existing ID.

Rendering uses stable key ordering, stable card ordering, LF line endings, and no timestamp change unless durable state changed. The engine produces and validates a complete planned diff before commit.
