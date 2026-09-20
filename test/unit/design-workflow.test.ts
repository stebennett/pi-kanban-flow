import test from "node:test";
import assert from "node:assert/strict";
import { designBranch, designMarker, designPrBody, validateDesignDocument, validateDesignPlannedPaths } from "../../extensions/kanban-flow/lifecycle/design.ts";

const content = `# CARD-0001: Example card

## Context
Requirement REQ-0001 and repository facts.

## Scope
### In scope
Implement the approved behavior.
### Out of scope
None.

## Acceptance mapping
AC-1 maps to TASK-1 and its test.

## Interfaces and data flow
Input and output contracts, errors, compatibility, persistence, and migration effects.

## Implementation tasks
TASK-1: add the product behavior and test.

## Test-first plan
TASK-1 red observable test, minimal green implementation, verification, refactor.

## Objective verification
Run test and typecheck; parent assertions verify the result.

## Alternatives
Reject a larger redesign because it exceeds scope.

## Decisions
Keep the smallest compatible implementation.

## Risks and compatibility
Existing consumers remain compatible; bounded risk is documented.

## Planned paths
- src/example.ts | create | TASK-1
`;

test("validates canonical design structure and exact typed paths", () => {
  const result = validateDesignDocument({ cardId: "CARD-0001", title: "Example card", acceptanceCriteria: ["AC-1"], plannedPaths: [{ path: "src/example.ts", action: "create" }], content });
  assert.equal(result.taskKeys[0], "TASK-1");
  assert.equal(designBranch("CARD-0001", "Example card"), "kanban/design/CARD-0001-example-card");
});

test("rejects design-owned and mismatched planned paths", () => {
  assert.throws(() => validateDesignPlannedPaths([{ path: "docs/designs/CARD-0001.md", action: "create" }]));
  assert.throws(() => validateDesignDocument({ cardId: "CARD-0001", title: "Example card", acceptanceCriteria: ["AC-1"], plannedPaths: [{ path: "src/other.ts", action: "create" }], content }));
});

test("renders one marked design PR body without state transaction identity", () => {
  const body = designPrBody({ cardId: "CARD-0001", title: "Example card", commit: "0123456789abcdef0123456789abcdef01234567", base: "main", plannedPaths: [{ path: "src/example.ts", action: "create" }], producerArtifact: "docs/cards/artifacts/CARD-0001/design-producer-KFRUN-20260101T000000000Z-abcdefgh.yaml", checkerArtifact: "docs/cards/artifacts/CARD-0001/design-check-KFRUN-20260101T000000000Z-abcdefgh.yaml", operationId: "KFOP-20260101T000000000Z-abcdefgh" });
  assert.match(body, /^<!-- kanban-flow:/);
  assert.equal((body.match(/kanban-flow:/g) ?? []).length, 1);
  assert.match(body, /## Design[\s\S]*## Scope[\s\S]*## Verification[\s\S]*## Human merge/);
  assert.deepEqual(designMarker("KFOP-20260101T000000000Z-abcdefgh", "CARD-0001").card_ids, ["CARD-0001"]);
});
