import { spawn } from "node:child_process";

export interface ProjectCommand { executable: string; argv: readonly string[] }
export interface ProjectCommandResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean; signal?: string; spawnError?: string; outputOverflow?: boolean; aborted?: boolean }
export type ProjectCommandStatus = "pass" | "fail" | "unknown";
export interface ProjectCommandObservation extends ProjectCommandResult { readonly key: string; readonly argv: readonly string[]; readonly status: ProjectCommandStatus; readonly detail: string }
export const PROJECT_COMMAND_ORDER = Object.freeze(["test", "lint", "typecheck", "build"] as const);
const OUTPUT_LIMIT = 1_000_000;
const DETAIL_LIMIT = 16 * 1024;
const SECRET = /(bearer\s+|token|password|secret|private[_ -]?key|access[_ -]?key)[=: ]+[^\s,;]+/gi;

export function boundedRedacted(value: string, limit = DETAIL_LIMIT): string {
  const redacted = value.replace(SECRET, (_match, prefix: string) => `${prefix}[REDACTED]`);
  if (Buffer.byteLength(redacted) <= limit) return redacted;
  const half = Math.floor(limit / 2);
  return `${redacted.slice(0, half)}\n...[truncated]...\n${redacted.slice(-half)}`.slice(0, limit);
}

export async function runProjectCommand(command: ProjectCommand, cwd: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ProjectCommandResult> {
  if (!command.executable || command.executable.includes("\u0000") || command.argv.some((value) => value.includes("\u0000"))) throw new Error("Invalid configured project command");
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command.executable, [...command.argv], { cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } }); }
    catch (error) { resolve({ exitCode: -1, stdout: "", stderr: "", timedOut: false, spawnError: String(error) }); return; }
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0); let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0); let timedOut = false; let aborted = false; let overflow = false; let settled = false;
    const terminate = () => { if (child.exitCode === null) { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch { /* process already exited */ } } };
    const append = (current: Buffer, chunk: Buffer): Buffer => { const next = Buffer.concat([current, chunk]); if (next.length > OUTPUT_LIMIT) { overflow = true; terminate(); return current; } return next; };
    child.stdout!.on("data", (chunk: Buffer<ArrayBufferLike>) => { stdout = append(stdout, Buffer.from(chunk)); });
    child.stderr!.on("data", (chunk: Buffer<ArrayBufferLike>) => { stderr = append(stderr, Buffer.from(chunk)); });
    const timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs);
    const abort = () => { aborted = true; terminate(); }; options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve({ exitCode: -1, stdout: stdout.toString(), stderr: stderr.toString(), timedOut, aborted, outputOverflow: overflow, spawnError: String(error) }); } });
    child.on("close", (code, signal) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve({ exitCode: code ?? -1, signal: signal ?? undefined, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut, aborted, outputOverflow: overflow }); });
  });
}

export function classifyProjectCommand(result: ProjectCommandResult): ProjectCommandStatus {
  return result.spawnError || result.timedOut || result.signal || result.outputOverflow || result.aborted || result.exitCode < 0 ? "unknown" : result.exitCode === 0 ? "pass" : "fail";
}

export function projectCommandObservation(key: string, command: ProjectCommand, result: ProjectCommandResult): ProjectCommandObservation {
  const status = classifyProjectCommand(result);
  return Object.freeze({ ...result, key, argv: Object.freeze([...command.argv]), status, detail: boundedRedacted([result.stdout, result.stderr].filter(Boolean).join("\n")) });
}

export async function runConfiguredProjectCommands(commands: Readonly<Partial<Record<(typeof PROJECT_COMMAND_ORDER)[number], ProjectCommand>>>, cwd: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<readonly ProjectCommandObservation[]> {
  const observations: ProjectCommandObservation[] = [];
  for (const key of PROJECT_COMMAND_ORDER) {
    const command = commands[key];
    if (!command) continue;
    const result = await runProjectCommand(command, cwd, options);
    observations.push(projectCommandObservation(key, command, result));
    if (options.signal?.aborted) break;
  }
  return Object.freeze(observations);
}

export function overallProjectCommandStatus(observations: readonly ProjectCommandObservation[]): "success" | "failure" | "inconclusive" {
  return observations.some((observation) => observation.status === "unknown") ? "inconclusive" : observations.some((observation) => observation.status === "fail") ? "failure" : "success";
}

export async function validatePlannedDiff(cwd: string, planned: ReadonlyMap<string, "create" | "modify" | "delete">): Promise<void> {
  const result = await runProjectCommand({ executable: "git", argv: ["status", "--porcelain=v1", "-z", "--untracked-files=all"] }, cwd, { timeoutMs: 10_000 });
  if (result.exitCode !== 0) throw new Error(`Unable to inspect product diff: ${result.stderr}`);
  const actual = new Map<string, string>(); const records = result.stdout.split("\0").filter(Boolean);
  for (let index = 0; index < records.length; index++) { const record = records[index]; const status = record.slice(0, 2); let path = record.slice(3); if (status[0] === "R" || status[0] === "C") path = records[++index] ?? ""; actual.set(path, status === "??" || status.includes("A") ? "create" : status.includes("D") ? "delete" : "modify"); }
  for (const [path, action] of actual) if (planned.get(path) !== action) throw new Error(`Out-of-policy worktree diff: ${path} (${action})`);
  for (const [path, action] of planned) if (actual.has(path) && actual.get(path) !== action) throw new Error(`Wrong diff action for ${path}`);
}
