import { stringify } from "yaml";
import { Value } from "typebox/value";
import type { Card, Board, Config } from "../board/schemas.ts";
import { BoardSchema, CardSchema } from "../board/schemas.ts";
import type { Requirement } from "../board/requirements.ts";
import { parseRequirements, validateRequirementLineage } from "../board/requirements.ts";
import type { BoardSnapshot, CardRecord } from "../board/repository.ts";
import { validateBoardSemantics } from "../board/semantic-validation.ts";
import { renderBoard } from "../engine/render.ts";
import type { ProposalAllocation } from "./allocate.ts";
import type { NormalizedCardChange, NormalizedRequirementsProposal, RequirementReference, CardReference } from "./proposal.ts";

export interface RequirementsRenderContext {
  readonly at: string;
  readonly operationId: string;
  readonly transactionId: string;
  readonly historyIds: Readonly<Record<string, string>>;
}
export interface RenderedCardCandidate { readonly card: Card; readonly why: string; readonly notes: string; readonly bytes: string }

function requirementId(reference: RequirementReference, allocation: ProposalAllocation): string {
  if (reference.kind === "existing") return reference.id;
  const id = allocation.requirementIds[reference.key];
  if (!id) throw new Error(`Missing allocation for requirement ${reference.key}`);
  return id;
}
function cardId(reference: CardReference, allocation: ProposalAllocation): string {
  if (reference.kind === "existing") return reference.id;
  const id = allocation.cardIds[reference.key];
  if (!id) throw new Error(`Missing allocation for card ${reference.key}`);
  return id;
}
function cardNode(change: NormalizedCardChange): string {
  return change.action === "create" ? change.temporaryKey! : change.action === "replace" ? `replace:${change.targetCard}` : change.targetCard!;
}
function bullets(acceptance: readonly string[]): string { return acceptance.map((text) => `- ${text}`).join("\n"); }

export function materializeRequirements(snapshot: BoardSnapshot, proposal: NormalizedRequirementsProposal, allocation: ProposalAllocation): readonly Requirement[] {
  const byId = new Map((snapshot.requirements ? parseRequirements(snapshot.requirements) : []).map((requirement) => [requirement.id, { ...requirement, supersedes: [...requirement.supersedes] }]));
  for (const change of proposal.requirementChanges) {
    if (change.action === "amend_same_meaning") {
      const current = byId.get(change.targetRequirement!); if (!current) throw new Error(`Missing requirement ${change.targetRequirement}`);
      byId.set(current.id, { ...current, title: change.title, text: change.body, acceptance: bullets(change.acceptance) });
    } else if (change.action === "retire") {
      const current = byId.get(change.targetRequirement!); if (!current) throw new Error(`Missing requirement ${change.targetRequirement}`);
      byId.set(current.id, { ...current, status: "retired", supersedes: [] });
    } else {
      const id = allocation.requirementIds[change.temporaryKey!]; if (!id) throw new Error(`Missing requirement allocation ${change.temporaryKey}`);
      if (change.action === "supersede") for (const target of change.supersedes) {
        const current = byId.get(target); if (!current) throw new Error(`Missing superseded requirement ${target}`);
        byId.set(target, { ...current, status: "superseded" });
      }
      byId.set(id, { id, title: change.title, status: "active", supersedes: [...change.supersedes], text: change.body, acceptance: bullets(change.acceptance) });
    }
  }
  const requirements = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)) as Requirement[];
  validateRequirementLineage(requirements);
  return Object.freeze(requirements.map((requirement) => Object.freeze({ ...requirement, supersedes: Object.freeze([...requirement.supersedes]) })));
}

export function renderRequirements(requirements: readonly Requirement[]): string {
  if (requirements.length === 0) throw new Error("Requirements document must contain at least one requirement");
  const sections = requirements.map((requirement) => [
    `## ${requirement.id} — ${requirement.title}`,
    "",
    `Status: ${requirement.status}`,
    `Supersedes: ${requirement.supersedes.length === 0 ? "none" : requirement.supersedes.join(", ")}`,
    "",
    requirement.text,
    "",
    "### Acceptance",
    "",
    requirement.acceptance,
  ].join("\n"));
  return `# Product specification\n\n${sections.join("\n\n")}\n`;
}

function emptyWorkflow(): Card["workflow"] {
  return {
    design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null },
    split_decision: { result_path: null, decided_at: null, override: null },
    implementation: { branch: null, result_paths: [], head_commit: null },
    review: { result_paths: [], reviewed_commit: null, completed_at: null },
    ship: { product_pr: null, verification_result_paths: [], merged_commit: null },
  };
}

export function renderCardDocument(card: Card, why: string, notes: string): string {
  const identifier = card.id;
  if (!Value.Check(CardSchema, card as unknown)) throw new Error(`Cannot render invalid card ${identifier}`);
  const yaml = stringify(card, { lineWidth: 0 }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n");
  return `---\n${yaml}---\n# ${card.id}: ${card.title}\n\n## Why\n\n${why}\n\n## Notes\n\n${notes}\n`.replace(/\n{3,}$/u, "\n\n");
}

/** Materialize create and backlog-update proposals; later-status effects are owned by impact.ts. */
export function materializeBacklogCards(snapshot: BoardSnapshot, proposal: NormalizedRequirementsProposal, allocation: ProposalAllocation, context: RequirementsRenderContext): readonly RenderedCardCandidate[] {
  const byId = new Map(snapshot.cards.map((card) => [card.id, card]));
  const results: RenderedCardCandidate[] = [];
  for (const change of proposal.cardChanges) {
    const node = cardNode(change);
    const id = change.action === "update" ? change.targetCard! : allocation.cardIds[node];
    if (!id) throw new Error(`Missing card allocation for ${node}`);
    const current = change.action === "update" ? byId.get(id) : undefined;
    if (current && current.status !== "backlog") continue;
    const requirements = change.requirements.map((reference) => requirementId(reference, allocation)).sort();
    const criteria = change.acceptanceCriteria.map((criterion, index) => ({ id: allocation.acceptanceIds[node][index]!, text: criterion.text, requirement: requirementId(criterion.requirement, allocation) })).sort((left, right) => left.id.localeCompare(right.id));
    const dependencies = change.dependencies.map((reference) => cardId(reference, allocation)).sort();
    const historyId = context.historyIds[node]; if (!historyId) throw new Error(`Missing history ID for ${node}`);
    const baseHistory = current ? [...current.history as Card["history"]] : [];
    const card: Card = {
      id, title: change.title, status: "backlog", requirements, grandfathered_requirements: [], acceptance_criteria: criteria, dependencies,
      replaces: change.action === "replace" ? [change.targetCard!] : [], replaced_by: [], replacement_reason: null, priority: change.priority,
      created_at: current?.created_at ?? context.at, updated_at: context.at, started_at: null, delivered_at: null, blocked: null,
      workflow: emptyWorkflow(), rework: { design: 0, implementation: 0 }, history: [...baseHistory, {
        id: historyId, at: context.at, kind: current ? "requirements_scope_updated" : "card_created", from_status: current ? "backlog" : null,
        to_status: "backlog", operation_id: context.operationId, transaction_id: context.transactionId,
        summary: current ? "Requirements scope updated" : "Card created by requirements workflow",
      }],
    };
    results.push(Object.freeze({ card: Object.freeze(card), why: change.why, notes: change.notes, bytes: renderCardDocument(card, change.why, change.notes) }));
  }
  return Object.freeze(results);
}

export function validateRequirementsCandidate(input: { board: Board; config: Config; cards: readonly CardRecord[]; requirements: string; findingIds?: readonly string[] }): void {
  if (!Value.Check(BoardSchema, input.board)) throw new Error("Candidate board does not match its strict schema");
  for (const card of input.cards) {
    const { why: _why, notes: _notes, ...frontmatter } = card;
    if (!Value.Check(CardSchema, frontmatter)) throw new Error(`Candidate card ${card.id} does not match its strict schema`);
  }
  const requirements = parseRequirements(input.requirements);
  validateBoardSemantics({ board: input.board, config: input.config, cards: input.cards, requirements, findingIds: input.findingIds });
  const dashboard = renderBoard(input.cards);
  if (!dashboard.endsWith("\n")) throw new Error("Candidate dashboard is not canonical");
}
