import { readFile } from "node:fs/promises";
import { authorizeExistingPath } from "./path-policy.ts";
import type { AgentDefinition } from "./definitions.ts";

const MAX_CONTEXT_BYTES = 500_000;
const MAX_CONTEXT_FILE_BYTES = 100_000;
function normalize(value: string, label: string): string { const result = value.replace(/\r\n?/g, "\n"); if (result.includes("\u0000") || Buffer.byteLength(result) > MAX_CONTEXT_FILE_BYTES) throw new Error(`${label} is invalid or exceeds its context limit`); return result.trim(); }

export async function assembleSystemPrompt(options: { repositoryRoot: string; protocol: string; agent: AgentDefinition; contextPaths?: readonly string[]; skillPaths?: readonly string[]; addendumPath?: string; dispatchInputs: string }): Promise<string> {
  const sections: string[] = ["# Kanban-flow child protocol", normalize(options.protocol, "protocol")];
  for (const path of [...(options.contextPaths ?? [])]) { const target = await authorizeExistingPath(options.repositoryRoot, path); sections.push(`## Project context: ${target.relativePath}`, normalize(await readFile(target.absolutePath, "utf8"), target.relativePath)); }
  if (options.addendumPath) { const target = await authorizeExistingPath(options.repositoryRoot, options.addendumPath); sections.push(`## Project protocol addendum: ${target.relativePath}`, normalize(await readFile(target.absolutePath, "utf8"), target.relativePath)); }
  for (const path of [...(options.skillPaths ?? [])].sort()) { const target = await authorizeExistingPath(options.repositoryRoot, path); sections.push(`## Approved project skill: ${target.relativePath}`, normalize(await readFile(target.absolutePath, "utf8"), target.relativePath)); }
  sections.push(`## Agent: ${options.agent.name}`, normalize(options.agent.body, "agent body"), "## Dispatch inputs", normalize(options.dispatchInputs, "dispatch inputs"));
  const prompt = `${sections.join("\n\n")}\n`;
  if (Buffer.byteLength(prompt) > MAX_CONTEXT_BYTES) throw new Error("Assembled child context exceeds limit");
  return prompt;
}

export function assembleTaskEnvelope(dispatchId: string, task: string): string {
  const normalized = task.replace(/\r\n?/g, "\n").trim();
  if (!/^KFRUN-/.test(dispatchId) || !normalized || normalized.includes("\u0000") || Buffer.byteLength(normalized) > 32_000) throw new Error("Invalid child task envelope");
  return `Dispatch: ${dispatchId}\n\n${normalized}`;
}
