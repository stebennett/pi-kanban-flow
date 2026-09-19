import assert from "node:assert/strict";
import { test } from "node:test";
import { RecordingProcessRunner, type ProcessResult } from "../../extensions/kanban-flow/state-pr/process.ts";
import { GitAdapter, parseWorktreeList } from "../../extensions/kanban-flow/state-pr/git.ts";
import { discoverManagedPullRequests, findUniqueManagedPullRequest, type GitHubAdapter, type GitHubPullRequest } from "../../extensions/kanban-flow/state-pr/github.ts";
import { assertMarkerMatchesBranch, parseActionMarker, parseCommitTrailers, parsePullRequestMarker, parseResolutionMarker, serializeActionMarker, serializeCommitTrailers, serializePullRequestMarker, serializeResolutionMarker, type PullRequestMarker } from "../../extensions/kanban-flow/state-pr/markers.ts";

const op = "KFOP-20260115T103000000Z-abcdefgh";
const tx = "KFTX-20260115T103000000Z-abcdefgh";
const card = "CARD-0001";
const marker: PullRequestMarker = { version: 1, kind: "state", operation_id: op, card_ids: [card], base: "main", transaction_id: tx };

test("PR markers and action/resolution markers round-trip canonically", () => {
  const body = serializePullRequestMarker(marker);
  assert.equal(body, '<!-- kanban-flow:{"version":1,"kind":"state","operation_id":"KFOP-20260115T103000000Z-abcdefgh","card_ids":["CARD-0001"],"base":"main","transaction_id":"KFTX-20260115T103000000Z-abcdefgh"} -->');
  assert.deepEqual(parsePullRequestMarker(body), marker);
  const action = { version: 1 as const, kind: "deterministic-correction" as const, operation_id: op, card_id: card, criterion: "PR-BODY" };
  assert.deepEqual(parseActionMarker(serializeActionMarker(action)), action);
  const resolution = { version: 1 as const, transaction_id: tx, decision: "adopt" as const, resolution_operation_id: op, replacement_transaction_id: null };
  assert.deepEqual(parseResolutionMarker(serializeResolutionMarker(resolution)), resolution);
});

test("marker and trailer validation fails closed", () => {
  assert.throws(() => parsePullRequestMarker(`${serializePullRequestMarker(marker)}\n${serializePullRequestMarker(marker)}`), /exactly once/);
  assert.throws(() => parsePullRequestMarker(serializePullRequestMarker(marker).replace("\"base\":\"main\"", "\"unknown\":true,\"base\":\"main\"")), /unknown or missing/);
  const trailers = serializeCommitTrailers({ kind: "state", operation_id: op, card_ids: [card], transaction_id: tx });
  assert.deepEqual(parseCommitTrailers(trailers), { kind: "state", operation_id: op, card_ids: [card], transaction_id: tx });
  assert.throws(() => parseCommitTrailers(`${trailers}\nKanban-Flow-Operation: ${op}`), /missing or duplicate/);
  assert.throws(() => parseCommitTrailers(`Kanban-Flow-Kind: product\nKanban-Flow-Operation: ${op}\nKanban-Flow-Transaction: ${tx}\nKanban-Flow-Card: ${card}`), /cannot have transaction/);
});

test("design and product markers accept only their managed branch classes", () => {
  const design: PullRequestMarker = { version: 1, kind: "design", operation_id: op, card_ids: [card], base: "main" };
  const product: PullRequestMarker = { version: 1, kind: "product", operation_id: op, card_ids: [card], base: "main" };
  assert.doesNotThrow(() => assertMarkerMatchesBranch(design, "kanban/design/CARD-0001-example"));
  assert.doesNotThrow(() => assertMarkerMatchesBranch(product, "kanban/card/CARD-0001-example"));
  assert.throws(() => assertMarkerMatchesBranch(product, "kanban/product/CARD-0001-example"), /product marker branch mismatch/);
  assert.throws(() => assertMarkerMatchesBranch(product, "kanban/card/CARD-0001"), /product marker branch mismatch/);
});

test("Git adapter passes executable and argv separately", async () => {
  const result: ProcessResult = { executable: "git", args: [], code: 0, stdout: "/repo/.git\n", stderr: "" };
  const runner = new RecordingProcessRunner(async () => result);
  const git = new GitAdapter({ runner, cwd: "/repo" });
  assert.equal(await git.commonDirectory(), "/repo/.git");
  assert.deepEqual(runner.calls[0]?.args, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  assert.throws(() => git.run(["show", "bad\narg"]));
});

test("worktree porcelain parsing is deterministic", () => {
  assert.deepEqual(parseWorktreeList("worktree /repo\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/main\n\nworktree /tmp/wt\nHEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\ndetached\n"), [
    { path: "/repo", head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", branch: "main", detached: false },
    { path: "/tmp/wt", head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", branch: null, detached: true },
  ]);
});

class FakeGitHub implements GitHubAdapter {
  constructor(private readonly prs: readonly GitHubPullRequest[]) {}
  listPullRequests(): Promise<readonly GitHubPullRequest[]> { return Promise.resolve(this.prs); }
  createPullRequest(): Promise<GitHubPullRequest> { throw new Error("not used"); }
  addComment(): never { throw new Error("not used"); }
  closePullRequest(): Promise<void> { throw new Error("not used"); }
  reopenPullRequest(): Promise<void> { throw new Error("not used"); }
  getComments(): Promise<never[]> { return Promise.resolve([]); }
}
function pr(number: number, body: string, head = `kanban/state/${tx}`): GitHubPullRequest {
  return { number, url: `https://github.com/owner/repo/pull/${number}`, title: "state", body, head, base: "main", state: "open", head_commit: "a".repeat(40), merge_commit: null };
}

test("managed PR discovery rejects ambiguity and ignores unrelated PRs", async () => {
  const unrelated = pr(1, "ordinary PR", "feature/x");
  const managed = pr(2, serializePullRequestMarker(marker));
  const found = await discoverManagedPullRequests(new FakeGitHub([unrelated, managed]), { transactionId: tx });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.pullRequest.number, 2);
  await assert.rejects(findUniqueManagedPullRequest(new FakeGitHub([managed, pr(3, serializePullRequestMarker(marker))]), { transactionId: tx }), /ambiguous/);
});
