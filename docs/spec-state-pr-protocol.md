# State, design, and product PR protocol

## Authority and PR classes

`origin/main` is authoritative. Open PRs and local branches are pending external actions until merged.

Three disjoint PR classes are used:

| Class | Branch | Allowed paths | Purpose |
|---|---|---|---|
| state | `kanban/state/<KFTX-ID>` | `docs/spec.md`, `docs/cards/**` | board/control-plane mutation |
| design | `kanban/design/<CARD-ID>-<slug>` | `docs/designs/<CARD-ID>.md` | independently checked design and human approval |
| product | `kanban/card/<CARD-ID>-<slug>` | product paths only | implementation delivery |

A PR must not mix classes. Every path is normalized repository-relative UTF-8 using `/`; absolute paths, empty/`.`/`..` segments, backslashes, NUL/newline, special files, and symlink escapes are rejected. Exact-path staging and post-action diff validation enforce these class rules:

- a state PR changes only its descriptor's exact path set, all under `docs/spec.md` or `docs/cards/**`;
- a design PR changes exactly `docs/designs/<CARD-ID>.md` and no other path;
- a product PR changes only regular project files in the approved design producer's typed `planned_paths` allowlist and never `docs/spec.md`, `docs/cards/**`, `docs/designs/**`, or `docs/adr/**`;
- action type is checked: a declared create path must not exist at base, modify must exist at base and result, and delete must exist at base and not result;
- the parent-approved actual path/action set must be a subset of the approved planned allowlist, and the staged/committed diff must equal that actual set; blanket staging and undeclared paths are forbidden.

If implementation discovers a required path outside the approved allowlist, it returns blocked for redesign rather than broadening its own policy.

## Pump transaction lifecycle

1. Generate `KFOP-*` and acquire the common Git lock.
2. Fetch `origin` and resolve fresh `origin/main`.
3. Discover/reconcile open, merged, and closed PRs by machine marker.
4. If a state PR is pending, reconcile/report it and do not select new work.
5. If reconciliation requires a durable board mutation, build a reconciliation-only state transaction from the authoritative snapshot; do not select or dispatch a card workflow.
6. Otherwise select at most one card and run its next workflow from authoritative state.
7. Perform any idempotently marked design/product external action required by that workflow.
8. Build one final board mutation from the original authoritative snapshot.
9. Create `KFTX-*`, set `board.yaml.state.last_state_transaction` to its pre-commit descriptor, and create branch `kanban/state/<KFTX-ID>` from fresh `origin/main` in an isolated worktree.
10. Apply typed board changes; validate the complete snapshot and exact diff. The descriptor's path set must equal the resulting state-owned diff and contain no self-unknown commit/PR/merge values.
11. Commit, push, and open the marked state PR.
12. Stop the pump, release the lock, and report. The transition remains pending until merge.

A pump with no durable board change opens no state PR.

Initialization uses the same state branch, trailers, marker, exact-diff, stale-base, crash, and human-merge rules. Because a missing board cannot satisfy the normal repository read, `spec-requirements-workflow.md` requires a separate typed initialization coordinator seam; normal transactions remain strict and never accept a partial board.

Requirements approval occurs before any managed branch, commit, push, PR/comment, or design-PR close action. Secure lock/snapshot/prompt/operation files are machine-local resources, not proposed state. The exact post-approval design-close ordering and recovery contract is defined in `spec-requirements-workflow.md`.

## Machine markers

Every managed PR body contains an HTML-comment JSON marker so it remains machine-readable without presenting model-return syntax:

```html
<!-- kanban-flow:{"version":1,"kind":"state","operation_id":"KFOP-...","transaction_id":"KFTX-...","card_ids":["CARD-0001"],"base":"main"} -->
```

Design marker:

```html
<!-- kanban-flow:{"version":1,"kind":"design","operation_id":"KFOP-...","card_ids":["CARD-0001"],"base":"main"} -->
```

Product marker uses `kind: "product"`. Marker JSON is strict, canonical, and validated against PR head/base/repository. Missing, duplicate, malformed, or inconsistent markers require human resolution.

Marker objects use `additionalProperties: false` and canonical JSON with keys in the example order, no insignificant whitespace, and HTML-safe string content. Common fields are `version` (constant integer `1`), `kind`, `operation_id`, `card_ids`, and `base` (constant `main`). `card_ids` is a unique ascending array: exactly one card for design/product, and zero or more for state. State markers additionally require `transaction_id`; design/product markers prohibit it. The PR head must be the deterministic branch for its kind and IDs. Exactly one kanban-flow marker may occur in a managed PR body; marker-like text elsewhere is an error rather than ignored.

Every package-created commit also carries trailers:

```text
Kanban-Flow-Kind: design|product|state
Kanban-Flow-Operation: KFOP-...
Kanban-Flow-Card: CARD-0001
Kanban-Flow-Transaction: KFTX-...   # state commits only
```

These trailers make pushed/local branches discoverable before a PR exists. Trailer keys occur exactly once, values validate against the marker, and state commits require the transaction trailer while design/product commits prohibit it. A design/product commit names exactly one card. A state commit repeats `Kanban-Flow-Card` once per affected card in ascending order and uses no card trailer for a requirements/config-only transaction. Conflicting trailers make the branch ambiguous.

Other parent-owned GitHub mutations use a canonical PR comment marker:

```html
<!-- kanban-flow-action:{"version":1,"kind":"requirements-design-close","operation_id":"KFOP-...","card_id":"CARD-0001","criterion":null} -->
```

`kind` is `requirements-design-close|deterministic-correction`; `criterion` is null for closure and the fixed semantic criterion key for a correction. The object has exactly the shown fields. For closure, post/reuse the marker before closing the PR; for a correction, inspect whether the desired exact state already holds, perform the idempotent edit if needed, then post/reuse the marker. A crash between edit and marker is recovered by exact state comparison, never by repeating blindly. Duplicate/conflicting markers block.

## Idempotency

Before creating a branch or PR, query Git/GitHub for its operation/card/kind marker and deterministic branch name.

- Existing matching open PR: reuse and reconcile it.
- Matching merged PR: record merge evidence.
- Matching closed-unmerged design/product PR: follow its explicit state-machine recovery transition.
- Matching closed-unmerged state PR: enter the human-resolution procedure below; do not recreate, reopen, abandon, mutate board state, or select work automatically.
- Existing marked branch without PR: validate its commit trailers and exact diff, then resume PR creation or report an orphan; never create a duplicate branch.
- Multiple matches or mismatched marker/branch/commit: block for human resolution.

This prevents duplicate branches and PRs after a crash between external action and state recording. No orphan branch is treated as successful merely because it exists.

## Closed-unmerged state PR resolution

A closed-unmerged state PR is an explicit unresolved human refusal, even when its branch and diff remain valid. While an unresolved closed state marker exists, pumps may reconcile and report but must not mutate board state, create another state transaction, or select work. Existing design/product branches and PRs are preserved.

Resolution requires an explicit interactive action selecting one of:

- **adopt** — revalidate the original state diff and every associated external action against fresh `origin/main` and GitHub. Reopen the same state PR only if its exact marked branch, commit, base assumptions, and diff remain valid. Otherwise create a new transaction from fresh `origin/main` that records the currently authoritative external facts. A merged design PR may use the recovery-only transition to `ready_for_implementation`; a merged product PR may use the recovery-only transition to `done`. Never recreate the external PR.
- **abandon** — allowed automatically only when no associated design/product PR merged. Close any still-open associated external PR after confirmation, then validate cleanup. If an external PR already merged, abandonment is refused because the repository change is authoritative; the user must adopt or perform an audited manual repair.
- **manual repair** — stop automation and print the exact state/external mismatch and recovery evidence required. The normal engine performs no mutation until the user resolves it and then explicitly adopts or abandons.

After successful adopt or abandon, the engine posts exactly one machine-readable resolution comment on the old state PR:

```html
<!-- kanban-flow-resolution:{"version":1,"transaction_id":"KFTX-...","decision":"adopt","resolution_operation_id":"KFOP-...","replacement_transaction_id":"KFTX-..."} -->
```

`decision` is `adopt|abandon`; `replacement_transaction_id` is the new transaction ID for a recreated adoption and `null` for reopening or abandonment. The comment is written only after the corresponding reopen/new-PR or abandonment actions are confirmed. Missing, duplicate, malformed, or conflicting resolution markers remain ambiguous and block. Resolution is idempotent: a matching marker is reused and never reposted.

## State PR conflict policy

First release permits at most one open state PR per board and at most one unresolved closed state transaction. Pending and unresolved state are discovered from GitHub markers, never solely from board metadata. Later pumps cannot rely on proposed content before merge and cannot bypass an unresolved closure.

## Merge policy

Board schema version 1 supports only:

```yaml
state_prs:
  merge_policy: human
```

The engine never merges a state PR. Automated merge policies require a later specification and schema version.

Design and product PRs also require human/GitHub-policy merge. Reconciliation observes but does not infer or force merge.

## Reconciliation

Before selection, the engine:

- fetches `origin/main`;
- queries PRs for managed markers;
- validates URL, number, head, base, state, and merge commit;
- records only material changes;
- refuses ambiguity;
- never treats local commits, pushed branches, or cached board metadata as proof of merge.

If a process dies after an external action, the next pump discovers the action by marker and deterministic branch name. A state PR whose descriptor is now present on `origin/main` needs no follow-up board mutation merely to record its own commit, PR number, or merge time; those remain marker/trailer evidence. This prevents metadata-only reconciliation loops.

For product PRs, required checks are taken from GitHub's check rollup. Any required failing check may trigger implementation rework; pending checks hold `shipping`. A latest effective GitHub review state of `CHANGES_REQUESTED` sets the card's blocker flag. First release does not infer that comments were addressed or automatically clear human review blockers; explicit human resolution and renewed GitHub review are required.

Before any push or PR creation, re-fetch and verify that the expected base OID has not changed since planning. If it changed, discard/rebase the uncommitted transaction as appropriate, revalidate from the new base, or stop without opening the PR.

## Crash and retry matrix

Every retry begins after acquiring the lock, fetching fresh `origin/main`, and querying all managed markers. “Reuse” always means marker, trailer, repository, base, head, commit, and exact-path validation succeeded uniquely.

| Crash/failure window | Authoritative evidence on retry | Required action |
|---|---|---|
| Before branch creation | no marker, trailer, or branch | Replan from fresh authoritative state. |
| Branch created, no commit | uniquely named local branch/worktree with no managed commit | Validate clean expected base, then reuse or remove and recreate; no success transition. |
| Managed commit created locally, not pushed | exact commit trailers and diff | Reuse only if expected base is unchanged; otherwise discard/replan unpushed work. |
| Branch pushed, PR not created | unique remote branch plus valid managed trailers/diff | Resume PR creation; never create another branch. |
| Design/product PR created, state transaction not created | unique valid external PR marker | Reuse the PR and build the state transaction from fresh main. |
| Design/product PR merged before state recording | GitHub merge plus merge commit reachable from `origin/main` | Never recreate or revert automatically. Use the applicable recovery-only adoption transition. |
| State branch committed/pushed, state PR not created | unique state branch, transaction trailer, and exact state diff | Resume state PR creation if fresh-base validation still passes; otherwise block because a pushed transaction must not be silently rewritten. |
| State PR opened, process dies before report | unique open state marker | Treat as pending, report it, and do no work. |
| State PR merged, process dies before report/cleanup | merge commit reachable from `origin/main` and matching marker | Treat the board snapshot as authoritative; perform only reconciliation/cleanup needed by the next pump. |
| State PR closed unmerged | closed state marker without valid resolution marker | Apply the human-resolution procedure; no automatic board or workflow action. |
| Expected base OID changes before push/PR creation | fetched base differs from planned base | If nothing was pushed, discard/replan. If a managed branch/action exists, validate it through marker recovery or block; never force-push over ambiguity. |
| Multiple matching branches/PRs/markers | more than one candidate or inconsistent identity | Block and report all candidates; never select by recency. |
| GitHub unavailable/rate-limited | remote authority cannot be established | Perform no new external action or state mutation; release lock and report a transient failure. |
| Child fails before valid result | no accepted attested result | Record no success. Preserve only already validated parent-owned external actions for marker recovery. |
| Local cleanup fails after authoritative merge/close | remote/main authority already established | Report cleanup failure and retain local resources; do not reverse state or retry the transition. |

Additional class rules:

- A design/product PR existing without corresponding authoritative card metadata is an orphan candidate, not proof of a transition. It is adopted only through exact markers and the state/recovery transition.
- A product PR retained during `shipping → implementing` is updated in place after rework. Its head branch and marker remain stable; a second product PR for that card is forbidden.
- A reconciliation-only state transaction has no associated new design/product action. If closed, adopt means reopen/recreate the same reconciled facts after revalidation; abandon means acknowledge rejection and retain current `origin/main` state.
- Requirements/config-only state transactions follow the same state-PR windows. Closing one never leaves a design/product action to infer.

## Branch/worktree cleanup

Cleanup occurs only after authoritative merge/close reconciliation or an explicitly confirmed abandonment, and only for a branch/worktree matching the expected marker and commit. Failed cleanup is reported but does not reverse an already authoritative transition.
