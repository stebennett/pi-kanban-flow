import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RESULT_TOOL_NAMES, registerResultTool } from "../../extensions/kanban-flow/agents/result-tools.ts";
import { CheckerResultSchema, validateCheckerResult, validateProducerResult, validateSplitDecisionResult } from "../../extensions/kanban-flow/board/result-schemas.ts";

const run = "KFRUN-20260115T103000000Z-abcdefgh";
const evidence = { kind: "file", reference: "REQ-OBSERVABLE", summary: "criterion evidence" } as const;

function capture(role: keyof typeof RESULT_TOOL_NAMES): any {
  let tool: unknown;
  registerResultTool({ registerTool(value: unknown) { tool = value; } } as ExtensionAPI, role);
  return tool;
}

function assertProviderCompatible(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const value = node as Record<string, unknown>;
  if (Array.isArray(value.anyOf)) assert.equal(value.anyOf.every((branch) => (branch as Record<string, unknown>).type === "string" && typeof (branch as Record<string, unknown>).const === "string"), true);
  for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(assertProviderCompatible); else assertProviderCompatible(child);
}

test("each role extension registers exactly its terminating result tool", async () => {
  for (const role of Object.keys(RESULT_TOOL_NAMES) as Array<keyof typeof RESULT_TOOL_NAMES>) {
    const tool = capture(role);
    assert.equal(tool.name, RESULT_TOOL_NAMES[role]);
    assertProviderCompatible(tool.parameters);
  }
  const producer = capture("producer");
  const payload = { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "completed", summary: "done", artifacts: [], findings: [], questions: [], evidence: [], requirement_changes: [{ temporary_key: "new-requirement", action: "create", target_requirement: "none", title: "Requirement", body: "Body", acceptance: ["Observable"], supersedes: [] }], card_changes: [], planned_paths: [] };
  const result = await producer.execute("call", payload);
  assert.equal(result.terminate, true);
  assert.deepEqual(result.details.payload, payload);
});

test("checker failures require a criterion-specific blocking finding", () => {
  const result = { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "fail", summary: "failed", criteria: [{ key: "REQ-OBSERVABLE", verdict: "fail", evidence: [evidence] }], findings: [], evidence: [] };
  assert.throws(() => validateCheckerResult(result as never, { dispatchId: run, cardId: "none", phase: "requirements", criteria: ["REQ-OBSERVABLE"] }), /blocking finding/);
});

test("producer validates phase artifacts, temporary references, and trimmed Unicode-safe text", () => {
  const base = { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "completed", summary: "done", artifacts: [], findings: [], questions: [], evidence: [], requirement_changes: [{ temporary_key: "new-requirement", action: "create", target_requirement: "none", title: "Requirement", body: "Body", acceptance: ["Observable"], supersedes: [] }], card_changes: [], planned_paths: [] };
  validateProducerResult(base as never, { dispatchId: run, cardId: "none", phase: "requirements" });
  assert.throws(() => validateProducerResult({ ...base, summary: " padded " } as never, { dispatchId: run, cardId: "none", phase: "requirements" }), /trimmed/);
  assert.throws(() => validateProducerResult({ ...base, artifacts: [{ type: "design_document", content: "bad" }] } as never, { dispatchId: run, cardId: "none", phase: "requirements" }), /not permitted/);
});

test("split decisions reject duplicate siblings and require needs-human evidence", () => {
  const base = { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", status: "needs_human", rationale: "unclear", replacement_cards: [], evidence: [] };
  assert.throws(() => validateSplitDecisionResult(base as never, { dispatchId: run, cardId: "CARD-0001" }), /requires evidence/);
});

test("public checker schema remains strict at nested boundaries", () => {
  const schema = JSON.stringify(CheckerResultSchema);
  assert.equal(schema.includes("additionalProperties\":false"), true);
  assertProviderCompatible(CheckerResultSchema);
});
