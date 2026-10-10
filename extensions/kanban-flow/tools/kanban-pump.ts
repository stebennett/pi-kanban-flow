import { Type, type Static } from "typebox";
import { readBoardRepository } from "../board/repository.ts";
import { runPump, type PumpDependencies } from "../engine/pump.ts";
import { deriveGitHubRepositoryIdentity } from "../requirements/initialize.ts";
import { GitAdapter } from "../state-pr/git.ts";
import { GhCliAdapter, type GitHubAdapter } from "../state-pr/github.ts";
import { createStateTransactionGit, createStateTransactionRepository, StateTransactionCoordinator } from "../state-pr/transaction.ts";
import { OneCardLifecycleCoordinator } from "../lifecycle/coordinator.ts";
import { materializeSnapshot } from "../agents/snapshots.ts";
import type { ModelResolver, ParentModel } from "../agents/models.ts";
import type { PersistedTrustReader } from "../agents/trust.ts";
import type { discoverAgents } from "../agents/discover.ts";
import type { createDispatchPlan, executeDispatch } from "../agents/runner.ts";

export const kanbanPumpParameters = Type.Object({
  schema_version: Type.Literal(1),
  requested_phase: Type.Union([Type.Literal("none"), Type.Literal("design"), Type.Literal("split_decision"), Type.Literal("implement"), Type.Literal("review"), Type.Literal("ship")]),
}, { additionalProperties: false });
export type KanbanPumpParameters = Static<typeof kanbanPumpParameters>;

/** Explicit host capabilities supplied by the active Pi execution context. */
export interface KanbanPumpHostContext {
  readonly parentModel?: ParentModel;
  readonly modelResolver?: ModelResolver;
  readonly trustReader?: PersistedTrustReader;
  readonly repositoryId?: string;
  readonly git?: GitAdapter;
  readonly github?: GitHubAdapter;
  /** Low-level lifecycle seams are test-only capabilities; production defaults stay in the coordinator. */
  readonly discover?: typeof discoverAgents;
  readonly createPlan?: typeof createDispatchPlan;
  readonly execute?: typeof executeDispatch;
  readonly snapshotter?: typeof materializeSnapshot;
  readonly now?: () => Date;
}

/** Assemble production dependencies from one explicit host context. */
export async function createKanbanPumpDependencies(cwd: string, packageVersion: string, host: KanbanPumpHostContext = {}): Promise<PumpDependencies> {
  const git = host.git ?? new GitAdapter({ cwd });
  const root = await git.repositoryRoot(cwd);
  const identity = host.repositoryId ? { repositoryId: host.repositoryId } : await deriveGitHubRepositoryIdentity(root, { git });
  const github = host.github ?? new GhCliAdapter({ cwd: root, repository: identity.repositoryId });
  const snapshotter = host.snapshotter ?? materializeSnapshot;
  const coordinator = new OneCardLifecycleCoordinator({
    root,
    repositoryId: identity.repositoryId,
    packageVersion,
    parentModel: host.parentModel,
    modelResolver: host.modelResolver,
    trustReader: host.trustReader,
    git,
    github,
    discover: host.discover,
    createPlan: host.createPlan,
    execute: host.execute,
    snapshotter: host.snapshotter,
    now: host.now,
  });
  const transaction = new StateTransactionCoordinator(createStateTransactionRepository(), createStateTransactionGit(git), github);
  return {
    root,
    repositoryId: identity.repositoryId,
    packageVersion,
    preflight: async () => coordinator.preflight(),
    authoritative: async () => {
      await git.fetch("origin", root);
      const baseCommit = await git.resolveRef("origin/main", root);
      const snapshot = await snapshotter(root, baseCommit);
      try {
        const board = await readBoardRepository(snapshot.root);
        return { baseCommit, board: Object.freeze({ ...board, root }) };
      } finally {
        await snapshot.cleanup();
      }
    },
    reconcile: (input) => coordinator.reconcile(input),
    dispatch: (input) => coordinator.dispatch(input),
    transaction: { propose: (plan) => transaction.propose(plan) },
  };
}

export async function runKanbanPump(cwd: string, packageVersion: string, request: KanbanPumpParameters, signal?: AbortSignal, host: KanbanPumpHostContext = {}) {
  const dependencies = await createKanbanPumpDependencies(cwd, packageVersion, host);
  return runPump(request, dependencies, signal);
}

export async function packageVersionFromManifest(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { packageRoot } = await import("../paths.ts");
  const manifest = JSON.parse(await readFile(`${await packageRoot()}/package.json`, "utf8")) as { version?: string };
  return manifest.version ?? "0.0.0";
}
