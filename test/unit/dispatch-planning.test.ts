import assert from "node:assert/strict";
import { test } from "node:test";
import { stat } from "node:fs/promises";
import { resolveDispatchModel } from "../../extensions/kanban-flow/agents/models.ts";
import { policyForAgent } from "../../extensions/kanban-flow/agents/policy.ts";
import { createDispatchPlan } from "../../extensions/kanban-flow/agents/runner.ts";

const agent = { name: "requirements-checker", description: "check", body: "Check.", source: "package", path: "agents/requirements-checker.md", sha256: "a".repeat(64) } as const;
const parent = { provider: "openai", id: "gpt-5.4", thinking: "max" } as const;

test("models inherit every effective parent field and explicit overrides fail closed", async () => {
  assert.deepEqual(await resolveDispatchModel(parent, agent.name, {}, { resolve: async () => null }), { ...parent, inherited: true });
  const resolved = await resolveDispatchModel(parent, agent.name, { [agent.name]: "vendor/model/with/slash:v2:high" }, { resolve: async (provider, id) => ({ provider, id, authenticated: true, supportsTools: true }) });
  assert.deepEqual(resolved, { provider: "vendor", id: "model/with/slash:v2", thinking: "high", inherited: false });
  await assert.rejects(resolveDispatchModel(parent, agent.name, { [agent.name]: "vendor/missing" }, { resolve: async () => null }), /unavailable/);
  await assert.rejects(resolveDispatchModel(parent, agent.name, { [agent.name]: "vendor/no-tools" }, { resolve: async (provider, id) => ({ provider, id, authenticated: true, supportsTools: false }) }), /custom tools/);
});

test("policy and dispatch argv are deterministic and disable unrelated resources", async () => {
  const policy = policyForAgent(agent.name); assert.equal(policy.name, "strict"); assert.equal(policy.resultTool, "submit_checker_result");
  const plan = await createDispatchPlan({ dispatchId: "KFRUN-20260115T103000000Z-abcdefgh", agent, model: { ...parent, inherited: true }, policy, cwd: process.cwd(), systemPrompt: "bounded prompt", task: "Check requirements." });
  try {
    assert.equal((await stat(plan.promptPath)).mode & 0o777, 0o600);
    for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools"]) assert.ok(plan.argv.includes(flag));
    assert.equal(plan.argv.includes("--approve"), false); assert.equal(plan.argv.includes("--skill"), false);
    assert.match(plan.redactedArgv.join(" "), /<PACKAGE_ROOT>/); assert.match(plan.redactedArgv.join(" "), /<TEMP_ROOT>/);
    assert.deepEqual(policy.tools, ["kanban_read", "kanban_grep", "kanban_find", "kanban_ls", "submit_checker_result"]);
  } finally { await plan.cleanup(); }
});

test("broad-write dispatches require an engine-owned runtime tool policy", async () => {
  const implementationAgent = { ...agent, name: "implementer" as const, path: "agents/implementer.md" };
  await assert.rejects(createDispatchPlan({ dispatchId: "KFRUN-20260115T103000000Z-abcdefgh", agent: implementationAgent, model: { ...parent, inherited: true }, policy: policyForAgent("implementer"), cwd: process.cwd(), systemPrompt: "bounded", task: "implement" }), /tool policy/);
});

test("engine-owned mapping keeps producers sequential by policy and implementation broad", () => {
  assert.equal(policyForAgent("requirements-producer").requiresPersistedTrust, true);
  assert.equal(policyForAgent("implementer").name, "broad-write");
  assert.equal(policyForAgent("reviewer").cwdKind, "immutable_snapshot");
  assert.equal(policyForAgent("ship-producer").requiresPersistedTrust, false);
});
