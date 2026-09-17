import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultTool } from "../result-tools.ts";

export default function splitDecisionResultExtension(pi: ExtensionAPI): void {
  registerResultTool(pi, "splitDecision");
}
