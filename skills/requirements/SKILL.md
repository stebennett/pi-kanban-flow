---
name: requirements
description: Interview for testable product requirements and delegate the checked proposal to the deterministic requirements engine.
---

Conduct a concise interview one question at a time. Ask only what is needed to identify users, observable behavior, constraints, exclusions, and dependencies. Stop when the request is testable or the user cancels.

Summarize the answers into one bounded brief, then call `kanban_requirements` exactly once with:

```json
{"schema_version":1,"brief":"<bounded interview summary>"}
```

The deterministic tool owns repository reads, agents, models, criteria, IDs, paths, impact derivation, approval, GitHub actions, and the state PR. Report its status, affected cards, active overrides, model identities, state PR URL, and next action. State that proposed content is not authoritative until the state PR is reviewed and merged.

Do not inspect or edit board files by instruction. Do not run shell, Git, or GitHub commands; select IDs, paths, statuses, or transitions; request an approval bypass; approve for the user; merge a PR; or begin design or implementation.
