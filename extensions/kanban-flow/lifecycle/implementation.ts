import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProducerResult } from "../board/result-schemas.ts";
import { validateProducerResult } from "../board/result-schemas.ts";

import { ManagedWorktreeManager, managedBranch, type ManagedWorktree } from "../git/worktrees.ts";
import { serializeCommitTrailers, type CommitTrailers } from "../state-pr/markers.ts";
import type { GitAdapter } from "../state-pr/git.ts";

export type PlannedAction = "create" | "modify" | "delete";
export interface ProductPath { readonly path: string; readonly action: PlannedAction }
export interface ImplementationValidationInput { readonly dispatchId: string; readonly cardId: string }
export interface ImplementationValidation { readonly summary: string; readonly artifact: string }

function fail(message: string): never { throw new Error(`Invalid implementation: ${message}`); }

/** Validate the implementation producer independently of its prose or claimed commit. */
export function validateImplementationProducerResult(result: ProducerResult, input: ImplementationValidationInput): ImplementationValidation {
  validateProducerResult(result, { dispatchId: input.dispatchId, cardId: input.cardId, phase: "implementation" });
  if (result.status !== "completed") fail(`producer status is ${result.status}`);
  if (result.planned_paths.length !== 0) fail("implementation producer cannot authorize planned paths");
  const artifacts = result.artifacts.filter((entry) => entry.type === "implementation_summary");
  if (artifacts.length !== 1) fail("implementation producer must return exactly one summary");
  if (result.findings.some((finding) => finding.severity === "blocking")) fail("completed implementation contains a blocking finding");
  return Object.freeze({ summary: artifacts[0]!.content, artifact: `docs/cards/artifacts/${input.cardId}/implementation-producer-${result.dispatch_id}.yaml` });
}

/** The only branch identity accepted for product implementation. */
export function productBranch(cardId: string, title: string): string { return managedBranch("product", cardId, title); }

export function productCommitTrailers(operationId: string, cardId: string): CommitTrailers {
  return { kind: "product", operation_id: operationId, card_ids: [cardId], transaction_id: null };
}

/**
 * Check the complete product worktree diff before staging. The manager performs
 * the final exact check again immediately before commit; this early check lets
 * callers report a child policy violation without ever invoking Git staging.
 */
export async function validateImplementationDiff(root: string, planned: ReadonlyMap<string, PlannedAction>): Promise<readonly string[]> {
  const { runProjectCommand } = await import("../agents/project-command.ts");
  const result = await runProjectCommand({ executable: "git", argv: ["status", "--porcelain=v1", "-z", "--untracked-files=all"] }, root, { timeoutMs: 10_000 });
  if (result.exitCode !== 0 || result.timedOut) fail("unable to inspect product worktree");
  const records = result.stdout.split("\0").filter(Boolean);
  const actual: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const status = record.slice(0, 2);
    let path = record.slice(3);
    if (status[0] === "R" || status[0] === "C") path = records[++i] ?? "";
    if (!path || !planned.has(path)) fail(`unplanned product path: ${path}`);
    const expected = status === "??" || status.includes("A") ? "create" : status.includes("D") ? "delete" : "modify";
    if (planned.get(path) !== expected) fail(`product action mismatch for ${path}`);
    if (expected === "delete") {
      const stat = await lstat(resolve(root, path)).catch((error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : (() => { throw error; })());
      if (stat && (stat.isSymbolicLink() || !stat.isFile())) fail(`unsafe product path: ${path}`);
    } else {
      const stat = await lstat(resolve(root, path));
      if (stat.isSymbolicLink() || !stat.isFile()) fail(`unsafe product path: ${path}`);
    }
    actual.push(path);
  }
  if (actual.length === 0) fail("implementation produced no product diff");
  return Object.freeze(actual);
}

/** Commit only the parent-approved product paths; children never receive Git access. */
export async function commitImplementation(input: {
  readonly git: GitAdapter; readonly repositoryRoot: string; readonly worktree: ManagedWorktree;
  readonly paths: ReadonlyMap<string, PlannedAction>; readonly operationId: string; readonly cardId: string;
}): Promise<string> {
  await validateImplementationDiff(input.worktree.path, input.paths);
  const manager = new ManagedWorktreeManager(input.git, input.repositoryRoot, await repositoryId(input.git, input.repositoryRoot));
  return manager.commitExact({ worktree: input.worktree, paths: input.paths, message: `kanban: product ${input.cardId}`, trailers: productCommitTrailers(input.operationId, input.cardId) });
}

async function repositoryId(git: GitAdapter, root: string): Promise<string> {
  const remote = await git.require(["config", "--get", "remote.origin.url"], "origin URL", { cwd: root });
  const value = remote.stdout.trim().replace(/\.git$/, "").match(/(?:github\.com[/:])([^/]+\/[^/]+)$/i)?.[1]?.toLowerCase();
  if (!value) fail("origin is not a GitHub repository");
  return value;
}

export interface ImplementationDispatchContext { readonly mode: "fresh" | "rework"; readonly cardId: string; readonly designCommit: string; readonly branch: string; readonly plannedPaths: readonly ProductPath[]; readonly findings: readonly string[] }
export function implementationDispatchContext(input: ImplementationDispatchContext): Readonly<ImplementationDispatchContext> {
  if (!/^(?:fresh|rework)$/.test(input.mode) || !/^CARD-[0-9]{4}$/.test(input.cardId) || input.plannedPaths.length === 0) fail("invalid implementation dispatch context");
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.designCommit)) fail("invalid design commit");
  if (!input.branch.startsWith(`kanban/card/${input.cardId}-`)) fail("invalid product branch");
  return Object.freeze({ ...input, plannedPaths: Object.freeze(input.plannedPaths.map((path) => Object.freeze({ ...path }))), findings: Object.freeze([...input.findings]) });
}
