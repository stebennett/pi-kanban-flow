---
name: review
description: Request the independent review phase of the deterministic kanban lifecycle.
---

Invoke `kanban_pump` exactly once with `{ "schema_version": 1, "requested_phase": "review" }`.

The parent coordinator owns evidence, ordering, findings, and transitions. Report the structured result and stop.
