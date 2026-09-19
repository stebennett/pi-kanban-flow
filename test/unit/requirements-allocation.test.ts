import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardSnapshot, CardRecord } from "../../extensions/kanban-flow/board/repository.ts";
import type { ProducerResult } from "../../extensions/kanban-flow/board/result-schemas.ts";
import { normalizeRequirementsProposal } from "../../extensions/kanban-flow/requirements/proposal.ts";
import { allocateRequirementsProposal } from "../../extensions/kanban-flow/requirements/allocate.ts";

const run = "KFRUN-20260101T000000000Z-abcdefgh";
const spec = `# Product specification\n\n## REQ-0001 — Existing\n\nStatus: active\nSupersedes: none\n\nExisting behavior.\n\n### Acceptance\n\n- Existing works.\n`;
function snapshot(counter = 2): BoardSnapshot { return { root: "/repo", board: { ids: { next_requirement: counter, next_card: counter, next_acceptance_criterion: counter, next_finding: counter } } as any, config: {} as any, cards: [], findingIds: [], requirements: counter === 1 ? undefined : spec, dashboard: undefined, canonicalDashboard: "", dashboardDrift: false }; }
function producer(): ProducerResult { return { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "completed", summary: "x", artifacts: [], findings: [], questions: [], evidence: [], planned_paths: [], requirement_changes: [{ temporary_key: "new", action: "create", target_requirement: "none", title: "New", body: "New behavior.", acceptance: ["New works."], supersedes: [] }], card_changes: [{ temporary_key: "new-card", action: "create", target_card: "none", title: "New card", why: "Why.", notes: "", requirements: ["new"], acceptance_criteria: [{ text: "New works.", requirement: "new" }], dependencies: [], priority: 10 }] } as ProducerResult; }

test("previews stable REQ/CARD/AC/FINDING allocations without consuming counters", () => {
  const source = snapshot(1); const before = structuredClone(source.board.ids);
  const proposal = normalizeRequirementsProposal(producer(), source);
  const first = allocateRequirementsProposal(source, proposal, { producer: 1, checker: 2 });
  const second = allocateRequirementsProposal(source, proposal, { producer: 1, checker: 2 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.requirementIds, { new: "REQ-0001" });
  assert.deepEqual(first.cardIds, { "new-card": "CARD-0001" });
  assert.deepEqual(first.acceptanceIds, { "new-card": ["AC-0001"] });
  assert.deepEqual(first.producerFindingIds, ["FINDING-0001"]);
  assert.deepEqual(first.checkerFindingIds, ["FINDING-0002", "FINDING-0003"]);
  assert.deepEqual(source.board.ids, before);
});

test("retains exact matching acceptance IDs on backlog updates and allocates changed criteria", () => {
  const source = snapshot() as any;
  source.cards = [{ id: "CARD-0001", title: "Existing", status: "backlog", requirements: ["REQ-0001"], grandfathered_requirements: [], acceptance_criteria: [{ id: "AC-0001", text: "Existing works.", requirement: "REQ-0001" }], dependencies: [], replaces: [], replaced_by: [], replacement_reason: null, priority: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", started_at: null, delivered_at: null, blocked: null, workflow: {} as any, rework: { design: 0, implementation: 0 }, history: [], why: "Why.", notes: "", designPr: null, productPr: null, splitOverride: null }] as CardRecord[];
  const payload = producer(); payload.requirement_changes = []; payload.card_changes = [{ temporary_key: "none", action: "update", target_card: "CARD-0001", title: "Existing", why: "Why.", notes: "Changed.", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "Existing works.", requirement: "REQ-0001" }, { text: "Another works.", requirement: "REQ-0001" }], dependencies: [], priority: 1 }];
  const proposal = normalizeRequirementsProposal(payload, source); const result = allocateRequirementsProposal(source, proposal);
  assert.deepEqual(result.acceptanceIds["CARD-0001"], ["AC-0001", "AC-0002"]);
  assert.equal(result.next.acceptanceCriterion, 3);
});

test("rejects stale counters, exhaustion, and historical finding reuse", () => {
  const proposal = normalizeRequirementsProposal(producer(), snapshot(1));
  const stale = snapshot(1) as any; stale.findingIds = ["FINDING-0001"];
  assert.throws(() => allocateRequirementsProposal(stale, proposal), /finding counter would reuse/);
  const exhausted = snapshot(9999) as any; exhausted.requirements = undefined;
  assert.throws(() => allocateRequirementsProposal(exhausted, normalizeRequirementsProposal(producer(), exhausted)), /namespace is exhausted/);
});
