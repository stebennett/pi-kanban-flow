import assert from "node:assert/strict";
import { test } from "node:test";

function hasMachineLocalValue(value: unknown): boolean {
  if (typeof value === "string") return value.includes("/private/") || value.includes("stage2-secret-canary");
  if (Array.isArray(value)) return value.some(hasMachineLocalValue);
  if (value && typeof value === "object") return Object.values(value).some(hasMachineLocalValue);
  return false;
}

test("candidate durable attestation rejects machine paths and secrets across every field", () => {
  const safe = { run_id: "KFRUN-1", argv: ["<PACKAGE_ROOT>/entry", "--token=<REDACTED>"], execution_context: { repository_id: "owner/repo", branch: "main", commit: "a".repeat(40) }, payload: { evidence: ["logical"] } };
  assert.equal(hasMachineLocalValue(safe), false);
  for (const candidate of [
    { ...safe, argv: ["/private/tmp/prompt"] },
    { ...safe, payload: { error: "stage2-secret-canary" } },
    { ...safe, execution_context: { ...safe.execution_context, metadata: "/private/worktree" } },
  ]) assert.equal(hasMachineLocalValue(candidate), true);
});
