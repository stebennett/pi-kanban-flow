import type { Blocker, PRRecord } from "../board/schemas.ts";

export const DURABLE_STATUSES = [
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
] as const;

export type DurableStatus = (typeof DURABLE_STATUSES)[number];
export type ReworkPhase = "design" | "implementation";

export interface CardWorkflowSnapshot {
  design: {
    branch: string | null;
    pr: PRRecord | null;
    producer_result_paths: string[];
    checker_result_paths: string[];
    approved_commit: string | null;
    [key: string]: unknown;
  };
  split_decision: {
    result_path: string | null;
    decided_at: string | null;
    override: { decision: "proceed_unsplit"; reason: string; decided_at: string; operation_id: string } | null;
    [key: string]: unknown;
  };
  implementation: {
    branch: string | null;
    result_paths: string[];
    head_commit: string | null;
    [key: string]: unknown;
  };
  review: {
    result_paths: string[];
    reviewed_commit: string | null;
    completed_at: string | null;
    [key: string]: unknown;
  };
  ship: {
    product_pr: PRRecord | null;
    verification_result_paths: string[];
    merged_commit: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CardSnapshot {
  readonly id: string;
  readonly title?: string;
  readonly status: DurableStatus;
  readonly requirements?: readonly string[];
  readonly grandfathered_requirements?: readonly string[];
  readonly acceptance_criteria?: readonly unknown[];
  readonly dependencies: readonly string[];
  readonly replaces?: readonly string[];
  readonly replaced_by?: readonly string[];
  readonly replacement_reason?: string | null;
  readonly priority: number;
  readonly created_at?: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly delivered_at: string | null;
  readonly blocked: Blocker | null;
  readonly workflow: CardWorkflowSnapshot;
  readonly rework: { readonly design: number; readonly implementation: number };
  readonly history: readonly HistoryRecord[];
  readonly [key: string]: unknown;
}

export interface HistoryRecord {
  readonly id: string;
  readonly at: string;
  readonly kind: string;
  readonly from_status: DurableStatus | null;
  readonly to_status: DurableStatus;
  readonly operation_id: string;
  readonly transaction_id: string;
  readonly summary: string;
  readonly [key: string]: unknown;
}

export interface BoardSnapshot {
  readonly cards: readonly CardSnapshot[];
  readonly [key: string]: unknown;
}

export interface TransitionMetadata {
  readonly at: string;
  readonly operationId: string;
  readonly transactionId: string;
  readonly historyId: string;
  readonly summary?: string;
}

export interface DesignEvidence {
  readonly branch: string;
  readonly producerResultPath: string;
  readonly checkerResultPath: string;
  readonly pr?: PRRecord | null;
}

export interface DesignMergeEvidence {
  readonly pr: PRRecord;
  readonly approvedCommit: string;
}

export interface SplitEvidence {
  readonly resultPath: string;
  readonly decidedAt: string;
  readonly decision: "no_split" | "split_required";
  readonly replacementCards?: readonly CardSnapshot[];
}

export interface ImplementationEvidence {
  readonly resultPath: string;
  readonly headCommit: string;
}

export interface ReviewEvidence {
  readonly resultPaths: readonly string[];
  readonly reviewedCommit: string;
  readonly completedAt: string;
}

export interface ProductEvidence {
  readonly pr: PRRecord;
  readonly verificationResultPaths: readonly string[];
}

export type TransitionEvent =
  | { readonly kind: "design_passed"; readonly evidence: DesignEvidence }
  | { readonly kind: "design_changes_requested"; readonly evidence?: readonly string[] }
  | { readonly kind: "design_blocked"; readonly reason: string; readonly evidence?: readonly string[] }
  | { readonly kind: "design_merged"; readonly evidence: DesignMergeEvidence }
  | { readonly kind: "design_closed"; readonly evidence?: readonly string[] }
  | { readonly kind: "split_decided"; readonly evidence: SplitEvidence }
  | { readonly kind: "split_needs_human"; readonly resultPath?: string; readonly decidedAt?: string; readonly reason: string; readonly evidence?: readonly string[] }
  | { readonly kind: "implementation_completed"; readonly evidence: ImplementationEvidence }
  | { readonly kind: "implementation_blocked"; readonly reason: string; readonly evidence?: readonly string[] }
  | { readonly kind: "review_passed"; readonly evidence: ReviewEvidence }
  | { readonly kind: "review_changes_requested"; readonly evidence?: readonly string[] }
  | { readonly kind: "review_blocked"; readonly reason: string; readonly evidence?: readonly string[] }
  | { readonly kind: "product_pr_opened"; readonly evidence: ProductEvidence }
  | { readonly kind: "shipping_reconciled"; readonly evidence: ProductEvidence }
  | { readonly kind: "shipping_code_failure"; readonly evidence?: readonly string[] }
  | { readonly kind: "shipping_blocked"; readonly reason: string; readonly evidence?: readonly string[] }
  | { readonly kind: "product_merged"; readonly pr: PRRecord; readonly mergeCommit: string; readonly deliveredAt: string }
  | { readonly kind: "recovery_product_merged"; readonly pr: PRRecord; readonly mergeCommit: string; readonly deliveredAt: string; readonly evidence?: readonly string[] }
  | { readonly kind: "blocker_resolved"; readonly resumeStatus: DurableStatus; readonly proceedUnsplit?: { readonly reason: string; readonly decidedAt: string } }
  | { readonly kind: "deterministic_correction"; readonly status?: DurableStatus };

export interface TransitionRequest {
  readonly cardId: string;
  readonly event: TransitionEvent;
  readonly metadata: TransitionMetadata;
  readonly designLimit: number;
  readonly implementationLimit: number;
}

export interface TransitionEffects {
  readonly cardId: string;
  readonly from: DurableStatus;
  readonly to: DurableStatus;
  readonly selected: true;
  readonly reconciliationOnly: boolean;
}

export interface TransitionResult<TBoard extends BoardSnapshot = BoardSnapshot> {
  readonly snapshot: TBoard;
  readonly proposedSnapshot: TBoard;
  readonly effects: TransitionEffects;
}

const WIP_STATUSES = new Set<DurableStatus>([
  "designing",
  "design_review",
  "ready_for_implementation",
  "implementing",
  "implementation_review",
  "ready_to_ship",
  "shipping",
]);

const BLOCKER_RESUME: Readonly<Record<DurableStatus, readonly DurableStatus[]>> = {
  backlog: ["backlog"],
  designing: ["designing"],
  design_review: ["design_review", "designing"],
  ready_for_implementation: ["ready_for_implementation"],
  implementing: ["implementing"],
  implementation_review: ["implementation_review", "implementing"],
  ready_to_ship: ["ready_to_ship", "implementing"],
  shipping: ["shipping", "implementing"],
  done: [],
  replaced: [],
};

const REWORK_KINDS: Readonly<Record<ReworkPhase, HistoryRecord["kind"]>> = {
  design: "design_rework_requested",
  implementation: "implementation_rework_requested",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function fail(message: string): never {
  throw new TransitionError(message);
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

function metadataHistory(metadata: TransitionMetadata, from: DurableStatus, to: DurableStatus, kind: string): HistoryRecord {
  return {
    id: metadata.historyId,
    at: metadata.at,
    kind,
    from_status: from,
    to_status: to,
    operation_id: metadata.operationId,
    transaction_id: metadata.transactionId,
    summary: metadata.summary ?? kind,
  };
}

function withHistory(card: CardSnapshot, metadata: TransitionMetadata, kind: string, status: DurableStatus, changes: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    ...card,
    ...changes,
    status,
    updated_at: metadata.at,
    history: [...card.history, metadataHistory(metadata, card.status, status, kind)],
  };
}

function requireStatus(card: CardSnapshot, allowed: readonly DurableStatus[], event: TransitionEvent): void {
  if (!allowed.includes(card.status)) fail(`${event.kind} is not legal from ${card.status}`);
}

function requireUnblocked(card: CardSnapshot, event: TransitionEvent): void {
  if (card.blocked !== null && event.kind !== "blocker_resolved") fail(`cannot transition blocked card ${card.id} without blocker resolution`);
}

function requireNonNegativeLimit(limit: number, phase: ReworkPhase): void {
  if (!Number.isInteger(limit) || limit < 0 || limit > 10) fail(`${phase} rework limit is invalid`);
}

function appendPaths(existing: readonly string[], additions: readonly string[]): string[] {
  return [...existing, ...additions.filter((path) => !existing.includes(path))];
}

function blocker(card: CardSnapshot, metadata: TransitionMetadata, reason: string, evidence: readonly string[] = [], resumeStatus: DurableStatus = card.status): Blocker {
  if (!BLOCKER_RESUME[card.status].includes(resumeStatus)) fail(`cannot resume ${card.status} as ${resumeStatus}`);
  return { reason, source_phase: card.status as Blocker["source_phase"], resume_status: resumeStatus as Blocker["resume_status"], created_at: metadata.at, evidence: [...new Set(evidence)] };
}

function assertMerged(pr: PRRecord): void {
  if (pr.state !== "merged" || pr.merge_commit === null) fail("evidence must prove a merged PR");
}

/**
 * Apply one legal durable event to an immutable board snapshot.
 *
 * The input snapshot is never mutated. External evidence is supplied by the
 * caller; this function does not perform filesystem, Git, GitHub, or model IO.
 */
export function applyTransition<TBoard extends BoardSnapshot>(board: TBoard, request: TransitionRequest): TransitionResult<TBoard> {
  const source = clone(board);
  const index = source.cards.findIndex((card) => card.id === request.cardId);
  if (index < 0) fail(`card ${request.cardId} does not exist`);
  const card = source.cards[index];
  const event = request.event;
  if (card.status === "done" || card.status === "replaced") {
    if (event.kind !== "deterministic_correction") fail(`terminal card ${card.id} is immutable`);
  }
  requireUnblocked(card, event);
  requireNonNegativeLimit(request.designLimit, "design");
  requireNonNegativeLimit(request.implementationLimit, "implementation");

  let changed: CardSnapshot;
  let effects: TransitionEffects;
  switch (event.kind) {
    case "design_passed": {
      requireStatus(card, ["backlog", "designing"], event);
      if (!event.evidence.branch || !event.evidence.producerResultPath || !event.evidence.checkerResultPath) fail("design pass requires branch and producer/checker evidence");
      const next = card.status === "backlog" ? "design_review" : "design_review";
      changed = withHistory(card, request.metadata, "design_pr_opened", next, {
        started_at: card.started_at ?? request.metadata.at,
        workflow: {
          ...card.workflow,
          design: {
            ...card.workflow.design,
            branch: event.evidence.branch,
            pr: event.evidence.pr ?? card.workflow.design.pr,
            producer_result_paths: appendPaths(card.workflow.design.producer_result_paths, [event.evidence.producerResultPath]),
            checker_result_paths: appendPaths(card.workflow.design.checker_result_paths, [event.evidence.checkerResultPath]),
          },
        },
      });
      effects = { cardId: card.id, from: card.status, to: next, selected: true, reconciliationOnly: false };
      break;
    }
    case "design_changes_requested": {
      requireStatus(card, ["backlog", "designing"], event);
      const count = card.rework.design;
      if (count >= request.designLimit) {
        const evidence = event.evidence ?? [];
        changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, "design rework budget exhausted", evidence, "designing") });
      } else {
        changed = withHistory(card, request.metadata, REWORK_KINDS.design, "designing", {
          started_at: card.started_at ?? request.metadata.at,
          rework: { ...card.rework, design: count + 1 },
        });
      }
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "design_blocked": {
      requireStatus(card, ["backlog", "designing"], event);
      changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, event.reason, event.evidence, card.status === "backlog" ? "backlog" : "designing") });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "design_merged": {
      requireStatus(card, ["design_review"], event);
      assertMerged(event.evidence.pr);
      if (event.evidence.approvedCommit !== event.evidence.pr.head_commit) fail("approved design commit must equal merged PR head commit");
      if (card.workflow.design.checker_result_paths.length === 0) fail("design merge requires a checker result");
      changed = withHistory(card, request.metadata, "design_pr_merged", "ready_for_implementation", {
        workflow: { ...card.workflow, design: { ...card.workflow.design, pr: event.evidence.pr, approved_commit: event.evidence.approvedCommit } },
      });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "design_closed": {
      requireStatus(card, ["design_review"], event);
      const count = card.rework.design;
      if (count >= request.designLimit) {
        changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, "design PR closed and rework budget exhausted", event.evidence, "design_review") });
      } else {
        changed = withHistory(card, request.metadata, "design_pr_closed", "designing", {
          rework: { ...card.rework, design: count + 1 },
        });
      }
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "split_decided": {
      requireStatus(card, ["ready_for_implementation"], event);
      if (!card.workflow.design.approved_commit) fail("split assessment requires an approved design");
      const split = event.evidence;
      const decisionChanges = {
        result_path: split.resultPath,
        decided_at: split.decidedAt,
      };
      if (split.decision === "split_required") {
        if (card.grandfathered_requirements && card.grandfathered_requirements.length > 0) {
          changed = withHistory(card, request.metadata, "card_blocked", card.status, {
            blocked: blocker(card, request.metadata, "split is required for a grandfathered card; explicit proceed_unsplit approval is required", [split.resultPath], "ready_for_implementation"),
            workflow: { ...card.workflow, split_decision: { ...card.workflow.split_decision, ...decisionChanges } },
          });
          effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
        } else {
          const replacements = split.replacementCards ?? [];
          if (replacements.length === 0) fail("split_required requires replacement cards");
          const ids = new Set(replacements.map((replacement) => replacement.id));
          if (ids.has(card.id) || replacements.some((replacement) => replacement.status !== "backlog" || !replacement.replaces?.includes(card.id))) fail("split replacements must be distinct backlog cards that replace the source");
          const replaced = withHistory(card, request.metadata, "card_replaced", "replaced", {
            replacement_reason: "split_decision",
            replaced_by: [...ids].sort(),
            blocked: null,
            workflow: { ...card.workflow, split_decision: { ...card.workflow.split_decision, ...decisionChanges } },
          });
          const nextCards = source.cards.map((candidate, candidateIndex) => candidateIndex === index ? replaced : candidate).concat(replacements.map((replacement) => withHistory(replacement, request.metadata, "card_created", "backlog", { updated_at: request.metadata.at })));
          const nextBoard = freeze({ ...source, cards: Object.freeze(nextCards) }) as TBoard;
          return { snapshot: nextBoard, proposedSnapshot: nextBoard, effects: { cardId: card.id, from: card.status, to: "replaced", selected: true, reconciliationOnly: false } };
        }
      } else {
        changed = withHistory(card, request.metadata, "split_not_required", "implementing", {
          workflow: { ...card.workflow, split_decision: { ...card.workflow.split_decision, ...decisionChanges }, implementation: { ...card.workflow.implementation, branch: card.workflow.implementation.branch ?? `kanban/card/${card.id.toLowerCase()}` } },
        });
        effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      }
      break;
    }
    case "split_needs_human": {
      requireStatus(card, ["ready_for_implementation"], event);
      changed = withHistory(card, request.metadata, "card_blocked", card.status, {
        blocked: blocker(card, request.metadata, event.reason, event.evidence ?? (event.resultPath ? [event.resultPath] : []), "ready_for_implementation"),
        workflow: event.resultPath ? { ...card.workflow, split_decision: { ...card.workflow.split_decision, result_path: event.resultPath, decided_at: event.decidedAt ?? request.metadata.at } } : card.workflow,
      });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "implementation_completed": {
      requireStatus(card, ["implementing"], event);
      if (!event.evidence.resultPath || !event.evidence.headCommit) fail("implementation completion requires result and commit evidence");
      changed = withHistory(card, request.metadata, "implementation_completed", "implementation_review", {
        workflow: { ...card.workflow, implementation: { ...card.workflow.implementation, result_paths: appendPaths(card.workflow.implementation.result_paths, [event.evidence.resultPath]), head_commit: event.evidence.headCommit }, review: { ...card.workflow.review, reviewed_commit: null, completed_at: null } },
      });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "implementation_blocked": {
      requireStatus(card, ["implementing"], event);
      changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, event.reason, event.evidence, "implementing") });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "review_passed": {
      requireStatus(card, ["implementation_review"], event);
      if (card.workflow.implementation.head_commit !== event.evidence.reviewedCommit) fail("review must target the current implementation commit");
      if (event.evidence.resultPaths.length === 0) fail("review requires probe or reviewer evidence");
      changed = withHistory(card, request.metadata, "review_completed", "ready_to_ship", {
        workflow: { ...card.workflow, review: { ...card.workflow.review, result_paths: appendPaths(card.workflow.review.result_paths, event.evidence.resultPaths), reviewed_commit: event.evidence.reviewedCommit, completed_at: event.evidence.completedAt } },
      });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "review_changes_requested": {
      requireStatus(card, ["implementation_review"], event);
      const count = card.rework.implementation;
      if (count >= request.implementationLimit) {
        changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, "implementation rework budget exhausted", event.evidence, "implementation_review") });
      } else {
        changed = withHistory(card, request.metadata, REWORK_KINDS.implementation, "implementing", {
          rework: { ...card.rework, implementation: count + 1 },
          workflow: { ...card.workflow, review: { ...card.workflow.review, reviewed_commit: null, completed_at: null } },
        });
      }
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "review_blocked": {
      requireStatus(card, ["implementation_review"], event);
      changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, event.reason, event.evidence, "implementation_review") });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "product_pr_opened": {
      requireStatus(card, ["ready_to_ship"], event);
      if (event.evidence.pr.state !== "open" || event.evidence.pr.head_commit !== card.workflow.review.reviewed_commit) fail("product PR must be open at the reviewed commit");
      changed = withHistory(card, request.metadata, "product_pr_opened", "shipping", {
        workflow: { ...card.workflow, ship: { ...card.workflow.ship, product_pr: event.evidence.pr, verification_result_paths: appendPaths(card.workflow.ship.verification_result_paths, event.evidence.verificationResultPaths) } },
      });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "shipping_reconciled": {
      requireStatus(card, ["shipping"], event);
      if (event.evidence.pr.state !== "open" || event.evidence.pr.number !== card.workflow.ship.product_pr?.number) fail("shipping reconciliation must preserve the marked product PR");
      changed = withHistory(card, request.metadata, "product_pr_reconciled", "shipping", { workflow: { ...card.workflow, ship: { ...card.workflow.ship, product_pr: event.evidence.pr, verification_result_paths: appendPaths(card.workflow.ship.verification_result_paths, event.evidence.verificationResultPaths) } } });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "shipping_code_failure": {
      requireStatus(card, ["shipping"], event);
      const count = card.rework.implementation;
      if (count >= request.implementationLimit) {
        changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, "shipping code failure exhausted implementation rework budget", event.evidence, "shipping") });
      } else {
        changed = withHistory(card, request.metadata, "implementation_rework_requested", "implementing", {
          rework: { ...card.rework, implementation: count + 1 },
          workflow: { ...card.workflow, review: { ...card.workflow.review, reviewed_commit: null, completed_at: null } },
        });
      }
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "shipping_blocked": {
      requireStatus(card, ["shipping"], event);
      changed = withHistory(card, request.metadata, "card_blocked", card.status, { blocked: blocker(card, request.metadata, event.reason, event.evidence, "shipping") });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "product_merged": {
      requireStatus(card, ["shipping"], event);
      const pr = card.workflow.ship.product_pr;
      if (!pr || event.pr.state !== "merged" || event.pr.number !== pr.number || event.pr.merge_commit !== event.mergeCommit) fail("product merge requires matching authoritative merged PR evidence");
      changed = withHistory(card, request.metadata, "product_pr_merged", "done", { delivered_at: event.deliveredAt, workflow: { ...card.workflow, ship: { ...card.workflow.ship, product_pr: event.pr, merged_commit: event.mergeCommit } }, blocked: null });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "recovery_product_merged": {
      requireStatus(card, ["ready_to_ship"], event);
      assertMerged(event.pr);
      if (event.pr.merge_commit !== event.mergeCommit || event.pr.head_commit !== card.workflow.review.reviewed_commit) fail("recovery merge evidence does not match reviewed product PR");
      changed = withHistory(card, request.metadata, "product_pr_merged", "done", { delivered_at: event.deliveredAt, workflow: { ...card.workflow, ship: { ...card.workflow.ship, product_pr: event.pr, merged_commit: event.mergeCommit, verification_result_paths: appendPaths(card.workflow.ship.verification_result_paths, event.evidence ?? []) } }, blocked: null });
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
    case "blocker_resolved": {
      if (card.blocked === null) fail(`card ${card.id} is not blocked`);
      if (!BLOCKER_RESUME[card.status].includes(event.resumeStatus)) fail(`cannot resume ${card.status} as ${event.resumeStatus}`);
      let changes: Partial<CardSnapshot> = { blocked: null };
      if (event.proceedUnsplit) {
        if (card.status !== "ready_for_implementation" || card.workflow.split_decision.result_path === null) fail("proceed_unsplit is only valid after a split decision");
        changes = { ...changes, workflow: { ...card.workflow, split_decision: { ...card.workflow.split_decision, override: { decision: "proceed_unsplit", reason: event.proceedUnsplit.reason, decided_at: event.proceedUnsplit.decidedAt, operation_id: request.metadata.operationId } } } };
      }
      changed = withHistory(card, request.metadata, "blocker_resolved", event.resumeStatus, changes);
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: false };
      break;
    }
    case "deterministic_correction": {
      requireStatus(card, ["done", "replaced"], event);
      changed = withHistory(card, request.metadata, "deterministic_correction", event.status ?? card.status);
      effects = { cardId: card.id, from: card.status, to: changed.status, selected: true, reconciliationOnly: true };
      break;
    }
  }

  const cards = source.cards.map((candidate, candidateIndex) => candidateIndex === index ? changed : candidate);
  const nextBoard = freeze({ ...source, cards: Object.freeze(cards) }) as TBoard;
  return { snapshot: nextBoard, proposedSnapshot: nextBoard, effects };
}

export const transition = applyTransition;
export const isWipStatus = (status: DurableStatus): boolean => WIP_STATUSES.has(status);
export const allowedBlockerResumeStatuses = (status: DurableStatus): readonly DurableStatus[] => BLOCKER_RESUME[status];
