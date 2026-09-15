import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { packageRoot, resolvePackageAsset } from "../../extensions/kanban-flow/paths.ts";

const listing = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const files = JSON.parse(listing)[0].files.map((entry: { path: string }) => entry.path);

test("package boundary includes runtime entry points and excludes fixtures/tests", () => {
  assert.ok(files.includes("extensions/kanban-flow/index.ts"));
  assert.ok(files.includes("extensions/kanban-flow/paths.ts"));
  assert.ok(!files.some((file: string) => file.startsWith("reference/")));
  assert.ok(!files.some((file: string) => file.startsWith("test/")));
});

test("asset resolution works from checkout, symlink, pinned archive, and packed installs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-kanban-flow-assets-"));
  const modulePath = join(root, "extensions", "kanban-flow", "paths.ts");
  await mkdir(join(root, "extensions", "kanban-flow"), { recursive: true });
  await mkdir(join(root, "templates"));
  await writeFile(modulePath, "");
  await writeFile(join(root, "templates", "asset.txt"), "asset");
  const moduleUrl = pathToFileURL(modulePath).href;
  const canonicalRoot = await realpath(root);
  assert.equal(await packageRoot(moduleUrl), canonicalRoot);
  assert.equal(await resolvePackageAsset("templates/asset.txt", moduleUrl), join(canonicalRoot, "templates", "asset.txt"));

  const link = `${root}-link`;
  await symlink(root, link);
  const linkedModuleUrl = pathToFileURL(join(link, "extensions", "kanban-flow", "paths.ts")).href;
  assert.equal(await packageRoot(linkedModuleUrl), canonicalRoot);

  const packedDir = await mkdtemp(join(tmpdir(), "pi-kanban-flow-packed-"));
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", packedDir], { encoding: "utf8" }))[0].filename as string;
  execFileSync("tar", ["-xzf", join(packedDir, packed), "-C", packedDir]);
  const unpackedRoot = await realpath(join(packedDir, "package"));
  const unpackedModule = pathToFileURL(join(unpackedRoot, "extensions", "kanban-flow", "paths.ts")).href;
  assert.equal(await resolvePackageAsset("README.md", unpackedModule), join(unpackedRoot, "README.md"));
  const packedFiles = execFileSync("tar", ["-tzf", join(packedDir, packed)], { encoding: "utf8" }).split("\\n");
  assert.ok(!packedFiles.some((file: string) => file.includes("reference/") || file.includes("test/")));
});
