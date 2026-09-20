import { parseDocument, stringify } from "yaml";
import { Value } from "typebox/value";
import type { CheckerResult, ProbeResult, ProducerResult, ReviewerResult, SplitDecisionResult } from "../board/result-schemas.ts";
import { ArtifactAttestationSchema } from "../board/schemas.ts";
import {
  CheckerResultSchema,
  ProbeResultSchema,
  ProducerResultSchema,
  ReviewerResultSchema,
  SplitDecisionResultSchema,
  validateCheckerResult,
  validateProbeResult,
  validateProducerResult,
  validateReviewerResult,
  validateSplitDecisionResult,
} from "../board/result-schemas.ts";
import { numericId } from "../engine/ids.ts";
import { repositoryRelativePath } from "../engine/paths.ts";
import { DESIGN_CRITERION_KEYS, SHIP_CRITERION_KEYS } from "./criteria.ts";

export const STAGE4_ARTIFACT_TOOLS = Object.freeze([
  "submit_producer_result",
  "submit_checker_result",
  "submit_reviewer_result",
  "submit_split_decision",
  "submit_probe_result",
  "parent_probe",
] as const);
export type Stage4ArtifactTool = (typeof STAGE4_ARTIFACT_TOOLS)[number];

export type Stage4ArtifactKind =
  | "design-producer"
  | "design-check"
  | "split-decision"
  | "implementation-producer"
  | `review-${"acceptance" | "functionality" | "tests" | "readability" | "security" | "simplicity"}`
  | "ship-producer"
  | "ship-check"
  | "probe-project-commands"
  | "probe-ci-status"
  | "probe-pr-state"
  | "probe-diff-policy";

const RUN_ID = /^KFRUN-\d{8}T\d{9}Z-[0-9a-hjkmnp-tv-z]{8}$/;
const CARD_ID = /^CARD-[0-9]{4}$/;
const FINDING_ID = /^FINDING-[0-9]{4}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ABSOLUTE_PATH = /(?:^|[\s=(])\/(?!\/)[^\s,;)]*|(?:^|[\s=(])[A-Za-z]:[\\/]/u;

function fail(message: string): never {
  throw new Error(`Invalid lifecycle artifact: ${message}`);
}

function payloadOf(attestation: Record<string, unknown>): Record<string, unknown> {
  const payload = attestation.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("payload must be an object");
  return payload as Record<string, unknown>;
}

function cardIdOf(attestation: Record<string, unknown>): string {
  const cardId = payloadOf(attestation).card_id;
  if (typeof cardId !== "string" || !CARD_ID.test(cardId)) fail("Stage 4 artifacts require one CARD-* payload identity");
  return cardId;
}

function stage4Kind(attestation: Record<string, unknown>): Stage4ArtifactKind {
  const tool = attestation.tool;
  const payload = payloadOf(attestation);
  if (tool === "submit_producer_result") {
    if (payload.phase === "design") return "design-producer";
    if (payload.phase === "implementation") return "implementation-producer";
    if (payload.phase === "ship") return "ship-producer";
  } else if (tool === "submit_checker_result") {
    if (payload.phase === "design") return "design-check";
    if (payload.phase === "ship") return "ship-check";
  } else if (tool === "submit_reviewer_result") {
    const lens = payload.lens;
    if (["acceptance", "functionality", "tests", "readability", "security", "simplicity"].includes(String(lens))) return `review-${String(lens)}` as Stage4ArtifactKind;
  } else if (tool === "submit_split_decision") {
    return "split-decision";
  } else if (tool === "submit_probe_result" || tool === "parent_probe") {
    if (["project_commands", "ci_status", "pr_state", "diff_policy"].includes(String(payload.probe))) return `probe-${String(payload.probe).replaceAll("_", "-")}` as Stage4ArtifactKind;
  }
  fail(`tool ${String(tool)} and phase/probe do not form a Stage 4 artifact`);
}

/** Derive the only legal durable destination; model-proposed paths are ignored. */
export function lifecycleArtifactPath(attestation: Record<string, unknown>): string {
  if (!Value.Check(ArtifactAttestationSchema, attestation)) fail("attestation does not match its strict schema");
  const card = cardIdOf(attestation);
  const runId = attestation.run_id;
  if (typeof runId !== "string" || !RUN_ID.test(runId) || attestation.dispatch_id !== runId) fail("run and dispatch IDs must be one valid KFRUN identity");
  return `docs/cards/artifacts/${card}/${stage4Kind(attestation)}-${runId}.yaml`;
}

function validatePayload(attestation: Record<string, unknown>): void {
  const payload = payloadOf(attestation) as any;
  const tool = attestation.tool;
  if (tool === "submit_producer_result") {
    if (!Value.Check(ProducerResultSchema, payload)) fail("producer payload does not match its strict schema");
    if (!["design", "implementation", "ship"].includes(payload.phase)) fail("requirements artifacts are not Stage 4 artifacts");
    validateProducerResult(payload as ProducerResult, { dispatchId: payload.dispatch_id, cardId: payload.card_id, phase: payload.phase });
  } else if (tool === "submit_checker_result") {
    if (!Value.Check(CheckerResultSchema, payload)) fail("checker payload does not match its strict schema");
    const criteria = payload.phase === "design" ? DESIGN_CRITERION_KEYS : payload.phase === "ship" ? SHIP_CRITERION_KEYS : [];
    if (criteria.length === 0) fail("requirements checker artifacts are not Stage 4 artifacts");
    validateCheckerResult(payload as CheckerResult, { dispatchId: payload.dispatch_id, cardId: payload.card_id, phase: payload.phase, criteria });
  } else if (tool === "submit_reviewer_result") {
    if (!Value.Check(ReviewerResultSchema, payload)) fail("reviewer payload does not match its strict schema");
    validateReviewerResult(payload as ReviewerResult, { dispatchId: payload.dispatch_id, cardId: payload.card_id, lens: payload.lens });
  } else if (tool === "submit_split_decision") {
    if (!Value.Check(SplitDecisionResultSchema, payload)) fail("split decision payload does not match its strict schema");
    validateSplitDecisionResult(payload as SplitDecisionResult, { dispatchId: payload.dispatch_id, cardId: payload.card_id });
  } else if (tool === "submit_probe_result" || tool === "parent_probe") {
    if (!Value.Check(ProbeResultSchema, payload)) fail("probe payload does not match its strict schema");
    validateProbeResult(payload as ProbeResult, { dispatchId: payload.dispatch_id, cardId: payload.card_id, probe: payload.probe });
  } else {
    fail(`unsupported artifact tool ${String(tool)}`);
  }
}

function assertNoDurableMachinePath(value: unknown, location = "artifact"): void {
  if (typeof value === "string") {
    if (ABSOLUTE_PATH.test(value)) fail(`${location} contains an absolute machine path`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoDurableMachinePath(entry, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertNoDurableMachinePath(child, `${location}.${key}`);
  }
}

function validateAttestationMetadata(attestation: Record<string, unknown>): void {
  const payload = payloadOf(attestation);
  const parent = attestation.tool === "parent_probe";
  if (parent) {
    if (attestation.agent !== null || attestation.model !== null || attestation.stop_reason !== "parent") fail("parent probes require parent attestation metadata");
    const policy = attestation.policy as Record<string, unknown>;
    if (!policy || policy.name !== "parent" || (policy.tools as unknown[]).length !== 0) fail("parent probes require the parent policy");
    const context = attestation.execution_context as Record<string, unknown>;
    if (!context || context.kind !== "parent") fail("parent probes require parent execution context");
  } else {
    if (attestation.agent === null || attestation.model === null) fail("child artifacts require agent and model attestations");
    if (attestation.exit_code !== 0 || attestation.stop_reason !== "toolUse") fail("child artifacts require exit_code 0 and stop_reason toolUse");
  }
  if (attestation.dispatch_id !== payload.dispatch_id) fail("attestation and payload dispatch IDs differ");
  if (!Array.isArray(attestation.finding_ids)) fail("finding_ids must be an array");
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  if ((attestation.finding_ids as unknown[]).length !== findings.length) fail("finding IDs must be parallel to payload findings");
  for (const id of attestation.finding_ids as unknown[]) if (typeof id !== "string" || !FINDING_ID.test(id)) fail("invalid finding ID");
  if (new Set(attestation.finding_ids as unknown[]).size !== (attestation.finding_ids as unknown[]).length) fail("finding IDs contain duplicates");
  const context = attestation.execution_context as Record<string, unknown>;
  if (!context || typeof context.commit !== "string" || !OBJECT_ID.test(context.commit)) fail("execution context commit is invalid");
}

/** Validate a complete accepted Stage 4 artifact and return its canonical path. */
export function validateLifecycleArtifact(attestation: Record<string, unknown>, expectedPath?: string): string {
  if (!Value.Check(ArtifactAttestationSchema, attestation)) fail("attestation does not match its strict schema");
  if (!STAGE4_ARTIFACT_TOOLS.includes(attestation.tool as Stage4ArtifactTool)) fail("unknown Stage 4 artifact tool");
  validatePayload(attestation);
  validateAttestationMetadata(attestation);
  assertNoDurableMachinePath(attestation);
  const path = lifecycleArtifactPath(attestation);
  if (expectedPath !== undefined && path !== repositoryRelativePath(expectedPath)) fail("artifact path is not engine-derived");
  return path;
}

const ATTESTATION_ORDER = ["run_id", "dispatch_id", "tool", "agent", "model", "policy", "execution_context", "argv", "started_at", "completed_at", "exit_code", "stop_reason", "finding_ids", "payload"] as const;
const PAYLOAD_ORDER: Readonly<Record<string, readonly string[]>> = {
  submit_producer_result: ["schema_version", "dispatch_id", "card_id", "phase", "status", "summary", "artifacts", "findings", "questions", "evidence", "requirement_changes", "card_changes", "planned_paths"],
  submit_checker_result: ["schema_version", "dispatch_id", "card_id", "phase", "status", "summary", "criteria", "findings", "evidence"],
  submit_reviewer_result: ["schema_version", "dispatch_id", "card_id", "phase", "lens", "status", "summary", "findings", "evidence", "rerun_recommended"],
  submit_split_decision: ["schema_version", "dispatch_id", "card_id", "status", "rationale", "replacement_cards", "evidence"],
  parent_probe: ["schema_version", "dispatch_id", "card_id", "probe", "status", "summary", "observations", "evidence"],
};

function orderValue(value: unknown, preferred: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((entry) => orderValue(entry));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const keys = [...preferred.filter((key) => Object.hasOwn(record, key)), ...Object.keys(record).filter((key) => !preferred.includes(key)).sort()];
  return Object.fromEntries(keys.map((key) => [key, orderValue(record[key], key === "payload" ? [] : [])]));
}

function canonicalAttestation(value: Record<string, unknown>): Record<string, unknown> {
  const payloadOrder = PAYLOAD_ORDER[String(value.tool)] ?? [];
  const entries = ATTESTATION_ORDER.filter((key) => Object.hasOwn(value, key)).map((key) => {
    const child = key === "payload" ? orderValue(value[key], payloadOrder) : orderValue(value[key]);
    return [key, child];
  });
  return Object.fromEntries(entries);
}

/** Validate then render LF-normalized, canonical-key-ordered YAML. */
export function renderLifecycleArtifact(attestation: Record<string, unknown>): { readonly path: string; readonly bytes: string } {
  const path = validateLifecycleArtifact(attestation);
  const ordered = canonicalAttestation(attestation);
  const bytes = stringify(ordered, { lineWidth: 0, sortMapEntries: false }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n");
  return Object.freeze({ path, bytes });
}

/** Parse an artifact and require that its bytes are the canonical rendering. */
export function validateRenderedLifecycleArtifact(bytes: string, expectedPath: string): Record<string, unknown> {
  if (bytes.includes("\r")) fail("artifact must use LF line endings");
  const document = parseDocument(bytes, { uniqueKeys: true, schema: "core" });
  if (document.errors.length > 0) fail(`artifact YAML is invalid: ${document.errors[0].message}`);
  const value = document.toJS({ mapAsMap: false }) as Record<string, unknown>;
  const path = validateLifecycleArtifact(value, expectedPath);
  const rendered = renderLifecycleArtifact(value);
  if (rendered.path !== path || rendered.bytes !== bytes) fail("artifact is not canonically rendered");
  return value;
}

export interface FindingAllocation {
  readonly findingIds: readonly string[];
  readonly byAttempt: readonly (readonly string[])[];
  readonly nextFinding: number;
}

function findingsIn(value: unknown): number {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const payload = record.payload && typeof record.payload === "object" ? record.payload as Record<string, unknown> : record;
    return Array.isArray(payload.findings) ? payload.findings.length : 0;
  }
  return 0;
}

/**
 * Allocate findings in artifact/payload order without mutating counters.  The
 * caller adds the returned IDs to its candidate only after all validation has
 * succeeded; rejected candidates therefore consume nothing.
 */
export function allocateFindingIds(input: number | { readonly nextFinding: number; readonly priorFindingIds?: readonly string[]; readonly attempts: readonly unknown[] }, attempts: readonly unknown[] = [], priorFindingIds: readonly string[] = []): FindingAllocation {
  const start = typeof input === "number" ? input : input.nextFinding;
  const values = typeof input === "number" ? attempts : input.attempts;
  const prior = typeof input === "number" ? priorFindingIds : (input.priorFindingIds ?? []);
  if (!Number.isInteger(start) || start < 1 || start > 9999) fail("finding counter is outside schema version 1");
  const priorNumbers = prior.map((id) => {
    if (!FINDING_ID.test(id)) fail(`invalid prior finding ID ${id}`);
    return Number(id.slice(-4));
  });
  if (new Set(prior).size !== prior.length) fail("prior finding IDs contain duplicates");
  if (priorNumbers.some((id) => id >= start)) fail("finding counter would reuse a historical ID");
  const count = values.reduce((total: number, value: unknown) => total + findingsIn(value), 0);
  if (start + count - 1 > 9999) fail("finding namespace is exhausted in schema version 1");
  let next = start;
  const byAttempt: string[][] = [];
  for (const value of values) {
    const ids = Array.from({ length: findingsIn(value) }, () => numericId("FINDING", next++));
    byAttempt.push(ids);
  }
  return Object.freeze({ findingIds: Object.freeze(byAttempt.flat()), byAttempt: Object.freeze(byAttempt.map((ids) => Object.freeze(ids))), nextFinding: next });
}

export const allocateStage4FindingIds = allocateFindingIds;

/** Append accepted attempts while retaining their original execution order. */
export function appendArtifactPaths(existing: readonly string[], additions: readonly string[]): readonly string[] {
  const result = [...existing];
  for (const path of additions) {
    const normalized = repositoryRelativePath(path);
    if (!result.includes(normalized)) result.push(normalized);
  }
  return Object.freeze(result);
}

/** Append finding IDs without reordering or overwriting historical attempts. */
export function appendFindingIds(existing: readonly string[], additions: readonly string[]): readonly string[] {
  const all = [...existing, ...additions];
  if (all.some((id) => !FINDING_ID.test(id)) || new Set(all).size !== all.length) fail("finding history must be unique and append-only");
  return Object.freeze(all);
}
