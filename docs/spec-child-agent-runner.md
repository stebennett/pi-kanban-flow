# Child agent runner and isolation specification

## Purpose

Run ephemeral specialist Pi processes while the deterministic parent owns state, policy, and audit metadata.

## Process model

Children run with explicit resources:

```text
pi --mode json -p --no-session \
  --no-extensions --no-skills --no-prompt-templates --no-context-files \
  -e <package-role-result-extension> ...
```

The runner adds only the role's tools/context/skills. It passes argv directly without a shell. Child sessions are never recovery sources.

The command always includes all four `--no-*` resource flags. It explicitly loads one package-owned role extension with `-e`, selects only that policy's package tools with `--tools`, and adds each approved broad skill with a separate `--skill` path. System protocol, normalized project context, and dispatch inputs are assembled into a mode-`0600` temporary prompt passed by `--append-system-prompt`; the user prompt contains only the bounded task envelope and dispatch ID. No configured value is interpolated into shell text.

## Repository-scoped agent discovery

1. Load packaged `agents/*.md`.
2. If saved project trust is verified, search `.pi/agents/*.md` from dispatch cwd upward only to the canonical Git repository root.
3. The nearest in-repository same-name project agent replaces the package default.
4. Resolve real paths; reject files/symlinks escaping the repository root.
5. Reject malformed or duplicate same-precedence definitions before mutation.

Every override is reported and parent-attested with canonical path and SHA-256.

## Strict read-only policy

Used for checkers, reviewers, split-decision agents, and the read-only ship producer. These roles inspect immutable inputs and return judgments/content without repository mutation.

The model receives no built-in `bash`, `write`, or `edit`. It receives package-owned tools only:

- `kanban_read`
- `kanban_grep`
- `kanban_find`
- `kanban_ls`
- its one role-result tool

The read tools are path-jailed to a temporary immutable snapshot created from an explicit Git commit. They canonicalize every path, reject symlink escapes, and expose no mutation operation. The snapshot is created from the exact commit with `git archive`, not from the mutable checkout. Extraction rejects absolute paths, `..` segments, duplicate normalized paths, special files, and archive links escaping the root. Files are mode `0444`, directories `0555`, and symlinks are retained only when their fully resolved target stays inside the snapshot. Package read tools still canonicalize every access and reject link escapes. The snapshot is made writable only by parent cleanup after the child exits and is then removed.

Tests, static analysis, Git, and GitHub probes are executed by deterministic parent code from configured argv commands. Their bounded outputs are supplied to read-only agents as evidence. This avoids pretending that unrestricted shell access is read-only.

If a future checker requires arbitrary shell execution, it requires a separately specified OS/container sandbox and is not supported by the first release.

## Broad trusted producer policy

Requirements/design/implementation producers require saved project trust. They may receive approved project context and explicitly allowlisted project skills. Unrelated extensions remain disabled.

First release gives no child an unrestricted shell:

- Requirements/design producers receive path-jailed repository read tools and return proposed document content; the parent writes it to the correct state/design worktree.
- Implementers receive package-owned path-jailed read/grep/find/ls/write/edit tools rooted at the product worktree. Canonical path and symlink checks reject `.git`, board-owned/design-owned paths, and worktree escapes.
- Implementers may call a package `kanban_run_project_command` tool only with a configured command name. The parent-defined tool executes the corresponding executable/argv directly in the product worktree; the model cannot supply shell text or arbitrary argv.
- Git, GitHub, branch, commit, and PR operations are parent-owned.
- After every producer, the parent validates the exact worktree diff and rejects out-of-policy changes before commit.

Arbitrary producer shell access would require a separately specified sandbox and is not supported in schema version 1.

## Trust

`ctx.isProjectTrusted()` is insufficient to prove saved trust because it also includes temporary `--approve`. Before broad dispatch or project override loading, the package must verify an applicable persisted `yes` decision in Pi's trust store for the canonical repository root or parent. It must not pass `--approve` to children.

The parent starts the child in the same canonical trusted repository/worktree. Non-interactive child startup must load the saved decision. If saved-trust verification cannot be implemented through a stable Pi API, the trust spike must define a supported adapter or fail closed.

## Dispatch record

The parent creates a machine-local `KFRUN-*` dispatch record containing agent name/source/path/hash, role policy, canonical cwd, snapshot/commit, provider/model/thinking, exact argv with secrets redacted, inputs, timeout, event limit, and output-byte limit. The durable artifact attestation normalizes package/snapshot/worktree/temp paths and records logical repository/branch/commit execution identity as defined in `spec-structured-results.md`; absolute machine paths are not committed.

Parent model inheritance comes from `ctx.model` and `ctx.thinkingLevel`, then explicit `--model provider/id` and `--thinking level` flags are passed to the child. An explicit unavailable override fails before spawn.

## Fixed first-release limits

Limits are package constants in schema version 1 rather than project-configurable values:

| Role | Timeout | Max JSON events | Combined stdout JSON bytes | Stderr bytes | Artifact content bytes |
|---|---:|---:|---:|---:|---:|
| producer | 30 minutes | 20000 | 16 MiB | 1 MiB | 200000 |
| checker | 10 minutes | 10000 | 8 MiB | 1 MiB | 200000 |
| reviewer | 10 minutes | 10000 | 8 MiB | 1 MiB | 200000 |
| split decision | 10 minutes | 10000 | 8 MiB | 1 MiB | 200000 |
| probe | 5 minutes | 5000 | 4 MiB | 1 MiB | 200000 |

The table row for a dispatch is selected by its engine-owned role, never agent frontmatter. Crossing any limit terminates the process group and fails the dispatch. Output is counted as bytes before UTF-8/JSON decoding, and any single unterminated line may not exceed 1 MiB.

## JSON stream handling

Consume LF-delimited JSON exactly as documented by Pi; do not use generic Unicode line splitting. The runner:

- validates every JSON record and session header;
- uses final `message_end`, `tool_execution_end`, and `agent_end` events as authoritative;
- enforces event and byte limits;
- captures usage/model/stop metadata;
- validates the successful-completion rules in `spec-structured-results.md`;
- preserves configured ordering for parallel results.

Malformed records fail the dispatch rather than being silently ignored.

## Abort, timeout, and cleanup

On macOS/Linux, spawn the child as a new process group without a shell. On abort, timeout, malformed/oversized stream, or policy violation, send SIGTERM to the process group, wait 5 seconds, then SIGKILL the group if any member remains. Remove temporary prompt/snapshot resources and record failure. Cleanup failure is itself a dispatch failure and is surfaced for manual cleanup. No success transition is allowed. PID/process-group reuse is guarded by retaining the live child handle and never signalling after its close event.

## Parallelism

Only independent strict checkers/reviewers run in bounded parallel, up to `review.max_parallel`. Producers are sequential. Result order follows configured agent/lens order, not completion time.

## Failure semantics

Nonzero exit, unacceptable stop reason, malformed stream, result-contract failure, unavailable model, trust failure, policy assembly failure, path-policy violation, or cleanup failure causes dispatch failure. The engine decides whether durable blocker evidence should be proposed in a state PR.
