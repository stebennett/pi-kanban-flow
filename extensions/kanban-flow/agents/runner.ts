import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackageAsset } from "../paths.ts";
import { JsonLineDecoder, JsonRunEvaluator, type RunExpectation, type RuntimeEvidence } from "./json-stream.ts";
import { spawnProcessGroup, terminateProcessGroup } from "./process-group.ts";
import type { AgentDefinition } from "./definitions.ts";
import type { ResolvedModel } from "./models.ts";
import type { RolePolicy } from "./policy.ts";
import { assembleTaskEnvelope } from "./prompts.ts";

export interface DispatchPlan { dispatchId: string; agent: AgentDefinition; model: ResolvedModel; policy: RolePolicy; executable: string; argv: string[]; redactedArgv: string[]; environment: NodeJS.ProcessEnv; cwd: string; promptPath: string; taskEnvelope: string; cleanup(): Promise<void> }
export interface DispatchSuccess { runtime: RuntimeEvidence; exitCode: 0; stderr: string; startedAt: string; completedAt: string }
export interface StrictDispatchTask { plan: DispatchPlan; expectation: RunExpectation }
export interface ParallelDispatchOutcome { index: number; state: "completed" | "failed" | "skipped"; result?: DispatchSuccess; error?: string }
export interface ParallelDispatchResult { outcomes: ParallelDispatchOutcome[]; usage: Record<string, number>; ok: boolean }
const extensionFiles = { producer: "producer.ts", checker: "checker.ts", reviewer: "reviewer.ts", splitDecision: "split-decision.ts", probe: "probe.ts" } as const;

export async function createDispatchPlan(options: { dispatchId: string; agent: AgentDefinition; model: ResolvedModel; policy: RolePolicy; cwd: string; systemPrompt: string; task: string; executable?: string }): Promise<DispatchPlan> {
  const directory = await mkdtemp(join(tmpdir(), "kanban-dispatch-")); await chmod(directory, 0o700);
  const promptPath = join(directory, "system-prompt.md"); await writeFile(promptPath, options.systemPrompt, { mode: 0o600, flag: "wx" });
  const extension = await resolvePackageAsset(`extensions/kanban-flow/agents/role-extensions/${extensionFiles[options.policy.resultRole]}`);
  const taskEnvelope = assembleTaskEnvelope(options.dispatchId, options.task);
  const argv = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools", "-e", extension, "--tools", options.policy.tools.join(","), "--model", `${options.model.provider}/${options.model.id}`, "--thinking", options.model.thinking, "--append-system-prompt", promptPath, "--", taskEnvelope];
  const redactedArgv = argv.map((value) => value === extension ? "<PACKAGE_ROOT>/extensions/kanban-flow/agents/role-extensions/<ROLE>.ts" : value === promptPath ? "<TEMP_ROOT>/system-prompt.md" : value);
  const environment = { ...process.env, KANBAN_FLOW_TOOL_ROOT: options.cwd };
  return { ...options, executable: options.executable ?? "pi", argv, redactedArgv, environment, promptPath, taskEnvelope, async cleanup() { await rm(directory, { recursive: true, force: true }); } };
}

export async function executeDispatch(plan: DispatchPlan, expectation: RunExpectation, signal?: AbortSignal): Promise<DispatchSuccess> {
  if (signal?.aborted) { await plan.cleanup(); throw new Error("Child dispatch aborted before spawn"); }
  const startedAt = new Date().toISOString(); const evaluator = new JsonRunEvaluator(expectation, plan.policy.limits.maxEvents); const decoder = new JsonLineDecoder(plan.policy.limits.lineBytes);
  const child = spawnProcessGroup(plan.executable, plan.argv, plan.cwd, plan.environment); let stdoutBytes = 0; let stderrBytes = 0; let stderr = ""; let failure: Error | undefined; let timedOut = false;
  const fail = (error: unknown) => { failure ??= error instanceof Error ? error : new Error(String(error)); void terminateProcessGroup(child); };
  child.stdout!.on("data", (chunk: Buffer) => { try { stdoutBytes += chunk.length; if (stdoutBytes > plan.policy.limits.stdoutBytes) throw new Error("Child stdout limit exceeded"); for (const line of decoder.push(chunk)) { if (!line) continue; evaluator.accept(JSON.parse(line)); } } catch (error) { fail(error); } });
  child.stderr!.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > plan.policy.limits.stderrBytes) fail(new Error("Child stderr limit exceeded")); else stderr += chunk.toString("utf8"); });
  const abort = () => fail(new Error("Child dispatch aborted")); signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; fail(new Error("Child dispatch timed out")); }, plan.policy.limits.timeoutMs);
  let exitCode = -1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("close", (code) => resolve(code ?? -1)); });
    decoder.finish(); if (timedOut) throw new Error("Child dispatch timed out"); if (failure) throw failure;
    const runtime = evaluator.finish(exitCode);
    if (runtime.provider !== plan.model.provider || runtime.model !== plan.model.id || runtime.thinking !== plan.model.thinking) throw new Error("Authoritative runtime model does not match dispatch plan");
    return { runtime, exitCode: 0, stderr, startedAt, completedAt: new Date().toISOString() };
  } catch (error) { await terminateProcessGroup(child); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); await plan.cleanup(); }
}

export async function executeParallelStrict(tasks: readonly StrictDispatchTask[], maxParallel: number, parentSignal?: AbortSignal, executor: typeof executeDispatch = executeDispatch): Promise<ParallelDispatchResult> {
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 16) throw new Error("Strict parallelism must be between 1 and 16");
  for (const task of tasks) if (task.plan.policy.name !== "strict" || task.plan.policy.resultRole === "producer") throw new Error("Only independent strict checker/reviewer dispatches may run in parallel");
  const outcomes: ParallelDispatchOutcome[] = tasks.map((_, index) => ({ index, state: "skipped" })); const controller = new AbortController(); let next = 0; let terminalFailure = false;
  const parentAbort = () => controller.abort(parentSignal?.reason); parentSignal?.addEventListener("abort", parentAbort, { once: true });
  const worker = async () => { while (!terminalFailure && !controller.signal.aborted) { const index = next++; if (index >= tasks.length) return; try { const result = await executor(tasks[index].plan, tasks[index].expectation, controller.signal); outcomes[index] = { index, state: "completed", result }; } catch (error) { outcomes[index] = { index, state: "failed", error: error instanceof Error ? error.message : String(error) }; terminalFailure = true; controller.abort(error); } } };
  await Promise.all(Array.from({ length: Math.min(maxParallel, tasks.length) }, () => worker()));
  for (let index = next; index < tasks.length; index++) await tasks[index].plan.cleanup().catch((error) => { outcomes[index] = { index, state: "failed", error: `queued cleanup failed: ${String(error)}` }; });
  parentSignal?.removeEventListener("abort", parentAbort);
  const usage: Record<string, number> = {}; for (const outcome of outcomes) if (outcome.result) for (const [key, value] of Object.entries(outcome.result.runtime.usage)) if (typeof value === "number") usage[key] = (usage[key] ?? 0) + value;
  return { outcomes, usage, ok: outcomes.every((outcome) => outcome.state === "completed") };
}
