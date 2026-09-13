# Journey (E2E) testing — doctrine

Read by `card-designer` when a `journey` level is configured and the card touches
`testing.harness_paths` — i.e. when the card's scope includes the journey harness or CI workflow
itself. Journeys run in the implementation PR's CI; agents never run them and never provision
their environments. CI owns lifecycles.

## Scope discipline

- **5–10 journeys, product-owned, changed rarely** (`testing.journeys` in `config.md`). Their job
  is integration-of-integrations failure — the payment that succeeds while the confirmation email
  silently dies — not behaviour coverage. Behaviour belongs to functional and integration levels.
- A card names, at design time, which journeys it can plausibly affect; the PR body's
  `### CI-verified levels` section carries that claim to the human.

## Authoring rules (Playwright)

- **Locators:** role/label/test-id (`getByRole`, `getByLabel`, `getByTestId` with the project's
  `selector_convention`) — never CSS paths or nth-child chains; they rot in weeks.
- **Waits:** web-first assertions (`await expect(locator).toBeVisible()`) — **no fixed sleeps, no
  `waitForTimeout`**; a sleep is a flake with a timer attached. Readiness is a condition, not a
  duration.
- **Data:** each test creates and owns its data (unique keys per run); no test reads another's
  writes; parallel-safe by construction. Deterministic clocks/ids injected at the environment
  boundary, per LEVELS.md's test-data rules.
- One user intent per journey; assertions on user-observable outcomes (what the user sees or
  receives), not on network internals.

## The CI workflow shape

`testing.env` is the contract: `up` → `ready` (poll, bounded) → seed → run journeys (and
experience gates, if configured) → `down` in an always-runs step. Pinned images, seeded data, no
public internet. The workflow file is project-owned; a card whose scope is the workflow itself is
an ordinary card — harness lines are `size_exclude`d via `harness_paths`, the spec of what it must
do is this file.
