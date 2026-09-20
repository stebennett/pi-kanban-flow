import { Value } from "typebox/value";
import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { repositoryRelativePath } from "../engine/paths.ts";

const NO_NEWLINE = "^[^\\u0000\\r\\n]*$";
const TEXT = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: NO_NEWLINE });
const MAYBE_TEXT = (maxLength: number) => Type.Union([Type.Literal("none"), Type.String({ minLength: 1, maxLength, pattern: NO_NEWLINE })]);
const OBJECT_ID = Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" });
const MAYBE_OBJECT_ID = Type.Union([OBJECT_ID, Type.Literal("none")]);
const CARD_ID = Type.String({ pattern: "^CARD-[0-9]{4}$" });
const CARD_OR_NONE = Type.Union([CARD_ID, Type.Literal("none")]);
const OPERATION_ID = Type.Union([Type.String({ pattern: "^KFOP-\\d{8}T\\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$" }), Type.Literal("none")]);
const PATH = Type.String({ minLength: 1, maxLength: 4096, pattern: "^(?!/)(?!.*\\\\)(?!.*\\u0000)(?!.*[\\r\\n])(?!(?:^|/)\\.{1,2}(?:/|$))(?!(?:.*)/(?:\\.{1,2})(?:/|$)).+$" });
const URL = Type.String({ pattern: "^https://github\\.com/[a-z0-9][a-z0-9._-]{0,99}/[a-z0-9][a-z0-9._-]{0,99}/pull/[1-9][0-9]*$" });

export const REQUESTED_PHASES = Object.freeze(["none", "design", "split_decision", "implement", "review", "ship"] as const);
export type RequestedPhase = (typeof REQUESTED_PHASES)[number];
export const PUMP_STATUSES = Object.freeze(["proposed", "pending", "waiting", "no_action", "phase_not_eligible", "blocked", "failed", "cancelled", "failed_recovery_required"] as const);
export type PumpStatus = (typeof PUMP_STATUSES)[number];
export const PUMP_ACTIONS = Object.freeze(["design", "design_review", "split_decision", "implement", "review", "ship", "reconcile", "none"] as const);
export type PumpAction = (typeof PUMP_ACTIONS)[number];
export const BOUNDARIES = Object.freeze(["state_pr", "external_pr", "human_decision", "blocker", "external_wait", "no_action", "failure", "none"] as const);
export type PumpBoundary = (typeof BOUNDARIES)[number];

export const PumpRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    requested_phase: StringEnum(REQUESTED_PHASES),
  },
  { additionalProperties: false },
);
export type PumpRequest = Static<typeof PumpRequestSchema>;

export const TransitionSummarySchema = Type.Object(
  {
    from: Type.Union([Type.String({ pattern: "^(?:backlog|designing|design_review|ready_for_implementation|implementing|implementation_review|ready_to_ship|shipping|done|replaced)$" }), Type.Literal("none")]),
    to: Type.Union([Type.String({ pattern: "^(?:backlog|designing|design_review|ready_for_implementation|implementing|implementation_review|ready_to_ship|shipping|done|replaced)$" }), Type.Literal("none")]),
    boundary: StringEnum(BOUNDARIES),
  },
  { additionalProperties: false },
);
export type TransitionSummary = Static<typeof TransitionSummarySchema>;

export const StatePrSummarySchema = Type.Object(
  {
    number: Type.Union([Type.Integer({ minimum: 1 }), Type.Literal("none")]),
    url: Type.Union([URL, Type.Literal("none")]),
    branch: Type.Union([TEXT(256), Type.Literal("none")]),
    state: StringEnum(["open", "merged", "closed", "none"] as const),
  },
  { additionalProperties: false },
);
export type StatePrSummary = Static<typeof StatePrSummarySchema>;

export const ExternalPrSummarySchema = Type.Object(
  {
    kind: StringEnum(["state", "design", "product"] as const),
    card_id: CARD_OR_NONE,
    number: Type.Integer({ minimum: 1 }),
    url: URL,
    state: StringEnum(["open", "merged", "closed"] as const),
    head: TEXT(256),
    head_commit: OBJECT_ID,
    merge_commit: MAYBE_OBJECT_ID,
  },
  { additionalProperties: false },
);
export type ExternalPrSummary = Static<typeof ExternalPrSummarySchema>;

export const ReportIssueSchema = Type.Object(
  {
    code: TEXT(128),
    message: TEXT(2000),
    evidence: Type.Array(PATH, { maxItems: 32, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type ReportIssue = Static<typeof ReportIssueSchema>;

export const ActiveOverrideSchema = Type.Object(
  { name: TEXT(64), source: StringEnum(["package", "project"] as const), path: PATH, sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }) },
  { additionalProperties: false },
);
export const ModelIdentitySchema = Type.Object(
  { agent: TEXT(64), provider: TEXT(128), model: TEXT(256), thinking: StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) },
  { additionalProperties: false },
);

export const PumpReportSchema = Type.Object(
  {
    version: Type.Literal(1),
    workflow: Type.Literal("kanban"),
    status: StringEnum(PUMP_STATUSES),
    operation_id: OPERATION_ID,
    base_commit: MAYBE_OBJECT_ID,
    requested_phase: StringEnum(REQUESTED_PHASES),
    selected_card_id: CARD_OR_NONE,
    action: StringEnum(PUMP_ACTIONS),
    transition: TransitionSummarySchema,
    state_pr: StatePrSummarySchema,
    external_prs: Type.Array(ExternalPrSummarySchema, { maxItems: 128 }),
    blockers: Type.Array(ReportIssueSchema, { maxItems: 32 }),
    waits: Type.Array(ReportIssueSchema, { maxItems: 32 }),
    active_overrides: Type.Array(ActiveOverrideSchema, { maxItems: 128 }),
    models: Type.Array(ModelIdentitySchema, { maxItems: 32 }),
    artifacts: Type.Array(PATH, { maxItems: 256, uniqueItems: true }),
    evidence_gaps: Type.Array(TEXT(500), { maxItems: 128, uniqueItems: true }),
    next_human_action: MAYBE_TEXT(2000),
    issues: Type.Array(ReportIssueSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);
export type PumpReport = Static<typeof PumpReportSchema>;

export const LIFECYCLE_PHASES = Object.freeze(["design", "split_decision", "implement", "review", "ship"] as const);
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];
export const PHASE_OUTCOME_STATUSES = Object.freeze(["completed", "rework", "blocked", "waiting", "inconclusive", "failed", "cancelled", "no_action"] as const);
export type PhaseOutcomeStatus = (typeof PHASE_OUTCOME_STATUSES)[number];

export const PhaseOutcomeSchema = Type.Object(
  {
    phase: StringEnum(LIFECYCLE_PHASES),
    status: StringEnum(PHASE_OUTCOME_STATUSES),
    card_id: CARD_OR_NONE,
    transition: TransitionSummarySchema,
    artifact_paths: Type.Array(PATH, { maxItems: 256, uniqueItems: true }),
    finding_ids: Type.Array(Type.String({ pattern: "^FINDING-[0-9]{4}$" }), { maxItems: 128, uniqueItems: true }),
    evidence: Type.Array(PATH, { maxItems: 128, uniqueItems: true }),
    issues: Type.Array(ReportIssueSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type PhaseOutcome = Static<typeof PhaseOutcomeSchema>;

function fail(message: string): never {
  throw new Error(`Invalid lifecycle contract: ${message}`);
}

function check(schema: unknown, value: unknown, label: string): void {
  if (!Value.Check(schema as any, value)) fail(`${label} does not match its strict schema`);
}

export function validatePumpRequest(value: unknown): PumpRequest {
  check(PumpRequestSchema, value, "pump request");
  return Object.freeze({ ...(value as PumpRequest) });
}

export function validatePhaseOutcome(value: unknown): PhaseOutcome {
  check(PhaseOutcomeSchema, value, "phase outcome");
  const outcome = value as PhaseOutcome;
  validatePathList(outcome.artifact_paths, "phase artifacts");
  validatePathList(outcome.evidence, "phase evidence");
  const sortedIssues = [...outcome.issues].sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
  if (JSON.stringify(sortedIssues) !== JSON.stringify(outcome.issues)) fail("phase issues must be ordered by code then message");
  return value as PhaseOutcome;
}

function validatePathList(paths: readonly string[], label: string): void {
  const normalized = paths.map((path) => repositoryRelativePath(path));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicates`);
}

/** Validate cross-field report rules in addition to the strict TypeBox shape. */
export function validatePumpReport(value: unknown): PumpReport {
  check(PumpReportSchema, value, "pump report");
  const report = value as PumpReport;
  validatePathList(report.artifacts, "report artifacts");
  for (const issue of [...report.blockers, ...report.waits, ...report.issues]) validatePathList(issue.evidence, "report evidence");
  const sortedPrs = [...report.external_prs].sort((left, right) => left.number - right.number || left.kind.localeCompare(right.kind));
  if (JSON.stringify(sortedPrs) !== JSON.stringify(report.external_prs)) fail("external PRs must be ordered by number and kind");
  const sortedIssues = [...report.issues].sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
  if (JSON.stringify(sortedIssues) !== JSON.stringify(report.issues)) fail("issues must be ordered by code then message");
  if (report.status === "no_action") {
    if (report.selected_card_id !== "none" || report.action !== "none" || report.transition.boundary !== "no_action" || report.next_human_action !== "none") fail("no_action report contains a mutation or selected card");
    if (report.state_pr.state !== "none" || report.artifacts.length > 0 || report.blockers.length > 0 || report.issues.length > 0) fail("no_action report contains durable evidence");
  }
  if (report.status === "phase_not_eligible" && report.action !== "none") fail("phase_not_eligible cannot select an action");
  return value as PumpReport;
}

/** Construct the canonical no-action result without adding timestamp churn. */
export function noActionReport(input: { readonly baseCommit: string; readonly operationId?: string; readonly requestedPhase?: RequestedPhase }): PumpReport {
  const report: PumpReport = {
    version: 1,
    workflow: "kanban",
    status: "no_action",
    operation_id: input.operationId ?? "none",
    base_commit: input.baseCommit,
    requested_phase: input.requestedPhase ?? "none",
    selected_card_id: "none",
    action: "none",
    transition: { from: "none", to: "none", boundary: "no_action" },
    state_pr: { number: "none", url: "none", branch: "none", state: "none" },
    external_prs: [],
    blockers: [],
    waits: [],
    active_overrides: [],
    models: [],
    artifacts: [],
    evidence_gaps: [],
    next_human_action: "none",
    issues: [],
  };
  validatePumpReport(report);
  return report;
}

/** Validate and freeze a report assembled by a coordinator. */
export function buildPumpReport(report: PumpReport): PumpReport {
  validatePumpReport(report);
  const freeze = <T>(value: T): T => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    }
    return value;
  };
  return freeze(report);
}

export const createPumpReport = buildPumpReport;

/** Return a stable JSON representation for RPC/print consumers. */
export function stablePumpReportJson(report: PumpReport): string {
  validatePumpReport(report);
  return JSON.stringify(report);
}
