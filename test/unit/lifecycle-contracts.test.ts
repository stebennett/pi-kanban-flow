import assert from "node:assert/strict";
import { test } from "node:test";
import {
  noActionReport,
  stablePumpReportJson,
  validatePumpReport,
  validatePumpRequest,
  type PumpReport,
} from "../../extensions/kanban-flow/lifecycle/contracts.ts";

const base = "a".repeat(40);

test("pump request and no-action report have strict stable contracts", () => {
  const request = validatePumpRequest({ schema_version: 1, requested_phase: "none" });
  assert.deepEqual(request, { schema_version: 1, requested_phase: "none" });
  assert.throws(() => validatePumpRequest({ schema_version: 1, requested_phase: "none", card_id: "CARD-0001" }));
  const report = noActionReport({ baseCommit: base });
  assert.equal(report.status, "no_action");
  assert.equal(report.action, "none");
  assert.equal(report.transition.boundary, "no_action");
  assert.equal(stablePumpReportJson(report), JSON.stringify(report));
});

test("report validation enforces deterministic ordering and no-action invariants", () => {
  const report = noActionReport({ baseCommit: base });
  const invalid = structuredClone(report) as PumpReport;
  (invalid.issues as any).push({ code: "z", message: "later", evidence: [] });
  assert.throws(() => validatePumpReport(invalid), /no_action/);
  const withBadEvidence = structuredClone(report) as PumpReport;
  (withBadEvidence.artifacts as any).push("../escape");
  assert.throws(() => validatePumpReport(withBadEvidence), /schema|relative|path/);
});
