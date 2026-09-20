import type { Static } from "typebox";
import { ReplacementCardProposalSchema, type SplitDecisionResult } from "../board/result-schemas.ts";
type ReplacementCardProposal = Static<typeof ReplacementCardProposalSchema>;
import type { BoardSnapshot, CardSnapshot, TransitionMetadata } from "../engine/transitions.ts";
import { productBranchFor } from "./effects.ts";

export interface SplitValidationInput {
  readonly card: CardSnapshot;
  readonly board: BoardSnapshot;
  readonly result: SplitDecisionResult;
  readonly activeRequirements?: readonly string[];
}

export interface SplitAllocation {
  readonly cards: readonly CardSnapshot[];
  readonly source: CardSnapshot;
  readonly replacementIds: readonly string[];
  readonly nextCard: number;
  readonly nextAcceptanceCriterion: number;
}

export interface SplitAllocationInput extends SplitValidationInput {
  readonly nextCard: number;
  readonly nextAcceptanceCriterion: number;
  readonly metadata: TransitionMetadata;
  readonly historyIds?: Readonly<Record<string, string>>;
}

function fail(message: string): never { throw new Error(`Invalid split decision: ${message}`); }
function unique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) fail(`${label} contains duplicates`); }
function cardById(board: BoardSnapshot): Map<string, CardSnapshot> { return new Map(board.cards.map(card => [card.id, card])); }

/** Validate the split result independently of child claims and without allocating IDs. */
export function validateSplitScope(input: SplitValidationInput): void {
  const { card, board, result } = input;
  if (result.card_id !== card.id) fail("split result card identity does not match");
  if (result.status === "no_split") {
    if (result.replacement_cards.length !== 0) fail("no_split must not contain replacement cards");
    return;
  }
  if (result.status === "needs_human") {
    if (result.replacement_cards.length !== 0 || result.evidence.length === 0) fail("needs_human requires evidence and no replacements");
    return;
  }
  const proposals = result.replacement_cards;
  if (proposals.length < 2 || proposals.length > 32) fail("split_required needs 2..32 replacement cards");
  unique(proposals.map(p => p.temporary_key), "replacement keys");
  const existing = cardById(board);
  const siblingKeys = new Set(proposals.map(p => p.temporary_key));
  const sourceRequirements = [...(card.requirements ?? [])];
  const activeRequirements = new Set(input.activeRequirements ?? sourceRequirements);
  for (const proposal of proposals) {
    if (proposal.requirements.some(req => !activeRequirements.has(req))) fail(`replacement ${proposal.temporary_key} references inactive requirement`);
    if (proposal.acceptance_criteria.length === 0) fail(`replacement ${proposal.temporary_key} is empty`);
    for (const dependency of proposal.dependencies) {
      if (!existing.has(dependency) && !siblingKeys.has(dependency)) fail(`replacement ${proposal.temporary_key} has unknown dependency ${dependency}`);
      if (dependency === card.id) fail("replacement may not depend on its superseded source");
    }
    if (proposal.dependencies.includes(proposal.temporary_key)) fail("replacement may not depend on itself");
  }
  // Every original criterion must be represented exactly once by text and requirement.
  const original = (card.acceptance_criteria ?? []) as readonly { id?: string; text?: string; requirement?: string }[];
  const replacementCriteria = proposals.flatMap(p => p.acceptance_criteria);
  for (const criterion of original) {
    const matches = replacementCriteria.filter(candidate => candidate.text === criterion.text && candidate.requirement === criterion.requirement);
    if (matches.length !== 1) fail(`acceptance criterion ${criterion.id ?? criterion.text ?? "unknown"} is not covered exactly once`);
  }
  for (const requirement of sourceRequirements) if (!proposals.some(p => p.requirements.includes(requirement))) fail(`requirement ${requirement} is not covered`);
  const dependents = board.cards.filter(candidate => candidate.dependencies.includes(card.id) && candidate.id !== card.id);
  for (const dependent of dependents) if (!result.evidence.some(e => e.reference.includes(dependent.id) || e.summary.includes(dependent.id))) fail(`dependent ${dependent.id} is not covered by split evidence`);
  validateDependencyGraph(board.cards, card.id, proposals);
}

function validateDependencyGraph(cards: readonly CardSnapshot[], sourceId: string, proposals: readonly ReplacementCardProposal[]): void {
  const keys = new Set(proposals.map(p => p.temporary_key));
  const nodes = new Map<string, readonly string[]>(cards.map(c => [c.id, c.dependencies.filter(d => d !== sourceId)]));
  for (const proposal of proposals) nodes.set(proposal.temporary_key, proposal.dependencies.filter(d => d !== sourceId));
  for (const card of cards) if (card.dependencies.includes(sourceId)) nodes.set(card.id, [...card.dependencies.filter(d => d !== sourceId), ...proposals.map(p => p.temporary_key)]);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) fail("split dependency graph contains a cycle"); if (visited.has(id)) return; visiting.add(id); for (const dep of nodes.get(id) ?? []) { if (!nodes.has(dep) && !keys.has(dep)) fail(`dependency ${dep} does not resolve`); visit(dep); } visiting.delete(id); visited.add(id); };
  for (const id of nodes.keys()) visit(id);
}

/** Allocate parent-owned card and acceptance IDs and render an atomic replacement candidate. */
export function allocateSplit(input: SplitAllocationInput): SplitAllocation {
  validateSplitScope(input);
  if (input.result.status !== "split_required") fail("only split_required decisions allocate replacements");
  const { card, board, result, metadata } = input;
  const proposals = result.replacement_cards;
  let nextCard = input.nextCard, nextAc = input.nextAcceptanceCriterion;
  const allocatedKeys = new Map<string, string>();
  for (const proposal of proposals) { if (nextCard > 9999) fail("card ID namespace exhausted"); allocatedKeys.set(proposal.temporary_key, `CARD-${String(nextCard++).padStart(4, "0")}`); }
  const allocatedNextCard = nextCard;
  nextCard = input.nextCard;
  const replacements: CardSnapshot[] = proposals.map(proposal => {
    const id = allocatedKeys.get(proposal.temporary_key)!;
    const acceptance_criteria = proposal.acceptance_criteria.map(criterion => {
      if (nextAc > 9999) fail("acceptance criterion namespace exhausted");
      return { id: `AC-${String(nextAc++).padStart(4, "0")}`, text: criterion.text, requirement: criterion.requirement };
    });
    const dependencies = [...new Set([...card.dependencies.filter(dep => dep !== card.id), ...proposal.dependencies.filter(dep => dep !== card.id).map(dep => allocatedKeys.get(dep) ?? dep)])].sort();
    return { ...structuredClone(card), id, title: proposal.title, status: "backlog", requirements: [...proposal.requirements].sort(), grandfathered_requirements: [], acceptance_criteria, dependencies, replaces: [card.id], replaced_by: [], replacement_reason: null, created_at: metadata.at, updated_at: metadata.at, started_at: null, delivered_at: null, blocked: null, workflow: { ...structuredClone(card.workflow), design: { ...structuredClone(card.workflow.design), branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null }, split_decision: { result_path: null, decided_at: null, override: null }, implementation: { ...structuredClone(card.workflow.implementation), branch: null, result_paths: [], head_commit: null }, review: { ...structuredClone(card.workflow.review), result_paths: [], reviewed_commit: null, completed_at: null }, ship: { ...structuredClone(card.workflow.ship), product_pr: null, verification_result_paths: [], merged_commit: null } }, rework: { design: 0, implementation: 0 }, history: [] } as CardSnapshot;
  });
  const replacementIds = replacements.map(c => c.id).sort();
  const rewritten: CardSnapshot[] = board.cards.map(candidate => candidate.id === card.id ? ({ ...candidate, status: "replaced" as const, replaced_by: replacementIds, replacement_reason: "split_decision", blocked: null, updated_at: metadata.at, history: [...candidate.history, { id: metadata.historyId, at: metadata.at, kind: "card_replaced", from_status: candidate.status, to_status: "replaced", operation_id: metadata.operationId, transaction_id: metadata.transactionId, summary: metadata.summary ?? "Card replaced by split decision" }] } as CardSnapshot) : candidate);
  const withRewire: CardSnapshot[] = rewritten.map(candidate => {
    if (!candidate.dependencies.includes(card.id)) return candidate;
    const nextDependencies = [...new Set([...candidate.dependencies.filter(dep => dep !== card.id), ...replacementIds])].sort();
    const historyId = input.historyIds?.[candidate.id];
    if (!historyId) return { ...candidate, dependencies: nextDependencies, updated_at: metadata.at } as CardSnapshot;
    return { ...candidate, dependencies: nextDependencies, updated_at: metadata.at, history: [...candidate.history, { id: historyId, at: metadata.at, kind: "requirements_scope_updated", from_status: candidate.status, to_status: candidate.status, operation_id: metadata.operationId, transaction_id: metadata.transactionId, summary: `Dependency rewired after split of ${card.id}` }] } as CardSnapshot;
  });
  return { cards: [...withRewire, ...replacements], source: withRewire.find(c => c.id === card.id)!, replacementIds, nextCard: allocatedNextCard, nextAcceptanceCriterion: nextAc };
}

export const validateSplitDecision = validateSplitScope;
export const planSplitReplacement = allocateSplit;
export function productBranchAfterNoSplit(card: CardSnapshot): string { return productBranchFor(card); }
