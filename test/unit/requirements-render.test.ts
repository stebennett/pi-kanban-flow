import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProducerResult } from "../../extensions/kanban-flow/board/result-schemas.ts";
import type { BoardSnapshot, CardRecord } from "../../extensions/kanban-flow/board/repository.ts";
import { parseCardDocument } from "../../extensions/kanban-flow/board/cards.ts";
import { normalizeRequirementsProposal } from "../../extensions/kanban-flow/requirements/proposal.ts";
import { allocateRequirementsProposal } from "../../extensions/kanban-flow/requirements/allocate.ts";
import { materializeBacklogCards, materializeRequirements, renderRequirements, validateRequirementsCandidate } from "../../extensions/kanban-flow/requirements/render.ts";

const run = "KFRUN-20260101T000000000Z-abcdefgh";
const operation = "KFOP-20260101T000000000Z-abcdefgh";
const transaction = "KFTX-20260101T000000000Z-abcdefgh";
const history = "KFH-20260101T000000000Z-abcdefgh";
const config = { repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" }, lock: { ttl_seconds: 1800, heartbeat_seconds: 30 }, scheduler: { wip_limit: 1, priority_order: "ascending" }, rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 }, project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} }, agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] } } as any;
function source(): BoardSnapshot { return { root: "/repo", board: { harness: "pi", board_schema_version: 1, last_writer_package_version: "0.0.0", project: { repository_id: "owner/repo" }, ids: { next_requirement: 1, next_card: 1, next_acceptance_criterion: 1, next_finding: 1 }, state: { last_reconciled_at: "2026-01-01T00:00:00Z", last_state_transaction: null }, migration: null }, config, cards: [], findingIds: [], requirements: undefined, dashboard: undefined, canonicalDashboard: "", dashboardDrift: false }; }
function payload(): ProducerResult { return { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "completed", summary: "Create", artifacts: [], findings: [], questions: [], evidence: [], planned_paths: [], requirement_changes: [{ temporary_key: "board", action: "create", target_requirement: "none", title: "Create a board", body: "A user can create a board.", acceptance: ["A board is created."], supersedes: [] }], card_changes: [{ temporary_key: "create-board", action: "create", target_card: "none", title: "Create a board", why: "Users need a board.", notes: "Keep initialization deterministic.", requirements: ["board"], acceptance_criteria: [{ text: "A board is created.", requirement: "board" }], dependencies: [], priority: 100 }] } as ProducerResult; }

test("renders golden initial specification and complete backlog card bytes", () => {
  const snapshot = source(); const proposal = normalizeRequirementsProposal(payload(), snapshot); const allocation = allocateRequirementsProposal(snapshot, proposal);
  const requirements = renderRequirements(materializeRequirements(snapshot, proposal, allocation));
  assert.equal(requirements, `# Product specification\n\n## REQ-0001 — Create a board\n\nStatus: active\nSupersedes: none\n\nA user can create a board.\n\n### Acceptance\n\n- A board is created.\n`);
  const cards = materializeBacklogCards(snapshot, proposal, allocation, { at: "2026-01-01T00:00:00Z", operationId: operation, transactionId: transaction, historyIds: { "create-board": history } });
  assert.equal(cards.length, 1); assert.match(cards[0].bytes, /^---\nid: CARD-0001\ntitle: Create a board\nstatus: backlog\n/);
  assert.match(cards[0].bytes, /# CARD-0001: Create a board\n\n## Why\n\nUsers need a board\.\n\n## Notes/);
  const parsed = parseCardDocument(cards[0].bytes, "CARD-0001"); assert.equal(parsed.card.acceptance_criteria[0].id, "AC-0001");
  const board = { ...snapshot.board, ids: { next_requirement: allocation.next.requirement, next_card: allocation.next.card, next_acceptance_criterion: allocation.next.acceptanceCriterion, next_finding: allocation.next.finding } };
  validateRequirementsCandidate({ board, config, cards: cards.map(({ card, why, notes }) => ({ ...card, why, notes } as CardRecord)), requirements });
});

test("preserves existing requirement IDs and numeric order during same-meaning amendment", () => {
  const snapshot = source() as any; snapshot.requirements = `# Product specification\n\n## REQ-0001 — Existing\n\nStatus: active\nSupersedes: none\n\nOld text.\n\n### Acceptance\n\n- Old behavior.\n`; (snapshot.board.ids as any).next_requirement = 2;
  const next = payload(); next.requirement_changes = [{ temporary_key: "none", action: "amend_same_meaning", target_requirement: "REQ-0001", title: "Existing", body: "Clarified text.", acceptance: ["Clarified behavior."], supersedes: [] }]; next.card_changes = [];
  const proposal = normalizeRequirementsProposal(next, snapshot); const allocation = allocateRequirementsProposal(snapshot, proposal);
  const rendered = renderRequirements(materializeRequirements(snapshot, proposal, allocation));
  assert.match(rendered, /## REQ-0001 — Existing/); assert.doesNotMatch(rendered, /REQ-0002/); assert.match(rendered, /Clarified behavior/);
});
