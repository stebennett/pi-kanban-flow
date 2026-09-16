import assert from "node:assert/strict";
import { test } from "node:test";
import { posix } from "node:path";
import { repositoryRelativePath } from "../../extensions/kanban-flow/engine/paths.js";

type Entry = Readonly<{ name: string; type: "file" | "directory" | "symlink" | "hardlink" | "special"; linkname?: string }>;

function validateArchiveEntries(entries: readonly Entry[]): void {
  const names = new Set<string>();
  for (const entry of entries) {
    const name = repositoryRelativePath(entry.name);
    if (names.has(name)) throw new Error(`duplicate normalized archive path: ${name}`);
    names.add(name);
    if (entry.type === "special" || entry.type === "hardlink") throw new Error(`unsafe archive entry type: ${entry.type}`);
    if (entry.type === "symlink") {
      if (!entry.linkname) throw new Error("symlink missing target");
      if (entry.linkname.includes("\\0") || entry.linkname.includes("\\") || posix.isAbsolute(entry.linkname)) throw new Error("unsafe symlink target");
      const parent = name.split("/").slice(0, -1).join("/");
      const resolved = posix.normalize(posix.join(parent || ".", entry.linkname));
      if (resolved === ".." || resolved.startsWith("../") || posix.isAbsolute(resolved)) throw new Error("symlink escapes archive root");
    }
  }
}

test("archive-validation prototype rejects path and link escape entries before extraction", () => {
  for (const entry of [
    { name: "/absolute", type: "file" },
    { name: "../traversal", type: "file" },
    { name: "dir/../normalized", type: "file" },
    { name: "node", type: "special" },
    { name: "link", type: "hardlink" },
    { name: "link", type: "symlink", linkname: "../escape" },
    { name: "dir/link", type: "symlink", linkname: "../../escape" },
  ] as const) assert.throws(() => validateArchiveEntries([entry]));
  assert.throws(() => validateArchiveEntries([{ name: "same", type: "file" }, { name: "same", type: "file" }]));
  assert.doesNotThrow(() => validateArchiveEntries([{ name: "dir/file", type: "file" }, { name: "dir/link", type: "symlink", linkname: "file" }, { name: "dir/up", type: "symlink", linkname: "../file" }]));
});
