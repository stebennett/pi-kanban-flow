import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

async function eventually(check: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { check(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

test("detached process group supports TERM grace then KILL descendant cleanup", { skip: process.platform === "win32" }, async () => {
  const script = [
    "const { spawn } = require('node:child_process');",
    "process.on('SIGTERM', () => {});",
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
    "setTimeout(() => process.stdout.write(String(child.pid)), 500);",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const parent = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  parent.stdout.setEncoding("utf8");
  parent.stdout.on("data", (chunk) => { stdout += chunk; });
  try {
    let descendantPid = 0;
    await eventually(() => {
      descendantPid = Number.parseInt(stdout, 10);
      assert.ok(descendantPid > 0);
    });
    assert.ok(parent.pid);
    process.kill(-parent.pid, "SIGTERM");
    const graceStarted = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    assert.doesNotThrow(() => process.kill(descendantPid, 0));
    process.kill(-parent.pid, "SIGKILL");
    await new Promise<void>((resolve, reject) => {
      parent.once("close", () => resolve());
      parent.once("error", reject);
    });
    assert.ok(Date.now() - graceStarted >= 5_000);
    await eventually(() => assert.throws(() => process.kill(descendantPid, 0)));
  } finally {
    if (!parent.killed && parent.pid) {
      try { process.kill(-parent.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
});
