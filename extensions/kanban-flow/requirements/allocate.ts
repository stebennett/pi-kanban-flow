import { numericId } from "../engine/ids.ts";
import { parseRequirements } from "../board/requirements.ts";
import type { BoardSnapshot } from "../board/repository.ts";
import type { NormalizedRequirementsProposal, NormalizedCardChange } from "./proposal.ts";

export interface ProposalAllocation {
  readonly requirementIds: Readonly<Record<string, string>>;
  readonly cardIds: Readonly<Record<string, string>>;
  readonly acceptanceIds: Readonly<Record<string, readonly string[]>>;
  readonly producerFindingIds: readonly string[];
  readonly checkerFindingIds: readonly string[];
  readonly next: Readonly<{ requirement: number; card: number; acceptanceCriterion: number; finding: number }>;
}

export class RequirementsAllocationError extends Error {
  constructor(message: string) { super(`Cannot allocate requirements IDs: ${message}`); this.name = "RequirementsAllocationError"; }
}

function suffix(id: string): number { return Number(id.slice(id.lastIndexOf("-") + 1)); }
function assertCounter(name: string, counter: number, used: readonly string[]): void {
  const maximum = used.reduce((value, id) => Math.max(value, suffix(id)), 0);
  if (!Number.isInteger(counter) || counter < 1 || counter > 9999 || counter <= maximum) throw new RequirementsAllocationError(`${name} counter would reuse an authoritative ID`);
}
function take(prefix: "REQ" | "CARD" | "AC" | "FINDING", start: number, count: number): { ids: string[]; next: number } {
  if (!Number.isInteger(count) || count < 0) throw new RequirementsAllocationError(`${prefix} allocation count is invalid`);
  if (start + count > 9999) throw new RequirementsAllocationError(`${prefix} namespace is exhausted in schema version 1`);
  return { ids: Array.from({ length: count }, (_, index) => numericId(prefix, start + index)), next: start + count };
}
function cardNode(change: NormalizedCardChange): string {
  if (change.action === "create") return change.temporaryKey!;
  if (change.action === "replace") return `replace:${change.targetCard}`;
  return change.targetCard!;
}

/** Pure preview/final allocation. Re-running against the same snapshot and proposal returns identical mappings. */
export function allocateRequirementsProposal(
  snapshot: BoardSnapshot,
  proposal: NormalizedRequirementsProposal,
  findings: Readonly<{ producer: number; checker: number }> = { producer: 0, checker: 0 },
): ProposalAllocation {
  const requirements = snapshot.requirements ? parseRequirements(snapshot.requirements) : [];
  const requirementUsed = requirements.map(({ id }) => id);
  const cardUsed = snapshot.cards.map(({ id }) => id);
  const acceptanceUsed = snapshot.cards.flatMap((card) => card.acceptance_criteria.map((criterion: any) => String(criterion.id)));
  const findingUsed = [...(snapshot.findingIds ?? [])];
  const counters = snapshot.board.ids;
  assertCounter("requirement", counters.next_requirement, requirementUsed);
  assertCounter("card", counters.next_card, cardUsed);
  assertCounter("acceptance", counters.next_acceptance_criterion, acceptanceUsed);
  assertCounter("finding", counters.next_finding, findingUsed);

  const newRequirements = proposal.requirementChanges.filter(({ temporaryKey }) => temporaryKey !== null);
  const requirementRange = take("REQ", counters.next_requirement, newRequirements.length);
  const requirementIds = Object.fromEntries(newRequirements.map((change, index) => [change.temporaryKey!, requirementRange.ids[index]]));

  const newCards = proposal.cardChanges.filter(({ action }) => action !== "update");
  const cardRange = take("CARD", counters.next_card, newCards.length);
  const cardIds = Object.fromEntries(newCards.map((change, index) => [cardNode(change), cardRange.ids[index]]));

  let nextAcceptance = counters.next_acceptance_criterion;
  const acceptanceIds: Record<string, readonly string[]> = {};
  const byCard = new Map(snapshot.cards.map((card) => [card.id, card]));
  for (const change of proposal.cardChanges) {
    const key = cardNode(change);
    const current = change.action === "update" ? byCard.get(change.targetCard!) : undefined;
    const available = new Map<string, string>();
    if (current) for (const criterion of current.acceptance_criteria as Array<{ id: string; text: string; requirement: string }>) {
      const pair = `${criterion.requirement}\0${criterion.text}`;
      if (available.has(pair)) throw new RequirementsAllocationError(`${current.id} has ambiguous acceptance criteria`);
      available.set(pair, criterion.id);
    }
    const resolvedPairs = change.acceptanceCriteria.map((criterion) => {
      const requirement = criterion.requirement.kind === "existing" ? criterion.requirement.id : requirementIds[criterion.requirement.key];
      if (!requirement) throw new RequirementsAllocationError(`temporary requirement ${criterion.requirement.kind === "temporary" ? criterion.requirement.key : requirement} has no allocation`);
      return `${requirement}\0${criterion.text}`;
    });
    const missing = resolvedPairs.filter((pair) => !available.has(pair)).length;
    const range = take("AC", nextAcceptance, missing);
    let allocatedIndex = 0;
    acceptanceIds[key] = resolvedPairs.map((pair) => available.get(pair) ?? range.ids[allocatedIndex++]!);
    nextAcceptance = range.next;
  }

  const findingRange = take("FINDING", counters.next_finding, findings.producer + findings.checker);
  return Object.freeze({
    requirementIds: Object.freeze(requirementIds),
    cardIds: Object.freeze(cardIds),
    acceptanceIds: Object.freeze(Object.fromEntries(Object.entries(acceptanceIds).map(([key, ids]) => [key, Object.freeze([...ids])]))),
    producerFindingIds: Object.freeze(findingRange.ids.slice(0, findings.producer)),
    checkerFindingIds: Object.freeze(findingRange.ids.slice(findings.producer)),
    next: Object.freeze({ requirement: requirementRange.next, card: cardRange.next, acceptanceCriterion: nextAcceptance, finding: findingRange.next }),
  });
}
