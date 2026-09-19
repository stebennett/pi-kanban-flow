# pi-kanban-flow

A Pi-native deterministic kanban workflow package organized around:

```text
requirements → design → implement → review → ship
```

Stage 3 provides board initialization and requirements planning through checked, explicitly approved, human-reviewed state PRs. Merging a state PR is the authority boundary: an open PR is proposed state, never current board state. Stage 3 does not run design or implementation.

## Runtime baseline

- Pi `>=0.85.0 <0.86.0`
- Node.js `>=22.19.0`
- Git `>=2.39.0`
- GitHub CLI `>=2.45.0`
- macOS 13+ or a maintained Linux distribution
- a GitHub repository with canonical `origin` and protected `main`

## Installation and trust

Install or link the package using Pi's normal package mechanism, then restart Pi so packaged extensions, skills, agents, and templates are rediscovered. Git-pinned and npm-packed installs are supported in addition to a local checkout or symlink.

Project mutation requires a persisted **saved yes** trust decision for the repository (or an applicable parent). Temporary approval and `defaultProjectTrust: always` do not qualify. Project agent overrides are active only when config permits them and saved trust is proven; active override path/hash and effective model identity are shown before approval.

## Initialize a board

From the canonical trusted repository root:

```text
/skill:kanban-init
```

Initialization is LLM-free. It proposes only:

- `docs/cards/board.yaml`
- `docs/cards/config.yaml`
- `docs/cards/BOARD.md`

Review and merge the returned state PR. Initialization never combines initial requirements into that PR.

## Create or amend requirements

After initialization merges:

```text
/skill:requirements
```

The skill asks one question at a time and passes a bounded brief to the deterministic engine. The engine:

1. reads fresh `origin/main` under the common lock;
2. runs the requirements producer and immutable-snapshot checker;
3. derives IDs, card impacts, dependency rewires, grandfathering, and exact paths itself;
4. displays one digest-bound approval in TUI/RPC mode; and
5. after explicit approval and stale-state revalidation, proposes one state PR.

JSON/print modes prepare the approval document but cannot approve. A checker failure or inconclusive result requires a fresh revision; schema version 1 has no automatic requirements retry budget.

Review the state PR and merge it manually. No requirement, card, artifact, or counter becomes authoritative before merge. Run validation again after merge before beginning later work.

## Failure recovery

- **Pending state PR:** review/merge or explicitly resolve it before another requirements run.
- **Closed-unmerged or ambiguous managed PR:** stop and resolve the marked transaction; the engine fails closed.
- **Stale approval/base:** start a fresh requirements run; approvals cannot be replayed.
- **Design PR closure interruption:** retry after inspecting the canonical action marker; the engine revalidates exact PR identity and merge state.
- **Lock contention/loss:** wait for the owner or use the separately specified confirmed recovery path. Never delete lock files manually.
- **Agent/model/override failure:** correct trust, authentication, model availability, or the reported override and rerun. There is no fallback model.
- **Noninteractive preparation:** rerun in TUI or RPC mode for explicit approval.

`/kanban-validate --markers` and `kanban_validate` are read-only diagnostics. They do not reconcile or mutate state.

## Repository layout

- `extensions/kanban-flow/` — deterministic engine and Pi tools
- `skills/` — user-facing Pi skills
- `agents/` — packaged specialist agent definitions
- `templates/` — internal runtime assets
- `test/` — unit, integration, and fixture tests
- `docs/` — migration and architecture specifications
- `reference/kanban-flow/` — read-only Claude plugin reference

See `docs/spec-development-process.md` for development gates and sequencing, and `docs/checkpoint-stage-3-complete.md` for Stage 3 evidence and known gaps.
