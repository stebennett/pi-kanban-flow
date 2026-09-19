import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProducerResult } from "../../extensions/kanban-flow/board/result-schemas.ts";
import type { BoardSnapshot, CardRecord } from "../../extensions/kanban-flow/board/repository.ts";
import { normalizeRequirementsProposal } from "../../extensions/kanban-flow/requirements/proposal.ts";

const run = "KFRUN-20260101T000000000Z-abcdefgh";
const spec = `# Product specification

## REQ-0001 — Existing behavior

Status: active
Supersedes: none

Existing behavior is observable.

### Acceptance

- Existing behavior works.
`;

function card(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "CARD-0001", title: "Existing card", status: "backlog", requirements: ["REQ-0001"], grandfathered_requirements: [],
    acceptance_criteria: [{ id: "AC-0001", text: "Existing behavior works.", requirement: "REQ-0001" }], dependencies: [],
    replaces: [], replaced_by: [], replacement_reason: null, priority: 100, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    started_at: null, delivered_at: null, blocked: null, workflow: {} as any, rework: { design: 0, implementation: 0 }, history: [],
    why: "Deliver behavior.", notes: "", designPr: null, productPr: null, splitOverride: null,
    ...overrides,
  } as CardRecord;
}

function snapshot(options: { requirements?: string; cards?: CardRecord[] } = {}): BoardSnapshot {
  return {
    root: "/repo", board: { ids: { next_requirement: 2, next_card: 2, next_acceptance_criterion: 2, next_finding: 1 } } as any,
    config: {} as any, cards: options.cards ?? [], requirements: options.requirements, dashboard: undefined, canonicalDashboard: "", dashboardDrift: false,
  };
}

function producer(overrides: Partial<ProducerResult> = {}): ProducerResult {
  return {
    schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "completed", summary: "Proposal",
    artifacts: [], findings: [], questions: [], evidence: [], planned_paths: [],
    requirement_changes: [{ temporary_key: "board", action: "create", target_requirement: "none", title: "Create board", body: "A user can create a board.", acceptance: ["A board is created."], supersedes: [] }],
    card_changes: [{ temporary_key: "create-board", action: "create", target_card: "none", title: "Create a board", why: "Users need a board.", notes: "", requirements: ["board"], acceptance_criteria: [{ text: "A board is created.", requirement: "board" }], dependencies: [], priority: 100 }],
    ...overrides,
  } as ProducerResult;
}

test("normalizes an initial proposal with forward sibling references without mutating input", () => {
  const payload = producer({
    card_changes: [
      { temporary_key: "second", action: "create", target_card: "none", title: "Second", why: "Second behavior.", notes: "", requirements: ["board"], acceptance_criteria: [{ text: "Second works.", requirement: "board" }], dependencies: ["first"], priority: 200 },
      { temporary_key: "first", action: "create", target_card: "none", title: "First", why: "First behavior.", notes: "", requirements: ["board"], acceptance_criteria: [{ text: "First works.", requirement: "board" }], dependencies: [], priority: 100 },
    ],
  });
  const before = structuredClone(payload);
  const result = normalizeRequirementsProposal(payload, snapshot());
  assert.deepEqual(payload, before);
  assert.deepEqual(result.cardTemporaryKeys, ["first", "second"]);
  assert.deepEqual(result.cardChanges[1].dependencies, [{ kind: "temporary", key: "first" }]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.cardChanges[0]));
});

test("normalizes same-meaning amendment, supersession, retirement, update, and replacement", () => {
  const amended = normalizeRequirementsProposal(producer({
    requirement_changes: [{ temporary_key: "none", action: "amend_same_meaning", target_requirement: "REQ-0001", title: "Existing behavior", body: "Existing behavior remains observable.", acceptance: ["Existing behavior still works."], supersedes: [] }],
    card_changes: [{ temporary_key: "none", action: "update", target_card: "CARD-0001", title: "Existing card", why: "Deliver behavior.", notes: "Clarified.", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "Existing behavior still works.", requirement: "REQ-0001" }], dependencies: [], priority: 100 }],
  }), snapshot({ requirements: spec, cards: [card()] }));
  assert.equal(amended.requirementChanges[0].targetRequirement, "REQ-0001");
  assert.equal(amended.cardChanges[0].action, "update");

  const superseded = normalizeRequirementsProposal(producer({
    requirement_changes: [{ temporary_key: "replacement", action: "supersede", target_requirement: "none", title: "Replacement", body: "Replacement behavior.", acceptance: ["Replacement works."], supersedes: ["REQ-0001"] }],
    card_changes: [{ temporary_key: "none", action: "replace", target_card: "CARD-0001", title: "Replacement card", why: "Deliver replacement.", notes: "", requirements: ["replacement"], acceptance_criteria: [{ text: "Replacement works.", requirement: "replacement" }], dependencies: [], priority: 100 }],
  }), snapshot({ requirements: spec, cards: [card()] }));
  assert.equal(superseded.requirementChanges[0].action, "supersede");
  assert.equal(superseded.cardChanges[0].action, "replace");

  const retired = producer({
    requirement_changes: [{ temporary_key: "none", action: "retire", target_requirement: "REQ-0001", title: "Existing behavior", body: "Existing behavior is observable.", acceptance: ["Existing behavior works."], supersedes: [] }],
    card_changes: [{ temporary_key: "none", action: "replace", target_card: "CARD-0001", title: "Unrelated active coverage", why: "Remove retired behavior.", notes: "", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "No longer relevant.", requirement: "REQ-0001" }], dependencies: [], priority: 100 }],
  });
  assert.throws(() => normalizeRequirementsProposal(retired, snapshot({ requirements: spec, cards: [card()] })), /non-active requirement/);
});

test("rejects duplicate, missing, cyclic, conflicting, stale, terminal, and no-op changes", () => {
  assert.throws(() => normalizeRequirementsProposal(producer({
    requirement_changes: [...producer().requirement_changes, ...producer().requirement_changes],
  }), snapshot()), /temporary keys contains duplicates/);
  assert.throws(() => normalizeRequirementsProposal(producer({
    card_changes: [{ ...producer().card_changes[0], requirements: ["missing"], acceptance_criteria: [{ text: "x", requirement: "missing" }] }],
  }), snapshot()), /unknown requirement temporary key|unknown temporary requirement/);
  assert.throws(() => normalizeRequirementsProposal(producer({
    card_changes: [
      { ...producer().card_changes[0], temporary_key: "a", dependencies: ["b"] },
      { ...producer().card_changes[0], temporary_key: "b", dependencies: ["a"] },
    ],
  }), snapshot()), /dependency cycle/);
  assert.throws(() => normalizeRequirementsProposal(producer({
    requirement_changes: [
      { temporary_key: "none", action: "retire", target_requirement: "REQ-0001", title: "Existing behavior", body: "Existing behavior is observable.", acceptance: ["Existing behavior works."], supersedes: [] },
      { temporary_key: "replacement", action: "supersede", target_requirement: "none", title: "Replacement", body: "Replacement.", acceptance: ["Replacement works."], supersedes: ["REQ-0001"] },
    ],
    card_changes: [],
  }), snapshot({ requirements: spec })), /conflicting actions/);
  assert.throws(() => normalizeRequirementsProposal(producer({ requirement_changes: [], card_changes: [{ ...producer().card_changes[0], temporary_key: "none", action: "update", target_card: "CARD-0001", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "Existing behavior works.", requirement: "REQ-0001" }], title: "Existing card", why: "Deliver behavior." }] }), snapshot({ requirements: spec, cards: [card({ status: "done" })] })), /unsupported status/);
  assert.throws(() => normalizeRequirementsProposal(producer({ requirement_changes: [], card_changes: [{ temporary_key: "none", action: "update", target_card: "CARD-0001", title: "Existing card", why: "Deliver behavior.", notes: "", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "Existing behavior works.", requirement: "REQ-0001" }], dependencies: [], priority: 100 }] }), snapshot({ requirements: spec, cards: [card()] })), /no-op/);
});

test("rejects malformed and oversized text at the public schema boundary", async () => {
  const { Value } = await import("typebox/value");
  const { ProducerResultSchema } = await import("../../extensions/kanban-flow/board/result-schemas.ts");
  assert.equal(Value.Check(ProducerResultSchema, producer({ requirement_changes: [{ ...producer().requirement_changes[0], title: "x\nwrong" }] })), false);
  assert.equal(Value.Check(ProducerResultSchema, producer({ requirement_changes: [{ ...producer().requirement_changes[0], title: "x".repeat(201) }] })), false);
  assert.equal(Value.Check(ProducerResultSchema, { ...producer(), unknown: true }), false);
});
