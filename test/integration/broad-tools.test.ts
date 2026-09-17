import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBroadRepositoryTools } from "../../extensions/kanban-flow/agents/broad-tools.ts";
const exec = promisify(execFile);

test("broad tools enforce planned actions, protected paths, direct named commands, and exact diff", async () => {
  const repo = await mkdtemp(join(tmpdir(), "kanban-broad-tools-"));
  try {
    await exec("git", ["init", "-q"], { cwd: repo }); await exec("git", ["config", "user.email", "x@y.invalid"], { cwd: repo }); await exec("git", ["config", "user.name", "Test"], { cwd: repo });
    await mkdir(join(repo, "src")); await writeFile(join(repo, "src", "a.txt"), "old\n"); await exec("git", ["add", "."], { cwd: repo }); await exec("git", ["commit", "-qm", "base"], { cwd: repo });
    const tools = new Map<string, any>(); const planned = new Map([["src/a.txt", "modify"], ["src/new.txt", "create"]] as const);
    registerBroadRepositoryTools({ registerTool(tool: any) { tools.set(tool.name, tool); } } as ExtensionAPI, { root: repo, planned, commands: { verify: { executable: process.execPath, argv: ["-e", "process.stdout.write('ok')"] } } });
    await tools.get("kanban_edit").execute("id", { path: "src/a.txt", oldText: "old", newText: "new" });
    await tools.get("kanban_write").execute("id", { path: "src/new.txt", action: "create", content: "created\n" });
    assert.equal(await readFile(join(repo, "src", "a.txt"), "utf8"), "new\n");
    assert.match((await tools.get("kanban_run_project_command").execute("id", { name: "verify" })).content[0].text, /ok/);
    await assert.rejects(tools.get("kanban_write").execute("id", { path: "docs/cards/x", action: "create", content: "x" }), /Protected|Unplanned/);
    await assert.rejects(tools.get("kanban_write").execute("id", { path: "src/a.txt", action: "create", content: "x" }), /wrong action/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("allowed command side effects outside the plan fail closed", async () => {
  const repo = await mkdtemp(join(tmpdir(), "kanban-command-diff-"));
  try {
    await exec("git", ["init", "-q"], { cwd: repo }); await exec("git", ["config", "user.email", "x@y.invalid"], { cwd: repo }); await exec("git", ["config", "user.name", "Test"], { cwd: repo }); await writeFile(join(repo, "base"), "x"); await exec("git", ["add", "."], { cwd: repo }); await exec("git", ["commit", "-qm", "base"], { cwd: repo });
    const tools = new Map<string, any>(); registerBroadRepositoryTools({ registerTool(tool: any) { tools.set(tool.name, tool); } } as ExtensionAPI, { root: repo, planned: new Map(), commands: { bad: { executable: process.execPath, argv: ["-e", "require('fs').writeFileSync('side-effect','x')"] } } });
    await assert.rejects(tools.get("kanban_run_project_command").execute("id", { name: "bad" }), /Out-of-policy/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});
