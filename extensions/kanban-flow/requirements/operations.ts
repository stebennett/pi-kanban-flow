import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRuntimeId } from "../engine/ids.ts";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export interface OperationRecordStore { directory: string; finish(value: Readonly<Record<string, unknown>>): Promise<void> }

/** Create one private machine-local record directory and purge only expired valid operation directories. */
export async function prepareOperationRecordStore(commonDirectory: string, operationId: string, now = new Date()): Promise<OperationRecordStore> {
  if (!isRuntimeId(operationId, "KFOP")) throw new Error("Operation record ID is invalid");
  const root = join(commonDirectory, "kanban-flow", "operations"); await mkdir(root, { recursive: true, mode: 0o700 }); const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Operation record root is unsafe"); await (await import("node:fs/promises")).chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!isRuntimeId(entry.name, "KFOP")) continue;
    const path = join(root, entry.name); const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Operation record entry is unsafe: ${entry.name}`);
    if (now.getTime() - info.mtimeMs > RETENTION_MS) await rm(path, { recursive: true, force: false });
  }
  const directory = join(root, operationId); await mkdir(directory, { mode: 0o700 });
  return { directory, async finish(value) {
    const bytes = `${JSON.stringify(value)}\n`; if (Buffer.byteLength(bytes) > 200_000 || /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(bytes)) throw new Error("Operation record is unsafe or exceeds its limit");
    await writeFile(join(directory, "outcome.json"), bytes, { mode: 0o600, flag: "wx" });
  } };
}
