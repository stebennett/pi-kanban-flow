import type { ReviewerResult, ProbeResult } from "../board/result-schemas.ts";
import { validateReviewerResult, validateProbeResult } from "../board/result-schemas.ts";
import { validateConfiguredLenses, type ReviewLens } from "./criteria.ts";

export type ReviewDecision = "ready_to_ship" | "rework" | "blocked";
export interface ReviewPanelInput {
  readonly cardId: string;
  readonly lenses: readonly string[];
  readonly results: readonly ReviewerResult[];
  readonly probe: ProbeResult;
  readonly implementationRework: number;
  readonly implementationReworkLimit: number;
  readonly dispatchIds?: ReadonlyMap<ReviewLens, string>;
}
export interface ReviewPanelOutcome {
  readonly decision: ReviewDecision;
  readonly lenses: readonly ReviewLens[];
  readonly blockingFindings: readonly ReviewerResult["findings"][number][];
  readonly advisoryFindings: readonly ReviewerResult["findings"][number][];
  readonly inconclusiveLenses: readonly ReviewLens[];
  readonly reworkIncrement: 0 | 1;
  readonly reason: "all_passed" | "blocking_findings" | "probe_failure" | "inconclusive_evidence" | "budget_exhausted";
}

function fail(message: string): never { throw new Error(`Invalid review panel: ${message}`); }

/** Aggregate a complete panel in configured order; result arrival order is irrelevant. */
export function aggregateReviewPanel(input: ReviewPanelInput): ReviewPanelOutcome {
  const lenses = validateConfiguredLenses(input.lenses);
  if (!/^CARD-[0-9]{4}$/.test(input.cardId)) fail("invalid card ID");
  if (!Number.isInteger(input.implementationRework) || input.implementationRework < 0 || !Number.isInteger(input.implementationReworkLimit) || input.implementationReworkLimit < 0) fail("invalid rework budget");
  validateProbeResult(input.probe, { dispatchId: input.probe.dispatch_id, cardId: input.cardId, probe: "project_commands" });
  if (input.results.length !== lenses.length) fail("panel must contain every configured lens exactly once");
  const byLens = new Map<ReviewLens, ReviewerResult>();
  for (const result of input.results) {
    if (!lenses.includes(result.lens)) fail(`unexpected lens ${result.lens}`);
    if (byLens.has(result.lens)) fail(`duplicate lens ${result.lens}`);
    validateReviewerResult(result, { dispatchId: input.dispatchIds?.get(result.lens) ?? result.dispatch_id, cardId: input.cardId, lens: result.lens });
    byLens.set(result.lens, result);
  }
  const ordered = lenses.map((lens) => byLens.get(lens)!);
  const blockingFindings = ordered.flatMap((result) => result.findings.filter((finding) => finding.severity === "blocking"));
  const advisoryFindings = ordered.flatMap((result) => result.findings.filter((finding) => finding.severity !== "blocking"));
  const inconclusiveLenses = ordered.filter((result) => result.status === "inconclusive").map((result) => result.lens);
  const probeInconclusive = input.probe.status === "inconclusive" || input.probe.observations.some((observation) => observation.status === "unknown");
  const probeFailed = input.probe.status === "failure" || input.probe.observations.some((observation) => observation.status === "fail");
  if (inconclusiveLenses.length > 0 || probeInconclusive) return Object.freeze({ decision: "blocked", lenses, blockingFindings, advisoryFindings, inconclusiveLenses, reworkIncrement: 0, reason: "inconclusive_evidence" });
  if (blockingFindings.length > 0 || probeFailed) {
    if (input.implementationRework < input.implementationReworkLimit) return Object.freeze({ decision: "rework", lenses, blockingFindings, advisoryFindings, inconclusiveLenses, reworkIncrement: 1, reason: blockingFindings.length > 0 ? "blocking_findings" : "probe_failure" });
    return Object.freeze({ decision: "blocked", lenses, blockingFindings, advisoryFindings, inconclusiveLenses, reworkIncrement: 0, reason: "budget_exhausted" });
  }
  if (ordered.some((result) => result.status !== "pass")) return Object.freeze({ decision: "blocked", lenses, blockingFindings, advisoryFindings, inconclusiveLenses, reworkIncrement: 0, reason: "inconclusive_evidence" });
  return Object.freeze({ decision: "ready_to_ship", lenses, blockingFindings, advisoryFindings, inconclusiveLenses, reworkIncrement: 0, reason: "all_passed" });
}

export function reviewerLensOrder(lenses: readonly string[]): readonly ReviewLens[] { return validateConfiguredLenses(lenses); }
