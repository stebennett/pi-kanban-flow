import type { ResultRole } from "./result-tools.ts";
import type { WorkflowAgentName } from "./definitions.ts";

export type ResourcePolicyName = "strict" | "broad-read" | "broad-write";
export interface DispatchLimits { timeoutMs: number; maxEvents: number; stdoutBytes: number; stderrBytes: number; artifactBytes: number; lineBytes: number }
export interface RolePolicy { name: ResourcePolicyName; resultRole: ResultRole; resultTool: string; tools: readonly string[]; cwdKind: "immutable_snapshot" | "repository" | "product_worktree"; limits: DispatchLimits; requiresPersistedTrust: boolean }
const read = ["kanban_read", "kanban_grep", "kanban_find", "kanban_ls"];
const limits = {
  producer: { timeoutMs: 1_800_000, maxEvents: 20_000, stdoutBytes: 16 * 1024 * 1024, stderrBytes: 1024 * 1024, artifactBytes: 200_000, lineBytes: 1024 * 1024 },
  strict: { timeoutMs: 600_000, maxEvents: 10_000, stdoutBytes: 8 * 1024 * 1024, stderrBytes: 1024 * 1024, artifactBytes: 200_000, lineBytes: 1024 * 1024 },
} as const;
const resultTools = { producer: "submit_producer_result", checker: "submit_checker_result", reviewer: "submit_reviewer_result", splitDecision: "submit_split_decision", probe: "submit_probe_result" } as const;

export function policyForAgent(name: WorkflowAgentName): RolePolicy {
  if (name === "requirements-producer" || name === "design-producer") return { name: "broad-read", resultRole: "producer", resultTool: resultTools.producer, tools: [...read, resultTools.producer], cwdKind: "repository", limits: limits.producer, requiresPersistedTrust: true };
  if (name === "implementer") return { name: "broad-write", resultRole: "producer", resultTool: resultTools.producer, tools: [...read, "kanban_write", "kanban_edit", "kanban_run_project_command", resultTools.producer], cwdKind: "product_worktree", limits: limits.producer, requiresPersistedTrust: true };
  if (name === "reviewer") return { name: "strict", resultRole: "reviewer", resultTool: resultTools.reviewer, tools: [...read, resultTools.reviewer], cwdKind: "immutable_snapshot", limits: limits.strict, requiresPersistedTrust: false };
  if (name === "split-decider") return { name: "strict", resultRole: "splitDecision", resultTool: resultTools.splitDecision, tools: [...read, resultTools.splitDecision], cwdKind: "immutable_snapshot", limits: limits.strict, requiresPersistedTrust: false };
  if (name.endsWith("checker")) return { name: "strict", resultRole: "checker", resultTool: resultTools.checker, tools: [...read, resultTools.checker], cwdKind: "immutable_snapshot", limits: limits.strict, requiresPersistedTrust: false };
  return { name: "strict", resultRole: "producer", resultTool: resultTools.producer, tools: [...read, resultTools.producer], cwdKind: "immutable_snapshot", limits: limits.strict, requiresPersistedTrust: false };
}
