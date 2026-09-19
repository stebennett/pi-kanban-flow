import type { ProducerResult } from "../board/result-schemas.ts";
import { validateProducerResult } from "../board/result-schemas.ts";
import type { BoardSnapshot, CardRecord } from "../board/repository.ts";
import { parseRequirements, type Requirement } from "../board/requirements.ts";

export type RequirementReference =
  | Readonly<{ kind: "existing"; id: string }>
  | Readonly<{ kind: "temporary"; key: string }>;
export type CardReference =
  | Readonly<{ kind: "existing"; id: string }>
  | Readonly<{ kind: "temporary"; key: string }>;

export interface NormalizedRequirementChange {
  readonly temporaryKey: string | null;
  readonly action: "create" | "amend_same_meaning" | "supersede" | "retire";
  readonly targetRequirement: string | null;
  readonly title: string;
  readonly body: string;
  readonly acceptance: readonly string[];
  readonly supersedes: readonly string[];
}

export interface NormalizedAcceptanceProposal {
  readonly text: string;
  readonly requirement: RequirementReference;
}

export interface NormalizedCardChange {
  readonly temporaryKey: string | null;
  readonly action: "create" | "update" | "replace";
  readonly targetCard: string | null;
  readonly title: string;
  readonly why: string;
  readonly notes: string;
  readonly requirements: readonly RequirementReference[];
  readonly acceptanceCriteria: readonly NormalizedAcceptanceProposal[];
  readonly dependencies: readonly CardReference[];
  readonly priority: number;
}

export interface NormalizedRequirementsProposal {
  readonly requirementChanges: readonly NormalizedRequirementChange[];
  readonly cardChanges: readonly NormalizedCardChange[];
  readonly requirementTemporaryKeys: readonly string[];
  readonly cardTemporaryKeys: readonly string[];
  readonly semanticChange: true;
}

export class RequirementsProposalError extends Error {
  constructor(message: string) {
    super(`Invalid requirements proposal: ${message}`);
    this.name = "RequirementsProposalError";
  }
}

function fail(message: string): never { throw new RequirementsProposalError(message); }
function markdown(value: string): string { return value.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ""); }
function line(value: string): string { return value.trim(); }
function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
function acceptanceLines(requirement: Requirement): string[] {
  return requirement.acceptance.split("\n").filter((entry) => entry.startsWith("- ")).map((entry) => entry.slice(2).trim());
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function refKey(reference: RequirementReference | CardReference): string {
  return reference.kind === "existing" ? reference.id : `temporary:${reference.key}`;
}

const requirementActionOrder = new Map([["amend_same_meaning", 0], ["retire", 1], ["supersede", 2], ["create", 3]]);
const cardActionOrder = new Map([["update", 0], ["replace", 1], ["create", 2]]);

function normalizeRequirements(result: ProducerResult, existing: ReadonlyMap<string, Requirement>): NormalizedRequirementChange[] {
  const temporaryKeys = result.requirement_changes.map(({ temporary_key }) => temporary_key).filter((key) => key !== "none");
  unique(temporaryKeys, "requirement temporary keys");
  const occupied = new Map<string, string>();
  const normalized = result.requirement_changes.map((change): NormalizedRequirementChange => {
    const target = change.target_requirement === "none" ? null : change.target_requirement;
    const key = change.temporary_key === "none" ? null : change.temporary_key;
    const supersedes = [...change.supersedes].sort();
    unique(supersedes, `supersedes for ${key ?? target}`);
    if (change.action === "create" && (!key || target || supersedes.length > 0)) fail("create requirement identity is inconsistent");
    if (change.action === "supersede" && (!key || target || supersedes.length === 0)) fail("supersede requirement identity is inconsistent");
    if ((change.action === "amend_same_meaning" || change.action === "retire") && (key || !target || supersedes.length > 0)) fail(`${change.action} requirement identity is inconsistent`);
    if (target && !existing.has(target)) fail(`unknown requirement target ${target}`);
    for (const id of supersedes) {
      const prior = existing.get(id);
      if (!prior) fail(`unknown superseded requirement ${id}`);
      if (prior.status === "retired") fail(`cannot supersede retired requirement ${id}`);
    }
    for (const id of [...(target ? [target] : []), ...supersedes]) {
      const previous = occupied.get(id);
      if (previous) fail(`requirement ${id} participates in conflicting actions ${previous} and ${change.action}`);
      occupied.set(id, change.action);
    }
    const current = target ? existing.get(target)! : undefined;
    if (current && current.status !== "active") fail(`${change.action} target ${target} is not active`);
    const value: NormalizedRequirementChange = {
      temporaryKey: key,
      action: change.action,
      targetRequirement: target,
      title: line(change.title),
      body: markdown(change.body),
      acceptance: change.acceptance.map(line),
      supersedes,
    };
    unique(value.acceptance, `acceptance for ${key ?? target}`);
    if (change.action === "retire" && current && (value.title !== current.title || value.body !== current.text || !sameStrings(value.acceptance, acceptanceLines(current)))) {
      fail(`retire must retain the current content of ${target}`);
    }
    if (change.action === "amend_same_meaning" && current && value.title === current.title && value.body === current.text && sameStrings(value.acceptance, acceptanceLines(current))) {
      fail(`same-meaning amendment of ${target} is a no-op`);
    }
    return value;
  });
  return normalized.sort((left, right) => {
    const action = requirementActionOrder.get(left.action)! - requirementActionOrder.get(right.action)!;
    if (action !== 0) return action;
    return (left.targetRequirement ?? left.supersedes[0] ?? left.temporaryKey ?? "").localeCompare(right.targetRequirement ?? right.supersedes[0] ?? right.temporaryKey ?? "");
  });
}

function activeRequirementReferences(changes: readonly NormalizedRequirementChange[], existing: ReadonlyMap<string, Requirement>): { active: Set<string>; temporary: Set<string> } {
  const active = new Set([...existing.values()].filter(({ status }) => status === "active").map(({ id }) => id));
  const temporary = new Set<string>();
  for (const change of changes) {
    if (change.action === "amend_same_meaning") continue;
    if (change.action === "retire") active.delete(change.targetRequirement!);
    if (change.action === "supersede") for (const id of change.supersedes) active.delete(id);
    if (change.temporaryKey) temporary.add(change.temporaryKey);
  }
  return { active, temporary };
}

function normalizeRequirementReference(value: string, references: { active: Set<string>; temporary: Set<string> }): RequirementReference {
  if (value.startsWith("REQ-")) {
    if (!references.active.has(value)) fail(`card references non-active requirement ${value}`);
    return { kind: "existing", id: value };
  }
  if (!references.temporary.has(value)) fail(`card references unknown temporary requirement ${value}`);
  return { kind: "temporary", key: value };
}

function semanticCardEqual(card: CardRecord, change: NormalizedCardChange): boolean {
  if (change.requirements.some((reference) => reference.kind !== "existing") || change.dependencies.some((reference) => reference.kind !== "existing")) return false;
  const requirements = change.requirements.map(refKey).sort();
  const dependencies = change.dependencies.map(refKey).sort();
  const criteria = change.acceptanceCriteria.map((criterion) => `${refKey(criterion.requirement)}\0${criterion.text}`);
  const currentCriteria = card.acceptance_criteria.map((criterion: any) => `${criterion.requirement}\0${criterion.text}`);
  return card.title === change.title && card.priority === change.priority && (card.why ?? "") === change.why && (card.notes ?? "") === change.notes
    && sameStrings([...card.requirements].sort(), requirements) && sameStrings([...card.dependencies].sort(), dependencies)
    && sameStrings(currentCriteria, criteria);
}

function assertAcyclic(cards: readonly CardRecord[], changes: readonly NormalizedCardChange[]): void {
  const graph = new Map<string, string[]>();
  for (const card of cards) graph.set(card.id, [...card.dependencies]);
  for (const change of changes) {
    const node = change.action === "create" ? `temporary:${change.temporaryKey}` : change.action === "replace" ? `replacement:${change.targetCard}` : change.targetCard!;
    graph.set(node, change.dependencies.map(refKey));
  }
  for (const [node, dependencies] of graph) for (const dependency of dependencies) {
    const target = dependency.startsWith("temporary:") ? dependency : dependency;
    if (!graph.has(target)) fail(`dependency ${dependency} from ${node} does not resolve`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) fail(`dependency cycle includes ${node}`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
}

function normalizeCards(result: ProducerResult, snapshot: BoardSnapshot, requirementChanges: readonly NormalizedRequirementChange[]): NormalizedCardChange[] {
  const byId = new Map(snapshot.cards.map((card) => [card.id, card]));
  const references = activeRequirementReferences(requirementChanges, new Map((snapshot.requirements ? parseRequirements(snapshot.requirements) : []).map((requirement) => [requirement.id, requirement])));
  const temporaryKeys = result.card_changes.filter(({ action }) => action === "create").map(({ temporary_key }) => temporary_key);
  unique(temporaryKeys, "card temporary keys");
  const temporary = new Set(temporaryKeys);
  const targets = new Set<string>();
  const normalized = result.card_changes.map((change): NormalizedCardChange => {
    const key = change.temporary_key === "none" ? null : change.temporary_key;
    const target = change.target_card === "none" ? null : change.target_card;
    if (change.action === "create" ? (!key || target !== null) : (key !== null || target === null)) fail(`${change.action} card identity is inconsistent`);
    if (target) {
      if (targets.has(target)) fail(`card ${target} has conflicting actions`);
      targets.add(target);
      const existing = byId.get(target);
      if (!existing) fail(`unknown card target ${target}`);
      const allowed = change.action === "replace" ? ["backlog"] : ["backlog", "designing", "design_review"];
      if (!allowed.includes(existing.status)) fail(`${change.action} target ${target} has unsupported status ${existing.status}`);
    }
    const requirements = change.requirements.map((value) => normalizeRequirementReference(value, references));
    unique(requirements.map(refKey), `requirements for ${key ?? target}`);
    const acceptanceCriteria = change.acceptance_criteria.map((criterion) => ({ text: line(criterion.text), requirement: normalizeRequirementReference(criterion.requirement, references) }));
    unique(acceptanceCriteria.map((criterion) => `${refKey(criterion.requirement)}\0${criterion.text}`), `acceptance criteria for ${key ?? target}`);
    const requirementSet = new Set(requirements.map(refKey));
    for (const criterion of acceptanceCriteria) if (!requirementSet.has(refKey(criterion.requirement))) fail(`acceptance criterion references a requirement outside card ${key ?? target}`);
    const dependencies = change.dependencies.map((value): CardReference => {
      if (value.startsWith("CARD-")) {
        if (!byId.has(value)) fail(`unknown card dependency ${value}`);
        if (target === value) fail(`card ${target} depends on itself`);
        return { kind: "existing", id: value };
      }
      if (!temporary.has(value)) fail(`unknown temporary card dependency ${value}`);
      if (key === value) fail(`temporary card ${key} depends on itself`);
      return { kind: "temporary", key: value };
    });
    unique(dependencies.map(refKey), `dependencies for ${key ?? target}`);
    const value: NormalizedCardChange = {
      temporaryKey: key,
      action: change.action,
      targetCard: target,
      title: line(change.title),
      why: markdown(change.why),
      notes: markdown(change.notes),
      requirements,
      acceptanceCriteria,
      dependencies,
      priority: change.priority,
    };
    if (change.action === "update" && semanticCardEqual(byId.get(target!)!, value)) fail(`card update ${target} is a no-op`);
    return value;
  });
  const ordered = normalized.sort((left, right) => {
    const leftExisting = left.targetCard ?? "~";
    const rightExisting = right.targetCard ?? "~";
    const target = leftExisting.localeCompare(rightExisting);
    if (target !== 0) return target;
    const action = cardActionOrder.get(left.action)! - cardActionOrder.get(right.action)!;
    return action || (left.temporaryKey ?? "").localeCompare(right.temporaryKey ?? "");
  });
  assertAcyclic(snapshot.cards, ordered);
  return ordered;
}

/** Convert one validated requirements producer payload into an immutable engine-owned proposal. */
export function normalizeRequirementsProposal(result: ProducerResult, snapshot: BoardSnapshot): NormalizedRequirementsProposal {
  validateProducerResult(result, { dispatchId: result.dispatch_id, cardId: "none", phase: "requirements" });
  if (result.status !== "completed") fail("only a completed requirements producer result can be normalized");
  const requirements = snapshot.requirements ? parseRequirements(snapshot.requirements) : [];
  const requirementChanges = normalizeRequirements(result, new Map(requirements.map((requirement) => [requirement.id, requirement])));
  const cardChanges = normalizeCards(result, snapshot, requirementChanges);
  if (requirementChanges.length === 0 && cardChanges.length === 0) fail("proposal has no semantic change");
  return deepFreeze({
    requirementChanges,
    cardChanges,
    requirementTemporaryKeys: requirementChanges.flatMap(({ temporaryKey }) => temporaryKey ? [temporaryKey] : []),
    cardTemporaryKeys: cardChanges.flatMap(({ temporaryKey }) => temporaryKey ? [temporaryKey] : []),
    semanticChange: true as const,
  });
}
