# Stage 3 requirements workflow review matrix

**Status:** Specification-complete implementation checklist

The authoritative contract is `docs/spec-requirements-workflow.md`. This matrix maps every Stage 3 durable effect and crash boundary to an owning production module and required test. Module names describe the intended responsibility even before that work unit lands.

## Durable-effect ownership

| Effect or invariant | Owning module | Required evidence |
|---|---|---|
| Canonical GitHub repository identity | `requirements/initialize.ts`, workflow preflight | unit identity cases; real-Git/fake-GitHub initialization |
| No-board layout classification | `requirements/initialize.ts` | absent, complete, partial, migrated, ambiguous, symlink, special-file fixtures |
| Fixed initialization bytes | `requirements/initialize.ts`, board renderers | golden `board.yaml`, `config.yaml`, empty `BOARD.md` |
| Separate initialization transaction seam | `state-pr/transaction.ts` | missing-board success without weakening normal repository reads |
| Persisted trust | `agents/trust.ts`, `requirements/workflow.ts` | saved yes/no/absent; temporary/global approval refusal |
| Fixed checker criterion order | `requirements/criteria.ts` | one immutable constant used by prompt and validation |
| Typed temporary-reference normalization | `requirements/proposal.ts` | forward refs, ambiguity, duplicates, cycles, stale targets, immutability |
| REQ/CARD/AC/FINDING preview and final allocation | `requirements/allocate.ts` | monotonicity, exhaustion, stable matching, no consumption on failure |
| Requirements and card bytes | `requirements/render.ts` | golden initial/amendment bytes and parse/render/parse validation |
| Status-specific amendment effects | `requirements/impact.ts` | every durable and permitted blocked status |
| Grandfathering and follow-up coverage | `requirements/impact.ts` | active coverage, required dependencies, retained scope/design |
| Accepted requirements artifacts | `requirements/render.ts`, `agents/artifacts.ts` | exact paths, `finding_ids`, attestation, no secret/path canaries |
| Failed/revised/cancelled local retention | `requirements/workflow.ts` operation store | permissions, seven-day purge, no board artifact |
| Reconciliation-only boundary | `reconciliation/requirements.ts` | pending/merged/closed state PR and mutation-only stop |
| Approval document and digest | `requirements/approval.ts` | golden bytes, one-bit changes, bound base/agents/models/artifacts |
| Explicit TUI/RPC decision | `tools/requirements.ts` | approve/revise/cancel/dismiss/abort and RPC protocol smoke |
| Noninteractive refusal | `tools/requirements.ts` | print/JSON prepares but performs no mutation |
| Design-PR closure | `reconciliation/requirements.ts` | marker-before-close, reuse, duplicate/conflict, close/merge race |
| Final state candidate | `requirements/workflow.ts` | exact diff, counters, history, package/reconcile metadata, dashboard |
| Human-only state PR | `state-pr/transaction.ts` | marker/trailers, no merge, pending report |
| Stable public outcomes | `tools/initialize.ts`, `tools/requirements.ts` | strict TypeBox input/output snapshots and unknown-field rejection |
| Skill authority boundary | `skills/*/SKILL.md` | discovery/package tests and forbidden-instruction lint |

## Crash and cancellation matrix

Every retry begins with persisted trust, lock acquisition, fetch, marker discovery, and authoritative-state validation.

| Window | Durable evidence | Required behavior | Owning test |
|---|---|---|---|
| Before lock | none | no cleanup or mutation claim | workflow unit |
| Lock acquired, before fetch | local lock | release; no external action | workflow unit |
| During producer/checker | machine-local process/operation files | abort process group, clean temporaries, retain bounded local record | dispatch/workflow integration |
| Checker fails/inconclusive | local checked proposal only | return revision; no approval/state PR | dispatch integration |
| Awaiting approval | lock plus local candidate | heartbeat; dismissal/abort is not approval | approval unit/UI smoke |
| Approval returned, before revalidation | in-memory decision | revalidate all digest inputs; stale means no action | approval/workflow unit |
| Closure marker posted, PR still open | GitHub action marker | fresh approval required before retry closes; reuse exact marker | design-close integration |
| Design PR closed, no state branch | marker plus closed-unmerged PR | fresh checked/approved run may reuse closure; no design rework charge | design-close integration |
| Design PR merges during close | GitHub merge reachable from `origin/main` | stop stale; later reconciliation consumes operation | design-close integration |
| Transaction worktree created, no commit | local deterministic branch/worktree | remove/reuse only from unchanged base | initialization/requirements state-PR integration |
| Commit local, not pushed | trailers and exact diff | reuse only when base unchanged; otherwise discard | state-PR integration |
| Branch pushed, no PR | remote branch/trailers/diff | resume exact PR creation; never duplicate | state-PR integration |
| State PR open, report interrupted | open marker | return pending on retry; no new work | state-PR integration |
| State PR merged, report interrupted | marker and merge on `origin/main` | authoritative on retry; cleanup only | end-to-end acceptance |
| State PR closed unmerged | unresolved marker | block for explicit shared resolution | workflow integration |
| Heartbeat/ownership loss before action | lock mismatch/failure | abort child/UI, no new external action | workflow unit |
| Ownership loss after external action | marker/branch/PR evidence | return recovery-required; never erase action | workflow integration |
| Release or cleanup failure | local residue | surface failure; do not report success | workflow unit |

## Stage gates

| Gate | Required before proceeding |
|---|---|
| Specification closure | This matrix, `spec-requirements-workflow.md`, and prerequisite checkpoint merged |
| Pure proposal model | Normalization fixtures pass with immutable inputs |
| Rendering/impact | Complete candidate validates with no filesystem/GitHub dependency |
| Initialization | Real Git and fake GitHub prove one exact human-only state PR |
| Dispatch | Producer/checker outcomes prove no board/ref/GitHub mutation |
| Approval | TUI/RPC explicit decision and noninteractive refusal pass |
| Workflow | Lock/reconciliation/closure/transaction failure injection passes |
| Pi surface | Installed package discovers both skills and tools |
| Completion | Full gate, disposable end-to-end scenarios, and Stage 3 checkpoint |
