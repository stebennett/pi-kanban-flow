# Stage 2 prerequisite spike checkpoint

**Status:** Partial — production Stage 2 work remains blocked.

## Verified locally

- A real Pi 0.85.1 prose-only JSON-mode run exited `0` and emitted
  `agent_end` without any tool result or `toolUse` stop reason. This confirms
  that process success and final events alone are insufficient: the parent
  runner must reject prose-only completion.
- A real Pi 0.85.1 JSON-mode run with OpenAI Codex invoked one explicitly
  loaded terminating tool. It exited `0`, emitted the session header,
  `turn_end`, and `agent_end`, reported `stopReason: toolUse`, and exposed
  provider/model/usage in the authoritative final turn. The command used all
  four resource-disable flags, `--no-builtin-tools`, one explicit extension,
  and a one-tool allowlist. The sanitized integration test is opt-in through
  `PI_RUN_REAL_STAGE_2_SPIKE=1` because it consumes authenticated provider
  usage.
- With `--no-skills --skill <path>` and no built-in read tool, Pi 0.85.1 does
  not inject the approved skill body. The revised policy therefore parent-reads
  the validated skill and supplies its normalized, bounded content through the
  mode-`0600` `--append-system-prompt` file. A real Pi spike proves that this
  prompt content reaches the child while `AGENTS.md` remains excluded.
- A noninteractive real Pi child started without `--approve` loaded a temporary
  project extension only after the test wrote a saved `yes` decision through
  `ProjectTrustStore`; the test removes that temporary saved decision on exit.
  This proves the compatible persisted-trust adapter and child reuse boundary.
- A disposable real Git repository proves direct-argv `git archive --format=tar`
  from an explicit commit produces an exact immutable snapshot: a later mutable
  checkout change is absent from the archive. The future materializer must
  parse and validate entries before extraction; this does not authorize
  trusting `tar` extraction for adversarial archives.
- An attestation prototype proves longest-root-first replacement is required
  where temporary roots overlap, and that path/secret redaction must traverse
  every durable string field rather than argv alone. Credential-bearing URLs
  are redacted independently of configured secret names. This is feasibility
  evidence only; the production attestation module remains gated.
- A named-command prototype proves the parent can select only a configured
  command name and execute its configured executable/argv directly. A
  shell-metacharacter canary remains a single literal argument and cannot
  create its marker file. Production command timeout, abort, exact-diff, and
  policy enforcement remain gated.
- Pi 0.85.1 exposes `ProjectTrustStore.getEntry()` through
  `@earendil-works/pi-coding-agent`. The integration spike proves canonical
  ancestor lookup and distinguishes persisted `true`, `false`, and absent
  decisions in an isolated agent directory.
- On the current macOS host, a detached process group receives `SIGTERM` and
  its spawned descendant is no longer signalable. The test intentionally uses
  no board repository or child Pi session.

## Command

```text
node --test --import tsx test/integration/stage-2-prerequisites.test.ts
```

## Still required before production runner work

This checkpoint does **not** close Work unit 0. The following mandatory proofs
remain: duplicate, invalid,
wrong-role, sibling-tool, post-result-conflict, malformed, and size-limit
structured-result cases; adversarial archive extraction and strict/broad
path-policy escape cases; command timeout/abort/exact-diff policy; production attestation schema/secret/path checks;
and SIGTERM grace/SIGKILL cleanup on the minimum/current macOS and Linux
matrix.
