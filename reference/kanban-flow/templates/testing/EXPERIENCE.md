# Experience testing — doctrine

Read by the `[experience]` lens (its static rubric) and by CI-workflow authors via JOURNEYS.md
(the runtime gates). The split is load-bearing: **static review is lens work; runtime measurement
is CI work; judgement is human work.** An agent gate that "judges" UX auto-passes garbage or
auto-blocks taste — build neither.

## Static review (the lens)

State coverage (empty/loading/error/partial/populated — rendered and tested), selector-convention
discipline, keyboard reachability and focus management, accessibility structure (real controls,
labels, alt, heading order, colour-plus-signal). The lens file's Walk is the procedure; this file
is why: these are the defects static reading catches *cheaper* than any runtime scan, and they are
the ones agents introduce most — the unloved error state, the clickable div.

## Runtime gates (CI, scope: pr)

From `testing.experience` in `config.md`: axe accessibility scan (ruleset and `max_violations`,
default wcag21aa / 0), Core Web Vitals budgets (`lcp_ms`, `cls`, `tbt_ms`) via Lighthouse or
equivalent, across the configured `viewports`. Deterministic environment per JOURNEYS.md (pinned,
seeded, readiness-waited). These are pass/fail machine checks — they gate the PR like any CI
check, triaged by §6a like any failure.

## The judged artefact (humans)

Annotated screenshots against a heuristic rubric — Nielsen heuristics, copy quality, affordance
clarity, empty/loading/error walkthrough — produced in CI or on demand. It is **advisory, always**:
attached to the PR or a defect card for a human to judge. It never auto-passes or auto-fails
anything. If a project wants it, the CI workflow produces it; the plugin builds no machinery for
it.
