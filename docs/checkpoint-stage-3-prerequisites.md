# Stage 3 prerequisite checkpoint

**Status:** Requirements-workflow specification closure and Pi interaction prerequisites complete
**Baseline:** protected `main` at `6d6309b`
**Installed runtime:** Pi `0.85.1`, Node `24.18.1`, Git `2.54.0`, GitHub CLI `2.97.0`, macOS `26.6.2`

## Specification decisions

`docs/spec-requirements-workflow.md` now defines:

- separate LLM-free board initialization and later requirements state PRs;
- exact initialization classification, repository identity proof, defaults, paths, and typed missing-board transaction seam;
- the bounded requirements brief contract and model/engine authority boundary;
- one immutable ordered requirements criterion catalog;
- proposal normalization, temporary-reference resolution, no-op rejection, stable AC matching, and provisional parent allocation;
- exact spec/card/artifact candidate rendering, including engine-owned durable finding-ID mapping;
- no automatic retry after producer human-input outcomes or checker failure/inconclusive status;
- seven-day secure machine-local retention for all attempts and commit-only retention for the accepted passing pair;
- reconciliation-only behavior and marker-first design-PR closure/recovery;
- a canonical digest input, bounded approval document, explicit approve/revise/cancel state machine, stale invalidation, and noninteractive refusal;
- heartbeat, ownership-loss, cancellation, crash, cleanup, and stable report semantics; and
- a Stage 3 review matrix mapping durable effects and crash windows to modules/tests.

The selected interaction is Pi's built-in `ctx.ui.select`. It is supported by TUI and by the RPC extension-UI protocol; the workflow does not use `ctx.ui.custom`, which returns `undefined` in RPC mode.

## Executed interaction spikes

### RPC approval/cancellation/abort

The opt-in integration spike is `test/integration/stage-3-interaction-spike.test.ts` and runs with:

```text
PI_RUN_REAL_STAGE_3_SPIKE=1 node --test --import tsx test/integration/stage-3-interaction-spike.test.ts
```

On Pi 0.85.1 it passed two tests. A disposable extension command emitted an RPC `extension_ui_request` for `select`; an exact digest-bearing approve response incremented the guarded mutation counter once. RPC cancellation left the counter unchanged. An AbortSignal-dismissed selection also left it unchanged. Command discovery proved the disposable surface loaded without a model call.

### TUI approval

A disposable extension was launched under `/usr/bin/expect` in a real pseudo-terminal with all unrelated resources and built-in tools disabled. The script invoked `/stage3-tui-spike`, observed the digest-bearing selection surface, selected the exact approve option, observed `STAGE3_TUI_APPROVED`, and exited zero. No model or repository mutation was involved.

### Skill/tool authority boundary

A disposable skill with valid frontmatter was explicitly loaded together with one terminating tool, all other resources and built-in tools disabled. The user supplied an already testable initialization request. Pi `openai-codex/gpt-5.6-luna:low` invoked `kanban_requirements_probe` exactly once, returned `toolUse`, and emitted `agent_end`. The submitted brief was bounded and contained no IDs, paths, transitions, approval, shell, Git, or GitHub instruction. The tool result explicitly reported `mutation_authority: false`. Provider event logs and temporary skill/extension files were deleted and were not added to source.

Sanitized accepted brief:

```text
Enable board creation by initializing an empty, trusted GitHub repository. Acceptance: initialization proposes exactly one human-reviewed state PR and leaves the main branch unmodified.
```

## Baseline validation

Before this branch, the complete checkout gate passed with 91 tests passing and 8 opt-in Stage 2 tests skipped:

```text
npm run typecheck
npm test
npm run package
npm run package:check
git diff --check
```

The Stage 3 RPC spike was then run explicitly and passed. The committed default suite keeps the real-RPC case opt-in and runs its deterministic skill-authority assertion by default.

## Remaining implementation gates

This checkpoint proves interaction feasibility and closes semantics; it does not implement mutating workflows. Production work remains sequenced by `docs/stage-3-implementation-plan.md`. In particular, initialization, proposal/impact code, dispatch, approval adapter, workflow coordinator, skills, package loading, and end-to-end state transactions still require their focused PRs and tests.

The first permitted implementation after this checkpoint merges is Work unit 1: deterministic requirements criteria and proposal normalization.
