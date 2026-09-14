import assert from "node:assert/strict";
import { test } from "node:test";
import { StateTransactionCoordinator, type StateTransactionGit, type StateTransactionRepository } from "../../extensions/kanban-flow/state-pr/transaction.ts";
import type { GitHubAdapter, GitHubPullRequest } from "../../extensions/kanban-flow/state-pr/github.ts";
import type { BoardSnapshot } from "../../extensions/kanban-flow/board/repository.ts";

const oid = "a".repeat(40);
const snapshot = { root: "/repo", board: {}, config: {}, cards: [], requirements: undefined, dashboard: undefined, canonicalDashboard: "", dashboardDrift: false } as unknown as BoardSnapshot;

class FakeGit implements StateTransactionGit {
  readonly calls: string[] = [];
  base = oid;
  async fetch(): Promise<void> { this.calls.push("fetch"); }
  async resolveRef(): Promise<string> { this.calls.push("resolve"); return this.base; }
  async createWorktree(input: { branch: string; base: string }): Promise<{ path: string; branch: string }> { this.calls.push("worktree"); return { path: "/tmp/state", branch: input.branch }; }
  async diffPaths(): Promise<readonly string[]> { return ["docs/cards/board.yaml"]; }
  async stageExact(): Promise<void> { this.calls.push("stage"); }
  async stagedPaths(): Promise<readonly string[]> { return ["docs/cards/board.yaml"]; }
  async commitState(): Promise<string> { this.calls.push("commit"); return "b".repeat(40); }
  async push(): Promise<void> { this.calls.push("push"); }
}

class FakeGitHub implements GitHubAdapter {
  prs: GitHubPullRequest[] = [];
  creates = 0;
  async listPullRequests(): Promise<readonly GitHubPullRequest[]> { return this.prs; }
  async createPullRequest(input: { title: string; body: string; head: string; base: string }): Promise<GitHubPullRequest> {
    this.creates += 1;
    const marker = input.body.match(/<!-- kanban-flow:(\{[\s\S]*?\}) -->/)![1];
    const transaction = JSON.parse(marker).transaction_id as string;
    const pr: GitHubPullRequest = { number: 7, url: "https://github.com/owner/repo/pull/7", title: input.title, body: input.body, head: input.head, base: input.base, state: "open", head_commit: "b".repeat(40), merge_commit: null };
    assert.equal(transaction, input.head.slice("kanban/state/".length));
    this.prs.push(pr);
    return pr;
  }
  async addComment(): Promise<never> { throw new Error("not used"); }
  async closePullRequest(): Promise<void> { throw new Error("not used"); }
  async reopenPullRequest(): Promise<void> { throw new Error("not used"); }
  async getComments(): Promise<never> { throw new Error("not used"); }
}

function repository(): StateTransactionRepository {
  return {
    async read(): Promise<BoardSnapshot> { return snapshot; },
    validate(): void {},
    async writeRendered(): Promise<void> {},
  };
}

function mutation() {
  return { cardIds: ["CARD-0001"], apply: async () => ({ snapshot, files: { "docs/cards/board.yaml": "harness: pi\n" } }) };
}

test("proposes one exact state PR from the authoritative base", async () => {
  const git = new FakeGit();
  const github = new FakeGitHub();
  const coordinator = new StateTransactionCoordinator(repository(), git, github, () => new Date("2026-01-15T10:30:00.000Z"));
  const result = await coordinator.propose({ root: "/repo", repositoryId: "owner/repo", packageVersion: "0.0.0-dev", operationId: "KFOP-20260115T103000000Z-abcdefgh", mutation: mutation() });
  assert.equal(result.kind, "proposed");
  assert.equal(github.creates, 1);
  assert.deepEqual(git.calls, ["fetch", "resolve", "resolve", "worktree", "stage", "commit", "resolve", "push", "resolve"]);
});

test("retries by reusing the uniquely marked pending state PR", async () => {
  const git = new FakeGit();
  const github = new FakeGitHub();
  const coordinator = new StateTransactionCoordinator(repository(), git, github, () => new Date("2026-01-15T10:30:00.000Z"));
  await coordinator.propose({ root: "/repo", repositoryId: "owner/repo", packageVersion: "0.0.0-dev", operationId: "KFOP-20260115T103000000Z-abcdefgh", mutation: mutation() });
  const retry = await coordinator.propose({ root: "/repo", repositoryId: "owner/repo", packageVersion: "0.0.0-dev", operationId: "KFOP-20260115T103000000Z-abcdefgh", mutation: mutation() });
  assert.equal(retry.kind, "pending");
  assert.equal(github.creates, 1);
});
