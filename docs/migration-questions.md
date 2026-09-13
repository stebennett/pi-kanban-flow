# Migration direction questions

Each question can materially change the implementation. The three approaches are options, not all recommendations.

## Q1. What form should the Pi deliverable take?

**Context:** Pi distinguishes project-local resources from installable Pi packages. kanban-flow needs skills, internal assets, and executable subagent behavior.

1. **Installable Pi package (recommended):** package skills and a TypeScript extension with `package.json` `pi` metadata; install from npm/Git/local path.
2. **Project-local `.pi` bundle:** copy extension and skills into each target repository; simpler initial setup but creates per-repo drift.
3. **Global developer setup:** install resources under `~/.pi/agent`; easy for one user, weaker reproducibility and team distribution.

### ANSWER: 1.

## Q2. Is the first release strict parity or a smaller MVP?

**Context:** Version `0.10.0` includes intake, requirement identity, ADRs, migration, retro, optional test levels, split shipping, pre-flight, and thirteen agents. Porting every path before feedback is expensive.

1. **Strict parity:** support every current feature and existing board state before release.
2. **Staged parity (recommended):** first init/intake/one unsplit lifecycle, then review/split/testing/retro/migrate behind prereleases.
3. **Core-only product:** intentionally ship init/refine/basic kanban and defer advanced features indefinitely, documenting incompatibilities.

### ANSWER: 2.

This is an opportunity to be inspired by kanban-flow, but also the change some of the mechanics for how the system works. I would like to break the lifecycle into the core phases of requirements -> design -> implement -> review -> ship.

The phase of requirements covers:

1. Creating the initial requirements specification document for the changes.
2. Breaking this work into deliverable "cards".

Each "pump" of the kanban cycle should then take a "card", determine whether a split is needed before progressing to implementation.

Therefore, we may want to consider breaking this plugin to follow those phases as workflows.

## Q3. How should specialist agents run?

**Context:** Pi intentionally has no built-in subagents. Its bundled example implements them as child `pi --mode json` processes, while the SDK can create sessions in process.

1. **Child Pi processes (recommended initially):** strongest context/process isolation, straightforward model/tool flags, proven example; process startup and JSON handling add overhead.
2. **In-process Pi SDK sessions:** lower process overhead and direct event access; concurrency, resource isolation, credentials, and lifecycle are more complex.
3. **External dependency:** require an existing subagent Pi package and adapt kanban-flow prompts to it; least code, but safety and API stability are outside this package's control.

### Answer: 1.

## Q4. Are package agents fixed or customizable by projects?

**Context:** The generic Pi example lets `.pi/agents` override user agents. In kanban-flow, checkers enforce safety and stable criteria, so silent replacement is dangerous.

1. **Package-owned only (recommended):** no name-based overrides; project rules continue through `PROTOCOL-ADDENDUM.md` and config.
2. **Explicit reviewed overrides:** config maps an agent name to a project file, with warning/hash/version stamp and opt-in trust.
3. **Normal project shadowing:** let `.pi/agents` override package agents; flexible but weakens reproducibility and checker guarantees.

### Answer: 3.

This should be documented.

## Q5. What command UX must be preserved?

**Context:** Pi exposes skills natively as `/skill:kanban`; users currently expect `/kanban`, `/refine`, `/requirement`, and similar commands.

1. **Extension aliases (recommended):** register exact legacy commands and forward to `/skill:<name>` with arguments and expansion enabled.
2. **Pi-native only:** document `/skill:kanban`; minimal code and no generic command collisions, but a visible UX break.
3. **Prompt-template wrappers:** ship `/kanban` prompt files that ask the model to load the skill; simple, but less deterministic and may collide with skills/templates.

### Answer: 2.

Don't worry about matching the Claude Code style. Use the most appropriate approach that is native to Pi.

## Q6. How should unattended repeated pumping work?

**Context:** Pi has no built-in `/loop`, and its philosophy recommends tmux for background work. kanban-flow currently advertises `/loop /kanban`; looping magnifies overlap, trust, and recovery risks.

1. **Package loop controller (recommended for UX parity):** `/kanban-loop` schedules only after `agent_settled`, prevents overlap, exposes status/stop, and uses the existing pump gate.
2. **External tmux/shell runner:** repeatedly invoke one-shot Pi; operationally transparent, but session continuity, locking, auth, and prompts need careful scripting.
3. **Depend on another loop extension:** preserve a `/loop`-like UX with less code, at the cost of an external compatibility dependency.

### Answer: 2.

For the first development iteration, we should consider running pi with a single kanban pump. If the driver wants to run in a loop, we'll provide capabilities to do this later.

## Q7. What should happen to the Superpowers dependencies?

**Context:** Agent prompts invoke `superpowers:test-driven-development`, `verification-before-completion`, `finishing-a-development-branch`, and `using-git-worktrees`. These skills are not included in the reference plugin or guaranteed by Pi.

1. **Inline the essential procedures (recommended for self-containment):** retain required behavior in kanban-flow doctrine/prompts and remove runtime dependency.
2. **Declare/document a required Pi skill package:** less duplication, but installation and exact compatible versions become prerequisites.
3. **Vendor compatible skills:** bundle them under namespaced names; self-contained but adds maintenance/licensing and possible skill-name collisions.

### Answer: 1

We should encapsulate the intention from these skills into our new agents and skills.

## Q8. How provider-specific should model pinning be?

**Context:** Current frontmatter says `opus`, `sonnet`, or `haiku`. Pi accepts many providers and concrete model patterns; model catalogs and names evolve.

1. **Configurable capability tiers (recommended):** package defaults map tiers to Anthropic models, with project/global overrides and strict availability checks.
2. **Pin concrete Anthropic IDs:** closest behavioral parity and simplest testing, but excludes other providers and ages quickly.
3. **Inherit the parent model:** broad compatibility and simple auth, but discards the cost/judgment architecture and can run checkers at an unsafe tier.

### Answer: 3

Remove the alignment of models to agents. Instead, provide a mechanism for the driver to define this as a project level. Agents and skills should be model agnostic, with documentation providing recommendations.

## Q9. Should missing configured models fail or fall back?

**Context:** Silent fallback can change checker quality; hard failure can stop a board when one tier is unavailable.

1. **Fail closed before mutation (recommended):** report every unavailable tier and do not start the pump.
2. **Explicit configured fallback chain:** permit only user-approved substitutions, report each use, and optionally prohibit fallback for Opus checker roles.
3. **Automatic best available:** maximize progress but make behavior/cost unpredictable and weaken reproducibility.

### Answer: 0

See Q8 Answer and combine approach.

## Q10. How should installed-package paths replace `${CLAUDE_PLUGIN_ROOT}`?

**Context:** Skills and pump references need package templates after local, Git, symlink, and npm installation. Pi documents relative skill references but no equivalent Claude environment variable.

1. **Relative skill links plus extension resolver (recommended):** skills use standard relative references; the extension computes absolute asset paths for child dispatches.
2. **Per-turn system injection:** extension appends the canonical package root whenever a kanban command runs; convenient but adds context and trigger complexity.
3. **Copy runtime doctrine into each project:** eliminates package lookup, but revives the doctrine drift the current architecture deliberately removed.

### Answer: 1.

Remove references to plugin roots.

## Q11. How strict should specialist result validation be?

**Context:** Agents return fenced YAML. The parent currently parses and applies semantic checks, including the completeness valve. Pi extension code can validate before the parent sees a result.

1. **Schema validate and fail safely (recommended):** parse one result block, enforce common/agent-specific shape, and expose raw output for diagnostics; parent retains domain checks.
2. **Raw parity:** return child text and let the parent model parse it exactly as today; least code, most fragile.
3. **Replace YAML with a final structured-output tool:** strongest protocol but requires rewriting every agent contract and child tool setup.

### Answer: 3

If we're going to do this, do it properly.

## Q12. Which resources should child agents inherit?

**Context:** A child Pi process normally discovers context files, extensions, and skills. Inheriting project resources may help coding conventions but can alter safety or recursively load unrelated extensions.

1. **Explicit isolation (recommended):** disable extensions, select tools, decide context files deliberately, and inject only required doctrine; allow a small declared skill set.
2. **Normal child discovery:** closest to an ordinary Pi session and easiest, but behavior depends on the user's environment.
3. **Two policies by role:** isolate checkers/read-only agents strictly; let implementer/designer inherit approved project context/skills.

### Answer: 3

This gives those agents that need context the widest context, with others restricted.

## Q13. How should project trust and non-interactive execution work?

**Context:** Pi loads project-local settings/resources only after trust. Print/JSON/RPC modes do not prompt and default trust may ignore project resources.

1. **Require saved trust (recommended):** setup instructs users to `/trust`; loop refuses to start without it.
2. **Pass one-run approval:** launcher uses `--approve` for known repositories; convenient but must not normalize blanket trust.
3. **Avoid project Pi resources in children:** package extension passes all needed inputs, reducing trust dependence but not the general risk of running repository code.

### Answer: 1

## Q14. Is direct-to-`main` board-state pushing still acceptable?

**Context:** The current pump commits board state directly to `main`. Many repositories protect `main`; current behavior merely reports rejected pushes.

1. **Preserve current behavior:** exact parity; document required branch permissions.
2. **State branch/PR architecture:** all state mutations land through a dedicated PR; compatible with protection but substantially changes pump/reconcile semantics.
3. **Local-only state with periodic sync:** fewer pushes but weakens cross-session/machine durability and merge recovery.

### Answer: 2.

This is a problem with the current implemntation and this is an opportunity to fix this limitation.

## Q15. Is a single orchestrator guaranteed, or is locking required?

**Context:** “Sole writer” is a role invariant, not a lock. Pi makes it easy to open multiple sessions, and external loops could overlap.

1. **Add a project lock/lease (recommended):** atomic lock file containing session/process identity, stale-lock recovery, and explicit force unlock.
2. **Document single-runner only:** simplest, but accidental overlap can corrupt state.
3. **Git-based optimistic concurrency only:** detect push/rebase conflicts and retry; does not prevent duplicate PRs or duplicate external actions before push.

### Answer: 1.

## Q16. How should existing Claude-era boards be versioned during migration?

**Context:** `kanban_flow_version` currently tracks plugin doctrine/schema migrations. The package version may advance independently while board format remains stable.

1. **Separate package and board schema versions (recommended):** e.g. `kanban_flow_version` plus `board_schema_version`; migrate only when schema/doctrine requires it.
2. **Continue one version field:** simplest compatibility, but every package release appears to require board synchronization.
3. **One-time harness marker only:** stamp `harness: pi`; retain old version semantics, with less precise compatibility reporting.

### Answer: 1

## Q17. Should legacy Claude and Pi packages coexist during transition?

**Context:** Teams may need rollback or may have different developers using each harness against one board. Concurrent doctrine versions can produce different decisions.

1. **One-way cutover (recommended):** migration PR marks the board Pi-only; rollback uses Git and a documented reverse procedure.
2. **Temporary dual compatibility:** preserve both path/command conventions and test both harnesses; expensive and risks divergent agent behavior.
3. **Read-only Claude fallback:** Claude may inspect/report but cannot pump after the Pi marker is set.

### Answer: 1

## Q18. Where should `scope: personal` knowledge go?

**Context:** The pump currently routes personal entries to Claude project memory. Pi loads global/project `AGENTS.md`, but writing global instructions automatically is a significant side effect.

1. **Disable automatic personal writes (recommended initially):** include suggestions in the report for the user to place manually.
2. **Append to a dedicated Pi global knowledge file:** extension-managed and explicitly opt-in; inject it selectively.
3. **Map to project `AGENTS.md`:** visible and versionable, but turns personal preferences into team/project doctrine.

### Answer 1.

## Q19. What platforms must the first Pi release support?

**Context:** Current prompts and the Pi subagent example assume POSIX shell/process behavior. Worktree paths, signal propagation, temp directories, and command quoting differ on Windows.

1. **macOS/Linux first (recommended):** state support clearly; add Windows after parity.
2. **Cross-platform from first release:** use Node process/path APIs and PowerShell-aware commands; larger test matrix.
3. **Container-only:** consistent environment and safer automation, but changes setup and Git/GitHub credential handling.

### Answer: 1.

## Q20. What distribution and release channel is required?

**Context:** Pi packages can install from local paths, Git, or npm. Update/pinning behavior differs by source.

1. **Git prereleases, then npm (recommended):** dogfood pinned commits/tags before publishing semver releases with `pi-package` metadata.
2. **Git only:** simplest release process and easy pinning, less discoverable.
3. **npm immediately:** best discoverability and dependency installation, but package contents/versioning must be stable early.

### Answer: 1

## Q21. May migration include deterministic helper code for board operations?

**Context:** The 700+ line pump asks the model to parse YAML, render boards, calculate sets, and perform exact transitions. Moving selected mechanical operations into tools could reduce errors but changes architecture.

1. **Prompt parity first (recommended):** only implement dispatch/path/result/loop plumbing; harden board mechanics after parity evidence.
2. **Add narrow helpers now:** deterministic config/frontmatter parsing, criteria-set validation, size/set calculations, and exact board writes while keeping policy in prompts.
3. **Rewrite the orchestrator as a TypeScript state machine:** maximum determinism, largest scope and highest migration risk.

### Answer: 3

Although this is the biggest risk, it also adds a lot of value and fixes some of the token-heavy work completed by the orchestrator.

## Q22. What is the acceptance bar for declaring parity?

**Context:** The reference plugin has no automated tests in the reviewed tree. A claim of parity therefore needs an agreed evidence standard.

1. **Scenario matrix plus real dogfood (recommended):** automated fake-GitHub fixtures for every state-table row and at least one real end-to-end project.
2. **Manual happy path only:** faster but leaves recovery, split, and checker failure behavior unverified.
3. **Differential harness testing:** run equivalent fixture boards through Claude and Pi and compare artifacts/actions; strongest evidence, most expensive and potentially nondeterministic.

### Answer: 2

I'm happy manually testing.
