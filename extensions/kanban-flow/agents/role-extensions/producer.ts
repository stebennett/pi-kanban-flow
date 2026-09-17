import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultTool } from "../result-tools.ts";
import { registerReadRepositoryTools } from "../repository-tools.ts";
import { registerBroadRepositoryTools } from "../broad-tools.ts";

export default function producerResultExtension(pi: ExtensionAPI): void {
  const root = process.env.KANBAN_FLOW_TOOL_ROOT;
  if (!root) throw new Error("KANBAN_FLOW_TOOL_ROOT is required");
  const policyFile = process.env.KANBAN_FLOW_POLICY_FILE;
  if (policyFile) {
    const value = JSON.parse(readFileSync(policyFile, "utf8")) as { planned: Record<string, "create" | "modify" | "delete">; commands: Record<string, { executable: string; argv: string[] }>; protectedPrefixes?: string[]; timeoutMs?: number };
    registerBroadRepositoryTools(pi, { root, planned: new Map(Object.entries(value.planned)), commands: value.commands, protectedPrefixes: value.protectedPrefixes, timeoutMs: value.timeoutMs });
  } else registerReadRepositoryTools(pi, root);
  registerResultTool(pi, "producer");
}
