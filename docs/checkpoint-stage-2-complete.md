# Stage 2 completion checkpoint

**Status:** Stage 2 child runner and structured-output objective complete. Stage 3 requirements workflow may begin after this checkpoint PR merges.

## Baseline and delivery PRs

Stage 2 production work started from protected `main` at `9861bfc`, after the prerequisite spike stack through PR #59. It was delivered sequentially from refreshed `main`:

- PR #60 — role-specific structured-result tools and validation;
- PR #61 — persisted trust and deterministic agent discovery;
- PR #62 — immutable exact-commit snapshots and jailed read tools;
- PR #63 — broad planned-path tools and direct named commands;
- PR #64 — model resolution, policy, prompt, and dispatch planning;
- PR #65 — streaming JSON runner and process-group lifecycle;
- PR #66 — parent attestations and deterministic artifact proposals;
- PR #67 — bounded parallel strict dispatch;
- PR #68 — requirements producer/checker vertical slice; and
- PR #69 — diagnostics, compatibility correction, final gate, and this checkpoint.

## Implemented public seams

Production modules now cover agent parsing/discovery/trust, strict snapshots, canonical path authorization, jailed repository tools, planned broad writes/edits, named project commands, model resolution, role policy, prompt assembly, deterministic argv, LF JSON stream evaluation, process-group termination, single and bounded-parallel execution, parent attestation, artifact rendering, and typed artifact reads. Five isolated role extensions expose exactly one terminating result tool; the requirements producer/checker assets are packaged.

The engine still owns all paths, state, Git/GitHub operations, result meaning, and transitions. Stage 2 returns typed evidence and proposed artifact bytes only; it does not write authoritative board state.

## Validation evidence

The final checkout gate ran:

```text
npm run typecheck
npm test
npm run package
npm run package:check
git diff --check
```

Focused real-process tests cover Git archives, path jails, direct commands, exact diffs, LF stream boundaries, malformed/result rejection, process-group TERM → five-second grace → KILL, immutable checker input, and packed assets. The prerequisite checkpoint records the macOS/Ubuntu × Node 22.19/current cleanup matrix and local/symlink/Git/npm-pack asset matrix.

Real Pi 0.85.1 acceptance was run with `openai-codex/gpt-5.6-sol:medium` using all resource-disable flags, no built-in tools, one explicit role extension, and exact tool allowlists. Both `requirements-producer` and `requirements-checker` emitted one valid terminating result, `toolUse`, final provider/model/usage, `agent_end`, and `agent_settled`. Their saved event streams were kept outside tracked source. Before/after repository status showed no board, ref, worktree, lock, or GitHub mutation.

## Compatibility finding

Pi 0.85.1 final JSON messages expose provider, model, usage, and stop reason but not the effective thinking level. The versioned specifications now attest thinking from the parent-resolved explicit `--thinking` dispatch value and require final provider/model identity to match. `agent_settled` is accepted as a known event after the required `agent_end`.

## Deferred work and residual boundaries

Only `requirements-producer` and `requirements-checker` are packaged. The fixed catalog deliberately reports later-stage agents unavailable until their owning stages. Stage 3 still must implement requirements interview/approval, ID allocation, board mutation, and state-PR orchestration. Design, implementation, review, ship, migration, loops, telemetry, and Windows remain deferred by specification.

No child received board, unrestricted shell, Git, GitHub, branch, commit, PR, or transition authority. No successful or failed Stage 2 dispatch directly mutates the authoritative board.

## Stage 3 starting point

The first permitted Stage 3 item is the parent-owned requirements workflow that dispatches the packaged producer/checker, presents one human approval surface, allocates stable IDs deterministically, and proposes accepted spec/card changes through the existing state transaction coordinator.
