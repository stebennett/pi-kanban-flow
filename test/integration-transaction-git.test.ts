import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { GitAdapter } from "../extensions/kanban-flow/state-pr/git.ts";
import { type GitHubAdapter, type GitHubPullRequest } from "../extensions/kanban-flow/state-pr/github.ts";
import { createStateTransactionGit, createStateTransactionRepository, StateTransactionCoordinator, type StateMutationContext } from "../extensions/kanban-flow/state-pr/transaction.ts";
import type { BoardSnapshot } from "../extensions/kanban-flow/board/repository.ts";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec("git", args, { cwd })).stdout.trim(); }

const board = {
  harness: "pi", board_schema_version: 1, last_writer_package_version: "0.0.0-dev", project: { repository_id: "owner/repo" },
  ids: { next_requirement: 2, next_card: 2, next_acceptance_criterion: 2, next_finding: 1 },
  state: { last_reconciled_at: "2026-01-15T10:30:00Z", last_state_transaction: null }, migration: null,
};
const config = {
  repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" }, lock: { ttl_seconds: 1800, heartbeat_seconds: 30 },
  scheduler: { wip_limit: 1, priority_order: "ascending" }, rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 },
  project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} }, agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] },
};
const card = {
  id: "CARD-0001", title: "Example card", status: "backlog", requirements: ["REQ-0001"], grandfathered_requirements: [], acceptance_criteria: [{ id: "AC-0001", text: "An observable result", requirement: "REQ-0001" }], dependencies: [], replaces: [], replaced_by: [], replacement_reason: null, priority: 1,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", started_at: null, delivered_at: null, blocked: null,
  workflow: { design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null }, split_decision: { result_path: null, decided_at: null, override: null }, implementation: { branch: null, result_paths: [], head_commit: null }, review: { result_paths: [], reviewed_commit: null, completed_at: null }, ship: { product_pr: null, verification_result_paths: [], merged_commit: null } },
  rework: { design: 0, implementation: 0 }, history: [],
};

class FakeGithub implements GitHubAdapter {
  readonly created: GitHubPullRequest[] = [];
  constructor(private readonly commit: () => string) {}
  listPullRequests(): Promise<readonly GitHubPullRequest[]> { return Promise.resolve(this.created); }
  createPullRequest(input: { title: string; body: string; head: string; base: string }): Promise<GitHubPullRequest> {
    const pullRequest: GitHubPullRequest = { number: 1, url: "https://github.com/owner/repo/pull/1", ...input, state: "open", head_commit: this.commit(), merge_commit: null };
    this.created.push(pullRequest);
    return Promise.resolve(pullRequest);
  }
  addComment(): never { throw new Error("not used"); }
  closePullRequest(): Promise<void> { throw new Error("not used"); }
  reopenPullRequest(): Promise<void> { throw new Error("not used"); }
  getComments(): Promise<never[]> { return Promise.resolve([]); }
}

test("real Git adapter creates one marked state transaction from origin/main", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-kanban-flow-tx-"));
  const bare = await mkdtemp(join(tmpdir(), "pi-kanban-flow-remote-"));
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "config", "user.name", "Kanban Test");
    await mkdir(join(root, "docs", "cards"), { recursive: true });
    await writeFile(join(root, "docs", "cards", "board.yaml"), stringify(board));
    await writeFile(join(root, "docs", "cards", "config.yaml"), stringify(config));
    await writeFile(join(root, "docs", "cards", "CARD-0001.md"), `---\n${stringify(card)}---\n# CARD-0001: Example card\n\n## Why\n\nBecause.\n\n## Notes\n\nNotes.\n`);
    await git(root, "add", "--", "docs");
    await git(root, "commit", "-m", "initial board");
    await git(bare, "init", "--bare");
    await git(root, "remote", "add", "origin", bare);
    await git(root, "push", "origin", "main");

    const adapter = new GitAdapter({ cwd: root });
    const transactionGit = createStateTransactionGit(adapter);
    let commit = "a".repeat(40);
    const github = new FakeGithub(() => commit);
    const coordinator = new StateTransactionCoordinator(createStateTransactionRepository(), {
      ...transactionGit,
      async commitState(input) { commit = await transactionGit.commitState(input); return commit; },
    }, github, () => new Date("2026-01-15T10:30:00.000Z"));
    const result = await coordinator.propose({
      root, repositoryId: "owner/repo", packageVersion: "0.0.0-dev",
      mutation: { cardIds: [], apply(snapshot: BoardSnapshot, _context: StateMutationContext) { return { snapshot, files: { "docs/cards/BOARD.md": snapshot.canonicalDashboard } }; } },
    } as never);
    assert.equal(result.kind, "proposed");
    assert.equal(github.created.length, 1);
    assert.equal(github.created[0]?.head, `kanban/state/${result.kind === "proposed" ? result.descriptor.id : ""}`);
    const message = await git(root, "show", "-s", "--format=%B", github.created[0]!.head);
    assert.match(message, /Kanban-Flow-Kind: state/);
    assert.match(message, /Kanban-Flow-Transaction:/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
  }
});
