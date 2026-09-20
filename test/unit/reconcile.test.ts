import test from "node:test";
import assert from "node:assert/strict";
import { reconcileStatePullRequests } from "../../extensions/kanban-flow/engine/reconcile.ts";

test("state reconciliation fails closed for duplicate or unreachable authority", () => {
  const base = { number: 1, url: "https://github.com/o/r/pull/1", marker: "state", mergeCommit: null, reachableFromMain: false, valid: true };
  assert.equal(reconcileStatePullRequests({ freshMainCommit: "a".repeat(40), pullRequests: [{ ...base, state: "open" }, { ...base, number: 2 }] }).kind, "unresolved");
  assert.equal(reconcileStatePullRequests({ freshMainCommit: "a".repeat(40), pullRequests: [{ ...base, state: "merged", mergeCommit: "b".repeat(40) }] }).kind, "unresolved");
});

test("an open state PR is pending and blocks selection", () => {
  const result = reconcileStatePullRequests({ freshMainCommit: "a".repeat(40), pullRequests: [{ number: 1, url: "https://github.com/o/r/pull/1", state: "open", marker: "state", mergeCommit: null, reachableFromMain: false, valid: true }] });
  assert.equal(result.kind, "pending");
});
