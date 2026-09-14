import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { kill as processKill } from "node:process";
import { hostname } from "node:os";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, rm, unlink, lstat, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Value } from "typebox/value";
import { isRuntimeId, isUtcTimestamp, runtimeId } from "../engine/ids.ts";
import { LeaseLockSchema, LeaseMutexSchema, type LeaseLock } from "./schemas.ts";

const LOCK_DIRECTORY = "kanban-flow";
const LOCK_FILE = "lock.json";
const MUTEX_FILE = "lease-mutex.json";
const MUTEX_TTL_MS = 10_000;
const LOCK_COMMANDS = new Set(["kanban", "kanban-init", "requirements", "migrate", "state-recovery", "blocker-resolution"]);
const MAX_PREVIEW_LENGTH = 512;

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export type DirectProcess = (executable: string, args: readonly string[], cwd: string) => Promise<ProcessResult>;
export type GitCommonDirResolver = (cwd: string) => Promise<string>;
export type ProcessAlive = (pid: number, host: string) => boolean | Promise<boolean>;
export type Clock = () => Date;

export interface LockOptions {
  readonly cwd: string;
  readonly repositoryId: string;
  readonly operationId?: string;
  readonly transactionId?: string | null;
  readonly command: LeaseLock["command"];
  readonly ttlSeconds: number;
  readonly piSessionId?: string | null;
  readonly pid?: number;
  readonly host?: string;
  readonly now?: Clock;
  readonly resolveCommonDir?: GitCommonDirResolver;
  readonly process?: DirectProcess;
  readonly isProcessAlive?: ProcessAlive;
}

export interface LockHandle {
  readonly record: LeaseLock;
  readonly lockPath: string;
  heartbeat(now?: Date): Promise<LeaseLock>;
  setTransactionId(transactionId: string): Promise<LeaseLock>;
  release(): Promise<void>;
}

export interface LockOwnerSummary {
  readonly host: string;
  readonly pid: number;
  readonly piSessionId: string | null;
  readonly operationId: string;
  readonly transactionId: string | null;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

export class LockContentionError extends LockError {
  readonly owner: LockOwnerSummary;
  constructor(owner: LockOwnerSummary) {
    super(`kanban-flow lock is held by ${owner.host}:${owner.pid} (operation ${owner.operationId}, expires ${owner.expiresAt})`);
    this.name = "LockContentionError";
    this.owner = owner;
  }
}

export class StaleLockError extends LockError {
  readonly record: LeaseLock;
  constructor(record: LeaseLock, message = `expired kanban-flow lock cannot be recovered safely (owner ${record.host}:${record.pid})`) {
    super(message);
    this.name = "StaleLockError";
    this.record = record;
  }
}

export class CorruptLockError extends LockError {
  readonly path: string;
  readonly preview: string;
  readonly sha256: string;
  constructor(path: string, raw: string, message: string) {
    const preview = raw.slice(0, MAX_PREVIEW_LENGTH);
    super(`${message}; ${path}; sha256=${createHash("sha256").update(raw).digest("hex")}; preview=${JSON.stringify(preview)}`);
    this.name = "CorruptLockError";
    this.path = path;
    this.preview = preview;
    this.sha256 = createHash("sha256").update(raw).digest("hex");
  }
}

export class LockOwnershipLostError extends LockError {
  constructor(message = "kanban-flow lock ownership was lost") {
    super(message);
    this.name = "LockOwnershipLostError";
  }
}

export function commonLockPaths(commonDir: string): { directory: string; lock: string; mutex: string } {
  if (!isAbsolute(commonDir)) throw new LockError("Git common directory must be absolute");
  const directory = join(commonDir, LOCK_DIRECTORY);
  return { directory, lock: join(directory, LOCK_FILE), mutex: join(directory, MUTEX_FILE) };
}

/** Resolve the canonical common Git directory using executable plus argv, never a shell. */
export async function resolveGitCommonDir(cwd: string, processRunner: DirectProcess = runDirectProcess): Promise<string> {
  const result = await processRunner("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (result.code !== 0) throw new LockError(`cannot resolve Git common directory: ${bounded(result.stderr || result.stdout)}`);
  const value = result.stdout.trim();
  if (!value || !isAbsolute(value) || value.includes("\0") || value.includes("\n")) {
    throw new LockError("Git returned an invalid common directory");
  }
  return canonicalDirectory(value);
}

async function runDirectProcess(executable: string, args: readonly string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ stdout, stderr, code: code ?? 1 }));
  });
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpathChecked(path, "Git common directory");
  if (!isAbsolute(canonical)) throw new LockError("Git common directory is not absolute");
  return canonical;
}

async function realpathChecked(path: string, label: string): Promise<string> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new LockError(`${label} does not exist`);
  if (info.isSymbolicLink()) throw new LockError(`${label} is a symlink`);
  if (!info.isDirectory()) throw new LockError(`${label} is not a directory`);
  return realpath(path);
}

function bounded(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, MAX_PREVIEW_LENGTH);
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function ensureTimestamp(value: string, label: string): number {
  if (!isUtcTimestamp(value)) throw new LockError(`${label} is not a UTC RFC 3339 timestamp`);
  return new Date(value).getTime();
}

function validateLockSemantics(record: LeaseLock, expected?: { repositoryId?: string; commonDir?: string; ttlSeconds?: number }): LeaseLock {
  if (!Value.Check(LeaseLockSchema, record)) throw new LockError("lock record does not match its strict schema");
  if (!LOCK_COMMANDS.has(record.command)) throw new LockError("lock record has an invalid command");
  const started = ensureTimestamp(record.started_at, "lock started_at");
  const heartbeat = ensureTimestamp(record.heartbeat_at, "lock heartbeat_at");
  const expires = ensureTimestamp(record.expires_at, "lock expires_at");
  if (started > heartbeat || heartbeat >= expires) throw new LockError("lock timestamps are out of order");
  if (expected?.ttlSeconds !== undefined && expires !== heartbeat + expected.ttlSeconds * 1000) {
    throw new LockError("lock expiry does not equal heartbeat plus configured TTL");
  }
  if (expected?.repositoryId !== undefined && record.repository_id !== expected.repositoryId) throw new LockError("lock repository identity does not match");
  if (expected?.commonDir !== undefined && record.git_common_dir !== expected.commonDir) throw new LockError("lock Git common directory does not match");
  return record;
}

export function validateLockRecord(record: unknown, expected?: { repositoryId?: string; commonDir?: string; ttlSeconds?: number }): LeaseLock {
  return validateLockSemantics(record as LeaseLock, expected);
}

function validateMutexSemantics(record: unknown): void {
  if (!Value.Check(LeaseMutexSchema, record)) throw new LockError("lease mutex record does not match its strict schema");
  const mutex = record as { acquired_at: string; expires_at: string };
  const acquired = ensureTimestamp(mutex.acquired_at, "mutex acquired_at");
  const expires = ensureTimestamp(mutex.expires_at, "mutex expires_at");
  if (expires !== acquired + MUTEX_TTL_MS) throw new LockError("mutex expiry must be exactly ten seconds after acquisition");
}

async function ensureLockDirectory(commonDir: string): Promise<string> {
  const paths = commonLockPaths(commonDir);
  const parent = await canonicalDirectory(commonDir);
  if (parent !== commonDir) throw new LockError("Git common directory is not canonical");
  const existing = await lstat(paths.directory).catch(() => undefined);
  if (existing?.isSymbolicLink()) throw new LockError("kanban-flow lock directory is a symlink");
  if (existing && !existing.isDirectory()) throw new LockError("kanban-flow lock directory is not a directory");
  if (!existing) await mkdir(paths.directory, { recursive: false, mode: 0o700 });
  const info = await lstat(paths.directory);
  if (info.isSymbolicLink() || !info.isDirectory() || info.nlink < 2) throw new LockError("kanban-flow lock directory is unsafe");
  await assertSecureMode(paths.directory, 0o700, "kanban-flow lock directory");
  return paths.directory;
}

async function assertSecureMode(path: string, ownerMode: number, label: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new LockError(`${label} disappeared`);
  if (info.isSymbolicLink() || (ownerMode === 0o600 ? info.nlink !== 1 : info.nlink < 2)) throw new LockError(`${label} is unsafe`);
  if ((info.mode & fsConstants.S_IFMT) !== (ownerMode === 0o700 ? fsConstants.S_IFDIR : fsConstants.S_IFREG)) throw new LockError(`${label} has an invalid file type`);
  if ((info.mode & 0o077) !== 0 || (info.mode & ownerMode) !== ownerMode) throw new LockError(`${label} has insecure permissions`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new LockError(`${label} has unexpected ownership`);
}

async function readRaw(path: string, label: string): Promise<string | null> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new CorruptLockError(path, "", `${label} is not a safe regular file`);
  await assertSecureMode(path, 0o600, label);
  return readFile(path, "utf8");
}

async function readLock(path: string, expected?: { repositoryId?: string; commonDir?: string; ttlSeconds?: number }): Promise<LeaseLock | null> {
  const raw = await readRaw(path, "lock.json");
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new CorruptLockError(path, raw, "lock.json contains invalid JSON"); }
  try { return validateLockSemantics(parsed as LeaseLock, expected); } catch (error) {
    if (error instanceof CorruptLockError) throw error;
    throw new CorruptLockError(path, raw, error instanceof Error ? error.message : "invalid lock record");
  }
}

async function readMutex(path: string): Promise<{ version: 1; owner_token: string; pid: number; host: string; acquired_at: string; expires_at: string } | null> {
  const raw = await readRaw(path, "lease-mutex.json");
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new CorruptLockError(path, raw, "lease-mutex.json contains invalid JSON"); }
  try { validateMutexSemantics(parsed); } catch (error) {
    throw new CorruptLockError(path, raw, error instanceof Error ? error.message : "invalid mutex record");
  }
  return parsed as { version: 1; owner_token: string; pid: number; host: string; acquired_at: string; expires_at: string };
}

async function createExclusiveJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(canonicalJson(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertSecureMode(path, 0o600, path.endsWith(MUTEX_FILE) ? "lease-mutex.json" : "lock.json");
}

async function removeIfOwned(path: string, ownerToken: string): Promise<void> {
  const raw = await readRaw(path, path.endsWith(MUTEX_FILE) ? "lease-mutex.json" : "lock.json");
  if (raw === null) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new CorruptLockError(path, raw, "cannot remove malformed ownership record"); }
  if (!parsed || typeof parsed !== "object" || (parsed as { owner_token?: unknown }).owner_token !== ownerToken) return;
  await unlink(path);
}

async function unlinkSafeRegularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return;
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new CorruptLockError(path, "", `${label} is not a safe regular file`);
  await assertSecureMode(path, 0o600, label);
  await unlink(path);
}

async function removeMatchingTemporaryFiles(directory: string, ownerToken: string): Promise<void> {
  const prefix = `${LOCK_FILE}.${ownerToken}.`;
  for (const name of await readdir(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
    await unlinkSafeRegularFile(join(directory, name), "lock temporary file");
  }
}

async function acquireMutex(directory: string, options: { now: Clock; host: string; pid: number; isProcessAlive: ProcessAlive }): Promise<{ path: string; token: string }> {
  const path = join(directory, MUTEX_FILE);
  const token = randomBytes(32).toString("hex");
  const now = options.now();
  const record = { version: 1 as const, owner_token: token, pid: options.pid, host: options.host, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + MUTEX_TTL_MS).toISOString() };
  try {
    await createExclusiveJson(path, record);
    return { path, token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readMutex(path);
    if (!existing) throw new LockError("lease mutex disappeared during acquisition");
    const expired = new Date(existing.expires_at).getTime() <= now.getTime();
    if (!expired) throw new LockContentionError({ host: existing.host, pid: existing.pid, piSessionId: null, operationId: "mutex", transactionId: null, startedAt: existing.acquired_at, heartbeatAt: existing.acquired_at, expiresAt: existing.expires_at });
    if (existing.host !== options.host || await options.isProcessAlive(existing.pid, existing.host)) throw new StaleLockError({
      version: 1, repository_id: "unknown/unknown", git_common_dir: directory, operation_id: "KFOP-00000000T000000000Z-aaaaaaaa", transaction_id: null,
      owner_token: existing.owner_token, pid: existing.pid, host: existing.host, pi_session_id: null, started_at: existing.acquired_at,
      heartbeat_at: existing.acquired_at, expires_at: new Date(now.getTime()).toISOString(), command: "kanban",
    }, "expired lease mutex cannot be recovered safely");
    await removeIfOwned(path, existing.owner_token);
    await createExclusiveJson(path, record);
    return { path, token };
  }
}

async function releaseMutex(mutex: { path: string; token: string }): Promise<void> {
  await removeIfOwned(mutex.path, mutex.token);
}

async function withMutex<T>(directory: string, options: { now: Clock; host: string; pid: number; isProcessAlive: ProcessAlive }, action: (mutex: { path: string; token: string }) => Promise<T>): Promise<T> {
  const mutex = await acquireMutex(directory, options);
  try {
    return await action(mutex);
  } finally {
    await releaseMutex(mutex);
  }
}

function defaultAlive(pid: number, host: string): boolean {
  if (host !== hostname()) return true;
  try { processKill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function normalizeOptions(options: LockOptions, commonDir: string): Required<Pick<LockOptions, "ttlSeconds" | "pid" | "host" | "now" | "isProcessAlive">> & Pick<LockOptions, "repositoryId" | "command" | "piSessionId"> {
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 60 || options.ttlSeconds > 86400) throw new LockError("lock TTL must be an integer from 60 through 86400 seconds");
  if (!options.repositoryId || !options.command || !LOCK_COMMANDS.has(options.command)) throw new LockError("invalid lock identity or command");
  const pid = options.pid ?? process.pid;
  const host = options.host ?? hostname();
  const now = options.now ?? (() => new Date());
  const isProcessAlive = options.isProcessAlive ?? defaultAlive;
  if (!Number.isInteger(pid) || pid < 1 || !host || host.length > 255 || /[\0\r\n]/.test(host)) throw new LockError("invalid lock process identity");
  if (options.piSessionId !== undefined && options.piSessionId !== null && (!options.piSessionId || options.piSessionId.length > 255 || /[\0\r\n]/.test(options.piSessionId))) throw new LockError("invalid Pi session ID");
  void commonDir;
  return { ttlSeconds: options.ttlSeconds, pid, host, now, isProcessAlive, repositoryId: options.repositoryId, command: options.command, piSessionId: options.piSessionId ?? null };
}

async function atomicReplace(path: string, value: unknown, ownerToken: string): Promise<void> {
  const temporary = `${path}.${ownerToken}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await createExclusiveJson(temporary, value);
    const currentRaw = await readRaw(path, "lock.json");
    if (currentRaw === null) throw new LockOwnershipLostError();
    let current: unknown;
    try { current = JSON.parse(currentRaw); } catch { throw new CorruptLockError(path, currentRaw, "cannot verify lock ownership"); }
    if (!current || typeof current !== "object" || (current as { owner_token?: unknown }).owner_token !== ownerToken) throw new LockOwnershipLostError();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch((error) => { throw new LockError(`failed to clean lock temporary file: ${error instanceof Error ? error.message : String(error)}`); });
  }
}

function ownerSummary(record: LeaseLock): LockOwnerSummary {
  return { host: record.host, pid: record.pid, piSessionId: record.pi_session_id, operationId: record.operation_id, transactionId: record.transaction_id, startedAt: record.started_at, heartbeatAt: record.heartbeat_at, expiresAt: record.expires_at };
}

/** Acquire the project lock in the repository's common Git directory. */
export async function acquireLock(options: LockOptions): Promise<LockHandle> {
  const resolver = options.resolveCommonDir ?? ((cwd: string) => resolveGitCommonDir(cwd, options.process ?? runDirectProcess));
  const commonDir = await canonicalDirectory(await resolver(resolve(options.cwd)));
  const normalized = normalizeOptions(options, commonDir);
  const directory = await ensureLockDirectory(commonDir);
  const operationId = options.operationId ?? runtimeId("KFOP", normalized.now());
  if (!isRuntimeId(operationId, "KFOP")) throw new LockError("invalid lock operation ID");
  if (options.transactionId !== undefined && options.transactionId !== null && !isRuntimeId(options.transactionId, "KFTX")) throw new LockError("invalid lock transaction ID");
  const started = normalized.now();
  const record: LeaseLock = {
    version: 1,
    repository_id: normalized.repositoryId,
    git_common_dir: commonDir,
    operation_id: operationId,
    transaction_id: options.transactionId ?? null,
    owner_token: randomBytes(32).toString("hex"),
    pid: normalized.pid,
    host: normalized.host,
    pi_session_id: normalized.piSessionId ?? null,
    started_at: started.toISOString(),
    heartbeat_at: started.toISOString(),
    expires_at: new Date(started.getTime() + normalized.ttlSeconds * 1000).toISOString(),
    command: normalized.command,
  };
  validateLockSemantics(record, { repositoryId: normalized.repositoryId, commonDir, ttlSeconds: normalized.ttlSeconds });
  const mutexOptions = { now: normalized.now, host: normalized.host, pid: normalized.pid, isProcessAlive: normalized.isProcessAlive };
  await withMutex(directory, mutexOptions, async () => {
    const existing = await readLock(commonLockPaths(commonDir).lock, { repositoryId: normalized.repositoryId, commonDir, ttlSeconds: normalized.ttlSeconds });
    if (existing) {
      const expired = new Date(existing.expires_at).getTime() <= normalized.now().getTime();
      if (!expired) throw new LockContentionError(ownerSummary(existing));
      if (existing.host !== normalized.host || await normalized.isProcessAlive(existing.pid, existing.host)) throw new StaleLockError(existing);
      await removeIfOwned(commonLockPaths(commonDir).lock, existing.owner_token);
    }
    await createExclusiveJson(commonLockPaths(commonDir).lock, record);
  });
  let released = false;
  const mutate = async (next: LeaseLock): Promise<LeaseLock> => {
    if (released) throw new LockOwnershipLostError("lock handle is already released");
    validateLockSemantics(next, { repositoryId: normalized.repositoryId, commonDir, ttlSeconds: normalized.ttlSeconds });
    await withMutex(directory, mutexOptions, async () => {
      const current = await readLock(commonLockPaths(commonDir).lock, { repositoryId: normalized.repositoryId, commonDir, ttlSeconds: normalized.ttlSeconds });
      if (!current || current.owner_token !== record.owner_token) throw new LockOwnershipLostError();
      await atomicReplace(commonLockPaths(commonDir).lock, next, record.owner_token);
    });
    record.heartbeat_at = next.heartbeat_at;
    record.expires_at = next.expires_at;
    record.transaction_id = next.transaction_id;
    return Object.freeze({ ...next });
  };
  return {
    get record() { return Object.freeze({ ...record }); },
    lockPath: commonLockPaths(commonDir).lock,
    heartbeat: async (at = normalized.now()) => {
      const heartbeat = at.toISOString();
      return mutate({ ...record, heartbeat_at: heartbeat, expires_at: new Date(at.getTime() + normalized.ttlSeconds * 1000).toISOString() });
    },
    setTransactionId: async (transactionId: string) => {
      if (!isRuntimeId(transactionId, "KFTX")) throw new LockError("invalid lock transaction ID");
      return mutate({ ...record, transaction_id: transactionId });
    },
    release: async () => {
      if (released) return;
      await withMutex(directory, mutexOptions, async () => {
        const current = await readLock(commonLockPaths(commonDir).lock, { repositoryId: normalized.repositoryId, commonDir, ttlSeconds: normalized.ttlSeconds });
        if (!current || current.owner_token !== record.owner_token) throw new LockOwnershipLostError();
        await unlink(commonLockPaths(commonDir).lock);
      });
      released = true;
    },
  };
}

export async function readLockRecord(options: { cwd: string; resolveCommonDir?: GitCommonDirResolver; process?: DirectProcess; repositoryId?: string; ttlSeconds?: number }): Promise<LeaseLock | null> {
  const resolver = options.resolveCommonDir ?? ((cwd: string) => resolveGitCommonDir(cwd, options.process ?? runDirectProcess));
  const commonDir = await canonicalDirectory(await resolver(resolve(options.cwd)));
  const paths = commonLockPaths(commonDir);
  await ensureLockDirectory(commonDir);
  return readLock(paths.lock, { ...(options.repositoryId ? { repositoryId: options.repositoryId } : {}), commonDir, ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }) });
}

export async function forceUnlock(options: { cwd: string; repositoryId: string; confirm: string | (() => boolean | Promise<boolean>); resolveCommonDir?: GitCommonDirResolver; process?: DirectProcess; pid?: number; host?: string; now?: Clock; isProcessAlive?: ProcessAlive }): Promise<void> {
  const resolver = options.resolveCommonDir ?? ((cwd: string) => resolveGitCommonDir(cwd, options.process ?? runDirectProcess));
  const commonDir = await canonicalDirectory(await resolver(resolve(options.cwd)));
  const directory = await ensureLockDirectory(commonDir);
  const normalized = { pid: options.pid ?? process.pid, host: options.host ?? hostname(), now: options.now ?? (() => new Date()), isProcessAlive: options.isProcessAlive ?? defaultAlive };
  const confirmed = typeof options.confirm === "function" ? await options.confirm() : options.confirm === options.repositoryId;
  if (!confirmed) throw new LockError("force unlock requires confirmation containing the repository identity");
  await withMutex(directory, normalized, async () => {
    const path = commonLockPaths(commonDir).lock;
    const raw = await readRaw(path, "lock.json");
    if (raw === null) return;

    // Force unlock is the explicit recovery path for a corrupt JSON record. Do
    // not trust malformed fields, and never follow a symlink or remove a hard
    // link. A validated token is used only to clean matching temporary files.
    let parsed: unknown;
    let token: string | undefined;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (parsed && typeof parsed === "object") {
      const candidate = parsed as Partial<LeaseLock>;
      if (candidate.repository_id !== undefined && candidate.repository_id !== options.repositoryId) throw new LockError("force unlock repository identity does not match");
      if (candidate.git_common_dir !== undefined && candidate.git_common_dir !== commonDir) throw new LockError("force unlock Git common directory does not match");
      if (candidate.owner_token !== undefined && typeof candidate.owner_token === "string" && /^[0-9a-f]{64}$/.test(candidate.owner_token)) {
        token = candidate.owner_token;
      }
    }
    await unlinkSafeRegularFile(path, "lock.json");
    if (token) await removeMatchingTemporaryFiles(directory, token);
  });
}

export const updateLockTransactionId = async (handle: LockHandle, transactionId: string): Promise<LeaseLock> => handle.setTransactionId(transactionId);
export const heartbeatLock = async (handle: LockHandle, now?: Date): Promise<LeaseLock> => handle.heartbeat(now);
export const releaseLock = async (handle: LockHandle): Promise<void> => handle.release();
