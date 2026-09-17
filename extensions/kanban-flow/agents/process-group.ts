import { spawn, type ChildProcess } from "node:child_process";

function groupSignal(child: ChildProcess, signal: NodeJS.Signals): void { if (!child.pid || child.exitCode !== null || child.signalCode !== null) return; try { process.kill(-child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
export async function terminateProcessGroup(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  groupSignal(child, "SIGTERM");
  const closed = await Promise.race([new Promise<boolean>((resolve) => child.once("close", () => resolve(true))), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), graceMs))]);
  if (!closed && child.exitCode === null && child.signalCode === null) groupSignal(child, "SIGKILL");
  if (!closed) await new Promise<void>((resolve) => child.once("close", () => resolve()));
}

export function spawnProcessGroup(executable: string, argv: readonly string[], cwd: string): ChildProcess {
  if (process.platform === "win32") throw new Error("Child process groups are supported only on macOS and Linux");
  return spawn(executable, [...argv], { cwd, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
}
