---
name: ship
description: Request the shipping phase of the deterministic kanban lifecycle.
---

Invoke `kanban_pump` exactly once with `{ "schema_version": 1, "requested_phase": "ship" }`.

Pending external facts remain pending evidence. Report the structured result and stop; do not continue another phase in this invocation.
