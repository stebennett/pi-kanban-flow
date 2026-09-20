import test from "node:test";
import assert from "node:assert/strict";
import { runPump } from "../../extensions/kanban-flow/engine/pump.ts";

const request = { schema_version: 1 as const, requested_phase: "none" as const };
const board = { config: { scheduler: { wip_limit: 1 } }, cards: [] } as any;
function lock() {
  return { record: {} as any, lockPath: "", heartbeat: async () => ({} as any), setTransactionId: async () => ({} as any), release: async () => undefined };
}

test("pump reconciles before scheduler and returns stable idle report", async () => {
  const calls: string[] = [];
  const report = await runPump(request, {
    root: "/repo", repositoryId: "owner/repo", packageVersion: "0.0.0-dev", acquireLock: async () => lock(),
    authoritative: async () => { calls.push("authoritative"); return { baseCommit: "a".repeat(40), board }; },
    reconcile: async () => { calls.push("reconcile"); return { kind: "none" }; },
    dispatch: async () => { calls.push("dispatch"); throw new Error("must not dispatch"); },
    transaction: async () => { throw new Error("must not transact"); },
  });
  assert.deepEqual(calls, ["authoritative", "reconcile"]);
  assert.equal(report.status, "no_action");
  assert.equal(report.selected_card_id, "none");
  assert.equal(report.base_commit, "a".repeat(40));
});

test("phase requests never select an alternate card", async () => {
  const card = { id: "CARD-0001", title: "one", status: "backlog", priority: 1, dependencies: [], blocked: null };
  const report = await runPump({ schema_version: 1, requested_phase: "ship" }, {
    root: "/repo", repositoryId: "owner/repo", packageVersion: "0.0.0-dev", acquireLock: async () => lock(),
    authoritative: async () => ({ baseCommit: "b".repeat(40), board: { config: { scheduler: { wip_limit: 1 } }, cards: [card] } as any }),
    reconcile: async () => ({ kind: "none" }),
    dispatch: async () => { throw new Error("must not dispatch"); },
    transaction: async () => { throw new Error("must not transact"); },
  });
  assert.equal(report.status, "phase_not_eligible");
  assert.equal(report.selected_card_id, "none");
  assert.equal(report.action, "none");
});
