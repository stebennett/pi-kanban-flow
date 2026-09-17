# Stage 2 prerequisite spike checkpoint

**Status:** Ready to begin Stage 2 implementation. This checkpoint closes only
feasibility spikes; production modules must retain their separately specified
unit, integration, and release gates.

## Evidence

- **Persisted trust:** `ProjectTrustStore.getEntry()` provides canonical saved
  yes/no/absent lookup. Real noninteractive Pi runs show that saved `yes`
  loads project resources without `--approve`, while temporary `--approve` and
  `defaultProjectTrust: "always"` do not create a saved decision. The runner
  must require persisted `decision === true`.
- **Resource policy and skills:** all four resource-disable flags plus
  `--no-builtin-tools` block a saved-trusted project extension while an
  explicit extension loads. Pi does not inject `--skill` content under this
  policy; the parent must validate, normalize, bound, and inject approved
  skill content through the mode-`0600` appended system-prompt file.
- **JSON/result protocol:** real Pi JSON sessions expose authoritative
  `turn_end`, `agent_end`, provider/model/usage, and `toolUse`. Prose-only and
  sibling-tool completions prove that a successful exit is insufficient. The
  result-stream matrix covers malformed, wrong-role, duplicate, post-result,
  and oversized inputs.
- **Snapshot/path feasibility:** direct-argv `git archive` of an exact commit
  is immutable after checkout mutation. Archive metadata validation rejects
  absolute/traversal/duplicate/special/hardlink/escaping-link entries, and a
  realpath jail rejects symlink escapes. Production extraction and path tools
  must apply these policies before exposure.
- **Commands and attestation:** direct argv preserves shell metacharacters as
  literal arguments; timeout, output-cap, abort, and out-of-policy diff
  canaries are feasible. Attestation prototypes establish longest-root-first
  normalization and recursive redaction of paths, secrets, and URL
  credentials.
- **Process lifecycle:** detached process groups support TERM, a full
  five-second grace window, then KILL of TERM-ignoring descendants. The
  macOS/Ubuntu × Node 22.19.0/24.x workflow matrix is green.

## Validation performed on the merged baseline

```text
npm run typecheck
npm test
npm run package
npm run package:check
PI_RUN_REAL_STAGE_2_SPIKE=1 npm test
```

All normal tests (70) and all opt-in real-provider tests (70) passed locally.
The platform workflow is green.

## Implementation constraints carried into Stage 2

- Do not reintroduce child `--skill` discovery or built-in tools.
- Require persisted saved trust, not runtime trust.
- Reject non-tool, wrong-tool, malformed, duplicate, post-result, and bounded
  stream failures before any success transition.
- Validate archive metadata before extraction and enforce canonical path jails
  on every access.
- Execute configured commands with direct argv; enforce timeout/output/diff
  limits and abort cleanup.
- Normalize/redact every durable attestation string field.
- Preserve TERM → five-second grace → KILL process-group cleanup.
