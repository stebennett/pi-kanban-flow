import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitAdapter } from "../../extensions/kanban-flow/state-pr/git.ts";
import { createStateTransactionGit } from "../../extensions/kanban-flow/state-pr/transaction.ts";
import type { GitHubAdapter, GitHubPullRequest } from "../../extensions/kanban-flow/state-pr/github.ts";
import { InitializationCoordinator, createInitializationRepository } from "../../extensions/kanban-flow/requirements/initialize.ts";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec("git", args, { cwd })).stdout.trim(); }
class Github implements GitHubAdapter {
  created: GitHubPullRequest[] = []; constructor(private commit: () => string) {}
  async listPullRequests() { return this.created; }
  async createPullRequest(input: any) { const pr = { number: 1, url: "https://github.com/owner/repo/pull/1", ...input, state: "open", head_commit: this.commit(), merge_commit: null } as GitHubPullRequest; this.created.push(pr); return pr; }
  async addComment(): Promise<never> { throw new Error("unused"); } async closePullRequest(): Promise<void> { throw new Error("unused"); } async reopenPullRequest(): Promise<void> { throw new Error("unused"); } async getComments(): Promise<never[]> { return []; }
}

test("real Git initialization creates only the deterministic control-plane state PR", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-init-real-")); const bare = await mkdtemp(join(tmpdir(), "kanban-init-remote-"));
  try {
    await git(root, "init", "-b", "main"); await git(root, "config", "user.email", "test@example.invalid"); await git(root, "config", "user.name", "Kanban Test");
    await writeFile(join(root, "README.md"), "# Empty repository\n"); await git(root, "add", "README.md"); await git(root, "commit", "-m", "initial");
    await git(bare, "init", "--bare"); await git(root, "remote", "add", "origin", bare); await git(root, "push", "origin", "main");
    const adapter = new GitAdapter({ cwd: root }); const transactionGit = createStateTransactionGit(adapter); let committed = "a".repeat(40); const github = new Github(() => committed);
    const coordinator = new InitializationCoordinator(createInitializationRepository(adapter), { ...transactionGit, async commitState(input) { committed = await transactionGit.commitState(input); return committed; } }, github, async () => ({ root, commonDirectory: join(root, ".git"), repositoryId: "owner/repo", originUrl: "https://github.com/owner/repo", githubUrl: "https://github.com/owner/repo" }), () => new Date("2026-01-01T00:00:00Z"));
    const result = await coordinator.propose({ root, packageVersion: "1.2.3", operationId: "KFOP-20260101T000000000Z-abcdefgh" }); assert.equal(result.kind, "proposed");
    const paths = (await git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", github.created[0].head)).split("\n").sort(); assert.deepEqual(paths, ["docs/cards/BOARD.md", "docs/cards/board.yaml", "docs/cards/config.yaml"]);
    assert.match(await git(root, "show", `${github.created[0].head}:docs/cards/board.yaml`), /repository_id: owner\/repo/); await assert.rejects(exec("git", ["show", `${github.created[0].head}:docs/spec.md`], { cwd: root }));
    assert.equal(await git(root, "rev-parse", "main"), await git(root, "rev-parse", "origin/main"));
  } finally { await rm(root, { recursive: true, force: true }); await rm(bare, { recursive: true, force: true }); }
});
