import assert from "node:assert/strict";
import { test } from "node:test";
import type { CardRecord, BoardSnapshot } from "../../extensions/kanban-flow/board/repository.ts";
import type { ProducerResult } from "../../extensions/kanban-flow/board/result-schemas.ts";
import { normalizeRequirementsProposal } from "../../extensions/kanban-flow/requirements/proposal.ts";
import { allocateRequirementsProposal } from "../../extensions/kanban-flow/requirements/allocate.ts";
import { planRequirementsImpact } from "../../extensions/kanban-flow/requirements/impact.ts";

const run = "KFRUN-20260101T000000000Z-abcdefgh"; const operation = "KFOP-20260101T000000000Z-abcdefgh"; const transaction = "KFTX-20260101T000000000Z-abcdefgh";
const oldSpec = `# Product specification\n\n## REQ-0001 — Old\n\nStatus: active\nSupersedes: none\n\nOld behavior.\n\n### Acceptance\n\n- Old works.\n`;
const config = { repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" }, lock: { ttl_seconds: 1800, heartbeat_seconds: 30 }, scheduler: { wip_limit: 2, priority_order: "ascending" }, rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 }, project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} }, agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] } } as any;
function workflow() { return { design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null }, split_decision: { result_path: null, decided_at: null, override: null }, implementation: { branch: null, result_paths: [], head_commit: null }, review: { result_paths: [], reviewed_commit: null, completed_at: null }, ship: { product_pr: null, verification_result_paths: [], merged_commit: null } }; }
function card(id: string, status: string, deps: string[] = []): CardRecord { return { id, title: id, status, requirements: ["REQ-0001"], grandfathered_requirements: [], acceptance_criteria: [{ id: `AC-${id.slice(-4)}`, text: "Old works.", requirement: "REQ-0001" }], dependencies: deps, replaces: [], replaced_by: [], replacement_reason: null, priority: 100, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", started_at: status === "backlog" ? null : "2026-01-01T00:00:00Z", delivered_at: null, blocked: null, workflow: workflow(), rework: { design: 0, implementation: 0 }, history: [], why: "Why.", notes: "" } as CardRecord; }
function snapshot(cards: CardRecord[]): BoardSnapshot { const max = cards.reduce((n, c) => Math.max(n, Number(c.id.slice(-4))), 0); return { root: "/repo", board: { harness: "pi", board_schema_version: 1, last_writer_package_version: "0.0.0", project: { repository_id: "owner/repo" }, ids: { next_requirement: 2, next_card: max + 1, next_acceptance_criterion: max + 1, next_finding: 1 }, state: { last_reconciled_at: "2026-01-01T00:00:00Z", last_state_transaction: null }, migration: null }, config, cards, findingIds: [], requirements: oldSpec, dashboard: undefined, canonicalDashboard: "", dashboardDrift: false }; }
function replacement(cardChanges: ProducerResult["card_changes"]): ProducerResult { return { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "completed", summary: "Replace", artifacts: [], findings: [], questions: [], evidence: [], planned_paths: [], requirement_changes: [{ temporary_key: "new", action: "supersede", target_requirement: "none", title: "New", body: "New behavior.", acceptance: ["New works."], supersedes: ["REQ-0001"] }], card_changes: cardChanges } as ProducerResult; }
function create(key = "follow", dependencies: string[] = []): ProducerResult["card_changes"][number] { return { temporary_key: key, action: "create", target_card: "none", title: "Follow-up", why: "Deliver new behavior.", notes: "", requirements: ["new"], acceptance_criteria: [{ text: "New works.", requirement: "new" }], dependencies, priority: 100 }; }
function update(id: string): ProducerResult["card_changes"][number] { return { temporary_key: "none", action: "update", target_card: id, title: id, why: "Updated scope.", notes: "", requirements: ["new"], acceptance_criteria: [{ text: "New works.", requirement: "new" }], dependencies: [], priority: 100 }; }
function context(keys: string[]) { return { at: "2026-01-02T00:00:00Z", operationId: operation, transactionId: transaction, historyIds: Object.fromEntries(keys.map((key, i) => [key, `KFH-20260102T00000${i}000Z-abcdefgh`])) }; }
function plan(source: BoardSnapshot, payload: ProducerResult, historyKeys: string[]) { const proposal = normalizeRequirementsProposal(payload, source); const allocation = allocateRequirementsProposal(source, proposal); return planRequirementsImpact(source, proposal, allocation, context(historyKeys)); }

test("backlog replacement rewires dependants and preserves reciprocal lineage atomically", () => {
  const original = card("CARD-0001", "backlog"); const dependent = card("CARD-0002", "backlog", ["CARD-0001"]); const source = snapshot([original, dependent]);
  const replace = { ...update("CARD-0001"), action: "replace" as const, title: "Replacement" };
  const updateDependent = { ...update("CARD-0002"), dependencies: ["CARD-0001"] };
  const result = plan(source, replacement([replace, updateDependent]), ["replace:CARD-0001", "CARD-0001", "CARD-0002"]);
  const parent = result.cards.find(({ id }) => id === "CARD-0001")!; const child = result.cards.find(({ id }) => id === "CARD-0003")!; const rewired = result.cards.find(({ id }) => id === "CARD-0002")!;
  assert.equal(parent.status, "replaced"); assert.deepEqual(parent.replaced_by, ["CARD-0003"]); assert.deepEqual(child.replaces, ["CARD-0001"]); assert.deepEqual(rewired.dependencies, ["CARD-0003"]);
  assert.equal(source.cards[0].status, "backlog");
});

test("designing updates scope while retaining workflow artifacts and not spending rework", () => {
  const designing = card("CARD-0001", "designing"); (designing.workflow as any).design.branch = "kanban/design/CARD-0001-x"; (designing.workflow as any).design.producer_result_paths = ["docs/cards/artifacts/CARD-0001/design-producer-KFRUN-20260101T000000000Z-abcdefgh.yaml"];
  const result = plan(snapshot([designing]), replacement([update("CARD-0001"), create()]), ["CARD-0001", "follow"]); const updated = result.cards.find(({ id }) => id === "CARD-0001")!;
  assert.equal(updated.status, "designing"); assert.equal(updated.rework.design, 0); assert.equal((updated.workflow as any).design.producer_result_paths.length, 1); assert.equal((updated.history.at(-1) as any).kind, "requirements_scope_updated");
});

test("design_review plans exact PR closure and returns the card to designing", () => {
  const reviewing = card("CARD-0001", "design_review"); (reviewing.workflow as any).design.branch = "kanban/design/CARD-0001-x"; (reviewing.workflow as any).design.pr = { number: 4, url: "https://github.com/owner/repo/pull/4", head: "kanban/design/CARD-0001-x", base: "main", state: "open", operation_id: operation, head_commit: "a".repeat(40), merge_commit: null, last_checked_at: "2026-01-01T00:00:00Z" };
  const result = plan(snapshot([reviewing]), replacement([update("CARD-0001"), create()]), ["CARD-0001", "follow"]); const updated = result.cards.find(({ id }) => id === "CARD-0001")!;
  assert.equal(updated.status, "designing"); assert.equal((updated.workflow as any).design.pr?.state, "closed"); assert.deepEqual(result.designClosures, [{ cardId: "CARD-0001", number: 4, url: "https://github.com/owner/repo/pull/4", head: "kanban/design/CARD-0001-x", headCommit: "a".repeat(40) }]);
});

test("all approved in-flight statuses are grandfathered and require dependent follow-up coverage", () => {
  for (const status of ["ready_for_implementation", "implementing", "implementation_review", "ready_to_ship", "shipping"]) {
    const current = card("CARD-0001", status); const source = snapshot([current]); const result = plan(source, replacement([create("follow", ["CARD-0001"])]), ["CARD-0001", "follow"]); const retained = result.cards.find(({ id }) => id === "CARD-0001")!;
    assert.equal(retained.status, status); assert.deepEqual(retained.requirements, ["REQ-0001"]); assert.deepEqual(retained.grandfathered_requirements, ["REQ-0001"]); assert.ok(result.grandfatheredCardIds.includes("CARD-0001"));
    assert.throws(() => plan(source, replacement([create("follow")]), ["CARD-0001", "follow"]), /must depend on grandfathered/);
  }
});

test("done cards remain immutable while new backlog coverage is created", () => {
  const done = card("CARD-0001", "done"); done.delivered_at = "2026-01-02T00:00:00Z"; (done.workflow as any).ship.product_pr = { number: 5, url: "https://github.com/owner/repo/pull/5", head: "kanban/card/CARD-0001-x", base: "main", state: "merged", operation_id: operation, head_commit: "b".repeat(40), merge_commit: "c".repeat(40), last_checked_at: "2026-01-02T00:00:00Z" }; (done.workflow as any).ship.merged_commit = "c".repeat(40);
  const before = structuredClone(done); const result = plan(snapshot([done]), replacement([create()]), ["follow"]); assert.deepEqual(result.cards.find(({ id }) => id === "CARD-0001"), before);
});

test("replaced cards remain immutable while their replacement receives the new scope", () => {
  const old = card("CARD-0001", "replaced"); old.replaced_by = ["CARD-0002"]; old.replacement_reason = "requirements_change";
  const current = card("CARD-0002", "backlog"); current.replaces = ["CARD-0001"];
  const before = structuredClone(old); const result = plan(snapshot([old, current]), replacement([update("CARD-0002")]), ["CARD-0002"]);
  assert.deepEqual(result.cards.find(({ id }) => id === "CARD-0001"), before);
});

test("retirement refuses in-flight references because only superseded requirements can be grandfathered", () => {
  const source = snapshot([card("CARD-0001", "implementing")]); const payload = replacement([]);
  payload.requirement_changes = [{ temporary_key: "none", action: "retire", target_requirement: "REQ-0001", title: "Old", body: "Old behavior.", acceptance: ["Old works."], supersedes: [] }];
  assert.throws(() => plan(source, payload, []), /cannot be grandfathered/);
});

test("one invalid affected card rejects the entire multi-card plan", () => {
  const designing = card("CARD-0001", "designing"); const backlog = card("CARD-0002", "backlog");
  assert.throws(() => plan(snapshot([designing, backlog]), replacement([update("CARD-0001"), create()]), ["CARD-0001", "follow"]), /CARD-0002 requires an explicit/);
});
