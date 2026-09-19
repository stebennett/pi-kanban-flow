import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardSnapshot } from "../../extensions/kanban-flow/board/repository.ts";
import type { ProducerResult, CheckerResult } from "../../extensions/kanban-flow/board/result-schemas.ts";
import type { AgentDefinition } from "../../extensions/kanban-flow/agents/definitions.ts";
import type { DispatchPlan, DispatchSuccess } from "../../extensions/kanban-flow/agents/runner.ts";
import { policyForAgent } from "../../extensions/kanban-flow/agents/policy.ts";
import { REQUIREMENTS_CRITERIA } from "../../extensions/kanban-flow/requirements/criteria.ts";
import { RequirementsDispatchService } from "../../extensions/kanban-flow/requirements/dispatch.ts";

const operation = "KFOP-20260101T000000000Z-abcdefgh"; const transaction = "KFTX-20260101T000000000Z-abcdefgh"; const base = "a".repeat(40);
const config = { repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" }, lock: { ttl_seconds: 1800, heartbeat_seconds: 30 }, scheduler: { wip_limit: 1, priority_order: "ascending" }, rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 }, project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} }, agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] } } as any;
function snapshot(): BoardSnapshot { return { root: "/workspace/repo", board: { harness: "pi", board_schema_version: 1, last_writer_package_version: "1.0.0", project: { repository_id: "owner/repo" }, ids: { next_requirement: 1, next_card: 1, next_acceptance_criterion: 1, next_finding: 1 }, state: { last_reconciled_at: "2026-01-01T00:00:00Z", last_state_transaction: null }, migration: null }, config, cards: [], findingIds: [], requirements: undefined, dashboard: "", canonicalDashboard: "", dashboardDrift: false }; }
function producer(dispatchId: string, status: "completed" | "blocked" | "needs_human" = "completed"): ProducerResult { return { schema_version: 1, dispatch_id: dispatchId, card_id: "none", phase: "requirements", status, summary: "Proposal", artifacts: [], findings: status === "blocked" ? [{ severity: "blocking", summary: "Need input", criterion: "REQ-OBSERVABLE", location: "proposal", detail: "Input missing.", suggested_fix: "Provide input.", evidence: [] }] : [], questions: status === "needs_human" ? ["Which behavior?"] : [], evidence: [], planned_paths: [], requirement_changes: status === "completed" ? [{ temporary_key: "new", action: "create", target_requirement: "none", title: "New", body: "New behavior.", acceptance: ["New works."], supersedes: [] }] : [], card_changes: status === "completed" ? [{ temporary_key: "new-card", action: "create", target_card: "none", title: "New card", why: "Why.", notes: "", requirements: ["new"], acceptance_criteria: [{ text: "New works.", requirement: "new" }], dependencies: [], priority: 1 }] : [] } as unknown as ProducerResult; }
function checker(dispatchId: string, status: "pass" | "fail" | "inconclusive" = "pass"): CheckerResult { const criteria = REQUIREMENTS_CRITERIA.map(({ key }) => ({ key, verdict: status === "fail" && key === "REQ-OBSERVABLE" ? "fail" : status === "inconclusive" && key === "REQ-OBSERVABLE" ? "inconclusive" : "pass", evidence: [{ kind: "file", reference: "proposal", summary: "Checked" }] })); return { schema_version: 1, dispatch_id: dispatchId, card_id: "none", phase: "requirements", status, summary: "Checked", criteria, findings: status === "fail" ? [{ severity: "blocking", summary: "Not observable", criterion: "REQ-OBSERVABLE", location: "proposal", detail: "Behavior is unclear.", suggested_fix: "Clarify behavior.", evidence: [] }] : [], evidence: [] } as unknown as CheckerResult; }
function agent(name: "requirements-producer" | "requirements-checker"): AgentDefinition { return { name, description: name, body: `Act as ${name}.`, source: "package", path: `agents/${name}.md`, sha256: "a".repeat(64) }; }

function harness(options: { trust?: boolean; producerStatus?: "completed" | "blocked" | "needs_human"; checkerStatus?: "pass" | "fail" | "inconclusive"; cleanupFails?: boolean; acceptedFindings?: boolean } = {}) {
  const calls: string[] = []; let checkerPrompt = ""; let cleanup = 0;
  const discover = async () => ({ agents: new Map([["requirements-producer", agent("requirements-producer")], ["requirements-checker", agent("requirements-checker")]]), report: { active: [], ignored: [], unavailable: [] }, repositoryRoot: "/workspace/repo", dispatchCwd: "/workspace/repo", persistedTrust: options.trust ?? true }) as any;
  const createPlan = async (input: any): Promise<DispatchPlan> => { calls.push(`plan:${input.agent.name}`); if (input.agent.name === "requirements-checker") checkerPrompt = input.systemPrompt; return { ...input, executable: "pi", argv: [], redactedArgv: [], environment: {}, promptPath: "/tmp/prompt", taskEnvelope: input.task, async cleanup() {} }; };
  const execute = async (plan: DispatchPlan): Promise<DispatchSuccess> => { calls.push(`execute:${plan.agent.name}`); const payload = plan.agent.name === "requirements-producer" ? producer(plan.dispatchId, options.producerStatus) : checker(plan.dispatchId, options.checkerStatus); if (options.acceptedFindings && payload.status === "completed") payload.findings.push({ severity: "note", summary: "Producer note", criterion: "REQ-SIZED", location: "proposal", detail: "Sizing noted.", suggested_fix: "None.", evidence: [] } as any); if (options.acceptedFindings && payload.status === "pass") payload.findings.push({ severity: "note", summary: "Checker note", criterion: "REQ-SIZED", location: "proposal", detail: "Sizing checked.", suggested_fix: "None.", evidence: [] } as any); return { runtime: { payload, provider: "provider", model: "model", thinking: "medium", stopReason: "tool", usage: {}, eventCount: 2 }, exitCode: 0, stderr: "", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z" }; };
  const snapshotter = async () => ({ root: "/snapshot", commit: base, async cleanup() { cleanup += 1; if (options.cleanupFails) throw new Error("cannot remove"); } });
  const service = new RequirementsDispatchService({ modelResolver: { resolve: async () => null }, discover: discover as any, createPlan: createPlan as any, execute: execute as any, snapshotter: snapshotter as any, protocol: "Follow the protocol.", now: () => new Date("2026-01-01T00:00:00Z") });
  return { service, calls, checkerPrompt: () => checkerPrompt, cleanup: () => cleanup };
}
function input() { return { root: "/workspace/repo", repositoryId: "owner/repo", baseCommit: base, brief: "Create behavior", snapshot: snapshot(), operationId: operation, transactionId: transaction, plannedAt: "2026-01-01T00:00:00Z", parentModel: { provider: "provider", id: "model", thinking: "medium" as const } }; }

test("dispatches producer then immutable checker and returns checked parent-attested artifacts", async () => {
  const value = harness(); const result = await value.service.run(input()); assert.equal(result.kind, "checked", JSON.stringify(result)); if (result.kind !== "checked") return;
  assert.deepEqual(value.calls, ["plan:requirements-producer", "execute:requirements-producer", "plan:requirements-checker", "execute:requirements-checker"]); assert.equal(value.cleanup(), 1);
  assert.deepEqual(result.allocation.requirementIds, { new: "REQ-0001" }); assert.equal(result.artifacts.length, 2); assert.match(result.artifacts[0].path, /requirements-producer-/); assert.match(result.artifacts[1].path, /requirements-check-/);
  assert.match(value.checkerPrompt(), /REQ-OBSERVABLE/); assert.match(value.checkerPrompt(), /REQ-GRANDFATHER-COVERAGE/); assert.doesNotMatch(value.checkerPrompt(), /Approved project skill/);
  assert.deepEqual(result.artifacts.map(({ attestation }) => attestation.finding_ids), [[], []]);
});

test("allocates finding IDs in accepted producer then checker order", async () => {
  const result = await harness({ acceptedFindings: true }).service.run(input()); assert.equal(result.kind, "checked"); if (result.kind !== "checked") return;
  assert.deepEqual(result.allocation.producerFindingIds, ["FINDING-0001"]); assert.deepEqual(result.allocation.checkerFindingIds, ["FINDING-0002"]); assert.deepEqual(result.artifacts.map(({ attestation }) => attestation.finding_ids), [["FINDING-0001"], ["FINDING-0002"]]);
});

test("producer and checker revision outcomes never run later mutation-capable stages", async () => {
  const blocked = harness({ producerStatus: "blocked" }); const producerResult = await blocked.service.run(input()); assert.equal(producerResult.kind, "revision_required"); assert.deepEqual(blocked.calls, ["plan:requirements-producer", "execute:requirements-producer"]);
  const failed = harness({ checkerStatus: "fail" }); const checkerResult = await failed.service.run(input()); assert.equal(checkerResult.kind, "revision_required"); if (checkerResult.kind === "revision_required") assert.equal(checkerResult.stage, "checker"); assert.equal(failed.cleanup(), 1);
});

test("missing saved trust, malformed proposals, and cleanup failure are typed non-mutating failures", async () => {
  const untrusted = harness({ trust: false }); assert.deepEqual(await untrusted.service.run(input()), { kind: "failed", error: "Persisted saved trust is required for requirements dispatch" }); assert.deepEqual(untrusted.calls, []);
  const cleanup = harness({ cleanupFails: true }); const outcome = await cleanup.service.run(input()); assert.deepEqual(outcome, { kind: "failed", error: "Checker snapshot cleanup failed: cannot remove" });
});
