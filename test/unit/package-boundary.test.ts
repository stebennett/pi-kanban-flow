import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const listing = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const files = JSON.parse(listing)[0].files.map((entry: { path: string }) => entry.path);

test("package boundary includes runtime entry points and excludes fixtures/tests", () => {
  assert.ok(files.includes("extensions/kanban-flow/index.ts"));
  assert.ok(files.includes("extensions/kanban-flow/paths.ts"));
  assert.ok(!files.some((file: string) => file.startsWith("reference/")));
  assert.ok(!files.some((file: string) => file.startsWith("test/")));
});
