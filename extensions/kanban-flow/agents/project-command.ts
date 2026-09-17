import { spawn } from "node:child_process";

export interface ProjectCommand { executable: string; argv: readonly string[] }
export interface ProjectCommandResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean }
const OUTPUT_LIMIT = 1_000_000;

export async function runProjectCommand(command: ProjectCommand, cwd: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ProjectCommandResult> {
  if (!command.executable || command.executable.includes("\u0000") || command.argv.some((value) => value.includes("\u0000"))) throw new Error("Invalid configured project command");
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.argv], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } });
    let stdout: Buffer = Buffer.alloc(0); let stderr: Buffer = Buffer.alloc(0); let timedOut = false; let settled = false;
    const append = (current: Buffer, chunk: Buffer): Buffer => { const next = Buffer.concat([current, chunk]); if (next.length > OUTPUT_LIMIT) { child.kill("SIGKILL"); throw new Error("Project command output limit exceeded"); } return next; };
    child.stdout.on("data", (chunk) => { try { stdout = append(stdout, chunk); } catch (error) { reject(error); } });
    child.stderr.on("data", (chunk) => { try { stderr = append(stderr, chunk); } catch (error) { reject(error); } });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 5_000).unref(); }, options.timeoutMs);
    const abort = () => child.kill("SIGTERM"); options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject); child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve({ exitCode: code ?? -1, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut }); });
  });
}

export async function validatePlannedDiff(cwd: string, planned: ReadonlyMap<string, "create" | "modify" | "delete">): Promise<void> {
  const result = await runProjectCommand({ executable: "git", argv: ["status", "--porcelain=v1", "-z", "--untracked-files=all"] }, cwd, { timeoutMs: 10_000 });
  if (result.exitCode !== 0) throw new Error(`Unable to inspect product diff: ${result.stderr}`);
  const actual = new Map<string, string>(); const records = result.stdout.split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index++) {
    const record = records[index]; const status = record.slice(0, 2); let path = record.slice(3);
    if (status[0] === "R" || status[0] === "C") { path = records[++index] ?? ""; }
    actual.set(path, status === "??" || status.includes("A") ? "create" : status.includes("D") ? "delete" : "modify");
  }
  for (const [path, action] of actual) if (planned.get(path) !== action) throw new Error(`Out-of-policy worktree diff: ${path} (${action})`);
  for (const [path, action] of planned) if (actual.has(path) && actual.get(path) !== action) throw new Error(`Wrong diff action for ${path}`);
}
