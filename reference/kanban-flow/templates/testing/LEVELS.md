# Test levels — doctrine

Read by `card-designer`, `card-design-checker`, and `card-tester` when the project configures
`testing.levels`. The terse rules ride every dispatch in `AGENT-PROTOCOL.md` (determinism vs
isolation; fakes only at declared seams); this file is the working detail.

## The level model

A level is a named class of tests with a scope. `scope: card` levels run at the test phase via the
project's configured command and feed the implementer rework loop; `scope: pr` levels (journeys,
experience) run in the implementation PR's CI — agents never run them and never provision their
environments. `unit` is not a level: the existing suite/coverage/property/lint gates own it.

## Derive, then declare — or decline in writing

Level L is **owed** by a card iff the card's `layer` is in `derive[L]`. Refinement is **add-only**:
a card whose task list plainly crosses into another layer's surface picks up that layer's owed
levels too; nothing is ever removed by derivation argument. Every owed level gets exactly one line
in `design.md` → `## Test strategy` → `### Levels`:

    - <level>: selected — <what it covers, naming acceptance criteria>
    - <level>: declined — <rationale a checker can judge>

A decline needs a reason that would survive a skeptical reader ("no seam schema touched", "no
user-visible flow changes; J1/J2 unaffected") — "out of time" or "covered by unit tests" is not a
rationale, it is the escape hatch this system closed. A selected level that produces zero tests is
a blocker at the test phase. Deferral rates are counted by `/retro`.

## Executable acceptance examples

Wherever an acceptance criterion admits a worked example, the design records it as a concrete
example table — given/when/then as data, exact expected literals computed from the spec's own
arithmetic, never from the code under test. The implementer automates these verbatim; the
`[tests]` lens's provenance rules treat a regenerated or formula-mirrored expected value as
blocking. The spec's numbers become the tests.

## Integration level — real dependencies, deterministic

- Real infrastructure at the boundary: Testcontainers or the project's compose file, pinned image
  tags (never `latest`), seeded data, readiness waits (never fixed sleeps).
- Transactional isolation per test where the store supports it; otherwise unique-key namespacing
  per test. No test depends on another's writes; parallel-safe by construction.
- **Fakes only at declared seams.** Inside the boundary everything is real — a mocked repository
  in an integration test is the system under test wearing a disguise. A seam's declared stance
  (`integration: real | fake`) is binding both directions.
- Assert on observable behaviour (rows written, responses returned, messages published), never on
  call order or internals — integration tests exist to survive refactors that rewrite internals.

## Contract level — schema first

- Schema-based verification (OpenAPI/AsyncAPI in-repo) is the default; a broker (Pact) earns its
  keep only with real bidirectional consumer coupling.
- Backwards-compatible evolution: additive fields are safe; removals/renames/type-changes are
  breaking and need explicit versioning. A diff touching a declared seam's `schema` path without a
  passing contract run is a blocker at the test phase.

## Test data

- Factories/builders over fixtures; every test constructs what it asserts on.
- Deterministic clocks and ids injected, never ambient (`now()` and random ids are flake seeds).
- Synthetic data only — never production values, never PII-shaped literals.
- Seeds are idempotent and per-test-isolated; a shared mutable fixture is a flake factory.
