import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readBoardRepository, writeAtomicExactFiles } from "../../extensions/kanban-flow/board/repository.ts";
import { INITIAL_CONFIG, INITIALIZATION_PATHS, InitializationCoordinator, buildInitializationCandidate, classifyInitializationLayout, deriveGitHubRepositoryIdentity } from "../../extensions/kanban-flow/requirements/initialize.ts";

const operation = "KFOP-20260101T000000000Z-abcdefgh"; const transaction = "KFTX-20260101T000000000Z-abcdefgh"; const commit = "a".repeat(40);
async function temporary(): Promise<string> { return mkdtemp(join(tmpdir(), "kanban-init-test-")); }

test("classifies exact uninitialized, initialized, partial, and ambiguous layouts", async () => {
  const root = await temporary();
  try {
    assert.equal(await classifyInitializationLayout(root), "uninitialized");
    const candidate = buildInitializationCandidate({ root, repositoryId: "owner/repo", packageVersion: "1.2.3", operationId: operation, transactionId: transaction, baseCommit: commit, plannedAt: "2026-01-01T00:00:00Z" });
    await mkdir(join(root, "docs/cards"), { recursive: true }); await writeAtomicExactFiles(root, candidate.files); assert.equal(await classifyInitializationLayout(root, "owner/repo"), "initialized");
    const parsed = await readBoardRepository(root); assert.deepEqual(parsed.board.ids, { next_requirement: 1, next_card: 1, next_acceptance_criterion: 1, next_finding: 1 });
    assert.deepEqual(parsed.board.state.last_state_transaction?.paths, INITIALIZATION_PATHS);
  } finally { await rm(root, { recursive: true, force: true }); }
  const partial = await temporary(); try { await mkdir(join(partial, "docs/cards"), { recursive: true }); await writeFile(join(partial, "docs/cards/board.yaml"), "harness: pi\n"); assert.equal(await classifyInitializationLayout(partial), "partial"); } finally { await rm(partial, { recursive: true, force: true }); }
  const ambiguous = await temporary(); try { await mkdir(join(ambiguous, "docs/cards"), { recursive: true }); await writeFile(join(ambiguous, "docs/cards/other"), "x"); assert.equal(await classifyInitializationLayout(ambiguous), "ambiguous"); } finally { await rm(ambiguous, { recursive: true, force: true }); }
  const linked = await temporary(); const target = await temporary(); try { await mkdir(join(linked, "docs")); await symlink(target, join(linked, "docs/cards")); assert.equal(await classifyInitializationLayout(linked), "ambiguous"); } finally { await rm(linked, { recursive: true, force: true }); await rm(target, { recursive: true, force: true }); }
});

test("uses fixed secure schema-version-1 defaults and exact canonical bytes", () => {
  assert.deepEqual(INITIAL_CONFIG.project_commands, { test: ["npm", "test"], lint: ["npm", "run", "lint"], typecheck: ["npm", "run", "typecheck"], build: ["npm", "run", "build"] });
  assert.deepEqual(INITIAL_CONFIG.resources.broad_policy_allowed_skills, []); assert.equal(INITIAL_CONFIG.state_prs.merge_policy, "human");
  const candidate = buildInitializationCandidate({ root: "/repo", repositoryId: "Owner/Repo", packageVersion: "1.2.3", operationId: operation, transactionId: transaction, baseCommit: commit, plannedAt: "2026-01-01T00:00:00Z" });
  assert.deepEqual(Object.keys(candidate.files), INITIALIZATION_PATHS); assert.equal(candidate.snapshot.board.project.repository_id, "owner/repo"); assert.equal(candidate.files["docs/cards/BOARD.md"].startsWith("# Kanban board\n"), true); assert.doesNotMatch(Object.values(candidate.files).join(""), /docs\/spec\.md|CARD-0001/);
});

test("derives matching GitHub identity from one supported origin and direct gh metadata", async () => {
  const root = await temporary(); try {
    const git = { repositoryRoot: async () => root, commonDirectory: async () => root, worktrees: async () => [{ path: root }], require: async () => ({ stdout: "git@github.com:Owner/Repo.git\n", stderr: "", code: 0 }) } as any;
    const ghRunner = { run: async (executable: string, argv: string[]) => { assert.equal(executable, "gh"); assert.deepEqual(argv, ["repo", "view", "--json", "nameWithOwner,url"]); return { code: 0, stdout: JSON.stringify({ nameWithOwner: "OWNER/REPO", url: "https://github.com/owner/repo" }), stderr: "" }; } } as any;
    const identity = await deriveGitHubRepositoryIdentity(root, { git, ghRunner }); assert.equal(identity.repositoryId, "owner/repo");
    ghRunner.run = async () => ({ code: 0, stdout: JSON.stringify({ nameWithOwner: "other/repo", url: "https://github.com/other/repo" }), stderr: "" });
    await assert.rejects(() => deriveGitHubRepositoryIdentity(root, { git, ghRunner }), /do not agree/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function fakeGithub() {
  const created: any[] = [];
  return { created, listPullRequests: async () => [], createPullRequest: async (input: any) => { created.push(input); return { number: 1, url: "https://github.com/owner/repo/pull/1", title: input.title, body: input.body, head: input.head, base: input.base, state: "open", head_commit: "b".repeat(40), merge_commit: null }; }, addComment: async () => { throw new Error("unused"); }, closePullRequest: async () => {}, reopenPullRequest: async () => {}, getComments: async () => [] };
}
function fakeCoordinator(options: { layout?: "uninitialized" | "initialized" | "migrated"; dirty?: string[] } = {}) {
  const calls: string[] = []; const github = fakeGithub(); const root = "/repo"; const worktree = "/worktree";
  const repository = { classify: async (path: string) => { calls.push(`classify:${path}`); return path === root ? options.layout ?? "uninitialized" : "uninitialized"; }, dirtyPaths: async () => options.dirty ?? [], write: async (_path: string, files: any) => { calls.push(`write:${Object.keys(files).join(",")}`); }, validate: async () => ({}) } as any;
  const git = { fetch: async () => { calls.push("fetch"); }, resolveRef: async () => commit, createWorktree: async (input: any) => ({ path: worktree, branch: input.branch }), diffPaths: async () => INITIALIZATION_PATHS, stageExact: async () => {}, stagedPaths: async () => INITIALIZATION_PATHS, commitState: async () => "b".repeat(40), push: async () => { calls.push("push"); }, removeWorktree: async () => { calls.push("remove"); } } as any;
  const identity = async () => ({ root, commonDirectory: "/repo/.git", repositoryId: "owner/repo", originUrl: "https://github.com/owner/repo", githubUrl: "https://github.com/owner/repo" });
  const coordinator = new InitializationCoordinator(repository, git, github as any, identity, () => new Date("2026-01-01T00:00:00Z"));
  return { coordinator, calls, github };
}

test("initialization coordinator proposes one human-only exact state transaction", async () => {
  const { coordinator, calls, github } = fakeCoordinator(); let allocated = "";
  const result = await coordinator.propose({ root: "/repo", packageVersion: "1.2.3", operationId: operation, onTransactionId: (id) => { allocated = id; } });
  assert.equal(result.kind, "proposed"); assert.match(allocated, /^KFTX-/); assert.deepEqual(result.descriptor.paths, INITIALIZATION_PATHS); assert.deepEqual(result.descriptor.card_ids, []);
  assert.equal(github.created.length, 1); assert.match(github.created[0].body, /kanban-flow/); assert.equal(github.created[0].base, "main"); assert.ok(calls.indexOf("push") > calls.findIndex((call) => call.startsWith("write:")));
});

test("initialized boards no-op and partial/dirty state cannot create external effects", async () => {
  const initialized = fakeCoordinator({ layout: "initialized" }); const noOp = await initialized.coordinator.propose({ root: "/repo", packageVersion: "1.2.3", operationId: operation }); assert.deepEqual(noOp, { kind: "already_initialized", layout: "initialized" }); assert.equal(initialized.github.created.length, 0);
  const dirty = fakeCoordinator({ dirty: ["docs/spec.md"] }); await assert.rejects(() => dirty.coordinator.propose({ root: "/repo", packageVersion: "1.2.3", operationId: operation }), /Dirty state-owned/); assert.equal(dirty.github.created.length, 0); assert.ok(!dirty.calls.includes("push"));
});
