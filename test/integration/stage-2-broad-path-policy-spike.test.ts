import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { repositoryRelativePath } from "../../extensions/kanban-flow/engine/paths.js";

type Action = "create" | "modify" | "delete";

function authorize(root: string, planned: ReadonlyMap<string, Action>, path: string, action: Action): string {
  const normalized = repositoryRelativePath(path);
  if (normalized === ".git" || normalized.startsWith(".git/") || normalized.startsWith(".kanban/") || normalized.startsWith("design/")) {
    throw new Error(`protected child path: ${normalized}`);
  }
  if (planned.get(normalized) !== action) throw new Error(`unplanned or wrong action: ${normalized}`);
  const candidate = resolve(root, normalized);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith("../") || resolve(root, rel) !== candidate) throw new Error("worktree escape");
  return candidate;
}

test("broad path-policy prototype binds normalized paths to planned actions and protected roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-broad-path-spike-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "existing.ts"), "export {};\n");
    await symlink("/tmp", join(root, "src", "outside"));
    const planned = new Map<string, Action>([["src/new.ts", "create"], ["src/existing.ts", "modify"]]);
    assert.equal(authorize(root, planned, "src/new.ts", "create"), join(root, "src", "new.ts"));
    assert.throws(() => authorize(root, planned, "src/new.ts", "modify"), /wrong action/);
    assert.throws(() => authorize(root, planned, ".git/config", "modify"), /protected/);
    assert.throws(() => authorize(root, planned, ".kanban/board.yaml", "modify"), /protected/);
    assert.throws(() => authorize(root, planned, "design/doc.md", "create"), /protected/);
    assert.throws(() => authorize(root, planned, "../outside", "create"), /invalid repository-relative/);
    assert.throws(() => authorize(root, planned, "src/outside/pwned", "create"), /unplanned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
