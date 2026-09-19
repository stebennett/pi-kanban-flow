# Stage 4 prerequisite checkpoint

**Status:** Work unit 0 specification and feasibility checkpoint

**Authoritative base:** `origin/main` at `94bacf1d7c4dae7c04c989d5d490c6d2739161fc` (`Merge pull request #81 from stebennett/stage-3/completion`)

**Working branch:** `stage-4/unit-00-lifecycle-spec`

This checkpoint records sanitized evidence for the six Stage 4 feasibility spikes required before workflow-agent or pump implementation. It records capability evidence only; it does not claim that Stage 4 workflow code exists.

## Installed environment

- OS: macOS Darwin 25.6.0, arm64
- Pi CLI: `0.85.1`
- `@earendil-works/pi-coding-agent`: `0.85.1`
- Node.js: `v24.18.1`
- Git: `2.54.0`
- GitHub CLI: `2.100.0`
- Required Stage 0 compatibility range: Pi `>=0.85.0 <0.86.0`, Node `>=22.19.0`, Git `>=2.39.0`, GitHub CLI `>=2.45.0`

Absolute checkout, temporary, worktree, credential, and provider paths are intentionally omitted from this document.

## Spike results

### S4-1 — Parent-managed design worktree, exact commit, archive, push, and recovery

**Command:** disposable real-Git shell spike using a temporary repository and bare `origin`; create `kanban/design/CARD-0001-example`, write only `docs/designs/CARD-0001.md`, stage that exact path, commit design trailers, archive the commit, push, remove the linked worktree, and rediscover the local/remote branch.

**Result:** pass.

Sanitized evidence:

```text
design_commit=e4dce239bb2797f8c3aacad92c1c61c9181341b9
diff_paths=docs/designs/CARD-0001.md
trailers=design,KFOP-20260101T000000000Z-abcdefgh,CARD-0001
archive_path=docs/designs/CARD-0001.md
remote_ref=e4dce239bb2797f8c3aacad92c1c61c9181341b9
recovery_branch=refs/heads/kanban/design/CARD-0001-example
post_cleanup_local_branch=present
post_cleanup_remote_branch=refs/heads/kanban/design/CARD-0001-example
```

The worktree was removed only after the branch/commit remained discoverable. The spike did not treat branch existence as a merged transition.

### S4-2 — Broad implementation path jail and named-command authority

**Command:**

```text
node --test --import tsx \
  test/integration/broad-tools.test.ts \
  test/integration/stage-2-broad-path-policy-spike.test.ts \
  test/integration/stage-2-command-policy-spike.test.ts
```

**Result:** 4 passed, 0 failed.

Evidence covered planned create/modify actions, protected board paths, wrong actions, direct executable/argv invocation, unknown command rejection, and command side effects outside the plan. This validates the existing Stage 2 seam that Stage 4 implementation must reuse; it does not grant a child Git/GitHub or shell authority.

### S4-3 — Direct parent probes, bounds, abort, and process-group cleanup

**Command:**

```text
node --test --import tsx \
  test/integration/stage-2-command-abort-spike.test.ts \
  test/integration/stage-2-command-limits-spike.test.ts \
  test/integration/stage-2-process-escalation-spike.test.ts
```

**Result:** 4 passed, 0 failed.

Evidence covered direct child abort, timeout/output bounds, mutation detection after a configured command, and TERM-grace/KILL descendant cleanup. Stage 4 still must add canonical parent-probe rendering/redaction tests before claiming durable probe completion.

### S4-4 — Immutable strict fanout and configured result order

**Command:**

```text
node --test --import tsx \
  test/unit/parallel-runner.test.ts \
  test/integration/stage-2-result-stream-spike.test.ts \
  test/integration/stage-2-result-negative-spike.test.ts \
  test/integration/stage-2-attestation-spike.test.ts
```

**Result:** 5 passed, 1 explicit opt-in skip, 0 failed.

Evidence covered bounded parallelism, configured result order, terminal failure handling, producer/broad-policy exclusion from parallel dispatch, malformed/duplicate/wrong/post-result rejection, and attestation redaction. The skipped case is the explicitly opt-in real-provider sibling-terminating-tool case; no Stage 4 acceptance claim relies on it. Stage 4 review tests must additionally assert that every lens receives the same implementation commit identity.

### S4-5 — Product marker recovery with real Git and fake GitHub

**Command:** disposable real-Git/real-bare-remote script using the existing marker parser/discovery adapter. It creates and pushes `kanban/card/CARD-0001-example`, creates a fake marked product PR after the push, merges the branch into `main`, pushes `origin/main`, and rediscovers the merged PR.

**Result:** pass after a minimal baseline marker fix.

Sanitized evidence:

```json
{
  "remote_branch_present": true,
  "head": "e0f794bd18478b7a71907c216b829f346bcc2516",
  "open_marker_cards": ["CARD-0001"],
  "merged_marker_cards": ["CARD-0001"],
  "merge": "137735601c1dbef447f3701663bb8465869be2e9",
  "merge_reachable_from_origin_main": true
}
```

The first run exposed a Stage 3 defect: `assertMarkerMatchesBranch()` applied `kanban/product/` to a `kind: product` marker even though the authoritative PR protocol uses `kanban/card/`. Unit 0 corrected only that mapping, retained `kanban/design/` and `kanban/state/`, and added positive `kanban/card/` plus negative old/wrong-pattern regression assertions in `test/unit/state-pr.test.ts`. No reference fixture or Stage 4 plan file was changed.

The spike also reran the shared marker/state seams:

```text
node --test --import tsx \
  test/unit/state-pr.test.ts \
  test/unit/transaction.test.ts \
  test/integration/requirements-design-close.test.ts \
  test/integration-transaction-git.test.ts
# 12 passed, 0 failed after the marker regression was added
```

### S4-6 — Explicit Pi UI decision/cancellation primitive

**Command:**

```text
PI_RUN_REAL_STAGE_3_SPIKE=1 node --test --import tsx \
  test/integration/stage-3-interaction-spike.test.ts
```

**Result:** 2 passed, 0 failed.

The real Pi 0.85.1 RPC spike showed that built-in `ctx.ui.select` receives an explicit value, cancellation, and abort without implicit mutation. Stage 4 uses the same primitive for the typed grandfathered `proceed_unsplit` decision, but JSON/print modes remain refusal/no-mutation modes. A Stage 4 blocker-resolution test must bind the exact evidence digest and option value before that surface ships.

## Gate interpretation and remaining evidence

The six seams are feasible on the installed macOS/current-version environment. The marker mapping correction is intentionally included in Unit 0 because it was a baseline safety defect in a shared recovery primitive, not a new lifecycle choice.

Not proved by this checkpoint:

- Stage 4 producer/checker/reviewer/ship prompts and workflow code (not yet implemented);
- live paid-provider full lifecycle runs and live GitHub PR mutation;
- Linux and minimum-version matrix runs;
- the opt-in real-provider sibling-terminating-tool case noted above;
- durable parent-probe redaction/report tests and full product merge inclusion proofs; and
- the complete end-to-end one-card acceptance transcript.

These are explicit evidence gaps, not authority fallbacks. Later implementation PRs must add the focused tests named in `docs/stage-4-review-matrix.md` and retain fail-closed behavior when any unproved external fact cannot be established.
