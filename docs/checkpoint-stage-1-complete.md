# Stage 1 deterministic-core checkpoint

**Status:** deterministic core implemented on the stacked Stage 1 branches
**Pi tested:** 0.85.1
**Node tested:** 24.18.1
**Git tested:** 2.54.0
**GitHub CLI tested:** 2.100.0

## Delivery

The Stage 1 implementation is split into focused stacked pull requests. The current tip contains the package entry point, asset resolver, strict schemas, requirements/card/config validation, repository reader/writer, canonical rendering, pure transitions/scheduler, common-Git-directory lock, direct Git/GitHub adapters, marker/trailer handling, state transaction coordinator, structured-result schema primitives, and read-only diagnostics.

## Validation

The complete local gate passes:

```text
npm run typecheck
npm test                         # 45 tests passed
npm run package
npm run package:check
git diff --check
```

The package check exercises checkout, symlink, archive, and npm-packed asset resolution. The real-Git integration test uses a disposable repository and bare `origin` to create a marked state transaction from `origin/main`, stage exact paths, emit trailers, push the state branch, and propose one fake human-only PR.

The extension load smoke test registers only `/kanban-validate` and `kanban_validate`; the Pi JSON smoke test invoked the tool with no skills, prompts, context, or unrelated extensions and produced structured diagnostics without mutation.

## Feasibility spike evidence

A sanitized role-specific producer and checker spike was run with temporary terminating tools using:

```text
pi --mode json -p --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools --tools submit_producer_result --extension <TEMP_ROOT>/kanban-result-spike.ts --provider openai-codex --model openai-codex/gpt-5.6-luna --thinking low ...
pi --mode json -p --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools --tools submit_checker_result --extension <TEMP_ROOT>/kanban-checker-spike.ts --provider openai-codex --model openai-codex/gpt-5.6-luna --thinking low ...
```

Both runs exited 0, emitted exactly one expected tool call, reported `stopReason: toolUse`, and reported provider/model metadata. A resource-disabled extension smoke run also exited 0 and showed only the explicitly loaded kanban tool. Full persisted-trust/resource-policy and descendant process-group probes remain Stage 2 prerequisites; no production child runner is included in Stage 1.

## Known gaps

- Live GitHub API behavior, minimum-version matrices, Linux process-group cleanup, and SHA-256 Git repositories remain explicit manual/CI coverage.
- The child runner, project override loading, model dispatch, trust enforcement, skills, migration, and workflow prompts are deferred to Stage 2 or later by specification.
- The current branch stack is not merged automatically; each PR remains subject to human review and protected-main policy.
