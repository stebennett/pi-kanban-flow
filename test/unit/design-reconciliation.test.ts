import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDesign } from "../../extensions/kanban-flow/reconciliation/design.ts";
import type { CardSnapshot } from "../../extensions/kanban-flow/engine/transitions.ts";

const at = "2026-01-15T10:30:00Z";
const op = "KFOP-20260115T103000000Z-abcdefgh";
const head = "a".repeat(40);
const branch = "kanban/design/CARD-0001-example-card";
const pr = { number: 4, url: "https://github.com/owner/repo/pull/4", head: branch, base: "main" as const, state: "open" as const, operation_id: op, head_commit: head, merge_commit: null, last_checked_at: at };
function card(): CardSnapshot {
  return { id: "CARD-0001", title: "Example card", status: "design_review", requirements: ["REQ-0001"], grandfathered_requirements: [], acceptance_criteria: [{ id: "AC-0001", text: "works", requirement: "REQ-0001" }], dependencies: [], replaces: [], replaced_by: [], replacement_reason: null, priority: 1, created_at: at, updated_at: at, started_at: at, delivered_at: null, blocked: null, workflow: { design: { branch, pr, producer_result_paths: ["docs/cards/artifacts/CARD-0001/design-producer-KFRUN-20260115T103000000Z-abcdefgh.yaml"], checker_result_paths: ["docs/cards/artifacts/CARD-0001/design-check-KFRUN-20260115T103000000Z-abcdefgh.yaml"], approved_commit: null }, split_decision: { result_path: null, decided_at: null, override: null }, implementation: { branch: null, result_paths: [], head_commit: null }, review: { result_paths: [], reviewed_commit: null, completed_at: null }, ship: { product_pr: null, verification_result_paths: [], merged_commit: null } }, rework: { design: 0, implementation: 0 }, history: [] };
}

test("design reconciliation waits for an unchanged open PR", async () => {
  const result = await reconcileDesign({ card: card(), pullRequest: pr, freshMainCommit: "b".repeat(40), diff: [{ path: "docs/designs/CARD-0001.md", action: "create" }], designLimit: 2 });
  assert.equal(result.kind, "wait");
  assert.equal(result.transition, undefined);
});

test("design reconciliation rejects a materially changed design diff", async () => {
  await assert.rejects(() => reconcileDesign({ card: card(), pullRequest: pr, freshMainCommit: "b".repeat(40), diff: [{ path: "docs/designs/CARD-0001.md", action: "create" }, { path: "src/extra.ts", action: "create" }], designLimit: 2 }));
});

test("design merge is not accepted without reachability from fresh main", async () => {
  const merged = { ...pr, state: "merged" as const, merge_commit: "c".repeat(40) };
  const result = await reconcileDesign({ card: card(), pullRequest: merged, freshMainCommit: "b".repeat(40), diff: [{ path: "docs/designs/CARD-0001.md", action: "create" }], isReachableFromMain: () => false, designLimit: 2 });
  assert.equal(result.kind, "blocked");
  assert.equal(result.transition, undefined);
});
