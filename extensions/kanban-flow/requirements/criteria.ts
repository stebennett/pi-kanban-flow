export interface RequirementsCriterion {
  readonly key: string;
  readonly description: string;
}

/** The single schema-version-1 catalog used by dispatch and validation. */
export const REQUIREMENTS_CRITERIA: readonly RequirementsCriterion[] = Object.freeze([
  { key: "REQ-OBSERVABLE", description: "Every requirement and card criterion describes observable, testable behavior." },
  { key: "REQ-ACTIVE-LINKS", description: "Every proposed card maps only to active or new requirements, except engine-derived grandfathering." },
  { key: "REQ-COVERAGE", description: "Proposed and updated backlog cards cover every behavior of each active changed requirement." },
  { key: "REQ-NO-OVERLAP", description: "Card scope does not duplicate another proposed or existing active card without an explicit replacement." },
  { key: "REQ-VERTICAL", description: "Each card is independently deliverable behavior rather than a horizontal implementation layer." },
  { key: "REQ-SIZED", description: "Each proposed card is plausibly deliverable within one design and implementation cycle." },
  { key: "REQ-DAG", description: "All resulting dependencies resolve and are acyclic." },
  { key: "REQ-SUPERSESSION", description: "Same-meaning amendments retain IDs, changed meaning allocates replacements, and retirement/supersession links are coherent." },
  { key: "REQ-GRANDFATHER-COVERAGE", description: "Every grandfathered card is retained unchanged and followed by complete active-requirement coverage with required dependencies." },
].map((criterion) => Object.freeze(criterion)));

export const REQUIREMENTS_CRITERION_KEYS: readonly string[] = Object.freeze(REQUIREMENTS_CRITERIA.map(({ key }) => key));
