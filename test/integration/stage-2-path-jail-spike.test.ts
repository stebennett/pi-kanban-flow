import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

async function jailed(root: string, path: string): Promise<string> {
  const resolved = await realpath(join(root, path));
  const rel = relative(await realpath(root), resolved);
  if (rel === "" || rel === ".." || rel.startsWith("../")) throw new Error("path escapes jail");
  return resolved;
}

test("realpath jail rejects symlink escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-jail-"));
  const outside = await mkdtemp(join(tmpdir(), "kanban-flow-outside-"));
  try {
    await mkdir(join(root, "safe")); await writeFile(join(root, "safe", "file"), "ok");
    await symlink(outside, join(root, "safe", "escape"));
    assert.equal(await jailed(root, "safe/file"), await realpath(join(root, "safe/file")));
    await assert.rejects(() => jailed(root, "safe/escape"), /escapes jail/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
