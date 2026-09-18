import type { Card } from "../board/schemas.ts";
import type { BoardSnapshot, CardRecord } from "../board/repository.ts";
import { parseRequirements } from "../board/requirements.ts";
import { validateBoardSemantics } from "../board/semantic-validation.ts";
import type { ProposalAllocation } from "./allocate.ts";
import type { NormalizedCardChange, NormalizedRequirementsProposal, RequirementReference, CardReference } from "./proposal.ts";
import { materializeBacklogCards, materializeRequirements, type RequirementsRenderContext, type RenderedCardCandidate, renderCardDocument } from "./render.ts";

const PRE_DESIGN = new Set(["backlog", "designing", "design_review"]);
const GRANDFATHERED = new Set(["ready_for_implementation", "implementing", "implementation_review", "ready_to_ship", "shipping"]);

export interface DesignClosureAction {
  readonly cardId: string;
  readonly number: number;
  readonly url: string;
  readonly head: string;
  readonly headCommit: string;
}
export interface RequirementsImpactPlan {
  readonly cards: readonly CardRecord[];
  readonly renderedCards: readonly RenderedCardCandidate[];
  readonly affectedCardIds: readonly string[];
  readonly grandfatheredCardIds: readonly string[];
  readonly designClosures: readonly DesignClosureAction[];
}
export class RequirementsImpactError extends Error {
  constructor(message: string) { super(`Invalid requirements impact: ${message}`); this.name = "RequirementsImpactError"; }
}
function fail(message: string): never { throw new RequirementsImpactError(message); }
function cloneCard(card: CardRecord): CardRecord { return structuredClone(card); }
function requirementId(reference: RequirementReference, allocation: ProposalAllocation): string { return reference.kind === "existing" ? reference.id : allocation.requirementIds[reference.key]!; }
function cardId(reference: CardReference, allocation: ProposalAllocation): string { return reference.kind === "existing" ? reference.id : allocation.cardIds[reference.key]!; }
function node(change: NormalizedCardChange): string { return change.action === "create" ? change.temporaryKey! : change.action === "replace" ? `replace:${change.targetCard}` : change.targetCard!; }
function history(card: CardRecord, kind: "requirements_scope_updated" | "requirements_grandfathered" | "card_replaced", summary: string, context: RequirementsRenderContext, fromStatus = card.status, toStatus = card.status): void {
  const id = context.historyIds[card.id]; if (!id) fail(`missing history ID for ${card.id}`);
  (card.history as any[]).push({ id, at: context.at, kind, from_status: fromStatus, to_status: toStatus, operation_id: context.operationId, transaction_id: context.transactionId, summary });
}
function applyScope(card: CardRecord, change: NormalizedCardChange, allocation: ProposalAllocation): void {
  card.title = change.title;
  card.requirements = change.requirements.map((reference) => requirementId(reference, allocation)).sort();
  card.grandfathered_requirements = [];
  card.acceptance_criteria = change.acceptanceCriteria.map((criterion, index) => ({ id: allocation.acceptanceIds[node(change)][index]!, text: criterion.text, requirement: requirementId(criterion.requirement, allocation) })).sort((left, right) => left.id.localeCompare(right.id));
  card.dependencies = change.dependencies.map((reference) => cardId(reference, allocation)).sort();
  card.priority = change.priority;
  card.why = change.why;
  card.notes = change.notes;
}
function rendered(card: CardRecord): RenderedCardCandidate {
  const why = card.why ?? ""; const notes = card.notes ?? "";
  const { why: _why, notes: _notes, ...frontmatter } = card;
  return Object.freeze({ card: frontmatter as unknown as Card, why, notes, bytes: renderCardDocument(frontmatter as unknown as Card, why, notes) });
}

/** Derive all status-specific card effects from one immutable authoritative snapshot. */
export function planRequirementsImpact(snapshot: BoardSnapshot, proposal: NormalizedRequirementsProposal, allocation: ProposalAllocation, context: RequirementsRenderContext): RequirementsImpactPlan {
  const original = JSON.stringify(snapshot.cards);
  const cards = new Map(snapshot.cards.map((card) => [card.id, cloneCard(card)]));
  const changesByTarget = new Map(proposal.cardChanges.filter(({ targetCard }) => targetCard).map((change) => [change.targetCard!, change]));
  const deactivated = new Set<string>();
  const retired = new Set<string>();
  const replacementByOld = new Map<string, string>();
  for (const change of proposal.requirementChanges) {
    if (change.action === "supersede") for (const id of change.supersedes) { deactivated.add(id); replacementByOld.set(id, allocation.requirementIds[change.temporaryKey!]!); }
    if (change.action === "retire") { deactivated.add(change.targetRequirement!); retired.add(change.targetRequirement!); }
  }

  for (const source of snapshot.cards) {
    if (!source.requirements.some((id) => deactivated.has(id))) continue;
    if (PRE_DESIGN.has(source.status) && !changesByTarget.has(source.id)) fail(`${source.id} requires an explicit pre-design update or replacement`);
    if (GRANDFATHERED.has(source.status) && source.requirements.some((id) => retired.has(id))) fail(`${source.id} references a retired requirement that cannot be grandfathered`);
  }

  const backlogRendered = materializeBacklogCards(snapshot, proposal, allocation, context);
  for (const candidate of backlogRendered) cards.set(candidate.card.id, { ...candidate.card, why: candidate.why, notes: candidate.notes } as CardRecord);

  const closures: DesignClosureAction[] = [];
  const affected = new Set(backlogRendered.map(({ card }) => card.id));
  for (const change of proposal.cardChanges) {
    if (change.action === "create") continue;
    const target = cards.get(change.targetCard!); if (!target) fail(`missing target card ${change.targetCard}`);
    const authoritative = snapshot.cards.find(({ id }) => id === change.targetCard)!;
    if (change.action === "replace") {
      const replacementId = allocation.cardIds[node(change)]!;
      target.status = "replaced"; target.replacement_reason = "requirements_change"; target.replaced_by = [replacementId]; target.updated_at = context.at; target.blocked = null;
      history(target, "card_replaced", `Replaced by ${replacementId} after requirements change`, context, "backlog", "replaced");
      affected.add(target.id);
      continue;
    }
    if (authoritative.status === "backlog") continue;
    applyScope(target, change, allocation);
    const from = target.status;
    if (authoritative.status === "design_review") {
      const pr = (authoritative.workflow as any).design.pr;
      if (!pr || pr.state !== "open") fail(`${target.id} design_review card has no open design PR`);
      closures.push({ cardId: target.id, number: pr.number, url: pr.url, head: pr.head, headCommit: pr.head_commit });
      (target.workflow as any).design.pr = { ...pr, state: "closed", merge_commit: null, last_checked_at: context.at };
      target.status = "designing";
    }
    target.updated_at = context.at;
    history(target, "requirements_scope_updated", "Requirements scope updated before design approval", context, from, target.status);
    affected.add(target.id);
  }

  // Complete reciprocal replacement lineage and rewire all dependants atomically.
  const cardReplacements = new Map<string, string>();
  for (const change of proposal.cardChanges.filter(({ action }) => action === "replace")) cardReplacements.set(change.targetCard!, allocation.cardIds[node(change)]!);
  for (const card of cards.values()) {
    const rewritten = card.dependencies.map((dependency) => cardReplacements.get(dependency) ?? dependency).sort();
    if (rewritten.some((value, index) => value !== card.dependencies[index])) {
      const alreadyAffected = affected.has(card.id);
      card.dependencies = [...new Set(rewritten)]; card.updated_at = context.at; affected.add(card.id);
      if (!alreadyAffected) {
        if (!context.historyIds[card.id]) fail(`missing history ID for rewired dependant ${card.id}`);
        history(card, "requirements_scope_updated", "Dependencies rewired after requirements replacement", context);
      }
    }
  }

  const grandfathered = new Set<string>();
  for (const card of cards.values()) {
    if (!GRANDFATHERED.has(card.status)) continue;
    const ids = card.requirements.filter((id) => deactivated.has(id));
    if (ids.length === 0) continue;
    card.grandfathered_requirements = [...new Set([...card.grandfathered_requirements, ...ids])].sort();
    card.updated_at = context.at;
    history(card, "requirements_grandfathered", `Grandfathered requirements ${ids.sort().join(", ")}`, context);
    grandfathered.add(card.id); affected.add(card.id);
  }

  const requirements = materializeRequirements(snapshot, proposal, allocation);
  const active = new Set(requirements.filter(({ status }) => status === "active").map(({ id }) => id));
  for (const card of cards.values()) {
    if (["done", "replaced"].includes(card.status)) continue;
    for (const id of card.requirements) if (!active.has(id) && !card.grandfathered_requirements.includes(id)) fail(`${card.id} retains non-active requirement ${id}`);
  }
  const newActive = proposal.requirementChanges.filter(({ temporaryKey }) => temporaryKey).map(({ temporaryKey }) => allocation.requirementIds[temporaryKey!]!);
  for (const id of newActive) {
    const coverage = [...cards.values()].filter((card) => card.status === "backlog" && card.requirements.includes(id));
    if (coverage.length === 0) fail(`active requirement ${id} lacks backlog coverage`);
    const old = [...replacementByOld.entries()].filter(([, replacement]) => replacement === id).map(([prior]) => prior);
    const requiredGrandfathers = [...cards.values()].filter((card) => old.some((prior) => card.grandfathered_requirements.includes(prior))).map(({ id: card }) => card);
    for (const coverageCard of coverage) for (const required of requiredGrandfathers) if (!coverageCard.dependencies.includes(required)) fail(`${coverageCard.id} must depend on grandfathered ${required}`);
  }

  const ordered = [...cards.values()].sort((left, right) => left.id.localeCompare(right.id));
  validateBoardSemantics({ board: { ...snapshot.board, ids: { next_requirement: allocation.next.requirement, next_card: allocation.next.card, next_acceptance_criterion: allocation.next.acceptanceCriterion, next_finding: allocation.next.finding } }, config: snapshot.config, cards: ordered, requirements, findingIds: snapshot.findingIds });
  if (JSON.stringify(snapshot.cards) !== original) throw new Error("Requirements impact mutated the authoritative snapshot");
  const renderedCards = ordered.filter((card) => affected.has(card.id)).map(rendered);
  return Object.freeze({
    cards: Object.freeze(ordered.map((card) => Object.freeze(card))),
    renderedCards: Object.freeze(renderedCards),
    affectedCardIds: Object.freeze([...affected].sort()),
    grandfatheredCardIds: Object.freeze([...grandfathered].sort()),
    designClosures: Object.freeze(closures.sort((left, right) => left.cardId.localeCompare(right.cardId)).map((closure) => Object.freeze(closure))),
  });
}
