import type { GitHubPullRequest, GitHubAdapter } from "../state-pr/github.ts";
import { parsePullRequestMarker, serializeActionMarker, serializePullRequestMarker, type ActionMarker, type PullRequestMarker } from "../state-pr/markers.ts";
import { SHIP_CRITERION_KEYS, validateCriterionOrder } from "./criteria.ts";

export interface ProductDiffEntry { readonly path: string; readonly action: "create" | "modify" | "delete" }
export interface ShipBodyInput {
  readonly cardId: string;
  readonly title: string;
  readonly operationId: string;
  readonly branch: string;
  readonly reviewedCommit: string;
  readonly summary: string;
  readonly scopeAndAcceptance: string;
  readonly verification: string;
  readonly review: string;
  readonly mergeBoundary: string;
}
export interface ShipVerificationInput {
  readonly repository: string;
  readonly cardId: string;
  readonly base: string;
  readonly branch: string;
  readonly reviewedCommit: string;
  readonly pr: GitHubPullRequest;
  readonly marker: PullRequestMarker;
  readonly diff: readonly ProductDiffEntry[];
  readonly planned: readonly ProductDiffEntry[];
  readonly requiredChecks: readonly { readonly name: string; readonly conclusion: string | null; readonly status: string }[];
}
export interface ShipVerification {
  readonly criteria: readonly string[];
  readonly failures: readonly string[];
  readonly pending: boolean;
  readonly inconclusive: boolean;
  readonly passed: boolean;
}

function fail(message: string): never { throw new Error(`Invalid ship workflow: ${message}`); }
const HEADINGS = ["## Summary", "## Scope and acceptance", "## Verification", "## Review", "## Merge boundary"] as const;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function nonEmpty(value: string, label: string): void { if (!value.trim() || value.includes("\0") || value.length > 4000) fail(`${label} is empty or oversized`); }
function sameDiff(a: readonly ProductDiffEntry[], b: readonly ProductDiffEntry[]): boolean {
  const normalize = (entries: readonly ProductDiffEntry[]) => entries.map((e) => `${e.action}:${e.path}`).sort();
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Construct the only product PR body accepted by the ship workflow. */
export function productPullRequestBody(input: ShipBodyInput): string {
  if (!/^CARD-[0-9]{4}$/.test(input.cardId) || !OBJECT_ID.test(input.reviewedCommit)) fail("invalid card or reviewed commit");
  if (input.branch !== `kanban/card/${input.cardId}-${input.branch.split("-").slice(2).join("-")}` || !input.branch.startsWith(`kanban/card/${input.cardId}-`)) fail("invalid product branch");
  const marker = serializePullRequestMarker({ version: 1, kind: "product", operation_id: input.operationId, card_ids: [input.cardId], base: "main" });
  for (const [label, value] of [["summary", input.summary], ["scope", input.scopeAndAcceptance], ["verification", input.verification], ["review", input.review], ["merge boundary", input.mergeBoundary]] as const) nonEmpty(value, label);
  return `${marker}\n\n${HEADINGS.map((heading, i) => `${heading}\n\n${[input.summary, input.scopeAndAcceptance, input.verification, input.review, input.mergeBoundary][i]}`).join("\n\n")}`;
}

/** Validate body shape and marker uniqueness before any GitHub mutation. */
export function validateProductPullRequestBody(body: string, expected: { readonly cardId: string; readonly operationId: string }): void {
  const marker = parsePullRequestMarker(body);
  if (marker.kind !== "product" || marker.operation_id !== expected.operationId || marker.card_ids.length !== 1 || marker.card_ids[0] !== expected.cardId) fail("product marker identity mismatch");
  if ((body.match(/<!-- kanban-flow:/g) ?? []).length !== 1) fail("product body must contain one marker");
  if (/^#\s/m.test(body)) fail("product body cannot contain a level-one heading");
  const sections = [...body.matchAll(/^## .+$/gm)].map((match) => match[0]);
  if (JSON.stringify(sections) !== JSON.stringify(HEADINGS)) fail("product body headings are incomplete or out of order");
  for (let i = 0; i < HEADINGS.length; i += 1) {
    const start = body.indexOf(`${HEADINGS[i]}\n`, body.indexOf(HEADINGS[i - 1] ?? "") + 1);
    const end = i + 1 < HEADINGS.length ? body.indexOf(`${HEADINGS[i + 1]}\n`, start) : body.length;
    if (start < 0 || !body.slice(start + HEADINGS[i].length + 2, end).trim()) fail(`empty ${HEADINGS[i]} section`);
  }
}

/** Verify all immutable structural ship facts. Provider check conclusions are never inferred from prose. */
export function verifyShipEvidence(input: ShipVerificationInput): ShipVerification {
  const failures: string[] = [];
  if (input.repository.length === 0) failures.push("repository identity missing");
  if (input.base !== "main" || input.pr.base !== "main") failures.push("PR base is not main");
  if (input.pr.head !== input.branch || input.pr.head_commit !== input.reviewedCommit) failures.push("PR head does not equal reviewed commit");
  if (input.marker.kind !== "product" || input.marker.card_ids.length !== 1 || input.marker.card_ids[0] !== input.cardId) failures.push("product marker identity mismatch");
  if (!sameDiff(input.diff, input.planned)) failures.push("product diff differs from approved paths");
  let pending = false; let inconclusive = false;
  for (const check of input.requiredChecks) {
    if (["queued", "requested", "waiting", "in_progress"].includes(check.status)) pending = true;
    else if (["success", "neutral", "skipped"].includes(check.conclusion ?? "")) continue;
    else if (["failure"].includes(check.conclusion ?? "")) failures.push(`required check failed: ${check.name}`);
    else inconclusive = true;
  }
  return Object.freeze({ criteria: Object.freeze([...SHIP_CRITERION_KEYS]), failures: Object.freeze(failures), pending, inconclusive, passed: failures.length === 0 && !pending && !inconclusive });
}

export function validateShipCriteria(criteria: readonly string[]): readonly string[] { return validateCriterionOrder(criteria, SHIP_CRITERION_KEYS); }

export interface CorrectionBudget { readonly operationId: string; readonly criteria: readonly string[] }
export function correctionMarker(input: { readonly operationId: string; readonly cardId: string; readonly criterion: string }): string {
  return serializeActionMarker({ version: 1, kind: "deterministic-correction", operation_id: input.operationId, card_id: input.cardId, criterion: input.criterion });
}
export function canApplyCorrection(history: readonly ActionMarker[], input: { readonly operationId: string; readonly cardId: string; readonly criterion: string } | ActionMarker): boolean {
  const operationId = "operationId" in input ? input.operationId : input.operation_id;
  const cardId = "cardId" in input ? input.cardId : input.card_id;
  const criterion = input.criterion;
  return !history.some((marker) => marker.kind === "deterministic-correction" && marker.operation_id === operationId && marker.card_id === cardId && marker.criterion === criterion);
}

/** Discover exactly one reusable product PR; duplicate identities fail closed. */
export async function findProductPullRequest(github: GitHubAdapter, cardId: string) {
  const prs = await (await import("../state-pr/github.ts")).discoverManagedPullRequests(github, { kind: "product", cardIds: [cardId] });
  if (prs.length > 1) fail("multiple marked product PRs");
  return prs[0];
}

export const productPrTitle = (cardId: string, title: string): string => `kanban: ${cardId} — ${title}`;
