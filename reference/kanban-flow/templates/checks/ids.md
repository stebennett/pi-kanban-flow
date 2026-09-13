# Criterion ids by target

Generated index — edit the per-target file, then update this list. The orchestrator's completeness
valve reads this; checkers read their full target file.

- **intake:** INT-AC-OBSERVABLE, INT-COVERAGE, INT-DAG, INT-MILESTONE, INT-NO-OVERLAP, INT-REQ-RESOLVES, INT-SIZED, INT-VERTICAL
- **slice:** SLC-CHILD-AC, SLC-CHILD-VERTICAL, SLC-DAG, SLC-NO-LOSS, SLC-REWIRE, SLC-SIZE, SLC-VERDICT
- **design:** DSG-AC-COVERED, DSG-ADR-NEEDED, DSG-DOCTRINE, DSG-KNOWLEDGE, DSG-NO-CODE, DSG-SCOPE, DSG-SPEC-FIDELITY, DSG-TASK-TDD — plus, **only when the project configures `testing.levels`** (the orchestrator adds them to the held set): DSG-LEVELS, DSG-SEAMS, DSG-DATA
- **split:** SPL-COHERENT, SPL-FILES, SPL-GREEN, SPL-NO-LOSS, SPL-ORDER, SPL-SIZE
- **deliver:** DLV-BASE, DLV-BODY-TRUE, DLV-CI, DLV-DOCS, DLV-PURITY, DLV-SIZE
