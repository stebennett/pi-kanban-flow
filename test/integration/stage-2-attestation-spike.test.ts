import assert from "node:assert/strict";
import { test } from "node:test";

type Root = readonly [path: string, token: string];

function normalizeArgv(argv: readonly string[], roots: readonly Root[], secrets: readonly string[]): string[] {
  const orderedRoots = [...roots].sort(([left], [right]) => right.length - left.length);
  return argv.map((argument) => {
    let value = argument;
    for (const [root, token] of orderedRoots) value = value.split(root).join(token);
    for (const secret of secrets) {
      if (secret) value = value.split(secret).join("<REDACTED>");
    }
    // Credentials embedded in a URL can arrive independently of configured
    // secret names and must not survive durable serialization.
    return value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1<REDACTED>@");
  });
}

function sanitize(value: unknown, roots: readonly Root[], secrets: readonly string[]): unknown {
  if (typeof value === "string") return normalizeArgv([value], roots, secrets)[0];
  if (Array.isArray(value)) return value.map((item) => sanitize(item, roots, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, roots, secrets)]));
  return value;
}

test("attestation prototype replaces longest roots and redacts every serialized string", () => {
  const packageRoot = "/private/tmp/dispatch/package";
  const snapshotRoot = "/private/tmp/dispatch/snapshot";
  const worktreeRoot = "/private/tmp/dispatch/worktree";
  const tempRoot = "/private/tmp/dispatch";
  const secret = "stage2-secret-canary";
  const normalized = normalizeArgv([
    `${packageRoot}/extensions/result.ts`,
    `${snapshotRoot}/input.md`,
    `${worktreeRoot}/src/index.ts`,
    `${tempRoot}/prompt.md`,
    `--token=${secret}`,
    "https://user:password@example.invalid/api",
  ], [
    [tempRoot, "<TEMP_ROOT>"],
    [packageRoot, "<PACKAGE_ROOT>"],
    [snapshotRoot, "<SNAPSHOT_ROOT>"],
    [worktreeRoot, "<WORKTREE_ROOT>"],
  ], [secret]);
  assert.deepEqual(normalized, [
    "<PACKAGE_ROOT>/extensions/result.ts",
    "<SNAPSHOT_ROOT>/input.md",
    "<WORKTREE_ROOT>/src/index.ts",
    "<TEMP_ROOT>/prompt.md",
    "--token=<REDACTED>",
    "https://<REDACTED>@example.invalid/api",
  ]);
  const durable = JSON.stringify(sanitize({ argv: normalized, nested: { message: `failed ${secret} at ${snapshotRoot}` } }, [
    [tempRoot, "<TEMP_ROOT>"], [packageRoot, "<PACKAGE_ROOT>"], [snapshotRoot, "<SNAPSHOT_ROOT>"], [worktreeRoot, "<WORKTREE_ROOT>"],
  ], [secret]));
  assert.doesNotMatch(durable, /stage2-secret-canary|\/private\/tmp\/dispatch/);
});
