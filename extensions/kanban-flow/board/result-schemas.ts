import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { EvidenceSchema, FindingSchema } from "./schemas.ts";

const RUN_ID = Type.String({ pattern: "^KFRUN-\\d{8}T\\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$" });
const CARD_OR_NONE = Type.String({ pattern: "^(?:CARD-[0-9]{4}|none)$" });
const TEXT = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "^[^\\u0000\\r\\n]*$" });
const MARKDOWN = (maxLength: number) => Type.String({ maxLength, pattern: "^[^\\u0000]*$" });
const NON_EMPTY_MARKDOWN = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "^[^\\u0000]*$" });
const SIBLING_KEY = Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" });
const PHASE = StringEnum(["requirements", "design", "implementation", "ship"] as const);
const RESULT_STATUS = StringEnum(["completed", "blocked", "needs_human"] as const);
const RESULT_ARTIFACT = StringEnum(["requirements_document", "card_proposal_set", "design_document", "implementation_summary", "product_pr_body"] as const);
const ACTION = StringEnum(["create", "amend_same_meaning", "supersede", "retire"] as const);
const CARD_ACTION = StringEnum(["create", "update", "replace"] as const);
const PLANNED_ACTION = StringEnum(["create", "modify", "delete"] as const);

export const ResultArtifactSchema = Type.Object({ type: RESULT_ARTIFACT, content: Type.String({ minLength: 1, maxLength: 200_000, pattern: "^[^\\u0000]*$" }) }, { additionalProperties: false });
export const ResultQuestionSchema = Type.Object({ question: TEXT(500), why_needed: TEXT(4000), evidence: Type.Array(EvidenceSchema, { maxItems: 128 }) }, { additionalProperties: false });
export const PlannedPathSchema = Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096, pattern: "^(?!/)(?!.*\\\\)(?!.*\\u0000)(?!.*[\\r\\n])(?!(?:^|/)\\.{1,2}(?:/|$)).+$" }), action: PLANNED_ACTION }, { additionalProperties: false });
export const RequirementChangeSchema = Type.Object({
  temporary_key: Type.String({ pattern: "^(?:[a-z][a-z0-9-]{0,31}|none)$" }), action: ACTION, target_requirement: Type.String({ pattern: "^(?:REQ-[0-9]{4}|none)$" }),
  title: TEXT(200), body: MARKDOWN(200_000), acceptance: Type.Array(TEXT(1000), { minItems: 1, maxItems: 128, uniqueItems: true }),
  supersedes: Type.Array(Type.String({ pattern: "^REQ-[0-9]{4}$" }), { maxItems: 128, uniqueItems: true }),
}, { additionalProperties: false });
export const CardChangeSchema = Type.Object({
  temporary_key: Type.String({ pattern: "^(?:[a-z][a-z0-9-]{0,31}|none)$" }), action: CARD_ACTION, target_card: Type.String({ pattern: "^(?:CARD-[0-9]{4}|none)$" }),
  title: TEXT(200), why: NON_EMPTY_MARKDOWN(10_000), notes: MARKDOWN(10_000), requirements: Type.Array(Type.String({ pattern: "^(?:REQ-[0-9]{4}|[a-z][a-z0-9-]{0,31})$" }), { minItems: 1, maxItems: 128, uniqueItems: true }),
  acceptance_criteria: Type.Array(Type.Object({ text: TEXT(1000), requirement: Type.String({ pattern: "^(?:REQ-[0-9]{4}|[a-z][a-z0-9-]{0,31})$" }) }, { additionalProperties: false }), { minItems: 1, maxItems: 128 }),
  dependencies: Type.Array(Type.String({ pattern: "^(?:CARD-[0-9]{4}|[a-z][a-z0-9-]{0,31})$" }), { maxItems: 128, uniqueItems: true }), priority: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
}, { additionalProperties: false });

export const ProducerResultSchema = Type.Object({
  schema_version: Type.Integer({ minimum: 1, maximum: 1 }), dispatch_id: RUN_ID, card_id: CARD_OR_NONE, phase: PHASE, status: RESULT_STATUS, summary: TEXT(500),
  artifacts: Type.Array(ResultArtifactSchema, { maxItems: 128 }), findings: Type.Array(FindingSchema, { maxItems: 128 }), questions: Type.Array(ResultQuestionSchema, { maxItems: 128 }), evidence: Type.Array(EvidenceSchema, { maxItems: 128 }),
  requirement_changes: Type.Array(RequirementChangeSchema, { maxItems: 128 }), card_changes: Type.Array(CardChangeSchema, { maxItems: 128 }), planned_paths: Type.Array(PlannedPathSchema, { maxItems: 256, uniqueItems: true }),
}, { additionalProperties: false });
export type ProducerResult = Static<typeof ProducerResultSchema>;

export const CheckerCriterionSchema = Type.Object({ key: TEXT(128), verdict: StringEnum(["pass", "fail", "inconclusive"] as const), evidence: Type.Array(EvidenceSchema, { minItems: 1, maxItems: 128 }) }, { additionalProperties: false });
export const CheckerResultSchema = Type.Object({
  schema_version: Type.Integer({ minimum: 1, maximum: 1 }), dispatch_id: RUN_ID, card_id: CARD_OR_NONE, phase: StringEnum(["requirements", "design", "ship"] as const), status: StringEnum(["pass", "fail", "inconclusive"] as const), summary: TEXT(500),
  criteria: Type.Array(CheckerCriterionSchema, { minItems: 1, maxItems: 128 }), findings: Type.Array(FindingSchema, { maxItems: 128 }), evidence: Type.Array(EvidenceSchema, { maxItems: 128 }),
}, { additionalProperties: false });
export type CheckerResult = Static<typeof CheckerResultSchema>;

export const ReviewerResultSchema = Type.Object({
  schema_version: Type.Integer({ minimum: 1, maximum: 1 }), dispatch_id: RUN_ID, card_id: Type.String({ pattern: "^CARD-[0-9]{4}$" }), phase: StringEnum(["implementation_review"] as const), lens: StringEnum(["acceptance", "functionality", "tests", "readability", "security", "simplicity"] as const),
  status: StringEnum(["pass", "changes_requested", "inconclusive"] as const), summary: TEXT(500), findings: Type.Array(FindingSchema, { maxItems: 128 }), evidence: Type.Array(EvidenceSchema, { maxItems: 128 }), rerun_recommended: Type.Boolean(),
}, { additionalProperties: false });
export type ReviewerResult = Static<typeof ReviewerResultSchema>;

export const ReplacementCardProposalSchema = Type.Object({ temporary_key: SIBLING_KEY, title: TEXT(200), why: NON_EMPTY_MARKDOWN(10_000), notes: MARKDOWN(10_000), requirements: Type.Array(Type.String({ pattern: "^REQ-[0-9]{4}$" }), { minItems: 1, maxItems: 128, uniqueItems: true }), acceptance_criteria: Type.Array(Type.Object({ text: TEXT(1000), requirement: Type.String({ pattern: "^REQ-[0-9]{4}$" }) }, { additionalProperties: false }), { minItems: 1, maxItems: 128 }), dependencies: Type.Array(Type.String({ pattern: "^(?:CARD-[0-9]{4}|[a-z][a-z0-9-]{0,31})$" }), { maxItems: 128, uniqueItems: true }), priority: Type.Integer({ minimum: 0, maximum: 1_000_000 }) }, { additionalProperties: false });
export const SplitDecisionResultSchema = Type.Object({
  schema_version: Type.Integer({ minimum: 1, maximum: 1 }), dispatch_id: RUN_ID, card_id: Type.String({ pattern: "^CARD-[0-9]{4}$" }), status: StringEnum(["no_split", "split_required", "needs_human"] as const), rationale: TEXT(4000), replacement_cards: Type.Array(ReplacementCardProposalSchema, { maxItems: 32 }), evidence: Type.Array(EvidenceSchema, { maxItems: 128 }),
}, { additionalProperties: false });
export type SplitDecisionResult = Static<typeof SplitDecisionResultSchema>;

export const ProbeObservationSchema = Type.Object({ key: TEXT(128), status: StringEnum(["pass", "fail", "unknown"] as const), detail: TEXT(4000) }, { additionalProperties: false });
export const ProbeResultSchema = Type.Object({
  schema_version: Type.Integer({ minimum: 1, maximum: 1 }), dispatch_id: RUN_ID, card_id: CARD_OR_NONE, probe: StringEnum(["project_commands", "ci_status", "pr_state", "diff_policy"] as const), status: StringEnum(["success", "failure", "inconclusive"] as const), summary: TEXT(500), observations: Type.Array(ProbeObservationSchema, { maxItems: 128, uniqueItems: true }), evidence: Type.Array(EvidenceSchema, { maxItems: 128 }),
}, { additionalProperties: false });
export type ProbeResult = Static<typeof ProbeResultSchema>;

function fail(message: string): never { throw new Error(`Invalid structured result: ${message}`); }
function noDuplicates(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) fail(`${label} contains duplicates`); }
function assertSafeText(value: unknown, label: string): void {
  if (typeof value === "string") {
    if (value !== value.trim()) fail(`${label} must be trimmed`);
    if (/\u0000|[\uD800-\uDFFF]/u.test(value)) fail(`${label} contains forbidden Unicode`);
    return;
  }
  if (Array.isArray(value)) value.forEach((entry, index) => assertSafeText(entry, `${label}[${index}]`));
  else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) assertSafeText(entry, `${label}.${key}`);
}

export function validateResultText(result: unknown): void { assertSafeText(result, "result"); }

export function validateProducerResult(result: ProducerResult, expected: { dispatchId: string; cardId: string; phase: ProducerResult["phase"] }): void {
  validateResultText(result);
  if (result.dispatch_id !== expected.dispatchId || result.card_id !== expected.cardId || result.phase !== expected.phase) fail("producer dispatch identity does not match");
  if ((result.phase === "requirements") !== (result.card_id === "none")) fail("requirements producers require card_id none and card-level producers require CARD-* identity");
  const permittedArtifacts: Record<ProducerResult["phase"], readonly string[]> = {
    requirements: ["requirements_document", "card_proposal_set"], design: ["design_document"], implementation: ["implementation_summary"], ship: ["product_pr_body"],
  };
  if (result.artifacts.some((artifact) => !permittedArtifacts[result.phase].includes(artifact.type))) fail("producer returned an artifact not permitted for its phase");
  if (result.status === "completed" && result.questions.length > 0) fail("completed producer cannot ask questions");
  if (result.status === "needs_human" && result.questions.length === 0) fail("needs_human producer requires a question");
  if (result.status === "blocked" && !result.findings.some((finding) => finding.severity === "blocking") && result.evidence.length === 0) fail("blocked producer requires blocking evidence");
  if (result.phase !== "requirements" && (result.requirement_changes.length > 0 || result.card_changes.length > 0)) fail("non-requirements producer cannot return requirement/card changes");
  if (result.phase !== "design" && result.planned_paths.length > 0) fail(`${result.phase} producer cannot return planned paths`);
  if (result.phase === "design" && result.status === "completed" && result.planned_paths.length === 0) fail("completed design producer requires planned paths");
  if (result.phase === "requirements" && result.status === "completed" && result.requirement_changes.length === 0 && result.card_changes.length === 0) fail("completed requirements producer requires a change");
  if (result.status === "completed" && result.phase !== "requirements" && result.artifacts.length === 0) fail("completed non-requirements producer requires an artifact");
  noDuplicates(result.planned_paths.map((entry) => entry.path), "planned paths");
  noDuplicates(result.requirement_changes.map((entry) => entry.temporary_key).filter((key) => key !== "none"), "requirement temporary keys");
  noDuplicates(result.card_changes.map((entry) => entry.temporary_key).filter((key) => key !== "none"), "card temporary keys");
  for (const change of result.requirement_changes) {
    const isCreate = change.action === "create" || change.action === "supersede";
    if (isCreate !== (change.temporary_key !== "none" && change.target_requirement === "none")) fail("requirement target and temporary key do not match action");
    if ((change.action === "supersede") !== (change.supersedes.length > 0)) fail("requirement supersedes do not match action");
  }
  const requirementKeys = new Set(result.requirement_changes.map((entry) => entry.temporary_key).filter((key) => key !== "none"));
  const cardKeys = new Set(result.card_changes.map((entry) => entry.temporary_key).filter((key) => key !== "none"));
  for (const change of result.card_changes) {
    if ((change.action === "create") !== (change.temporary_key !== "none" && change.target_card === "none")) fail("card target and temporary key do not match action");
    for (const reference of [...change.requirements, ...change.acceptance_criteria.map((criterion) => criterion.requirement)]) if (!/^REQ-/.test(reference) && !requirementKeys.has(reference)) fail(`unknown requirement temporary key ${reference}`);
    for (const reference of change.dependencies) if (!/^CARD-/.test(reference) && !cardKeys.has(reference)) fail(`unknown card temporary key ${reference}`);
  }
}

export function validateCheckerResult(result: CheckerResult, expected: { dispatchId: string; cardId: string; phase: CheckerResult["phase"]; criteria: readonly string[] }): void {
  validateResultText(result);
  if (result.dispatch_id !== expected.dispatchId || result.card_id !== expected.cardId || result.phase !== expected.phase) fail("checker dispatch identity does not match");
  if ((result.phase === "requirements") !== (result.card_id === "none")) fail("requirements checkers require card_id none and card-level checkers require CARD-* identity");
  const keys = result.criteria.map((criterion) => criterion.key);
  noDuplicates(keys, "checker criteria");
  if (keys.length !== expected.criteria.length || keys.some((key, index) => key !== expected.criteria[index])) fail("checker criteria do not match the dispatch");
  const hasFail = result.criteria.some((criterion) => criterion.verdict === "fail");
  const hasUnknown = result.criteria.some((criterion) => criterion.verdict === "inconclusive");
  if (result.status === "pass" && (hasFail || hasUnknown || result.findings.some((finding) => finding.severity === "blocking"))) fail("passing checker has failed criteria or blocking findings");
  if (result.status === "fail" && !hasFail) fail("failing checker requires a failed criterion");
  if (result.status === "inconclusive" && (!hasUnknown || hasFail)) fail("inconclusive checker requires an inconclusive criterion and no failed criterion");
  for (const criterion of result.criteria.filter((entry) => entry.verdict === "fail")) if (!result.findings.some((finding) => finding.criterion === criterion.key && finding.severity === "blocking")) fail(`failed criterion ${criterion.key} requires a blocking finding`);
}

export function validateReviewerResult(result: ReviewerResult, expected: { dispatchId: string; cardId: string; lens: ReviewerResult["lens"] }): void {
  validateResultText(result);
  if (result.dispatch_id !== expected.dispatchId || result.card_id !== expected.cardId || result.lens !== expected.lens) fail("reviewer dispatch identity does not match");
  const blocking = result.findings.some((finding) => finding.severity === "blocking");
  if (result.status === "pass" && blocking) fail("passing reviewer cannot have blocking findings");
  if (result.status === "changes_requested" && !blocking) fail("changes_requested requires a blocking finding");
  if (result.status === "inconclusive" && result.evidence.length === 0) fail("inconclusive reviewer requires evidence");
}

export function validateSplitDecisionResult(result: SplitDecisionResult, expected: { dispatchId: string; cardId: string; originalCriteria?: readonly string[]; dependents?: readonly string[] }): void {
  validateResultText(result);
  if (result.dispatch_id !== expected.dispatchId || result.card_id !== expected.cardId) fail("split dispatch identity does not match");
  if (result.status === "no_split" && result.replacement_cards.length > 0) fail("no_split cannot include replacement cards");
  if (result.status === "split_required" && (result.replacement_cards.length < 2 || result.evidence.length === 0)) fail("split_required requires replacements and evidence");
  if (result.status === "needs_human" && (result.replacement_cards.length > 0 || result.evidence.length === 0)) fail("needs_human requires evidence and cannot include replacement cards");
  noDuplicates(result.replacement_cards.map((card) => card.temporary_key), "replacement temporary keys");
  const siblingKeys = new Set(result.replacement_cards.map((card) => card.temporary_key));
  for (const card of result.replacement_cards) for (const dependency of card.dependencies) if (!/^CARD-/.test(dependency) && !siblingKeys.has(dependency)) fail(`unknown replacement dependency ${dependency}`);
  for (const required of [...(expected.originalCriteria ?? []), ...(expected.dependents ?? [])]) if (!result.evidence.some((entry) => entry.reference.includes(required) || entry.summary.includes(required))) fail(`split evidence does not cover ${required}`);
}

export function validateProbeResult(result: ProbeResult, expected: { dispatchId: string; cardId: string; probe?: ProbeResult["probe"]; observations?: readonly string[] }): void {
  validateResultText(result);
  if (result.dispatch_id !== expected.dispatchId || result.card_id !== expected.cardId || (expected.probe !== undefined && result.probe !== expected.probe)) fail("probe dispatch identity does not match");
  const keys = result.observations.map((observation) => observation.key);
  noDuplicates(keys, "probe observations");
  if (expected.observations && (keys.length !== expected.observations.length || keys.some((key, index) => key !== expected.observations?.[index]))) fail("probe observations do not match the dispatch");
  const failed = result.observations.some((observation) => observation.status === "fail");
  const unknown = result.observations.some((observation) => observation.status === "unknown");
  if (result.status === "success" && (failed || unknown)) fail("successful probe has failed or unknown observations");
  if (result.status === "failure" && !failed) fail("failed probe requires a failed observation");
  if (result.status === "inconclusive" && !unknown) fail("inconclusive probe requires an unknown observation");
}
