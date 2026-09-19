import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitHubPullRequest } from "../../extensions/kanban-flow/state-pr/github.ts";
import { serializeActionMarker } from "../../extensions/kanban-flow/state-pr/markers.ts";
import { executeRequirementsDesignClosures, RequirementsDesignClosureError } from "../../extensions/kanban-flow/reconciliation/requirements.ts";

const operation = "KFOP-20260101T000000000Z-abcdefgh"; const prior = "KFOP-20251201T000000000Z-bcdefghj"; const commit = "a".repeat(40); const base = "b".repeat(40);
const action = { cardId: "CARD-0001", number: 7, url: "https://github.com/owner/repo/pull/7", head: "kanban/design/CARD-0001-scope", headCommit: commit };
function marker(op = operation) { return serializeActionMarker({ version: 1, kind: "requirements-design-close", operation_id: op, card_id: "CARD-0001", criterion: null }); }
function github(options: { state?: "open" | "closed" | "merged"; comments?: string[]; raceMerge?: boolean } = {}) {
  let state = options.state ?? "open"; let merge: string | null = state === "merged" ? "c".repeat(40) : null; const comments = [...(options.comments ?? [])]; let closes = 0;
  const pr = (): GitHubPullRequest => ({ number: 7, url: action.url, title: "Design", body: "", head: action.head, base: "main", state, head_commit: commit, merge_commit: merge });
  return { comments, closes: () => closes, listPullRequests: async () => [pr()], createPullRequest: async () => { throw new Error("unused"); }, addComment: async (_number: number, body: string) => { comments.push(body); return { id: comments.length, body, author: "bot", created_at: "2026-01-01T00:00:00Z" }; }, closePullRequest: async () => { closes++; if (options.raceMerge) { state = "merged"; merge = "c".repeat(40); } else state = "closed"; }, reopenPullRequest: async () => {}, getComments: async () => comments.map((body, index) => ({ id: index + 1, body, author: "bot", created_at: "2026-01-01T00:00:00Z" })) };
}
async function execute(adapter: any, refresh = base) { let ownership = 0; await executeRequirementsDesignClosures({ actions: [action], operationId: operation, baseCommit: base, github: adapter, assertOwnership: async () => { ownership++; }, refreshBase: async () => refresh }); return ownership; }

test("posts one canonical marker before exact close and confirms closed-unmerged identity", async () => {
  const adapter = github(); const heartbeats = await execute(adapter); assert.equal(adapter.comments.length, 1); assert.equal(adapter.comments[0], marker()); assert.equal(adapter.closes(), 1); assert.ok(heartbeats >= 3);
});

test("reuses a prior exact marker and recovers a closed PR without duplicate mutation", async () => {
  const open = github({ comments: [marker(prior)] }); await execute(open); assert.equal(open.comments.length, 1); assert.equal(open.closes(), 1);
  const closed = github({ state: "closed", comments: [marker(prior)] }); await execute(closed); assert.equal(closed.comments.length, 1); assert.equal(closed.closes(), 0);
});

test("merge races, duplicate/conflicting markers, and base changes fail closed", async () => {
  await assert.rejects(() => execute(github({ state: "merged", comments: [marker()] })), (error: any) => error instanceof RequirementsDesignClosureError && error.stale);
  await assert.rejects(() => execute(github({ raceMerge: true })), (error: any) => error instanceof RequirementsDesignClosureError && error.stale);
  await assert.rejects(() => execute(github({ comments: [marker(), marker(prior)] })), /Duplicate/);
  await assert.rejects(() => execute(github({ comments: ["<!-- kanban-flow-action:not-json -->"] })), /Malformed/);
  await assert.rejects(() => execute(github(), "d".repeat(40)), (error: any) => error instanceof RequirementsDesignClosureError && error.stale);
});
