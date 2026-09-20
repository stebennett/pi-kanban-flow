import assert from "node:assert/strict";
import { test } from "node:test";
import {
  designBranchFor,
  planLifecycleTransition,
  productBranchFor,
  type BoardSnapshot,
  type CardSnapshot,
  type TransitionMetadata,
} from "../../extensions/kanban-flow/lifecycle/effects.ts";

const at = "2026-01-15T10:30:00Z";
const operationId = "KFOP-20260115T103000000Z-abcdefgh";
const transactionId = "KFTX-20260115T103000000Z-abcdefgh";
let historySequence = 0;
const artifact = (kind: string, suffix = "abcdefgh") => `docs/cards/artifacts/CARD-0001/${kind}-KFRUN-20260115T103000000Z-${suffix}.yaml`;
const metadata = (): TransitionMetadata => ({ at, operationId, transactionId, historyId: `KFH-20260115T103000000Z-${String(historySequence++).padStart(8, "0")}` });
const commit = (letter: string) => letter.repeat(40);

function card(status: CardSnapshot["status"] = "backlog", overrides: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    id: "CARD-0001",
    title: "Example card",
    status,
    requirements: ["REQ-0001"],
    grandfathered_requirements: [],
    acceptance_criteria: [{ id: "AC-0001", text: "works", requirement: "REQ-0001" }],
    dependencies: [],
    replaces: [],
    replaced_by: [],
    replacement_reason: null,
    priority: 1,
    created_at: at,
    updated_at: at,
    started_at: null,
    delivered_at: null,
    blocked: null,
    workflow: {
      design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null },
      split_decision: { result_path: null, decided_at: null, override: null },
      implementation: { branch: null, result_paths: [], head_commit: null },
      review: { result_paths: [], reviewed_commit: null, completed_at: null },
      ship: { product_pr: null, verification_result_paths: [], merged_commit: null },
    },
    rework: { design: 0, implementation: 0 },
    history: [],
    ...overrides,
  };
}
function board(cards: readonly CardSnapshot[]): BoardSnapshot { return { cards }; }
function pr(state: "open" | "merged" | "closed", head: string, headCommit = commit("a"), mergeCommit: string | null = null) {
  return { number: 1, url: "https://github.com/owner/repo/pull/1", head, base: "main" as const, state, operation_id: operationId, head_commit: headCommit, merge_commit: mergeCommit, last_checked_at: at };
}
function request(cardId: string, event: any, extra: Partial<{ designLimit: number; implementationLimit: number; metadata: TransitionMetadata }> = {}) {
  return { cardId, event, metadata: extra.metadata ?? metadata(), designLimit: extra.designLimit ?? 2, implementationLimit: extra.implementationLimit ?? 2 };
}
function approved(status: CardSnapshot["status"] = "ready_for_implementation", overrides: Partial<CardSnapshot> = {}): CardSnapshot {
  const base = card(status, overrides);
  return {
    ...base,
    started_at: at,
    workflow: {
      ...base.workflow,
      design: { ...base.workflow.design, branch: designBranchFor(base), pr: pr("merged", designBranchFor(base), commit("a"), commit("b")), approved_commit: commit("a"), checker_result_paths: [artifact("design-check")] },
    },
  };
}

test("pure design effects set started_at once, retain attempts, and enforce the design budget", () => {
  const passed = planLifecycleTransition(board([card()]), request("CARD-0001", {
    kind: "design_passed",
    evidence: { branch: designBranchFor(card()), producerResultPath: artifact("design-producer"), checkerResultPath: artifact("design-check"), pr: pr("open", designBranchFor(card())) },
  }));
  assert.equal(passed.snapshot.cards[0]!.status, "design_review");
  assert.equal(passed.snapshot.cards[0]!.started_at, at);
  assert.equal(passed.snapshot.cards[0]!.workflow.design.producer_result_paths.length, 1);
  const retry = planLifecycleTransition(board([card("backlog", { rework: { design: 0, implementation: 0 } })]), request("CARD-0001", { kind: "design_changes_requested", evidence: [artifact("design-check")] }));
  assert.equal(retry.snapshot.cards[0]!.status, "designing");
  assert.equal(retry.snapshot.cards[0]!.workflow.design.branch, designBranchFor(card()));
  const exhausted = planLifecycleTransition(board([card("designing", { rework: { design: 1, implementation: 0 }, workflow: { ...card().workflow, design: { ...card().workflow.design, branch: designBranchFor(card()), checker_result_paths: [artifact("design-check")] } } })]), request("CARD-0001", { kind: "design_changes_requested", evidence: [artifact("design-check", "bcdefghj")] }, { designLimit: 1 }));
  assert.equal(exhausted.snapshot.cards[0]!.status, "designing");
  assert.equal(exhausted.snapshot.cards[0]!.rework.design, 1);
  assert.ok(exhausted.snapshot.cards[0]!.blocked);
});

test("design merge and closed-PR reconciliation retain evidence and only change listed fields", () => {
  const branch = designBranchFor(card());
  const open = pr("open", branch);
  const reviewed = planLifecycleTransition(board([card()]), request("CARD-0001", { kind: "design_passed", evidence: { branch, producerResultPath: artifact("design-producer"), checkerResultPath: artifact("design-check"), pr: open } }));
  const mergedPr = pr("merged", branch, open.head_commit, commit("b"));
  const merged = planLifecycleTransition(reviewed.snapshot, request("CARD-0001", { kind: "design_merged", evidence: { pr: mergedPr, approvedCommit: open.head_commit } }));
  assert.equal(merged.snapshot.cards[0]!.status, "ready_for_implementation");
  assert.equal(merged.snapshot.cards[0]!.workflow.design.approved_commit, open.head_commit);
  const closed = planLifecycleTransition(reviewed.snapshot, request("CARD-0001", { kind: "design_closed", evidence: [artifact("design-check", "bcdefghj")] }));
  assert.equal(closed.snapshot.cards[0]!.status, "designing");
  assert.equal(closed.snapshot.cards[0]!.workflow.design.pr?.state, "closed");
  assert.equal(closed.snapshot.cards[0]!.rework.design, 1);
});

test("split no-split enters implementation without running implementation in the same effect", () => {
  const source = approved();
  const result = planLifecycleTransition(board([source]), request("CARD-0001", { kind: "split_decided", evidence: { resultPath: artifact("split-decision"), decidedAt: at, decision: "no_split" } }));
  assert.equal(result.snapshot.cards[0]!.status, "implementing");
  assert.equal(result.snapshot.cards[0]!.workflow.implementation.branch, productBranchFor(source));
  assert.equal(result.snapshot.cards[0]!.workflow.implementation.result_paths.length, 0);
  assert.equal(result.effects.selected, true);
});

test("implementation/review effects clear only superseded review fields and preserve prior artifacts", () => {
  const source = { ...approved("implementing"), workflow: { ...approved("implementing").workflow, split_decision: { result_path: artifact("split-decision"), decided_at: at, override: null }, implementation: { branch: productBranchFor(approved()), result_paths: [artifact("implementation-producer")], head_commit: commit("a") }, review: { result_paths: [artifact("review-security")], reviewed_commit: commit("a"), completed_at: at } } };
  const completed = planLifecycleTransition(board([source]), request("CARD-0001", { kind: "implementation_completed", evidence: { resultPath: artifact("implementation-producer", "bcdefghj"), headCommit: commit("c") } }));
  const implementation = completed.snapshot.cards[0]!;
  assert.equal(implementation.status, "implementation_review");
  assert.deepEqual(implementation.workflow.review.result_paths, source.workflow.review.result_paths);
  assert.equal(implementation.workflow.review.reviewed_commit, null);
  const passed = planLifecycleTransition(board([implementation]), request("CARD-0001", { kind: "review_passed", evidence: { resultPaths: [artifact("review-acceptance")], reviewedCommit: commit("c"), completedAt: at } }));
  assert.equal(passed.snapshot.cards[0]!.status, "ready_to_ship");
  assert.equal(passed.snapshot.cards[0]!.workflow.review.reviewed_commit, commit("c"));
  const rework = planLifecycleTransition(board([implementation]), request("CARD-0001", { kind: "review_changes_requested", evidence: [artifact("review-functionality")] }));
  assert.equal(rework.snapshot.cards[0]!.status, "implementing");
  assert.equal(rework.snapshot.cards[0]!.rework.implementation, 1);
  assert.equal(rework.snapshot.cards[0]!.workflow.review.reviewed_commit, null);
  assert.equal(rework.snapshot.cards[0]!.workflow.review.result_paths.length, 2);
});

test("shipping same-status timestamp churn is rejected while merge reconciliation is authoritative", () => {
  const source = { ...approved("shipping"), workflow: { ...approved("shipping").workflow, split_decision: { result_path: artifact("split-decision"), decided_at: at, override: null }, implementation: { branch: productBranchFor(approved()), result_paths: [artifact("implementation-producer")], head_commit: commit("c") }, review: { result_paths: [artifact("review-security")], reviewed_commit: commit("c"), completed_at: at }, ship: { product_pr: pr("open", productBranchFor(approved()), commit("c")), verification_result_paths: [artifact("ship-check")], merged_commit: null } } };
  assert.throws(() => planLifecycleTransition(board([source]), request("CARD-0001", { kind: "shipping_reconciled", evidence: { pr: source.workflow.ship.product_pr, verificationResultPaths: [] } })), /timestamp-only/);
  const merged = planLifecycleTransition(board([source]), request("CARD-0001", { kind: "product_merged", pr: pr("merged", productBranchFor(approved()), commit("c"), commit("d")), mergeCommit: commit("d"), deliveredAt: at }));
  assert.equal(merged.snapshot.cards[0]!.status, "done");
  assert.equal(merged.snapshot.cards[0]!.delivered_at, at);
});

test("pure candidates reject reordered cards and timestamp-only mutations", () => {
  const source = board([card(), card("backlog", { id: "CARD-0002", title: "Second card" })]);
  assert.throws(() => planLifecycleTransition(source, request("CARD-0001", { kind: "deterministic_correction" })), /immutable|correction/);
  const bad = structuredClone(source) as BoardSnapshot;
  (bad.cards[0] as any).updated_at = "2026-01-15T10:31:00Z";
  assert.equal(source.cards[0]!.updated_at, at);
});
