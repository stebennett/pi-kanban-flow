import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const runRealSpike = process.env.PI_RUN_REAL_STAGE_2_SPIKE === "1";

function execute(command: string, args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("real Pi JSON prose-only completion has no terminating result tool", { skip: !runRealSpike }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-json-prose-spike-"));
  try {
    const result = await execute("pi", [
      "--mode", "json", "-p", "--no-session",
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-tools",
      "--model", "openai-codex/gpt-5.6-luna", "--thinking", "low",
      "Respond with exactly the word prose.",
    ], root);
    assert.equal(result.code, 0, result.stderr);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const turnEnd = events.find((event) => event.type === "turn_end") as { message?: { stopReason?: string }; toolResults?: unknown[] } | undefined;
    assert.notEqual(turnEnd?.message?.stopReason, "toolUse");
    assert.deepEqual(turnEnd?.toolResults, []);
    assert.ok(events.some((event) => event.type === "agent_end"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Pi JSON resource and terminating-result spike", { skip: !runRealSpike }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-json-spike-"));
  const extension = join(root, "result-spike.ts");
  await writeFile(extension, [
    'import { Type } from "typebox";',
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'export default function(pi: ExtensionAPI) {',
    '  pi.registerTool({ name: "submit_spike_result", label: "Submit spike result", description: "Call exactly once as the final answer.",',
    '    parameters: Type.Object({ dispatch_id: Type.String({ pattern: "^KFRUN-spike$" }), status: Type.String({ pattern: "^ok$" }) }, { additionalProperties: false }),',
    '    async execute(_id, value) { return { content: [{ type: "text", text: "accepted" }], details: value, terminate: true }; }',
    '  });',
    '}',
  ].join("\n"), { mode: 0o600 });
  try {
    const result = await execute("pi", [
      "--mode", "json", "-p", "--no-session",
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
      "--no-builtin-tools", "-e", extension, "--tools", "submit_spike_result",
      "--model", "openai-codex/gpt-5.6-luna", "--thinking", "low",
      "Call submit_spike_result exactly once with dispatch_id KFRUN-spike and status ok. Do not write prose.",
    ], root);
    assert.equal(result.code, 0, result.stderr);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(events[0].type, "session");
    const turnEnd = events.find((event) => event.type === "turn_end") as { message?: { provider?: string; model?: string; usage?: unknown; stopReason?: string }; toolResults?: Array<{ toolName?: string; details?: unknown }> } | undefined;
    assert.equal(turnEnd?.message?.stopReason, "toolUse");
    assert.equal(typeof turnEnd?.message?.provider, "string");
    assert.equal(typeof turnEnd?.message?.model, "string");
    assert.ok(turnEnd?.message?.usage);
    assert.deepEqual(turnEnd?.toolResults?.map(({ toolName, details }) => ({ toolName, details })), [{ toolName: "submit_spike_result", details: { dispatch_id: "KFRUN-spike", status: "ok" } }]);
    assert.ok(events.some((event) => event.type === "agent_end"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
