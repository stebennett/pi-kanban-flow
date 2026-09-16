import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("direct child command supports parent abort without shell", async () => {
  const controller = new AbortController();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { shell: false, signal: controller.signal, stdio: "ignore" });
  const outcome = await new Promise<string>((resolve, reject) => {
    child.once("error", (error) => resolve((error as Error).name));
    child.once("close", () => resolve("closed"));
    child.once("spawn", () => controller.abort());
    child.once("error", reject);
  });
  assert.ok(outcome === "AbortError" || outcome === "closed");
});
