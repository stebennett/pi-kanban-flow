import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultTool } from "../result-tools.ts";

export default function checkerResultExtension(pi: ExtensionAPI): void {
  registerResultTool(pi, "checker");
}
