import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";

const enabled = process.env.PI_RUN_REAL_STAGE_2_SPIKE === "1";
const agentDir = join(homedir(), ".pi", "agent");
const settingsPath = join(agentDir, "settings.json");

function run(args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject); child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function trustedExtensionRoot(): Promise<{ root: string; store: ProjectTrustStore }> {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-trust-negative-"));
  const extensions = join(root, ".pi", "extensions");
  await mkdir(extensions, { recursive: true });
  await writeFile(join(extensions, "trust.ts"), [
    'import { Type } from "typebox";',
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'export default function(pi: ExtensionAPI) { pi.registerTool({ name: "submit_trust_negative", label: "Submit trust negative", description: "Call once.", parameters: Type.Object({}, { additionalProperties: false }), async execute() { return { content: [{ type: "text", text: "loaded" }], details: { loaded: true }, terminate: true }; } }); }',
  ].join("\n"));
  const store = new ProjectTrustStore(agentDir);
  store.set(root, null);
  return { root, store };
}

const childArgs = ["--mode", "json", "-p", "--no-session", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools", "--tools", "submit_trust_negative", "--model", "openai-codex/gpt-5.6-luna", "--thinking", "low", "Call submit_trust_negative exactly once. Do not write prose."];

test("temporary --approve loads resources but leaves no saved trust decision", { skip: !enabled }, async () => {
  const { root, store } = await trustedExtensionRoot();
  try {
    assert.equal(store.getEntry(root), null);
    const result = await run(["--approve", ...childArgs], root);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"toolName":"submit_trust_negative"/);
    assert.equal(store.getEntry(root), null);
  } finally { store.set(root, null); await rm(root, { recursive: true, force: true }); }
});

test("defaultProjectTrust always loads resources but leaves no saved trust decision", { skip: !enabled }, async () => {
  const original = await readFile(settingsPath);
  const { root, store } = await trustedExtensionRoot();
  try {
    const settings = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
    await writeFile(settingsPath, `${JSON.stringify({ ...settings, defaultProjectTrust: "always" }, null, 2)}\n`, { mode: 0o600 });
    assert.equal(store.getEntry(root), null);
    const result = await run(childArgs, root);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"toolName":"submit_trust_negative"/);
    assert.equal(store.getEntry(root), null);
  } finally {
    await writeFile(settingsPath, original, { mode: 0o600 });
    store.set(root, null);
    await rm(root, { recursive: true, force: true });
  }
});
