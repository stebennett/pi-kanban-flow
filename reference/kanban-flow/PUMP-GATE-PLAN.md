# Plan — first-pass Haiku pump gate

A design plan for adding a cheap Haiku "pre-flight" agent that decides whether a full `/kanban` pump is
worth running, so a quiet board under `/loop` stops spending Opus context on pumps that would do nothing.

Status: **Part A + Part B implemented** (plugin `0.6.0`). Part A: the `pump-gate` haiku agent + SKILL.md
§0.0 + `pump_gate` config knob. Part B: the §0–§7 pump body moved to `references/pump.md`, loaded only on
a `run` verdict, leaving a lean front-door `SKILL.md`; the two existing reference files' cross-references
were repointed from `SKILL.md` to `pump.md`.

---

## 1. Problem

`/kanban` is invoked once per pump cycle, and under `/loop` it re-runs every interval. Each invocation:

1. Loads the whole `skills/kanban/SKILL.md` into the session (~14k tokens) — unavoidable on skill trigger.
2. Runs the §0 reconcile probes (`git fetch`, per-PR `gh pr view`).
3. Runs the §0.5 **idle fast path** — more probes (PR CI/reviews, card-frontmatter and check-doc scans)
   to decide whether anything is actionable; prints `idle …` and stops if not.
4. Only then, on a live board, runs §1 (full card parse, doctrine, id sets) → §7.

The optimization series so far (idle fast path, `references/` on-demand loading, agent trimming) cut the
cost of a pump, but every idle pump *still* pays for: the full SKILL body in context, plus a chain of
probe tool-calls **and the reasoning over them, all in the expensive Opus session.** On a quiet board —
the common case under `/loop` — that is the dominant recurring spend, and it is still too high.

## 2. Goal

Move the "is a pump even worth running?" decision **out of the Opus session and into a cheap, minimal
Haiku context.** The Opus orchestrator should load the heavy pump machinery only once a first pass has
confirmed there is real work. Concretely, per the request:

- The first pass determines whether **open PRs have been merged** and whether **any WIP slots are free**.
- **Merges landed + a slot free → trigger a full pump.**
- **No slots (and nothing else to do) → stop cheaply**, before any pump context loads.

## 3. What already exists (and why it isn't enough)

- **§0.5 idle fast path** already encodes the exact "is there work?" predicate. But it lives *inside*
  SKILL.md and executes in the Opus session **after** the full body is loaded — so it cannot save the
  body load, and its probes/reasoning accrue in the expensive context. The gate is, in effect, §0.5
  **relocated to a cheap subagent and moved ahead of §0** so its cost lands on Haiku, not Opus.
- **The `references/` on-demand pattern** (`reconcile-edge-cases.md`, `split-shipping.md`) already lets
  SKILL.md defer bodies of text until a trigger fires (the model `Read`s them only when needed). Part B
  below reuses this pattern to defer the *pump body itself*.
- **Subagents share the working tree.** A Haiku gate that runs `git fetch origin main` updates the local
  refs the Opus session reads next — so the fetch is reused by §0 reconcile, not duplicated.

## 4. Design

Two coordinated parts. **Part A (the gate)** is the requested change and is self-contained. **Part B
(deferred body)** is the follow-on that cashes in the gate's full benefit; recommended, but separable.

### Part A — the `pump-gate` Haiku agent

A new dispatched agent, `agents/pump-gate.md`, `model: haiku`, `tools: Read, Grep, Glob, Bash`. It is
the **first action** of every pump. It reads only what a run/idle decision needs, in its own context, and
returns a structured verdict. It writes **no** board state and makes **no** judgment that mutates a card
— it only decides run vs. idle, with a safe bias.

**Inputs (from the dispatch):** `board_dir` (default `docs/cards`), and nothing else it can't cheaply
read itself. It reads `config.md` for `gh_command` and `wip_limit`, then scans card frontmatter and
check-doc headers via `ls`/`grep` — **never a full card parse**, exactly as §0.5 does today.

**Probes (the §0.5 set, verbatim in intent):**

1. **Merges** — `git fetch origin main`, then scan `git log origin/main` merge subjects for
   `CARD-NNN … (#N)` matching any card's `design_pr_url`/`pr_urls`.
2. **PR states / CI / reviews** — one `{gh_command} pr view <url> --json state,statusCheckRollup,reviews,comments`
   per not-yet-merged url: any newly `MERGED`/`CLOSED`? any open PR with a **failing check**, or a
   **human review-complete signal not yet marked addressed** (no top-level `[kanban] review addressed —
   <id>` marker)?
3. **Card frontmatter + doc presence** — via `ls` + `verdict:` header greps (not a full parse): any card
   **dispatchable** (a `backlog` card with deps `done` and a free WIP slot; an in-flight card whose next
   phase doc is absent, or whose check doc reads `verdict: fail` with budget left)? any card needing the
   **driver** (a gate awaiting an answer, a `blocked` card, a `needs-input`)? Is `AMENDMENTS.md` non-empty?

**Decision — RUN if ANY trigger holds, else IDLE:**

| trigger | maps to the request as |
|---|---|
| a merge landed on `origin/main` | "open PRs have been merged" → reconcile + freed slot |
| a not-yet-merged PR is now `MERGED`/`CLOSED` | same |
| an open PR has failing CI | §6a work inside a **held** slot |
| an open PR has an unaddressed review-complete signal | §6b work inside a **held** slot |
| an in-flight card can advance (next phase doc absent, or check `verdict: fail` + budget) | advancing a held slot |
| a **free** slot **and** a ready backlog card exist | "slots available" → start new work |
| a card needs the driver (gate / blocked / needs-input) | driver attention |
| `AMENDMENTS.md` non-empty | drain the queue |

**Correctness constraints (this is where a naïve gate breaks the flow):**

- **"No free slots" is *not* "idle" on its own.** An in-flight card advancing, an open PR's failing CI, an
  unaddressed review — all happen inside a slot the card **already holds** and need **no** new slot. The
  request's "no slots → stop" is the **scheduling** dimension only (whether to *start* new backlog work);
  the verdict is the **OR of every trigger**, so "no slots" contributes to a stop only when there is also
  nothing in-flight, no CI/review, no driver item, and no amendment — i.e. genuinely idle.
- **Err toward RUN.** A false *idle* silently starves the board under `/loop` (unattended, nobody
  notices); a false *run* costs one pump. The asymmetry is the whole safety argument — **when in doubt,
  run**, identical to today's §0.5 rule.
- **The gate mutates nothing.** No verdict stamping, no reconcile teardown, no state commit. Those stay in
  the Opus orchestrator, which re-derives authoritative git state in §0 regardless. This is why Haiku is
  appropriate here even though the README says "Haiku: don't" for the **orchestrator** — that warning is
  about stateful judgment (verdict stamping, the completeness valve); a read-only, run-biased gate carries
  none of it. Reconcile the note in the README rather than contradict it.

**Return (structured `result` block):**

```yaml
decision: run | idle
reasons: [merge, ci_fail, review_pending, dispatchable, free_slot_ready_backlog, driver, amendments]
summary:
  in_flight: M          # cards in slice|design|implement|test|review|deliver
  backlog: K            # ready + not-ready backlog cards
  wip_limit: 3
  free_slots: N
  merged_urls: [...]    # newly-merged PR urls, if any — lets §0 skip re-probing
  ci_failing_urls: [...]
```

`summary.in_flight` / `summary.backlog` feed the Opus idle report line verbatim, so the orchestrator can
print `idle — M in flight awaiting human/CI, K in backlog` **without loading a single card.**

### SKILL.md integration

Insert a new **§0.0 Pre-flight gate** ahead of §0 (Reconcile):

1. **Dispatch `pump-gate` (haiku) as the first action**, passing `board_dir`.
2. `decision: idle` → print the idle line from `summary` and **STOP**. Nothing else loads.
3. `decision: run` → proceed to §0. `summary.merged_urls`/`ci_failing_urls` may be threaded into §0/§6 to
   skip re-probing PRs the gate already resolved (optional; reconcile re-derives git state either way).

**Remove the standalone §0.5** and fold its probe list into `pump-gate.md`. Keeping both invites drift
between two copies of the predicate; the gate becomes the single source of truth for "is there work?",
and deleting §0.5 is itself a net reduction of the SKILL body. Register `pump-gate` in the §5
dispatch/model table (`pre-flight | pump-gate | haiku`) and in the model-pinning paragraph.

### Part B (recommended follow-on) — defer the pump body

Part A moves the *probes* off Opus, but the ~14k-token SKILL body still loads on every idle pump, so it
becomes the dominant remaining idle cost. To cash in the full saving, split SKILL.md:

- A **lean front-door SKILL.md**: frontmatter + the §0.0 gate dispatch + idle handling + a single
  instruction: *"on `decision: run`, `Read references/pump.md` and execute §0–§7 from there."*
- `references/pump.md`: the current §0–§7 orchestration body, loaded **only on a run verdict**, via the
  same on-demand pattern as `reconcile-edge-cases.md` / `split-shipping.md`.

Then an **idle pump loads only the lean SKILL + one Haiku dispatch** — the full state machine never enters
the Opus context. This is a larger refactor (the whole state machine relocates) with real correctness
risk, so it is presented separately and can land after Part A is validated.

## 5. File-by-file changes

**Part A (core):**

- `agents/pump-gate.md` — **new.** Haiku agent per §4: inputs, probe set, decision predicate,
  err-toward-run bias, structured return. Mirror the house style of `card-tester.md`.
- `skills/kanban/SKILL.md` — add §0.0 pre-flight gate; **remove §0.5** (folded into the agent); register
  `pump-gate`/`haiku` in the dispatch/model table and the model-pinning note; tweak the frontmatter
  `description` to mention the pre-flight gate if it helps triggering.
- `RATIONALE.md` — new section *"why a two-pass gate, and why Haiku is safe for it"*: the
  in-flight/CI/review-not-gated-by-slots constraint, the err-toward-run asymmetry, the shared-fetch reuse,
  and the reconciliation with the "Haiku: don't" orchestrator warning.
- `README.md` — update the idle-fast-path cost narrative (§ "Which model to run under `/loop`") to
  describe the Haiku pre-flight gate; clarify that "Haiku: don't" is about the orchestrator, not the gate.
- `.claude-plugin/plugin.json` — version bump `0.5.0` → `0.6.0` (a feature).

**Part A (optional):**

- `templates/config.md` — add a `pump_gate: on | off` tunable (default `on`) as a debugging escape hatch;
  SKILL §0.0 skips the gate and runs §0 directly when `off`.

**Part B (follow-on, separate change):**

- `skills/kanban/SKILL.md` → lean front-door; `references/pump.md` → the §0–§7 body.

## 6. Migration & versioning

- **No board migration.** Agents live in the plugin and are never copied into a board's `docs/cards/`;
  the §1 migration check concerns board-dir doctrine copies only. A repo picks up `pump-gate` simply by
  updating the plugin. Confirm `/migrate` needs no new step.
- Config gains at most one **optional** key with a safe default, so existing `config.md` files keep
  working unchanged (missing `pump_gate` → `on`).
- Version → `0.6.0`.

## 7. Risks & mitigations

| risk | mitigation |
|---|---|
| Gate false-*idle* starves the board | Err-toward-run bias; the verdict is the OR of every §0.5 trigger, not just merges/slots; "when in doubt, run". |
| Predicate drifts from the real one | Gate becomes the **single** source of truth (§0.5 deleted); RATIONALE pins the invariant. |
| Haiku misreads a CI/review signal | These are mechanical json-field / marker-presence checks, not judgment; ambiguity resolves to *run*. |
| Extra dispatch adds latency to busy pumps | One cheap Haiku call amortizes trivially against a full pump; the win is on the *idle* majority. |
| Gate's `git fetch` wasted | Shared working tree — §0 reconcile reuses the fetched refs. |

## 8. Validation

No test runner exists (per CLAUDE.md); validate by installing the plugin and exercising it:

1. **Quiet board** → gate returns `idle`; confirm Opus prints the idle line and loads no cards
   (token count of an idle pump drops to ~lean-SKILL + one Haiku dispatch).
2. **A PR merged since last pump** → gate returns `run` (reason `merge`); §0 reconciles, a freed slot
   starts a ready backlog card.
3. **All slots full, an in-flight card's next phase doc absent** → gate returns `run` (reason
   `dispatchable`), **not** idle — proves "no free slots" alone does not stop the pump.
4. **Open PR with failing CI, all slots full** → gate returns `run` (reason `ci_fail`) — proves §6 work
   inside a held slot still triggers a pump.
5. **All slots full, no in-flight work, no CI/review/gate/amendment** → gate returns `idle` — the
   request's "no slots → stop" case.
6. **Ambiguous frontmatter** → gate returns `run` (err-toward-run holds).

## 9. Rollout

1. Land **Part A** alone; watch the first several loops on a real board, comparing idle-pump token counts
   before/after and confirming no needed pump is skipped (cross-check gate `idle` verdicts against a
   forced full pump on the same state).
2. Once Part A is trusted, land **Part B** (deferred body) for the full idle-pump saving.
3. Keep `pump_gate: off` as the fallback if a gate misfire is ever suspected in the field.
