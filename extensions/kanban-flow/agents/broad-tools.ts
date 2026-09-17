import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { authorizeCreatePath, authorizeExistingPath, normalizeRepositoryPath } from "./path-policy.ts";
import { runProjectCommand, validatePlannedDiff, type ProjectCommand } from "./project-command.ts";
import { registerReadRepositoryTools } from "./repository-tools.ts";

export type PlannedAction = "create" | "modify" | "delete";
export interface BroadToolPolicy { root: string; planned: ReadonlyMap<string, PlannedAction>; commands: Readonly<Record<string, ProjectCommand>>; protectedPrefixes?: readonly string[]; timeoutMs?: number }

function authorizePlanned(policy: BroadToolPolicy, path: string, action: PlannedAction): string {
  const normalized = normalizeRepositoryPath(path);
  const protectedPrefixes = policy.protectedPrefixes ?? [".git", "docs/cards", "docs/designs"];
  if (protectedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) throw new Error(`Protected path: ${normalized}`);
  if (policy.planned.get(normalized) !== action) throw new Error(`Unplanned or wrong action for path: ${normalized}`);
  return normalized;
}

export function registerBroadRepositoryTools(pi: ExtensionAPI, policy: BroadToolPolicy): void {
  registerReadRepositoryTools(pi, policy.root);
  pi.registerTool({ name: "kanban_write", label: "kanban_write", description: "Create or delete one parent-approved product path.", parameters: Type.Object({ path: Type.String(), action: StringEnum(["create", "delete"] as const), content: Type.String({ maxLength: 1_000_000 }) }, { additionalProperties: false }), async execute(_id, params) {
    const path = authorizePlanned(policy, params.path, params.action);
    if (params.action === "delete") { if (params.content !== "") throw new Error("Delete content must be empty"); const target = await authorizeExistingPath(policy.root, path); await rm(target.absolutePath); }
    else { const target = await authorizeCreatePath(policy.root, path); await mkdir(dirname(target.absolutePath), { recursive: true }); const temporary = join(dirname(target.absolutePath), `.kanban-write-${process.pid}-${Date.now()}`); await writeFile(temporary, params.content, { flag: "wx", mode: 0o600 }); await rename(temporary, target.absolutePath); }
    await validatePlannedDiff(policy.root, policy.planned); return { content: [{ type: "text" as const, text: `${params.action} ${path}` }], details: { path, action: params.action } };
  } });
  pi.registerTool({ name: "kanban_edit", label: "kanban_edit", description: "Apply one exact replacement to a parent-approved modified product path.", parameters: Type.Object({ path: Type.String(), oldText: Type.String({ minLength: 1, maxLength: 1_000_000 }), newText: Type.String({ maxLength: 1_000_000 }) }, { additionalProperties: false }), async execute(_id, params) {
    const path = authorizePlanned(policy, params.path, "modify"); const target = await authorizeExistingPath(policy.root, path); const current = await readFile(target.absolutePath, "utf8"); const first = current.indexOf(params.oldText); if (first < 0 || current.indexOf(params.oldText, first + 1) >= 0) throw new Error("Edit oldText must match exactly once"); const next = current.slice(0, first) + params.newText + current.slice(first + params.oldText.length); const temporary = join(dirname(target.absolutePath), `.kanban-edit-${process.pid}-${Date.now()}`); await writeFile(temporary, next, { flag: "wx", mode: 0o600 }); await rename(temporary, target.absolutePath); await validatePlannedDiff(policy.root, policy.planned); return { content: [{ type: "text" as const, text: `modify ${path}` }], details: { path, action: "modify" } };
  } });
  const names = Object.keys(policy.commands).sort();
  pi.registerTool({ name: "kanban_run_project_command", label: "kanban_run_project_command", description: "Run one parent-configured named project command without a shell.", parameters: Type.Object({ name: StringEnum(names.length > 0 ? names : ["none"]) }, { additionalProperties: false }), async execute(_id, params, signal) { const command = policy.commands[params.name]; if (!command) throw new Error(`Unknown project command: ${params.name}`); const result = await runProjectCommand(command, policy.root, { timeoutMs: policy.timeoutMs ?? 600_000, signal }); await validatePlannedDiff(policy.root, policy.planned); if (result.exitCode !== 0 || result.timedOut) throw new Error(`Project command failed (${result.exitCode})${result.timedOut ? " after timeout" : ""}`); return { content: [{ type: "text" as const, text: `${result.stdout}${result.stderr}`.slice(0, 50_000) }], details: { name: params.name, exitCode: result.exitCode } }; } });
}
