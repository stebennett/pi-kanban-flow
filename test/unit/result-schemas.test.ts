import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { CheckerResultSchema, ProducerResultSchema, ReviewerResultSchema, SplitDecisionResultSchema, ProbeResultSchema, validateCheckerResult, validateProducerResult, validateReviewerResult, validateSplitDecisionResult, validateProbeResult } from "../../extensions/kanban-flow/board/result-schemas.ts";

const run = "KFRUN-20260115T103000000Z-abcdefgh";
const evidence = { kind: "file", reference: "docs/design.md:1", summary: "supports the result" } as const;
const baseProducer = { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", phase: "design", status: "completed", summary: "done", artifacts: [{ type: "design_document", content: "# Design" }], findings: [], questions: [], evidence: [], requirement_changes: [], card_changes: [], planned_paths: [{ path: "docs/designs/CARD-0001.md", action: "create" }] };

test("public result schemas reject unknown fields and accept provider-compatible enums", () => {
  assert.equal(Value.Check(ProducerResultSchema, baseProducer), true);
  assert.equal(Value.Check(ProducerResultSchema, { ...baseProducer, unknown: true }), false);
  assert.equal(Value.Check(CheckerResultSchema, { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", phase: "design", status: "pass", summary: "ok", criteria: [{ key: "A", verdict: "pass", evidence: [evidence] }], findings: [], evidence: [] }), true);
  assert.equal(Value.Check(ReviewerResultSchema, { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", phase: "implementation_review", lens: "security", status: "pass", summary: "ok", findings: [], evidence: [], rerun_recommended: false }), true);
  assert.equal(Value.Check(SplitDecisionResultSchema, { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", status: "no_split", rationale: "small", replacement_cards: [], evidence: [] }), true);
  assert.equal(Value.Check(ProbeResultSchema, { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", probe: "ci_status", status: "success", summary: "green", observations: [{ key: "checks", status: "pass", detail: "all pass" }], evidence: [] }), true);
});

test("requirements producer and checker use the none card identity", () => {
  const requirements = {
    ...baseProducer,
    card_id: "none",
    phase: "requirements",
    artifacts: [],
    planned_paths: [],
    requirement_changes: [{ temporary_key: "new-requirement", action: "create", target_requirement: "none", title: "Requirement", body: "Body", acceptance: ["Observable"], supersedes: [] }],
  };
  assert.equal(Value.Check(ProducerResultSchema, requirements), true);
  validateProducerResult(requirements as never, { dispatchId: run, cardId: "none", phase: "requirements" });
  const checker = { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "pass", summary: "ok", criteria: [{ key: "REQ-OBSERVABLE", verdict: "pass", evidence: [evidence] }], findings: [], evidence: [] };
  assert.equal(Value.Check(CheckerResultSchema, checker), true);
  validateCheckerResult(checker as never, { dispatchId: run, cardId: "none", phase: "requirements", criteria: ["REQ-OBSERVABLE"] });
  assert.throws(() => validateCheckerResult({ ...checker, card_id: "CARD-0001" } as never, { dispatchId: run, cardId: "CARD-0001", phase: "requirements", criteria: ["REQ-OBSERVABLE"] }));
});

test("engine cross-field validation enforces completion contracts", () => {
  validateProducerResult(baseProducer as never, { dispatchId: run, cardId: "CARD-0001", phase: "design" });
  assert.throws(() => validateProducerResult({ ...baseProducer, questions: [{ question: "q", why_needed: "w", evidence: [] }] } as never, { dispatchId: run, cardId: "CARD-0001", phase: "design" }));
  const checker = { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", phase: "design", status: "pass", summary: "ok", criteria: [{ key: "A", verdict: "pass", evidence: [evidence] }], findings: [], evidence: [] };
  validateCheckerResult(checker as never, { dispatchId: run, cardId: "CARD-0001", phase: "design", criteria: ["A"] });
  assert.throws(() => validateCheckerResult({ ...checker, criteria: [{ key: "B", verdict: "pass", evidence: [evidence] }] } as never, { dispatchId: run, cardId: "CARD-0001", phase: "design", criteria: ["A"] }));
  const reviewer = { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", phase: "implementation_review", lens: "security", status: "changes_requested", summary: "fix", findings: [{ criterion: "SECURITY", severity: "blocking", location: "x", summary: "x", detail: "x", suggested_fix: "x", evidence: [evidence] }], evidence: [], rerun_recommended: false } as never;
  validateReviewerResult(reviewer, { dispatchId: run, cardId: "CARD-0001", lens: "security" });
  const split = { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", status: "no_split", rationale: "small", replacement_cards: [], evidence: [] } as never;
  validateSplitDecisionResult(split, { dispatchId: run, cardId: "CARD-0001" });
  const probe = { schema_version: 1, dispatch_id: run, card_id: "CARD-0001", probe: "ci_status", status: "success", summary: "green", observations: [{ key: "checks", status: "pass", detail: "all pass" }], evidence: [] } as never;
  validateProbeResult(probe, { dispatchId: run, cardId: "CARD-0001" });
});
