import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRelativePath, sortedUniquePaths } from "../engine/paths.ts";
import { DirectProcessRunner, type ProcessOptions, type ProcessResult, type ProcessRunner } from "./process.ts";

export interface GitCommandResult extends ProcessResult {}
export interface GitAdapterOptions { runner?: ProcessRunner; executable?: string; cwd?: string }

function assertSuccess(result: ProcessResult, operation: string): ProcessResult {
  if (result.code !== 0) throw new Error(`git ${operation} failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`);
  return result;
}
function arg(value: string, label = "git argument"): string {
  if (!value || value.includes("\0") || value.includes("\n") || value.includes("\r")) throw new Error(`${label} is invalid`);
  return value;
}

export class GitAdapter {
  readonly runner: ProcessRunner;
  readonly executable: string;
  readonly defaultCwd?: string;
  constructor(options: GitAdapterOptions = {}) {
    this.runner = options.runner ?? new DirectProcessRunner();
    this.executable = options.executable ?? "git";
    this.defaultCwd = options.cwd;
  }

  run(args: readonly string[], options: ProcessOptions = {}): Promise<GitCommandResult> {
    return this.runner.run(this.executable, args.map((value) => arg(value)), { cwd: options.cwd ?? this.defaultCwd, ...options });
  }
  async require(args: readonly string[], operation = args[0] ?? "command", options?: ProcessOptions): Promise<GitCommandResult> {
    return assertSuccess(await this.run(args, options), operation);
  }
  async commonDirectory(cwd = this.defaultCwd): Promise<string> {
    const result = await this.require(["rev-parse", "--path-format=absolute", "--git-common-dir"], "rev-parse", { cwd });
    return result.stdout.trim();
  }
  async repositoryRoot(cwd = this.defaultCwd): Promise<string> {
    const result = await this.require(["rev-parse", "--show-toplevel"], "rev-parse", { cwd });
    return result.stdout.trim();
  }
  async resolveRef(ref: string, cwd = this.defaultCwd): Promise<string> {
    const result = await this.require(["rev-parse", "--verify", ref], "rev-parse", { cwd });
    return result.stdout.trim();
  }
  async fetch(remote = "origin", cwd = this.defaultCwd): Promise<void> {
    await this.require(["fetch", "--prune", arg(remote, "remote")], "fetch", { cwd });
  }
  async branchExists(branch: string, cwd = this.defaultCwd): Promise<boolean> {
    const result = await this.run(["show-ref", "--verify", "--quiet", `refs/heads/${arg(branch, "branch")}`], { cwd });
    return result.code === 0;
  }
  async remoteBranchExists(branch: string, remote = "origin", cwd = this.defaultCwd): Promise<boolean> {
    const result = await this.run(["show-ref", "--verify", "--quiet", `refs/remotes/${arg(remote, "remote")}/${arg(branch, "branch")}`], { cwd });
    return result.code === 0;
  }
  async worktrees(cwd = this.defaultCwd): Promise<WorktreeRecord[]> {
    const result = await this.require(["worktree", "list", "--porcelain"], "worktree list", { cwd });
    return parseWorktreeList(result.stdout);
  }
  async diffNameOnly(base: string, head: string, cwd = this.defaultCwd): Promise<string[]> {
    const result = await this.require(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${arg(base, "base")}..${arg(head, "head")}`], "diff", { cwd });
    return sortedUniquePaths(result.stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean));
  }
  async diffNameStatus(base: string, head: string, cwd = this.defaultCwd): Promise<readonly { path: string; action: "create" | "modify" | "delete" }[]> {
    const result = await this.require(["diff", "--name-status", "--find-renames", `${arg(base, "base")}..${arg(head, "head")}`], "diff", { cwd });
    const entries: { path: string; action: "create" | "modify" | "delete" }[] = [];
    for (const line of result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      const [status, ...values] = line.split(/\s+/);
      const path = status?.startsWith("R") || status?.startsWith("C") ? values[1] ?? values[0] : values[0];
      if (!status || !path) throw new Error("malformed git name-status output");
      const action = status.startsWith("A") || status.startsWith("C") ? "create" : status.startsWith("D") ? "delete" : "modify";
      entries.push({ path: repositoryRelativePath(path), action });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }
  async diffStat(cwd = this.defaultCwd): Promise<string> {
    return (await this.require(["diff", "--no-ext-diff", "--stat"], "diff", { cwd })).stdout;
  }
  async stagedDiff(cwd = this.defaultCwd): Promise<string> {
    return (await this.require(["diff", "--cached", "--no-ext-diff", "--binary"], "staged diff", { cwd })).stdout;
  }
  async stagedNameOnly(cwd = this.defaultCwd): Promise<string[]> {
    const result = await this.require(["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB"], "staged names", { cwd });
    return sortedUniquePaths(result.stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean));
  }
  async stageExact(paths: readonly string[], cwd = this.defaultCwd): Promise<void> {
    const exact = sortedUniquePaths(paths);
    if (exact.length === 0) throw new Error("cannot stage an empty path set");
    await this.require(["add", "--", ...exact.map((path) => repositoryRelativePath(path))], "add", { cwd });
  }
  async commit(message: string, trailers: readonly string[], cwd = this.defaultCwd): Promise<string> {
    arg(message, "commit message");
    const trailerArgs: string[] = [];
    for (const trailer of trailers) {
      const separator = trailer.indexOf(":");
      if (separator < 1) throw new Error("commit trailer must use Key: value syntax");
      const key = arg(trailer.slice(0, separator).trim(), "commit trailer key");
      const value = arg(trailer.slice(separator + 1).trim(), "commit trailer value");
      trailerArgs.push("--trailer", `${key}=${value}`);
    }
    const result = await this.require(["commit", "--no-gpg-sign", "-m", message, ...trailerArgs], "commit", { cwd });
    return this.resolveRef("HEAD", cwd);
  }
  async push(remote: string, branch: string, cwd = this.defaultCwd): Promise<void> {
    await this.require(["push", "--set-upstream", arg(remote, "remote"), arg(branch, "branch")], "push", { cwd });
  }
  async createBranchWorktree(branch: string, base: string, cwd = this.defaultCwd): Promise<{ path: string; branch: string }> {
    const path = await mkdtemp(join(tmpdir(), "pi-kanban-flow-state-"));
    await this.require(["worktree", "add", "-b", arg(branch, "branch"), path, arg(base, "base")], "worktree add", { cwd });
    return { path, branch };
  }
  async removeBranchWorktree(path: string, cwd = this.defaultCwd): Promise<void> {
    await this.require(["worktree", "remove", "--force", path], "worktree remove", { cwd });
  }
  async workingDiffPaths(base: string, cwd = this.defaultCwd): Promise<string[]> {
    const result = await this.require(["diff", "--name-only", "--diff-filter=ACDMRTUXB", arg(base, "base"), "--"], "diff", { cwd });
    const paths = result.stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
    const status = await this.require(["status", "--porcelain=v1", "--untracked-files=all"], "status", { cwd });
    for (const line of status.stdout.split(/\r?\n/).map((value) => value.trimEnd()).filter(Boolean)) {
      if (line.startsWith("?? ")) paths.push(line.slice(3));
      else if (line.length >= 4) {
        const path = line.slice(3);
        paths.push(path.includes(" -> ") ? path.slice(path.lastIndexOf(" -> ") + 4) : path);
      }
    }
    return sortedUniquePaths([...new Set(paths)]);
  }
  async isAncestor(ancestor: string, descendant: string, cwd = this.defaultCwd): Promise<boolean> {
    const result = await this.run(["merge-base", "--is-ancestor", arg(ancestor, "ancestor"), arg(descendant, "descendant")], { cwd });
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new Error(`git merge-base failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`);
  }
}

export interface WorktreeRecord { path: string; head: string; branch: string | null; detached: boolean }
export function parseWorktreeList(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> = {};
  const flush = () => {
    if (!current.path || !current.head) throw new Error("malformed git worktree output");
    records.push({ path: current.path, head: current.head, branch: current.branch ?? null, detached: current.detached ?? false });
    current = {};
  };
  for (const line of output.split(/\r?\n/)) {
    if (!line) { if (current.path) flush(); continue; }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current.path = value;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") {
      if (!value.startsWith("refs/heads/")) throw new Error("unexpected git worktree branch");
      current.branch = value.slice("refs/heads/".length);
    } else if (key === "detached") current.detached = true;
    else if (key === "bare") current.detached = true;
  }
  if (current.path) flush();
  return records;
}
