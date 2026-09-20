import type { PRRecord } from "../board/schemas.ts";
import type { BoardSnapshot, CardSnapshot, TransitionEvent, TransitionRequest } from "./transitions.ts";
import { planLifecycleTransition, type TransitionResult } from "../lifecycle/effects.ts";

/** Parent-attested state-PR observation. State PRs are reconciled before cards. */
export interface StatePullRequestFact {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "merged" | "closed";
  readonly marker: string;
  readonly mergeCommit: string | null;
  readonly reachableFromMain: boolean;
  readonly valid: boolean;
}
export interface StateReconciliationInput {
  readonly pullRequests: readonly StatePullRequestFact[];
  readonly freshMainCommit: string;
}
export type StateReconciliationOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "pending"; readonly pullRequest: StatePullRequestFact }
  | { readonly kind: "unresolved"; readonly reason: string }
  | { readonly kind: "merged"; readonly pullRequest: StatePullRequestFact };

/** Reject ambiguity rather than allowing a local or open PR to become authority. */
export function reconcileStatePullRequests(input: StateReconciliationInput): StateReconciliationOutcome {
  if (!input.freshMainCommit) return { kind: "unresolved", reason: "fresh origin/main is unavailable" };
  const invalid = input.pullRequests.filter((pr) => !pr.valid || !pr.marker || (pr.state === "merged" && (!pr.mergeCommit || !pr.reachableFromMain)));
  if (invalid.length) return { kind: "unresolved", reason: "state PR marker or merge evidence is invalid" };
  if (input.pullRequests.length > 1) return { kind: "unresolved", reason: "multiple managed state PRs are ambiguous" };
  const pr = input.pullRequests[0];
  if (!pr) return { kind: "none" };
  if (pr.state === "open") return { kind: "pending", pullRequest: pr };
  if (pr.state === "closed") return { kind: "unresolved", reason: "closed-unmerged state PR requires explicit recovery" };
  return { kind: "merged", pullRequest: pr };
}

export interface CheckFact { readonly name: string; readonly conclusion: "queued" | "requested" | "waiting" | "in_progress" | "success" | "neutral" | "skipped" | "failure" | "cancelled" | "timed_out" | "action_required" | "unknown"; readonly required: boolean; readonly codeEvidence?: boolean; }
export interface ReviewFact { readonly reviewer: string; readonly state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" | "COMMENTED"; readonly submittedAt: string; }
export interface ProductReconciliationInput {
  readonly board: BoardSnapshot;
  readonly card: CardSnapshot;
  readonly pullRequest?: PRRecord;
  readonly duplicatePullRequests?: readonly PRRecord[];
  readonly checks: readonly CheckFact[];
  readonly reviews: readonly ReviewFact[];
  readonly freshMainCommit: string;
  readonly mergeReachable?: boolean;
  readonly reviewedTreeCompatible?: boolean;
  readonly includedReviewedHead?: boolean;
  readonly implementationLimit: number;
  /** Parent-generated probe/artifact paths for a material metadata refresh. */
  readonly verificationResultPaths?: readonly string[];
  readonly metadata: TransitionRequest["metadata"];
}
export type ProductReconciliationKind = "wait" | "reconciled" | "code_failure" | "blocked" | "merged" | "recovery_adoption" | "ambiguous";
export interface ProductReconciliationOutcome {
  readonly kind: ProductReconciliationKind;
  readonly reason?: string;
  readonly transition?: TransitionResult;
}

function eventTransition(input: ProductReconciliationInput, event: TransitionEvent): TransitionResult {
  const request: TransitionRequest = { cardId: input.card.id, event, metadata: input.metadata, designLimit: 10, implementationLimit: input.implementationLimit };
  return planLifecycleTransition(input.board, request);
}
function evidence(input: ProductReconciliationInput): string[] {
  return input.card.workflow.ship.verification_result_paths.length ? [...input.card.workflow.ship.verification_result_paths] : ["docs/cards/artifacts/" + input.card.id + "/probe-pr-state.yaml"];
}
function effectiveReviews(reviews: readonly ReviewFact[]): ReviewFact[] {
  const latest = new Map<string, ReviewFact>();
  for (const review of reviews) {
    const old = latest.get(review.reviewer);
    if (!old || review.submittedAt > old.submittedAt) latest.set(review.reviewer, review);
  }
  return [...latest.values()];
}
function validateIdentity(input: ProductReconciliationInput, pr: PRRecord): string | undefined {
  const recorded = input.card.workflow.ship.product_pr;
  const branch = input.card.workflow.implementation.branch;
  const head = input.card.workflow.review.reviewed_commit;
  if (!recorded || !branch || !head) return "shipping card is missing recorded product identity";
  if (input.duplicatePullRequests && input.duplicatePullRequests.length > 0) return "duplicate managed product PRs";
  if (pr.number !== recorded.number || pr.url !== recorded.url || pr.head !== branch || pr.base !== "main" || pr.head_commit !== head) return "product PR identity does not match reviewed head/branch";
  return undefined;
}
function checkState(checks: readonly CheckFact[]): "pending" | "failure" | "inconclusive" | "pass" {
  const required = checks.filter((check) => check.required);
  if (required.some((check) => ["queued", "requested", "waiting", "in_progress"].includes(check.conclusion))) return "pending";
  if (required.some((check) => check.conclusion === "failure" && check.codeEvidence === true)) return "failure";
  if (required.some((check) => check.conclusion === "failure" || ["cancelled", "timed_out", "action_required", "unknown"].includes(check.conclusion))) return "inconclusive";
  return required.every((check) => ["success", "neutral", "skipped"].includes(check.conclusion)) ? "pass" : "inconclusive";
}

/** Reconcile one shipping card from parent-attested GitHub facts only. */
export function reconcileProduct(input: ProductReconciliationInput): ProductReconciliationOutcome {
  if (!input.freshMainCommit) return { kind: "blocked", reason: "fresh origin/main is unavailable" };
  const pr = input.pullRequest;
  if (!pr) return { kind: "wait", reason: "marked product PR is not discoverable" };
  if (input.card.status === "ready_to_ship" && pr.state === "merged") {
    if (!pr.merge_commit || input.mergeReachable !== true || input.reviewedTreeCompatible !== true || input.includedReviewedHead !== true) return { kind: "blocked", reason: "merged product PR lacks complete reachability/tree/head proof" };
    return { kind: "recovery_adoption", transition: eventTransition(input, { kind: "recovery_product_merged", pr, mergeCommit: pr.merge_commit, deliveredAt: input.metadata.at, evidence: evidence(input) }) };
  }
  if (input.card.status !== "shipping") return { kind: "ambiguous", reason: "product PR observed outside shipping status" };
  const identityError = validateIdentity(input, pr);
  if (identityError) return { kind: "ambiguous", reason: identityError };
  if (pr.state === "closed") return { kind: "blocked", reason: "product PR closed without merge" };
  if (pr.state === "merged") {
    if (!pr.merge_commit || input.mergeReachable !== true || input.reviewedTreeCompatible !== true || input.includedReviewedHead !== true) return { kind: "blocked", reason: "merged product PR lacks complete reachability/tree/head proof" };
    return { kind: "merged", transition: eventTransition(input, { kind: "product_merged", pr, mergeCommit: pr.merge_commit, deliveredAt: input.metadata.at }) };
  }
  if (effectiveReviews(input.reviews).some((review) => review.state === "CHANGES_REQUESTED")) return { kind: "blocked", reason: "effective GitHub review state is CHANGES_REQUESTED" };
  const checks = checkState(input.checks);
  if (checks === "pending") return { kind: "wait", reason: "required checks are pending" };
  if (checks === "failure") return { kind: "code_failure", transition: eventTransition(input, { kind: "shipping_code_failure", evidence: evidence(input) }) };
  if (checks === "inconclusive") return { kind: "blocked", reason: "required check conclusion is inconclusive" };
  return { kind: "reconciled", transition: eventTransition(input, { kind: "shipping_reconciled", evidence: { pr, verificationResultPaths: [...(input.verificationResultPaths ?? [])] } }) };
}

export const reconcileShipping = reconcileProduct;

/** Reconciliation gate used by the pump: state authority always wins over card facts. */
export interface ReconciliationPassInput {
  readonly state: StateReconciliationInput;
  readonly cards: readonly ProductReconciliationInput[];
}
export type ReconciliationPassOutcome =
  | { readonly kind: "state"; readonly outcome: StateReconciliationOutcome }
  | { readonly kind: "card"; readonly cardId: string; readonly outcome: ProductReconciliationOutcome }
  | { readonly kind: "none" };

export function reconcileBeforeSelection(input: ReconciliationPassInput): ReconciliationPassOutcome {
  const state = reconcileStatePullRequests(input.state);
  if (state.kind !== "none") return { kind: "state", outcome: state };
  const actionable = input.cards
    .map((candidate) => ({ cardId: candidate.card.id, outcome: reconcileProduct(candidate) }))
    .filter(({ outcome }) => outcome.kind !== "wait");
  if (actionable.length > 1) return { kind: "state", outcome: { kind: "unresolved", reason: "multiple independent card reconciliation effects are ambiguous" } };
  const first = actionable[0];
  return first ? { kind: "card", ...first } : { kind: "none" };
}
