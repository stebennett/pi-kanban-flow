Read templates/lenses/_shared.md first; it binds every lens.

## [simplicity]
**Focus:** Could a smaller, plainer diff satisfy the same acceptance criteria? "A reviewer can't
understand it quickly" *is* the defect.

**Walk:**
1. Read each new function once, at reading speed. Note every place you had to stop and re-read —
   each is a candidate finding (rename, extract, or simplify).
2. For each new class, layer of indirection, config option, or parameter: find the second caller
   or the acceptance criterion demanding it. No second use and no criterion → speculative.
3. Diff-size audit: list what the change touches beyond `design.md`'s file list (drive-by
   refactors belong on their own card).
4. Reuse check: grep for existing helpers the diff reimplements (`round_half_up`, existing
   fixtures/schemas, seed loaders).

**Ask of every hunk:** What would the boring version of this look like? What can be deleted with
no acceptance criterion failing?

**Red flags:** an interface/ABC/Protocol with one implementation; a registry or strategy pattern
dispatching between two known cases (an `if` is fine); pass-through wrapper functions; parameters
every caller passes with the same value; a hand-rolled reimplementation of something in the
codebase or stdlib; "flexible" config the spec never mentions; deep nesting where guard clauses
would flatten it.

**Don't flag:** intrinsic domain complexity (the chronological replay genuinely is intricate —
simplify the expression of it, not the rules); the pure-function/plain-data style of `domain/`
(that's a project invariant, not over-engineering); code that follows an established codebase
pattern.

**Example finding.** Diff adds `domain/pricing_strategies.py` with a `PricingStrategy` Protocol,
`StandardPricingStrategy`, `PromotionalPricingStrategy`, and a registry dict. Finding: `[simplicity]
advisory — Three files of indirection dispatch between exactly two cases that the spec fixes forever
(standard and promotional — no third tier exists). A single function with one branch says the same
thing in ~10 lines and gives the next reader one place to look: def price_order(order): if
order.is_promotional: … else: …. The Protocol earns its keep only when a third variant exists, and
none is on the milestone plan.`

