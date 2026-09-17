import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChildAttestation, normalizeDurableValue } from "../../extensions/kanban-flow/agents/attestation.ts";
import { artifactPath, renderArtifact } from "../../extensions/kanban-flow/agents/artifacts.ts";
import { policyForAgent } from "../../extensions/kanban-flow/agents/policy.ts";
import type { DispatchPlan, DispatchSuccess } from "../../extensions/kanban-flow/agents/runner.ts";
const run = "KFRUN-20260115T103000000Z-abcdefgh";
const payload = { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "pass", summary: "ok", criteria: [{ key: "REQ-OBSERVABLE", verdict: "pass", evidence: [{ kind: "file", reference: "spec:1", summary: "proof" }] }], findings: [], evidence: [] };

test("parent attestation normalizes roots and secrets and renders deterministic destination", () => {
  const policy = policyForAgent("requirements-checker"); const plan = { dispatchId: run, agent: { name: "requirements-checker", description: "x", body: "x", source: "package", path: "agents/requirements-checker.md", sha256: "a".repeat(64) }, model: { provider: "openai", id: "gpt-5.4", thinking: "max", inherited: true }, policy, executable: "/machine/package/pi", argv: [], redactedArgv: ["--append-system-prompt", "/machine/temp/prompt"], cwd: "/machine/snapshot", promptPath: "/machine/temp/prompt", taskEnvelope: "x", cleanup: async () => {} } as DispatchPlan;
  const success = { runtime: { payload, provider: "openai", model: "gpt-5.4", thinking: "max", stopReason: "toolUse", usage: {}, eventCount: 5 }, exitCode: 0, stderr: "", startedAt: "2026-01-15T10:30:00.000Z", completedAt: "2026-01-15T10:31:00.000Z" } as DispatchSuccess;
  const attestation = buildChildAttestation(plan, success, { kind: "immutable_snapshot", repository_id: "owner/repo", branch: null, commit: "a".repeat(40), snapshotCommit: "a".repeat(40) }, { roots: { "<PACKAGE_ROOT>": "/machine/package", "<SNAPSHOT_ROOT>": "/machine/snapshot", "<TEMP_ROOT>": "/machine/temp" }, secrets: ["top-secret"] });
  assert.equal(artifactPath(attestation), `docs/cards/artifacts/requirements/requirements-check-${run}.yaml`); const rendered = renderArtifact(attestation); assert.equal(rendered.bytes.endsWith("\n"), true); assert.equal(rendered.bytes.includes("/machine/"), false); assert.match(rendered.bytes, /thinking: max/);
});

test("recursive normalization uses longest roots and redacts URL credentials", () => { const value = normalizeDurableValue({ x: "/root/work/file", y: "https://user:pass@example.test/x", z: "secret" }, { roots: { "<ROOT>": "/root", "<WORK>": "/root/work" }, secrets: ["secret"] }); assert.deepEqual(value, { x: "<WORK>/file", y: "https://<REDACTED>@example.test/x", z: "<REDACTED>" }); });
