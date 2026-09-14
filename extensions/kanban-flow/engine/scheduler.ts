import { isWipStatus, type BoardSnapshot, type CardSnapshot, type DurableStatus } from "./transitions.ts";

export interface SchedulerOptions {
  readonly wipLimit: number;
  readonly reconciliationOnly?: boolean;
  readonly pendingStateTransaction?: boolean;
}

export interface ScheduledCard {
  readonly card: CardSnapshot;
  readonly reason: "wip" | "backlog";
  readonly nextAction: "design" | "design_review" | "split_decision" | "implement" | "review" | "ship" | "reconcile";
}

const NEXT_ACTION: Readonly<Partial<Record<DurableStatus, ScheduledCard["nextAction"]>>> = {
  backlog: "design",
  designing: "design",
  design_review: "design_review",
  ready_for_implementation: "split_decision",
  implementing: "implement",
  implementation_review: "review",
  ready_to_ship: "ship",
  shipping: "reconcile",
};

function sorted(cards: readonly CardSnapshot[]): CardSnapshot[] {
  return [...cards].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

export function dependenciesReady(card: CardSnapshot, cards: readonly CardSnapshot[]): boolean {
  const byId = new Map(cards.map((candidate) => [candidate.id, candidate]));
  return card.dependencies.every((dependency) => byId.get(dependency)?.status === "done");
}

export function isActionable(card: CardSnapshot, cards: readonly CardSnapshot[]): boolean {
  return card.status !== "done" && card.status !== "replaced" && card.blocked === null && dependenciesReady(card, cards) && NEXT_ACTION[card.status] !== undefined;
}

export function countWip(cards: readonly CardSnapshot[]): number {
  return cards.filter((card) => isWipStatus(card.status)).length;
}

/**
 * Select the next card without mutating the supplied snapshot.
 * Existing WIP is always preferred over starting backlog work. A pending
 * transaction or reconciliation-only pump intentionally selects nothing.
 */
export function scheduleNextCard(board: BoardSnapshot, options: SchedulerOptions): ScheduledCard | null {
  if (!Number.isInteger(options.wipLimit) || options.wipLimit < 1) throw new Error("wipLimit must be a positive integer");
  if (options.reconciliationOnly || options.pendingStateTransaction) return null;
  const actionable = sorted(board.cards.filter((card) => isActionable(card, board.cards)));
  const wip = actionable.find((card) => isWipStatus(card.status));
  if (wip) return { card: wip, reason: "wip", nextAction: NEXT_ACTION[wip.status]! };
  if (countWip(board.cards) >= options.wipLimit) return null;
  const backlog = actionable.find((card) => card.status === "backlog");
  return backlog ? { card: backlog, reason: "backlog", nextAction: NEXT_ACTION.backlog! } : null;
}

export const selectNextCard = scheduleNextCard;
