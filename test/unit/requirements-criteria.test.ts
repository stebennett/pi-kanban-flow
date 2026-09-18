import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIREMENTS_CRITERIA, REQUIREMENTS_CRITERION_KEYS } from "../../extensions/kanban-flow/requirements/criteria.ts";

test("requirements criteria are fixed, ordered, unique, and immutable", () => {
  assert.deepEqual(REQUIREMENTS_CRITERION_KEYS, [
    "REQ-OBSERVABLE", "REQ-ACTIVE-LINKS", "REQ-COVERAGE", "REQ-NO-OVERLAP", "REQ-VERTICAL",
    "REQ-SIZED", "REQ-DAG", "REQ-SUPERSESSION", "REQ-GRANDFATHER-COVERAGE",
  ]);
  assert.equal(new Set(REQUIREMENTS_CRITERION_KEYS).size, 9);
  assert.ok(Object.isFrozen(REQUIREMENTS_CRITERIA));
  assert.ok(REQUIREMENTS_CRITERIA.every(Object.isFrozen));
  assert.throws(() => (REQUIREMENTS_CRITERIA as any).push({ key: "x", description: "x" }));
});
