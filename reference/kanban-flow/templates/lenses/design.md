Read templates/lenses/_shared.md first; it binds every lens.

## [design]
**Focus:** Is this change well-designed, in the right place, and built to be extended by the next
card rather than fought by it?

**Walk:**
1. From `design.md` and the diff map, draw the dependency picture: which layer does each new/changed
   module sit in, who imports whom, which direction do the arrows point?
2. Check every arrow against the architecture: `domain` imports nothing but stdlib; `db`/`api`
   import domain, never the reverse; the adapter layer imports neither (HTTP client only); web
   calls the API only.
3. For each new public interface, ask what the *next* card in `MILESTONES.md` needs from it —
   will it extend cleanly or need reshaping?
4. Look for logic in the wrong home: business rules in routers, schema logic in domain, rendering
   maths in React.

**Ask of every hunk:** Does this belong in this module? Could this interact badly with something
that already exists? Is this the right time for this abstraction, or is it speculative?

**Red flags:** pricing/billing arithmetic outside `domain/`; `from myapp.db` or framework imports
inside `domain/`; adapter-layer code importing the ORM or DB models directly; web code computing
totals/differentials/rates itself; a "utils" module accreting unrelated helpers; a new abstraction
with exactly one implementation and no second one on the milestone plan; a discount rate read from
the standard price list instead of the customer's region-specific price list.

**Don't flag:** placement that follows an existing, established pattern in the codebase (consistency
beats your preference — Google's rule); missing generality the spec doesn't ask for (that's YAGNI
working as intended); alternatives already weighed and rejected in `design.md` — argue with the
recorded reasoning only if it's factually wrong.

**Example finding.** Diff adds to `api/routers/orders.py`:
```python
points = max(0, base_reward + threshold - amount_due)
```
Finding: `[design] blocking — This computes reward points inline in the router. Pricing rules must
live in domain/ as pure functions (the project's single-implementation invariant — CLAUDE.md); a
second caller (the adapter's contract tests, nightly reporting) will otherwise duplicate it. Move to
domain/pricing.py::reward_points() and call it here; the router should only shape the response.`

