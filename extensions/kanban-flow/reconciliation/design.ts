import type { BoardSnapshot, CardSnapshot, DesignMergeEvidence, TransitionRequest } from "../engine/transitions.ts";
import type { PRRecord } from "../board/schemas.ts";
import { planLifecycleTransition, type TransitionResult } from "../lifecycle/effects.ts";

export type DesignReconciliationKind = "wait" | "merged" | "closed_retry" | "closed_blocked" | "recovery_adoption" | "blocked" | "ambiguous";

export interface DesignReconciliationInput {
  readonly card: CardSnapshot;
  /** Canonical GitHub observation. Undefined means no matching managed PR. */
  readonly pullRequest?: PRRecord;
  readonly freshMainCommit: string;
  /** The design PR's complete diff, as repository-relative paths and actions. */
  readonly diff: ReadonlyArray<{ readonly path: string; readonly action: "create" | "modify" | "delete" }>;
  readonly expectedDesignPath?: string;
  /** GitHub merge metadata is not sufficient: prove the merge is in fresh origin/main. */
  readonly isReachableFromMain?: (mergeCommit: string, mainCommit: string) => Promise<boolean> | boolean;
  readonly designLimit: number;
  readonly transition?: Omit<TransitionRequest, "cardId" | "event" | "designLimit" | "implementationLimit"> & { readonly implementationLimit?: number };
  readonly board?: BoardSnapshot;
  /** Backward-compatible alias for callers that name the snapshot cardBoard. */
  readonly cardBoard?: BoardSnapshot;
}

export interface DesignReconciliationOutcome {
  readonly kind: DesignReconciliationKind;
  readonly reason?: string;
  readonly evidence: readonly string[];
  readonly transition?: TransitionResult;
}

function fail(message: string): never { throw new Error(`Invalid design reconciliation: ${message}`); }
function expectedPath(input: DesignReconciliationInput): string { return input.expectedDesignPath ?? `docs/designs/${input.card.id}.md`; }
function samePr(left: PRRecord, right: PRRecord): boolean {
  return left.number === right.number && left.url === right.url && left.head === right.head && left.base === right.base && left.operation_id === right.operation_id && left.head_commit === right.head_commit;
}
function validateDiff(input: DesignReconciliationInput): void {
  const path = expectedPath(input);
  if (input.diff.length !== 1 || input.diff[0]?.path !== path || input.diff[0]?.action === "delete") fail("design PR must contain exactly one design document path");
}
function validateIdentity(input: DesignReconciliationInput, pr: PRRecord): void {
  const recorded = input.card.workflow.design.pr;
  if (!recorded) fail("card has no recorded design PR");
  if (!samePr(recorded, pr)) fail("GitHub design PR identity differs from recorded identity");
  if (pr.base !== "main" || pr.head !== input.card.workflow.design.branch || pr.head_commit !== recorded.head_commit) fail("design PR base, branch, or head differs from card");
  if (input.card.workflow.design.branch === null) fail("design branch is missing");
  if (input.card.workflow.design.checker_result_paths.length === 0) fail("design PR has no checked design evidence");
}
function makeTransition(input: DesignReconciliationInput, event: TransitionRequest["event"]): TransitionRequest {
  if (!input.transition) fail("a transition metadata factory is required for durable reconciliation");
  return {
    ...input.transition,
    cardId: input.card.id,
    event,
    designLimit: input.designLimit,
    implementationLimit: input.transition.implementationLimit ?? 10,
  };
}

/**
 * Reconcile one card's design PR. This function only interprets supplied
 * authority and plans a pure transition; it never schedules split/implementation.
 */
export async function reconcileDesign(input: DesignReconciliationInput): Promise<DesignReconciliationOutcome> {
  if (!input.freshMainCommit || input.card.status === "done" || input.card.status === "replaced") return { kind: "blocked", reason: "design reconciliation requires a nonterminal card and fresh main", evidence: [] };
  const pr = input.pullRequest;
  if (!pr) return { kind: "wait", reason: "design PR is not yet discoverable", evidence: [] };
  validateIdentity(input, pr);
  validateDiff(input);
  const evidence = Object.freeze([expectedPath(input)]);
  if (pr.state === "open") {
    if (input.card.status !== "design_review") return { kind: "ambiguous", reason: "an open design PR has no design_review card authority", evidence };
    return { kind: "wait", reason: "design PR is open and unchanged", evidence };
  }
  if (pr.state === "closed") {
    if (pr.merge_commit !== null) return { kind: "ambiguous", reason: "closed design PR has a merge commit", evidence };
    const request = makeTransition(input, { kind: "design_closed", evidence });
    const transition = planLifecycleTransition(input.board ?? input.cardBoard ?? ({ cards: [input.card] } as never), request);
    return { kind: input.card.rework.design >= input.designLimit ? "closed_blocked" : "closed_retry", evidence, transition };
  }
  if (!pr.merge_commit || !input.isReachableFromMain || !(await input.isReachableFromMain(pr.merge_commit, input.freshMainCommit))) {
    return { kind: "blocked", reason: "merged design PR is not reachable from fresh origin/main", evidence };
  }
  const mergeEvidence: DesignMergeEvidence = { pr, approvedCommit: pr.head_commit };
  const event = input.card.status === "design_review" ? { kind: "design_merged", evidence: mergeEvidence } as const : { kind: "recovery_design_merged", evidence: mergeEvidence } as const;
  const transition = planLifecycleTransition(input.board ?? input.cardBoard ?? ({ cards: [input.card] } as never), makeTransition(input, event));
  return { kind: input.card.status === "design_review" ? "merged" : "recovery_adoption", evidence, transition };
}
export const reconcileDesignPullRequest = reconcileDesign;
