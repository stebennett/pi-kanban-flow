import assert from "node:assert/strict";
import { test } from "node:test";
import { canApplyCorrection, correctionMarker, productPullRequestBody, productPrTitle, validateProductPullRequestBody, verifyShipEvidence } from "../../extensions/kanban-flow/lifecycle/ship.ts";
import { parseActionMarker, parsePullRequestMarker } from "../../extensions/kanban-flow/state-pr/markers.ts";

const op = "KFOP-20260101T000000000Z-abcdefgh";
const commit = "0123456789abcdef0123456789abcdef01234567";
const branch = "kanban/card/CARD-0001-example";

test("ship body has one canonical marker and fixed headings", () => {
  const body = productPullRequestBody({ cardId: "CARD-0001", title: "Example", operationId: op, branch, reviewedCommit: commit, summary: "Ships the feature.", scopeAndAcceptance: "AC-1 is covered.", verification: "test passed.", review: "All lenses passed.", mergeBoundary: "Human merge is required." });
  validateProductPullRequestBody(body, { cardId: "CARD-0001", operationId: op });
  assert.equal(parsePullRequestMarker(body).kind, "product");
  assert.equal(productPrTitle("CARD-0001", "Example"), "kanban: CARD-0001 — Example");
});

test("ship body rejects missing sections and marker duplication", () => {
  assert.throws(() => validateProductPullRequestBody("## Summary\n\nmissing", { cardId: "CARD-0001", operationId: op }));
  const body = productPullRequestBody({ cardId: "CARD-0001", title: "Example", operationId: op, branch, reviewedCommit: commit, summary: "x", scopeAndAcceptance: "x", verification: "x", review: "x", mergeBoundary: "x" });
  assert.throws(() => validateProductPullRequestBody(`${body}\n${body.slice(0, body.indexOf("\n\n"))}`, { cardId: "CARD-0001", operationId: op }));
});

test("ship evidence distinguishes pending and structural failure", () => {
  const marker = parsePullRequestMarker(productPullRequestBody({ cardId: "CARD-0001", title: "Example", operationId: op, branch, reviewedCommit: commit, summary: "x", scopeAndAcceptance: "x", verification: "x", review: "x", mergeBoundary: "x" }));
  const base = { repository: "owner/repo", cardId: "CARD-0001", base: "main", branch, reviewedCommit: commit, marker, diff: [{ path: "src/a.ts", action: "modify" as const }], planned: [{ path: "src/a.ts", action: "modify" as const }] };
  const pending = verifyShipEvidence({ ...base, pr: { number: 1, url: "https://github.com/owner/repo/pull/1", title: "", body: "", head: branch, base: "main", state: "open", head_commit: commit, merge_commit: null }, requiredChecks: [{ name: "test", status: "in_progress", conclusion: null }] });
  assert.equal(pending.pending, true); assert.equal(pending.passed, false);
  const wrong = verifyShipEvidence({ ...base, pr: { number: 1, url: "https://github.com/owner/repo/pull/1", title: "", body: "", head: branch, base: "main", state: "open", head_commit: "f".repeat(40), merge_commit: null }, requiredChecks: [] });
  assert.match(wrong.failures[0]!, /head/);
});

test("deterministic correction is bounded per criterion", () => {
  const marker = parseActionMarker(correctionMarker({ operationId: op, cardId: "CARD-0001", criterion: "SHIP-BODY" }));
  assert.equal(canApplyCorrection([], marker), true);
  assert.equal(canApplyCorrection([marker], marker), false);
});
