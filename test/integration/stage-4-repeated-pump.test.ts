import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { test } from "node:test";
import { runKanbanPump } from "../../extensions/kanban-flow/tools/kanban-pump.ts";
import type { GitHubAdapter, GitHubPullRequest } from "../../extensions/kanban-flow/state-pr/github.ts";
import { parsePullRequestMarker } from "../../extensions/kanban-flow/state-pr/markers.ts";
import { GitAdapter } from "../../extensions/kanban-flow/state-pr/git.ts";
import { type AgentDefinition } from "../../extensions/kanban-flow/agents/definitions.ts";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) { return (await exec("git", args, { cwd })).stdout.trim(); }
const oid = "a".repeat(40);
const board = { harness: "pi", board_schema_version: 1, last_writer_package_version: "0.0.0", project: { repository_id: "owner/repo" }, ids: { next_requirement: 2, next_card: 2, next_acceptance_criterion: 2, next_finding: 1 }, state: { last_reconciled_at: "2026-01-01T00:00:00Z", last_state_transaction: null }, migration: null };
const config = { repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" }, lock: { ttl_seconds: 1800, heartbeat_seconds: 30 }, scheduler: { wip_limit: 1, priority_order: "ascending" }, rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 }, project_commands: { test: ["true"] }, agent_models: { default: "inherit", overrides: {} }, agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] } };
const card = { id: "CARD-0001", title: "A card", status: "backlog", requirements: ["REQ-0001"], grandfathered_requirements: [], acceptance_criteria: [{ id: "AC-0001", text: "A result", requirement: "REQ-0001" }], dependencies: [], replaces: [], replaced_by: [], replacement_reason: null, priority: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", started_at: null, delivered_at: null, blocked: null, workflow: { design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null }, split_decision: { result_path: null, decided_at: null, override: null }, implementation: { branch: null, result_paths: [], head_commit: null }, review: { result_paths: [], reviewed_commit: null, completed_at: null }, ship: { product_pr: null, verification_result_paths: [], merged_commit: null } }, rework: { design: 0, implementation: 0 }, history: [] };

class FakeGithub implements GitHubAdapter {
  readonly prs: GitHubPullRequest[] = []; private next = 1; private checksPassed = false; constructor(private readonly root: string) {}
  async listPullRequests() {
    // The provider query used by the transaction coordinator returns the current
    // marked state authority; older merged state PRs remain in Git history.
    return this.prs.filter((pr) => parsePullRequestMarker(pr.body).kind !== "state" || pr.state !== "merged");
  }
  async createPullRequest(input: { title: string; body: string; head: string; base: string }) { const head_commit = await git(this.root, "rev-parse", `refs/remotes/origin/${input.head}`); const pr = { number: this.next++, url: `https://github.com/owner/repo/pull/${this.next - 1}`, ...input, state: "open" as const, head_commit, merge_commit: null }; this.prs.push(pr); return pr; }
  async addComment(_number: number, _body: string): Promise<never> { throw new Error("unused"); } async closePullRequest(_number: number): Promise<void> { throw new Error("unused"); } async reopenPullRequest(_number: number): Promise<void> { throw new Error("unused"); } async getComments() { return []; }
  async getChecks() { return [{ name: "required-ci", status: this.checksPassed ? "completed" : "in_progress", conclusion: this.checksPassed ? "success" : "queued", required: true, code_evidence: true }]; }
  passChecks() { this.checksPassed = true; }
  merge(number: number, mergeCommit: string) { const index = this.prs.findIndex((pr) => pr.number === number); assert.notEqual(index, -1); this.prs[index] = { ...this.prs[index]!, state: "merged", merge_commit: mergeCommit }; }
}
function definitions(): any { const names = ["design-producer", "design-checker", "split-decider", "implementer", "reviewer", "ship-producer", "ship-checker"]; const agents = new Map(); for (const name of names) agents.set(name, { name, description: name, body: "test agent", source: "package", path: `agents/${name}.md`, sha256: "b".repeat(64) }); return { agents, report: { active: [], ignored: [], unavailable: [] }, repositoryRoot: "", dispatchCwd: "", persistedTrust: true }; }

/** Repeated-pump acceptance: all board authority is a real state PR, while design
 * evidence uses a real worktree/commit and is never allowed to mutate main. */
test("stage 4 design pump survives state merge and reconciles merged design", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-stage4-")); const bare = await mkdtemp(join(tmpdir(), "kanban-stage4-origin-"));
  try {
    await git(root, "init", "-b", "main"); await git(root, "config", "user.email", "test@example.invalid"); await git(root, "config", "user.name", "Kanban Test"); await mkdir(join(root, "docs", "cards"), { recursive: true });
    await writeFile(join(root, "README.md"), "immutable\n"); await writeFile(join(root, "docs/cards/board.yaml"), stringify(board)); await writeFile(join(root, "docs/cards/config.yaml"), stringify(config)); await writeFile(join(root, "docs/cards/CARD-0001.md"), `---\n${stringify(card)}---\n# CARD-0001: A card\n\n## Why\n\nBecause.\n\n## Notes\n\nNotes.\n`); await writeFile(join(root, "docs/cards/BOARD.md"), "# Board\n");
    await git(root, "add", "."); await git(root, "commit", "-m", "base"); await git(bare, "init", "--bare"); await git(root, "remote", "add", "origin", bare); await git(root, "push", "origin", "main");
    const github = new FakeGithub(root); const adapter = new GitAdapter({ cwd: root }); const trustReader = { getEntry: () => ({ path: root, decision: true }) };
    const snapshotCanary = JSON.stringify(card); let producerCalls = 0;
    let reviewRuns = 0;
    const result = async (plan: any, expectation: any) => {
      const id = expectation.dispatchId; const name = plan.agent.name; const phase = expectation.phase;
      const design = `# CARD-0001: A card\n\n## Context\ncontext\n\n## Scope\n### In scope\nresult\n### Out of scope\nnone\n\n## Acceptance mapping\nAC-0001\n\n## Interfaces and data flow\nflow\n\n## Implementation tasks\nTASK-RESULT\n\n## Test-first plan\ntest\n\n## Objective verification\nverify\n\n## Alternatives\nnone\n\n## Decisions\ndecide\n\n## Risks and compatibility\nrisk\n\n## Planned paths\n- src/result.txt | create | TASK-RESULT\n`;
      let payload: any;
      if (name === "design-producer") payload = { schema_version: 1, dispatch_id: id, card_id: "CARD-0001", phase: "design", status: "completed", summary: "design", artifacts: [{ type: "design_document", content: design.trimEnd() }], findings: [], questions: [], evidence: [], requirement_changes: [], card_changes: [], planned_paths: [{ path: "src/result.txt", action: "create" }] };
      else if (name === "split-decider") payload = { schema_version: 1, dispatch_id: id, card_id: "CARD-0001", status: "no_split", rationale: "The card is a single vertical slice.", replacement_cards: [], evidence: [{ kind: "file", reference: "AC-0001", summary: "verified" }] };
      else if (name === "reviewer") { reviewRuns++; const evidence = { kind: "file", reference: "src/result.txt", summary: "reviewed" }; payload = { schema_version: 1, dispatch_id: id, card_id: "CARD-0001", phase: "implementation_review", lens: expectation.lens, status: reviewRuns === 1 ? "changes_requested" : "pass", summary: reviewRuns === 1 ? "Fix required" : "pass", findings: reviewRuns === 1 ? [{ criterion: "AC-0001", severity: "blocking", location: "src/result.txt", summary: "Rework required", detail: "The first implementation needs one bounded correction.", suggested_fix: "Rewrite the approved path.", evidence: [evidence] }] : [], evidence: [evidence], rerun_recommended: reviewRuns === 1 }; }
      else if (name === "implementer") { await writeFile(join(plan.cwd, "src/result.txt"), reviewRuns === 0 ? "initial\n" : "reworked\n"); payload = { schema_version: 1, dispatch_id: id, card_id: "CARD-0001", phase: "implementation", status: "completed", summary: "implementation", artifacts: [{ type: "implementation_summary", content: "Implemented the planned result." }], findings: [], questions: [], evidence: [], requirement_changes: [], card_changes: [], planned_paths: [] }; }
      else if (name === "ship-producer") payload = { schema_version: 1, dispatch_id: id, card_id: "CARD-0001", phase: "ship", status: "completed", summary: "ship", artifacts: [{ type: "product_pr_body", content: "Product change is ready for human merge." }], findings: [], questions: [], evidence: [], requirement_changes: [], card_changes: [], planned_paths: [] };
      else payload = { schema_version: 1, dispatch_id: id, card_id: "CARD-0001", phase: phase === "ship" ? "ship" : "design", status: "pass", summary: "pass", criteria: (expectation.criteria ?? []).map((key: string) => ({ key, verdict: "pass", evidence: [{ kind: "file", reference: "design", summary: "verified" }] })), findings: [], evidence: [{ kind: "file", reference: "design", summary: "verified" }] };
      return { runtime: { dispatch_id: id, role: ["design-producer", "implementer", "ship-producer"].includes(name) ? "producer" : name === "reviewer" ? "reviewer" : "checker", provider: "test", model: "model", thinking: "off", payload, usage: {}, stopReason: "toolUse" }, exitCode: 0, stderr: "", startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    };
    const common: any = { parentModel: { provider: "test", id: "model", thinking: "off" }, modelResolver: { resolve: async () => ({ provider: "test", id: "model", authenticated: true, supportsTools: true }) }, trustReader, repositoryId: "owner/repo", git: adapter, github, discover: async () => definitions(), createPlan: async (o: any) => ({ ...o, dispatchId: o.dispatchId, redactedArgv: [], argv: [], environment: {}, promptPath: "", taskEnvelope: "", executable: "fake", cleanup: async () => {} }), execute: async (plan: any, expectation: any) => { if (plan.agent.name === "design-producer") { producerCalls++; assert.equal(JSON.stringify(card), snapshotCanary); } return result(plan, expectation); } };
    const mergeState = async () => { const state = github.prs.find((pr) => parsePullRequestMarker(pr.body).kind === "state" && pr.state === "open"); assert.ok(state, "one open state PR is required"); await git(root, "fetch", "origin"); await git(root, "merge", "--ff-only", state.head); await git(root, "push", "origin", "main"); github.merge(state.number, await git(root, "rev-parse", "main")); };
    const mergeExternal = async (kind: "design" | "product") => { const pr = github.prs.find((candidate) => candidate.state === "open" && parsePullRequestMarker(candidate.body).kind === kind); assert.ok(pr, `one open ${kind} PR is required`); await git(root, "fetch", "origin"); await git(root, "merge", "--no-ff", "--no-edit", pr.head); await git(root, "push", "origin", "main"); github.merge(pr.number, await git(root, "rev-parse", "main")); };
    const pump = async () => { const report = await runKanbanPump(root, "0.0.0", { schema_version: 1, requested_phase: "none" }, undefined, common); if (report.status === "proposed") await mergeState(); return report; };
    let report = await pump(); assert.equal(report.status, "proposed"); assert.equal(producerCalls, 1);
    await pump(); await mergeExternal("design"); report = await pump(); assert.ok(["proposed", "pending"].includes(report.status), JSON.stringify(report));
    await pump(); await pump(); await pump();
    report = await pump(); assert.ok(["proposed", "pending"].includes(report.status), JSON.stringify(report));
    await pump(); await pump();
    report = await pump(); assert.ok(["waiting", "pending"].includes(report.status), JSON.stringify(report));
    const statePrCount = github.prs.filter((pr) => parsePullRequestMarker(pr.body).kind === "state").length;
    report = await pump(); assert.ok(["waiting", "pending"].includes(report.status), JSON.stringify(report));
    assert.equal(github.prs.filter((pr) => parsePullRequestMarker(pr.body).kind === "state").length, statePrCount, "pending CI must not churn state PRs");
    github.passChecks(); report = await pump(); assert.equal(report.status, "proposed", JSON.stringify(report));
    await mergeExternal("product"); report = await pump(); assert.ok(["proposed", "pending"].includes(report.status), JSON.stringify(report));
    const final = await pump(); assert.equal(final.status, "no_action", JSON.stringify(final)); assert.equal(reviewRuns, 2); assert.equal(await git(root, "rev-parse", "main"), await git(root, "rev-parse", "origin/main"));
  } finally { await rm(root, { recursive: true, force: true }); await rm(bare, { recursive: true, force: true }); }
});
