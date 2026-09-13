# Repository instructions

## Purpose

This repository is the production package root for `pi-kanban-flow`, a Pi-native deterministic kanban workflow package.

## Sources of truth

Before implementation work, read:

1. `docs/migration-plan.md`
2. `docs/stage-0-specifications.md`
3. the detailed `docs/spec-*.md` documents relevant to the change

Detailed specifications override summaries when wording differs. Resolve contradictions in the specifications before coding around them.

## Reference policy

`reference/kanban-flow/` is a read-only behavioral source and migration fixture.

- Do not edit, format, rename, or generate files under `reference/`.
- Do not copy Claude-specific mechanics blindly.
- Classify ported behavior according to `docs/spec-legacy-behavior-mapping.md`.

## Architecture boundaries

- The TypeScript engine owns state parsing, transitions, scheduling, locking, reconciliation, and board mutation.
- Models produce artifacts and bounded judgments; they do not mutate board state.
- Board changes use state PRs. Design and product work use their separately specified branches and PRs.
- Child agents use role-specific structured-result tools and code-assembled resource policies.
- Keep package assets resolvable from local, Git, symlinked, and npm-packed installs.

## Repository layout

- `extensions/kanban-flow/engine/` — pump, transitions, reconciliation, scheduler, rendering
- `extensions/kanban-flow/board/` — schemas, repository, migrations, lock
- `extensions/kanban-flow/state-pr/` — transaction and GitHub integration
- `extensions/kanban-flow/agents/` — discovery, policy, runner, result tools
- `extensions/kanban-flow/tools/` — Pi-facing deterministic tools
- `skills/` — user-facing workflows
- `agents/` — packaged agent prompts
- `templates/` — internal assets, not Pi prompt templates
- `test/` — unit, integration, and fixture tests

## Development rules

- Follow `docs/spec-development-process.md` and its required spikes and stage gates.
- Keep board schemas strict and deterministic.
- Use direct executable/argv process invocation; do not interpolate configured commands through a shell.
- Commit or mutate exact allowed paths only.
- Treat `origin/main` as authoritative and fail closed on ambiguous external state.
- Do not broaden trust, child tools, model fallback, or platform support without updating the specifications first.
- Add focused tests for deterministic behavior as each component is implemented.

## Current state

The repository is scaffolded only. Do not treat empty directories or placeholder files as implemented behavior.
