import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { diagnose, diagnosticText, validateParameters } from "./tools/validate.ts";
import { initializeParameters, runInitializeTool } from "./tools/initialize.ts";
import { createPiApprovalAdapter, requirementsParameters, runRequirementsTool } from "./tools/requirements.ts";
import { packageRoot } from "./paths.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { kanbanPumpParameters, packageVersionFromManifest, runKanbanPump } from "./tools/kanban-pump.ts";
import { blockerResolutionParameters, packageVersionForBlocker, runBlockerResolution } from "./tools/blocker-resolution.ts";

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

  const runDiagnostic = async (cwd: string, queryMarkers: boolean, model?: { provider: string; id: string }): Promise<string> =>
    diagnosticText(await diagnose(cwd, { query_markers: queryMarkers }, { parentModel: model ? { ...model, supportsTools: true } : undefined }));

  pi.registerCommand("kanban-validate", {
    description: "Validate the kanban board without mutation",
    handler: async (args, ctx) => {
      const queryMarkers = args.trim() === "--markers";
      if (args.trim() && !queryMarkers) {
        ctx.ui.notify("Usage: /kanban-validate [--markers]", "warning");
        return;
      }
      const report = await runDiagnostic(ctx.cwd, queryMarkers, ctx.model);
      ctx.ui.notify(report, report.includes('"ok": true') ? "info" : "warning");
    },
  });

  pi.registerTool({
    name: "kanban_initialize",
    label: "kanban_initialize",
    description: "Propose the deterministic empty kanban control plane through a human-reviewed state PR.",
    parameters: initializeParameters,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const manifest = JSON.parse(await readFile(join(await packageRoot(), "package.json"), "utf8")) as { version: string };
      const details = await runInitializeTool(ctx.cwd, manifest.version);
      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
    },
  });

  pi.registerTool({
    name: "kanban_requirements",
    label: "kanban_requirements",
    description: "Prepare, explicitly approve, and propose one deterministic requirements state transaction.",
    parameters: requirementsParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const manifest = JSON.parse(await readFile(join(await packageRoot(), "package.json"), "utf8")) as { version: string };
      if (!ctx.model) throw new Error("kanban_requirements requires an active parent model");
      const scoped = ctx.scopedModels;
      const modelResolver = { resolve: async (provider: string, id: string) => {
        if (scoped.length > 0 && !scoped.some((entry: any) => entry.model?.provider === provider && entry.model?.id === id || entry.provider === provider && entry.id === id)) return null;
        const model = ctx.modelRegistry.find(provider, id); if (!model) return null; const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        return { provider, id, authenticated: auth.ok, supportsTools: true };
      } };
      const thinking = (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).includes(ctx.thinkingLevel as any) ? ctx.thinkingLevel as any : "medium";
      const details = await runRequirementsTool({ cwd: ctx.cwd, packageVersion: manifest.version, brief: params.brief, parentModel: { provider: ctx.model.provider, id: ctx.model.id, thinking }, modelResolver, approvalAdapter: createPiApprovalAdapter(ctx.ui, ctx.hasUI), interactive: ctx.hasUI && (ctx.mode === "tui" || ctx.mode === "rpc"), signal });
      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
    },
  });

  pi.registerTool({
    name: "kanban_pump",
    label: "kanban_pump",
    description: "Run exactly one deterministic kanban pump; proposed state is never authoritative until its state PR merges.",
    parameters: kanbanPumpParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const version = await packageVersionFromManifest();
      const parentModel = ctx.model ? {
        provider: ctx.model.provider,
        id: ctx.model.id,
        thinking: (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).includes(ctx.thinkingLevel as any) ? ctx.thinkingLevel as any : "medium",
      } : undefined;
      const modelResolver = {
        resolve: async (provider: string, id: string) => {
          if (ctx.scopedModels.length > 0 && !ctx.scopedModels.some((entry: any) => entry.model?.provider === provider && entry.model?.id === id || entry.provider === provider && entry.id === id)) return null;
          const model = ctx.modelRegistry.find(provider, id);
          if (!model) return null;
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          return { provider, id, authenticated: auth.ok, supportsTools: true };
        },
      };
      const details = await runKanbanPump(ctx.cwd, version, params, signal, { parentModel, modelResolver });
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });

  pi.registerTool({
    name: "kanban_blocker_resolution",
    label: "kanban_blocker_resolution",
    description: "Propose one explicit human blocker resolution state transaction; it never continues the workflow in the same pump.",
    parameters: blockerResolutionParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const version = await packageVersionForBlocker();
      const details = await runBlockerResolution({ cwd: ctx.cwd, packageVersion: version, params, signal });
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });

  pi.registerTool({
    name: "kanban_validate",
    label: "kanban_validate",
    description: "Read-only kanban board validation and compatibility diagnostics.",
    parameters: validateParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const report = await diagnose(ctx.cwd, params, { parentModel: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, supportsTools: true } : undefined });
      return { content: [{ type: "text", text: diagnosticText(report) }], details: report };
    },
  });
}
