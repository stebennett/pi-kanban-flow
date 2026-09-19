# Role-specific structured result specification

## Purpose

Receive typed child outputs without parsing prose and without trusting children to attest their own execution environment.

## Tools

Use separate terminating tools with provider-compatible schemas:

- `submit_producer_result`
- `submit_checker_result`
- `submit_reviewer_result`
- `submit_split_decision`
- `submit_probe_result`

Tool enums use Pi-compatible `StringEnum`; do not expose `Type.Union`/`Type.Literal` discriminated unions that break supported providers. TypeBox validates each public tool schema and engine code performs cross-field validation.

## Common public-schema rules

Every public result object and nested object uses `additionalProperties: false`. Every role payload begins with required `schema_version: 1`, `dispatch_id`, and `card_id`. Dispatch ID must equal the expected `KFRUN-*` identity injected by the parent; card ID must equal the dispatched card or the string sentinel `none` for requirements-level work. Required keys are always present. Public tool payloads avoid nullable unions: role-inapplicable collections use empty arrays and role-inapplicable scalar references use the documented string sentinel `none`. Text is trimmed, rejects NUL/unpaired surrogates, and has these limits: summary/title/question/location/reference 1–500 code points; detail/rationale/suggested fix 1–4000; artifact content 1–200000; arrays at most 128 entries unless a smaller bound is stated.

An evidence item has exactly:

```yaml
kind: file                         # file | supplied_probe | command | git | github
reference: docs/example.ts:10-20
summary: What this evidence establishes
```

`reference` is descriptive evidence, never write authority. Strict children may use `command`, `git`, or `github` only for bounded evidence already supplied by the parent; they cannot execute those operations. Every finding has exactly:

```yaml
criterion: DESIGN-COVERAGE         # semantic criterion key or `none`
severity: blocking                 # blocking | non_blocking | note
location: docs/example.ts:10       # non-empty input/artifact location
summary: Missing acceptance path
detail: Why this is a problem
suggested_fix: Add the omitted task # non-empty text or `none`
evidence:
  - kind: file
    reference: design.md:10-20
    summary: Criterion has no mapped task
```

Children do not return a finding ID; the engine allocates durable finding IDs. A blocking or non-blocking finding requires at least one evidence item. Locations identify supplied input/artifact positions and need not be filesystem paths.

A question has exactly `question`, `why_needed`, and `evidence`; evidence may be empty. Artifact records have exactly `type` and `content`. Public enums use `StringEnum`; regex, length, object, and array constraints use provider-compatible TypeBox constructs, while the engine enforces relationships between fields.

## Child payloads

### Producer

```yaml
schema_version: 1
dispatch_id: KFRUN-...
card_id: CARD-0001
phase: design
status: completed                 # completed | blocked | needs_human
summary: ...
artifacts:
  - type: design_document
    content: ...
findings: []
questions: []
evidence: []
requirement_changes: []
card_changes: []
planned_paths: []
```

Every producer payload includes `requirement_changes`, `card_changes`, and `planned_paths`; non-requirements phases return both change arrays empty. A planned path has exactly `path` and `action`, where action is `create|modify|delete`; paths are unique, repository-relative, normalized with `/`, and obey product path exclusions. A requirement change has exactly `temporary_key`, `action`, `target_requirement`, `title`, `body`, `acceptance`, and `supersedes`:

- `temporary_key` uses the sibling-key pattern and identifies a newly created requirement, or is `none` for an existing target;
- `action` is `create|amend_same_meaning|supersede|retire`;
- `target_requirement` is `none` for create/supersede replacement content, otherwise an existing requirement ID;
- title/body and acceptance are non-empty replacement content for create/amend/supersede; title is a bounded single line, body is 1–200000 code points of Markdown, and acceptance is an array of 1–128 unique bounded strings; retire returns the retained current content unchanged;
- `supersedes` contains existing IDs only for a superseding replacement and is otherwise empty.

A card change has exactly `temporary_key`, `action`, `target_card`, `title`, `why`, `notes`, `requirements`, `acceptance_criteria`, `dependencies`, and `priority`. Action is `create|update|replace`; target is `none` for create, an existing `backlog|designing|design_review` card for update, and an existing `backlog` card for replace. For create, `temporary_key` uses the sibling-key pattern; for update/replace it is `none`. `why` is non-empty Markdown of at most 10000 code points and `notes` is Markdown of at most 10000 code points, possibly empty. Requirements/dependencies may reference existing IDs or temporary keys from the same payload. Acceptance proposals have exact `text` and `requirement` fields and no IDs. Grandfathering is never proposed by the child: after approval the engine derives it mechanically from authoritative card status and the accepted requirement changes. The engine allocates all IDs and validates coverage, lineage, active references, and DAG preservation before presenting approval.

`phase` is `requirements|design|implementation|ship`. Artifact type is one of `requirements_document`, `card_proposal_set`, `design_document`, `implementation_summary`, or `product_pr_body`, and must be permitted by the dispatched phase. All `completed` producer results require no questions. For requirements, `completed` additionally requires at least one requirement or card change and may include a `requirements_document` artifact; a `card_proposal_set` artifact is explanatory only and never parsed as authority. For design, `completed` also requires a non-empty `planned_paths` allowlist matching the file-level tasks in the design document. Requirements, implementation, and ship return `planned_paths: []`. For other phases, `completed` requires at least one expected artifact; `needs_human` requires at least one question; `blocked` requires at least one blocking finding or evidence item. A producer cannot claim authoritative paths, commits, branches, or PRs in its payload.

### Checker

```yaml
schema_version: 1
dispatch_id: KFRUN-...
card_id: CARD-0001
phase: design
status: pass                      # pass | fail | inconclusive
summary: ...
criteria:
  - key: DESIGN-COVERAGE
    verdict: fail                 # pass | fail | inconclusive
    evidence:
      - kind: file
        reference: design.md:20
        summary: AC-2 has no mapped task
findings:
  - criterion: DESIGN-COVERAGE
    severity: blocking            # blocking | non_blocking | note
    location: design.md:20
    summary: Missing acceptance path
    detail: AC-2 has no implementation task
    suggested_fix: Add a task and test for AC-2
    evidence:
      - kind: file
        reference: design.md:20
        summary: Task map omits AC-2
evidence: []
```

`phase` is `requirements|design|ship`; requirements dispatches require `card_id: none`, while design and ship dispatches require the exact dispatched `CARD-*` ID. `status` is derived from criteria: `pass` only when every verdict passes, `fail` when at least one fails, and `inconclusive` otherwise. Every dispatched criterion key appears exactly once, no undispatched key appears, and each criterion has exactly `key`, `verdict`, and a non-empty evidence array. Every failing criterion has at least one blocking finding naming that criterion. A pass result has no blocking findings. The engine allocates durable `FINDING-*` IDs; the child does not.

### Reviewer

```yaml
schema_version: 1
dispatch_id: KFRUN-...
card_id: CARD-0001
phase: implementation_review
lens: security
status: pass                      # pass | changes_requested | inconclusive
summary: ...
findings: []
evidence: []
rerun_recommended: false
```

`phase` is constant `implementation_review`; `lens` must equal the dispatched configured lens. `changes_requested` requires a blocking finding; `pass` prohibits blocking findings; `inconclusive` requires evidence explaining why no verdict was possible. `rerun_recommended` is advisory and never authorizes a rerun or transition.

### Split decision

```yaml
schema_version: 1
dispatch_id: KFRUN-...
card_id: CARD-0001
status: no_split                  # no_split | split_required | needs_human
rationale: ...
replacement_cards: []
evidence: []
```

A replacement proposal has exactly `temporary_key`, `title`, `why`, `notes`, `requirements`, `acceptance_criteria`, `dependencies`, and `priority`. `temporary_key` matches `[a-z][a-z0-9-]{0,31}` and is unique within the result. `why` is non-empty Markdown of at most 10000 code points and `notes` is bounded Markdown, possibly empty. Requirements are unique active IDs. Each acceptance proposal has exactly `text` and `requirement`; it contains no ID. Dependencies are unique existing card IDs or sibling temporary keys. Priority is an integer `0..1000000`. The engine allocates CARD/AC IDs and validates complete scope, lineage, and dependency preservation.

`no_split` requires no replacements. `split_required` requires 2–32 replacements and evidence covering every original acceptance criterion and dependent. `needs_human` requires no replacements and evidence explaining the unresolved judgment. The returned `card_id` must equal the dispatched card.

### Probe

```yaml
schema_version: 1
dispatch_id: KFRUN-...
card_id: CARD-0001
probe: ci_status
status: success                   # success | failure | inconclusive
summary: ...
observations: []
evidence: []
```

`probe` is `project_commands|ci_status|pr_state|diff_policy`. An observation has exactly `key`, `status`, and `detail`, where status is `pass|fail|unknown`. Observation keys are unique. Overall `success` prohibits failed/unknown required observations; `failure` requires a failed observation; `inconclusive` requires an unknown required observation. Parent-executed deterministic probes use the same payload shape but are stored with `tool: parent_probe` and no claim that a child produced them.

## First-release checker criterion sets

Criterion keys are package-owned, stable, never reused, and dispatched in the order below. Schema version 1 has no check-disable switch. Project agent overrides may change judgment but must still verdict the complete package set.

### Requirements checker

1. `REQ-OBSERVABLE` — every requirement and card criterion describes observable, testable behavior.
2. `REQ-ACTIVE-LINKS` — every proposed card maps only to active/new requirements, except engine-derived grandfathering.
3. `REQ-COVERAGE` — proposed/updated backlog cards cover every behavior of each active changed requirement.
4. `REQ-NO-OVERLAP` — card scope does not duplicate another proposed or existing active card without an explicit replacement.
5. `REQ-VERTICAL` — each card is independently deliverable behavior, not a horizontal implementation layer.
6. `REQ-SIZED` — each proposed card is plausibly deliverable within one design and implementation cycle; exact line-count limits are not used in schema version 1.
7. `REQ-DAG` — all resulting dependencies resolve and are acyclic.
8. `REQ-SUPERSESSION` — same-meaning amendments retain IDs; changed meaning allocates replacements; retirement/supersession links are coherent.
9. `REQ-GRANDFATHER-COVERAGE` — every grandfathered card is named, retained unchanged, and followed by complete active-requirement coverage with required dependencies.

### Design checker

1. `DESIGN-AC-COVERAGE` — every card criterion maps to at least one implementation/test task.
2. `DESIGN-SPEC-FIDELITY` — cited active or grandfathered requirement text supports the design without contradiction.
3. `DESIGN-SCOPE` — in/out scope is explicit and every task serves card scope.
4. `DESIGN-TDD` — tasks are ordered as observable failing check, implementation, verification, and refactor where applicable.
5. `DESIGN-INTERFACES` — changed interfaces, data flow, errors, compatibility, and migration effects are precise enough to implement.
6. `DESIGN-TESTABILITY` — objective commands and independently derived assertions can verify the result.
7. `DESIGN-DECISIONS` — alternatives and durable decisions are recorded in the design; ADR persistence is not required in schema version 1.
8. `DESIGN-NO-CODE` — the design commit changes only its allowed design path.
9. `DESIGN-PLANNED-PATHS` — typed planned path/action entries exactly match the design's file-level tasks and obey product path policy.

### Ship checker

1. `SHIP-BASE` — PR base is authoritative `main` and repository/head identity matches the card.
2. `SHIP-HEAD` — PR head commit equals the reviewed implementation commit.
3. `SHIP-BODY` — each PR-body claim is supported by approved artifacts and the exact diff.
4. `SHIP-PATHS` — diff equals the parent-approved product path/action set and excludes state/design-owned paths.
5. `SHIP-MARKER` — marker, branch, card, operation, and PR identity agree uniquely.
6. `SHIP-CHECKS` — required GitHub checks are not known failing at creation; pending checks remain a later reconciliation boundary.

Engine-owned structural validation runs before and after each checker and cannot be waived by a checker verdict. Evidence for every criterion is mandatory, including passing criteria.

## First-release review lenses

Each configured lens reviews the same immutable implementation commit independently and only through its named scope:

- `acceptance` — trace every card criterion to observable behavior in the diff and supplied probe evidence;
- `functionality` — identify correctness, boundary, error-path, state, concurrency, and compatibility defects introduced by the diff;
- `tests` — assess whether tests would fail for the relevant behavioral regressions, use independent expected values, and remain deterministic;
- `readability` — assess maintainability, naming, local clarity, and established project conventions without treating taste as blocking;
- `security` — assess changed trust boundaries, input handling, authorization, secrets, injection, dependency, and data-exposure risks; irrelevant categories are reported as evidence, not invented findings;
- `simplicity` — identify unnecessary abstraction or complexity that creates a concrete defect/rework risk, not mere preference.

A blocking reviewer finding means the reviewed commit cannot safely satisfy its approved card/design as written and must identify a location, consequence, and bounded fix. Non-blocking improvements never consume rework. After implementation rework, schema version 1 reruns all configured lenses against the new immutable commit; partial-lens reruns are deferred.

## Parent attestation

The child cannot supply authoritative runtime metadata. After validation, the parent wraps the payload with:

```yaml
run_id: KFRUN-...
dispatch_id: KFRUN-...
tool: submit_checker_result
agent:
  name: design-checker
  source: package                 # package | project
  path: agents/design-checker.md
  sha256: ...
model:
  provider: anthropic
  id: claude-...
  thinking: high
policy:
  name: strict
  tools: [kanban_read, kanban_grep, kanban_find, kanban_ls, submit_checker_result]
  snapshot_commit: ...
execution_context:
  kind: immutable_snapshot        # immutable_snapshot | product_worktree | parent
  repository_id: owner/repo
  branch: kanban/card/CARD-0001-example
  commit: 0123456789abcdef0123456789abcdef01234567
argv: [pi, --mode, json, ...]
started_at: ...
completed_at: ...
exit_code: 0
stop_reason: toolUse
finding_ids: []
payload: { ... }
```

Provider and model identity are taken from authoritative final Pi events, not child prose. Pi 0.85.1 final JSON events do not include the effective thinking level; schema-version-1 therefore attests thinking from the parent-resolved explicit `--thinking` dispatch value and requires final provider/model to match that dispatch. If a later supported Pi event exposes effective thinking, the runner must compare and attest it. The engine chooses artifact destinations and rejects model-proposed paths outside the role contract.

Durable attestation never stores an absolute package, snapshot, checkout, or worktree path. `execution_context` records logical repository/branch/commit identity. Attested argv replaces machine-local roots with the literal tokens `<PACKAGE_ROOT>`, `<SNAPSHOT_ROOT>`, `<WORKTREE_ROOT>`, and `<TEMP_ROOT>` and redacts credentials and environment-derived secrets. The machine-local dispatch log may record canonical paths under the common Git operation directory but is not board state.

A child attestation object has exactly `run_id`, `dispatch_id`, `tool`, `agent`, `model`, `policy`, `execution_context`, `argv`, `started_at`, `completed_at`, `exit_code`, `stop_reason`, `finding_ids`, and `payload`. `finding_ids` is engine-owned, is parallel to `payload.findings`, and contains allocated durable `FINDING-*` values; it is `[]` when the payload has no findings. Children never submit this field. Agent has exact `name`, `source`, `path`, and `sha256` fields; packaged/project `path` is repository- or package-relative rather than absolute. Model has exact `provider`, `id`, and `thinking` fields. Policy has exact `name`, ordered unique `tools`, and `snapshot_commit`; `snapshot_commit` is null for broad product-worktree runs. Execution context has exact `kind`, `repository_id`, `branch`, and `commit`; branch is nullable only for requirements work and commit always identifies the inspected starting snapshot. Argv is a non-empty array of normalized/redacted strings. Timestamps are UTC and ordered. Exit code must be zero for child success. The initial accepted stop reason is `toolUse`; any provider requiring another successful value must first update this versioned specification based on spike evidence.

A deterministic parent-probe artifact uses the same top-level keys but has `tool: parent_probe`, `agent: null`, `model: null`, policy `{name: parent, tools: [], snapshot_commit: <commit>}`, `finding_ids: []`, and `stop_reason: parent`. Its `exit_code` is the directly invoked command's integer exit code and may be nonzero when the payload truthfully records a failed observation. It is valid evidence, not a successful child completion, and cannot directly authorize a workflow transition without the engine's probe/status rules.

## Successful completion

Pi's tool `terminate: true` is a hint, not proof. A child succeeds only when:

1. exactly one allowed role-result tool call validates;
2. no other role-result call occurs;
3. the result call is in the final accepted assistant turn and has no nonterminating sibling tool call;
4. no later assistant output conflicts with it;
5. `agent_end` is observed;
6. process exit code and stop reason are acceptable; `agent_settled` may follow `agent_end` and is validated as a known lifecycle event;
7. run/dispatch ID and expected role/phase/card match.

Missing, duplicate, invalid, mismatched, or prose-only completion fails. A successful payload is not itself permission to transition; the engine applies state-machine rules.

## Storage

The parent writes the validated payload and attestation to the deterministic artifact path defined in `spec-board-schema.md`. Children never mutate board files, state PRs, or terminal card status.
