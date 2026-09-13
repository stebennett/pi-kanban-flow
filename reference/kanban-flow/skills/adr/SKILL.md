---
name: adr
description: Persist Architecture Decision Records (Cognitect format) into docs/adrs, linked to the producing kanban card. Invoked only by /kanban when a phase agent proposes ADRs. Authority for ADR format, numbering, supersede.
---

# adr — write an Architecture Decision Record

You hold **sole-writer** authority for everything under `docs/adrs/`. Phase agents only
*propose* ADRs (they cannot write files); you persist them in the Cognitect lightweight
format (**Title · Context · Decision · Status · Consequences**) and link them to the card.

## Inputs you receive

The `/kanban` orchestrator hands you a **vetted** set — you persist it, never deciding
*whether* to write (gate timing and idempotency are the caller's, documented in the kanban
skill):

- `card_id` (e.g. `CARD-015`) and today's date (ISO).
- `proposed_adrs` — already filtered so only proposals the card's `adrs:` list does not yet
  account for reach you (on a design card, only after the design check passed). Each:
  `title`, `context`, `decision`, `consequences`, optional `supersedes: [<ADR ids>]`.
- the **write-target worktree** — ADRs land on the card's branch and merge via its PR (a
  design-phase ADR rides the design PR).

## What an ADR is for

Only **significant** architecture/technology decisions: a framework/library choice, a
data-model invariant, a cross-cutting pattern, a notable trade-off — anything expensive to
reverse. A proposal that is really a minor convention goes to `KNOWLEDGE.md ##
Conventions` (traps → `## Gotchas`), not an ADR.

## Storage layout

ADRs live under `adr_dir` (`config.md`, default `docs/adrs/`):

```
docs/adrs/
  README.md            # index table — you maintain it
  template.md          # canonical skeleton (do not edit per-ADR)
  NNNN-<kebab-title>.md # one file per ADR
```

## Procedure — per proposed ADR, applied serially in order

1. **Allocate the number.** `NNNN = max(ADR numbers) + 1`, zero-padded to 4 digits. ADR
   files land via card **branches**, so the max spans **both** registers: the `NNNN-*.md`
   files under `docs/adrs/` on `main` **and** every id in any card's `adrs:` frontmatter
   (an `adrs:` id reserves a number whose file is still in flight on a branch). `/kanban`
   runs serially, so no further locking is needed.
2. **Write `docs/adrs/NNNN-<kebab-title>.md`** in the **card's worktree** from `template.md`:
   - frontmatter: `id: ADR-NNNN`, `title`, `status: Accepted`, `date: <today ISO>`,
     `card: <card_id>`, `supersedes: [<ids or empty>]`, `superseded_by: ""`.
   - body: `# ADR-NNNN: <title>`, then `## Context`, `## Decision`, `## Status`
     (`Accepted`), `## Consequences` from the proposal.
   - `<kebab-title>` = title lower-cased, non-alphanumerics → single hyphens.
3. **Handle supersede.** For each id in `supersedes`: copy that ADR from `main` into the
   worktree if absent, set frontmatter `status: Superseded` + `superseded_by: ADR-NNNN`,
   change its `## Status` body line to `Superseded by ADR-NNNN`, and update its index row.
4. **Update the index** (`docs/adrs/README.md` in the worktree, from `main`'s copy):
   append or refresh one row, kept in ascending ADR order —
   `| [ADR-NNNN](NNNN-<kebab-title>.md) | <title> | <status> | <card_id> | <date> |`.
5. **Bidirectional link.** Append `ADR-NNNN` to the card's `card.md` `adrs:` list
   (create the entry if empty). This one `card.md` write goes **direct to `main`**
   with the pump's state commit, reserving the number while the file travels via the PR.

Worktree writes ride the card branch's next `docs(card)` commit; the `card.md` link rides
the pump's `chore(kanban): …` state commit on `main` — no separate commits.

## Rules

- ADRs are **immutable** once `Accepted` — never edit Context/Decision/Consequences. A
  reversal is a **new** ADR that `supersedes` the old; only the old one's status fields
  change.
- `status` is exactly one of `Accepted | Superseded | Deprecated` — `Deprecated` for a
  decision dropped without a replacement.
- Every ADR MUST carry a `card:` link; ADRs are only minted through the card lifecycle.
- You never invent decisions — you only persist what a phase agent proposed.
