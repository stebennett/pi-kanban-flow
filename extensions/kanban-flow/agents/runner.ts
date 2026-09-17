import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackageAsset } from "../paths.ts";
import type { AgentDefinition } from "./definitions.ts";
import type { ResolvedModel } from "./models.ts";
import type { RolePolicy } from "./policy.ts";
import { assembleTaskEnvelope } from "./prompts.ts";

export interface DispatchPlan { dispatchId: string; agent: AgentDefinition; model: ResolvedModel; policy: RolePolicy; executable: string; argv: string[]; redactedArgv: string[]; cwd: string; promptPath: string; taskEnvelope: string; cleanup(): Promise<void> }
const extensionFiles = { producer: "producer.ts", checker: "checker.ts", reviewer: "reviewer.ts", splitDecision: "split-decision.ts", probe: "probe.ts" } as const;

export async function createDispatchPlan(options: { dispatchId: string; agent: AgentDefinition; model: ResolvedModel; policy: RolePolicy; cwd: string; systemPrompt: string; task: string; executable?: string }): Promise<DispatchPlan> {
  const directory = await mkdtemp(join(tmpdir(), "kanban-dispatch-")); await chmod(directory, 0o700);
  const promptPath = join(directory, "system-prompt.md"); await writeFile(promptPath, options.systemPrompt, { mode: 0o600, flag: "wx" });
  const extension = await resolvePackageAsset(`extensions/kanban-flow/agents/role-extensions/${extensionFiles[options.policy.resultRole]}`);
  const taskEnvelope = assembleTaskEnvelope(options.dispatchId, options.task);
  const argv = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools", "-e", extension, "--tools", options.policy.tools.join(","), "--model", `${options.model.provider}/${options.model.id}`, "--thinking", options.model.thinking, "--append-system-prompt", promptPath, "--", taskEnvelope];
  const redactedArgv = argv.map((value) => value === extension ? "<PACKAGE_ROOT>/extensions/kanban-flow/agents/role-extensions/<ROLE>.ts" : value === promptPath ? "<TEMP_ROOT>/system-prompt.md" : value);
  return { ...options, executable: options.executable ?? "pi", argv, redactedArgv, promptPath, taskEnvelope, async cleanup() { await rm(directory, { recursive: true, force: true }); } };
}
