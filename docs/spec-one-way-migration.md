# One-way Claude-to-Pi migration specification

## Purpose

Migrate explicitly supported Claude kanban-flow boards to Pi-owned schema without supporting dual operation.

## Cutover rule

Migration is one-way. After the migration PR merges, users must stop using, uninstall, or disable the Claude kanban-flow plugin for that board.

Rollback is operational: revert the migration PR and return to the old harness. Pi does not support simultaneous Claude/Pi pumping.

## Stage 5 prerequisite: exact legacy field mappings

Before Stage 5 migration code begins, add a fixture-backed mapping appendix (or versioned companion document) for every supported Claude board version. For each source file and field it must specify:

- source path, type, required/default semantics, and supported values;
- destination path/field or explicit retained-as-history/deferred/removed outcome;
- exact status and status-plus-artifact mappings;
- ID namespace mapping, including acceptance criteria, checks, and findings;
- branch/design/product PR mapping and handling of legacy machine-local worktree paths;
- ambiguity and refusal conditions;
- representative valid, invalid, and ambiguous fixtures with expected dry-run reports.

Version `0.10.0` is not considered supported merely because it is named here; it becomes supported only when this mapping and its fixtures are accepted. `/skill:migrate` must reject all source versions/shapes not in the accepted matrix.

## Migration command

`/skill:migrate` performs a dry validation first, then creates a migration branch and PR.

It must refuse when:

- the board is dirty or partially written;
- a Claude pump appears pending/in progress;
- existing fields are from an unsupported schema shape;
- status mapping is ambiguous;
- required IDs are duplicate or missing;
- pending product/state actions cannot be reconciled.

## Migration output

The migration PR adds or updates:

```yaml
harness: pi
board_schema_version: 1
last_writer_package_version: <package-version>
migration:
  source_harness: claude
  source_version: 0.10.0
  source_commit: <authoritative-source-commit>
  migrated_at: <timestamp>
```

The migration object has exactly these four fields. `source_harness` is constant `claude`; `source_version` is an exact semver from the accepted migration matrix; `source_commit` is the lowercase 40- or 64-character Git object ID of the authoritative source snapshot; and `migrated_at` is a UTC RFC 3339 timestamp generated when the migration transaction is planned. The object is immutable after the migration PR merges.

## Preservation policy

Preserve where compatible:

- requirement IDs;
- card IDs;
- criteria/check IDs;
- card history;
- acceptance criteria;
- dependencies;
- project protocol addenda;
- PR links and branch links.

Never silently repurpose an ID namespace. Retired concepts remain historical metadata or are reported as unsupported/deferred.

## Status mapping

Each supported legacy status must map to one simplified lifecycle status:

- requirements/intake-like work → `backlog` or refused if ambiguous;
- design work with a recoverable branch/artifact but no open PR → `designing`;
- design PR open → `design_review` only when its branch, marker, and checked artifact validate;
- completed and merged design → `ready_for_implementation` when artifacts and GitHub merge evidence validate;
- implementation in progress → `implementing` only if branch/PR state reconciles; any local worktree is rediscovered or recreated and is not migrated into board state;
- review in progress → `implementation_review` only if review context validates;
- delivery/PR pending → `shipping` only if product PR can be found;
- completed → `done` only if merge evidence validates.

Ambiguous mappings are refused with manual migration guidance.

## Unsupported/deferred legacy features

The migration report must identify unsupported or deferred features, including where applicable:

- post-review multi-PR split shipping;
- optional testing levels/telemetry;
- retro automation;
- nightly probes/quarantine;
- Claude memory writes;
- Claude slash command aliases;
- Superpowers runtime dependencies.

## PR behavior

Migration itself is a state PR-like control-plane change and requires human review by default. It must not push directly to `main`.

## Post-merge checks

After merge, Pi operation requires:

- `harness: pi`;
- supported `board_schema_version`;
- trusted project;
- no active conflicting Claude artifacts.

Documentation must instruct users not to run the old Claude plugin after cutover.
