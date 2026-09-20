---
name: kanban
description: Run one deterministic kanban lifecycle pump and report its bounded durable boundary.
---

# Kanban

Invoke `kanban_pump` exactly once with `{ "schema_version": 1, "requested_phase": "none" }`.

Return the structured result without interpreting pending proposals as board authority. Stop at the reported boundary; the next pump is a separate operation.
