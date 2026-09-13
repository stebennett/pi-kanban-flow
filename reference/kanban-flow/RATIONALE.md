# kanban-flow — design rationale

Design rationale for kanban-flow. Never dispatched to agents; read it when editing the plugin.

The operational rules live in the templates and agent files an agent actually reads
(`templates/AGENT-PROTOCOL.md`, `templates/checks/`, `templates/lenses/`, the `agents/` files). This
file holds the *why* behind the load-bearing ones — the arguments that justify a rule but that an agent
does not need in front of it to execute. Each section names the file and rule it explains.

## `templates/checks/_method.md` — why the checker contract is enforced, not requested

An LLM checking an LLM tends to rubber-stamp: handed a producer's artifact that argues its own case, a
checker that reads the argument first is only agreeing with it, and it will not notice that it is. The
whole check layer exists to counter that tendency, and two of its rules are *enforced* by the
orchestrator rather than merely stated, because a rule a checker can quietly skip is not a safeguard.

**Verdict-every-criterion (why an omission is malformed).** The orchestrator handed the checker its
exact id set, so it holds that set and compares the returned `criteria` table against it before doing
anything else. A table missing any id is a **malformed result**: the card does not advance, no gate is
applied, the doc is not persisted, and the checker is re-dispatched with the omitted ids named. A
`verdict: pass` over an empty or partial table is not a pass — it is a checker that did not check, and
it is caught. This is the mirror of the location rule: the location rule stops a checker *inventing*
findings; the completeness valve stops it *skimming*. A skim is the more dangerous of the two, because
a `pass` that checked nothing manufactures confidence. And it costs the producer nothing — an
incomplete check is the checker's failure, not a defect in the work, so it never spends the producer's
rework budget.

**Evidence over adjectives (why agreement must be earned).** A `pass` with thin evidence is worse than
no check at all, because it manufactures confidence where there was none. Each passing criterion's
evidence must state what was actually verified — not "looks fine". `/retro` reads these to tell
diligence from a skim.

## `templates/checks/split.md` — why `SPL-NO-LOSS` is the criterion that matters most

A splitter that silently drops code ships a broken card, and the defect is invisible to every slice's
own review — each slice looks complete on its own terms, so nothing downstream of the split would ever
catch it. `SPL-NO-LOSS` is also the guarantee that makes it safe for the lens panel to have reviewed
the whole diff *before* the split happened: if the union of the slices is exactly the change set the
panel approved, the slices are the code it already reviewed. `pr-splitter` is therefore a
**redistribution, not a rewrite** — never a second chance to change the code unreviewed. That is why
the check is set-equality in *both* directions (a deletion no slice performs is lost work exactly as
much as a dropped file), and why it is the one criterion a split check may never omit.

## `templates/checks/deliver.md` — why a `DLV-SIZE` breach is advisory, not blocking

The code is written and the PR is open. Re-dispatching `card-deliverer` cannot un-write it, so a
blocking verdict would burn rework budget against a remedy that does not exist at this phase. That is
why the breach is `advisory` — but deliberately not a shrug: the checker must propose a concrete split
in the finding's `remedy` (which commits or file groups become which smaller PRs, in what order), which
the orchestrator surfaces prominently for the driver, who decides whether to land the PR or split it.

**Why the card's own phase docs are excluded from the count.** The delivered diff also carries
`implement.md`, `test.md`, `review.md`, `pr-body.md` and `feedback.md` under the board dir. The budget
measures *the change a human must review, not the paperwork describing it*, and `estimated_lines` — the
number `actual_lines` is reported against — estimated code + tests only. Counting the docs inflates
every card against its own estimate and can breach `size_limit` on documentation volume alone, so they
are excluded even if a local `size_exclude` forgets to.

## `templates/AGENT-PROTOCOL.md` — why a design-phase agent records ADR proposals in its phase doc

Design-phase ADRs are written only once the design *check* passes, because the `adr` skill reserves a
number the moment it writes, and an ADR the checker rejects would burn one on a decision that gets
reworked. So the orchestrator holds proposed ADRs unwritten across the checker's whole dispatch — and a
pump can end inside that hold, at which point the only surviving copy of anything is what was persisted
to disk. A result block is not persisted; a `phase_doc` is. That is why a design-phase agent must write
each proposal out in full under a `## Proposed ADRs` section (title, context, decision, consequences,
any `supersedes`) **and** return it in `proposed_adrs`: the section is the durable copy the checker
verdicts and the orchestrator routes from, not a replacement for the field. Nothing load-bearing may
live only in a result block that the next pump will never see.
Why slice docs are written uncommitted in the primary checkout and copied onto the design
branch at the design transition, never committed to `main`: committing `slice.md` to `main`
puts it on the design branch's *base*, so the design PR's diff would not carry it — and
`DLV-DOCS`, which requires it to ride that PR, fails **blocking**, forever. Its remedy ("you
persist it yourself, commit the missing doc, no rework, no budget") is a no-op because the file
is already identical on the base; the check doc is deleted, the next pump re-checks and fails
identically. An unbounded livelock that spends no budget and never advances the card — and under
`/loop`, one that burns unattended. Uncommitted-in-the-primary-checkout, then copied at the
transition, is the *only* route that puts `slice.md` in the design PR's diff. This is also why
the state commit stages exact paths (`git add <path>`, never `git add -A`): a blanket stage
sweeps the deliberately-untracked slice docs onto `main` and triggers exactly this livelock. The
per-slice deliver-check filenames (`deliver-check-<k>.md`) exist against the same hazard: a
shared `deliver-check.md` is pre-present on the next slice's branch (cut from a `main` that
already carries slice `k`'s copy), so its "PR open + check doc absent" predicate is false and
slices 2..N ship unchecked. A **split parent** is the one exception — no branch will ever carry
its docs, so its `slice.md`/`slice-check.md` are its terminal record direct on `main`.
§5's completeness valve — the single most important safeguard in the check layer, because *an LLM
checking an LLM tends to rubber-stamp* — rejects any checker result whose check-doc `criteria:`
frontmatter map omits an id of its target's set. That comparison needs the set **in the
orchestrator's hands**, and *you cannot notice the absence of an id you have never seen.* Handing
the checker absolute paths to its `checks/` files is not the same as holding their contents: a
path lets the *checker* read the file; only the §1 read lets *you* audit what it returned. Skip
it and a checker answering 5 of 8 `DSG-*` ids with `verdict: pass` sails through the valve, the
gate, and into the design PR. (The fuller "enforced, not requested" argument is in the
`templates/checks/_method.md` section above; a skim is more dangerous than an invention because a
`pass` that checked nothing manufactures confidence.)
Both halves are load-bearing. **Before any PR exists**, there is no PR to close, re-target, or
rewrite — which is precisely what makes an *automatic* split (no driver gate) safe by
construction: the hazard a split would otherwise carry (destroying something a human is in the
middle of reading) does not exist; nothing has been published. **After the panel**, the carve
runs once, on final approved code. Run the splitter *before* the panel and every blocking finding
would change the code underneath the carve and stale it — file sizes shift, a fix drags code
across a slice boundary, a slice tips over budget — forcing a re-split on every rework pass.
Panel-first has no such loop. And nothing is lost by reviewing the whole diff first: `SPL-NO-LOSS`
requires the union of the slices to equal the original diff exactly, so the slices are
byte-for-byte the code the panel already approved. The splitter is a **redistribution, not a
rewrite.**
Every diff in the split layer names the branch (`origin/main...<original-branch>`), in the
orchestrator and in **both** the splitter and its checker. A worktree can be moved by any agent,
and a pump can die at any moment and leave it moved; a `HEAD` on a scratch branch is a *strict
subset* of the card's work. A checker re-deriving from the same wrong `HEAD` agrees with it and
passes — an independent check from a corrupted premise is not independent, and would certify
`SPL-NO-LOSS` on a carve that omitted every file of slices `k+1..N`.
Three deliver remedies (`DLV-BASE`/`DLV-BODY-TRUE` on either PR, `DLV-DOCS` on the design PR) have
the orchestrator fix the problem itself and re-arm the check, spending **no** budget. Every other
loop is bounded by `check_budget`; unbounded, these three cycle forever whenever the checker's
finding is wrong or the fix is a no-op, and no budget is consumed so nothing ever stops them. The
`## Notes` self-fix entry is the *only* thing that survives a pump boundary (the fix itself is on
GitHub or the branch, and the check doc is gone), so it is what makes a second failure detectable
from disk alone. The cap turns the second identical failure into a park (`check failed — <id>
(self-fix did not clear it)`) rather than an infinite re-fix — and the park spends no budget
either, because the point is to stop the loop, not to tax the producer for the checker's or the
orchestrator's own mistake.
`check_budget.deliver` is documented per PR and `reworks.implement` is spent per slice PR. A split
card ships N implementation PRs; without the resets, slice 1 burning its loops would leave slices
2..N with **zero** — the first finding on slice 2 would park the card with no rework attempted, on
a card whose only sin was being big enough to split. A red slice-2 CI is not slice-1's fault, and
the code is a different diff. Nothing is lost by the resets: the evidence is durable on `main` in
the per-slice check docs (`deliver-check-<k>.md`) and `implement.md`'s `## Rework` sections, where
`/retro` reads it — the counter is an allowance, not the record.

## `agents/pump-gate.md` — why a two-pass gate, and why haiku is safe for it

Under `/loop` most pumps have nothing to do, and the old §0.5 idle fast path decided that *inside* the
Opus session — after the ~14k-token SKILL body was already in context, with its probe tool-calls and the
reasoning over them accruing on the expensive tier. `pump-gate` relocates that exact predicate into a
dispatched **haiku** subagent run **ahead of §0**: the probes and the decision land on the cheap model,
and the orchestrator loads reconcile/cards/doctrine only once the gate returns `run`. On a quiet board
that is the recurring cost removed.

**Why the pump body is a separate file (`references/pump.md`), not the front-door `SKILL.md`.** The gate
moves the *probes* off the Opus tier, but a skill loads its whole `SKILL.md` on trigger — so if the §0–§7
state machine lived in `SKILL.md` it would enter the Opus context on every idle pump anyway, and "loads
the board only on `run`" would be a half-truth. Splitting the body out makes it literal: `SKILL.md` is a
lean front-door (frontmatter + the §0.0 gate), and the ~700-line body lives in `references/pump.md`, read
via the same on-demand pattern as `reconcile-edge-cases.md`/`split-shipping.md` — **only** when the gate
returns `run`. An idle pump now loads the lean front-door and one haiku dispatch, nothing more. The two
existing reference files cross-referenced the body as `SKILL.md §N`; those pointers moved to `pump.md §N`
with the body (the section numbers are unchanged), and §0.0 alone stays in the front-door because it is
what decides whether `pump.md` loads at all.

**Why haiku is safe here even though the README says "Haiku: don't" for the orchestrator.** That warning
is about the orchestrator's *stateful judgment* — stamping verdicts, adjudicating dropped findings, the
completeness valve — where a weaker model rubber-stamps. The gate does none of that. It **writes no board
state and mutates no card**; it only returns run-vs-idle, and the orchestrator re-derives everything
authoritatively in §0 regardless. A gate is a filter, not a source of truth, so the tier that is wrong
for the orchestrator is right for the gate.

**Why the decision is the OR of every trigger, and why "no free slots" is not "idle".** The request's
headline — merges landed + a slot free → run; no slots → stop — is the *scheduling* dimension only,
governing whether **new backlog work** can start. But an in-flight card advancing, an open PR's failing
CI, and an unaddressed review all run inside a slot the card **already holds** and need no new slot. So
the verdict ORs in the full §0.5 trigger set (merge, ci_fail, review_pending, dispatchable,
free_slot_ready_backlog, driver, amendments); "no free slots" contributes to a stop only when there is
also nothing in-flight to advance, no CI/review, no driver item, and no amendment — i.e. genuinely idle.
A gate that stopped on "no slots" alone would freeze every in-flight card and every open PR mid-flight.

**Why it errs toward `run`, and why a dispatch failure is `run`.** The two failure modes are asymmetric:
a false *idle* silently starves the board under `/loop`, unattended, with nobody watching; a false *run*
costs exactly one pump and the orchestrator then finds nothing and stops. So every ambiguity — an
unreadable probe, a gate dispatch that errors — resolves to `run`. This is the same "when in doubt, run"
rule §0.5 carried, now enforced from the gate's side.

**Why the gate skips §0 on idle, and what that defers.** On `run` the full §0–§7 runs unchanged; on
`idle` the orchestrator stops before §0 reconcile. Every actionable reconcile trigger — a merge, a closed
PR, a non-empty `AMENDMENTS.md` — is one of the gate's probes, so skipping §0 on idle skips only work
that is provably absent. The one thing the gate does **not** probe is §0's legacy normalization (scalar
`pr_url`, `status: plan`, verdict-less docs); that is idempotent one-time drift from a pre-upgrade board,
not time-sensitive, and it is picked up by the first pump the gate lets through once any real work
arrives. `pump_gate: off` restores the always-reconcile behaviour for debugging.

**Why the gate's `git fetch` is not wasted.** Subagents share the working tree, so the gate's `git fetch
origin main` updates the local refs the orchestrator reads next — §0's fetch reuses them. The gate may
also hand forward `summary.merged_urls`/`ci_failing_urls` so §0/§6 skip re-probing those PRs; that is an
optimization the orchestrator can trust or re-derive, never a dependency.

## `templates/config.md` — config tunables

**Why there is no `checks.implement` switch.** Every other producer's checker can be turned off as an
escape hatch, but the implementer's checkers are `card-tester` and the lens panel — an off switch there
would silently skip running the test suite, not merely relax a review. The implement chain is
unconditional by construction: a card that reaches `deliver` has been tested and reviewed, always.

**Why `check_budget.deliver`/`split` default to `1`, and are spent per PR.** A deliver check that fails
twice is failing on something another rework pass will not fix; a split that fails `card-split-checker`
twice means the carve itself is unworkable, not that a third attempt finds one — `pr-splitter` is a
safety net, not a routine path, so the card falls back to `SPL-NO-LOSS`'s refusal and ships as one
oversized PR. `deliver` is allowed **per PR**, not per card: a card ships a design PR then an
implementation PR, and a split card ships N slice PRs, each with its own deliver check and the full
allowance. `/kanban` makes that real by resetting `reworks.deliver` (and `reworks.implement`) to `0` at
each PR boundary and again on each slice merge with slices still to come — without which slice 1 burning
its loops would leave slices 2..N with none. (The reset's livelock hazards are in the AGENT-PROTOCOL
section above.)

## `review_panel` + slice-mode acceptance tiering

**Why the reduced panels are safe-ish, and why `full` stays the default.** The full panel runs nine
lenses; most of a low-risk diff's risk is caught by a handful of them. `standard` keeps acceptance
(does it meet the criteria), functionality (is it correct), tests (is it covered) and security, plus the
language lenses — dropping design, simplicity and readability, the quality-of-code lenses whose findings
are advisory-shaped more often than not. `light` drops tests and security too, down to acceptance +
functionality + the language lenses: appropriate only where a human is close behind the work. Neither is
the default, because a missing key must reproduce today's behaviour byte-for-byte — a repo that never
sets `review_panel` gets the full nine-lens table exactly as before — and because the panel's blast
radius (it reviews the whole diff, and a `gate_layer` card encodes the rules most expensive to get
wrong) makes `full` the right default for the cards that matter. A `gate_layer` card knocked down to a
reduced panel is therefore warned in the report rather than silently under-reviewed.

**Why slice-mode `[acceptance]` dropped from opus to sonnet.** The whole-diff panel already reviewed the
code — on opus, across every lens — before the carve. The per-slice `[acceptance]` re-run after a split
asks a narrower question: does slice *k* trace to the acceptance criteria it claims, and does it stand
alone? That is a containment-and-tracing check over already-reviewed code, not a fresh code review, and
the orchestrator stamps the verdict either way. Sonnet is sufficient for it, and the slice panel fans
out one reviewer per slice — the tier that multiplies most. The whole-diff acceptance lens stays on
opus; only the post-carve re-run moves. This is the one deliberate default-behaviour change of the
config-knobs PR.

## `/retro` — why the estimator populations are tallied separately, and why the inbox is an index

**Two estimators, aimed separately.** `estimated_lines` on a card was set by whichever estimator
actually made the call: the **slicer** for a card that went through the slice phase (verified under
`SLC-SIZE`), or **`card-intake-checker`** under `INT-SIZED` for a card that arrived `right_sized:
true` and never saw a slicer (a split child is sized once by the slicer and never re-sized). A
`DLV-SIZE` breach is by definition a wrong estimate — but proposing a fix to the *slicer's* prompt
for a miss `INT-SIZED` made changes nothing and the miss recurs, so the two populations are counted
apart and the remedy aimed at the estimator that made the call. `pr-splitter` firing rides the same
logic: it only runs when a reviewed branch still measured over `size_limit`, i.e. the pre-code
estimate was wrong enough to need surgery after the code was written — every firing is an estimator
miss, the symptom not the disease, so the fix belongs in the estimator's prompt, never the
splitter's. A refusal is different in kind: whole-file slices could not be carved without cutting a
file or landing a red slice, which is a *design* signal (entangled code), not a volume one — a
bigger `size_limit` would not have helped.

**Producer, not more checking.** A criterion that fails on most cards means the checker is right and
the producer is systematically wrong; adding more checking there only builds a permanent rework tax
on a defect nobody fixes at source. The remedy is always an edit to that producer's prompt or the
doctrine it reads.

**The inbox is an index, not a replacement.** `RETRO-INBOX.md`'s one-line-per-card summary exists to
let `/retro` skip the deep read on a card whose flags are all clean — not to substitute for the
phase docs, check docs, feedback.md, PR threads, or intake reports on a card that flags something.
Coverage stays verifiable because `RETRO.md` still records every channel per covered card, empties
included; a card the inbox waved through is recorded covered, and a channel skipped on a flagged
card is still a visible gap.

## Test levels — why conditional criteria, a per-card marker, and a sonnet tester

**Conditional ids.** `DSG-LEVELS/SEAMS/DATA` join the held design id set only when
`testing.levels` is configured, so the completeness valve stays exact in both regimes: an
unconfigured board's checker isn't asked to verdict criteria that cannot apply, and a configured
board's checker can't skip them. The alternative — always-present criteria verdicting `na` — would
make `na` ambiguous between "checked, doesn't apply" and "project never opted in", poisoning
`/retro`'s deferral tally.

**The `### Levels` block is the per-card regime marker.** Downstream conditionals (tester level
gates, the `tests` lens exemption arms) key on its presence in `design.md`, never on config — so a
project opting in mid-flight strands nothing: cards designed before opt-in carry no block and run
the legacy path end-to-end; no agent needs config access to know which regime a card is under.

**Tester on sonnet only when levels are configured.** Running gates and reading exit codes is
haiku work; environment lifecycle and four-way failure classification (product/test/environment/
flake) are judgement. It is a per-card dispatch, not a per-lens multiplier, so the cost is bounded
and reversible by de-configuring.

## The `[experience]` lens — why static-only

A lens runs in a worktree with a diff; axe scans and Web Vitals need a running app — putting them
in a lens either silently no-ops or drags environment provisioning into the review panel, the
plugin's costliest phase. So the split: static review (states, selectors, keyboard, structure) is
lens work; runtime measurement is a `scope: pr` CI gate triaged by §6a; judgement (rubric
walkthroughs, annotated screenshots) is advisory and human — an agent gate that judges UX
auto-passes garbage or auto-blocks taste. The lens dispatches under every `review_panel` tier for
`web`-layer cards because a reduced tier that silently drops the one lens web cards exist for is a
foot-gun, mirroring the gate-layer warning pattern.
