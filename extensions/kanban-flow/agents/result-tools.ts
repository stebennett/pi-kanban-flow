import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
  CheckerResultSchema,
  ProbeResultSchema,
  ProducerResultSchema,
  ReviewerResultSchema,
  SplitDecisionResultSchema,
  validateCheckerResult,
  validateProbeResult,
  validateProducerResult,
  validateReviewerResult,
  validateSplitDecisionResult,
  type CheckerResult,
  type ProbeResult,
  type ProducerResult,
  type ReviewerResult,
  type SplitDecisionResult,
} from "../board/result-schemas.ts";

export const RESULT_TOOL_NAMES = {
  producer: "submit_producer_result",
  checker: "submit_checker_result",
  reviewer: "submit_reviewer_result",
  splitDecision: "submit_split_decision",
  probe: "submit_probe_result",
} as const;

export type ResultRole = keyof typeof RESULT_TOOL_NAMES;
export type StructuredResult = ProducerResult | CheckerResult | ReviewerResult | SplitDecisionResult | ProbeResult;

const DEFINITIONS = {
  producer: { schema: ProducerResultSchema, description: "Submit the final typed producer result." },
  checker: { schema: CheckerResultSchema, description: "Submit the final typed checker verdict for every dispatched criterion." },
  reviewer: { schema: ReviewerResultSchema, description: "Submit the final typed implementation-review lens result." },
  splitDecision: { schema: SplitDecisionResultSchema, description: "Submit the final typed pre-implementation split decision." },
  probe: { schema: ProbeResultSchema, description: "Submit the final typed deterministic probe result." },
} as const;

/** Validate relationships that do not require hidden parent dispatch inputs. */
export function validateIntrinsicResult(role: ResultRole, value: StructuredResult): void {
  switch (role) {
    case "producer": {
      const result = value as ProducerResult;
      validateProducerResult(result, { dispatchId: result.dispatch_id, cardId: result.card_id, phase: result.phase });
      return;
    }
    case "checker": {
      const result = value as CheckerResult;
      validateCheckerResult(result, { dispatchId: result.dispatch_id, cardId: result.card_id, phase: result.phase, criteria: result.criteria.map((entry) => entry.key) });
      return;
    }
    case "reviewer": {
      const result = value as ReviewerResult;
      validateReviewerResult(result, { dispatchId: result.dispatch_id, cardId: result.card_id, lens: result.lens });
      return;
    }
    case "splitDecision": {
      const result = value as SplitDecisionResult;
      validateSplitDecisionResult(result, { dispatchId: result.dispatch_id, cardId: result.card_id });
      return;
    }
    case "probe": {
      const result = value as ProbeResult;
      validateProbeResult(result, { dispatchId: result.dispatch_id, cardId: result.card_id, probe: result.probe });
    }
  }
}

/** Register exactly one role-result tool. Role entry points must call this once. */
export function registerResultTool(pi: ExtensionAPI, role: ResultRole): void {
  const definition = DEFINITIONS[role];
  const name = RESULT_TOOL_NAMES[role];
  pi.registerTool({
    name,
    label: name,
    description: definition.description,
    promptSnippet: `Return the final result with ${name}`,
    promptGuidelines: [`Use ${name} exactly once as the final action. Do not call it alongside another tool.`],
    parameters: definition.schema,
    async execute(_toolCallId, params) {
      if (!Value.Check(definition.schema, params)) throw new Error(`Invalid ${name} payload`);
      validateIntrinsicResult(role, params as StructuredResult);
      return {
        content: [{ type: "text" as const, text: `Accepted ${name} payload for parent validation.` }],
        details: { role, tool: name, payload: params },
        terminate: true,
      };
    },
  });
}
