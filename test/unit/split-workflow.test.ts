import test from "node:test";
import assert from "node:assert/strict";
import { validateSplitScope } from "../../extensions/kanban-flow/lifecycle/split.ts";

const card = { id: "CARD-0001", status: "ready_for_implementation", requirements: ["REQ-0001"], acceptance_criteria: [{ id: "AC-0001", text: "A vertical outcome", requirement: "REQ-0001" }], dependencies: [], grandfathered_requirements: [], blocked: null } as any;
const board = { cards: [card, { ...card, id: "CARD-0002", status: "backlog", dependencies: ["CARD-0001"] }] } as any;
const base = { schema_version: 1, dispatch_id: "KFRUN-20260101T000000000Z-abcdefgh", card_id: "CARD-0001", rationale: "scope", evidence: [{ kind: "file", reference: "AC-0001 CARD-0002", summary: "complete scope" }] } as any;

test("split validation accepts a complete vertical replacement scope", () => {
  validateSplitScope({ card, board, result: { ...base, status: "split_required", replacement_cards: [
    { temporary_key: "first", title: "First vertical outcome", why: "why", notes: "", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "A vertical outcome", requirement: "REQ-0001" }], dependencies: [], priority: 1 },
    { temporary_key: "second", title: "Second vertical outcome", why: "why", notes: "", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "A second outcome", requirement: "REQ-0001" }], dependencies: ["first"], priority: 2 },
  ] } });
});

test("split validation rejects omitted acceptance coverage", () => {
  assert.throws(() => validateSplitScope({ card, board: { cards: [card] }, result: { ...base, status: "split_required", replacement_cards: [
    { temporary_key: "first", title: "First", why: "why", notes: "", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "Different", requirement: "REQ-0001" }], dependencies: [], priority: 1 },
    { temporary_key: "second", title: "Second", why: "why", notes: "", requirements: ["REQ-0001"], acceptance_criteria: [{ text: "Another", requirement: "REQ-0001" }], dependencies: [], priority: 2 },
  ] } }));
});

test("no_split has no replacement scope", () => {
  validateSplitScope({ card, board, result: { ...base, status: "no_split", replacement_cards: [] } });
  assert.throws(() => validateSplitScope({ card, board, result: { ...base, status: "no_split", replacement_cards: [{ temporary_key: "x" }] } }));
});
