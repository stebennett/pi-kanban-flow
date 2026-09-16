import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";

async function eventually<T>(check: () => T, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { return check(); } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

test("Pi persisted trust API distinguishes saved yes, no, and absent decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-trust-spike-"));
  const repo = join(root, "repo");
  const nested = join(repo, "nested", "dispatch");
  try {
    await mkdir(nested, { recursive: true });
    const store = new ProjectTrustStore(join(root, "agent"));
    assert.equal(store.getEntry(nested), null);

    const canonicalRepo = await realpath(repo);
    const canonicalNested = await realpath(nested);
    store.set(repo, true);
    assert.deepEqual(store.getEntry(nested), { path: canonicalRepo, decision: true });

    store.set(nested, false);
    assert.deepEqual(store.getEntry(nested), { path: canonicalNested, decision: false });

    store.set(nested, null);
    assert.deepEqual(store.getEntry(nested), { path: canonicalRepo, decision: true });
    store.set(repo, false);
    assert.deepEqual(store.getEntry(nested), { path: canonicalRepo, decision: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a detached macOS/Linux process group terminates its descendant", { skip: process.platform === "win32" }, async () => {
  const script = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "process.stdout.write(String(child.pid));",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const parent = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  parent.stdout.setEncoding("utf8");
  parent.stdout.on("data", (data) => { stdout += data; });
  try {
    const descendantPid = await eventually(() => {
      const value = Number.parseInt(stdout, 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error("descendant PID not available");
      process.kill(value, 0);
      return value;
    });
    assert.ok(parent.pid);
    process.kill(-parent.pid, "SIGTERM");
    await new Promise<void>((resolve, reject) => {
      parent.once("close", () => resolve());
      parent.once("error", reject);
    });
    await eventually(() => {
      assert.throws(() => process.kill(descendantPid, 0));
    });
  } finally {
    if (!parent.killed && parent.pid) {
      try { process.kill(-parent.pid, "SIGKILL"); } catch { /* already exited */ }
    }
  }
});
