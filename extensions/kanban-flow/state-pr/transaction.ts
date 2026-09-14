import { isObjectId, runtimeId } from "../engine/ids.ts";
import { sortedUniquePaths } from "../engine/paths.ts";
import { readBoardRepository, writeAtomicExactFiles, type BoardSnapshot } from "../board/repository.ts";
import type { GitAdapter } from "./git.ts";
import {
  discoverManagedPullRequests,
  type GitHubAdapter,
  type GitHubPullRequest,
  type ManagedPullRequest,
} from "./github.ts";
import {
  serializeCommitTrailers,
  serializePullRequestMarker,
  validatePullRequestMarker,
  assertMarkerMatchesBranch,
  type PullRequestMarker,
} from "./markers.ts";

export interface TransactionWorktree {
  path: string;
  branch: string;
}

/** The filesystem/repository seam used by the coordinator. */
export interface StateTransactionRepository {
  read(root: string): Promise<BoardSnapshot>;
  validate(snapshot: BoardSnapshot, root?: string): Promise<void> | void;
  writeRendered(worktree: string, files: Readonly<Record<string, string>>): Promise<void>;
}

/** All effects that touch Git are injected so the coordinator is deterministic in tests. */
export interface StateTransactionGit {
  fetch(remote: string, cwd: string): Promise<void>;
  resolveRef(ref: string, cwd: string): Promise<string>;
  createWorktree(input: { branch: string; base: string; cwd: string }): Promise<TransactionWorktree>;
  diffPaths(input: { worktree: string; base: string }): Promise<readonly string[]>;
  stageExact(input: { worktree: string; paths: readonly string[] }): Promise<void>;
  stagedPaths(worktree: string): Promise<readonly string[]>;
  commitState(input: { worktree: string; message: string; trailers: string }): Promise<string>;
  push(input: { worktree: string; remote: string; branch: string }): Promise<void>;
  removeWorktree?(input: { worktree: string; branch: string; cwd: string }): Promise<void>;
}

export interface StateMutationContext {
  operationId: string;
  transactionId: string;
  baseCommit: string;
  plannedAt: string;
}

export interface StateMutationResult {
  /** Complete validated snapshot after the mutation. */
  snapshot: BoardSnapshot;
  /** Canonical bytes for every path owned by this transaction. */
  files: Readonly<Record<string, string>>;
}

export interface StateMutation {
  cardIds: readonly string[];
  apply(snapshot: BoardSnapshot, context: StateMutationContext): Promise<StateMutationResult> | StateMutationResult;
}

/** Adapt the direct Git and repository primitives to the transaction seam. */
export function createStateTransactionGit(git: GitAdapter): StateTransactionGit {
  return {
    fetch: (remote, cwd) => git.fetch(remote, cwd),
    resolveRef: (ref, cwd) => git.resolveRef(ref, cwd),
    createWorktree: ({ branch, base, cwd }) => git.createBranchWorktree(branch, base, cwd),
    diffPaths: ({ worktree, base }) => git.workingDiffPaths(base, worktree),
    stageExact: ({ worktree, paths }) => git.stageExact(paths, worktree),
    stagedPaths: (worktree) => git.stagedNameOnly(worktree),
    commitState: ({ worktree, message, trailers }) => git.commit(message, trailers.split("\\n"), worktree),
    push: ({ worktree, remote, branch }) => git.push(remote, branch, worktree),
    removeWorktree: ({ worktree, cwd }) => git.removeBranchWorktree(worktree, cwd),
  };
}

export function createStateTransactionRepository(): StateTransactionRepository {
  return {
    read: (root) => readBoardRepository(root),
    validate: async (snapshot, root) => {
      const reread = await readBoardRepository(root ?? snapshot.root);
      if (reread.dashboardDrift) throw new StateTransactionError("rendered board snapshot has dashboard drift");
    },
    writeRendered: (worktree, files) => writeAtomicExactFiles(worktree, files),
  };
}

export interface StateTransactionPlan {
  root: string;
  repositoryId: string;
  packageVersion: string;
  operationId?: string;
  plannedAt?: string;
  mutation: StateMutation;
  title?: string;
  body?: string;
}

export interface StateTransactionDescriptor {
  id: string;
  operation_id: string;
  planned_at: string;
  base_commit: string;
  card_ids: string[];
  paths: string[];
}

export type StateTransactionOutcome =
  | { kind: "proposed"; descriptor: StateTransactionDescriptor; branch: string; commit: string; pullRequest: GitHubPullRequest }
  | { kind: "reused"; descriptor: StateTransactionDescriptor; branch: string; pullRequest: GitHubPullRequest }
  | { kind: "pending"; pullRequest: GitHubPullRequest; marker: PullRequestMarker }
  | { kind: "merged"; pullRequest: GitHubPullRequest; marker: PullRequestMarker };

export class StateTransactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateTransactionError";
  }
}

function equalPaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function sortedCardIds(cardIds: readonly string[]): string[] {
  if (new Set(cardIds).size !== cardIds.length) throw new StateTransactionError("card IDs must be unique CARD identifiers");
  const ids = [...cardIds].sort();
  if (ids.some((id) => !/^CARD-[0-9]{4}$/.test(id))) throw new StateTransactionError("card IDs must be CARD identifiers");
  return ids;
}

function assertStatePaths(paths: readonly string[]): string[] {
  const sorted = sortedUniquePaths(paths);
  if (sorted.some((path) => path !== "docs/spec.md" && !path.startsWith("docs/cards/"))) {
    throw new StateTransactionError("state transaction contains a path outside state-owned roots");
  }
  return sorted;
}

function markerFor(descriptor: StateTransactionDescriptor): PullRequestMarker {
  return validatePullRequestMarker({
    version: 1,
    kind: "state",
    operation_id: descriptor.operation_id,
    card_ids: descriptor.card_ids,
    base: "main",
    transaction_id: descriptor.id,
  });
}

function assertCreatedPr(pr: GitHubPullRequest, marker: PullRequestMarker, commit: string): void {
  if (pr.base !== "main" || pr.head !== `kanban/state/${marker.transaction_id}` || pr.head_commit !== commit) {
    throw new StateTransactionError(`created state PR #${pr.number} does not match its transaction identity`);
  }
  if (pr.state !== "open") throw new StateTransactionError("state PR must be human-mergeable and open");
  const parsed = validatePullRequestMarker(parseMarkerFromBody(pr.body));
  if (JSON.stringify(parsed) !== JSON.stringify(marker)) throw new StateTransactionError("created state PR marker does not match transaction");
  assertMarkerMatchesBranch(parsed, pr.head);
}

function parseMarkerFromBody(body: string): unknown {
  const match = body.match(/<!-- kanban-flow:(\{[\s\S]*?\}) -->/g);
  if (!match || match.length !== 1) throw new StateTransactionError("state PR body must contain exactly one marker");
  const json = match[0].slice("<!-- kanban-flow:".length, -" -->".length);
  try { return JSON.parse(json); } catch (error) { throw new StateTransactionError("state PR marker is malformed", { cause: error }); }
}

/**
 * Coordinates one complete state mutation. It never merges a PR and never trusts a
 * proposed/local snapshot as authoritative: every plan starts from origin/main.
 */
export class StateTransactionCoordinator {
  constructor(
    private readonly repository: StateTransactionRepository,
    private readonly git: StateTransactionGit,
    private readonly github: GitHubAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async propose(plan: StateTransactionPlan): Promise<StateTransactionOutcome> {
    if (!plan.root || !plan.repositoryId || !plan.packageVersion) throw new StateTransactionError("transaction plan identity is incomplete");
    const operationId = plan.operationId ?? runtimeId("KFOP", this.now());
    const plannedAt = plan.plannedAt ?? this.now().toISOString();
    const cardIds = sortedCardIds(plan.mutation.cardIds);
    await this.git.fetch("origin", plan.root);
    const baseCommit = await this.git.resolveRef("origin/main", plan.root);
    if (!isObjectId(baseCommit)) throw new StateTransactionError("origin/main did not resolve to a Git object ID");

    const existing = await discoverManagedPullRequests(this.github, { kind: "state" });
    if (existing.length > 1) throw new StateTransactionError("more than one managed state PR exists");
    const candidate = existing[0];
    if (candidate) {
      if (candidate.pullRequest.state === "open") return { kind: "pending", pullRequest: candidate.pullRequest, marker: candidate.marker };
      if (candidate.pullRequest.state === "merged") return { kind: "merged", pullRequest: candidate.pullRequest, marker: candidate.marker };
      throw new StateTransactionError(`closed-unmerged state PR #${candidate.pullRequest.number} requires explicit resolution`);
    }

    const transactionId = runtimeId("KFTX", this.now());
    const descriptorContext: StateMutationContext = { operationId, transactionId, baseCommit, plannedAt };
    const authoritative = await this.repository.read(plan.root);
    const result = await plan.mutation.apply(authoritative, descriptorContext);
    await this.repository.validate(result.snapshot);
    const paths = assertStatePaths(Object.keys(result.files));
    if (paths.length === 0) throw new StateTransactionError("state transaction must contain at least one file");
    const descriptor: StateTransactionDescriptor = { id: transactionId, operation_id: operationId, planned_at: plannedAt, base_commit: baseCommit, card_ids: cardIds, paths };
    const marker = markerFor(descriptor);
    const branch = `kanban/state/${transactionId}`;

    const precondition = await this.git.resolveRef("origin/main", plan.root);
    if (precondition !== baseCommit) throw new StateTransactionError("origin/main changed while planning state transaction");
    const worktree = await this.git.createWorktree({ branch, base: baseCommit, cwd: plan.root });
    if (worktree.branch !== branch) throw new StateTransactionError("Git created a worktree on an unexpected branch");
    let committed = false;
    try {
      await this.repository.writeRendered(worktree.path, result.files);
      await this.repository.validate(result.snapshot, worktree.path);
      const actualPaths = assertStatePaths(await this.git.diffPaths({ worktree: worktree.path, base: baseCommit }));
      if (!equalPaths(actualPaths, paths)) throw new StateTransactionError(`state diff does not equal descriptor paths: expected ${paths.join(", ")}; got ${actualPaths.join(", ")}`);
      await this.git.stageExact({ worktree: worktree.path, paths });
      const stagedPaths = assertStatePaths(await this.git.stagedPaths(worktree.path));
      if (!equalPaths(stagedPaths, paths)) throw new StateTransactionError("staged state diff does not equal descriptor paths");
      const trailers = serializeCommitTrailers({ kind: "state", operation_id: operationId, card_ids: cardIds, transaction_id: transactionId });
      const commit = await this.git.commitState({ worktree: worktree.path, message: plan.title ?? `kanban: state transaction ${transactionId}`, trailers });
      if (!isObjectId(commit)) throw new StateTransactionError("state commit did not return a valid object ID");
      committed = true;
      const beforePush = await this.git.resolveRef("origin/main", plan.root);
      if (beforePush !== baseCommit) throw new StateTransactionError("origin/main changed before state push");
      await this.git.push({ worktree: worktree.path, remote: "origin", branch });
      const beforePr = await this.git.resolveRef("origin/main", plan.root);
      if (beforePr !== baseCommit) throw new StateTransactionError("origin/main changed before state PR creation");
      const body = `${serializePullRequestMarker(marker)}\n\n${plan.body ?? "Human review is required before merging this state transaction."}`;
      const pullRequest = await this.github.createPullRequest({ title: plan.title ?? `Kanban state transaction ${transactionId}`, body, head: branch, base: "main" });
      assertCreatedPr(pullRequest, marker, commit);
      return { kind: "proposed", descriptor, branch, commit, pullRequest };
    } finally {
      if (!committed && this.git.removeWorktree) await this.git.removeWorktree({ worktree: worktree.path, branch, cwd: plan.root }).catch(() => undefined);
    }
  }
}
