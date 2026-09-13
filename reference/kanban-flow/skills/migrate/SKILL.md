---
name: migrate
description: "One-time, idempotent cutover upgrading an older kanban-flow repo to plugin-owned doctrine: delete stale copies, fold customizations into PROTOCOL-ADDENDUM.md, preserve templates via template_overrides, add config keys, stamp version, open a PR."
---

# /migrate — bring an existing repo onto plugin-owned doctrine

Older `/kanban-init` runs copied the doctrine (`AGENT-PROTOCOL.md`, `REVIEW-LENSES.md`,
`CHECK-CRITERIA.md`) and the templates (`card-template.md`, `pr-template.md`,
`design-pr-template.md`) into `<board_dir>`. Those files are now **plugin-owned** and read
live, so the copies are stale and ignored — and any **local customization** in them (e.g.
`/retro` edits) silently stops taking effect. This one-time, **idempotent** cutover retires
the copies while preserving anything local, and stamps the repo current.

Resolve `board_dir` from the argument, else `docs/cards`. The plugin's current files live at
`${CLAUDE_PLUGIN_ROOT}/templates/`; the plugin version is the `version` field of
`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`. You write only inside the target repo, on
a migration branch, never the plugin.

## Steps

1. **Resolve + detect.** Read `<board_dir>/config.md`: its `kanban_flow_version` (empty on a
   pre-versioning repo) and its `template_overrides`. Read the installed plugin version. Scan
   `<board_dir>` for leftover plugin-owned copies: `AGENT-PROTOCOL.md`, `REVIEW-LENSES.md`,
   `CHECK-CRITERIA.md`, `card-template.md`, `pr-template.md`, `design-pr-template.md` — but a
   template file already registered in `template_overrides` (pointing at that path) is a
   deliberately-preserved override, **not** a leftover; only an *unregistered* copy counts.
   `REVIEW-LENSES.md` and `CHECK-CRITERIA.md` are legacy plugin-side names deleted from the
   plugin at 0.5.0 — a repo copy of either is now unambiguously a leftover. Also check
   each `docs/cards/CARD-*/card.md` for a legacy scalar or missing `reworks`, a `reworks` map
   missing the `split` key, or a scalar `pr_url` (present or absent) — each is a Step 6 rewrite
   that has not run. Compare the plugin's current `config.md` frontmatter keys against the
   repo's to detect any missing (additive-only). Check the addendum's plugin boilerplate for
   staleness (Step 3a): a `## Check criteria` intro whose target enum lacks `split`, or a header
   missing the size-budget line.
   **If the version is already current AND no unregistered copy is present AND no card needs its
   frontmatter migrated AND no config key is missing AND the addendum boilerplate is current →
   report "already migrated" and stop** (do
   nothing destructive). Detect the work itself, not just the version stamp — it records what a
   previous run *intended*, not what it *achieved*.

2. **Branch.** Create `task/migrate-<plugin-version>` off the current branch — every
   change rides one PR. Never commit migration changes straight to `main`.

3. **Ensure the addendum exists.** If `<board_dir>/PROTOCOL-ADDENDUM.md` is absent (an
   older repo never had one), create it from
   `${CLAUDE_PLUGIN_ROOT}/templates/PROTOCOL-ADDENDUM.md` first, so Step 4's appends have
   a home.

   **3a. Refresh its plugin boilerplate (0.5.0).** The addendum's un-headed intro and the
   `## Check criteria` section intro are plugin boilerplate copied at init; pre-0.5 repos carry
   a stale version. Bring exactly those up to the current template: the target enum gains
   `split` (`intake | slice | design | split | deliver`) and the header gains the size-budget
   line ("rides every dispatch — keep under 4 KB"). **Touch nothing else in the file** — every
   `[retro-…]`/`[migrate-…]` entry, every `LOCAL-` criterion, and any other local rule stays
   byte-identical. If the boilerplate was locally edited so the stale lines aren't found
   verbatim, surface it to the driver instead of guessing.

4. **Doctrine copies** — for each of `AGENT-PROTOCOL.md`, `REVIEW-LENSES.md` and
   `CHECK-CRITERIA.md` present in `<board_dir>`, diff it against the plugin's current
   equivalent (`${CLAUDE_PLUGIN_ROOT}/templates/<name>`; for the two deleted names, the
   nearest current home — `lenses/` and `checks/` respectively):
   - **Equivalent** (identical bar trailing whitespace) → the copy is redundant; `git rm`
     it.
   - **Differs** → the difference is local customization. Extract **only what the repo copy
     adds over the plugin version**, rewrite it as an addendum rule (never paste the whole
     file), and **present that delta to the driver for approval**. On approval, append under a
     dated heading (`## [migrate-<plugin-version>] from <name>`) in
     `<board_dir>/PROTOCOL-ADDENDUM.md`, then `git rm` the copy. If the driver rejects it or you
     cannot confidently isolate the delta, **stop and surface it** rather than delete the copy —
     a wrong extraction loses process history.

5. **Template copies** — for each of `card-template.md`, `pr-template.md`,
   `design-pr-template.md` present in `<board_dir>`, diff against the plugin's current
   `${CLAUDE_PLUGIN_ROOT}/templates/<name>`:
   - **Equivalent** → `git rm` it.
   - **Differs** → the repo shaped this template; **keep the file** and set
     `config.md`'s `template_overrides["<name>"]` to its repo-relative path so the skills
     keep using the project's version. A template is a fill-in artifact, not prose
     doctrine — it never goes in the addendum.

6. **Card frontmatter — the `reworks` map, and the `pr_urls`/`split_slices` shape.** For every
   `docs/cards/CARD-*/card.md`, rewrite a legacy scalar `reworks: N` as the per-producer map:

   ```yaml
   reworks:
     slice: 0
     design: 0
     implement: N     # the old counter only ever counted test/review→implement loops
     split: 0
     deliver: 0
   ```

   A card with **no** `reworks` key gets the all-zero map. **A card whose map is present but
   missing `split` gets `split: 0` added** — every other key untouched. `reworks.split` is
   `pr-splitter`'s budget; `/kanban` reads a missing key as `0` *only because `/migrate` writes
   it on disk* — skip it and that guarantee is unbacked. Also backfill `estimated_lines: ""`,
   `actual_lines: ""` and `review_lenses_failed: []` on every card lacking them (missing
   `review_lenses_failed` is safe — the full lens panel runs).

   **Same step, the `pr_urls`/`split_slices` rewrite.** A legacy scalar `pr_url: <url>` becomes
   **`pr_urls: [<url>]`**; an empty or absent `pr_url` becomes **`pr_urls: []`**. Either way,
   backfill **`split_slices: 0`** (not split; ships as one PR — the N=1 case) if missing. **Do not
   touch `design_pr_url`** — the design PR is a separate, unaffected scalar; `pr-splitter` never
   runs against it.

   All of Step 6 is the one exception Rules allows to "never touch board state" — pure
   shape/backfill. Cards at `status: review` need no special handling — `review.md` is absent, so
   the next `/kanban` pump dispatches the new lens panel.

7. **Config.** In `<board_dir>/config.md`, add any key in the plugin's current
   `${CLAUDE_PLUGIN_ROOT}/templates/config.md` frontmatter but missing here (**additive only** —
   never change an existing value, nor a `template_overrides` entry set in Step 5). Then set
   `kanban_flow_version` to the installed plugin version.

   **Per-version key deltas — tell the driver in the PR body what each added key changes:**
   - *Pre-0.4 → :* `checks`, `check_budget`, `size_limit`, `size_exclude` (every check `on`,
     **including `checks.split`**; budgets 2 except `split: 1` and `deliver: 1`; `size_limit: 500`).
     **Say what `size_limit` means:** from the next `/kanban` pump, `card-slice-checker` *forces a
     split* on any card it projects over 500 changed lines including tests — a real behaviour change
     on an existing backlog that must not surprise them.
   - *0.4 → 0.5:* `review_panel: full` — the review-panel size knob. `full` is byte-identical to
     pre-0.5 behaviour; say that `standard`/`light` exist, what they drop, and that `full` should
     stay for `gate_layer` cards. Also note (no action needed by /migrate — the docs live on card
     branches you never touch): check docs written before 0.5 use a `## Verdict` heading the new
     gate predicates cannot read. `/kanban`'s legacy normalization deletes such a doc on an
     in-flight card so its checker re-runs and regenerates it in current form; done cards' merged
     docs stay, and `/retro` falls back to their body criteria tables.
   - *0.5 → 0.6:* `pump_gate: on` — the pre-flight gate switch (SKILL.md §0.0). `on` is the new
     default and changes no card outcome: each pump first runs the cheap `pump-gate` haiku agent to
     decide idle-vs-run, so a quiet board under `/loop` stops before loading the board instead of
     after. Say that `off` bypasses the gate and reconciles directly (a debugging escape hatch), and
     that the gate writes no state and errs toward running.
   - *0.6 → 0.8:* the commented `testing:` block — test levels (opt-in; the switch is
     `testing.levels` non-empty). Since it ships commented, "adding the missing key" here means
     appending the commented block from the plugin's current `templates/config.md` frontmatter,
     verbatim, to the repo's — never uncommenting it. Say in the PR body that uncommenting it
     changes behaviour: new design criteria (`DSG-LEVELS/SEAMS/DATA`), a level-aware tester on
     sonnet, and the `tests` lens blocking undocumented level gaps on newly-designed cards;
     pre-opt-in in-flight cards are untouched (the `### Levels` block in `design.md` is the
     per-card marker).

8. **Ship a PR.** Commit the deletions, addendum appends, `template_overrides` wiring and
   config changes (Conventional Commits + the project's `Co-Authored-By` trailer). Push and
   open a PR against `main` via `{gh_command} pr create`. The PR body lists explicitly: every
   file deleted, every customization folded into the addendum (with its text), every template
   preserved via `template_overrides`, and the config keys added plus the version bump. Process
   changes get the same human review as code.

9. **Report.** Give the driver the PR url and a one-line summary; the migration takes
   effect when they merge it.

## Rules

- **Idempotent:** a re-run after the PR merges finds the version current and no copies →
  no-op. Safe to run any time `/kanban` nudges you.
- Read-only toward the plugin; write only inside the target repo, on the migration branch.
- **Never touch board state** — `BOARD.md`, `KNOWLEDGE.md`, `MILESTONES.md`, ADRs, and any card's
  status, phase, dependencies or content. The doctrine/template copies, `PROTOCOL-ADDENDUM.md` and
  `config.md` are yours. **One exception:** the mechanical frontmatter edits in Step 6 — reshaping
  `reworks`, backfilling `estimated_lines`/`actual_lines`/`review_lenses_failed`, and rewriting a
  scalar `pr_url` into `pr_urls`/`split_slices` — all shape/backfill changes that preserve the card's
  budget and delivery history exactly and alter nothing else.
- Never delete a **customized** template (preserve via `template_overrides`; a template never
  goes in the addendum) or silently drop a local **doctrine** customization (extract to the
  addendum with driver approval, or stop and surface it).
- Do not run `/kanban` or `/refine`; just migrate and hand off the PR.
