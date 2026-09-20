import { Type, type Static } from "typebox";
import { readBoardRepository } from "../board/repository.ts";
import { runPump, type PumpDependencies } from "../engine/pump.ts";
import { deriveGitHubRepositoryIdentity } from "../requirements/initialize.ts";
import { GitAdapter } from "../state-pr/git.ts";
import { GhCliAdapter, discoverManagedPullRequests } from "../state-pr/github.ts";
import { createStateTransactionGit, createStateTransactionRepository, StateTransactionCoordinator } from "../state-pr/transaction.ts";
import { packageRoot } from "../paths.ts";

export const kanbanPumpParameters = Type.Object({
  schema_version: Type.Literal(1),
  requested_phase: Type.Union([Type.Literal("none"), Type.Literal("design"), Type.Literal("split_decision"), Type.Literal("implement"), Type.Literal("review"), Type.Literal("ship")]),
}, { additionalProperties: false });
export type KanbanPumpParameters = Static<typeof kanbanPumpParameters>;

/** Optional host seam used by integration tests and embedders. */
let dependencyFactory: ((cwd: string, packageVersion: string) => Promise<PumpDependencies>) | undefined;
export function setKanbanPumpDependencyFactory(factory: ((cwd: string, packageVersion: string) => Promise<PumpDependencies>) | undefined): void { dependencyFactory = factory; }

export async function runKanbanPump(cwd: string, packageVersion: string, request: KanbanPumpParameters, signal?: AbortSignal) {
  const dependencies = dependencyFactory ? await dependencyFactory(cwd, packageVersion) : await defaultDependencies(cwd, packageVersion);
  return runPump(request, dependencies, signal);
}

async function defaultDependencies(cwd: string, packageVersion: string): Promise<PumpDependencies> {
  const git = new GitAdapter({ cwd });
  const root = await git.repositoryRoot(cwd);
  const identity = await deriveGitHubRepositoryIdentity(root, { git });
  const github = new GhCliAdapter({ cwd: root, repository: identity.repositoryId });
  const coordinator = new StateTransactionCoordinator(createStateTransactionRepository(), createStateTransactionGit(git), github);
  return {
    root, repositoryId: identity.repositoryId, packageVersion,
    authoritative: async () => { await git.fetch("origin", root); const baseCommit = await git.resolveRef("origin/main", root); return { baseCommit, board: await readBoardRepository(root) }; },
    reconcile: async ({ baseCommit }) => {
      const state = await discoverManagedPullRequests(github, { kind: "state" });
      if (state.length > 1) return { kind: "unresolved" as const, reason: "multiple managed state PRs are ambiguous" };
      const pr = state[0]?.pullRequest;
      if (!pr) return { kind: "none" as const };
      if (pr.state === "open") return { kind: "pending" as const, reason: `state PR #${pr.number} is pending` };
      if (pr.state === "closed") return { kind: "unresolved" as const, reason: `state PR #${pr.number} is closed without merge` };
      if (!pr.merge_commit || !(await git.isAncestor(pr.merge_commit, baseCommit, root))) return { kind: "unresolved" as const, reason: "merged state PR is not reachable from origin/main" };
      return { kind: "none" as const };
    },
    // Lifecycle dispatch is deliberately assembled here (rather than in the Pi
    // adapter); the coordinator owns every state transaction and external PR.
    // Host contexts may replace only the child-dispatch seam when model access is
    // required.
    dispatch: async () => ({ kind: "blocked" as const, blockers: [{ code: "workflow_requires_parent_model", message: "This deterministic tool invocation requires the active Pi lifecycle dispatch context." }] }),
    transaction: { propose: (plan) => coordinator.propose(plan) },
  };
}

export async function packageVersionFromManifest(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(`${await packageRoot()}/package.json`, "utf8")) as { version?: string };
  return manifest.version ?? "0.0.0";
}
