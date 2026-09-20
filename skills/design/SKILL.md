---
name: design
description: Request the design phase of the deterministic kanban lifecycle.
---

Invoke `kanban_pump` exactly once with `{ "schema_version": 1, "requested_phase": "design" }`.

This is a diagnostic phase request only. The scheduler, eligibility checks, transitions, and durable authority remain parent-owned. Report the structured result and stop.
