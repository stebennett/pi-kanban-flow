import { isNumericId, isObjectId, isRuntimeId } from "../engine/ids.ts";

export type ManagedPullRequestKind = "state" | "design" | "product";
export interface PullRequestMarker {
  version: 1;
  kind: ManagedPullRequestKind;
  operation_id: string;
  card_ids: string[];
  base: "main";
  transaction_id?: string;
}

export type ActionMarkerKind = "requirements-design-close" | "deterministic-correction";
export interface ActionMarker {
  version: 1;
  kind: ActionMarkerKind;
  operation_id: string;
  card_id: string;
  criterion: string | null;
}

export interface ResolutionMarker {
  version: 1;
  transaction_id: string;
  decision: "adopt" | "abandon";
  resolution_operation_id: string;
  replacement_transaction_id: string | null;
}

export interface CommitTrailers {
  kind: "design" | "product" | "state";
  operation_id: string;
  card_ids: string[];
  transaction_id: string | null;
}

const PR_MARKER_PREFIX = "<!-- kanban-flow:";
const PR_MARKER_SUFFIX = " -->";
const ACTION_MARKER_PREFIX = "<!-- kanban-flow-action:";
const RESOLUTION_MARKER_PREFIX = "<!-- kanban-flow-resolution:";
const SUFFIX = " -->";
const ID_ORDER = (ids: readonly string[]) => ids.every((id, index) => index === 0 || ids[index - 1]! < id);

function exactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function parseJsonComment(body: string, prefix: string, label: string): unknown {
  const candidates = [...body.matchAll(new RegExp(`${escapeRegExp(prefix)}([\\s\\S]*?)${escapeRegExp(SUFFIX)}`, "g"))];
  if (candidates.length !== 1) throw new Error(`${label} must occur exactly once`);
  try {
    return JSON.parse(candidates[0]![1]!);
  } catch (error) {
    throw new Error(`malformed ${label}`, { cause: error });
  }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.includes("\0") || value.includes("\r") || value.includes("\n")) throw new Error(`invalid ${label}`);
}
function assertCardIds(ids: unknown, exactCount: number | null = null): asserts ids is string[] {
  if (!Array.isArray(ids) || (exactCount !== null && ids.length !== exactCount) || ids.some((id) => typeof id !== "string" || !isNumericId(id, "CARD")) || !ID_ORDER(ids)) {
    throw new Error("card_ids must be ascending CARD IDs");
  }
}

export function validatePullRequestMarker(value: unknown): PullRequestMarker {
  exactKeys(value, ["version", "kind", "operation_id", "card_ids", "base", ...(typeof value === "object" && value !== null && "kind" in value && (value as { kind?: unknown }).kind === "state" ? ["transaction_id"] : [])], "PR marker");
  const marker = value as Record<string, unknown>;
  if (marker.version !== 1 || !["state", "design", "product"].includes(String(marker.kind))) throw new Error("invalid PR marker version or kind");
  assertString(marker.operation_id, "operation ID");
  if (!isRuntimeId(marker.operation_id, "KFOP")) throw new Error("invalid PR marker operation ID");
  assertCardIds(marker.card_ids, marker.kind === "state" ? null : 1);
  if (marker.base !== "main") throw new Error("invalid PR marker base");
  if (marker.kind === "state") {
    assertString(marker.transaction_id, "transaction ID");
    if (!isRuntimeId(marker.transaction_id, "KFTX")) throw new Error("invalid PR marker transaction ID");
  } else if ("transaction_id" in marker) {
    throw new Error("design/product marker cannot contain a transaction ID");
  }
  return marker as unknown as PullRequestMarker;
}

export function serializePullRequestMarker(marker: PullRequestMarker): string {
  const valid = validatePullRequestMarker(marker);
  const ordered: Record<string, unknown> = { version: 1, kind: valid.kind, operation_id: valid.operation_id, card_ids: valid.card_ids, base: "main" };
  if (valid.kind === "state") ordered.transaction_id = valid.transaction_id;
  return `${PR_MARKER_PREFIX}${JSON.stringify(ordered)}${PR_MARKER_SUFFIX}`;
}

export function parsePullRequestMarker(body: string): PullRequestMarker {
  const marker = parseJsonComment(body, PR_MARKER_PREFIX, "kanban-flow PR marker");
  return validatePullRequestMarker(marker);
}

export function validateActionMarker(value: unknown): ActionMarker {
  exactKeys(value, ["version", "kind", "operation_id", "card_id", "criterion"], "action marker");
  const marker = value as Record<string, unknown>;
  if (marker.version !== 1 || !["requirements-design-close", "deterministic-correction"].includes(String(marker.kind))) throw new Error("invalid action marker");
  assertString(marker.operation_id, "operation ID");
  if (!isRuntimeId(marker.operation_id, "KFOP")) throw new Error("invalid action operation ID");
  assertString(marker.card_id, "card ID");
  if (!isNumericId(marker.card_id, "CARD")) throw new Error("invalid action card ID");
  if (marker.criterion !== null) { assertString(marker.criterion, "criterion"); if (marker.kind !== "deterministic-correction") throw new Error("closure action criterion must be null"); }
  if (marker.kind === "deterministic-correction" && marker.criterion === null) throw new Error("correction action requires criterion");
  return marker as unknown as ActionMarker;
}

export function serializeActionMarker(marker: ActionMarker): string {
  const valid = validateActionMarker(marker);
  return `${ACTION_MARKER_PREFIX}${JSON.stringify({ version: 1, kind: valid.kind, operation_id: valid.operation_id, card_id: valid.card_id, criterion: valid.criterion })}${SUFFIX}`;
}
export function parseActionMarker(body: string): ActionMarker { return validateActionMarker(parseJsonComment(body, ACTION_MARKER_PREFIX, "kanban-flow action marker")); }

export function validateResolutionMarker(value: unknown): ResolutionMarker {
  exactKeys(value, ["version", "transaction_id", "decision", "resolution_operation_id", "replacement_transaction_id"], "resolution marker");
  const marker = value as Record<string, unknown>;
  if (marker.version !== 1 || !["adopt", "abandon"].includes(String(marker.decision))) throw new Error("invalid resolution marker");
  for (const [field, prefix] of [["transaction_id", "KFTX"], ["resolution_operation_id", "KFOP"]] as const) {
    assertString(marker[field], field);
    if (!isRuntimeId(marker[field], prefix)) throw new Error(`invalid resolution ${field}`);
  }
  if (marker.replacement_transaction_id !== null) {
    assertString(marker.replacement_transaction_id, "replacement transaction ID");
    if (!isRuntimeId(marker.replacement_transaction_id, "KFTX")) throw new Error("invalid replacement transaction ID");
  }
  if (marker.decision === "abandon" && marker.replacement_transaction_id !== null) throw new Error("abandon cannot have replacement transaction");
  return marker as unknown as ResolutionMarker;
}
export function serializeResolutionMarker(marker: ResolutionMarker): string {
  const valid = validateResolutionMarker(marker);
  return `${RESOLUTION_MARKER_PREFIX}${JSON.stringify({ version: 1, transaction_id: valid.transaction_id, decision: valid.decision, resolution_operation_id: valid.resolution_operation_id, replacement_transaction_id: valid.replacement_transaction_id })}${SUFFIX}`;
}
export function parseResolutionMarker(body: string): ResolutionMarker { return validateResolutionMarker(parseJsonComment(body, RESOLUTION_MARKER_PREFIX, "kanban-flow resolution marker")); }

function assertOperation(value: string): void { if (!isRuntimeId(value, "KFOP")) throw new Error("invalid operation trailer"); }
function assertTransaction(value: string): void { if (!isRuntimeId(value, "KFTX")) throw new Error("invalid transaction trailer"); }

export function validateCommitTrailers(value: CommitTrailers): CommitTrailers {
  if (!["design", "product", "state"].includes(value.kind)) throw new Error("invalid commit trailer kind");
  assertString(value.operation_id, "operation trailer"); assertOperation(value.operation_id);
  assertCardIds(value.card_ids, value.kind === "state" ? null : 1);
  if (value.kind === "state") { if (value.transaction_id === null) throw new Error("state commit requires transaction trailer"); assertTransaction(value.transaction_id); }
  else if (value.transaction_id !== null) throw new Error("design/product commit cannot have transaction trailer");
  return value;
}

export function serializeCommitTrailers(value: CommitTrailers): string {
  const valid = validateCommitTrailers(value);
  const lines = [`Kanban-Flow-Kind: ${valid.kind}`, `Kanban-Flow-Operation: ${valid.operation_id}`];
  for (const cardId of valid.card_ids) lines.push(`Kanban-Flow-Card: ${cardId}`);
  if (valid.kind === "state") lines.push(`Kanban-Flow-Transaction: ${valid.transaction_id}`);
  return lines.join("\n");
}

export function parseCommitTrailers(message: string): CommitTrailers {
  const values = new Map<string, string[]>();
  for (const line of message.split(/\r?\n/)) {
    const match = /^(Kanban-Flow-(?:Kind|Operation|Card|Transaction)):\s*(.*)$/.exec(line);
    if (match) values.set(match[1]!, [...(values.get(match[1]!) ?? []), match[2]!]);
  }
  const kind = values.get("Kanban-Flow-Kind") ?? [];
  const operation = values.get("Kanban-Flow-Operation") ?? [];
  const cards = values.get("Kanban-Flow-Card") ?? [];
  const transactions = values.get("Kanban-Flow-Transaction") ?? [];
  if (kind.length !== 1 || operation.length !== 1 || transactions.length > 1 || (cards.length === 0 && kind[0] !== "state") || (kind[0] === "state" && transactions.length !== 1)) throw new Error("missing or duplicate Kanban-Flow trailers");
  return validateCommitTrailers({ kind: kind[0] as CommitTrailers["kind"], operation_id: operation[0]!, card_ids: cards, transaction_id: transactions[0] ?? null });
}

export function assertMarkerMatchesBranch(marker: PullRequestMarker, head: string): void {
  const card = marker.card_ids.length === 1 ? marker.card_ids[0] : undefined;
  if (marker.kind === "state") {
    if (head !== `kanban/state/${marker.transaction_id}`) throw new Error("state marker branch mismatch");
  } else if (!card || !new RegExp(`^kanban/${marker.kind}/${card}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(head)) {
    throw new Error(`${marker.kind} marker branch mismatch`);
  }
}

export function isGitObjectId(value: string): boolean { return isObjectId(value); }
