import assert from "node:assert/strict";
import { test } from "node:test";
import { planLifecycleTransition, type BoardSnapshot, type CardSnapshot } from "../../extensions/kanban-flow/lifecycle/effects.ts";
import { productBranchFor, designBranchFor } from "../../extensions/kanban-flow/lifecycle/effects.ts";

const at = "2026-01-15T10:30:00Z";
const oid = (c: string) => c.repeat(40);
const artifact = (kind: string, suffix = "abcdefgh") => `docs/cards/artifacts/CARD-0001/${kind}-KFRUN-20260115T103000000Z-${suffix}.yaml`;
let sequence = 0;
const meta = () => ({ at, operationId: "KFOP-20260115T103000000Z-abcdefgh", transactionId: "KFTX-20260115T103000000Z-abcdefgh", historyId: `KFH-20260115T103000000Z-${String(sequence++).padStart(8, "0")}` });
function card(status: CardSnapshot["status"] = "backlog"): CardSnapshot {
  return { id: "CARD-0001", title: "Deliver one card", status, requirements: ["REQ-0001"], grandfathered_requirements: [], acceptance_criteria: [{ id: "AC-0001", text: "works", requirement: "REQ-0001" }], dependencies: [], replaces: [], replaced_by: [], replacement_reason: null, priority: 1, created_at: at, updated_at: at, started_at: null, delivered_at: null, blocked: null, workflow: { design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null }, split_decision: { result_path: null, decided_at: null, override: null }, implementation: { branch: null, result_paths: [], head_commit: null }, review: { result_paths: [], reviewed_commit: null, completed_at: null }, ship: { product_pr: null, verification_result_paths: [], merged_commit: null } }, rework: { design: 0, implementation: 0 }, history: [] };
}
const board = (cards: readonly CardSnapshot[]): BoardSnapshot => ({ cards });
const pr = (state: "open" | "merged", head: string, headCommit: string, mergeCommit: string | null = null) => ({ number: 7, url: "https://github.com/owner/repo/pull/7", head, base: "main" as const, state, operation_id: "KFOP-20260115T103000000Z-abcdefgh", head_commit: headCommit, merge_commit: mergeCommit, last_checked_at: at });
const req = (cardId: string, event: any, implementationLimit = 1) => ({ cardId, event, designLimit: 2, implementationLimit, metadata: meta() });

/** Acceptance proof: every status change is a pure candidate, and external PRs only
 * become authoritative through the subsequent reconciliation event. */
test("one-card acceptance reaches done with exactly one bounded implementation rework", () => {
  let snapshot = board([card()]);
  const designBranch = designBranchFor(snapshot.cards[0]!);
  let result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "design_passed", evidence: { branch: designBranch, producerResultPath: artifact("design-producer"), checkerResultPath: artifact("design-check"), pr: pr("open", designBranch, oid("a")) } }));
  snapshot = result.snapshot;
  assert.equal(snapshot.cards[0]!.status, "design_review");
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "design_merged", evidence: { pr: pr("merged", designBranch, oid("a"), oid("b")), approvedCommit: oid("a") } }));
  snapshot = result.snapshot;
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "split_decided", evidence: { resultPath: artifact("split-decision"), decidedAt: at, decision: "no_split" } }));
  snapshot = result.snapshot;
  assert.equal(snapshot.cards[0]!.status, "implementing");
  const branch = productBranchFor(snapshot.cards[0]!);
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "implementation_completed", evidence: { resultPath: artifact("implementation-producer"), headCommit: oid("c") } }));
  snapshot = result.snapshot;
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "review_changes_requested", evidence: [artifact("review-functionality")] }));
  snapshot = result.snapshot;
  assert.equal(snapshot.cards[0]!.rework.implementation, 1);
  assert.equal(snapshot.cards[0]!.status, "implementing");
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "implementation_completed", evidence: { resultPath: artifact("implementation-producer", "bcdefghj"), headCommit: oid("d") } }));
  snapshot = result.snapshot;
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "review_passed", evidence: { resultPaths: [artifact("review-acceptance"), artifact("review-functionality", "bcdefghj")], reviewedCommit: oid("d"), completedAt: at } }));
  snapshot = result.snapshot;
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "product_pr_opened", evidence: { verificationResultPaths: [artifact("ship-check")], pr: pr("open", branch, oid("d")) } }));
  snapshot = result.snapshot;
  assert.equal(snapshot.cards[0]!.status, "shipping");
  result = planLifecycleTransition(snapshot, req("CARD-0001", { kind: "product_merged", pr: pr("merged", branch, oid("d"), oid("e")), mergeCommit: oid("e"), deliveredAt: at }));
  assert.equal(result.snapshot.cards[0]!.status, "done");
  assert.equal(result.snapshot.cards[0]!.workflow.implementation.result_paths.length, 2);
  assert.equal(result.snapshot.cards[0]!.workflow.review.result_paths.length, 3);
});

test("acceptance rejects exhausted rework and preserves the marked product identity", () => {
  const source = card("implementation_review");
  const withReview = { ...source, workflow: { ...source.workflow, implementation: { branch: productBranchFor(source), result_paths: [artifact("implementation-producer")], head_commit: oid("a") }, review: { result_paths: [artifact("review-functionality")], reviewed_commit: oid("a"), completed_at: at } }, rework: { design: 0, implementation: 1 } };
  const exhausted = planLifecycleTransition(board([withReview]), req("CARD-0001", { kind: "review_changes_requested", evidence: [artifact("review-functionality", "bcdefghj")] }, 1));
  assert.equal(exhausted.snapshot.cards[0]!.status, "implementation_review");
  assert.ok(exhausted.snapshot.cards[0]!.blocked);
  assert.equal(exhausted.snapshot.cards[0]!.workflow.implementation.branch, productBranchFor(source));
});
