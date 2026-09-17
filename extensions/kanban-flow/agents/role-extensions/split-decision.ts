import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultTool } from "../result-tools.ts";
import { registerReadRepositoryTools } from "../repository-tools.ts";

export default function splitDecisionResultExtension(pi: ExtensionAPI): void {
  const root = process.env.KANBAN_FLOW_TOOL_ROOT;
  if (!root) throw new Error("KANBAN_FLOW_TOOL_ROOT is required");
  registerReadRepositoryTools(pi, root);
  registerResultTool(pi, "splitDecision");
}
