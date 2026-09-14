import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { diagnose, diagnosticText, validateParameters } from "./tools/validate.ts";

export const SUPPORTED_PI_RANGE = ">=0.85.0 <0.86.0";

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function isSupportedPiVersion(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed !== undefined && parsed[0] === 0 && parsed[1] === 85;
}

export function assertSupportedPiVersion(version: string = VERSION): void {
  if (!isSupportedPiVersion(version)) {
    throw new Error(`pi-kanban-flow requires Pi ${SUPPORTED_PI_RANGE}; detected ${version}`);
  }
}

/** Thin entry point: compatibility is checked before future mutating registration. */
export default function kanbanFlowExtension(pi: ExtensionAPI): void {
  assertSupportedPiVersion(VERSION);

  const runDiagnostic = async (cwd: string, queryMarkers: boolean): Promise<string> =>
    diagnosticText(await diagnose(cwd, { query_markers: queryMarkers }));

  pi.registerCommand("kanban-validate", {
    description: "Validate the kanban board without mutation",
    handler: async (args, ctx) => {
      const queryMarkers = args.trim() === "--markers";
      if (args.trim() && !queryMarkers) {
        ctx.ui.notify("Usage: /kanban-validate [--markers]", "warning");
        return;
      }
      const report = await runDiagnostic(ctx.cwd, queryMarkers);
      ctx.ui.notify(report, report.includes('"ok": true') ? "info" : "warning");
    },
  });

  pi.registerTool({
    name: "kanban_validate",
    label: "kanban_validate",
    description: "Read-only kanban board validation and compatibility diagnostics.",
    parameters: validateParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const report = await diagnose(ctx.cwd, params);
      return { content: [{ type: "text", text: diagnosticText(report) }], details: report };
    },
  });
}
