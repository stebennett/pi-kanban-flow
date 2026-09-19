import { randomBytes } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import { Value } from "typebox/value";
import { ArtifactAttestationSchema, BoardSchema, CardSchema, ConfigSchema, type Board, type Config } from "./schemas.ts";
import { CheckerResultSchema, ProbeResultSchema, ProducerResultSchema, ReviewerResultSchema, SplitDecisionResultSchema } from "./result-schemas.ts";
import { renderBoard, type RenderCard } from "../engine/render.ts";
import { parseRequirements } from "./requirements.ts";
import { validateBoardSemantics } from "./semantic-validation.ts";

const CARD_FILE = /^CARD-[0-9]{4}\.md$/;
const CARD_KEYS = [
  "id", "title", "status", "requirements", "grandfathered_requirements", "acceptance_criteria", "dependencies", "replaces", "replaced_by",
  "replacement_reason", "priority", "created_at", "updated_at", "started_at", "delivered_at", "blocked", "workflow", "rework", "history",
];
const WORKFLOW_KEYS = ["design", "split_decision", "implementation", "review", "ship"];
const NESTED_KEYS: Record<string, readonly string[]> = {
  design: ["branch", "pr", "producer_result_paths", "checker_result_paths", "approved_commit"],
  split_decision: ["result_path", "decided_at", "override"],
  implementation: ["branch", "result_paths", "head_commit"],
  review: ["result_paths", "reviewed_commit", "completed_at"],
  ship: ["product_pr", "verification_result_paths", "merged_commit"],
  blocked: ["reason", "source_phase", "resume_status", "created_at", "evidence"],
  rework: ["design", "implementation"],
  acceptance_criteria: ["id", "text", "requirement"],
  pr: ["number", "url", "head", "base", "state", "operation_id", "head_commit", "merge_commit", "last_checked_at"],
  history: ["id", "at", "kind", "from_status", "to_status", "operation_id", "transaction_id", "summary"],
};
const STATUSES = new Set(["backlog", "designing", "design_review", "ready_for_implementation", "implementing", "implementation_review", "ready_to_ship", "shipping", "done", "replaced"]);

export interface CardRecord extends RenderCard {
  readonly why?: string;
  readonly notes?: string;
  acceptance_criteria: unknown[];
  replaces: string[];
  replaced_by: string[];
  replacement_reason: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  delivered_at: string | null;
  rework: { design: number; implementation: number };
  history: unknown[];
  [key: string]: unknown;
}

export interface BoardSnapshot {
  readonly root: string;
  readonly board: Board;
  readonly config: Config;
  readonly cards: readonly CardRecord[];
  readonly findingIds?: readonly string[];
  readonly requirements: string | undefined;
  readonly dashboard: string | undefined;
  readonly canonicalDashboard: string;
  readonly dashboardDrift: boolean;
}

class RepositoryFormatError extends Error {
  constructor(message: string) {
    super(`Invalid kanban board repository: ${message}`);
    this.name = "RepositoryFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: unknown, keys: readonly string[], location: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new RepositoryFormatError(`${location} must be a mapping`);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !expected.has(key));
  if (unknown.length > 0) throw new RepositoryFormatError(`${location} has unknown field ${unknown.sort()[0]}`);
  const missing = keys.filter((key) => !(key in value));
  if (missing.length > 0) throw new RepositoryFormatError(`${location} is missing ${missing[0]}`);
}

async function regularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new RepositoryFormatError(`missing ${label}`);
  if (info.isSymbolicLink()) throw new RepositoryFormatError(`${label} is a symlink`);
  if (!info.isFile()) throw new RepositoryFormatError(`${label} is not a regular file`);
  if (info.nlink !== 1) throw new RepositoryFormatError(`${label} has unexpected link count`);
}

async function directory(path: string, label: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new RepositoryFormatError(`missing ${label}`);
  if (info.isSymbolicLink()) throw new RepositoryFormatError(`${label} is a symlink`);
  if (!info.isDirectory()) throw new RepositoryFormatError(`${label} is not a directory`);
}

async function textFile(path: string, label: string): Promise<string> {
  await regularFile(path, label);
  const text = await readFile(path, "utf8");
  if (text.includes("\r")) throw new RepositoryFormatError(`${label} must use LF line endings`);
  return text;
}

function parseYaml<T>(text: string, label: string): T {
  const document = parseDocument(text, { uniqueKeys: true, schema: "core" });
  if (document.errors.length > 0) throw new RepositoryFormatError(`${label} has invalid YAML: ${document.errors[0].message}`);
  const value = document.toJS({ mapAsMap: false }) as unknown;
  return value as T;
}

function parseCard(text: string, filename: string): CardRecord {
  if (!text.startsWith("---\n")) throw new RepositoryFormatError(`${filename} has no frontmatter`);
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new RepositoryFormatError(`${filename} has an unterminated frontmatter block`);
  const frontmatter = parseYaml<unknown>(text.slice(4, end + 1), `${filename} frontmatter`);
  assertExactKeys(frontmatter, CARD_KEYS, `${filename} frontmatter`);
  const body = text.slice(end + 5);
  const card = frontmatter as CardRecord;
  if (typeof card.id !== "string" || typeof card.title !== "string" || typeof card.status !== "string") {
    throw new RepositoryFormatError(`${filename} has invalid card identity`);
  }
  if (card.id !== filename.slice(0, -3)) throw new RepositoryFormatError(`${filename} ID does not match filename`);
  if (!STATUSES.has(card.status)) throw new RepositoryFormatError(`${filename} has invalid status`);
  if (!Array.isArray(card.requirements) || card.requirements.length === 0 || !Array.isArray(card.dependencies)) {
    throw new RepositoryFormatError(`${filename} has invalid requirement/dependency arrays`);
  }
  if (!Array.isArray(card.grandfathered_requirements) || !Array.isArray(card.acceptance_criteria)) throw new RepositoryFormatError(`${filename} has invalid card arrays`);
  assertExactKeys(card.workflow, WORKFLOW_KEYS, `${filename}.workflow`);
  assertExactKeys(card.workflow.design, NESTED_KEYS.design, `${filename}.workflow.design`);
  assertExactKeys(card.workflow.split_decision, NESTED_KEYS.split_decision, `${filename}.workflow.split_decision`);
  assertExactKeys(card.workflow.implementation, NESTED_KEYS.implementation, `${filename}.workflow.implementation`);
  assertExactKeys(card.workflow.review, NESTED_KEYS.review, `${filename}.workflow.review`);
  assertExactKeys(card.workflow.ship, NESTED_KEYS.ship, `${filename}.workflow.ship`);
  assertExactKeys(card.rework, NESTED_KEYS.rework, `${filename}.rework`);
  if (!Array.isArray(card.history)) throw new RepositoryFormatError(`${filename}.history must be an array`);
  if (!Value.Check(CardSchema, frontmatter)) throw new RepositoryFormatError(`${filename} frontmatter does not match its strict schema`);
  for (const item of card.acceptance_criteria) assertExactKeys(item, NESTED_KEYS.acceptance_criteria, `${filename}.acceptance_criteria[]`);
  for (const item of card.history) assertExactKeys(item, NESTED_KEYS.history, `${filename}.history[]`);
  if (card.blocked !== null) assertExactKeys(card.blocked, NESTED_KEYS.blocked, `${filename}.blocked`);
  if (card.workflow.design.pr !== null) assertExactKeys(card.workflow.design.pr, NESTED_KEYS.pr, `${filename}.workflow.design.pr`);
  if (card.workflow.ship.product_pr !== null) assertExactKeys(card.workflow.ship.product_pr, NESTED_KEYS.pr, `${filename}.workflow.ship.product_pr`);
  const lines = body.split("\n");
  const header = `# ${card.id}: ${card.title}`;
  if (lines[0] !== header) throw new RepositoryFormatError(`${filename} body must begin with ${header}`);
  if (lines.slice(1).some((line) => /^# /.test(line))) throw new RepositoryFormatError(`${filename} body contains another level-one heading`);
  const why = lines.reduce((count, line) => count + (line === "## Why" ? 1 : 0), 0);
  const notes = lines.reduce((count, line) => count + (line === "## Notes" ? 1 : 0), 0);
  if (why !== 1 || notes !== 1 || lines.indexOf("## Why") > lines.indexOf("## Notes")) {
    throw new RepositoryFormatError(`${filename} body must contain ## Why then ## Notes exactly once`);
  }
  const whyIndex = lines.indexOf("## Why");
  const notesIndex = lines.indexOf("## Notes");
  return Object.assign(card, {
    why: lines.slice(whyIndex + 1, notesIndex).join("\n").trim(),
    notes: lines.slice(notesIndex + 1).join("\n").trim(),
  });
}

function expectedArtifactPath(attestation: Record<string, any>): string {
  const payload = attestation.payload; const card = payload.card_id; let kind: string;
  if (attestation.tool === "submit_producer_result") kind = payload.phase === "requirements" ? "requirements-producer" : payload.phase === "design" ? "design-producer" : payload.phase === "implementation" ? "implementation-producer" : "ship-producer";
  else if (attestation.tool === "submit_checker_result") kind = payload.phase === "requirements" ? "requirements-check" : payload.phase === "design" ? "design-check" : "ship-check";
  else if (attestation.tool === "submit_reviewer_result") kind = `review-${payload.lens}`;
  else if (attestation.tool === "submit_split_decision") kind = "split-decision";
  else if (attestation.tool === "submit_probe_result" || attestation.tool === "parent_probe") kind = `probe-${String(payload.probe).replaceAll("_", "-")}`;
  else throw new RepositoryFormatError(`unknown artifact tool ${String(attestation.tool)}`);
  return `docs/cards/artifacts/${card === "none" ? "requirements" : card}/${kind}-${attestation.run_id}.yaml`;
}

function validateArtifact(text: string, relativePath: string): string[] {
  const value = parseYaml<Record<string, any>>(text, relativePath);
  if (!Value.Check(ArtifactAttestationSchema, value)) throw new RepositoryFormatError(`${relativePath} does not match the attestation schema`);
  const schemas: Record<string, any> = { submit_producer_result: ProducerResultSchema, submit_checker_result: CheckerResultSchema, submit_reviewer_result: ReviewerResultSchema, submit_split_decision: SplitDecisionResultSchema, submit_probe_result: ProbeResultSchema, parent_probe: ProbeResultSchema };
  if (!Value.Check(schemas[value.tool], value.payload)) throw new RepositoryFormatError(`${relativePath} has an invalid typed payload`);
  if (value.finding_ids.length !== (Array.isArray(value.payload.findings) ? value.payload.findings.length : 0)) throw new RepositoryFormatError(`${relativePath} has mismatched finding IDs`);
  if (value.run_id !== value.dispatch_id || value.run_id !== value.payload.dispatch_id) throw new RepositoryFormatError(`${relativePath} has mismatched run identity`);
  if (expectedArtifactPath(value) !== relativePath) throw new RepositoryFormatError(`${relativePath} does not match its deterministic artifact path`);
  return [...value.finding_ids];
}

async function validateOwnedTree(path: string, relativeRoot: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new RepositoryFormatError(`${relativeRoot}/${entry.name} is a symlink`);
    if (entry.isDirectory()) await validateOwnedTree(child, `${relativeRoot}/${entry.name}`);
    else if (!entry.isFile() || (await lstat(child)).nlink !== 1) throw new RepositoryFormatError(`${relativeRoot}/${entry.name} is not a regular file`);
  }
}

function contained(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix !== "" && !suffix.startsWith("..") && !suffix.startsWith("/");
}

/** Read and validate the fixed board layout without performing filesystem writes. */
export async function readBoardRepository(inputRoot: string): Promise<BoardSnapshot> {
  const root = await realpath(resolve(inputRoot)).catch(() => { throw new RepositoryFormatError("repository root does not exist"); });
  const docs = join(root, "docs");
  const cardsPath = join(docs, "cards");
  if (!contained(root, docs) || !contained(root, cardsPath)) throw new RepositoryFormatError("board paths escape repository root");
  await directory(docs, "docs");
  await directory(cardsPath, "docs/cards");
  await validateOwnedTree(cardsPath, "docs/cards");
  const boardValue = parseYaml<unknown>(await textFile(join(cardsPath, "board.yaml"), "board.yaml"), "board.yaml");
  const configValue = parseYaml<unknown>(await textFile(join(cardsPath, "config.yaml"), "config.yaml"), "config.yaml");
  if (!Value.Check(BoardSchema, boardValue)) throw new RepositoryFormatError("board.yaml does not match its strict schema");
  if (!Value.Check(ConfigSchema, configValue)) throw new RepositoryFormatError("config.yaml does not match its strict schema");
  const entries = await readdir(cardsPath, { withFileTypes: true });
  const cards: CardRecord[] = [];
  const findingIds: string[] = [];
  let dashboard: string | undefined;
  for (const entry of entries) {
    const path = join(cardsPath, entry.name);
    if (entry.name === "board.yaml" || entry.name === "config.yaml") continue;
    if (entry.name === "BOARD.md") {
      dashboard = await textFile(path, "BOARD.md");
    } else if (entry.name === "PROTOCOL-ADDENDUM.md") {
      const addendum = await textFile(path, "PROTOCOL-ADDENDUM.md");
      if (!addendum.startsWith("# Kanban protocol addendum\n")) throw new RepositoryFormatError("PROTOCOL-ADDENDUM.md has an invalid heading");
    } else if (entry.name === "artifacts") {
      await validateOwnedTree(path, "docs/cards/artifacts");
      for (const child of await readdir(path, { withFileTypes: true })) {
        if (!/^CARD-[0-9]{4}$/.test(child.name) && child.name !== "requirements") throw new RepositoryFormatError(`invalid artifact directory ${child.name}`);
        if (!child.isDirectory()) throw new RepositoryFormatError(`invalid artifact entry ${child.name}`);
        for (const file of await readdir(join(path, child.name), { withFileTypes: true })) {
          const relativePath = `docs/cards/artifacts/${child.name}/${file.name}`;
          if (!file.isFile() || !file.name.endsWith(".yaml")) throw new RepositoryFormatError(`invalid artifact file ${relativePath}`);
          findingIds.push(...validateArtifact(await textFile(join(path, child.name, file.name), relativePath), relativePath));
        }
      }
    } else if (CARD_FILE.test(entry.name)) {
      cards.push(parseCard(await textFile(path, entry.name), entry.name));
    } else {
      throw new RepositoryFormatError(`unknown board file docs/cards/${entry.name}`);
    }
  }
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) throw new RepositoryFormatError(`duplicate card ID ${card.id}`);
    ids.add(card.id);
    for (const dependency of card.dependencies) if (dependency === card.id || !cards.some((candidate) => candidate.id === dependency)) throw new RepositoryFormatError(`${card.id} has an invalid dependency ${dependency}`);
  }
  const canonicalDashboard = renderBoard(cards);
  const requirementsPath = join(docs, "spec.md");
  const requirementsText = await lstat(requirementsPath).then(() => textFile(requirementsPath, "docs/spec.md")).catch(() => undefined);
  const requirements = requirementsText === undefined ? undefined : parseRequirements(requirementsText);
  if (new Set(findingIds).size !== findingIds.length) throw new RepositoryFormatError("duplicate finding ID across artifacts");
  findingIds.sort();
  validateBoardSemantics({ board: boardValue as Board, config: configValue as Config, cards, requirements, findingIds });
  return Object.freeze({
    root,
    board: boardValue as Board,
    config: configValue as Config,
    cards: Object.freeze(cards),
    findingIds: Object.freeze(findingIds),
    requirements: requirementsText,
    dashboard,
    canonicalDashboard,
    dashboardDrift: dashboard !== canonicalDashboard,
  });
}

/** Atomically replace the exact repository-relative files owned by a state transaction. */
export async function writeAtomicExactFiles(rootInput: string, files: Readonly<Record<string, string>>): Promise<void> {
  const root = await realpath(resolve(rootInput));
  const paths = Object.keys(files).sort();
  if (paths.length === 0) throw new RepositoryFormatError("cannot atomically write an empty file set");
  const temporary: string[] = [];
  try {
    for (const path of paths) {
      if (path !== "docs/spec.md" && !path.startsWith("docs/cards/")) throw new RepositoryFormatError(`write path is not state-owned: ${path}`);
      if (!path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new RepositoryFormatError(`write path is not normalized: ${path}`);
      const target = resolve(root, path);
      const targetRelative = relative(root, target);
      if (!targetRelative || targetRelative.startsWith("..") || resolve(root, targetRelative) !== target) throw new RepositoryFormatError(`write path escapes repository root: ${path}`);
      let parent = dirname(target);
      while (parent !== root) {
        const parentInfo = await lstat(parent).catch(() => undefined);
        if (!parentInfo || parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new RepositoryFormatError(`write parent is unsafe: ${path}`);
        parent = dirname(parent);
      }
      const existing = await lstat(target).catch(() => undefined);
      if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1)) throw new RepositoryFormatError(`write target is unsafe: ${path}`);
      const temporaryPath = join(dirname(target), `.${basename(target)}.${randomBytes(8).toString("hex")}.tmp`);
      await writeFile(temporaryPath, files[path]!, { encoding: "utf8", mode: 0o600, flag: "wx" });
      temporary.push(temporaryPath);
      await rename(temporaryPath, target);
      temporary.pop();
    }
  } finally {
    await Promise.all(temporary.map((path) => rm(path, { force: true }).catch(() => undefined)));
  }
}

export { RepositoryFormatError };
