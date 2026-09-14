import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTransition, type BoardSnapshot, type CardSnapshot } from "../../extensions/kanban-flow/engine/transitions.ts";
import { countWip, dependenciesReady, scheduleNextCard } from "../../extensions/kanban-flow/engine/scheduler.ts";

const at = "2026-01-15T10:30:00Z";
const metadata = { at, operationId: "KFOP-20260115T103000000Z-abcdefgh", transactionId: "KFTX-20260115T103000000Z-abcdefgh", historyId: "KFH-20260115T103000000Z-abcdefgh" };
const pr = (state: "open" | "merged" = "open", head = "kanban/card/CARD-0001-card-0001") => ({ number: 1, url: "https://github.com/owner/repo/pull/1", head, base: "main" as const, state, operation_id: metadata.operationId, head_commit: "a".repeat(40), merge_commit: state === "merged" ? "b".repeat(40) : null, last_checked_at: at });

function card(id: string, status: CardSnapshot["status"] = "backlog", priority = 1, overrides: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    id,
    title: id,
    status,
    requirements: ["REQ-0001"],
    grandfathered_requirements: [],
    acceptance_criteria: [{ id: "AC-0001", text: "works", requirement: "REQ-0001" }],
    dependencies: [],
    replaces: [],
    replaced_by: [],
    replacement_reason: null,
    priority,
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
function request(event: Parameters<typeof applyTransition>[1]["event"], overrides: Partial<Parameters<typeof applyTransition>[1]> = {}) {
  return { cardId: "CARD-0001", event, metadata, designLimit: 2, implementationLimit: 2, ...overrides };
}

test("transition returns a frozen proposed snapshot and does not mutate input", () => {
  const source = board([card("CARD-0001")]);
  const result = applyTransition(source, request({ kind: "design_changes_requested", evidence: ["docs/cards/artifacts/CARD-0001/design-check-x.yaml"] }));
  assert.equal(source.cards[0].status, "backlog");
  assert.equal(source.cards[0].rework.design, 0);
  assert.equal(result.snapshot.cards[0].status, "designing");
  assert.equal(result.snapshot.cards[0].rework.design, 1);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot.cards), true);
});

test("design, split, implementation, review, ship and merge transitions enforce evidence", () => {
  let current = board([card("CARD-0001")]);
  current = applyTransition(current, request({ kind: "design_passed", evidence: { branch: "kanban/design/CARD-0001-example", producerResultPath: "docs/cards/artifacts/CARD-0001/design-producer-x.yaml", checkerResultPath: "docs/cards/artifacts/CARD-0001/design-check-x.yaml", pr: pr("open", "kanban/design/CARD-0001-example") } })).snapshot;
  assert.equal(current.cards[0].status, "design_review");
  const designMerge = applyTransition(current, request({ kind: "design_merged", evidence: { pr: { ...pr("merged", "kanban/design/CARD-0001-example"), head_commit: "a".repeat(40) }, approvedCommit: "a".repeat(40) } }));
  assert.equal(designMerge.effects.selected, false);
  current = designMerge.snapshot;
  current = applyTransition(current, request({ kind: "split_decided", evidence: { resultPath: "docs/cards/artifacts/CARD-0001/split-decision-x.yaml", decidedAt: at, decision: "no_split" } })).snapshot;
  current = applyTransition(current, request({ kind: "implementation_completed", evidence: { resultPath: "docs/cards/artifacts/CARD-0001/implementation-producer-x.yaml", headCommit: "c".repeat(40) } })).snapshot;
  current = applyTransition(current, request({ kind: "review_passed", evidence: { resultPaths: ["docs/cards/artifacts/CARD-0001/review-acceptance-x.yaml"], reviewedCommit: "c".repeat(40), completedAt: at } })).snapshot;
  assert.throws(() => applyTransition(current, request({ kind: "product_pr_opened", evidence: { pr: { ...pr(), head_commit: "c".repeat(40) }, verificationResultPaths: [] } })), /verification evidence/);
  current = applyTransition(current, request({ kind: "product_pr_opened", evidence: { pr: { ...pr(), head_commit: "c".repeat(40) }, verificationResultPaths: ["docs/cards/artifacts/CARD-0001/ship-check-x.yaml"] } })).snapshot;
  const shipping = current;
  assert.equal(applyTransition(shipping, request({ kind: "shipping_reconciled", evidence: { pr: { ...pr(), head_commit: "c".repeat(40) }, verificationResultPaths: [] } })).effects.selected, false);
  current = applyTransition(current, request({ kind: "product_merged", pr: { ...pr("merged"), head_commit: "c".repeat(40), merge_commit: "b".repeat(40) }, mergeCommit: "b".repeat(40), deliveredAt: at })).snapshot;
  assert.equal(current.cards[0].status, "done");
  assert.equal(current.cards[0].workflow.ship.merged_commit, "b".repeat(40));
});

test("rework exhaustion blocks without incrementing and blocker resolution is exact", () => {
  const exhausted = card("CARD-0001", "designing", 1, { rework: { design: 1, implementation: 0 } });
  const blocked = applyTransition(board([exhausted]), request({ kind: "design_changes_requested" }, { designLimit: 1 })).snapshot.cards[0];
  assert.equal(blocked.status, "designing");
  assert.equal(blocked.rework.design, 1);
  assert.notEqual(blocked.blocked, null);
  const resumed = applyTransition(board([blocked]), request({ kind: "blocker_resolved", resumeStatus: "designing" })).snapshot.cards[0];
  assert.equal(resumed.blocked, null);
  assert.equal(resumed.status, "designing");
  assert.throws(() => applyTransition(board([blocked]), request({ kind: "blocker_resolved", resumeStatus: "implementing" })));
});

test("terminal corrections and invalid branch/PR postconditions are refused", () => {
  const terminal = card("CARD-0001", "done");
  assert.throws(() => applyTransition(board([terminal]), request({ kind: "deterministic_correction" })), /immutable/);
  assert.throws(() => applyTransition(board([card("CARD-0001")]), request({ kind: "design_passed", evidence: { branch: "kanban/design/CARD-0001-bad--slug", producerResultPath: "x", checkerResultPath: "y", pr: pr("open", "kanban/design/CARD-0001-bad--slug") } })), /canonical/);
});

test("grandfathered split-required cards require an audited proceed-unsplit override", () => {
  const base = card("CARD-0001", "ready_for_implementation");
  const grandfathered = {
    ...base,
    started_at: at,
    grandfathered_requirements: ["REQ-0001"],
    workflow: { ...base.workflow, design: { ...base.workflow.design, branch: "kanban/design/CARD-0001-example", approved_commit: "a".repeat(40), checker_result_paths: ["docs/cards/artifacts/CARD-0001/design-check-x.yaml"] } },
  };
  const blocked = applyTransition(board([grandfathered]), request({ kind: "split_decided", evidence: { resultPath: "docs/cards/artifacts/CARD-0001/split-decision-x.yaml", decidedAt: at, decision: "split_required" } })).snapshot.cards[0];
  assert.ok(blocked.blocked);
  assert.equal(blocked.workflow.split_decision.result_path, "docs/cards/artifacts/CARD-0001/split-decision-x.yaml");
  const resolved = applyTransition(board([blocked]), request({ kind: "blocker_resolved", resumeStatus: "ready_for_implementation", proceedUnsplit: { reason: "Human approved completion under the retained design.", decidedAt: at } }));
  assert.equal(resolved.snapshot.cards[0].blocked, null);
  assert.equal(resolved.snapshot.cards[0].workflow.split_decision.override?.decision, "proceed_unsplit");
  assert.equal(resolved.effects.selected, false);
  assert.throws(() => applyTransition(board([{ ...blocked, blocked: { ...blocked.blocked!, reason: "unrelated blocker" } }]), request({ kind: "blocker_resolved", resumeStatus: "ready_for_implementation", proceedUnsplit: { reason: "not valid", decidedAt: at } })), /non-split blocker/);
});

test("blocker resolution must honor the recorded resume target", () => {
  const blocked = { ...card("CARD-0001", "design_review"), blocked: { reason: "waiting", source_phase: "design_review" as const, resume_status: "designing" as const, created_at: at, evidence: [] } };
  assert.throws(() => applyTransition(board([blocked]), request({ kind: "blocker_resolved", resumeStatus: "design_review" })), /recorded resume status/);
});

test("scheduler prefers actionable WIP, then priority and card ID, and respects WIP limit", () => {
  const dependency = card("CARD-0001", "backlog", 0);
  const wip = card("CARD-0002", "designing", 99);
  const blocked = card("CARD-0003", "backlog", -1, { blocked: { reason: "wait", source_phase: "backlog", resume_status: "backlog", created_at: at, evidence: [] } });
  const source = board([dependency, wip, blocked, card("CARD-0004", "backlog", 1)]);
  assert.equal(countWip(source.cards), 1);
  assert.equal(scheduleNextCard(source, { wipLimit: 1 })?.card.id, "CARD-0002");
  assert.equal(scheduleNextCard(source, { wipLimit: 1, pendingStateTransaction: true }), null);
  assert.equal(dependenciesReady(source.cards[3], source.cards), true);
  const backlogOnly = board([card("CARD-0010", "backlog", 5), card("CARD-0009", "backlog", 5)]);
  assert.equal(scheduleNextCard(backlogOnly, { wipLimit: 1 })?.card.id, "CARD-0009");
  assert.equal(scheduleNextCard(board([card("CARD-0001", "designing") , card("CARD-0002", "backlog")]), { wipLimit: 1 })?.card.id, "CARD-0001");
});
