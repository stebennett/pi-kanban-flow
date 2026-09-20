import test from "node:test";
import assert from "node:assert/strict";
import { implementationDispatchContext, productBranch, validateImplementationProducerResult } from "../../extensions/kanban-flow/lifecycle/implementation.ts";

const dispatch = "KFRUN-20260101T000000000Z-abcdefgh";
const base = {
  schema_version: 1, dispatch_id: dispatch, card_id: "CARD-0001", phase: "implementation" as const,
  summary: "Implemented the approved design", findings: [], questions: [], evidence: [], requirement_changes: [], card_changes: [], planned_paths: [],
};

test("accepts a completed implementation summary and derives its artifact path", () => {
  const result = validateImplementationProducerResult({ ...base, status: "completed", artifacts: [{ type: "implementation_summary", content: "Tests red, minimal green, verification, refactor." }] }, { dispatchId: dispatch, cardId: "CARD-0001" });
  assert.equal(result.artifact, `docs/cards/artifacts/CARD-0001/implementation-producer-${dispatch}.yaml`);
});

test("rejects blocked, missing-summary, and path-authorizing implementation results", () => {
  assert.throws(() => validateImplementationProducerResult({ ...base, status: "blocked", artifacts: [], findings: [{ criterion: "none", severity: "blocking", location: "design", summary: "Need scope", detail: "The approved design is insufficient", suggested_fix: "Redesign", evidence: [] }] }, { dispatchId: dispatch, cardId: "CARD-0001" }));
  assert.throws(() => validateImplementationProducerResult({ ...base, status: "completed", artifacts: [] }, { dispatchId: dispatch, cardId: "CARD-0001" }));
  assert.throws(() => validateImplementationProducerResult({ ...base, status: "completed", planned_paths: [{ path: "src/new.ts", action: "create" }], artifacts: [{ type: "implementation_summary", content: "summary" }] }, { dispatchId: dispatch, cardId: "CARD-0001" }));
});

test("builds only validated fresh/rework dispatch context", () => {
  const context = implementationDispatchContext({ mode: "rework", cardId: "CARD-0001", designCommit: "0123456789abcdef0123456789abcdef01234567", branch: "kanban/card/CARD-0001-example", plannedPaths: [{ path: "src/example.ts", action: "modify" }], findings: ["FINDING-0001"] });
  assert.equal(context.mode, "rework");
  assert.equal(productBranch("CARD-0001", "Example"), "kanban/card/CARD-0001-example");
  assert.throws(() => implementationDispatchContext({ ...context, branch: "main" }));
});
