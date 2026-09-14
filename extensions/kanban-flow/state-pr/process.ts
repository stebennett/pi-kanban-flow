import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  executable: string;
  args: readonly string[];
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(executable: string, args: readonly string[], options?: ProcessOptions): Promise<ProcessResult>;
}

function validateArg(value: string, label: string): void {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${label} contains a prohibited control character`);
  }
}

export class DirectProcessRunner implements ProcessRunner {
  async run(executable: string, args: readonly string[], options: ProcessOptions = {}): Promise<ProcessResult> {
    validateArg(executable, "executable");
    if (executable.length === 0) throw new Error("executable must not be empty");
    for (const arg of args) validateArg(arg, "argument");
    const result = await execFileAsync(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
      windowsHide: true,
    }).catch((error: unknown) => {
      const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
      if (failure.code === "ABORT_ERR") throw new Error(`process aborted: ${executable}`, { cause: error });
      const code = typeof failure.code === "number" ? failure.code : 1;
      return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message ?? String(error), code };
    });
    return { executable, args: [...args], code: "code" in result && typeof result.code === "number" ? result.code : 0, stdout: result.stdout, stderr: result.stderr };
  }
}

/** A deterministic runner useful for unit tests and for callers that already own process execution. */
export class RecordingProcessRunner implements ProcessRunner {
  readonly calls: Array<{ executable: string; args: readonly string[]; options?: ProcessOptions }> = [];
  constructor(private readonly handler: (executable: string, args: readonly string[], options?: ProcessOptions) => Promise<ProcessResult>) {}
  run(executable: string, args: readonly string[], options?: ProcessOptions): Promise<ProcessResult> {
    this.calls.push({ executable, args: [...args], options });
    return this.handler(executable, args, options);
  }
}

export function processExitCode(result: ProcessResult): number {
  return result.code;
}
