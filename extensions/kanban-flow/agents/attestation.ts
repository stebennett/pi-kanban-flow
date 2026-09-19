import { Value } from "typebox/value";
import { ArtifactAttestationSchema } from "../board/schemas.ts";
import type { DispatchPlan, DispatchSuccess } from "./runner.ts";

export interface ExecutionIdentity { kind: "immutable_snapshot" | "product_worktree" | "parent"; repository_id: string; branch: string | null; commit: string; snapshotCommit: string | null }
export interface NormalizationInput { roots: Readonly<Record<string, string>>; secrets?: readonly string[] }

export function normalizeDurableValue<T>(value: T, input: NormalizationInput): T {
  const roots = Object.entries(input.roots).filter(([, path]) => path).sort((a, b) => b[1].length - a[1].length);
  const secrets = (input.secrets ?? []).filter(Boolean).sort((a, b) => b.length - a.length);
  const normalizeString = (text: string): string => { let result = text.replace(/([a-z]+:\/\/)[^/@\s]+@/giu, "$1<REDACTED>@"); for (const secret of secrets) result = result.split(secret).join("<REDACTED>"); for (const [token, path] of roots) result = result.split(path).join(token); return result; };
  const visit = (item: unknown): unknown => typeof item === "string" ? normalizeString(item) : Array.isArray(item) ? item.map(visit) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)])) : item;
  return visit(value) as T;
}

export function buildChildAttestation(plan: DispatchPlan, success: DispatchSuccess, identity: ExecutionIdentity, normalization: NormalizationInput, findingIds: readonly string[] = []): Record<string, unknown> {
  const payload = success.runtime.payload as { findings?: readonly unknown[] };
  if (findingIds.length !== (payload.findings?.length ?? 0)) throw new Error("Finding IDs must be parallel to payload findings");
  const value = normalizeDurableValue({ run_id: plan.dispatchId, dispatch_id: plan.dispatchId, tool: plan.policy.resultTool, agent: { name: plan.agent.name, source: plan.agent.source, path: plan.agent.path, sha256: plan.agent.sha256 }, model: { provider: success.runtime.provider, id: success.runtime.model, thinking: success.runtime.thinking }, policy: { name: plan.policy.name, tools: [...plan.policy.tools], snapshot_commit: identity.snapshotCommit }, execution_context: { kind: identity.kind, repository_id: identity.repository_id, branch: identity.branch, commit: identity.commit }, argv: [plan.executable, ...plan.redactedArgv], started_at: success.startedAt, completed_at: success.completedAt, exit_code: success.exitCode, stop_reason: success.runtime.stopReason, finding_ids: [...findingIds], payload: success.runtime.payload }, normalization);
  if (!Value.Check(ArtifactAttestationSchema, value)) throw new Error("Parent attestation does not match its strict schema");
  const serialized = JSON.stringify(value); for (const path of Object.values(normalization.roots)) if (path && serialized.includes(path)) throw new Error("Durable attestation contains an absolute machine path"); for (const secret of normalization.secrets ?? []) if (secret && serialized.includes(secret)) throw new Error("Durable attestation contains a secret");
  return value;
}
