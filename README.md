# pi-kanban-flow

A Pi-native kanban workflow package organized around:

```text
requirements → design → implement → review → ship
```

The Stage 0 specification baseline in `docs/` is approved. Stage 1 package mechanics are implemented; deterministic board behavior is being delivered incrementally.

## Repository layout

- `extensions/kanban-flow/` — deterministic engine and Pi tools
- `skills/` — user-facing Pi skills
- `agents/` — packaged specialist agent definitions
- `templates/` — internal runtime assets
- `test/` — unit, integration, and fixture tests
- `docs/` — migration and architecture specifications
- `reference/kanban-flow/` — read-only Claude plugin reference

## Runtime baseline

- Pi `>=0.85.0 <0.86.0`
- Node.js `>=22.19.0`
- Git `>=2.39.0`
- GitHub CLI `>=2.45.0`
- macOS 13+ or a maintained Linux distribution

See `docs/spec-development-process.md` for development gates and sequencing.
