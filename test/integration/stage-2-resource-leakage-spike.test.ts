import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";

function run(args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject); child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("resource-disable flags prevent a saved-trusted project extension from loading", { skip: process.env.PI_RUN_REAL_STAGE_2_SPIKE !== "1" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-resource-canary-"));
  const marker = join(root, "extension-leaked");
  const projectExtensionDir = join(root, ".pi", "extensions");
  const explicitExtension = join(root, "expected.ts");
  const store = new ProjectTrustStore(join(homedir(), ".pi", "agent"));
  await mkdir(projectExtensionDir, { recursive: true });
  await writeFile(join(projectExtensionDir, "leak.ts"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "leaked");\n`);
  await writeFile(explicitExtension, [
    'import { Type } from "typebox";',
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'export default function(pi: ExtensionAPI) { pi.registerTool({ name: "submit_resource_spike", label: "Submit resource spike", description: "Call once.", parameters: Type.Object({}, { additionalProperties: false }), async execute() { return { content: [{ type: "text", text: "ok" }], details: { loaded: true }, terminate: true }; } }); }',
  ].join("\n"));
  store.set(root, true);
  try {
    const result = await run([
      "--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
      "-e", explicitExtension, "--tools", "submit_resource_spike", "--model", "openai-codex/gpt-5.6-luna", "--thinking", "low",
      "Call submit_resource_spike exactly once. Do not write prose.",
    ], root);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"toolName":"submit_resource_spike"/);
    await assert.rejects(() => access(marker));
  } finally {
    store.set(root, null);
    await rm(root, { recursive: true, force: true });
  }
});
