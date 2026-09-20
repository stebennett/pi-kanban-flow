import { parseDocument } from "yaml";
import { validateProducerResult, validateCheckerResult, type ProducerResult, type CheckerResult } from "../board/result-schemas.ts";
import { DESIGN_CRITERION_KEYS } from "./criteria.ts";
import { serializePullRequestMarker, type PullRequestMarker, type CommitTrailers } from "../state-pr/markers.ts";
import { canonicalSlug, managedBranch } from "../git/worktrees.ts";

const HEADINGS = ["Context", "Scope", "Acceptance mapping", "Interfaces and data flow", "Implementation tasks", "Test-first plan", "Objective verification", "Alternatives", "Decisions", "Risks and compatibility", "Planned paths"] as const;
const PRODUCT_PREFIXES = [".git", "BOARD.md", "docs/cards/", "docs/designs/"];
const PATH_RE = /^(?!\/)(?!.*\\)(?!.*\u0000)(?!.*[\r\n])(?!(?:^|\/)\.\.?(?:\/|$)).+$/;
export interface DesignPath { readonly path: string; readonly action: "create" | "modify" | "delete"; }
interface ListedPath extends DesignPath { readonly task: string; }
export interface DesignValidationInput { readonly cardId: string; readonly title: string; readonly acceptanceCriteria: readonly string[]; readonly plannedPaths: ReadonlyArray<DesignPath>; readonly content: string; }
export interface DesignValidation { readonly content: string; readonly plannedPaths: readonly DesignPath[]; readonly taskKeys: readonly string[]; }
function fail(message: string): never { throw new Error(`Invalid design: ${message}`); }
function lines(content: string): string[] { return content.replace(/\r\n?/g, "\n").split("\n"); }
function sectionBody(all: string[], heading: string): string {
  const start = all.indexOf(`## ${heading}`); if (start < 0) fail(`missing section ${heading}`);
  const end = all.findIndex((line, i) => i > start && /^## /.test(line));
  return all.slice(start + 1, end < 0 ? all.length : end).join("\n").trim();
}
function normalizePath(path: string): string {
  if (!PATH_RE.test(path) || path !== path.trim() || path.includes("//")) fail(`invalid planned path ${path}`);
  const normalized = path.replace(/\\/g, "/");
  if (normalized !== path) fail(`planned path is not normalized: ${path}`);
  if (PRODUCT_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) fail(`planned path is not product-owned: ${path}`);
  return normalized;
}
export function validateDesignPlannedPaths(paths: ReadonlyArray<DesignPath>): readonly DesignPath[] {
  if (!Array.isArray(paths) || paths.length === 0) fail("planned paths must be non-empty");
  const seen = new Set<string>();
  return Object.freeze(paths.map((entry) => {
    const path = normalizePath(entry.path);
    if (seen.has(path)) fail(`duplicate planned path ${path}`); seen.add(path);
    if (!["create", "modify", "delete"].includes(entry.action)) fail(`invalid action for ${path}`);
    return Object.freeze({ path, action: entry.action });
  }));
}
function parseTaskKeys(body: string): string[] {
  const keys = [...body.matchAll(/\b(TASK-[A-Z0-9][A-Z0-9_-]*)\b/g)].map((m) => m[1]!);
  if (new Set(keys).size !== keys.length) return [...new Set(keys)];
  return keys;
}
function parsePlannedLines(body: string): ListedPath[] {
  return body.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^[-*]\s+([^|]+?)\s*\|\s*(create|modify|delete)\s*\|\s*(TASK-[A-Z0-9][A-Z0-9_-]*)\s*$/.exec(line);
    if (!match) fail(`planned path line must be '- path | action | TASK-key': ${line}`);
    return { path: match[1]!.trim(), action: match[2]! as DesignPath["action"], task: match[3]! };
  });
}
/** Validate the canonical producer document, independently of any child claim. */
export function validateDesignDocument(input: DesignValidationInput): DesignValidation {
  if (!/^CARD-[0-9]{4}$/.test(input.cardId) || !input.title.trim()) fail("card identity is invalid");
  const content = input.content.replace(/\r\n?/g, "\n");
  if (content !== input.content || Buffer.byteLength(content) > 200_000) fail("document must be LF-normalized and bounded");
  const all = lines(content);
  if (all[0] !== `# ${input.cardId}: ${input.title}`) fail("first heading must identify the card");
  if (all.filter((line) => /^# /.test(line)).length !== 1) fail("document may have only one level-one heading");
  const found = all.filter((line) => /^## /.test(line)).map((line) => line.slice(3));
  if (JSON.stringify(found) !== JSON.stringify(HEADINGS)) fail("level-two headings must exactly match the required order");
  const scope = sectionBody(all, "Scope");
  if (!/^### In scope\n[\s\S]+\n### Out of scope\n[\s\S]+$/u.test(scope)) fail("scope subsections are required in order");
  for (const heading of HEADINGS) if (!sectionBody(all, heading)) fail(`section ${heading} must not be empty`);
  const mapping = sectionBody(all, "Acceptance mapping");
  for (const criterion of input.acceptanceCriteria) if (!mapping.includes(criterion)) fail(`acceptance criterion ${criterion} is not mapped`);
  const taskKeys = parseTaskKeys(sectionBody(all, "Implementation tasks"));
  if (taskKeys.length === 0 || new Set(taskKeys).size !== taskKeys.length) fail("implementation tasks require unique TASK keys");
  const paths = validateDesignPlannedPaths(input.plannedPaths);
  const listed = parsePlannedLines(sectionBody(all, "Planned paths"));
  const normalizedListed = validateDesignPlannedPaths(listed);
  if (JSON.stringify(normalizedListed) !== JSON.stringify(paths)) fail("typed planned paths do not exactly match the document");
  if (listed.some((entry) => !taskKeys.includes(entry.task))) fail("planned path references an unknown task");
  if (/\bADR\s+(?:file|files|index|indexes)\b/i.test(content)) fail("ADR persistence is not allowed");
  if (/(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(content)) fail("absolute machine path is not allowed");
  return Object.freeze({ content, plannedPaths: paths, taskKeys: Object.freeze(taskKeys) });
}
export function validateDesignProducerResult(result: ProducerResult, input: Omit<DesignValidationInput, "content" | "plannedPaths"> & { readonly dispatchId?: string }): DesignValidation {
  validateProducerResult(result, { dispatchId: input.dispatchId ?? result.dispatch_id, cardId: input.cardId, phase: "design" });
  if (result.status !== "completed") fail("producer did not complete");
  const artifact = result.artifacts.filter((item) => item.type === "design_document");
  if (artifact.length !== 1) fail("producer must return exactly one design document");
  return validateDesignDocument({ ...input, content: artifact[0]!.content, plannedPaths: result.planned_paths as DesignPath[] });
}
export function validateDesignCheckerResult(result: CheckerResult, dispatchId: string, cardId: string): void {
  validateCheckerResult(result, { dispatchId, cardId, phase: "design", criteria: DESIGN_CRITERION_KEYS });
}
export function designBranch(cardId: string, title: string): string { return managedBranch("design", cardId, title); }
export function designCommitTrailers(operationId: string, cardId: string): CommitTrailers { return { kind: "design", operation_id: operationId, card_ids: [cardId], transaction_id: null }; }
export function designMarker(operationId: string, cardId: string): PullRequestMarker { return { version: 1, kind: "design", operation_id: operationId, card_ids: [cardId], base: "main" }; }
export function designPrBody(input: { cardId: string; title: string; commit: string; base: string; plannedPaths: ReadonlyArray<DesignPath>; producerArtifact: string; checkerArtifact: string; operationId: string }): string {
  if (input.base !== "main") fail("design PR base must be main");
  const marker = serializePullRequestMarker(designMarker(input.operationId, input.cardId));
  const paths = input.plannedPaths.map((p) => `- ${p.path} (${p.action})`).join("\n");
  return `${marker}\n\n## Design\nCard: ${input.cardId}: ${input.title}\nChecked design commit: ${input.commit}\n\n## Scope\nApproved base: ${input.base}\nPlanned product paths/actions:\n${paths}\n\n## Verification\nProducer artifact: ${input.producerArtifact}\nChecker artifact: ${input.checkerArtifact}\n\n## Human merge\nMerge this design PR only after reviewing the checked immutable design commit.\n`;
}
export function parseDesignDocument(bytes: string): unknown { const document = parseDocument(bytes, { uniqueKeys: true, schema: "core" }); if (document.errors.length) fail(document.errors[0]!.message); return document.toJS(); }
export { canonicalSlug };
