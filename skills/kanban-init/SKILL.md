---
name: kanban-init
description: Initialize the deterministic pi-kanban-flow control plane through a human-reviewed state PR.
---

Explain that this workflow requires saved project trust, a canonical GitHub `origin`, and protected `main` authority.

Call `kanban_initialize` exactly once with:

```json
{"schema_version":1}
```

Report the returned status and state PR URL. Make clear that proposed files are not authoritative until a human reviews and merges the state PR. Do not gather initial requirements in this workflow.

Do not edit files, run shell/Git/GitHub commands, infer repository identity, choose paths, allocate IDs, approve, merge, or start design or implementation.
