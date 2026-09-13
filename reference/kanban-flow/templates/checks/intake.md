# intake — check criteria

Read `checks/_method.md` first (the discipline, the return format, and the size-estimate appendix);
this file is your criterion set. Checks the card set proposed by `/refine` or `/requirement`,
**before** the driver sees it. Your inputs: the spec (at `spec_path`), the proposed cards, the
milestone plan, the existing board, and `size_limit` / `size_exclude` (for `INT-SIZED`).

| id | criterion | severity when failed |
|---|---|---|
| `INT-AC-OBSERVABLE` | every acceptance criterion is observable and testable — it names something you could watch happen, not an intent | blocking |
| `INT-REQ-RESOLVES` | every `reqs` id exists in the spec and is not superseded | blocking |
| `INT-VERTICAL` | each card is a vertical slice with user-visible value, not a horizontal layer task | blocking |
| `INT-COVERAGE` | the card set covers the requirement — nothing in the REQ is unclaimed by any card | blocking |
| `INT-NO-OVERLAP` | no two cards claim the same work | blocking |
| `INT-DAG` | `depends_on` is acyclic and every id names a real card or a proposed sibling | blocking |
| `INT-MILESTONE` | every card sits in exactly one milestone, and no card depends on a card in a later milestone | blocking |
| `INT-SIZED` | **no proposed card is projected to exceed `size_limit`** (size method in `_method.md`'s appendix) | blocking |

**Walk:** Read the requirement(s) first and list, in your own words, the observable behaviours it
demands. Only then read the proposed cards. Map behaviours → cards: an unclaimed behaviour is
`INT-COVERAGE`; two cards claiming one behaviour is `INT-NO-OVERLAP`. Then read each acceptance
criterion and ask *what would I run to see this?* — "the system is robust" fails `INT-AC-OBSERVABLE`;
"a request with no auth header returns 401" passes. Build the `depends_on` graph by hand and walk it
for cycles and milestone-order violations. Finally, size every card.

**`INT-SIZED` — sizing.** A card the intake skill marks `right_sized: true` **skips the slice phase
entirely**: it never meets `SLC-SIZE`, never gets an `estimated_lines` there, and is never sized again
before its code is written — only `DLV-SIZE` remains, advisory and after the fact on an open PR.
**Intake is that card's only pre-code size check.** Size **every** proposed card by the method in
`_method.md`'s appendix; any estimate over `size_limit` → **blocking**, and the intake skill must
slice that card smaller and re-check.

**Return `estimated_lines` for every proposed card** in your `phase_doc`, breach or not — the intake
skill persists it onto the card it writes, so a card that arrives already right-sized still carries a
baseline for `DLV-SIZE` to report `actual_lines` against and for `/retro`'s under-estimation signal to
see it at all. Leave it empty at intake and it is empty forever.

**Don't flag:** card granularity you would have chosen differently but that meets `INT-VERTICAL`
(taste is not a defect); a card whose acceptance criteria are thin *because the requirement is thin* —
that is a spec problem, and belongs in your `phase_doc` prose, not as a card finding.
