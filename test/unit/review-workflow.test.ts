import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateReviewPanel } from "../../extensions/kanban-flow/lifecycle/review.ts";
import { runConfiguredProjectCommands, overallProjectCommandStatus } from "../../extensions/kanban-flow/agents/project-command.ts";

const ids = ["KFRUN-20260101T000000000Z-abcdefgh", "KFRUN-20260101T000000000Z-bcdefghi"] as const;
function reviewer(lens: any, status: any = "pass", findings: any[] = []): any { return { schema_version: 1, dispatch_id: ids[0], card_id: "CARD-0001", phase: "implementation_review", lens, status, summary: "checked", findings, evidence: [{ reference: "src/a.ts", summary: "evidence" }], rerun_recommended: false }; }
function probe(status: any = "success", observationStatus: any = "pass"): any { return { schema_version: 1, dispatch_id: ids[1], card_id: "CARD-0001", probe: "project_commands", status, summary: "commands", observations: [{ key: "test", status: observationStatus, detail: "ok" }], evidence: [{ reference: "test", summary: "observed" }] }; }

test("review panel preserves configured order and passes advisory findings", () => {
  const result = aggregateReviewPanel({ cardId: "CARD-0001", lenses: ["security", "tests"], results: [reviewer("tests", "pass", [{ criterion: "x", severity: "advisory", location: "x", summary: "note", detail: "note", suggested_fix: "later", evidence: [] }]), reviewer("security")], probe: probe(), implementationRework: 0, implementationReworkLimit: 1 });
  assert.equal(result.decision, "ready_to_ship"); assert.deepEqual(result.lenses, ["security", "tests"]); assert.equal(result.advisoryFindings.length, 1);
});

test("blocking findings spend exactly one implementation rework and exhaust safely", () => {
  const finding = { criterion: "x", severity: "blocking", location: "x", summary: "fix", detail: "fix", suggested_fix: "fix", evidence: [] } as const;
  const input = { cardId: "CARD-0001", lenses: ["security"], results: [reviewer("security", "changes_requested", [finding])], probe: probe(), implementationRework: 0, implementationReworkLimit: 1 };
  assert.equal(aggregateReviewPanel(input).decision, "rework"); assert.equal(aggregateReviewPanel(input).reworkIncrement, 1);
  assert.equal(aggregateReviewPanel({ ...input, implementationRework: 1 }).decision, "blocked");
});

test("project commands run in fixed configured order and classify ordinary failure", async () => {
  const observations = await runConfiguredProjectCommands({ build: { executable: process.execPath, argv: ["-e", "process.exit(0)"] }, test: { executable: process.execPath, argv: ["-e", "process.exit(2)"] } }, process.cwd(), { timeoutMs: 5_000 });
  assert.deepEqual(observations.map((entry) => entry.key), ["test", "build"]); assert.equal(observations[0]?.status, "fail"); assert.equal(overallProjectCommandStatus(observations), "failure");
});
