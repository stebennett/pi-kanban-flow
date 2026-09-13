# slice — check criteria

Read `checks/_method.md` first (the discipline, the return format, and the size-estimate appendix);
this file is your criterion set. Checks `card-slicer`. Your inputs: `card.md`, the spec, `slice.md`,
the slicer's `proposed_cards` / `dependents_rewire` / `estimated_lines`, and the card's dependents.

| id | criterion | severity when failed |
|---|---|---|
| `SLC-VERDICT` | the keep-as-one call is justified, or the split is genuinely necessary — not splitting for its own sake | blocking |
| `SLC-SIZE` | **no card is projected to exceed `size_limit`** (size method in `_method.md`'s appendix) | blocking |
| `SLC-CHILD-VERTICAL` | each proposed child is itself a vertical slice with observable behaviour | blocking |
| `SLC-CHILD-AC` | each child's acceptance criteria are observable and faithfully inherited from the parent | blocking |
| `SLC-NO-LOSS` | the union of the children covers the parent — nothing was dropped in the split | blocking |
| `SLC-REWIRE` | `dependents_rewire` names **every** card that `depends_on` the parent, with correct new deps | blocking |
| `SLC-DAG` | child `depends_on` is acyclic and references only siblings or real cards | blocking |

**Walk:** Derive your own view before reading `slice.md` (per `_method.md`). For `SLC-NO-LOSS`, confirm
the union of the children's acceptance criteria covers every parent criterion — nothing dropped. For
`SLC-REWIRE`, list every card that `depends_on` the parent yourself and confirm each appears with
correct new deps. For `SLC-DAG`, build the child graph and walk it for cycles and forward references.

**`SLC-SIZE` — sizing.** Size every card in scope (the parent on a keep-as-one verdict; each child on
a split) by the method in `_method.md`'s appendix, then compare against the slicer's `estimated_lines`.
Any estimate over `size_limit` → **blocking: the card must be split.** The slicer is re-dispatched to
produce children, each subject to `SLC-SIZE` in turn, so a split into two over-budget children does
not pass. A slicer estimate indefensible against yours is blocking even under the limit.

**Don't flag:** an estimate that differs from yours by a modest margin and stays well under the limit
(you check for a *ceiling breach* and *reasoning*, not arithmetic); a keep-as-one verdict on a
genuinely atomic invariant — the slicer's own doctrine prefers right-sized when borderline, so respect
it unless the size estimate says otherwise.
