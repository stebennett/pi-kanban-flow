import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DESIGN_CRITERIA,
  DESIGN_CRITERION_KEYS,
  REVIEW_LENSES,
  SHIP_CRITERIA,
  SHIP_CRITERION_KEYS,
  validateConfiguredLenses,
  validateCriterionOrder,
} from "../../extensions/kanban-flow/lifecycle/criteria.ts";

test("design and ship criteria are complete, ordered, and deeply immutable", () => {
  assert.deepEqual(DESIGN_CRITERION_KEYS, [
    "DESIGN-AC-COVERAGE",
    "DESIGN-SPEC-FIDELITY",
    "DESIGN-SCOPE",
    "DESIGN-TDD",
    "DESIGN-INTERFACES",
    "DESIGN-TESTABILITY",
    "DESIGN-DECISIONS",
    "DESIGN-NO-CODE",
    "DESIGN-PLANNED-PATHS",
  ]);
  assert.deepEqual(SHIP_CRITERION_KEYS, ["SHIP-BASE", "SHIP-HEAD", "SHIP-BODY", "SHIP-PATHS", "SHIP-MARKER", "SHIP-CHECKS"]);
  assert.equal(Object.isFrozen(DESIGN_CRITERIA), true);
  assert.equal(Object.isFrozen(DESIGN_CRITERIA[0]), true);
  assert.equal(Object.isFrozen(SHIP_CRITERIA), true);
  assert.throws(() => (DESIGN_CRITERIA as any).push({ key: "X", description: "X" }));
  assert.throws(() => validateCriterionOrder([DESIGN_CRITERION_KEYS[1]!, ...DESIGN_CRITERION_KEYS.slice(1)], DESIGN_CRITERION_KEYS));
});

test("configured reviewer lenses preserve config order without sharing mutable storage", () => {
  const configured = ["security", "acceptance", "tests"];
  const result = validateConfiguredLenses(configured);
  assert.deepEqual(result, configured);
  assert.equal(Object.isFrozen(result), true);
  configured.reverse();
  assert.deepEqual(result, ["security", "acceptance", "tests"]);
  assert.deepEqual(REVIEW_LENSES, ["acceptance", "functionality", "tests", "readability", "security", "simplicity"]);
  assert.throws(() => validateConfiguredLenses([]));
  assert.throws(() => validateConfiguredLenses(["security", "security"]));
  assert.throws(() => validateConfiguredLenses(["unknown"]));
});
