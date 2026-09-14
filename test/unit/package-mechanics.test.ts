import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSupportedPiVersion, isSupportedPiVersion } from "../../extensions/kanban-flow/index.ts";
import { packageRoot, resolvePackageAsset } from "../../extensions/kanban-flow/paths.ts";

test("accepts only the tested Pi minor range", () => {
  assert.equal(isSupportedPiVersion("0.85.0"), true);
  assert.equal(isSupportedPiVersion("0.85.99"), true);
  assert.equal(isSupportedPiVersion("0.84.9"), false);
  assert.equal(isSupportedPiVersion("0.86.0"), false);
  assert.equal(isSupportedPiVersion("0.85.0-rc.1"), false);
  assert.equal(isSupportedPiVersion("not-a-version"), false);
  assert.throws(() => assertSupportedPiVersion("0.86.0"), /requires Pi/);
});

test("resolves an asset from the canonical package root", async () => {
  const root = await packageRoot();
  assert.match(root, /pi-kanban-flow$/);
  assert.equal(await resolvePackageAsset("package.json"), `${root}/package.json`);
  await assert.rejects(resolvePackageAsset("does-not-exist"), /asset is missing/);
  await assert.rejects(resolvePackageAsset("../package.json"), /asset is missing/);
});
