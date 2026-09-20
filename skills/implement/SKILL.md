---
name: implement
description: Request the implementation phase of the deterministic kanban lifecycle.
---

Invoke `kanban_pump` exactly once with `{ "schema_version": 1, "requested_phase": "implement" }`.

The request cannot select a card or bypass lifecycle checks. Report the structured result and stop at its boundary.
