import { StringEnum } from "@earendil-works/pi-ai";

/** A package-owned checker criterion.  The array order is part of the result contract. */
export interface LifecycleCriterion {
  readonly key: string;
  readonly description: string;
}

function frozenCriteria(criteria: readonly LifecycleCriterion[]): readonly LifecycleCriterion[] {
  return Object.freeze(criteria.map((criterion) => Object.freeze({ ...criterion })));
}

/**
 * The complete schema-version-1 design checker contract.  Keep this as the
 * single source used by prompt assembly, dispatch, and result validation.
 */
export const DESIGN_CRITERIA = frozenCriteria([
  { key: "DESIGN-AC-COVERAGE", description: "Every card criterion maps to at least one implementation/test task." },
  { key: "DESIGN-SPEC-FIDELITY", description: "Cited active or grandfathered requirement text supports the design without contradiction." },
  { key: "DESIGN-SCOPE", description: "In/out scope is explicit and every task serves card scope." },
  { key: "DESIGN-TDD", description: "Tasks are ordered as observable failing check, implementation, verification, and refactor where applicable." },
  { key: "DESIGN-INTERFACES", description: "Changed interfaces, data flow, errors, compatibility, and migration effects are precise enough to implement." },
  { key: "DESIGN-TESTABILITY", description: "Objective commands and independently derived assertions can verify the result." },
  { key: "DESIGN-DECISIONS", description: "Alternatives and durable decisions are recorded in the design; ADR persistence is not required in schema version 1." },
  { key: "DESIGN-NO-CODE", description: "The design commit changes only its allowed design path." },
  { key: "DESIGN-PLANNED-PATHS", description: "Typed planned path/action entries exactly match the design's file-level tasks and obey product path policy." },
]);

/** The complete schema-version-1 ship checker contract, in dispatch order. */
export const SHIP_CRITERIA = frozenCriteria([
  { key: "SHIP-BASE", description: "PR base is authoritative main and repository/head identity matches the card." },
  { key: "SHIP-HEAD", description: "PR head commit equals the reviewed implementation commit." },
  { key: "SHIP-BODY", description: "Each PR-body claim is supported by approved artifacts and the exact diff." },
  { key: "SHIP-PATHS", description: "Diff equals the parent-approved product path/action set and excludes state/design-owned paths." },
  { key: "SHIP-MARKER", description: "Marker, branch, card, operation, and PR identity agree uniquely." },
  { key: "SHIP-CHECKS", description: "Required GitHub checks are not known failing at creation; pending checks remain a later reconciliation boundary." },
]);

export const DESIGN_CRITERION_KEYS: readonly string[] = Object.freeze(DESIGN_CRITERIA.map(({ key }) => key));
export const SHIP_CRITERION_KEYS: readonly string[] = Object.freeze(SHIP_CRITERIA.map(({ key }) => key));

export const REVIEW_LENSES = Object.freeze([
  "acceptance",
  "functionality",
  "tests",
  "readability",
  "security",
  "simplicity",
] as const);
export type ReviewLens = (typeof REVIEW_LENSES)[number];
export const REVIEW_LENS_SCHEMA = StringEnum(REVIEW_LENSES);

function fail(message: string): never {
  throw new Error(`Invalid lifecycle criteria: ${message}`);
}

/** Return the semantic keys in an immutable, caller-independent array. */
export function criterionKeys(criteria: readonly LifecycleCriterion[]): readonly string[] {
  return Object.freeze(criteria.map(({ key }) => key));
}

/**
 * Validate a complete criterion result against an ordered package contract.
 * A copy is returned so callers cannot mutate the dispatch order afterwards.
 */
export function validateCriterionOrder(actual: readonly string[], expected: readonly string[]): readonly string[] {
  if (!Array.isArray(actual) || actual.length !== expected.length) fail("criterion set is incomplete");
  if (new Set(actual).size !== actual.length) fail("criterion set contains duplicates");
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) fail(`criterion order differs at index ${index}`);
  }
  return Object.freeze([...actual]);
}

/** Validate and freeze the configured reviewer order without sorting it. */
export function validateConfiguredLenses(lenses: readonly string[]): readonly ReviewLens[] {
  if (!Array.isArray(lenses) || lenses.length === 0 || lenses.length > REVIEW_LENSES.length) fail("review lenses must be non-empty");
  const allowed = new Set<string>(REVIEW_LENSES);
  const seen = new Set<string>();
  const result: ReviewLens[] = [];
  for (const lens of lenses) {
    if (!allowed.has(lens)) fail(`unknown review lens ${String(lens)}`);
    if (seen.has(lens)) fail(`review lens ${lens} is duplicated`);
    seen.add(lens);
    result.push(lens as ReviewLens);
  }
  return Object.freeze(result);
}

/** Alias used by coordinators that name the operation explicitly. */
export const validateReviewLenses = validateConfiguredLenses;

/** Ensure a package criterion catalog itself has not been accidentally edited. */
export function assertCanonicalCriteria(): void {
  validateCriterionOrder(criterionKeys(DESIGN_CRITERIA), DESIGN_CRITERION_KEYS);
  validateCriterionOrder(criterionKeys(SHIP_CRITERIA), SHIP_CRITERION_KEYS);
}
