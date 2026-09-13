Read templates/lenses/_shared.md first; it binds every lens.

## [functionality]
**Focus:** Does the code do what the PR intends, and is that behaviour right for users and for
future developers — especially at the edges?

**Walk:**
1. Restate (to yourself) each acceptance criterion from `design.md`; find the code path that
   satisfies it; follow that path with real values, by hand, at least once.
2. Run the edge-case sweep against every calculation the diff touches: exact `.5` values; rating
   clamps at the valid range's floor/ceiling (0/100); voided/missing line items; single-item vs
   multi-item orders; no-rating-established-yet (a wider provisional cap); the 20th vs 21st order;
   same-date orders; an order whose price list was later edited (snapshot semantics).
3. For every rate value, trace which path it came from: the list rate (100%) → caps/adjusted
   totals/differential; the net rate (list rate × the account's discount allowance) → the
   customer-facing reward points. Confirm each consumer got the right one.
4. For writes: what recomputes? A confirmed-order edit must replay every later order; a
   draft-order change must not touch confirmed figures.

**Ask of every hunk:** What input makes this line wrong? Who calls this with data the author
didn't picture? Is this ordering deterministic?

**Red flags:** `sorted(...)` on date alone (same-date orders need a tiebreaker — date then id);
slicing for "most recent 20" without confirming sort direction; rates read from the live price
tables at billing time instead of the order's stored snapshot; "today's" rating used for a
historical order's figures; `if item_count == 1` with a bare `else` silently absorbing bundle and
other multi-item orders; float equality or `pytest.approx` on money figures; off-by-one in a
proration table (last unit vs first, half-period boundary).

**Don't flag:** behaviour that matches a spec rule you find surprising (verify against the spec's
worked examples before commenting — the spec wins); edge cases `design.md` explicitly scopes out
to a later card (check `## Out of scope` first).

**Example finding.** Diff in `domain/loyalty.py`:
```python
recent = sorted(orders, key=lambda o: o.placed_on)[-20:]
```
Finding: `[functionality] blocking — Orders placed on the same date have no tiebreaker here, so the
selected "most recent 20" set (and therefore the loyalty rating) is nondeterministic across runs —
the test fixtures have single-date orders, which is why nothing catches it. Sort by (placed_on, id):`
```suggestion
recent = sorted(orders, key=lambda o: (o.placed_on, o.id))[-20:]
```

