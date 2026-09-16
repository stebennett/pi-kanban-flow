import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(command: string, args: readonly string[], cwd: string, input?: Buffer): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks), stderr }));
    child.stdin.end(input);
  });
}

async function mustRun(command: string, args: readonly string[], cwd: string, input?: Buffer): Promise<Buffer> {
  const result = await run(command, args, cwd, input);
  assert.equal(result.code, 0, `${command} ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

test("git archive is an exact immutable commit snapshot through direct argv", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-archive-spike-"));
  try {
    await mustRun("git", ["init", "-q"], root);
    await mustRun("git", ["config", "user.email", "spike@example.invalid"], root);
    await mustRun("git", ["config", "user.name", "Spike"], root);
    await writeFile(join(root, "evidence.txt"), "committed\n");
    await mustRun("git", ["add", "evidence.txt"], root);
    await mustRun("git", ["commit", "-qm", "snapshot"], root);
    const commit = (await mustRun("git", ["rev-parse", "HEAD"], root)).toString("utf8").trim();
    const archive = await mustRun("git", ["archive", "--format=tar", commit], root);

    await writeFile(join(root, "evidence.txt"), "mutable checkout changed\n");
    const listed = (await mustRun("tar", ["-tf", "-"], root, archive)).toString("utf8").trim().split("\n");
    assert.deepEqual(listed, ["evidence.txt"]);
    const content = await mustRun("tar", ["-xOf", "-", "evidence.txt"], root, archive);
    assert.equal(content.toString("utf8"), "committed\n");
    assert.equal(await readFile(join(root, "evidence.txt"), "utf8"), "mutable checkout changed\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
