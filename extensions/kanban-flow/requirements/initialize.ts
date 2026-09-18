import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { Value } from "typebox/value";
import { BoardSchema, ConfigSchema, type Board, type Config } from "../board/schemas.ts";
import { validateConfigSemantics } from "../board/config.ts";
import { readBoardRepository, writeAtomicExactFiles, type BoardSnapshot } from "../board/repository.ts";
import { validateBoardSemantics } from "../board/semantic-validation.ts";
import { renderBoard } from "../engine/render.ts";
import { isObjectId, runtimeId } from "../engine/ids.ts";
import { GitAdapter } from "../state-pr/git.ts";
import type { GitHubAdapter, GitHubPullRequest } from "../state-pr/github.ts";
import { discoverManagedPullRequests } from "../state-pr/github.ts";
import { serializeCommitTrailers, serializePullRequestMarker, type PullRequestMarker } from "../state-pr/markers.ts";
import type { StateTransactionGit, StateTransactionDescriptor } from "../state-pr/transaction.ts";
import { DirectProcessRunner, type ProcessRunner } from "../state-pr/process.ts";

export const INITIALIZATION_PATHS = Object.freeze(["docs/cards/BOARD.md", "docs/cards/board.yaml", "docs/cards/config.yaml"] as const);
export const INITIAL_CONFIG: Config = Object.freeze({
  repository: Object.freeze({ forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }),
  state_prs: Object.freeze({ merge_policy: "human" }), lock: Object.freeze({ ttl_seconds: 1800, heartbeat_seconds: 30 }),
  scheduler: Object.freeze({ wip_limit: 1, priority_order: "ascending" }), rework: Object.freeze({ design_limit: 2, implementation_limit: 2 }),
  review: Object.freeze({ lenses: Object.freeze(["acceptance", "functionality", "tests", "readability", "security", "simplicity"]), max_parallel: 4 }),
  project_commands: Object.freeze({ test: Object.freeze(["npm", "test"]), lint: Object.freeze(["npm", "run", "lint"]), typecheck: Object.freeze(["npm", "run", "typecheck"]), build: Object.freeze(["npm", "run", "build"]) }),
  agent_models: Object.freeze({ default: "inherit", overrides: Object.freeze({}) }), agents: Object.freeze({ allow_project_overrides: true, report_overrides: true }),
  resources: Object.freeze({ broad_policy_allowed_skills: Object.freeze([]) }),
}) as unknown as Config;

export type InitializationLayout = "uninitialized" | "initialized" | "migrated" | "partial" | "ambiguous";
export interface RepositoryIdentity { root: string; commonDirectory: string; repositoryId: string; originUrl: string; githubUrl: string }
export interface InitializationCandidate { snapshot: BoardSnapshot; files: Readonly<Record<string, string>> }

function yaml(value: unknown): string { return stringify(value, { lineWidth: 0 }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n"); }
async function stat(path: string) { return lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error)); }
function githubCoordinates(url: string): string | undefined {
  const match = url.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
function validateRepositoryId(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,38})\/[a-z0-9](?:[a-z0-9._-]{0,99})$/.test(normalized)) throw new Error("GitHub repository identity is invalid");
  return normalized;
}

/** Derive identity from direct Git and gh calls; no caller or model supplies owner/name. */
export async function deriveGitHubRepositoryIdentity(root: string, options: { git?: GitAdapter; ghRunner?: ProcessRunner; ghExecutable?: string } = {}): Promise<RepositoryIdentity> {
  const git = options.git ?? new GitAdapter({ cwd: root }); const canonical = await realpath(root); const repositoryRoot = await realpath(await git.repositoryRoot(root));
  if (canonical !== repositoryRoot) throw new Error("Initialization must run at the canonical repository root");
  const commonDirectory = await realpath(await git.commonDirectory(root));
  const worktrees = await git.worktrees(root); const worktreeRoots = await Promise.all(worktrees.map((worktree) => realpath(worktree.path)));
  if (!worktreeRoots.includes(repositoryRoot)) throw new Error("Git common directory does not own the current worktree");
  const remote = await git.require(["remote", "get-url", "--all", "origin"], "remote get-url", { cwd: root });
  const urls = remote.stdout.split(/\r?\n/).filter(Boolean); if (urls.length !== 1) throw new Error("Exactly one origin URL is required");
  const originId = githubCoordinates(urls[0]); if (!originId) throw new Error("origin must use a supported GitHub URL");
  const runner = options.ghRunner ?? new DirectProcessRunner();
  const result = await runner.run(options.ghExecutable ?? "gh", ["repo", "view", "--json", "nameWithOwner,url"], { cwd: root });
  if (result.code !== 0) throw new Error(`gh repo view failed (${result.code})`);
  let view: any; try { view = JSON.parse(result.stdout); } catch { throw new Error("gh repo view returned malformed JSON"); }
  const reported = validateRepositoryId(String(view.nameWithOwner ?? "")); const githubUrlId = githubCoordinates(String(view.url ?? ""));
  if (!githubUrlId || originId !== reported || githubUrlId !== reported) throw new Error("origin and GitHub repository identities do not agree");
  return Object.freeze({ root: repositoryRoot, commonDirectory, repositoryId: reported, originUrl: urls[0], githubUrl: String(view.url) });
}

export async function classifyInitializationLayout(root: string, expectedRepositoryId?: string): Promise<InitializationLayout> {
  for (const ancestor of [join(root, "docs"), join(root, "docs", "cards")]) {
    const info = await stat(ancestor); if (info && (!info.isDirectory() || info.isSymbolicLink())) return "ambiguous";
  }
  const cardsRoot = join(root, "docs", "cards"); const cardsInfo = await stat(cardsRoot); const specInfo = await stat(join(root, "docs", "spec.md"));
  if (specInfo && (!specInfo.isFile() || specInfo.isSymbolicLink())) return "ambiguous";
  const entries = cardsInfo ? await readdir(cardsRoot, { withFileTypes: true }) : [];
  const known = /^(?:board\.yaml|config\.yaml|BOARD\.md|PROTOCOL-ADDENDUM\.md|artifacts|CARD-[0-9]{4}\.md)$/;
  if (entries.some((entry) => !known.test(entry.name) || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))) return "ambiguous";
  if (entries.length === 0 && !specInfo) return "uninitialized";
  try {
    const snapshot = await readBoardRepository(root);
    if (snapshot.dashboardDrift || (expectedRepositoryId && snapshot.board.project.repository_id !== expectedRepositoryId)) return "ambiguous";
    return snapshot.board.migration ? "migrated" : "initialized";
  } catch {
    return "partial";
  }
}

export function buildInitializationCandidate(input: { root: string; repositoryId: string; packageVersion: string; operationId: string; transactionId: string; baseCommit: string; plannedAt: string }): InitializationCandidate {
  const descriptor: StateTransactionDescriptor = { id: input.transactionId, operation_id: input.operationId, planned_at: input.plannedAt, base_commit: input.baseCommit, card_ids: [], paths: [...INITIALIZATION_PATHS] };
  const board: Board = { harness: "pi", board_schema_version: 1, last_writer_package_version: input.packageVersion, project: { repository_id: validateRepositoryId(input.repositoryId) }, ids: { next_requirement: 1, next_card: 1, next_acceptance_criterion: 1, next_finding: 1 }, state: { last_reconciled_at: input.plannedAt, last_state_transaction: descriptor }, migration: null };
  validateInitializationCandidate(board, INITIAL_CONFIG);
  const dashboard = renderBoard([]);
  const files = Object.freeze({ "docs/cards/BOARD.md": dashboard, "docs/cards/board.yaml": yaml(board), "docs/cards/config.yaml": yaml(INITIAL_CONFIG) });
  const snapshot: BoardSnapshot = Object.freeze({ root: input.root, board, config: INITIAL_CONFIG, cards: Object.freeze([]), findingIds: Object.freeze([]), requirements: undefined, dashboard, canonicalDashboard: dashboard, dashboardDrift: false });
  return Object.freeze({ snapshot, files });
}

export function validateInitializationCandidate(board: Board, config: Config): void {
  if (!Value.Check(BoardSchema, board) || !Value.Check(ConfigSchema, config)) throw new Error("Initialization candidate does not match schema version 1");
  validateConfigSemantics(config); validateBoardSemantics({ board, config, cards: [], requirements: undefined, findingIds: [] });
  const paths = board.state.last_state_transaction?.paths; if (!paths || JSON.stringify(paths) !== JSON.stringify(INITIALIZATION_PATHS)) throw new Error("Initialization descriptor paths are not exact");
}

export interface InitializationRepository {
  classify(root: string, baseCommit: string, repositoryId: string): Promise<InitializationLayout>;
  dirtyPaths(root: string, baseCommit: string): Promise<readonly string[]>;
  write(worktree: string, files: Readonly<Record<string, string>>): Promise<void>;
  validate(worktree: string, repositoryId: string): Promise<BoardSnapshot>;
}
export function createInitializationRepository(git: GitAdapter): InitializationRepository {
  return {
    classify: async (root, base, repositoryId) => {
      const changed = await git.workingDiffPaths(base, root);
      if (changed.some((path) => path === "docs/spec.md" || path === "docs" || path.startsWith("docs/cards"))) return "ambiguous";
      return classifyInitializationLayout(root, repositoryId);
    },
    dirtyPaths: (root, base) => git.workingDiffPaths(base, root),
    write: async (worktree, files) => { const { mkdir } = await import("node:fs/promises"); await mkdir(join(worktree, "docs", "cards"), { recursive: true, mode: 0o755 }); await writeAtomicExactFiles(worktree, files); },
    validate: async (worktree, repositoryId) => { const snapshot = await readBoardRepository(worktree); if (snapshot.board.project.repository_id !== repositoryId || snapshot.dashboardDrift) throw new Error("Initialized worktree validation failed"); return snapshot; },
  };
}

export type InitializationOutcome = { kind: "already_initialized"; layout: "initialized" | "migrated" } | { kind: "pending"; pullRequest: GitHubPullRequest } | { kind: "proposed"; descriptor: StateTransactionDescriptor; branch: string; commit: string; pullRequest: GitHubPullRequest };
export class InitializationCoordinator {
  constructor(private readonly repository: InitializationRepository, private readonly git: StateTransactionGit, private readonly github: GitHubAdapter, private readonly identify: (root: string) => Promise<RepositoryIdentity>, private readonly now: () => Date = () => new Date()) {}
  async propose(input: { root: string; packageVersion: string; operationId?: string; onTransactionId?: (id: string) => Promise<void> | void }): Promise<InitializationOutcome> {
    const identity = await this.identify(input.root); if (!identity.root || !identity.repositoryId) throw new Error("Repository identity is incomplete");
    const operationId = input.operationId ?? runtimeId("KFOP", this.now()); const plannedAt = this.now().toISOString();
    await this.git.fetch("origin", input.root); const baseCommit = await this.git.resolveRef("origin/main", input.root); if (!isObjectId(baseCommit)) throw new Error("origin/main is not a Git object ID");
    const managed = await discoverManagedPullRequests(this.github, { kind: "state" });
    if (managed.length > 1) throw new Error("Ambiguous managed state pull requests");
    if (managed[0]) { if (managed[0].pullRequest.state === "open") return { kind: "pending", pullRequest: managed[0].pullRequest }; throw new Error("An unresolved state pull request blocks initialization"); }
    const layout = await this.repository.classify(input.root, baseCommit, identity.repositoryId);
    if (layout === "initialized" || layout === "migrated") return { kind: "already_initialized", layout };
    if (layout !== "uninitialized") throw new Error(`Cannot initialize ${layout} board layout`);
    const dirty = await this.repository.dirtyPaths(input.root, baseCommit); if (dirty.some((path) => path === "docs/spec.md" || path === "docs" || path.startsWith("docs/cards"))) throw new Error("Dirty state-owned paths block initialization");
    const transactionId = runtimeId("KFTX", this.now()); await input.onTransactionId?.(transactionId);
    const candidate = buildInitializationCandidate({ root: input.root, repositoryId: identity.repositoryId, packageVersion: input.packageVersion, operationId, transactionId, baseCommit, plannedAt });
    if (await this.git.resolveRef("origin/main", input.root) !== baseCommit) throw new Error("origin/main changed before initialization worktree creation");
    const branch = `kanban/state/${transactionId}`; const worktree = await this.git.createWorktree({ branch, base: baseCommit, cwd: input.root });
    if (worktree.branch !== branch) throw new Error("Git created an unexpected initialization branch");
    try {
      if (await this.repository.classify(worktree.path, baseCommit, identity.repositoryId) !== "uninitialized") throw new Error("Authoritative initialization worktree is not empty");
      await this.repository.write(worktree.path, candidate.files); await this.repository.validate(worktree.path, identity.repositoryId);
      const diff = await this.git.diffPaths({ worktree: worktree.path, base: baseCommit }); if (JSON.stringify(diff) !== JSON.stringify(INITIALIZATION_PATHS)) throw new Error("Initialization diff paths are not exact");
      await this.git.stageExact({ worktree: worktree.path, paths: INITIALIZATION_PATHS }); const staged = await this.git.stagedPaths(worktree.path); if (JSON.stringify(staged) !== JSON.stringify(INITIALIZATION_PATHS)) throw new Error("Initialization staged paths are not exact");
      const descriptor = candidate.snapshot.board.state.last_state_transaction!; const trailers = serializeCommitTrailers({ kind: "state", operation_id: operationId, card_ids: [], transaction_id: transactionId });
      const commit = await this.git.commitState({ worktree: worktree.path, message: `kanban: initialize board ${transactionId}`, trailers }); if (!isObjectId(commit)) throw new Error("Initialization commit is invalid");
      if (await this.git.resolveRef("origin/main", input.root) !== baseCommit) throw new Error("origin/main changed before initialization push");
      await this.git.push({ worktree: worktree.path, remote: "origin", branch }); if (await this.git.resolveRef("origin/main", input.root) !== baseCommit) throw new Error("origin/main changed before initialization PR");
      const marker: PullRequestMarker = { version: 1, kind: "state", operation_id: operationId, card_ids: [], base: "main", transaction_id: transactionId };
      const pullRequest = await this.github.createPullRequest({ title: "Initialize kanban board", body: `${serializePullRequestMarker(marker)}\n\nHuman review is required before merging this initialization.`, head: branch, base: "main" });
      if (pullRequest.state !== "open" || pullRequest.base !== "main" || pullRequest.head !== branch || pullRequest.head_commit !== commit) throw new Error("Created initialization PR does not match the transaction");
      return { kind: "proposed", descriptor, branch, commit, pullRequest };
    } finally {
      if (this.git.removeWorktree) await this.git.removeWorktree({ worktree: worktree.path, branch, cwd: input.root });
    }
  }
}
