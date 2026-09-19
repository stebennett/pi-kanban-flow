# Stage 3 completion checkpoint

**Status:** implementation complete on the sequential Stage 3 PR stack; authoritative completion occurs when the stack through the completion PR is reviewed and merged to protected `main`.

## 1. Delivery stack

| PR | Commit | Work unit |
|---|---|---|
| #71 | `8b6ec4f` | requirements workflow specification and prerequisite spikes |
| #72 | `90262cf` | criteria and normalized proposal model |
| #73 | `61e6726` | deterministic ID allocation and candidate rendering |
| #74 | `bae182c` | status-dependent card impact planner |
| #75 | `56b1c25` | deterministic board initialization |
| #76 | `76faab0` | producer/checker dispatch service |
| #77 | `674e9ab` | digest-bound explicit approval |
| #78 | `9cd04ff` | locked workflow, design closure, and state transaction |
| #79 | `b099854` | Pi tools, packaged skills, and extension wiring |
| #80 | `4301c42` | real-Git requirements acceptance and packed assets |

The completion/documentation PR is stacked on #80. Each PR targets its immediate predecessor; merging must preserve this order or retarget each head after its base merges.

## 2. Closed contracts

Stage 3 implements the decisions recorded in `docs/spec-requirements-workflow.md`:

- initialization and initial requirements are separate state PRs;
- `origin/main` remains the only board authority;
- TUI/RPC approval uses Pi's built-in `ctx.ui.select` and binds the complete normalized proposal digest and base;
- JSON/print modes prepare but never approve;
- producer/checker failure requires a fresh revision and consumes no retry budget or durable ID;
- the parent owns proposal normalization, REQ/CARD/AC/FINDING allocation, impact derivation, rendering, paths, histories, approval, Git/GitHub actions, and state mutation;
- exact matching acceptance pairs retain AC IDs; changed pairs receive monotonic IDs;
- same-meaning amendments retain REQ IDs, while changed meaning creates replacement lineage and preserves superseded history;
- design-review closure is marker-backed, exact, idempotent, merge-race-safe, and parent-owned; and
- a proposed state PR remains pending human review and never starts design or implementation.

The durable attestation schema now includes an engine-owned `finding_ids` array parallel to payload findings. Repository loading validates finding uniqueness and counter monotonicity across historical artifacts.

## 3. Implemented surfaces and modules

### User/Pi surfaces

- `skills/kanban-init/SKILL.md`
- `skills/requirements/SKILL.md`
- `kanban_initialize`
- `kanban_requirements`
- existing read-only `/kanban-validate` and `kanban_validate`

### Deterministic requirements engine

- `requirements/criteria.ts` — deeply immutable checker criteria
- `requirements/proposal.ts` — strict normalized proposal and reference resolution
- `requirements/allocate.ts` — pure preview/final ID allocation
- `requirements/render.ts` — canonical spec/card bytes and candidate validation
- `requirements/impact.ts` — atomic status policy, rewiring, replacement, and grandfathering
- `requirements/initialize.ts` — layout classification, identity, defaults, and initialization coordinator
- `requirements/dispatch.ts` — saved-trust producer/checker execution and attestations
- `requirements/approval.ts` — canonical approval input/document/digest and one-shot decision state
- `requirements/operations.ts` — private bounded seven-day local operation records
- `requirements/workflow.ts` — lock/heartbeat, approval, closure, and transaction orchestration
- `reconciliation/requirements.ts` — exact requirements-design-close marker recovery
- `tools/initialize.ts` and `tools/requirements.ts` — strict Pi tool adapters

Shared repository, attestation, Git-diff, and state-transaction seams were extended without allowing missing boards in normal repository reads or broadening state-owned paths.

## 4. Acceptance evidence

The final local gate on the #80 stack passed:

```text
npm run typecheck
npm test                  # 136 passed, 9 explicit opt-in skips
npm run package
npm run package:check
git diff --check
```

Focused evidence includes:

- `test/integration/initialization-state-pr.test.ts` — real disposable Git initialization, exact three-file branch, protected `main` unchanged;
- `test/integration/requirements-state-pr.test.ts` — approved initial proposal through lock, exact candidate, real commit/push, marked human state PR, full repository reread, and lock release;
- `test/integration/requirements-design-close.test.ts` — marker post/reuse, crash recovery, duplicate/malformed marker refusal, merged/close race, and base race;
- `test/unit/requirements-impact.test.ts` — backlog, designing, design review, every approved in-flight status, done, replaced, retirement, replacement lineage, dependency rewiring, coverage, and multi-card atomicity;
- `test/unit/requirements-approval.test.ts` — proposal/base/model/override/artifact/snapshot digest sensitivity, explicit decisions, dismissal, abort, unsupported mode, stale comparison, and replay refusal;
- `test/unit/requirements-locked-workflow.test.ts` — revision, cancellation, noninteractive preparation, ownership loss, stale approval, transaction recovery, release failure, and exact descriptor state;
- Stage 2 process/snapshot/trust/resource tests — direct argv, process-group abort/escalation, immutable checker snapshot, resource exclusion, saved trust, path jail, and attestation redaction;
- package-boundary tests — checkout, symlink, pinned-layout fixture, and npm-packed resolution with both Stage 3 skills and runtime modules included and `reference/`/tests excluded; and
- the Stage 3 RPC interaction spike — explicit approval, dismissal, and abort without implicit mutation.

The opt-in real-process gates were also rerun on the completion branch:

```text
PI_RUN_REAL_STAGE_2_SPIKE=1 node --test --import tsx <four Stage 2 real-Pi suites>  # 8 passed
PI_RUN_REAL_STAGE_3_SPIKE=1 node --test --import tsx test/integration/stage-3-interaction-spike.test.ts  # 2 passed
```

No test or implementation writes `reference/kanban-flow/`. Child agents have result/read tools only and never receive board, Git, GitHub, approval, ID, path-selection, or transition authority. Skills contain no direct mutation instructions.

## 5. Scenario results

- **Initialization:** an empty trusted repository produces one human-only initialization state PR and no spec/card.
- **Initial requirements:** producer pass + checker pass + explicit approval produces one state PR containing canonical spec, card, dashboard, counters, histories, and accepted artifacts.
- **Amendments:** same-meaning, supersede, retire, create, update, replace, rewiring, grandfathering, terminal retention, and design-review closure policies are deterministic and atomic.
- **Overrides/models:** saved trust is mandatory; considered agents are validated; explicit models fail closed without availability/auth/tool support; active paths/hashes and actual identities enter approval.
- **Negative outcomes:** blocked/needs-human producer and fail/inconclusive checker cannot reach approval or state mutation; cancellation, noninteractive use, stale state, lock loss, cleanup failure, and ambiguous external state cannot create a successful outcome.

## 6. Known gaps and environment-bound evidence

The default suite intentionally skips nine real-Pi/provider/trust cases unless their environment flags and credentials are present. All applicable opt-in real-Pi/provider/resource/trust and RPC approval spikes passed on the completion branch, but a live paid-provider **full requirements workflow** and live GitHub PR mutation were not made from this development environment. Fake GitHub adapters are paired with real Git for deterministic acceptance. Linux and the minimum/current Node/Pi matrix remain CI/platform evidence rather than local macOS evidence.

These are evidence gaps, not authority fallbacks: production code fails closed when authentication, model capability, saved trust, GitHub identity, or supported interaction mode cannot be proved.

## 7. Stage 4 handoff

After this complete stack is merged and the gate is rerun from fresh protected `main`, the first permitted Stage 4 item is the design-workflow specification/prerequisite unit. It may consume only merged authoritative backlog cards and must preserve the same parent-owned lock, snapshot, approval, artifact, and state-PR boundaries. It must not treat an open Stage 3 state PR as authority.
