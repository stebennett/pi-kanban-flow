# kanban-flow migration plan: Claude Code plugin → Pi package

**Status:** Approved Stage 0 implementation plan; detailed `spec-*.md` documents are authoritative
**Reference baseline:** `reference/kanban-flow` version `0.10.0`
**Target:** a Pi-native redesign inspired by kanban-flow, delivered in stages

## 1. Direction agreed

This is not a byte-for-byte port. The migration will preserve the strongest ideas in kanban-flow while simplifying its lifecycle and moving mechanical orchestration out of prompts.

The agreed direction is:

- Ship an **installable Pi package**.
- Organize the product around five workflows: **requirements → design → implement → review → ship**.
- Keep `/skill:<name>` as the native Pi command surface; do not emulate Claude Code slash commands.
- Run specialist agents as isolated **child Pi processes**.
- Permit project-local agents to override packaged agents, and document the implications clearly.
- Make agents and skills model-agnostic by default. Agents inherit the current Pi model unless the driver defines project-level overrides.
- Replace fenced YAML returns with required role-specific **structured-output tools**.
- Use different child-resource policies by role: strict isolation for checkers/read-only reviewers, broader trusted project context for designers and implementers.
- Require the project to be trusted before kanban-flow runs.
- Replace direct pushes to `main` with a **state branch and PR workflow**.
- Protect each board with a lock/lease.
- Separate package version from board schema version.
- Make migration from Claude one-way; Claude must not continue pumping the migrated board.
- Inline the intent of the external Superpowers skills.
- Rewrite the prompt-heavy pump as a deterministic **TypeScript state machine**.
- Run one pump per user invocation in the first iteration. Looping is deferred.
- Target macOS and Linux first.
- Release through Git prereleases, then npm.
- Use manual happy-path acceptance for the first iteration, supported by focused automated tests for deterministic code.

## 2. Product model

### 2.1 Core lifecycle

The simplified lifecycle is:

```text
requirements → backlog → design → split decision → implement → review → ship → done
```

The five user-facing workflows are:

1. **Requirements**
   - Create or amend the requirements specification.
   - Assign stable requirement identities.
   - Break requirements into independently deliverable cards.
   - Establish dependencies and ordering.
2. **Design**
   - Turn one card into an implementation-ready design.
   - Record scope, acceptance mapping, interfaces, tasks, tests, and durable decisions.
3. **Implement**
   - Reassess whether the designed card must be split before code begins.
   - If it remains one card, implement it test-first in its worktree.
   - If it is split, create replacement cards and return them to the appropriate stage without losing scope or dependencies.
4. **Review**
   - Run tests and static checks.
   - Review the branch through focused lenses.
   - Return blocking findings to implementation within a bounded budget.
5. **Ship**
   - Prepare and open the PR.
   - Verify its base, body, contents, size, and CI state.
   - Reconcile merge state and mark the card done.

### 2.2 Pump semantics

`/skill:kanban` runs exactly one pump in the first iteration.

A pump:

1. Acquires the board lock.
2. Reconciles open state and pending state PRs. If reconciliation requires a durable board mutation, proposes that reconciliation alone and stops.
3. Otherwise selects at most one actionable card using deterministic ordering.
4. Executes the next valid transition for that card.
5. Runs the relevant workflow far enough to reach a durable boundary: completed transition, rework request, human decision, open PR, blocker, or done.
6. Writes all state changes to a transaction branch.
7. Opens or updates the corresponding state PR.
8. Releases the lock and reports what happened.

The TypeScript engine—not the parent model—owns state parsing, transition validity, budgets, locking, state transactions, and rendering. Models are used for judgments and artifact production.

### 2.3 First-iteration scope

The first development iteration should prove:

- package installation and project trust;
- board initialization;
- creation of an initial specification and cards through the requirements workflow;
- one-card pump selection;
- design;
- pre-implementation split decision;
- implementation;
- review and bounded rework;
- one implementation PR through ship and merge reconciliation;
- all board-state changes through a state PR;
- lock enforcement;
- migration marker and schema handling.

Deferred from the first iteration:

- unattended looping;
- the full current post-review multi-PR split algorithm;
- optional testing-level telemetry, quarantine, and nightly probes;
- full retro automation;
- every legacy reconciliation edge case;
- Windows support;
- exact feature parity with Claude kanban-flow `0.10.0`.

These may be restored in later stages if they still fit the simplified lifecycle.

## 3. Target package architecture

```text
kanban-flow/
├── package.json
├── README.md
├── LICENSE
├── extensions/
│   └── kanban-flow/
│       ├── index.ts                 # registers tools and lifecycle hooks
│       ├── engine/
│       │   ├── pump.ts              # one-pump coordinator
│       │   ├── transitions.ts       # legal state transitions
│       │   ├── reconcile.ts         # Git/PR/state reconciliation
│       │   ├── scheduler.ts         # deterministic card selection
│       │   └── render-board.ts
│       ├── board/
│       │   ├── schema.ts            # board/card/config schemas
│       │   ├── repository.ts        # typed reads and transaction writes
│       │   ├── migrations.ts
│       │   └── lock.ts
│       ├── state-pr/
│       │   ├── transaction.ts       # state branch commit
│       │   └── github.ts            # open/update/reconcile state PR
│       ├── agents/
│       │   ├── discover.ts          # package + project override resolution
│       │   ├── policy.ts            # tools, resources, model selection
│       │   ├── runner.ts            # child Pi JSON process
│       │   └── result-tools.ts      # role-specific completion contracts
│       ├── tools/
│       │   ├── kanban-pump.ts
│       │   └── kanban-agent.ts
│       └── paths.ts                 # installed-package asset resolution
├── skills/
│   ├── requirements/SKILL.md
│   ├── design/SKILL.md
│   ├── implement/SKILL.md
│   ├── review/SKILL.md
│   ├── ship/SKILL.md
│   ├── kanban/SKILL.md              # invokes one engine pump
│   ├── kanban-init/SKILL.md
│   └── migrate/SKILL.md
├── agents/                           # package defaults
├── templates/                        # runtime assets, not Pi prompts
├── docs/
└── test/
```

### Resource responsibilities

- **Skills** explain user intent, collect human input, and invoke deterministic extension tools.
- **The engine** owns workflow state and all mechanical operations that must be repeatable.
- **Agents** make bounded judgments or produce artifacts, never mutate board state directly.
- **Templates/doctrine** remain package assets and use relative references; `${CLAUDE_PLUGIN_ROOT}` is removed.
- **Project overrides** live in `.pi/agents/*.md` and may replace a packaged agent with the same name.
- **Board state** remains versioned Markdown/YAML under `docs/cards`, but is read and written through typed engine code.

## 4. Detailed technical design

### 4.1 Pi package and discovery

Add a `package.json` with:

- `keywords: ["pi-package", ...]`;
- `pi.extensions` for the extension entry point;
- `pi.skills` for the skill directory;
- Pi core packages and `typebox` as peer dependencies;
- runtime parser/schema dependencies under `dependencies`;
- an explicit package-files allowlist containing agents and templates.

Do not declare internal templates as `pi.prompts`. The native command surface is:

```text
/skill:kanban-init
/skill:requirements
/skill:kanban
/skill:design
/skill:implement
/skill:review
/skill:ship
/skill:migrate
```

Some phase skills may primarily support direct/manual operation and debugging; normal progress is coordinated by `/skill:kanban`.

### 4.2 Board schema and state machine

Define versioned TypeBox schemas for:

- project config;
- board metadata;
- card metadata and status;
- phase artifacts;
- check/review results;
- lock records;
- pending state transactions;
- package version, `board_schema_version`, and harness marker.

The state machine must:

- reject unknown or illegal states before mutation;
- expose legal transitions as code, not prompt prose;
- make rework counters and limits atomic;
- validate dependencies and detect cycles;
- select cards deterministically;
- retain stable requirement/card/check identifiers where reused;
- recover from an interrupted child run without inferring success;
- produce a complete transaction diff before committing it.

The existing 700-line pump remains a source specification during implementation. Each state table row must be classified as:

1. retained in the simplified lifecycle;
2. changed deliberately;
3. deferred; or
4. removed.

Record that mapping in implementation documentation so important recovery rules are not lost accidentally.

### 4.3 State branch and PR workflow

No board-state change is pushed directly to `main`.

The transaction model is specified in `spec-state-pr-protocol.md`:

1. Create a unique branch such as `kanban/state/<transaction-id>` from fresh `origin/main`.
2. Apply one pump's board/config/card state changes in an isolated worktree.
3. Validate and render the board from the resulting snapshot.
4. Commit exact paths only.
5. Push the branch and open a state PR containing a machine-readable transaction marker.
6. Treat the transition as pending until that state PR merges.
7. On the next pump, reconcile merged/closed state PRs before selecting more work.
8. Never open a second state transaction that conflicts with a pending one.
9. A closed-unmerged state PR blocks until explicit human adopt, abandon, or manual repair.
10. Store only the transaction's pre-commit descriptor in board state; discover commit/PR/merge evidence from trailers and markers without a follow-up metadata PR.

Board schema version 1 requires human merge for all state PRs. Automated state merging is deferred to a later schema/specification.

Product-code and design PRs remain separate from state PRs. Design PRs are required: an independent child checks the design before the PR opens, and implementation waits for human merge. State transactions record marked design/product PR URLs after GitHub confirms the external action exists, and later record authoritative merge outcomes during reconciliation.

### 4.4 Board lock/lease

Before reconcile or mutation, acquire an atomic project lock. The lock contains at least:

- repository identity;
- process id and host;
- Pi session id when available;
- start time and expiry/heartbeat;
- transaction id.

Required behavior:

- only one pump may hold the lock;
- contention reports the current owner and exits without mutation;
- stale-lock recovery is explicit and audited;
- lock release occurs on success, handled failure, abort, and shutdown;
- state PR reconciliation remains idempotent if a process dies after an external action;
- provide a documented force-unlock operation.

### 4.5 Specialist agent runner

Base the runner on Pi's bundled `examples/extensions/subagent/`, specialized for kanban-flow.

Support:

- one agent invocation;
- bounded parallel invocation for independent review/check agents;
- child `pi --mode json -p --no-session` processes;
- cwd/worktree selection;
- abort propagation and process cleanup;
- output/event limits;
- nested usage accounting;
- deterministic result ordering.

Agent discovery order:

1. load packaged `agents/*.md`;
2. if the project is trusted, load the nearest `.pi/agents/*.md`;
3. project agent names replace package agents with the same name;
4. report every active override prominently at startup and in pump output.

Documentation must state that project overrides can alter producer and checker behavior and therefore change kanban-flow's guarantees. Record the selected agent source/path in phase artifacts for auditability. Malformed overrides fail before a pump mutates state.

### 4.6 Model policy

Remove `opus`, `sonnet`, and `haiku` assignments from package agent definitions.

Default behavior:

- child agents inherit the parent Pi session's provider, model, and thinking level.

Project configuration may define optional model selection at the project level, for example:

```yaml
agent_models:
  default: inherit
  overrides:
    design-checker: anthropic/claude-opus-4-6:high
    implementer: openai/gpt-5.4:high
```

The exact schema should support per-agent overrides without embedding provider assumptions in skills or agents. Documentation may recommend stronger models for architecture, requirements, and independent checking, and cheaper models for mechanical probes.

If an explicit override cannot be resolved or authenticated, fail that dispatch clearly. There is no separate implicit fallback hierarchy; removing the override restores inheritance.

### 4.7 Structured specialist completion

Do not parse a fenced YAML block from assistant prose.

Each child is launched with one role-specific result extension/tool: producer, checker, reviewer, split decision, or probe. Public TypeBox schemas use provider-compatible enums; engine code validates cross-field constraints.

Requirements:

- the child must finish with exactly one expected role-result call;
- `terminate: true` is a hint; final JSON events, process exit, role, and dispatch identity must all validate;
- prose-only, duplicate, wrong-role, unknown-field, and incompatible phase/status results fail;
- checker schemas require a verdict for the full criterion set supplied in the dispatch;
- children return artifact content, findings, and evidence;
- the parent attests agent path/hash, actual model/thinking, resource policy, cwd, and process outcome;
- the parent engine receives typed JSON, not model-parsed YAML.

The engine remains responsible for deciding what the result means for workflow state.

### 4.8 Child resource policies

Use role-based policies.

**Strict policy — checkers and read-only reviewers:**

- disable unrelated extensions;
- expose only package-owned path-jailed read/grep/find/ls tools over an immutable commit snapshot; no shell/write/edit tools;
- inject package doctrine, exact inputs, and selected project addendum;
- do not load arbitrary project skills;
- retain project context files only if the checker contract explicitly needs them.

**Broad trusted policy — requirements, design, and implementation producers:**

- require saved project trust;
- allow project `AGENTS.md` and approved project skills;
- retain explicit tool restrictions for the role;
- disable unrelated extensions; load only package-owned role/result/path-guard extensions;
- inject the package protocol and current card inputs.

Every policy is assembled by code and logged in result metadata.

### 4.9 Prompt and doctrine migration

Rewrite prompts for Pi rather than mechanically renaming Claude concepts.

- Replace `Read/Grep/Glob/Edit/Write/Bash` with Pi tool names and semantics.
- Remove the nonexistent `Skill` tool.
- Remove `${CLAUDE_PLUGIN_ROOT}` and use relative package references or engine-resolved absolute paths.
- Inline the intent of:
  - test-driven development;
  - verification before completion;
  - finishing a development branch safely;
  - safe Git worktree creation and cleanup.
- Remove model-specific language from agents and skills.
- Replace old structured-return sections with the appropriate role-specific result tool.
- Keep checkers terminal and preserve independent-derivation/evidence discipline.
- Keep project-specific doctrine in `PROTOCOL-ADDENDUM.md` unless the redesigned schema replaces it explicitly.

### 4.10 Requirements workflow

The authoritative Stage 3 operational contract is `spec-requirements-workflow.md`; its exact initialization, approval, retention, ID-preview, rendering, reconciliation, and report semantics refine this section.

Consolidate useful behavior from `refine`, `requirement`, `req-ids`, and intake checking into `/skill:requirements`.

It should support:

- creating an initial specification through an interview;
- adding or changing a requirement later;
- stable, never-reused requirement IDs;
- identifying observable acceptance behavior;
- producing cards with acceptance criteria and dependencies;
- checking requirement coverage, overlap, sizing, and dependency validity;
- presenting one approval surface before writing;
- writing through a state transaction PR.

Initial specification creation is new first-class behavior and must not assume `docs/spec.md` already exists. Requirement amendments revise cards before design approval, but cards from `ready_for_implementation` onward retain explicit grandfathered requirement text/design while new backlog coverage implements the active replacement requirement.

### 4.11 Design, implement, review, and ship workflows

**Design** produces an implementation-ready artifact with durable decision rationale; separate ADR persistence is deferred in schema version 1. A checker independently verifies acceptance coverage, scope, testability, doctrine, planned paths, and decision recording. Human merge of its design PR is the requirement-amendment scope-freeze boundary.

**Implement** begins with the split decision required by the new lifecycle. The split decision uses the approved design and real repository structure. A non-grandfathered split rewrites card/dependency state through a state PR before any code is written. A grandfathered card that receives `split_required` blocks until explicit human approval to finish the original approved card unsplit; it never creates backlog children under superseded requirements. Otherwise implementation follows inlined TDD and worktree doctrine.

**Review** combines objective verification with parallel focused lenses. Blocking findings return to implementation through typed results and bounded engine-managed rework. Project agent overrides are allowed but recorded.

**Ship** opens and verifies the product PR, monitors CI when invoked again, handles human review signals if retained, and reconciles merge state. It never marks a card done until both the product merge and corresponding state transaction are durable.

### 4.12 Personal knowledge

Disable automatic writes of `scope: personal` knowledge in the first release. Return personal suggestions in the pump report so the driver can decide whether to add them to Pi configuration or project guidance.

### 4.13 Trust and platform

- Setup requires the user to trust the repository with `/trust` and restart Pi before use.
- Non-interactive child runs must verify inherited/saved trust rather than bypass it silently.
- First release supports macOS and Linux.
- README must list Git, GitHub CLI, Node/Pi, shell, worktree, and model-auth prerequisites.

## 5. Implementation stages

### Stage 0 — design specifications

Before production code, write short design documents for:

1. simplified lifecycle and retained/deferred legacy behavior — `stage-0-specifications.md`;
2. board/card/config schemas — `spec-board-schema.md`;
3. state branch and PR transaction protocol — `spec-state-pr-protocol.md`;
4. lock/lease semantics — `spec-lock-lease.md`;
5. child agent runner and role policies — `spec-child-agent-runner.md`;
6. structured result schemas — `spec-structured-results.md`;
7. project model and agent override configuration — `spec-project-overrides-config.md`;
8. one-way Claude board migration — `spec-one-way-migration.md`;
9. legal lifecycle transitions — `spec-state-machine.md`;
10. retained/changed/deferred/removed legacy behavior — `spec-legacy-behavior-mapping.md`;
11. development sequencing and structured-result tool spike — `spec-development-process.md`.

**Exit:** no unresolved architectural contradiction between state PRs, locks, worktrees, and product PRs.

### Stage 1 — package and deterministic core

1. Create the Pi package manifest and extension skeleton.
2. Implement package-path resolution and packed-install checks.
3. Implement schemas and typed board repository.
4. Implement legal transitions, scheduler, board rendering, and lock.
5. Implement state transaction branch/PR flow.
6. Expose a diagnostic command/tool that reads and validates a board without mutation.

**Exit:** a fixture board can be selected, transitioned, rendered, and proposed through a state PR without any LLM.

### Stage 2 — child runner and structured output

1. Implement package/project agent discovery and override reporting.
2. Implement strict and broad child policies.
3. Implement inherited model behavior and project overrides.
4. Implement child Pi execution, parallelism, abort, limits, and usage.
5. Implement role-specific result schemas, typed extraction, and parent attestation.
6. Port one read-only checker and one producer as vertical tests.

**Exit:** trusted project context reaches the producer, the checker remains isolated, and both return validated typed results.

### Stage 3 — requirements workflow

**Implementation checkpoint:** complete on the Stage 3 delivery stack; see `checkpoint-stage-3-complete.md`. It becomes authoritative after that stack merges to protected `main`.

1. Add `/skill:kanban-init` and `/skill:requirements`.
2. Support initial spec creation and later requirement changes.
3. Port stable IDs, card decomposition, dependency validation, intake checking, and approval.
4. Persist resulting spec/card changes through a state PR.

**Exit:** a new project can move from no spec to an approved backlog without direct `main` writes.

### Stage 4 — one-card delivery lifecycle

1. Port design producer/checker.
2. Add the pre-implementation split decision.
3. Port implementer with inlined TDD/worktree rules.
4. Port tester and an initial review panel.
5. Port ship/deliver and PR checker.
6. Add reconcile logic for state PR and product PR merges.
7. Wire `/skill:kanban` to execute one card's next transition.

**Exit:** manually invoke pumps until one unsplit card reaches done.

### Stage 5 — hardening and expanded behavior

1. Add interrupted-run and closed-PR recovery needed by real usage.
2. Expand review lenses and bounded partial reruns.
3. Add ADR persistence.
4. Add post-review split shipping only if the pre-implementation split decision proves insufficient.
5. Add migration for supported Claude board versions.
6. Add retro/testing-level features in priority order.

**Exit:** selected advanced features are documented as supported rather than inherited implicitly from the reference plugin.

### Stage 6 — looping, later

After repeated one-pump use is reliable, provide an external tmux/shell runner. It must:

- invoke one pump at a time;
- honor project trust;
- stop or wait while state PRs require action;
- respect the project lock;
- surface failures visibly;
- avoid parallel sessions against the same board.

Do not add a package loop controller in the first development iteration.

## 6. Validation strategy

The first acceptance bar is manual happy-path testing, not complete differential parity.

### Focused automated tests

Automate deterministic code where failures would be expensive to diagnose manually:

- schemas and board migrations;
- legal/illegal transitions;
- dependency cycle and scheduler behavior;
- lock acquisition, contention, stale recovery, and release;
- state transaction idempotency;
- agent override precedence;
- model inheritance/override resolution;
- strict versus broad child command construction;
- structured result acceptance and rejection;
- package asset resolution after `npm pack`.

### Manual first-iteration walkthrough

1. Install from a pinned Git ref.
2. Trust a disposable repository.
3. Initialize the board.
4. Use `/skill:requirements` to create a specification and cards.
5. Review and merge the state PR.
6. Invoke `/skill:kanban` repeatedly to design, split-check, implement, review, and ship one card.
7. Trigger one blocking checker/reviewer result and verify bounded rework.
8. Verify project agent override selection is visible in artifacts/reports.
9. Verify parent-model inheritance and one configured agent-model override.
10. Merge the product PR, run another pump, merge the final state PR, and verify done state.
11. Attempt a concurrent pump and verify lock refusal.
12. Interrupt a child run and verify no success transition was recorded.

Later stages add manual scenarios for split shipping, migration, closed PRs, and optional testing levels when those features are implemented.

## 7. Migration and compatibility

### One-way cutover

`/skill:migrate` must:

1. refuse if a pending Claude pump or dirty board state makes migration ambiguous;
2. create a migration branch and PR;
3. add `harness: pi` and `board_schema_version`;
4. preserve package version separately;
5. transform only explicitly supported legacy fields;
6. preserve requirement IDs, card IDs, criteria IDs, history, and project addenda where compatible;
7. report deferred/unsupported legacy features;
8. mark the board as no longer writable by Claude kanban-flow after merge.

Rollback is by reverting the migration PR and reinstalling the old harness, not by dual operation.

### Compatibility policy

- Existing identifiers should remain stable where their concepts survive.
- Existing cards may require status mapping into the simplified lifecycle.
- No promise of complete `0.10.0` behavior is made in the first Pi prerelease.
- Each prerelease documents supported schema versions and feature stages.

## 8. Documentation and release

Documentation must cover:

- Pi package installation from a pinned Git ref;
- `/trust` and restart requirements;
- native `/skill:*` commands;
- the five-workflow lifecycle;
- one-pump operation and deferred looping;
- state PR behavior and merge policy;
- board locking and force unlock;
- project agent overrides and their safety implications;
- inherited models, project model overrides, and recommendations;
- macOS/Linux prerequisites;
- one-way migration and rollback;
- currently deferred Claude features.

Release sequence:

1. local path installation during development;
2. pinned Git prerelease for dogfooding;
3. tagged Git prereleases as stages mature;
4. npm publication only after package layout and schema policy stabilize.

## 9. Principal risks and mitigations

| Risk | Mitigation |
|---|---|
| TypeScript state-machine rewrite changes behavior unintentionally | Classify every old pump row as retained, changed, deferred, or removed before implementation. |
| State PRs create excessive merge latency or circular state | Complete the transaction-protocol spike first; make pending state explicit and prohibit conflicting transactions. |
| Project agent overrides weaken checker guarantees | Trust gate, prominent override reporting, source metadata in artifacts, malformed override failure, and clear documentation. |
| Parent model is too weak for a specialist role | Document recommendations and allow explicit project overrides; never silently substitute a failed override. |
| Broad child context loads unsafe/unrelated resources | Use role-based allowlists and require saved project trust; keep checkers strictly isolated. |
| Structured result tool is not invoked | Treat the child run as failed and make no transition. |
| Multiple Pi sessions race | Atomic lock/lease plus pending state transaction checks. |
| Existing boards do not map cleanly to the simplified lifecycle | One-way migration PR, explicit supported versions, dry validation, and refusal on ambiguity. |
| Manual acceptance misses recovery defects | Keep deterministic core tests and add recovery scenarios as each advanced feature is enabled. |
| Deferred loop runner hides failures later | Build only after one-pump reliability; use tmux with visible output and lock enforcement. |

## 10. Definition of done for the first development iteration

- The package installs from a pinned Git ref and loads without Pi diagnostics.
- The trusted-project requirement is enforced and documented.
- Native `/skill:*` workflows are discoverable.
- A new repository can create a spec and backlog through the requirements workflow.
- One pump selects at most one card and uses the TypeScript state machine.
- The design, pre-implementation split decision, implement, review, and ship path works for one unsplit card.
- Specialists run in child Pi processes and complete through validated role-specific structured-output tools.
- Models inherit from the parent by default; a project override works and a broken override fails clearly.
- Project agent overrides work and are prominently identified.
- Board changes reach `main` only through state PRs.
- Concurrent pumps are rejected by the lock.
- One manually tested card reaches done, including one bounded rework.
- No runtime dependency on `${CLAUDE_PLUGIN_ROOT}`, Claude slash commands, Claude memory, `/loop`, or Superpowers remains.
