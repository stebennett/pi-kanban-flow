import { isObjectId, isRuntimeId, isUtcTimestamp } from "../engine/ids.ts";
import {
  applyTransition,
  type BoardSnapshot,
  type CardSnapshot,
  type DurableStatus,
  type TransitionEvent,
  type TransitionMetadata as EngineTransitionMetadata,
  type TransitionRequest as EngineTransitionRequest,
  type TransitionResult,
  type TransitionEffects,
  TransitionError,
  allowedBlockerResumeStatuses,
  isWipStatus,
} from "../engine/transitions.ts";
import { repositoryRelativePath } from "../engine/paths.ts";

export type { BoardSnapshot, CardSnapshot, DurableStatus, TransitionEvent, TransitionResult, TransitionEffects };

/** Parent-allocated history IDs for multi-card effects are optional only for
 * compatibility with the pre-Stage-4 transition seam. Production candidates
 * must provide one unique ID for every changed card. */
export interface TransitionMetadata extends EngineTransitionMetadata {
  readonly historyIds?: Readonly<Record<string, string>>;
}
export interface TransitionRequest extends Omit<EngineTransitionRequest, "metadata"> {
  readonly metadata: TransitionMetadata;
}
export { TransitionError, allowedBlockerResumeStatuses, isWipStatus };

const STATUS_SET = new Set<DurableStatus>([
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
]);
const ARTIFACT_PATH = /^docs\/cards\/artifacts\/CARD-[0-9]{4}\/(?:design-producer|design-check|split-decision|implementation-producer|review-(?:acceptance|functionality|tests|readability|security|simplicity)|ship-producer|ship-check|probe-(?:project-commands|ci-status|pr-state|diff-policy))-KFRUN-\d{8}T\d{9}Z-[0-9a-hjkmnp-tv-z]{8}\.yaml$/;
const DESIGN_BRANCH = /^kanban\/design\/CARD-[0-9]{4}-[a-z0-9-]{1,48}$/;
const PRODUCT_BRANCH = /^kanban\/card\/CARD-[0-9]{4}-[a-z0-9-]{1,48}$/;

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

function canonicalSlug(card: CardSnapshot): string {
  const title = typeof card.title === "string" ? card.title : card.id;
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-").slice(0, 48).replace(/-+$/g, "") || card.id.toLowerCase();
}

export function designBranchFor(card: CardSnapshot): string {
  return `kanban/design/${card.id}-${canonicalSlug(card)}`;
}

export function productBranchFor(card: CardSnapshot): string {
  return `kanban/card/${card.id}-${canonicalSlug(card)}`;
}

function validPath(path: string, label: string, artifact = false): void {
  try { repositoryRelativePath(path); } catch { fail(`${label} must be a normalized repository-relative path`); }
  if (artifact && !ARTIFACT_PATH.test(path)) fail(`${label} is not a canonical Stage 4 artifact path`);
}

function paths(paths: readonly string[], label: string, artifact = false): void {
  if (new Set(paths).size !== paths.length) fail(`${label} contains duplicates`);
  paths.forEach((path) => validPath(path, label, artifact));
}

function requireTimestamp(value: string, label: string): void {
  if (!isUtcTimestamp(value)) fail(`${label} is not a UTC RFC 3339 timestamp`);
}

function requireRuntime(value: string, prefix: "KFOP" | "KFTX" | "KFH"): void {
  if (!isRuntimeId(value, prefix)) fail(`${prefix} identity is invalid`);
}

function date(value: string): number { return new Date(value).getTime(); }

function requireMetadata(metadata: TransitionMetadata): void {
  requireTimestamp(metadata.at, "transition timestamp");
  requireRuntime(metadata.operationId, "KFOP");
  requireRuntime(metadata.transactionId, "KFTX");
  requireRuntime(metadata.historyId, "KFH");
  if (metadata.summary !== undefined && (metadata.summary.trim() !== metadata.summary || metadata.summary.length < 1 || metadata.summary.length > 500 || /[\u0000\r\n]/.test(metadata.summary))) fail("transition summary is invalid");
}

function historyIds(board: BoardSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const card of board.cards) for (const history of card.history) {
    if (ids.has(history.id)) fail(`history ID ${history.id} is duplicated in the authoritative snapshot`);
    ids.add(history.id);
  }
  return ids;
}

function requireCardIdentity(board: BoardSnapshot): void {
  const ids = new Set<string>();
  for (const card of board.cards) {
    if (ids.has(card.id)) fail(`card ${card.id} is duplicated`);
    ids.add(card.id);
    if (!STATUS_SET.has(card.status)) fail(`card ${card.id} has an invalid status`);
    if (card.updated_at && !isUtcTimestamp(card.updated_at)) fail(`card ${card.id} has an invalid updated_at`);
    if (card.started_at !== null) requireTimestamp(card.started_at, `${card.id}.started_at`);
    if (card.delivered_at !== null) requireTimestamp(card.delivered_at, `${card.id}.delivered_at`);
    if (card.workflow.design.branch !== null && !DESIGN_BRANCH.test(card.workflow.design.branch)) fail(`${card.id} has a non-canonical design branch`);
    if (card.workflow.implementation.branch !== null && !PRODUCT_BRANCH.test(card.workflow.implementation.branch)) fail(`${card.id} has a non-canonical product branch`);
    paths(card.workflow.design.producer_result_paths, `${card.id} design producer artifacts`, true);
    paths(card.workflow.design.checker_result_paths, `${card.id} design checker artifacts`, true);
    if (card.workflow.split_decision.result_path !== null) validPath(card.workflow.split_decision.result_path, `${card.id} split artifact`, true);
    paths(card.workflow.implementation.result_paths, `${card.id} implementation artifacts`, true);
    paths(card.workflow.review.result_paths, `${card.id} review artifacts`, true);
    paths(card.workflow.ship.verification_result_paths, `${card.id} ship artifacts`, true);
    if (card.blocked !== null) paths(card.blocked.evidence, `${card.id} blocker evidence`, true);
  }
}

function requireUnblocked(card: CardSnapshot, event: TransitionEvent): void {
  if (card.blocked !== null && event.kind !== "blocker_resolved") fail(`cannot transition blocked card ${card.id} without blocker resolution`);
}

function validateEventEvidence(event: TransitionEvent): void {
  const evidence = "evidence" in event ? event.evidence : undefined;
  if (Array.isArray(evidence)) paths(evidence, "event evidence", true);
  else if (evidence && (event.kind === "design_changes_requested" || event.kind === "design_closed" || event.kind === "design_blocked") && typeof evidence === "object" && "producerResultPath" in evidence) {
    const attempt = evidence as { producerResultPath: string; checkerResultPath: string };
    validPath(attempt.producerResultPath, "producer result", true);
    validPath(attempt.checkerResultPath, "checker result", true);
  }
  if (event.kind === "design_passed") {
    validPath(event.evidence.producerResultPath, "producer result", true);
    validPath(event.evidence.checkerResultPath, "checker result", true);
    if (!DESIGN_BRANCH.test(event.evidence.branch)) fail("design branch is not canonical");
  }
  if (event.kind === "implementation_completed") validPath(event.evidence.resultPath, "implementation result", true);
  if (event.kind === "review_passed") paths(event.evidence.resultPaths, "review result paths", true);
  if (event.kind === "product_pr_opened" || event.kind === "shipping_reconciled") paths(event.evidence.verificationResultPaths, "verification result paths", true);
  if (event.kind === "split_decided") {
    validPath(event.evidence.resultPath, "split result", true);
    requireTimestamp(event.evidence.decidedAt, "split decision timestamp");
  }
  if (event.kind === "split_needs_human" && event.resultPath !== undefined) {
    validPath(event.resultPath, "split result", true);
    if (event.decidedAt !== undefined) requireTimestamp(event.decidedAt, "split decision timestamp");
  }
  if (event.kind === "blocker_resolved" && event.proceedUnsplit) requireTimestamp(event.proceedUnsplit.decidedAt, "split override timestamp");
}

function compareWithoutVolatile(card: CardSnapshot): unknown {
  const value = clone(card) as Record<string, unknown>;
  delete value.updated_at;
  delete value.history;
  return value;
}

function append<T>(existing: readonly T[], values: readonly T[]): T[] {
  const result = [...existing];
  for (const value of values) if (!result.includes(value)) result.push(value);
  return result;
}

function assertAtOrAfter(card: CardSnapshot, at: string): void {
  if (date(at) < date(card.updated_at)) fail(`transition timestamp predates ${card.id}.updated_at`);
}

function validatePreconditions(board: BoardSnapshot, request: TransitionRequest): void {
  requireCardIdentity(board);
  requireMetadata(request.metadata);
  if (!Number.isInteger(request.designLimit) || request.designLimit < 0 || request.designLimit > 10) fail("design rework limit is invalid");
  if (!Number.isInteger(request.implementationLimit) || request.implementationLimit < 0 || request.implementationLimit > 10) fail("implementation rework limit is invalid");
  const card = board.cards.find(({ id }) => id === request.cardId);
  if (!card) fail(`card ${request.cardId} does not exist`);
  if (card.status === "done" || card.status === "replaced") fail(`terminal card ${card.id} is immutable`);
  requireUnblocked(card, request.event);
  assertAtOrAfter(card, request.metadata.at);
  validateEventEvidence(request.event);
  const ids = historyIds(board);
  if (ids.has(request.metadata.historyId)) fail(`history ID ${request.metadata.historyId} already exists`);

  if (request.event.kind === "design_passed") {
    if (!request.event.evidence.pr) fail("design pass requires PR evidence");
    if (card.workflow.design.branch && card.workflow.design.branch !== request.event.evidence.branch) fail("design rework must reuse the existing design branch");
    if (card.workflow.design.pr && request.event.evidence.pr.operation_id !== card.workflow.design.pr.operation_id) fail("design rework must retain the marked PR identity");
    if (!card.workflow.design.pr && request.event.evidence.pr.operation_id !== request.metadata.operationId) fail("new design PR must use the current operation identity");
  }
  if (request.event.kind === "design_merged" || request.event.kind === "recovery_design_merged") {
    if (!card.workflow.design.pr || card.workflow.design.pr.number !== request.event.evidence.pr.number || card.workflow.design.pr.operation_id !== request.event.evidence.pr.operation_id) fail("design merge evidence does not match the card");
    if (request.event.evidence.pr.state !== "merged" || request.event.evidence.pr.merge_commit === null) fail("design merge must prove a merged PR");
  }
  if (request.event.kind === "implementation_completed") {
    if (!card.workflow.design.approved_commit || !card.workflow.split_decision.result_path) fail("implementation requires approved design and split evidence");
    if (!card.workflow.implementation.branch) fail("implementation requires a managed product branch");
    if (!isObjectId(request.event.evidence.headCommit)) fail("implementation head commit is invalid");
  }
  if (request.event.kind === "review_passed") {
    if (!isObjectId(request.event.evidence.reviewedCommit)) fail("reviewed commit is invalid");
    requireTimestamp(request.event.evidence.completedAt, "review completion timestamp");
  }
  if (request.event.kind === "product_pr_opened" || request.event.kind === "shipping_reconciled") {
    if (request.event.evidence.pr.state !== "open" || request.event.evidence.pr.merge_commit !== null) fail("product PR must be open and unmerged");
    if (request.event.kind === "product_pr_opened" && request.event.evidence.pr.operation_id !== request.metadata.operationId) fail("new product PR must use the current operation identity");
  }
  if (request.event.kind === "product_merged" || request.event.kind === "recovery_product_merged") {
    if (!isObjectId(request.event.mergeCommit) || !isUtcTimestamp(request.event.deliveredAt)) fail("product merge evidence is invalid");
    if (request.event.kind === "product_merged") {
      if (!card.workflow.ship.product_pr || request.event.pr.operation_id !== card.workflow.ship.product_pr.operation_id) fail("product merge evidence does not retain the marked PR identity");
    } else if (request.event.pr.operation_id !== request.metadata.operationId) fail("recovery merge must use the current operation identity");
  }
  if (request.event.kind === "shipping_reconciled") {
    const before = card.workflow.ship.product_pr;
    if (!before) fail("shipping reconciliation requires an existing product PR");
    const after = request.event.evidence.pr;
    if (after.operation_id !== before.operation_id) fail("shipping reconciliation must retain the marked product PR identity");
    const material = ["number", "url", "head", "base", "state", "operation_id", "head_commit", "merge_commit"].some((key) => JSON.stringify((before as any)[key]) !== JSON.stringify((after as any)[key]));
    const newEvidence = request.event.evidence.verificationResultPaths.some((path) => !card.workflow.ship.verification_result_paths.includes(path));
    if (!material && !newEvidence) fail("timestamp-only shipping reconciliation is not a mutation");
  }
}

function assertHistoryAppendOnly(before: CardSnapshot, after: CardSnapshot): void {
  if (after.history.length < before.history.length) fail(`${before.id} history was truncated`);
  for (let index = 0; index < before.history.length; index += 1) if (JSON.stringify(before.history[index]) !== JSON.stringify(after.history[index])) fail(`${before.id} history is not append-only`);
  if (after.history.length === before.history.length) fail(`${before.id} semantic change has no history entry`);
  if (after.history.length !== before.history.length + 1) fail(`${before.id} transition must append exactly one history entry`);
}

/**
 * Validate the complete pure candidate.  It rejects timestamp-only changes,
 * card reordering, history replacement, and unlisted same-status effects.
 */
export function validatePureCandidate<TBoard extends BoardSnapshot>(source: TBoard, proposed: TBoard, request: TransitionRequest): void {
  requireCardIdentity(source);
  requireCardIdentity(proposed);
  const sourceIds = source.cards.map(({ id }) => id);
  const proposedExistingIds = proposed.cards.filter(({ id }) => sourceIds.includes(id)).map(({ id }) => id);
  if (JSON.stringify(proposedExistingIds) !== JSON.stringify(sourceIds)) fail("candidate reordered or removed existing cards");
  const sourceById = new Map(source.cards.map((card) => [card.id, card]));
  const changed: CardSnapshot[] = [];
  for (const card of proposed.cards) {
    const before = sourceById.get(card.id);
    if (!before) {
      if (request.event.kind !== "split_decided" || request.event.evidence.decision !== "split_required") fail(`candidate added unexpected card ${card.id}`);
      continue;
    }
    if (JSON.stringify(compareWithoutVolatile(before)) !== JSON.stringify(compareWithoutVolatile(card))) {
      changed.push(card);
      if (card.updated_at !== request.metadata.at) fail(`${card.id} semantic change has the wrong updated_at`);
      assertHistoryAppendOnly(before, card);
    } else {
      if (card.updated_at !== before.updated_at || JSON.stringify(card.history) !== JSON.stringify(before.history)) fail(`${card.id} changed only timestamp/history`);
    }
  }
  if (changed.length === 0) fail("candidate has no semantic change");
  const byId = new Set(proposed.cards.map(({ id }) => id));
  for (const card of proposed.cards) for (const dependency of card.dependencies) if (!byId.has(dependency)) fail(`${card.id} has a missing dependency in the candidate`);
  // Validate the complete resulting graph, including replacement cards and
  // rewired dependants; checking only the new edges misses cycles formed by
  // otherwise-valid existing paths.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail("candidate dependency graph contains a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    const candidate = proposed.cards.find(({ id: candidateId }) => candidateId === id)!;
    for (const dependency of candidate.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const card of proposed.cards) visit(card.id);
  const history = new Set<string>();
  for (const card of proposed.cards) for (const entry of card.history) {
    if (history.has(entry.id)) fail(`candidate duplicates history ID ${entry.id}`);
    history.add(entry.id);
  }
  if (request.event.kind === "shipping_reconciled" && request.event.evidence.verificationResultPaths.length === 0) {
    const before = sourceById.get(request.cardId)!;
    const after = proposed.cards.find(({ id }) => id === request.cardId)!;
    const beforePr = before.workflow.ship.product_pr;
    const afterPr = after.workflow.ship.product_pr;
    if (beforePr && afterPr && JSON.stringify({ ...beforePr, last_checked_at: "" }) === JSON.stringify({ ...afterPr, last_checked_at: "" })) fail("timestamp-only shipping reconciliation is not a legal same-status effect");
  }
}

function normalizeCandidate<TBoard extends BoardSnapshot>(source: TBoard, result: TransitionResult<TBoard>, request: TransitionRequest): TransitionResult<TBoard> {
  const proposed = clone(result.proposedSnapshot) as TBoard;
  const card = proposed.cards.find(({ id }) => id === request.cardId);
  if (!card) fail("transition removed its selected card");
  const sourceCard = source.cards.find(({ id }) => id === request.cardId)!;
  const mutable = card as any;

  // The old engine intentionally keeps the transition table small.  These
  // normalizations make the shared lifecycle effect contract explicit while
  // retaining its public compatibility API.
  if (request.event.kind === "split_decided" && request.event.evidence.decision === "split_required" && mutable.grandfathered_requirements?.length === 0) {
    const replacements = request.event.evidence.replacementCards ?? [];
    const replacementIds = new Set(replacements.map((replacement) => replacement.id));
    const replacementBySource = [...replacementIds].sort();
    const cards = proposed.cards as CardSnapshot[];
    for (const candidate of cards) {
      if (candidate.id === request.cardId || replacementIds.has(candidate.id)) continue;
      if (!candidate.dependencies.includes(request.cardId)) continue;
      const nextDependencies = [...new Set([...candidate.dependencies.filter((id) => id !== request.cardId), ...replacementBySource])].sort();
      const historyId = request.metadata.historyIds?.[candidate.id];
      if (!historyId) fail(`split dependency rewrite requires a parent history ID for ${candidate.id}`);
      (candidate as any).dependencies = nextDependencies;
      (candidate as any).updated_at = request.metadata.at;
      (candidate as any).history = [...candidate.history, {
        id: historyId,
        at: request.metadata.at,
        kind: "requirements_scope_updated",
        from_status: candidate.status,
        to_status: candidate.status,
        operation_id: request.metadata.operationId,
        transaction_id: request.metadata.transactionId,
        summary: `Dependency rewired after split of ${request.cardId}`,
      }];
    }
    for (const candidate of cards) {
      const historyId = request.metadata.historyIds?.[candidate.id];
      if (!historyId || candidate.id === request.cardId || !replacementIds.has(candidate.id)) continue;
      const last = candidate.history[candidate.history.length - 1];
      if (last) (last as any).id = historyId;
    }
    const sourceHistoryId = request.metadata.historyIds?.[request.cardId];
    if (sourceHistoryId) {
      const last = mutable.history[mutable.history.length - 1];
      if (last) last.id = sourceHistoryId;
    }
  }
  if (request.event.kind === "design_changes_requested" && mutable.status === "designing" && mutable.workflow.design.branch === null) {
    mutable.workflow.design.branch = designBranchFor(mutable);
  }
  if (request.event.kind === "design_closed" && mutable.workflow.design.pr) {
    mutable.workflow.design.pr = { ...mutable.workflow.design.pr, state: "closed", merge_commit: null };
  }
  if (request.event.kind === "implementation_completed" && mutable.workflow.implementation.branch === null) {
    mutable.workflow.implementation.branch = productBranchFor(mutable);
  }
  if ((request.event.kind === "design_changes_requested" || request.event.kind === "design_closed" || request.event.kind === "design_blocked") && request.event.evidence) {
    const evidence = request.event.evidence;
    if (Array.isArray(evidence)) mutable.workflow.design.checker_result_paths = append(mutable.workflow.design.checker_result_paths, evidence);
    else {
      if (!("producerResultPath" in evidence)) fail("design evidence must contain producer and checker paths");
      mutable.workflow.design.producer_result_paths = append(mutable.workflow.design.producer_result_paths, [evidence.producerResultPath]);
      mutable.workflow.design.checker_result_paths = append(mutable.workflow.design.checker_result_paths, [evidence.checkerResultPath]);
    }
  }
  if ((request.event.kind === "implementation_blocked") && request.event.evidence) {
    mutable.workflow.implementation.result_paths = append(mutable.workflow.implementation.result_paths, request.event.evidence);
  }
  if ((request.event.kind === "review_changes_requested" || request.event.kind === "review_blocked") && request.event.evidence) {
    mutable.workflow.review.result_paths = append(mutable.workflow.review.result_paths, request.event.evidence);
  }
  if ((request.event.kind === "shipping_code_failure" || request.event.kind === "shipping_blocked") && request.event.evidence) {
    mutable.workflow.ship.verification_result_paths = append(mutable.workflow.ship.verification_result_paths, request.event.evidence);
  }
  if (request.event.kind === "split_decided" && request.event.evidence.decision === "no_split") {
    mutable.workflow.implementation.branch ??= productBranchFor(mutable);
  }
  if (request.event.kind === "split_decided" && request.event.evidence.decision === "split_required" && mutable.grandfathered_requirements && mutable.grandfathered_requirements.length > 0 && mutable.workflow.split_decision.override !== null) {
    // A validated proceed_unsplit resolution makes the next split pump a
    // normal implementation entry without rewriting the original judgment.
    mutable.status = "implementing";
    mutable.blocked = null;
    mutable.workflow.implementation.branch ??= productBranchFor(mutable);
    const history = mutable.history[mutable.history.length - 1];
    // Preserve the original split verdict in history and workflow evidence;
    // the override only authorizes entry into implementation.
    // The returned effect object is immutable; replace it below.
  }
  const cards = proposed.cards.map((candidate) => candidate === card ? mutable : candidate);
  if (request.metadata.historyIds) {
    for (const candidate of cards) {
      const historyId = request.metadata.historyIds[candidate.id];
      if (!historyId) continue;
      const last = candidate.history[candidate.history.length - 1];
      if (last && last.operation_id === request.metadata.operationId && last.transaction_id === request.metadata.transactionId) (last as any).id = historyId;
    }
  }
  const frozen = freeze({ ...proposed, cards: Object.freeze(cards) }) as TBoard;
  const effects: TransitionEffects = { ...result.effects, to: mutable.status };
  const normalized: TransitionResult<TBoard> = { snapshot: frozen, proposedSnapshot: frozen, effects };
  // Source card must remain immutable in memory even if callers supplied a
  // mutable fixture object.
  if (JSON.stringify(sourceCard) !== JSON.stringify(source.cards.find(({ id }) => id === sourceCard.id))) fail("authoritative snapshot was mutated");
  validatePureCandidate(source, frozen, request);
  return normalized;
}

/** Apply a Stage 4 effect without filesystem, GitHub, Pi, or child-process IO. */
export function planLifecycleTransition<TBoard extends BoardSnapshot>(board: TBoard, request: TransitionRequest): TransitionResult<TBoard> {
  validatePreconditions(board, request);
  const result = applyTransition(board, request);
  return normalizeCandidate(board, result, request);
}

export const planTransition = planLifecycleTransition;
export const applyLifecycleEffect = planLifecycleTransition;
export const planPureEffect = planLifecycleTransition;

/** Return the phase's legal WIP status predicate without exposing mutable state. */
export function isLifecycleStatus(status: string): status is DurableStatus {
  return STATUS_SET.has(status as DurableStatus);
}
