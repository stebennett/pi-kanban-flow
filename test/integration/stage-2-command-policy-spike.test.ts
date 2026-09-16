import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type NamedCommand = Readonly<{ executable: string; argv: readonly string[] }>;

function selectCommand(commands: Readonly<Record<string, NamedCommand>>, requestedName: string): NamedCommand {
  const command = commands[requestedName];
  if (!command) throw new Error(`unknown configured project command: ${requestedName}`);
  return command;
}

function invoke(command: NamedCommand, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.argv, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("named project command prototype selects only parent configuration and does not interpret argv", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-flow-command-spike-"));
  const marker = join(root, "must-not-exist");
  const script = join(root, "argv.js");
  const maliciousArgument = `$(touch ${marker}); echo injected`;
  try {
    await writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    const commands = {
      check: { executable: process.execPath, argv: [script, maliciousArgument] },
    } as const;
    assert.throws(() => selectCommand(commands, "unknown"), /unknown configured project command/);
    const selected = selectCommand(commands, "check");
    const result = await invoke(selected, root);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [maliciousArgument]);
    await assert.rejects(() => import("node:fs/promises").then(({ access }) => access(marker)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
