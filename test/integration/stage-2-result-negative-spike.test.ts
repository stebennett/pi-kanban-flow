import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function execute(args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject); child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("real Pi final event exposes a sibling terminating tool that a role runner must reject", { skip: process.env.PI_RUN_REAL_STAGE_2_SPIKE !== "1" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-result-negative-spike-"));
  const extension = join(root, "tools.ts");
  await writeFile(extension, [
    'import { Type } from "typebox";',
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'function tool(name: string) { return { name, label: name, description: "Call once as final answer.", parameters: Type.Object({}, { additionalProperties: false }), async execute() { return { content: [{ type: "text", text: "done" }], details: { name }, terminate: true }; } }; }',
    'export default function(pi: ExtensionAPI) { pi.registerTool(tool("submit_expected_role")); pi.registerTool(tool("submit_sibling_role")); }',
  ].join("\n"), { mode: 0o600 });
  try {
    const result = await execute([
      "--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
      "-e", extension, "--tools", "submit_sibling_role", "--model", "openai-codex/gpt-5.6-luna", "--thinking", "low",
      "Call submit_sibling_role exactly once. Do not write prose.",
    ], root);
    assert.equal(result.code, 0, result.stderr);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const turnEnd = events.find((event) => event.type === "turn_end") as { toolResults?: Array<{ toolName?: string }> } | undefined;
    assert.deepEqual(turnEnd?.toolResults?.map(({ toolName }) => toolName), ["submit_sibling_role"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
