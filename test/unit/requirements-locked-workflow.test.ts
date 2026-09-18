import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardSnapshot } from "../../extensions/kanban-flow/board/repository.ts";
import type { ProducerResult } from "../../extensions/kanban-flow/board/result-schemas.ts";
import { renderBoard } from "../../extensions/kanban-flow/engine/render.ts";
import { normalizeRequirementsProposal } from "../../extensions/kanban-flow/requirements/proposal.ts";
import { allocateRequirementsProposal } from "../../extensions/kanban-flow/requirements/allocate.ts";
import { planRequirementsImpact } from "../../extensions/kanban-flow/requirements/impact.ts";
import { RequirementsWorkflow, buildRequirementsCandidate } from "../../extensions/kanban-flow/requirements/workflow.ts";

const base = "a".repeat(40); const history = "KFH-20260101T000000000Z-abcdefgh";
const config = { repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" }, lock: { ttl_seconds: 1800, heartbeat_seconds: 30 }, scheduler: { wip_limit: 1, priority_order: "ascending" }, rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 }, project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} }, agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] } } as any;
function snapshot(): BoardSnapshot { const dashboard = renderBoard([]); return { root: "/workspace/repo", board: { harness: "pi", board_schema_version: 1, last_writer_package_version: "1.0.0", project: { repository_id: "owner/repo" }, ids: { next_requirement: 1, next_card: 1, next_acceptance_criterion: 1, next_finding: 1 }, state: { last_reconciled_at: "2026-01-01T00:00:00Z", last_state_transaction: null }, migration: null }, config, cards: [], findingIds: [], requirements: undefined, dashboard, canonicalDashboard: dashboard, dashboardDrift: false }; }
function producer(dispatch: string): ProducerResult { return { schema_version: 1, dispatch_id: dispatch, card_id: "none", phase: "requirements", status: "completed", summary: "Create", artifacts: [], findings: [], questions: [], evidence: [], planned_paths: [], requirement_changes: [{ temporary_key: "new", action: "create", target_requirement: "none", title: "New", body: "New behavior.", acceptance: ["New works."], supersedes: [] }], card_changes: [{ temporary_key: "new-card", action: "create", target_card: "none", title: "New card", why: "Why.", notes: "", requirements: ["new"], acceptance_criteria: [{ text: "New works.", requirement: "new" }], dependencies: [], priority: 1 }] } as ProducerResult; }
function checked(input: any) { const payload = producer("KFRUN-20260101T000000000Z-abcdefgh"); const proposal = normalizeRequirementsProposal(payload, input.snapshot); const allocation = allocateRequirementsProposal(input.snapshot, proposal); const impact = planRequirementsImpact(input.snapshot, proposal, allocation, { at: input.plannedAt, operationId: input.operationId, transactionId: input.transactionId, historyIds: { "new-card": history } }); return { kind: "checked", proposal, allocation, impact, producer: payload, checker: { schema_version: 1, dispatch_id: "KFRUN-20260101T000000000Z-bcdefghj", card_id: "none", phase: "requirements", status: "pass", summary: "Pass", criteria: [], findings: [], evidence: [] }, artifacts: [{ path: "docs/cards/artifacts/requirements/requirements-producer-KFRUN-20260101T000000000Z-abcdefgh.yaml", bytes: "artifact\n", attestation: { run_id: "KFRUN-20260101T000000000Z-abcdefgh" } }], discovery: { active: [], ignored: [], unavailable: [] }, models: { producer: { provider: "p", id: "m", thinking: "medium", inherited: true }, checker: { provider: "p", id: "m", thinking: "medium", inherited: true } } } as any; }
function harness(options: { interactive?: boolean; decision?: "approve" | "revise" | "cancel" | undefined; dispatchKind?: "checked" | "revision"; heartbeatFailure?: boolean; releaseFailure?: boolean; staleApproval?: boolean; transactionFailure?: boolean } = {}) {
  const source = snapshot(); const calls: string[] = []; let heartbeatCount = 0; let transactionPlan: any; let setTransaction = "";
  const lock = { record: { expires_at: "2026-01-01T00:30:00Z", heartbeat_at: "2026-01-01T00:00:00Z" }, async heartbeat() { heartbeatCount++; calls.push("heartbeat"); if (options.heartbeatFailure && heartbeatCount >= 2) throw new Error("ownership lost"); return this.record; }, async setTransactionId(id: string) { setTransaction = id; calls.push("set-transaction"); return this.record; }, async release() { calls.push("release"); if (options.releaseFailure) throw new Error("cannot release"); } } as any;
  const dependencies: any = {
    acquireLock: async () => { calls.push("acquire"); return lock; }, preflight: async () => { calls.push("preflight"); return { kind: "ready", baseCommit: base, snapshot: source, managedState: {} }; },
    dispatch: { run: async (input: any) => { calls.push("dispatch"); return options.dispatchKind === "revision" ? { kind: "revision_required", stage: "producer", payload: { summary: "Revise" }, discovery: {}, models: {} } : checked(input); } },
    approvalAdapter: { request: async () => { calls.push("approval"); return options.decision ?? "approve"; } }, interactive: options.interactive ?? true, normalization: { roots: { "<REPOSITORY_ROOT>": "/workspace/repo" } },
    revalidate: async ({ bundle }: any) => { calls.push("revalidate"); return options.staleApproval ? { ...bundle, digest: `sha256:${"f".repeat(64)}` } : bundle; }, closeDesign: async () => { calls.push("close-design"); },
    transaction: { propose: async (plan: any) => { calls.push("transaction"); transactionPlan = plan; if (options.transactionFailure) throw new Error("push outcome unknown"); const context = { operationId: plan.operationId, transactionId: plan.transactionId, baseCommit: base, plannedAt: plan.plannedAt }; const candidate = await plan.mutation.apply(source, context); assert.ok(candidate.files["docs/spec.md"]); assert.ok(candidate.files["docs/cards/board.yaml"]); return { kind: "proposed", descriptor: candidate.snapshot.board.state.last_state_transaction, branch: `kanban/state/${plan.transactionId}`, commit: "b".repeat(40), pullRequest: { url: "https://github.com/owner/repo/pull/1" } }; } },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return { workflow: new RequirementsWorkflow(dependencies), calls, transactionPlan: () => transactionPlan, transactionId: () => setTransaction };
}
const input = { root: "/workspace/repo", repositoryId: "owner/repo", packageVersion: "1.2.3", brief: "Create behavior", parentModel: { provider: "p", id: "m", thinking: "medium" as const } };

test("approved checked proposal becomes exactly one pending human state PR", async () => {
  const value = harness(); const outcome = await value.workflow.run(input); assert.equal(outcome.status, "proposed"); assert.equal(outcome.statePrUrl, "https://github.com/owner/repo/pull/1"); assert.match(outcome.approvalDigest!, /^sha256:/); assert.deepEqual(outcome.affectedCards, ["CARD-0001"]); assert.equal(value.transactionId(), outcome.transactionId);
  assert.ok(value.calls.indexOf("approval") < value.calls.indexOf("close-design")); assert.ok(value.calls.indexOf("revalidate") < value.calls.indexOf("close-design")); assert.ok(value.calls.indexOf("set-transaction") < value.calls.indexOf("transaction")); assert.equal(value.calls.at(-1), "release");
});

test("revision, cancellation, and noninteractive preparation cause no transaction", async () => {
  const revision = harness({ dispatchKind: "revision" }); assert.equal((await revision.workflow.run(input)).status, "revision_required"); assert.ok(!revision.calls.includes("approval")); assert.ok(!revision.calls.includes("transaction"));
  const cancel = harness({ decision: "cancel" }); assert.equal((await cancel.workflow.run(input)).status, "cancelled"); assert.ok(!cancel.calls.includes("transaction"));
  const prepared = harness({ interactive: false }); const outcome = await prepared.workflow.run(input); assert.equal(outcome.status, "prepared_noninteractive"); assert.match(outcome.document!, /Requirements approval/); assert.ok(!prepared.calls.includes("approval")); assert.ok(!prepared.calls.includes("transaction"));
});

test("stale approval prevents actions and transaction failures require recovery", async () => {
  const stale = harness({ staleApproval: true }); const staleOutcome = await stale.workflow.run(input); assert.equal(staleOutcome.status, "stale"); assert.ok(!stale.calls.includes("close-design")); assert.ok(!stale.calls.includes("transaction"));
  const recovery = harness({ transactionFailure: true }); const recoveryOutcome = await recovery.workflow.run(input); assert.equal(recoveryOutcome.status, "failed_recovery_required"); assert.match(recoveryOutcome.issue!, /push outcome unknown/);
});

test("lock ownership and release failures prevent success", async () => {
  const lost = harness({ heartbeatFailure: true }); const failed = await lost.workflow.run(input); assert.equal(failed.status, "failed"); assert.equal(failed.issue, "lock_ownership_lost"); assert.ok(!lost.calls.includes("transaction")); assert.equal(lost.calls.at(-1), "release");
  const release = harness({ releaseFailure: true }); const releaseOutcome = await release.workflow.run(input); assert.equal(releaseOutcome.status, "failed"); assert.match(releaseOutcome.issue!, /lock_release_failed/);
});

test("candidate rendering binds complete files, counters, and transaction descriptor", () => {
  const source = snapshot(); const operationId = "KFOP-20260101T000000000Z-abcdefgh"; const transactionId = "KFTX-20260101T000000000Z-abcdefgh"; const dispatched = checked({ snapshot: source, operationId, transactionId, plannedAt: "2026-01-01T00:00:00Z" });
  const candidate = buildRequirementsCandidate({ authoritative: source, checked: dispatched, packageVersion: "1.2.3", context: { operationId, transactionId, baseCommit: base, plannedAt: "2026-01-01T00:00:00Z" } }); assert.deepEqual(candidate.snapshot.board.ids, { next_requirement: 2, next_card: 2, next_acceptance_criterion: 2, next_finding: 1 }); assert.deepEqual(candidate.snapshot.board.state.last_state_transaction?.paths, Object.keys(candidate.files).sort()); assert.equal(candidate.snapshot.board.last_writer_package_version, "1.2.3");
});
