import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function bounded(command: string, args: readonly string[], cwd: string, timeoutMs: number, maxBytes: number): Promise<{ reason: "exit" | "timeout" | "output"; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let settled = false;
    const finish = (reason: "exit" | "timeout" | "output") => { if (!settled) { settled = true; clearTimeout(timer); resolve({ reason, stdout }); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish("timeout"); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => { stdout += data; if (Buffer.byteLength(stdout) > maxBytes) { child.kill("SIGKILL"); finish("output"); } });
    child.once("error", reject); child.once("close", () => finish("exit"));
  });
}

test("command prototype enforces direct-execution timeout and output bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-command-limits-"));
  try {
    const slow = await bounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], root, 100, 1024);
    assert.equal(slow.reason, "timeout");
    const noisy = await bounded(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], root, 1_000, 128);
    assert.equal(noisy.reason, "output");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exact diff prototype detects an allowed-command side effect outside planned paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-command-diff-"));
  try {
    await writeFile(join(root, "planned.txt"), "before\n");
    await writeFile(join(root, "protected.txt"), "before\n");
    await writeFile(join(root, "mutate.js"), "const fs=require('node:fs'); fs.writeFileSync('planned.txt','after\\n'); fs.writeFileSync('protected.txt','side effect\\n');\n");
    const result = await bounded(process.execPath, [join(root, "mutate.js")], root, 1_000, 1024);
    assert.equal(result.reason, "exit");
    assert.equal(await readFile(join(root, "planned.txt"), "utf8"), "after\n");
    assert.equal(await readFile(join(root, "protected.txt"), "utf8"), "side effect\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});
