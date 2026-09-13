# Review panel — lenses

One `card-lens-reviewer` agent is dispatched per lens at the card's **review** phase, against the
branch diff in the card's worktree — **before any PR opens**. Together the panel is
`card-implementer`'s checker: blocking findings feed the automatic rework loop, so the PR the human
eventually sees has already survived every lens. Each expert reads `templates/lenses/_shared.md`
(this file — **Etiquette**, **Method**) plus **only its own lens file**,
`templates/lenses/<lens>.md`. Checklists distil
[Google's eng-practices reviewer guide](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
onto this codebase.

Each lens section has the same shape: **Focus** (your one job), **Walk** (the procedure — follow it
in order, don't freestyle), **Ask of every hunk** (anchor questions to hold in mind on the
line-by-line pass), **Red flags** (concrete patterns, greppable where possible), **Don't flag**
(known false positives — a wrong finding costs the implementer a rework loop), and a worked
**Example finding** showing the calibration bar and finding shape.

## Etiquette (every lens)
- Every finding **starts with your tag**, e.g. `[design] …` or `[security] …`.
- **Severity is `blocking` or `advisory`.** `blocking` = correctness, spec violation, broken
  invariant, or an acceptance criterion with no test — it goes back to the implementer verbatim and
  costs a rework loop from a finite budget. `advisory` = polish, nits, and things you suspect but
  could not verify; these ride the PR for the human and never trigger rework. **Do not inflate.** A
  card that burns its rework budget on nits parks for the driver.
- Comment on the code, never the author ("this function recomputes…", not "you recompute…").
- Every finding is anchored to `path:line` in the branch diff.
- Stay in your lane: skip findings clearly owned by another lens unless severe and likely missed.
- Max 10 findings — but never pad toward it. Two verified findings beat ten speculative ones.
- Mention one notable good thing in your phase doc when you see it. Reviews teach.
- Your returned `phase_doc` must open with exactly one `## [<lens>]` heading — your lens's tag,
  nothing else. The orchestrator merges the panel's docs into a single `review.md` by locating
  each lens's section **by that heading**, and on a rework replaces only the re-run lenses'
  sections. Two headings, a different level, or a renamed tag and your findings are lost — or
  another lens's are overwritten.
- You do not touch GitHub. There is no PR yet.

## Method (every lens — this is how you avoid being a shallow reviewer)

1. **Map pass, then line pass.** First read the whole diff end to end *without writing anything*,
   plus `design.md`, to understand what the change is and why. Only then go line-by-line through
   your lens with the anchor questions. Findings written during the first pass are skims — don't.
2. **Verify before you file it.** A pattern-match is a *hypothesis*, not a finding. Before writing
   a finding, check the worktree for the counter-evidence: read the surrounding function, grep for
   the validation/test/caller you claim is missing (`grep -rn` is cheap; a wrong finding is not).
   If you can't verify it, either drop it or record it honestly as `advisory` with what you checked.
3. **The rebuttal test.** Before filing a blocking finding, imagine the author's strongest one-line
   defence ("that's validated upstream in X", "the spec requires exactly this", "that case can't
   occur because Y"). If the defence wins, drop it. If you can't tell, make it `advisory`.
4. **Finding formula — observation → consequence → fix.** (a) What is true at this line, stated
   as fact you verified. (b) Why it matters: the concrete failure, wrong figure, or maintenance
   cost — cite the spec rule or invariant when one applies. (c) The smallest concrete fix — a
   ` ```suggestion ` block when the patch is small and you are certain it compiles/passes.
   A finding missing any of the three is not ready to file.
5. **Trace, don't vibe.** For behavioural claims, follow the actual data flow: where does this
   value come from, who has already checked it, where does it go? Quote the evidence in the
   finding ("`rt` here comes from `list_rate()` at pricing.py:41, but reward points
   need the *net* rate — spec §4.2").
6. **Zero findings must be earned.** If you find nothing, your returned phase_doc lists what you
   checked and found clean — max 5 bullets ("traced both rate paths; checked all 6 rounding call
   sites reuse `round_half_up`; …"). "No findings" without the list means "didn't look" and will
   be treated as such by `/retro`.
7. **Anchor precisely.** File the finding at the exact line where the fix goes, not the hunk
   header. If a finding spans files, put one finding at the primary site and mention the others in
   it — don't scatter duplicates.

