# Development process specification

## Production root and reference policy

This repository root is the production Pi package root and will contain only this package plus its documentation/tests. `reference/kanban-flow` is a read-only behavioral fixture and must never receive implementation edits.

## Runtime baseline

Minimum supported versions for the first release:

- Pi `>=0.85.0` and `<0.86.0` until compatibility testing widens the range;
- Node.js `>=22.19.0` (Pi's current runtime requirement);
- Git `>=2.39.0`;
- GitHub CLI `gh >=2.45.0`;
- macOS 13+ or a maintained Linux distribution with process-group signals and Git worktrees.

Before each prerelease, CI/manual validation must test the minimum versions and current stable versions on macOS and Linux. Package `engines` and README match the Node baseline. Per Pi package guidance, bundled Pi core modules and `typebox` use `"*"` peer ranges; the extension startup preflight enforces the narrower tested Pi `>=0.85.0 <0.86.0` compatibility range before registering mutating commands.

Required Pi capabilities include package resources, TypeScript extensions, `/skill:*`, terminating custom tools, `--mode json -p --no-session`, explicit resource-disable/load flags, model/thinking flags, project trust, and LF-delimited JSON events. API drift pauses implementation until specs and compatibility range are updated.

## Required pre-production spikes

### Role-specific structured-result spike

Before workflow-agent porting, prove:

1. child `pi --mode json -p --no-session` with unrelated resources disabled;
2. explicit role-result extension loading;
3. valid producer and checker tool calls using provider-compatible schemas;
4. parent extraction from final JSON events;
5. parent attestation of actual agent/model/policy;
6. rejection of prose-only, duplicate, invalid, wrong-role, sibling-tool, post-result-conflict, oversized-line/event/output, and unacceptable-stop cases;
7. authoritative final events report the actual provider/model/thinking and the accepted `toolUse` stop reason, or the versioned specification is corrected before workflow work;
8. timeout/abort process-group cleanup kills descendants on minimum/current macOS and Linux;
9. normalized durable attestation contains no absolute package/snapshot/worktree/temp path or secret;
10. no child board mutation.

Pi's `terminate: true` is treated as a hint and successful completion follows `spec-structured-results.md`.

### Trust and resource-policy spike

Before project overrides or broad producers:

1. distinguish persisted trust from temporary `--approve`/`defaultProjectTrust: always` trust or fail closed, including a repository whose only project customization is `.pi/agents`;
2. prove a non-interactive child recognizes the applicable saved parent/current-directory decision without `--approve`;
3. prove all four resource-disable flags plus explicit `-e`/`--tools` load only jailed policy tools and one result tool;
4. prove archive extraction and read tools reject absolute, `..`, duplicate-normalized, special-file, and symlink escape cases;
5. prove broad path guards reject `.git`, board/design-owned, unplanned, wrong-action, and worktree-escape writes;
6. prove named project commands receive no model-supplied executable/argv and run without a shell;
7. prove unrelated global/project extensions, skills, prompts, and context files are absent while explicitly approved context/skills are present;
8. prove package assets resolve from local, symlinked, pinned-Git, and npm-packed installs.

If either spike fails, update the runner/result/trust specifications before production workflow code.

## Implementation order

1. package manifest and extension skeleton;
2. package asset path resolver and packed-install test;
3. exact board/config/result schemas;
4. repository read/validate/render;
5. common-Git-dir lock;
6. Git/GitHub marker discovery;
7. state transaction protocol with human-only merge;
8. diagnostic validate command/tool;
9. required spikes;
10. requirements and one-card workflows according to the state table.

## Stage gates

Deterministic core exits only when malformed fixtures fail, dependency/scheduler rules pass, lock contention/stale behavior passes, and an LLM-free state PR can be created idempotently.

Agent workflow work starts only after both spikes pass. Migration implementation starts only after the exact legacy field mapping prerequisite in `spec-one-way-migration.md` is complete.
