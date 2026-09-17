import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAgents } from "../../extensions/kanban-flow/agents/discover.ts";
import { parseAgentDefinition } from "../../extensions/kanban-flow/agents/definitions.ts";
import { verifyPersistedTrust } from "../../extensions/kanban-flow/agents/trust.ts";

const markdown = (name: string, body = "Follow the bounded role contract.\n") => `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`;

async function fixture(): Promise<{ root: string; repo: string; nested: string; packaged: string }> {
  const root = await mkdtemp(join(tmpdir(), "kanban-agent-discovery-"));
  const repo = join(root, "repo");
  const nested = join(repo, "packages", "app");
  const packaged = join(root, "package-agents");
  await Promise.all([mkdir(join(repo, ".pi", "agents"), { recursive: true }), mkdir(join(nested, ".pi", "agents"), { recursive: true }), mkdir(packaged)]);
  await writeFile(join(packaged, "requirements-producer.md"), markdown("requirements-producer"));
  return { root, repo, nested, packaged };
}

const trusted = { getEntry: (path: string) => ({ path, decision: true }) };

test("persisted trust distinguishes saved yes, no, absent, and outside cwd", async () => {
  const { root, repo, nested } = await fixture();
  try {
    assert.equal((await verifyPersistedTrust(repo, nested, { getEntry: () => null })).reason, "absent");
    assert.equal((await verifyPersistedTrust(repo, nested, { getEntry: (path) => ({ path, decision: false }) })).reason, "saved_no");
    assert.equal((await verifyPersistedTrust(repo, nested, trusted)).trusted, true);
    await assert.rejects(verifyPersistedTrust(repo, root, trusted), /outside/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("nearest trusted project override wins with normalized hash and deterministic report", async () => {
  const { root, repo, nested, packaged } = await fixture();
  try {
    await writeFile(join(repo, ".pi", "agents", "requirements-producer.md"), markdown("requirements-producer", "ancestor\r\n"));
    await writeFile(join(nested, ".pi", "agents", "requirements-producer.md"), markdown("requirements-producer", "nearest\n"));
    const result = await discoverAgents({ cwd: nested, repositoryRoot: repo, packageAgentsRoot: packaged, overridesEnabled: true, trustReader: trusted });
    assert.equal(result.agents.get("requirements-producer")?.body, "nearest\n");
    assert.equal(result.report.active.find((entry) => entry.name === "requirements-producer")?.path, "packages/app/.pi/agents/requirements-producer.md");
    assert.equal(result.report.ignored[0].reason, "shadowed_by_nearer_override");
    assert.equal(result.report.unavailable.length, 8);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("untrusted or disabled project definitions remain inactive and diagnostic", async () => {
  const { root, repo, nested, packaged } = await fixture();
  try {
    await writeFile(join(nested, ".pi", "agents", "requirements-producer.md"), markdown("requirements-producer", "project\n"));
    const absent = await discoverAgents({ cwd: nested, repositoryRoot: repo, packageAgentsRoot: packaged, overridesEnabled: true, trustReader: { getEntry: () => null } });
    assert.equal(absent.agents.get("requirements-producer")?.source, "package");
    assert.equal(absent.report.ignored[0].reason, "persisted_trust_required");
    const disabled = await discoverAgents({ cwd: nested, repositoryRoot: repo, packageAgentsRoot: packaged, overridesEnabled: false, trustReader: trusted });
    assert.equal(disabled.report.ignored[0].reason, "overrides_disabled");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("agent parser rejects unknown fields, name mismatch, invalid UTF-8, and oversized body", () => {
  assert.throws(() => parseAgentDefinition(Buffer.from(`---\nname: reviewer\ndescription: x\ntools: bash\n---\nbody`), "reviewer", "project", ".pi/agents/reviewer.md"), /only description and name/);
  assert.throws(() => parseAgentDefinition(Buffer.from(markdown("reviewer")), "implementer", "project", ".pi/agents/implementer.md"), /does not match/);
  assert.throws(() => parseAgentDefinition(Uint8Array.of(0xff), "reviewer", "project", "bad"), /UTF-8/);
  assert.throws(() => parseAgentDefinition(Buffer.from(markdown("reviewer", "x".repeat(100_001))), "reviewer", "project", "large"), /size/);
});

test("project symlink escapes fail before activation", async () => {
  const { root, repo, nested, packaged } = await fixture();
  try {
    const outside = join(root, "outside.md");
    await writeFile(outside, markdown("reviewer"));
    await symlink(outside, join(nested, ".pi", "agents", "reviewer.md"));
    await assert.rejects(discoverAgents({ cwd: nested, repositoryRoot: repo, packageAgentsRoot: packaged, overridesEnabled: true, trustReader: trusted }), /escapes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
