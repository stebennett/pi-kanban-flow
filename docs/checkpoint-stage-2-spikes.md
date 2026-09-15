# Stage 2 prerequisite spike checkpoint

**Status:** Partial — production Stage 2 work remains blocked.

## Verified locally

- A real Pi 0.85.1 JSON-mode run with OpenAI Codex invoked one explicitly
  loaded terminating tool. It exited `0`, emitted the session header,
  `turn_end`, and `agent_end`, reported `stopReason: toolUse`, and exposed
  provider/model/usage in the authoritative final turn. The command used all
  four resource-disable flags, `--no-builtin-tools`, one explicit extension,
  and a one-tool allowlist. The sanitized integration test is opt-in through
  `PI_RUN_REAL_STAGE_2_SPIKE=1` because it consumes authenticated provider
  usage.
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
remain: non-interactive saved-trust reuse without `--approve`; explicit skill
presence plus unrelated global/project resource absence; the complete
structured role-result rejection matrix; archive and strict/broad path-policy
escape cases; named-command policy; normalized attestation secret/path checks;
and SIGTERM grace/SIGKILL cleanup on the minimum/current macOS and Linux
matrix.
