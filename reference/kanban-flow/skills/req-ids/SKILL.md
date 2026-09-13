---
name: req-ids
description: Assign stable REQ-NNN ids in the spec — sole authority for REQ format, id allocation, and supersede markers. Invoked by /refine and /requirement, or run directly. Run under Opus.
---

# req-ids — the spec's requirement identity

You hold **sole-writer authority for requirement identity** in the project spec
(`spec_path` in `{board_dir}/config.md`): the heading format, the numbers, and the
`**Status:**` lines.

Your callers — `/refine` and `/requirement` — compose requirement **prose**; you persist
it with correct **identity**, never authoring, rewording, or deleting content.

## The format

A requirement is an addressable heading in the spec:

```markdown
## Boards

### REQ-012 — Export a board to CSV
**Status:** active

Users with read access can export a board to CSV, one row per card, including
the card's id, title, status and milestone.
```

- **Id** — `REQ-NNN`, zero-padded to three digits, unique across the spec, allocated
  in ascending order, **never reused and never renumbered**.
- **`**Status:**`** — exactly `active` or `superseded by REQ-NNN`.
- **`## <Area>`** — a free-form grouping heading. Requirements live under one.
- **Non-normative prose** — overview, goals, glossary, architecture notes,
  background — is **not** a requirement. It gets no id and you leave it untouched.

## Operations

The caller names exactly one operation.

### `backfill` — id an un-id'd spec

Run this before any other work touches the spec. `/refine` calls it on its first
pass; `/requirement` calls it before it does anything else.

1. Read the spec at `spec_path`.
2. **If every requirement-bearing section already carries a `### REQ-NNN — ` heading,
   report `already-id'd` and stop.** This is the common case and it is a **no-op** —
   write nothing, ask nothing.
3. Otherwise, identify the discrete requirements in the existing prose. A requirement
   is a statement of something the system must do that is observable and independently
   checkable. Exclude non-normative prose (above).
4. Where prose bundles several requirements, split it into separate REQs.
   **Preserve the author's wording** — wherever the bundle breaks cleanly along sentence
   boundaries, reuse their sentences unchanged and add only the `### REQ-NNN — <title>`
   heading and the `**Status:** active` line.

   Where a bundle sits **inside a single sentence** (`Users can create a board and add
   cards to it.`), splitting it necessarily rewrites it. Then: make the **smallest edit**
   that leaves each REQ a standalone statement, and **call out every such rewrite
   explicitly** in the diff you present at step 6, so the driver sees exactly which words
   you changed and can veto the split. Never rewrite prose you did not have to split — you
   are numbering the author's spec, not rewriting it.
5. Number in document order, starting at `REQ-001`.
6. **Present the full diff** and the count (`n requirements identified`). Ask the driver
   to `approve` or `revise`. **Never write without approval.**
7. On approval, write the spec. Return the map of `REQ id → title` to the caller.

### `allocate` — add a new requirement

The caller passes a **title**, the requirement **prose**, and the **area** (an existing
`## <Area>` heading, or a new one to create).

1. `NNN = max(every REQ id in the spec) + 1`, zero-padded to three digits. Take the max
   across **all** requirements including superseded ones — ids are never reused.
2. Insert the requirement at the end of the named area's requirements. If the area does
   not exist, append the `## <Area>` heading at the end of the spec's requirement
   sections and put it there.
3. Write it in the canonical format with `**Status:** active`.
4. **Return the allocated id** to the caller — it needs it for the cards' `reqs` field.

### `supersede` — retire a requirement

The caller passes one or more **old ids** and the **new id** replacing them.

1. For each old id, set its status line to `**Status:** superseded by REQ-NNN`.
2. **Never delete the requirement and never edit its prose.** It stays exactly where it
   is, so cards that cited it still resolve.
3. **Refuse** and report the conflict to the caller (do not guess) if an old id does not
   exist, or is already `superseded by` a **different** id. The caller decides.
4. Return the list of ids you changed.

## Rules

- You write files; **you never commit**. The invoking skill owns the commit. Run
  directly, you leave the spec change in the working tree for the user to commit.
- Requirements are never deleted, never renumbered, and ids are never reused.
- You never author, reword, or delete requirement **content** — only identity and
  status. Content belongs to the caller.
- You never touch `card.md`, `BOARD.md`, `KNOWLEDGE.md`, `MILESTONES.md`, or
  `AMENDMENTS.md`. Your write surface is exactly one file: `spec_path`.
- `backfill` is idempotent. It is safe — and expected — to invoke it on every `/refine`
  and `/requirement` run.
