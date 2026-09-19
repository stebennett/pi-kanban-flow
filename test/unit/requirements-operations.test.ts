import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareOperationRecordStore } from "../../extensions/kanban-flow/requirements/operations.ts";

const current = "KFOP-20260110T000000000Z-abcdefgh"; const expired = "KFOP-20260101T000000000Z-bcdefghj";
test("operation records are private, bounded, and purge only expired operation directories", async () => {
  const common = await mkdtemp(join(tmpdir(), "kanban-operations-")); try {
    const root = join(common, "kanban-flow", "operations"); await mkdir(join(root, expired), { recursive: true }); await writeFile(join(root, expired, "outcome.json"), "{}\n"); await utimes(join(root, expired), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")); await mkdir(join(root, "unrelated"));
    const store = await prepareOperationRecordStore(common, current, new Date("2026-01-10T00:00:00Z")); await store.finish({ version: 1, status: "cancelled" });
    assert.equal((await stat(root)).mode & 0o777, 0o700); assert.equal((await stat(store.directory)).mode & 0o777, 0o700); assert.equal((await stat(join(store.directory, "outcome.json"))).mode & 0o777, 0o600); assert.equal(await readFile(join(store.directory, "outcome.json"), "utf8"), '{"version":1,"status":"cancelled"}\n'); await assert.rejects(stat(join(root, expired))); assert.ok(await stat(join(root, "unrelated")));
    await assert.rejects(() => store.finish({ version: 1 }), /EEXIST/);
  } finally { await chmod(common, 0o700).catch(() => undefined); await rm(common, { recursive: true, force: true }); }
});
