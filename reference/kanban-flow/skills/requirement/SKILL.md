---
name: requirement
description: "Add, amend, or supersede one requirement on a running project: interview the driver, persist via req-ids, slice into cards, apply board impact. Intake only — never implements. Run under Opus."
---

# /requirement — add, amend, or supersede a requirement

`/refine` turns a whole spec into a backlog. **You handle one requirement on a project
that is already running** — the mid-flight ask, the changed mind, the thing the spec
never said. You are an **intake** skill: never code, never branches or worktrees, never
start a card.

Usage: `/requirement [rough one-liner]`. With no argument, ask what the driver wants to add.

## The ownership boundary — read this first

`/kanban` is the **sole writer** of every `card.md` once a card leaves `backlog` — the rule
that makes the board safe to drive unattended under `/loop`. A card beyond backlog owns a
branch, a worktree and maybe an open PR, so retiring one is a **teardown**, not a file edit.

You respect that boundary absolutely. Classify every existing card by `status` alone:

| Card status | What you may do |
|---|---|
| `backlog` | **Edit, re-slice, or delete it directly.** No branch, no worktree, no PR — nothing to tear down. This is the same authority `/refine` has. |
| `slice` … `deliver`, `blocked` | **Never touch the file.** Append an amendment to `{board_dir}/AMENDMENTS.md`; `/kanban` applies it on its next pump. |
| `done` | **Never amend, never supersede** — it shipped. If the new requirement contradicts shipped behaviour, that is a **new card** (usually a `defect`). |
| `split`, `superseded` | Terminal. Ignore. |

## Steps

1. **Load context.** Read `{board_dir}/config.md` first (`spec_path`, `layers`,
   `board_dir`). Then read:
   - the plugin's card doctrine at `${CLAUDE_PLUGIN_ROOT}/templates/INTAKE.md` — the
     rules for every card you propose. Follow it exactly; it is not duplicated here.
   - the spec at `spec_path`;
   - every `docs/cards/CARD-*/card.md` (you need `status`, `reqs` and `depends_on` on all
     of them for impact analysis);
   - `{board_dir}/MILESTONES.md` and `{board_dir}/KNOWLEDGE.md`;
   - the card template — `config.md`'s `template_overrides["card-template.md"]` if set,
     else `${CLAUDE_PLUGIN_ROOT}/templates/card-template.md`.

2. **Ensure the spec has REQ ids.** Invoke the **`req-ids`** skill's **`backfill`**
   operation. On an un-id'd spec it proposes an id'd version for approval; otherwise it is
   a silent no-op. Everything below addresses requirements by id, so this must happen first.

3. **Elicit.** Interview the driver **one question at a time** — never a wall of questions.
   Prefer multiple choice where the options are genuinely enumerable. Cover:
   - **Intent** — what becomes possible, and for whom. Why now.
   - **Scope** — and explicitly what is *out* of scope.
   - **Edge cases** — what happens at the boundaries, on failure, for the unauthorised user.
   - **Acceptance** — the observable criteria that would prove it done.

   **Stop as soon as the requirement is testable** — not after a fixed number of questions.
   A requirement is testable when you could hand it to someone who has never met the driver
   and they could tell you whether the built thing satisfies it.

4. **Analyse impact.** Decide what this requirement *is*:
   - **new** — it adds a capability nothing in the spec covers;
   - **amends** an existing `REQ-NNN` — same capability, changed detail;
   - **supersedes** one or more existing `REQ-NNN` — the old requirement is now wrong.

   Then find every affected card. Use the `reqs` frontmatter field as the index — a lookup,
   not an inference. Two traps:
   - **Empty `reqs` means _unknown_, not _unaffected_** (`INTAKE.md`). Read it and judge;
     surface it to the driver as *impact undetermined* rather than assume it is fine.
   - **Superseding a card orphans its dependents.** Any card whose `depends_on` names a card
     you supersede can never become ready — `/kanban` parks it forever. For **every** dependent,
     propose a rewire: drop the dead id, or repoint it at the replacement. A `backlog` dependent
     you rewire directly; an in-flight one needs its own `revisit` amendment. **Never leave a
     dangling `depends_on`.**

   Classify each affected card by the ownership boundary above.

5. **Propose — once.** A single approval surface. Show:
   - the **requirement** exactly as it will appear in the spec (heading, `**Status:**`, prose);
   - any **supersede** links (`REQ-012 supersedes REQ-004`);
   - the **new cards** — id, type, layer, title, `reqs`, `depends_on`, and acceptance
     criteria, per `INTAKE.md`;
   - **edits and deletions to backlog cards**, each with its reason;
   - **`depends_on` rewires**, each with its reason;
   - **milestone placement** for every new card, with both `INTAKE.md` invariants
     re-validated across the whole board;
   - the **amendments to be queued** — one line per in-flight card, naming the action and
     why.

   **Check before you propose.** Run the intake check per `INTAKE.md` `## Check` — it
   dispatches `card-intake-checker`, runs the budget loop, and yields each card's
   `estimated_lines`, which you persist in step 6.

   Ask for approval, edits, or removals. Iterate until approved. **Write nothing before
   approval.**

6. **On approval, write — then commit once.**
   1. Persist the requirement via **`req-ids`**: `allocate` for the new one (it returns the
      id), then `supersede` for any it replaces. Never edit the spec by hand.
   2. Create the new cards from the card template — **instantiation strips the template's
      frontmatter comments, so each card.md carries bare frontmatter** — and apply the approved
      edits, deletions and `depends_on` rewires to `backlog` cards. `estimated_lines` and the
      intake check report are persisted per `INTAKE.md` `## Check`.
   3. Update `{board_dir}/MILESTONES.md` — place each new card, and **remove from its
      milestone's `**Cards:**` line every card you queued for `supersede`** (a superseded card
      can never be `done` — `INTAKE.md`'s terminal-card rule), putting its replacement (if any)
      in its place. Both `INTAKE.md` invariants must still hold across the board afterwards.
   4. Append the approved amendments to `{board_dir}/AMENDMENTS.md` (format below),
      creating the file if it does not exist.
   5. Commit everything as **one** Conventional Commit:
      `chore(kanban): add REQ-NNN — <title>` (or `amend` / `supersede` as fitting), ending
      with the project's `Co-Authored-By` trailer.

   The commit matters: `/kanban` drains the queue on a later pump, possibly in another
   session. An uncommitted amendment is a lost amendment.

7. **Hand off.** Tell the driver to run **`/kanban`** — it will drain the queue and
   schedule the new cards. If you queued no amendments, say so; the next pump just picks up
   the new cards.

## The amendment queue

`{board_dir}/AMENDMENTS.md` is a queue **you write and `/kanban` drains**. A missing file
means an empty queue.

One block per pending amendment:

```markdown
## CARD-007 — supersede
**Raised:** 2026-07-12 by /requirement
**Reason:** REQ-004 superseded by REQ-012 — export moves from CSV to XLSX, so this card builds the wrong thing.
**Action:** supersede
```

**Exactly two actions.** There is no third — do not invent one.

- **`supersede`** — the card is dead. `/kanban` will close any open PR, tear down the
  worktree and branch, and set `status: superseded` (terminal). Use when the card builds
  something the project no longer wants.
- **`revisit`** — the card is still wanted, but its scope moved. `/kanban` will set
  `status: blocked` with a blocker naming the REQ, leaving the branch, worktree and PR
  intact, and its blocked-card conversation asks the driver how to proceed. Use for
  everything that is not a clean kill.

There is deliberately **no "re-slice a card that already has code on its branch"** action —
that is `revisit` plus a human decision. Do not automate it.

`**Reason:**` is for a human reading it days later in another session: name the REQ ids and
say what actually changed.

## Rules

- **Intake only.** No branches, no worktrees, no code, no starting cards.
- **Never write a `card.md` that is not in `backlog`** — the ownership table above is the
  rule; in-flight cards are reached only through `AMENDMENTS.md`.
- **Never write `BOARD.md` or `KNOWLEDGE.md`.** `/kanban` owns them.
- **Never edit the spec directly.** `req-ids` is the sole authority for requirement
  identity; you supply the prose, it supplies the identity.
- **Never delete a requirement.** Superseding leaves it in place, marked. History is the point.
- Card doctrine lives in `INTAKE.md`. If a rule about slicing, typing, layering, `reqs`,
  `depends_on`, `right_sized`, or milestones seems missing here, it is there.
