import assert from "node:assert/strict";
import { test } from "node:test";
import { OneCardLifecycleCoordinator } from "../../extensions/kanban-flow/lifecycle/coordinator.ts";
import { serializePullRequestMarker } from "../../extensions/kanban-flow/state-pr/markers.ts";
import type { GitHubAdapter, GitHubPullRequest } from "../../extensions/kanban-flow/state-pr/github.ts";

const operation = "KFOP-20260115T103000000Z-abcdefgh";
const transaction = "KFTX-20260115T103000000Z-abcdefgh";
const commit = "a".repeat(40);
const fakeGit = { isAncestor: async () => true } as any;
const github = (prs: readonly GitHubPullRequest[]): GitHubAdapter => ({
  listPullRequests: async () => prs,
  createPullRequest: async () => { throw new Error("not used"); },
  addComment: async () => { throw new Error("not used"); },
  closePullRequest: async () => undefined,
  reopenPullRequest: async () => undefined,
  getComments: async () => [],
});
const coordinator = (gh: GitHubAdapter) => new OneCardLifecycleCoordinator({
  root: process.cwd(), repositoryId: "owner/repo", packageVersion: "0.0.0", git: fakeGit, github: gh,
});
const pr = (body: string, state: GitHubPullRequest["state"] = "open"): GitHubPullRequest => ({ number: 1, url: "https://github.com/owner/repo/pull/1", title: "state", body, head: `kanban/state/${transaction}`, base: "main", state, head_commit: commit, merge_commit: state === "merged" ? "b".repeat(40) : null });
const stateMarker = serializePullRequestMarker({ version: 1, kind: "state", operation_id: operation, transaction_id: transaction, card_ids: ["CARD-0001"], base: "main" });
const emptyBoard = { cards: [], board: {}, config: {}, root: process.cwd(), findingIds: [] } as any;

test("preflight fails closed when parent model or model registry is absent", async () => {
  const missingParent = await coordinator(github([])).preflight();
  assert.equal(missingParent.kind, "failed");
  assert.equal((missingParent as any).issues[0].code, "parent_model_unavailable");
  const missingResolver = new OneCardLifecycleCoordinator({ root: process.cwd(), repositoryId: "owner/repo", packageVersion: "0.0.0", parentModel: { provider: "test", id: "model", thinking: "off" } as any, git: fakeGit, github: github([]) });
  const result = await missingResolver.preflight();
  assert.equal(result.kind, "failed");
  assert.equal((result as any).issues[0].code, "model_registry_unavailable");
});

test("reconciliation waits for one open state transaction and blocks ambiguity", async () => {
  const input = { baseCommit: commit, board: emptyBoard, signal: new AbortController().signal, heartbeat: async () => undefined };
  const pending = await coordinator(github([pr(stateMarker)])).reconcile(input);
  assert.equal(pending.kind, "pending");
  const second = { ...pr(stateMarker), number: 2, url: "https://github.com/owner/repo/pull/2" };
  const ambiguous = await coordinator(github([pr(stateMarker), second])).reconcile(input);
  assert.equal(ambiguous.kind, "unresolved");
});

test("malformed managed child/external evidence fails closed", async () => {
  const malformed = { ...pr("<!-- kanban-flow: malformed -->") };
  const result = await coordinator(github([malformed])).reconcile({ baseCommit: commit, board: emptyBoard, signal: new AbortController().signal, heartbeat: async () => undefined });
  assert.equal(result.kind, "blocked");
  assert.match((result as any).blockers[0].message, /malformed managed marker/i);
});

test("dispatch with an active model but no resolver never returns a workflow placeholder", async () => {
  const instance = new OneCardLifecycleCoordinator({ root: process.cwd(), repositoryId: "owner/repo", packageVersion: "0.0.0", parentModel: { provider: "test", id: "model", thinking: "off" } as any, git: fakeGit, github: github([]) });
  const result = await instance.dispatch({ operationId: operation, selected: { card: { id: "CARD-0001" } as any, nextAction: "design" } as any, board: emptyBoard, signal: new AbortController().signal, heartbeat: async () => undefined });
  assert.notEqual(result.kind, "workflow_requires_parent_model");
  assert.equal(result.kind, "failure");
});
