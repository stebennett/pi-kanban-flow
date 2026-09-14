import { isNumericId, isObjectId, isUtcTimestamp } from "../engine/ids.ts";
import { allowedBlockerResumeStatuses, type DurableStatus } from "../engine/transitions.ts";
import type { Board, Blocker, Config } from "./schemas.ts";
import type { CardRecord } from "./repository.ts";
import { validateConfigSemantics } from "./config.ts";
import { validateRequirementLineage, type Requirement } from "./requirements.ts";

const STATUSES = new Set<DurableStatus>(["backlog", "designing", "design_review", "ready_for_implementation", "implementing", "implementation_review", "ready_to_ship", "shipping", "done", "replaced"]);
type ValidationWorkflow = {
  design: { branch: string | null; pr: { state: string } | null; producer_result_paths: string[]; checker_result_paths: string[]; approved_commit: string | null };
  split_decision: { result_path: string | null; decided_at: string | null; override: { decision: string } | null };
  implementation: { branch: string | null; result_paths: string[]; head_commit: string | null };
  review: { result_paths: string[]; reviewed_commit: string | null; completed_at: string | null };
  ship: { product_pr: { state: string } | null; verification_result_paths: string[]; merged_commit: string | null };
};
function workflowOf(card: CardRecord): ValidationWorkflow { return card.workflow as unknown as ValidationWorkflow; }

function fail(message: string): never { throw new Error(`Invalid kanban board state: ${message}`); }
function uniqueAscending(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
  const sorted = [...values].sort();
  if (sorted.some((value, index) => value !== values[index])) fail(`${label} must be sorted`);
}
function emptyWorkflow(card: CardRecord): boolean {
  const workflow = workflowOf(card);
  return workflow.design.branch === null && workflow.design.pr === null && workflow.design.producer_result_paths.length === 0 && workflow.design.checker_result_paths.length === 0 && workflow.design.approved_commit === null
    && workflow.split_decision.result_path === null && workflow.split_decision.decided_at === null && workflow.split_decision.override === null
    && workflow.implementation.branch === null && workflow.implementation.result_paths.length === 0 && workflow.implementation.head_commit === null
    && workflow.review.result_paths.length === 0 && workflow.review.reviewed_commit === null && workflow.review.completed_at === null
    && workflow.ship.product_pr === null && workflow.ship.verification_result_paths.length === 0 && workflow.ship.merged_commit === null;
}
function detectDependencyCycles(cards: readonly CardRecord[]): void {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(`dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const card of cards) visit(card.id);
}

/** Validate cross-record invariants after strict shape validation. */
export function validateBoardSemantics(input: { board: Board; config: Config; cards: readonly CardRecord[]; requirements?: readonly Requirement[] }): void {
  validateConfigSemantics(input.config);
  const byId = new Map<string, CardRecord>();
  let maxRequirement = 0;
  let maxCard = 0;
  let maxAcceptance = 0;
  let maxFinding = 0;
  for (const card of input.cards) {
    if (byId.has(card.id)) fail(`duplicate card ID ${card.id}`);
    byId.set(card.id, card);
    if (!isNumericId(card.id, "CARD")) fail(`invalid card ID ${card.id}`);
    maxCard = Math.max(maxCard, Number(card.id.slice(-4)));
    for (const requirement of card.requirements) {
      if (!isNumericId(requirement, "REQ")) fail(`${card.id} has invalid requirement ${requirement}`);
      maxRequirement = Math.max(maxRequirement, Number(requirement.slice(-4)));
    }
    uniqueAscending(card.requirements, `${card.id} requirements`);
    uniqueAscending(card.grandfathered_requirements, `${card.id} grandfathered requirements`);
    uniqueAscending(card.dependencies, `${card.id} dependencies`);
    uniqueAscending(card.replaces, `${card.id} replaces`);
    uniqueAscending(card.replaced_by, `${card.id} replaced_by`);
    if (!STATUSES.has(card.status as DurableStatus)) fail(`${card.id} has invalid status ${card.status}`);
    const workflow = workflowOf(card);
    if (card.grandfathered_requirements.some((id) => !card.requirements.includes(id))) fail(`${card.id} has an unrelated grandfathered requirement`);
    if (card.grandfathered_requirements.length > 0 && !["ready_for_implementation", "implementing", "implementation_review", "ready_to_ship", "shipping", "done"].includes(card.status)) fail(`${card.id} cannot be grandfathered in ${card.status}`);
    if ((card.status === "replaced") !== (card.replacement_reason !== null)) fail(`${card.id} replacement reason does not match status`);
    if (card.status !== "replaced" && card.replaced_by.length > 0) fail(`${card.id} has replacement lineage without replaced status`);
    if (card.status === "replaced" && card.replaced_by.length === 0) fail(`${card.id} must identify replacement cards`);
    if (card.dependencies.includes(card.id) || card.replaces.includes(card.id) || card.replaced_by.includes(card.id)) fail(`${card.id} references itself`);
    if (card.updated_at < card.created_at || (card.started_at !== null && card.started_at < card.created_at) || (card.delivered_at !== null && card.started_at !== null && card.delivered_at < card.started_at)) fail(`${card.id} has invalid chronology`);
    if (!isUtcTimestamp(card.created_at) || !isUtcTimestamp(card.updated_at) || (card.started_at !== null && !isUtcTimestamp(card.started_at)) || (card.delivered_at !== null && !isUtcTimestamp(card.delivered_at))) fail(`${card.id} has an invalid timestamp`);
    for (const criterion of card.acceptance_criteria as Array<{ id: string; requirement: string }>) {
      if (!isNumericId(criterion.id, "AC")) fail(`${card.id} has invalid acceptance ID ${criterion.id}`);
      if (!card.requirements.includes(criterion.requirement) && !card.grandfathered_requirements.includes(criterion.requirement)) fail(`${card.id} acceptance criterion references an unrelated requirement`);
      maxAcceptance = Math.max(maxAcceptance, Number(criterion.id.slice(-4)));
    }
    const criterionIds = (card.acceptance_criteria as Array<{ id: string }>).map((criterion) => criterion.id);
    uniqueAscending(criterionIds, `${card.id} acceptance criteria`);
    for (const history of card.history as Array<{ at: string; from_status: DurableStatus | null; to_status: DurableStatus }>) {
      if (!isUtcTimestamp(history.at)) fail(`${card.id} history has an invalid timestamp`);
      if (history.from_status !== null && !STATUSES.has(history.from_status)) fail(`${card.id} history has an invalid source status`);
      if (!STATUSES.has(history.to_status)) fail(`${card.id} history has an invalid target status`);
    }
    const histories = card.history as Array<{ at: string; from_status: DurableStatus | null; to_status: DurableStatus }>;
    for (let index = 1; index < histories.length; index += 1) if (histories[index - 1].at > histories[index].at) fail(`${card.id} history is not chronological`);
    const blocked = card.blocked as unknown as Blocker | null;
    if (blocked !== null && !allowedBlockerResumeStatuses(card.status as DurableStatus).includes(blocked.resume_status as DurableStatus)) fail(`${card.id} has an invalid blocker resume status`);
    if (blocked !== null) uniqueAscending(blocked.evidence, `${card.id} blocker evidence`);
    if (card.status === "done" || card.status === "replaced") {
      if (blocked !== null) fail(`${card.id} terminal card is blocked`);
    }
    if (card.status === "backlog" && (card.started_at !== null || card.delivered_at !== null || !emptyWorkflow(card))) fail(`${card.id} backlog metadata is not empty`);
    if (card.status === "done" && (card.delivered_at === null || workflow.ship.product_pr?.state !== "merged" || workflow.ship.merged_commit === null)) fail(`${card.id} done metadata does not prove a merged product PR`);
    if (workflow.design.approved_commit !== null && !isObjectId(workflow.design.approved_commit)) fail(`${card.id} has an invalid approved design commit`);
    if (workflow.implementation.head_commit !== null && !isObjectId(workflow.implementation.head_commit)) fail(`${card.id} has an invalid implementation commit`);
    if (workflow.review.reviewed_commit !== null && !isObjectId(workflow.review.reviewed_commit)) fail(`${card.id} has an invalid review commit`);
    if (workflow.ship.merged_commit !== null && !isObjectId(workflow.ship.merged_commit)) fail(`${card.id} has an invalid merge commit`);
    if (card.rework.design > input.config.rework.design_limit || card.rework.implementation > input.config.rework.implementation_limit) fail(`${card.id} exceeds configured rework budget`);
  }
  for (const card of input.cards) {
    for (const dependency of card.dependencies) if (!byId.has(dependency)) fail(`${card.id} references missing dependency ${dependency}`);
    for (const replacement of card.replaces) {
      const target = byId.get(replacement);
      if (!target || !target.replaced_by.includes(card.id)) fail(`${card.id} replacement lineage is not reciprocal`);
    }
    for (const replacement of card.replaced_by) {
      const target = byId.get(replacement);
      if (!target || !target.replaces.includes(card.id)) fail(`${card.id} replacement lineage is not reciprocal`);
    }
  }
  detectDependencyCycles(input.cards);
  if (input.board.ids.next_requirement <= maxRequirement || input.board.ids.next_card <= maxCard || input.board.ids.next_acceptance_criterion <= maxAcceptance || input.board.ids.next_finding <= maxFinding) fail("ID counters would reuse an allocated identifier");
  if (input.requirements) {
    validateRequirementLineage(input.requirements);
    const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
    for (const card of input.cards) for (const requirement of card.requirements) if (!requirementIds.has(requirement)) fail(`${card.id} references missing requirement ${requirement}`);
  }
}
