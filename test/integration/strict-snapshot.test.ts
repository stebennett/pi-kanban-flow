import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { materializeSnapshot } from "../../extensions/kanban-flow/agents/snapshots.ts";
import { registerReadRepositoryTools } from "../../extensions/kanban-flow/agents/repository-tools.ts";

const exec = promisify(execFile);

test("exact-commit snapshot is immutable, read-only, jailed, and exposes bounded tools", async () => {
  const repo = await mkdtemp(join(tmpdir(), "kanban-strict-snapshot-"));
  try {
    await exec("git", ["init", "-q"], { cwd: repo });
    await exec("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
    await exec("git", ["config", "user.name", "Test"], { cwd: repo });
    await writeFile(join(repo, "visible.txt"), "committed canary\n");
    await exec("git", ["add", "visible.txt"], { cwd: repo }); await exec("git", ["commit", "-qm", "fixture"], { cwd: repo });
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repo });
    const snapshot = await materializeSnapshot(repo, stdout.trim());
    try {
      await writeFile(join(repo, "visible.txt"), "mutable secret\n");
      assert.equal(await readFile(join(snapshot.root, "visible.txt"), "utf8"), "committed canary\n");
      assert.equal((await stat(join(snapshot.root, "visible.txt"))).mode & 0o777, 0o444);
      assert.equal((await stat(snapshot.root)).mode & 0o777, 0o555);
      const tools = new Map<string, any>(); registerReadRepositoryTools({ registerTool(tool: any) { tools.set(tool.name, tool); } } as ExtensionAPI, snapshot.root);
      assert.deepEqual([...tools.keys()].sort(), ["kanban_find", "kanban_grep", "kanban_ls", "kanban_read"]);
      assert.match((await tools.get("kanban_read").execute("id", { path: "visible.txt" })).content[0].text, /committed canary/);
      await assert.rejects(tools.get("kanban_read").execute("id", { path: "../visible.txt" }), /forbidden/);
    } finally { await snapshot.cleanup(); }
    await assert.rejects(stat(snapshot.root), /ENOENT/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});
