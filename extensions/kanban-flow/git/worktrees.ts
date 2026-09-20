import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { GitAdapter, type WorktreeRecord } from "../state-pr/git.ts";
import { repositoryRelativePath, sortedUniquePaths } from "../engine/paths.ts";
import { serializeCommitTrailers, validateCommitTrailers, type CommitTrailers } from "../state-pr/markers.ts";
import { isObjectId } from "../engine/ids.ts";

export type ManagedWorktreeKind = "design" | "product";
export interface ManagedWorktreeIdentity { repositoryId: string; kind: ManagedWorktreeKind; cardId: string; branch: string; }
export interface ManagedWorktree { readonly path: string; readonly branch: string; readonly base: string; readonly kind: ManagedWorktreeKind; readonly cardId: string; }
export interface ExactCommitInput { worktree: ManagedWorktree; paths: ReadonlyMap<string, "create" | "modify" | "delete">; message: string; trailers: CommitTrailers; }

const CARD = /^CARD-[0-9]{4}$/;
const REPOSITORY = /^[a-z0-9._-]+\/[a-z0-9._-]+$/;
const SLUG = /^[a-z0-9-]{1,48}$/;
const HEX = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function assertSafeText(value: string, label: string): void {
  if (!value || value.includes("\0") || value.includes("\n") || value.includes("\r")) throw new Error(`${label} is invalid`);
}
export function canonicalSlug(title: string, fallback: string): string {
  assertSafeText(title, "title");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-").slice(0, 48).replace(/-+$/, "");
  return slug || fallback.toLowerCase();
}
export function managedBranch(kind: ManagedWorktreeKind, cardId: string, title: string): string {
  if (!CARD.test(cardId)) throw new Error("invalid card ID");
  const slug = canonicalSlug(title, cardId);
  if (!SLUG.test(slug)) throw new Error("invalid branch slug");
  return `kanban/${kind === "design" ? "design" : "card"}/${cardId}-${slug}`;
}

/** A stable logical resource name. The returned path is local-only and must never be persisted. */
export function managedWorktreePath(commonDirectory: string, identity: ManagedWorktreeIdentity): string {
  if (!REPOSITORY.test(identity.repositoryId) || !CARD.test(identity.cardId)) throw new Error("invalid worktree identity");
  assertSafeText(commonDirectory, "common directory");
  const expected = managedBranch(identity.kind, identity.cardId, identity.cardId);
  const prefix = `kanban/${identity.kind === "design" ? "design" : "card"}/${identity.cardId}-`;
  if (identity.branch !== expected && !identity.branch.startsWith(prefix)) throw new Error("branch does not match worktree identity");
  if (!new RegExp(`^${prefix}[a-z0-9]+(?:-[a-z0-9]+)*$`).test(identity.branch)) throw new Error("branch is not canonical");
  const encoded = identity.repositoryId.replace(/[^a-z0-9._-]+/g, "_");
  return resolve(commonDirectory, "kanban-flow", "worktrees", encoded, identity.kind, identity.cardId);
}

async function safeWorktreePath(path: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("managed worktree must be a regular directory");
  return realpath(path);
}
async function ensureNoSpecialFiles(root: string): Promise<void> {
  const entries = await (await import("node:fs/promises")).readdir(root, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error(`unsafe worktree entry: ${entry.name}`);
  }
}
function ensureInside(root: string, path: string): string {
  const normalized = resolve(root, path);
  const rel = relative(root, normalized);
  if (!rel || rel.startsWith("..") || rel.includes("..")) throw new Error("path escapes worktree");
  return normalized;
}

export class ManagedWorktreeManager {
  constructor(private readonly git: GitAdapter, private readonly root: string, private readonly repositoryId: string) {
    if (!REPOSITORY.test(repositoryId)) throw new Error("invalid repository identity");
  }
  async ensure(identity: ManagedWorktreeIdentity, base: string): Promise<ManagedWorktree> {
    if (!isObjectId(base) || identity.repositoryId !== this.repositoryId) throw new Error("invalid worktree base or repository identity");
    const branch = identity.branch;
    const common = await this.git.commonDirectory(this.root);
    const records = await this.git.worktrees(this.root);
    const matches = records.filter((record) => record.branch === branch);
    if (matches.length > 1) throw new Error("multiple managed worktrees for branch");
    if (matches.length === 1) {
      const record = matches[0]!;
      const path = await safeWorktreePath(record.path);
      if (resolve(path) !== resolve(managedWorktreePath(common, identity))) throw new Error("worktree path identity mismatch");
      if (record.detached || record.branch !== branch || !(await this.git.isAncestor(base, record.head, this.root))) throw new Error("worktree branch/base mismatch");
      await ensureNoSpecialFiles(path);
      if ((await this.git.workingDiffPaths(base, path)).length) throw new Error("managed worktree is dirty");
      return { path, branch, base, kind: identity.kind, cardId: identity.cardId };
    }
    const localBranch = await this.git.branchExists(branch, this.root);
    const remoteBranch = !localBranch && await this.git.remoteBranchExists(branch, "origin", this.root);
    const path = managedWorktreePath(common, identity);
    await mkdir(dirname(path), { recursive: true });
    if (localBranch) await this.git.require(["worktree", "add", path, branch], "worktree add", { cwd: this.root });
    else if (remoteBranch) await this.git.require(["worktree", "add", "-b", branch, path, `origin/${branch}`], "worktree add", { cwd: this.root });
    else await this.git.require(["worktree", "add", "-b", branch, path, base], "worktree add", { cwd: this.root });
    const actual = await safeWorktreePath(path);
    await ensureNoSpecialFiles(actual);
    const managed = { path: actual, branch, base, kind: identity.kind, cardId: identity.cardId } as ManagedWorktree;
    await this.validate(managed, base);
    return managed;
  }
  async validate(worktree: ManagedWorktree, expectedBase: string): Promise<void> {
    if (!isObjectId(expectedBase) || worktree.base !== expectedBase) throw new Error("unexpected worktree base");
    const common = await this.git.commonDirectory(worktree.path);
    const rootCommon = await this.git.commonDirectory(this.root);
    if (resolve(common) !== resolve(rootCommon)) throw new Error("worktree has a different common Git directory");
    const records = await this.git.worktrees(this.root);
    const matches = records.filter((record) => resolve(record.path) === resolve(worktree.path) && record.branch === worktree.branch);
    if (matches.length !== 1 || matches[0]!.detached) throw new Error("managed worktree is not uniquely linked");
    await safeWorktreePath(worktree.path); await ensureNoSpecialFiles(worktree.path);
    if ((await this.git.workingDiffPaths(expectedBase, worktree.path)).length) throw new Error("managed worktree is dirty");
  }
  async commitExact(input: ExactCommitInput): Promise<string> {
    validateCommitTrailers(input.trailers);
    if (input.trailers.kind !== (input.worktree.kind === "design" ? "design" : "product") || input.trailers.card_ids[0] !== input.worktree.cardId) throw new Error("commit trailer does not match worktree");
    const planned = new Map<string, string>();
    for (const [path, action] of input.paths) { repositoryRelativePath(path); planned.set(path, action); }
    if (planned.size === 0) throw new Error("exact commit requires paths");
    const common = await this.git.commonDirectory(input.worktree.path);
    const rootCommon = await this.git.commonDirectory(this.root);
    if (resolve(common) !== resolve(rootCommon)) throw new Error("worktree has a different common Git directory");
    const records = await this.git.worktrees(this.root);
    if (records.filter((record) => resolve(record.path) === resolve(input.worktree.path) && record.branch === input.worktree.branch).length !== 1) throw new Error("managed worktree is not uniquely linked");
    await safeWorktreePath(input.worktree.path); await ensureNoSpecialFiles(input.worktree.path);
    for (const path of planned.keys()) {
      const absolute = ensureInside(input.worktree.path, path);
      const stat = await lstat(absolute).catch(() => undefined);
      if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error(`unsafe staged path: ${path}`);
    }
    const actual = await this.git.workingDiffPaths(input.worktree.base, input.worktree.path);
    if (actual.length !== planned.size || actual.some((path) => !planned.has(path))) throw new Error("worktree diff is not the approved exact path set");
    await this.git.stageExact([...planned.keys()], input.worktree.path);
    const staged = await this.git.stagedNameOnly(input.worktree.path);
    if (staged.length !== planned.size || staged.some((path) => !planned.has(path))) throw new Error("staged path set is not exact");
    const commit = await this.git.commit(input.message, serializeCommitTrailers(input.trailers).split("\n"), input.worktree.path);
    if (!isObjectId(commit)) throw new Error("git returned an invalid commit ID");
    return commit;
  }
  async cleanup(worktree: ManagedWorktree, authority: "merged" | "closed" | "abandoned"): Promise<void> {
    if (!authority) throw new Error("cleanup requires authoritative disposition");
    const records = await this.git.worktrees(this.root);
    const matches = records.filter((record) => resolve(record.path) === resolve(worktree.path) && record.branch === worktree.branch);
    if (matches.length > 1) throw new Error("ambiguous worktree cleanup");
    if (matches.length === 1) await this.git.removeBranchWorktree(worktree.path, this.root);
    if (authority === "abandoned") await this.git.run(["branch", "-D", worktree.branch], { cwd: this.root });
  }
}