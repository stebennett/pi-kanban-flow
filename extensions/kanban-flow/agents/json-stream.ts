import { Value } from "typebox/value";
import { CheckerResultSchema, ProbeResultSchema, ProducerResultSchema, ReviewerResultSchema, SplitDecisionResultSchema, validateCheckerResult, validateProbeResult, validateProducerResult, validateReviewerResult, validateSplitDecisionResult } from "../board/result-schemas.ts";
import type { ResultRole, StructuredResult } from "./result-tools.ts";

const schemas = { producer: ProducerResultSchema, checker: CheckerResultSchema, reviewer: ReviewerResultSchema, splitDecision: SplitDecisionResultSchema, probe: ProbeResultSchema } as const;
const roleTools = new Set(["submit_producer_result", "submit_checker_result", "submit_reviewer_result", "submit_split_decision", "submit_probe_result"]);
const allowedEvents = new Set(["agent_start", "agent_end", "turn_start", "turn_end", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_update", "tool_execution_end", "queue_update", "compaction_start", "compaction_end", "auto_compaction_start", "auto_compaction_end", "retry_start", "retry_end"]);

export class JsonLineDecoder {
  #buffer = Buffer.alloc(0);
  constructor(private readonly maxLineBytes: number) {}
  push(chunk: Buffer): string[] { this.#buffer = Buffer.concat([this.#buffer, chunk]); const lines: string[] = []; for (;;) { const index = this.#buffer.indexOf(0x0a); if (index < 0) break; if (index > this.maxLineBytes) throw new Error("JSON event line exceeds limit"); const line = this.#buffer.subarray(0, index); this.#buffer = this.#buffer.subarray(index + 1); lines.push(line.subarray(-1)[0] === 0x0d ? line.subarray(0, -1).toString("utf8") : line.toString("utf8")); } if (this.#buffer.length > this.maxLineBytes) throw new Error("Unterminated JSON event line exceeds limit"); return lines; }
  finish(): void { if (this.#buffer.length > 0) throw new Error("JSON event stream ended with an unterminated line"); }
}

export interface RunExpectation { role: ResultRole; tool: string; dispatchId: string; cardId: string; phase?: string; lens?: string; probe?: string; criteria?: readonly string[]; observations?: readonly string[] }
export interface RuntimeEvidence { payload: StructuredResult; provider: string; model: string; thinking: string; stopReason: string; usage: Record<string, unknown>; eventCount: number }

export class JsonRunEvaluator {
  #header = false; #agentEnd = false; #resultCalls: Array<{ name: string; args: StructuredResult }> = []; #resultExecution = false; #postResultConflict = false; #stopReason = ""; #provider = ""; #model = ""; #thinking = ""; #usage: Record<string, unknown> = {}; eventCount = 0;
  constructor(private readonly expected: RunExpectation, private readonly maxEvents: number) {}
  accept(value: unknown): void {
    this.eventCount++; if (this.eventCount > this.maxEvents) throw new Error("JSON event count exceeds limit");
    if (!value || typeof value !== "object") throw new Error("JSON event must be an object"); const event = value as Record<string, any>;
    if (!this.#header) { if (event.type !== "session" || event.version !== 3 || typeof event.id !== "string" || typeof event.cwd !== "string") throw new Error("Missing or invalid Pi session header"); this.#header = true; return; }
    if (typeof event.type !== "string" || !allowedEvents.has(event.type)) throw new Error(`Unknown Pi JSON event: ${String(event.type)}`);
    if (event.type === "agent_end") this.#agentEnd = true;
    if (event.type === "tool_execution_end" && event.toolName === this.expected.tool) { if (event.isError) throw new Error("Result tool execution failed"); this.#resultExecution = true; }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const message = event.message; const calls = Array.isArray(message.content) ? message.content.filter((part: any) => part?.type === "toolCall") : [];
      const roleCalls = calls.filter((part: any) => roleTools.has(part.name));
      if (this.#resultCalls.length > 0 && (calls.length > 0 || (Array.isArray(message.content) && message.content.some((part: any) => part?.type === "text" && part.text?.trim())))) this.#postResultConflict = true;
      for (const call of roleCalls) this.#resultCalls.push({ name: call.name, args: call.arguments });
      if (roleCalls.length > 0 && calls.length !== 1) throw new Error("Result call has a sibling tool call");
      this.#stopReason = message.stopReason ?? this.#stopReason; this.#provider = message.provider ?? this.#provider; this.#model = message.model ?? this.#model; this.#thinking = message.thinkingLevel ?? message.reasoningLevel ?? this.#thinking; this.#usage = message.usage ?? this.#usage;
    }
  }
  finish(exitCode: number): RuntimeEvidence {
    if (!this.#header || !this.#agentEnd) throw new Error("Missing final Pi events"); if (exitCode !== 0) throw new Error(`Child exited with code ${exitCode}`);
    if (this.#resultCalls.length !== 1) throw new Error(`Expected exactly one result call; observed ${this.#resultCalls.length}`); const call = this.#resultCalls[0];
    if (call.name !== this.expected.tool || !this.#resultExecution) throw new Error("Wrong or incomplete result tool call"); if (this.#postResultConflict) throw new Error("Conflicting output followed the result call"); if (this.#stopReason !== "toolUse") throw new Error(`Unacceptable stop reason: ${this.#stopReason || "missing"}`);
    const schema = schemas[this.expected.role]; if (!Value.Check(schema, call.args)) throw new Error("Result payload failed schema validation");
    const result: any = call.args;
    if (this.expected.role === "producer") validateProducerResult(result, { dispatchId: this.expected.dispatchId, cardId: this.expected.cardId, phase: this.expected.phase as any });
    else if (this.expected.role === "checker") validateCheckerResult(result, { dispatchId: this.expected.dispatchId, cardId: this.expected.cardId, phase: this.expected.phase as any, criteria: this.expected.criteria ?? [] });
    else if (this.expected.role === "reviewer") validateReviewerResult(result, { dispatchId: this.expected.dispatchId, cardId: this.expected.cardId, lens: this.expected.lens as any });
    else if (this.expected.role === "splitDecision") validateSplitDecisionResult(result, { dispatchId: this.expected.dispatchId, cardId: this.expected.cardId });
    else validateProbeResult(result, { dispatchId: this.expected.dispatchId, cardId: this.expected.cardId, probe: this.expected.probe as any, observations: this.expected.observations });
    if (!this.#provider || !this.#model || !this.#thinking) throw new Error("Final runtime model metadata is incomplete");
    return { payload: call.args, provider: this.#provider, model: this.#model, thinking: this.#thinking, stopReason: this.#stopReason, usage: this.#usage, eventCount: this.eventCount };
  }
}
