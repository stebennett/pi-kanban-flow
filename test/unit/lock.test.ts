import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LockContentionError,
  LockOwnershipLostError,
  StaleLockError,
  acquireLock,
  commonLockPaths,
  forceUnlock,
  readLockRecord,
  validateLockRecord,
} from "../../extensions/kanban-flow/board/lock.ts";

const operationId = "KFOP-20260115T103000000Z-abcdefgh";
const transactionId = "KFTX-20260115T103000000Z-abcdefgh";

async function gitFixture(): Promise<{ root: string; commonDir: string; resolveCommonDir: () => Promise<string> }> {
  const root = await mkdtemp(join(tmpdir(), "pi-kanban-lock-"));
  const commonPath = join(root, ".git");
  await mkdir(commonPath, { mode: 0o700 });
  const commonDir = await realpath(commonPath);
  return { root, commonDir, resolveCommonDir: async () => commonDir };
}

const options = (fixture: Awaited<ReturnType<typeof gitFixture>>, extra: Record<string, unknown> = {}) => ({
  cwd: fixture.root,
  repositoryId: "owner/repo",
  operationId,
  command: "kanban" as const,
  ttlSeconds: 1800,
  resolveCommonDir: fixture.resolveCommonDir,
  now: () => new Date("2026-01-15T10:30:00.000Z"),
  isProcessAlive: () => false,
  ...extra,
});

test("acquires a common-directory lock and updates it atomically", async (t) => {
  const fixture = await gitFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const handle = await acquireLock(options(fixture));
  const paths = commonLockPaths(fixture.commonDir);
  assert.equal(handle.lockPath, paths.lock);
  const stored = JSON.parse(await readFile(paths.lock, "utf8"));
  assert.equal(stored.owner_token.length, 64);
  assert.equal(stored.transaction_id, null);
  assert.equal((await readLockRecord({ cwd: fixture.root, resolveCommonDir: fixture.resolveCommonDir, repositoryId: "owner/repo" }))?.operation_id, operationId);
  const updated = await handle.setTransactionId(transactionId);
  assert.equal(updated.transaction_id, transactionId);
  const heartbeat = await handle.heartbeat(new Date("2026-01-15T10:31:00.000Z"));
  assert.equal(heartbeat.heartbeat_at, "2026-01-15T10:31:00.000Z");
  await handle.release();
  assert.equal(await readLockRecord({ cwd: fixture.root, resolveCommonDir: fixture.resolveCommonDir }), null);
});

test("reports contention without changing the existing owner", async (t) => {
  const fixture = await gitFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const first = await acquireLock(options(fixture));
  await assert.rejects(acquireLock(options(fixture, { operationId: "KFOP-20260115T103001000Z-bcdefghj" })), (error: unknown) => error instanceof LockContentionError && error.owner.operationId === operationId);
  await first.release();
});

test("recovers an expired same-host lock only when its process is proven dead", async (t) => {
  const fixture = await gitFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  let now = new Date("2026-01-15T10:30:00.000Z");
  const first = await acquireLock(options(fixture, { now: () => now, pid: 999991 }));
  await first.release();
  const stale = await acquireLock(options(fixture, { now: () => new Date("2026-01-15T11:00:01.000Z"), pid: 999991 }));
  await stale.release();

  const held = await acquireLock(options(fixture, { now: () => now, pid: 999991 }));
  const path = commonLockPaths(fixture.commonDir).lock;
  const record = JSON.parse(await readFile(path, "utf8"));
  record.started_at = "2026-01-15T10:00:00.000Z";
  record.heartbeat_at = "2026-01-15T10:00:00.000Z";
  record.expires_at = "2026-01-15T10:30:00.000Z";
  await writeFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await assert.rejects(acquireLock(options(fixture, { now: () => new Date("2026-01-15T11:00:01.000Z"), pid: 999992, isProcessAlive: () => true })), StaleLockError);
  // The original owner remains responsible for releasing the record even after the test mutation.
  await held.release().catch(() => undefined);
});

test("refuses insecure lock files and force unlock requires repository confirmation", async (t) => {
  const fixture = await gitFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const handle = await acquireLock(options(fixture));
  const path = commonLockPaths(fixture.commonDir).lock;
  await chmod(path, 0o644);
  await assert.rejects(readLockRecord({ cwd: fixture.root, resolveCommonDir: fixture.resolveCommonDir }), /insecure permissions/);
  await assert.rejects(forceUnlock({ cwd: fixture.root, repositoryId: "owner/repo", confirm: "wrong", resolveCommonDir: fixture.resolveCommonDir }), /requires confirmation/);
  await chmod(path, 0o600);
  await forceUnlock({ cwd: fixture.root, repositoryId: "owner/repo", confirm: "owner/repo", resolveCommonDir: fixture.resolveCommonDir });
  await assert.rejects(handle.release(), LockOwnershipLostError);
});

test("force unlock removes a corrupt regular lock but no unrelated temporary files", async (t) => {
  const fixture = await gitFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const handle = await acquireLock(options(fixture));
  const path = commonLockPaths(fixture.commonDir).lock;
  const stored = JSON.parse(await readFile(path, "utf8")) as { owner_token: string };
  const ownedTemp = `${path}.${stored.owner_token}.owned.tmp`;
  const unrelatedTemp = `${path}.other.tmp`;
  await writeFile(ownedTemp, "temporary", { mode: 0o600 });
  await writeFile(unrelatedTemp, "keep", { mode: 0o600 });
  await writeFile(path, JSON.stringify({ repository_id: "owner/repo", git_common_dir: fixture.commonDir, owner_token: stored.owner_token, unexpected: true }), { mode: 0o600 });
  await forceUnlock({ cwd: fixture.root, repositoryId: "owner/repo", confirm: "owner/repo", resolveCommonDir: fixture.resolveCommonDir });
  await assert.rejects(access(path));
  await assert.rejects(access(ownedTemp));
  await access(unrelatedTemp);
  await handle.release().catch(() => undefined);
});

test("configured TTL is validated before creating or reading a lock", async (t) => {
  const fixture = await gitFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await assert.rejects(acquireLock(options(fixture, { ttlSeconds: 59 })), /TTL/);
  await assert.rejects(access(join(fixture.commonDir, "kanban-flow")));
  const handle = await acquireLock(options(fixture));
  await assert.rejects(readLockRecord({ cwd: fixture.root, resolveCommonDir: fixture.resolveCommonDir, repositoryId: "owner/repo", ttlSeconds: 60 }), /expiry/);
  await handle.release();
});

test("strict lock records reject unknown fields and invalid expiry", () => {
  const record = {
    version: 1,
    repository_id: "owner/repo",
    git_common_dir: "/tmp/repo/.git",
    operation_id: operationId,
    transaction_id: null,
    owner_token: "a".repeat(64),
    pid: 10,
    host: "host",
    pi_session_id: null,
    started_at: "2026-01-15T10:30:00.000Z",
    heartbeat_at: "2026-01-15T10:30:00.000Z",
    expires_at: "2026-01-15T11:00:00.000Z",
    command: "kanban",
  };
  assert.equal(validateLockRecord(record, { repositoryId: "owner/repo", commonDir: "/tmp/repo/.git", ttlSeconds: 1800 }).owner_token, "a".repeat(64));
  assert.throws(() => validateLockRecord({ ...record, extra: true }), /strict schema/);
  assert.throws(() => validateLockRecord({ ...record, expires_at: "2026-01-15T11:00:01.000Z" }, { ttlSeconds: 1800 }), /expiry/);
});
