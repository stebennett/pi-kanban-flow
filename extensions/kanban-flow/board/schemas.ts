import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

const NO_NEWLINE = "^[^\\u0000\\r\\n]*$";
const TIMESTAMP = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$", minLength: 20, maxLength: 30 });
const OBJECT_ID = Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" });
const REQ_ID = Type.String({ pattern: "^REQ-[0-9]{4}$" });
const CARD_ID = Type.String({ pattern: "^CARD-[0-9]{4}$" });
const AC_ID = Type.String({ pattern: "^AC-[0-9]{4}$" });
const FINDING_ID = Type.String({ pattern: "^FINDING-[0-9]{4}$" });
const OPERATION_ID = Type.String({ pattern: "^KFOP-\\d{8}T\\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$" });
const TRANSACTION_ID = Type.String({ pattern: "^KFTX-\\d{8}T\\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$" });
const HISTORY_ID = Type.String({ pattern: "^KFH-\\d{8}T\\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$" });
const RUN_ID = Type.String({ pattern: "^KFRUN-\\d{8}T\\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$" });
const PATH = Type.String({ pattern: "^(?!/)(?!.*\\\\)(?!.*\\u0000)(?!.*[\\r\\n])(?!(?:^|/)\\.{1,2}(?:/|$))(?!(?:.*)/(?:\\.{1,2})(?:/|$)).+$", maxLength: 4096 });
const SEMVER = Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$", minLength: 1, maxLength: 128 });
const MODEL_SELECTOR = Type.String({ pattern: "^[^\\s/]+/[^\\s:]+(?::(?:off|minimal|low|medium|high|xhigh))?$", minLength: 3, maxLength: 512 });
const REPOSITORY_ID = "^(?:[a-z0-9]|[a-z0-9][a-z0-9._-]{0,98}[a-z0-9_-])/(?:[a-z0-9]|[a-z0-9][a-z0-9._-]{0,98}[a-z0-9_-])$";
const SINGLE_LINE = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: NO_NEWLINE });
const MAYBE_TIMESTAMP = Type.Union([TIMESTAMP, Type.Null()]);
const MAYBE_OBJECT_ID = Type.Union([OBJECT_ID, Type.Null()]);
const MAYBE_PATH = Type.Union([PATH, Type.Null()]);
const UNIQUE_PATHS = Type.Array(PATH, { maxItems: 128, uniqueItems: true });
const UNIQUE_CARD_IDS = Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true });
const UNIQUE_REQ_IDS = Type.Array(REQ_ID, { maxItems: 128, uniqueItems: true });

const DURABLE_STATUS = StringEnum([
  "backlog",
  "designing",
  "design_review",
  "ready_for_implementation",
  "implementing",
  "implementation_review",
  "ready_to_ship",
  "shipping",
  "done",
  "replaced",
] as const);
const PHASE = StringEnum([
  "backlog",
  "designing",
  "design_review",
  "ready_for_implementation",
  "implementing",
  "implementation_review",
  "ready_to_ship",
  "shipping",
] as const);

export const TransactionDescriptorSchema = Type.Object(
  {
    id: TRANSACTION_ID,
    operation_id: OPERATION_ID,
    planned_at: TIMESTAMP,
    base_commit: OBJECT_ID,
    card_ids: Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true }),
    paths: Type.Array(PATH, { minItems: 1, maxItems: 256, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type TransactionDescriptor = Static<typeof TransactionDescriptorSchema>;

export const ProjectIdentitySchema = Type.Object(
  { repository_id: Type.String({ pattern: REPOSITORY_ID }) },
  { additionalProperties: false },
);

export const IdCountersSchema = Type.Object(
  {
    next_requirement: Type.Integer({ minimum: 1, maximum: 9999 }),
    next_card: Type.Integer({ minimum: 1, maximum: 9999 }),
    next_acceptance_criterion: Type.Integer({ minimum: 1, maximum: 9999 }),
    next_finding: Type.Integer({ minimum: 1, maximum: 9999 }),
  },
  { additionalProperties: false },
);

export const BoardStateSchema = Type.Object(
  {
    last_reconciled_at: MAYBE_TIMESTAMP,
    last_state_transaction: Type.Union([TransactionDescriptorSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const MigrationSchema = Type.Object(
  {
    source: SINGLE_LINE(100),
    source_version: SINGLE_LINE(64),
    migrated_at: TIMESTAMP,
    operation_id: OPERATION_ID,
  },
  { additionalProperties: false },
);

export const BoardSchema = Type.Object(
  {
    harness: Type.Literal("pi"),
    board_schema_version: Type.Literal(1),
    last_writer_package_version: SEMVER,
    project: ProjectIdentitySchema,
    ids: IdCountersSchema,
    state: BoardStateSchema,
    migration: Type.Union([MigrationSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type Board = Static<typeof BoardSchema>;

export const ProjectCommandSchema = Type.Array(SINGLE_LINE(4096), { minItems: 1, maxItems: 64 });
const AGENT_NAMES = [
  "requirements-producer",
  "requirements-checker",
  "design-producer",
  "design-checker",
  "split-decider",
  "implementer",
  "reviewer",
  "ship-producer",
  "ship-checker",
] as const;
const AGENT_OVERRIDES = Object.fromEntries(AGENT_NAMES.map((name) => [name, Type.Optional(MODEL_SELECTOR)]));
const LENSES = ["acceptance", "functionality", "tests", "readability", "security", "simplicity"] as const;

export const ConfigSchema = Type.Object(
  {
    repository: Type.Object(
      {
        forge: Type.Literal("github"),
        gh_command: SINGLE_LINE(4096),
        remote: Type.Literal("origin"),
        base_branch: Type.Literal("main"),
      },
      { additionalProperties: false },
    ),
    state_prs: Type.Object({ merge_policy: Type.Literal("human") }, { additionalProperties: false }),
    lock: Type.Object(
      {
        ttl_seconds: Type.Integer({ minimum: 60, maximum: 86400 }),
        heartbeat_seconds: Type.Integer({ minimum: 5, maximum: 300 }),
      },
      { additionalProperties: false },
    ),
    scheduler: Type.Object(
      { wip_limit: Type.Integer({ minimum: 1, maximum: 32 }), priority_order: Type.Literal("ascending") },
      { additionalProperties: false },
    ),
    rework: Type.Object(
      {
        design_limit: Type.Integer({ minimum: 0, maximum: 10 }),
        implementation_limit: Type.Integer({ minimum: 0, maximum: 10 }),
      },
      { additionalProperties: false },
    ),
    review: Type.Object(
      { lenses: Type.Array(StringEnum(LENSES), { minItems: 1, maxItems: 6, uniqueItems: true }), max_parallel: Type.Integer({ minimum: 1, maximum: 16 }) },
      { additionalProperties: false },
    ),
    project_commands: Type.Object(
      {
        test: ProjectCommandSchema,
        lint: Type.Optional(ProjectCommandSchema),
        typecheck: Type.Optional(ProjectCommandSchema),
        build: Type.Optional(ProjectCommandSchema),
      },
      { additionalProperties: false },
    ),
    agent_models: Type.Object(
      { default: Type.Literal("inherit"), overrides: Type.Object(AGENT_OVERRIDES, { additionalProperties: false }) },
      { additionalProperties: false },
    ),
    agents: Type.Object(
      { allow_project_overrides: Type.Boolean(), report_overrides: Type.Literal(true) },
      { additionalProperties: false },
    ),
    resources: Type.Object(
      { broad_policy_allowed_skills: Type.Array(PATH, { maxItems: 32, uniqueItems: true }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type Config = Static<typeof ConfigSchema>;

export const PRRecordSchema = Type.Object(
  {
    number: Type.Integer({ minimum: 1 }),
    url: Type.String({ pattern: "^https://github\\.com/[a-z0-9][a-z0-9._-]{0,99}/[a-z0-9][a-z0-9._-]{0,99}/pull/[1-9][0-9]*$" }),
    head: SINGLE_LINE(256),
    base: Type.Literal("main"),
    state: StringEnum(["open", "merged", "closed"] as const),
    operation_id: OPERATION_ID,
    head_commit: OBJECT_ID,
    merge_commit: MAYBE_OBJECT_ID,
    last_checked_at: TIMESTAMP,
  },
  { additionalProperties: false },
);
export type PRRecord = Static<typeof PRRecordSchema>;

export const BlockerSchema = Type.Object(
  {
    reason: SINGLE_LINE(2000),
    source_phase: PHASE,
    resume_status: PHASE,
    created_at: TIMESTAMP,
    evidence: Type.Array(PATH, { maxItems: 32, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type Blocker = Static<typeof BlockerSchema>;

export const SplitOverrideSchema = Type.Object(
  {
    decision: Type.Literal("proceed_unsplit"),
    reason: SINGLE_LINE(2000),
    decided_at: TIMESTAMP,
    operation_id: OPERATION_ID,
  },
  { additionalProperties: false },
);

export const DesignWorkflowSchema = Type.Object(
  {
    branch: Type.Union([SINGLE_LINE(256), Type.Null()]),
    pr: Type.Union([PRRecordSchema, Type.Null()]),
    producer_result_paths: UNIQUE_PATHS,
    checker_result_paths: UNIQUE_PATHS,
    approved_commit: MAYBE_OBJECT_ID,
  },
  { additionalProperties: false },
);
export const SplitDecisionWorkflowSchema = Type.Object(
  { result_path: MAYBE_PATH, decided_at: MAYBE_TIMESTAMP, override: Type.Union([SplitOverrideSchema, Type.Null()]) },
  { additionalProperties: false },
);
export const ImplementationWorkflowSchema = Type.Object(
  { branch: Type.Union([SINGLE_LINE(256), Type.Null()]), result_paths: UNIQUE_PATHS, head_commit: MAYBE_OBJECT_ID },
  { additionalProperties: false },
);
export const ReviewWorkflowSchema = Type.Object(
  { result_paths: UNIQUE_PATHS, reviewed_commit: MAYBE_OBJECT_ID, completed_at: MAYBE_TIMESTAMP },
  { additionalProperties: false },
);
export const ShipWorkflowSchema = Type.Object(
  { product_pr: Type.Union([PRRecordSchema, Type.Null()]), verification_result_paths: UNIQUE_PATHS, merged_commit: MAYBE_OBJECT_ID },
  { additionalProperties: false },
);
export const WorkflowSchema = Type.Object(
  {
    design: DesignWorkflowSchema,
    split_decision: SplitDecisionWorkflowSchema,
    implementation: ImplementationWorkflowSchema,
    review: ReviewWorkflowSchema,
    ship: ShipWorkflowSchema,
  },
  { additionalProperties: false },
);

export const HistoryRecordSchema = Type.Object(
  {
    id: HISTORY_ID,
    at: TIMESTAMP,
    kind: StringEnum([
      "card_created",
      "requirements_grandfathered",
      "requirements_scope_updated",
      "design_started",
      "design_rework_requested",
      "design_pr_opened",
      "design_pr_merged",
      "design_pr_closed",
      "split_not_required",
      "split_override_approved",
      "card_replaced",
      "implementation_started",
      "implementation_completed",
      "implementation_rework_requested",
      "review_completed",
      "product_pr_opened",
      "product_pr_reconciled",
      "product_pr_merged",
      "product_pr_closed",
      "card_blocked",
      "blocker_resolved",
      "deterministic_correction",
    ] as const),
    from_status: Type.Union([DURABLE_STATUS, Type.Null()]),
    to_status: DURABLE_STATUS,
    operation_id: OPERATION_ID,
    transaction_id: TRANSACTION_ID,
    summary: SINGLE_LINE(500),
  },
  { additionalProperties: false },
);

export const AcceptanceCriterionSchema = Type.Object(
  { id: AC_ID, text: SINGLE_LINE(1000), requirement: REQ_ID },
  { additionalProperties: false },
);

export const CardSchema = Type.Object(
  {
    id: CARD_ID,
    title: SINGLE_LINE(200),
    status: DURABLE_STATUS,
    requirements: Type.Array(REQ_ID, { minItems: 1, maxItems: 128, uniqueItems: true }),
    grandfathered_requirements: Type.Array(REQ_ID, { maxItems: 128, uniqueItems: true }),
    acceptance_criteria: Type.Array(AcceptanceCriterionSchema, { minItems: 1, maxItems: 128 }),
    dependencies: Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true }),
    replaces: Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true }),
    replaced_by: Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true }),
    replacement_reason: Type.Union([Type.Literal("requirements_change"), Type.Literal("split_decision"), Type.Null()]),
    priority: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    started_at: MAYBE_TIMESTAMP,
    delivered_at: MAYBE_TIMESTAMP,
    blocked: Type.Union([BlockerSchema, Type.Null()]),
    workflow: WorkflowSchema,
    rework: Type.Object({ design: Type.Integer({ minimum: 0, maximum: 10 }), implementation: Type.Integer({ minimum: 0, maximum: 10 }) }, { additionalProperties: false }),
    history: Type.Array(HistoryRecordSchema, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);
export type Card = Static<typeof CardSchema>;

export const EvidenceSchema = Type.Object(
  {
    kind: StringEnum(["file", "supplied_probe", "command", "git", "github"] as const),
    reference: SINGLE_LINE(500),
    summary: SINGLE_LINE(500),
  },
  { additionalProperties: false },
);
export const FindingSchema = Type.Object(
  {
    criterion: Type.String({ minLength: 1, maxLength: 128, pattern: NO_NEWLINE }),
    severity: StringEnum(["blocking", "non_blocking", "note"] as const),
    location: SINGLE_LINE(500),
    summary: SINGLE_LINE(500),
    detail: SINGLE_LINE(4000),
    suggested_fix: Type.Union([SINGLE_LINE(4000), Type.Literal("none")]),
    evidence: Type.Array(EvidenceSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);

export const LeaseLockSchema = Type.Object(
  {
    version: Type.Literal(1),
    repository_id: ProjectIdentitySchema.properties.repository_id,
    git_common_dir: SINGLE_LINE(4096),
    operation_id: OPERATION_ID,
    transaction_id: Type.Union([TRANSACTION_ID, Type.Null()]),
    owner_token: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    pid: Type.Integer({ minimum: 1 }),
    host: SINGLE_LINE(255),
    pi_session_id: Type.Union([SINGLE_LINE(255), Type.Null()]),
    started_at: TIMESTAMP,
    heartbeat_at: TIMESTAMP,
    expires_at: TIMESTAMP,
    command: StringEnum(["kanban", "kanban-init", "requirements", "migrate", "state-recovery", "blocker-resolution"] as const),
  },
  { additionalProperties: false },
);
export type LeaseLock = Static<typeof LeaseLockSchema>;

export const LeaseMutexSchema = Type.Object(
  {
    version: Type.Literal(1),
    owner_token: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    pid: Type.Integer({ minimum: 1 }),
    host: SINGLE_LINE(255),
    acquired_at: TIMESTAMP,
    expires_at: TIMESTAMP,
  },
  { additionalProperties: false },
);

export const MarkerSchema = Type.Object(
  {
    version: Type.Literal(1),
    kind: StringEnum(["state", "design", "product"] as const),
    operation_id: OPERATION_ID,
    card_ids: Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true }),
    base: Type.Literal("main"),
    transaction_id: Type.Optional(TRANSACTION_ID),
  },
  { additionalProperties: false },
);

export const CommitTrailerSchema = Type.Object(
  {
    kind: StringEnum(["design", "product", "state"] as const),
    operation_id: OPERATION_ID,
    card_ids: Type.Array(CARD_ID, { maxItems: 128, uniqueItems: true }),
    transaction_id: Type.Union([TRANSACTION_ID, Type.Null()]),
  },
  { additionalProperties: false },
);

export const ArtifactAttestationSchema = Type.Object(
  {
    run_id: RUN_ID,
    dispatch_id: RUN_ID,
    tool: SINGLE_LINE(128),
    agent: Type.Union([
      Type.Object(
        { name: SINGLE_LINE(64), source: StringEnum(["package", "project"] as const), path: PATH, sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    model: Type.Union([
      Type.Object({ provider: SINGLE_LINE(128), id: SINGLE_LINE(256), thinking: StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const) }, { additionalProperties: false }),
      Type.Null(),
    ]),
    policy: Type.Object({ name: SINGLE_LINE(128), tools: Type.Array(SINGLE_LINE(128), { maxItems: 64, uniqueItems: true }), snapshot_commit: Type.Union([OBJECT_ID, Type.Null()]) }, { additionalProperties: false }),
    execution_context: Type.Object({ kind: StringEnum(["immutable_snapshot", "product_worktree", "parent"] as const), repository_id: ProjectIdentitySchema.properties.repository_id, branch: Type.Union([SINGLE_LINE(256), Type.Null()]), commit: OBJECT_ID }, { additionalProperties: false }),
    argv: Type.Array(SINGLE_LINE(4096), { minItems: 1, maxItems: 128 }),
    started_at: TIMESTAMP,
    completed_at: TIMESTAMP,
    exit_code: Type.Integer(),
    stop_reason: SINGLE_LINE(128),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
