import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonLineDecoder, JsonRunEvaluator } from "../../extensions/kanban-flow/agents/json-stream.ts";
import { executeDispatch, type DispatchPlan } from "../../extensions/kanban-flow/agents/runner.ts";
import { policyForAgent } from "../../extensions/kanban-flow/agents/policy.ts";
const run = "KFRUN-20260115T103000000Z-abcdefgh";
const payload = { schema_version: 1, dispatch_id: run, card_id: "none", phase: "requirements", status: "pass", summary: "ok", criteria: [{ key: "REQ-OBSERVABLE", verdict: "pass", evidence: [{ kind: "file", reference: "spec:1", summary: "proof" }] }], findings: [], evidence: [] };
const expectation = { role: "checker", tool: "submit_checker_result", dispatchId: run, cardId: "none", phase: "requirements", criteria: ["REQ-OBSERVABLE"] } as const;
function events(args = payload): any[] { return [{ type: "session", version: 3, id: "s", timestamp: "now", cwd: "/tmp" }, { type: "agent_start" }, { type: "message_end", message: { role: "assistant", provider: "openai", model: "gpt-5.4", thinkingLevel: "high", stopReason: "toolUse", usage: { input: 1 }, content: [{ type: "toolCall", name: "submit_checker_result", arguments: args }] } }, { type: "tool_execution_end", toolCallId: "t", toolName: "submit_checker_result", result: {}, isError: false }, { type: "agent_end", messages: [] }]; }

test("LF byte decoder handles chunk boundaries and rejects unterminated output", () => { const decoder = new JsonLineDecoder(20); assert.deepEqual(decoder.push(Buffer.from('{"x":')), []); assert.deepEqual(decoder.push(Buffer.from('1}\r\n')), ['{"x":1}']); decoder.finish(); const bad = new JsonLineDecoder(2); assert.throws(() => bad.push(Buffer.from("abc")), /exceeds/); });
test("successful completion requires exact role call and final runtime metadata", () => { const evaluator = new JsonRunEvaluator(expectation, 20); events().forEach((event) => evaluator.accept(event)); const result = evaluator.finish(0); assert.deepEqual(result.payload, payload); assert.equal(result.stopReason, "toolUse"); });
test("prose-only, duplicate, sibling, malformed identity, and unacceptable stops fail", () => {
  const prose = new JsonRunEvaluator(expectation, 20); [events()[0], events()[1], { ...events()[2], message: { ...events()[2].message, content: [{ type: "text", text: "done" }], stopReason: "end" } }, events()[4]].forEach((event) => prose.accept(event)); assert.throws(() => prose.finish(0), /exactly one/);
  const duplicate = new JsonRunEvaluator(expectation, 20); [...events().slice(0, 3), events()[2], ...events().slice(3)].forEach((event) => duplicate.accept(event)); assert.throws(() => duplicate.finish(0), /exactly one|Conflicting/);
  const sibling = new JsonRunEvaluator(expectation, 20); const value = events(); value[2].message.content.push({ type: "toolCall", name: "kanban_read", arguments: { path: "x" } }); assert.throws(() => value.forEach((event) => sibling.accept(event)), /sibling/);
  const mismatch = new JsonRunEvaluator(expectation, 20); events({ ...payload, dispatch_id: "KFRUN-20260115T103000000Z-bbbbbbbb" }).forEach((event) => mismatch.accept(event)); assert.throws(() => mismatch.finish(0), /identity/);
});
test("runner spawns directly and validates a complete fake child stream", async () => {
  const script = `const p=${JSON.stringify(events())};for(const e of p)process.stdout.write(JSON.stringify(e)+'\\n')`;
  const policy = { ...policyForAgent("requirements-checker"), limits: { ...policyForAgent("requirements-checker").limits, timeoutMs: 5_000 } };
  const plan = { dispatchId: run, agent: { name: "requirements-checker", description: "x", body: "x", source: "package", path: "agents/x", sha256: "a".repeat(64) }, model: { provider: "openai", id: "gpt-5.4", thinking: "high", inherited: true }, policy, executable: process.execPath, argv: ["-e", script], redactedArgv: [], environment: process.env, cwd: process.cwd(), promptPath: "none", taskEnvelope: "x", cleanup: async () => {} } as DispatchPlan;
  const result = await executeDispatch(plan, expectation); assert.equal(result.exitCode, 0); assert.equal(result.runtime.eventCount, 5);
});
