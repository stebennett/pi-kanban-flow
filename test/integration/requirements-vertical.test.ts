import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { discoverAgents, assertAgentAvailable } from "../../extensions/kanban-flow/agents/discover.ts";
import { assembleSystemPrompt } from "../../extensions/kanban-flow/agents/prompts.ts";
import { policyForAgent } from "../../extensions/kanban-flow/agents/policy.ts";
import { materializeSnapshot } from "../../extensions/kanban-flow/agents/snapshots.ts";
import { packageRoot } from "../../extensions/kanban-flow/paths.ts";
const exec = promisify(execFile);
const trusted = { getEntry: (path: string) => ({ path, decision: true }) };

test("requirements producer receives approved project context while checker uses immutable inputs", async () => {
  const repo = await mkdtemp(join(tmpdir(), "kanban-requirements-vertical-"));
  try {
    await exec("git", ["init", "-q"], { cwd: repo }); await exec("git", ["config", "user.email", "x@y.invalid"], { cwd: repo }); await exec("git", ["config", "user.name", "Test"], { cwd: repo });
    await mkdir(join(repo, ".pi", "skills", "requirements"), { recursive: true }); await writeFile(join(repo, "AGENTS.md"), "PROJECT-CONTEXT-CANARY\n"); await writeFile(join(repo, ".pi", "skills", "requirements", "SKILL.md"), "APPROVED-SKILL-CANARY\n"); await writeFile(join(repo, "spec.md"), "COMMITTED-SNAPSHOT-CANARY\n"); await exec("git", ["add", "."], { cwd: repo }); await exec("git", ["commit", "-qm", "base"], { cwd: repo }); const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repo });
    const root = await packageRoot(); const discovery = await discoverAgents({ cwd: repo, repositoryRoot: repo, packageAgentsRoot: join(root, "agents"), overridesEnabled: true, trustReader: trusted }); const producer = assertAgentAvailable(discovery, "requirements-producer"); const checker = assertAgentAvailable(discovery, "requirements-checker");
    const protocol = await readFile(join(root, "templates", "agents", "child-protocol.md"), "utf8"); const producerPrompt = await assembleSystemPrompt({ repositoryRoot: repo, protocol, agent: producer, contextPaths: ["AGENTS.md"], skillPaths: [".pi/skills/requirements/SKILL.md"], dispatchInputs: "requirements inputs" }); assert.match(producerPrompt, /PROJECT-CONTEXT-CANARY/); assert.match(producerPrompt, /APPROVED-SKILL-CANARY/); assert.equal(policyForAgent(producer.name).name, "broad-read");
    const snapshot = await materializeSnapshot(repo, stdout.trim()); try { await writeFile(join(repo, "spec.md"), "MUTABLE-CHECKOUT-SECRET\n"); const checkerPrompt = await assembleSystemPrompt({ repositoryRoot: snapshot.root, protocol, agent: checker, dispatchInputs: "ordered criteria" }); assert.equal(checkerPrompt.includes("PROJECT-CONTEXT-CANARY"), false); assert.equal(checkerPrompt.includes("APPROVED-SKILL-CANARY"), false); assert.equal(await readFile(join(snapshot.root, "spec.md"), "utf8"), "COMMITTED-SNAPSHOT-CANARY\n"); assert.deepEqual(policyForAgent(checker.name).tools, ["kanban_read", "kanban_grep", "kanban_find", "kanban_ls", "submit_checker_result"]); } finally { await snapshot.cleanup(); }
  } finally { await rm(repo, { recursive: true, force: true }); }
});
