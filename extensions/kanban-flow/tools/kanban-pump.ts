import { Type, type Static } from "typebox";
import { readBoardRepository } from "../board/repository.ts";
import { runPump, type PumpDependencies } from "../engine/pump.ts";
import { deriveGitHubRepositoryIdentity } from "../requirements/initialize.ts";
import { GitAdapter } from "../state-pr/git.ts";
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
  return {
    root, repositoryId: identity.repositoryId, packageVersion,
    authoritative: async () => { await git.fetch("origin", root); const baseCommit = await git.resolveRef("origin/main", root); return { baseCommit, board: await readBoardRepository(root) }; },
    reconcile: async () => ({ kind: "none" as const }),
    // Workflow dispatch is installed by the lifecycle coordinator in host applications. Never
    // let a tool claim success when that coordinator is unavailable.
    dispatch: async () => ({ kind: "blocked" as const, blockers: [{ code: "workflow_unavailable", message: "The lifecycle coordinator is unavailable; no mutation was attempted." }] }),
    transaction: async () => { throw new Error("lifecycle state transaction coordinator is unavailable"); },
  };
}

export async function packageVersionFromManifest(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(`${await packageRoot()}/package.json`, "utf8")) as { version?: string };
  return manifest.version ?? "0.0.0";
}
