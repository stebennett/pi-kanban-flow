import assert from "node:assert/strict";
import { test } from "node:test";
import { isNumericId, isObjectId, isRuntimeId, isUtcTimestamp, numericId, runtimeId } from "../../extensions/kanban-flow/engine/ids.ts";
import { repositoryRelativePath, sortedUniquePaths } from "../../extensions/kanban-flow/engine/paths.ts";

test("numeric and runtime identifiers are exact", () => {
  assert.equal(numericId("CARD", 1), "CARD-0001");
  assert.equal(isNumericId("REQ-0001", "REQ"), true);
  assert.equal(isNumericId("REQ-0000", "REQ"), false);
  const id = runtimeId("KFTX", new Date("2026-01-15T10:30:00.123Z"), "abcdefgh");
  assert.equal(id, "KFTX-20260115T103000123Z-abcdefgh");
  assert.equal(isRuntimeId(id, "KFTX"), true);
});

test("timestamps and object IDs accept only durable forms", () => {
  assert.equal(isUtcTimestamp("2026-01-15T10:30:00Z"), true);
  assert.equal(isUtcTimestamp("2026-01-15T10:30:00.123Z"), true);
  assert.equal(isUtcTimestamp("2026-01-15T10:30:00+00:00"), false);
  assert.equal(isObjectId("a".repeat(40)), true);
  assert.equal(isObjectId("a".repeat(64)), true);
  assert.equal(isObjectId("a".repeat(39)), false);
});

test("repository paths are normalized and contained", () => {
  assert.equal(repositoryRelativePath("docs/cards/CARD-0001.md"), "docs/cards/CARD-0001.md");
  assert.throws(() => repositoryRelativePath("../escape"));
  assert.throws(() => repositoryRelativePath("docs\\cards\\x"));
  assert.deepEqual(sortedUniquePaths(["b", "a"]), ["a", "b"]);
  assert.throws(() => sortedUniquePaths(["a", "a"]));
});
