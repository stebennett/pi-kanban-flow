import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { GitAdapter } from "../../extensions/kanban-flow/state-pr/git.ts";
import { ManagedWorktreeManager, managedBranch } from "../../extensions/kanban-flow/git/worktrees.ts";
import { serializeCommitTrailers } from "../../extensions/kanban-flow/state-pr/markers.ts";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<string> { return (await exec("git", args, { cwd })).stdout.trim(); }

test("managed design and product worktrees are deterministic and exact-path commits", async () => {
  const root = await mkdtemp(join("/tmp", "pi-kanban-managed-")); const remote = await mkdtemp(join("/tmp", "pi-kanban-remote-"));
  try {
    await git(root, "init", "-b", "main"); await git(root, "config", "user.email", "test@example.invalid"); await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "README.md"), "base\n"); await git(root, "add", "README.md"); await git(root, "commit", "-m", "base");
    await git(remote, "init", "--bare"); await git(root, "remote", "add", "origin", remote); await git(root, "push", "origin", "main");
    const base = await git(root, "rev-parse", "HEAD"); const adapter = new GitAdapter({ cwd: root });
    const manager = new ManagedWorktreeManager(adapter, root, "owner/repo");
    const branch = managedBranch("design", "CARD-0001", "A useful design");
    const first = await manager.ensure({ repositoryId: "owner/repo", kind: "design", cardId: "CARD-0001", branch }, base);
    const second = await manager.ensure({ repositoryId: "owner/repo", kind: "design", cardId: "CARD-0001", branch }, base);
    assert.equal(first.path, second.path); assert.equal(first.branch, branch);
    await writeFile(join(first.path, "design.md"), "design\n");
    const commit = await manager.commitExact({ worktree: first, paths: new Map([["design.md", "create"]]), message: "kanban: design CARD-0001", trailers: { kind: "design", operation_id: "KFOP-20260101T000000000Z-abcdefgh", card_ids: ["CARD-0001"], transaction_id: null } });
    assert.equal(await git(first.path, "show", "-s", "--format=%H", commit), commit);
    assert.match(await git(first.path, "show", "-s", "--format=%B", commit), /Kanban-Flow-Kind: design/);
    await manager.cleanup(first, "abandoned");
  } finally { await rm(root, { recursive: true, force: true }); await rm(remote, { recursive: true, force: true }); }
});

test("managed worktrees reject traversal and symlink paths", async () => {
  const root = await mkdtemp(join("/tmp", "pi-kanban-managed-")); const remote = await mkdtemp(join("/tmp", "pi-kanban-remote-"));
  try {
    await git(root, "init", "-b", "main"); await git(root, "config", "user.email", "test@example.invalid"); await git(root, "config", "user.name", "Test");
    await writeFile(join(root, "README.md"), "base\n"); await git(root, "add", "README.md"); await git(root, "commit", "-m", "base");
    await git(remote, "init", "--bare"); await git(root, "remote", "add", "origin", remote); await git(root, "push", "origin", "main");
    const base = await git(root, "rev-parse", "HEAD"); const manager = new ManagedWorktreeManager(new GitAdapter({ cwd: root }), root, "owner/repo");
    const branch = managedBranch("product", "CARD-0001", "Product"); const worktree = await manager.ensure({ repositoryId: "owner/repo", kind: "product", cardId: "CARD-0001", branch }, base);
    await symlink(join(root, "README.md"), join(worktree.path, "link.txt"));
    await assert.rejects(manager.commitExact({ worktree, paths: new Map([["../escape", "create"]]), message: "kanban: product CARD-0001", trailers: { kind: "product", operation_id: "KFOP-20260101T000000000Z-abcdefgh", card_ids: ["CARD-0001"], transaction_id: null } }), /invalid repository-relative/);
    await assert.rejects(manager.commitExact({ worktree, paths: new Map([["link.txt", "create"]]), message: "kanban: product CARD-0001", trailers: { kind: "product", operation_id: "KFOP-20260101T000000000Z-abcdefgh", card_ids: ["CARD-0001"], transaction_id: null } }), /unsafe/);
    await manager.cleanup(worktree, "abandoned");
  } finally { await rm(root, { recursive: true, force: true }); await rm(remote, { recursive: true, force: true }); }
});
