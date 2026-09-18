import { createHash } from "node:crypto";
import type { BoardSnapshot } from "../board/repository.ts";
import { normalizeDurableValue, type NormalizationInput } from "../agents/attestation.ts";
import type { RequirementsDispatchChecked } from "./dispatch.ts";

export type ApprovalDecision = "approve" | "revise" | "cancel";
export interface ApprovalAdapter { request(input: Readonly<{ digest: string; document: string }>, signal?: AbortSignal): Promise<ApprovalDecision | undefined> }
export interface RequirementsApprovalBundle {
  readonly digest: string;
  readonly document: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly baseCommit: string;
  readonly snapshotDigest: string;
  readonly paths: readonly string[];
}
export type ApprovalOutcome = { kind: "approved"; digest: string } | { kind: "revision_required"; digest: string } | { kind: "cancelled"; digest: string; reason: "cancel" | "dismissed" | "aborted" | "unsupported" };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function canonicalJson(value: unknown): string { return JSON.stringify(canonical(value)); }
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function code(value: unknown): string { return `\`\`\`json\n${JSON.stringify(canonical(value), null, 2)}\n\`\`\``; }
function exactPaths(paths: readonly string[]): string[] {
  const result = [...new Set(paths)].sort();
  if (result.length === 0 || result.length !== paths.length || result.some((path) => path !== "docs/spec.md" && !path.startsWith("docs/cards/"))) throw new Error("Approval paths must be unique state-owned repository paths");
  return result;
}
function snapshotBinding(snapshot: BoardSnapshot): Record<string, unknown> { return { board: snapshot.board, config: snapshot.config, requirements: snapshot.requirements ?? null, cards: snapshot.cards, finding_ids: snapshot.findingIds ?? [], dashboard: snapshot.canonicalDashboard }; }
function statusEffects(snapshot: BoardSnapshot, checked: RequirementsDispatchChecked): unknown[] {
  const before = new Map(snapshot.cards.map((card) => [card.id, card]));
  return checked.impact.cards.filter((card) => !before.has(card.id) || canonicalJson(before.get(card.id)) !== canonicalJson(card)).map((card) => ({ card_id: card.id, before_status: before.get(card.id)?.status ?? null, after_status: card.status, requirements: card.requirements, grandfathered_requirements: card.grandfathered_requirements, dependencies: card.dependencies, replaces: card.replaces, replaced_by: card.replaced_by }));
}
function dependencyRewires(snapshot: BoardSnapshot, checked: RequirementsDispatchChecked): unknown[] {
  const before = new Map(snapshot.cards.map((card) => [card.id, card.dependencies]));
  return checked.impact.cards.filter((card) => before.has(card.id) && canonicalJson(before.get(card.id)) !== canonicalJson(card.dependencies)).map((card) => ({ card_id: card.id, before: before.get(card.id), after: card.dependencies }));
}

export function prepareRequirementsApproval(input: { checked: RequirementsDispatchChecked; snapshot: BoardSnapshot; baseCommit: string; proposedPaths: readonly string[]; normalization: NormalizationInput }): RequirementsApprovalBundle {
  if (!/^[0-9a-f]{40,64}$/.test(input.baseCommit)) throw new Error("Approval base must be a full Git object ID");
  const paths = exactPaths(input.proposedPaths); const snapshotDigest = digest(snapshotBinding(input.snapshot));
  const artifactBindings = input.checked.artifacts.map(({ path, bytes, attestation }) => ({ path, bytes_sha256: digest(bytes), attestation }));
  const normalized = normalizeDurableValue({
    version: 1, authoritative_base: input.baseCommit, authoritative_snapshot_digest: snapshotDigest,
    proposal: input.checked.proposal, allocation: input.checked.allocation,
    status_effects: statusEffects(input.snapshot, input.checked), dependency_rewires: dependencyRewires(input.snapshot, input.checked),
    affected_cards: input.checked.impact.affectedCardIds, grandfathered_cards: input.checked.impact.grandfatheredCardIds,
    design_pr_closures: input.checked.impact.designClosures, producer: input.checked.producer, checker: input.checked.checker,
    active_agents: input.checked.discovery.active, models: input.checked.models, artifacts: artifactBindings, proposed_paths: paths,
  }, input.normalization) as Record<string, unknown>;
  const serialized = canonicalJson(normalized);
  if (serialized.includes("\u0000")) throw new Error("Approval input contains forbidden text");
  for (const path of Object.values(input.normalization.roots)) if (path && serialized.includes(path)) throw new Error("Approval input contains a machine-local path");
  for (const secret of input.normalization.secrets ?? []) if (secret && serialized.includes(secret)) throw new Error("Approval input contains a secret");
  const approvalDigest = digest(normalized);
  const document = [
    "# Requirements approval", "", `Digest: ${approvalDigest}`, `Authoritative base: ${input.baseCommit}`, `Authoritative snapshot: ${snapshotDigest}`, "",
    "## Requirement changes and prospective IDs", "", code({ changes: normalized.proposal && (normalized.proposal as any).requirementChanges, ids: (normalized.allocation as any).requirementIds }), "",
    "## Card changes, acceptance criteria, and prospective IDs", "", code({ changes: normalized.proposal && (normalized.proposal as any).cardChanges, card_ids: (normalized.allocation as any).cardIds, acceptance_ids: (normalized.allocation as any).acceptanceIds }), "",
    "## Dependency rewires and per-card effects", "", code({ dependency_rewires: normalized.dependency_rewires, status_effects: normalized.status_effects }), "",
    "## Grandfathering and retained assumptions", "", code({ cards: normalized.grandfathered_cards }), "",
    "## Design pull requests to close", "", code(normalized.design_pr_closures), "",
    "## Checker verdicts and findings", "", code({ status: (normalized.checker as any).status, criteria: (normalized.checker as any).criteria, findings: (normalized.checker as any).findings }), "",
    "## Active agents and models", "", code({ agents: normalized.active_agents, models: normalized.models }), "",
    "## Proposed state paths and accepted artifacts", "", code({ paths: normalized.proposed_paths, artifacts: normalized.artifacts }), "",
    "Approval authorizes only this digest on this authoritative base. The resulting state PR still requires human review and merge.", "",
  ].join("\n");
  if (Buffer.byteLength(document, "utf8") > 500_000) throw new Error("Approval document exceeds its display limit");
  return Object.freeze({ digest: approvalDigest, document, input: Object.freeze(normalized), baseCommit: input.baseCommit, snapshotDigest, paths: Object.freeze(paths) });
}

/** One-shot approval request; replay is refused even when the adapter returns the same value. */
export class RequirementsApprovalRequest {
  private consumed = false;
  constructor(readonly bundle: RequirementsApprovalBundle) {}
  async decide(adapter: ApprovalAdapter | undefined, signal?: AbortSignal): Promise<ApprovalOutcome> {
    if (this.consumed) throw new Error("Requirements approval request has already been consumed"); this.consumed = true;
    if (!adapter) return { kind: "cancelled", digest: this.bundle.digest, reason: "unsupported" };
    if (signal?.aborted) return { kind: "cancelled", digest: this.bundle.digest, reason: "aborted" };
    let decision: ApprovalDecision | undefined;
    try { decision = await adapter.request({ digest: this.bundle.digest, document: this.bundle.document }, signal); }
    catch (error) { if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return { kind: "cancelled", digest: this.bundle.digest, reason: "aborted" }; throw error; }
    if (signal?.aborted) return { kind: "cancelled", digest: this.bundle.digest, reason: "aborted" };
    if (decision === "approve") return { kind: "approved", digest: this.bundle.digest };
    if (decision === "revise") return { kind: "revision_required", digest: this.bundle.digest };
    return { kind: "cancelled", digest: this.bundle.digest, reason: decision === "cancel" ? "cancel" : "dismissed" };
  }
}

export function assertApprovalFresh(approved: ApprovalOutcome, fresh: RequirementsApprovalBundle): void {
  if (approved.kind !== "approved") throw new Error("Requirements proposal was not approved");
  if (approved.digest !== fresh.digest) throw new Error("Requirements approval is stale");
}
