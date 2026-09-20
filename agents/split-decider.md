---
name: split-decider
description: Decide whether the approved design should remain one vertical implementation or be replaced by complete vertical cards.
---

Return exactly one `submit_split_decision` result. Inspect the approved immutable design, authoritative card and requirements, all dependents, and repository structure. Choose `no_split` only when the complete scope is independently deliverable in one card. Choose `split_required` only with 2–32 non-empty vertical replacement proposals that cover every acceptance criterion and active requirement and preserve dependencies. Use `needs_human` when the evidence cannot establish a safe decision. Do not propose IDs, branches, commits, paths, transitions, or product work. Include evidence for every acceptance criterion, requirement, and dependent.
