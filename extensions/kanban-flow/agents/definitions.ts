import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

export const WORKFLOW_AGENT_CATALOG = {
  "requirements-producer": "producer",
  "requirements-checker": "checker",
  "design-producer": "producer",
  "design-checker": "checker",
  "split-decider": "splitDecision",
  implementer: "producer",
  reviewer: "reviewer",
  "ship-producer": "producer",
  "ship-checker": "checker",
} as const;

export type WorkflowAgentName = keyof typeof WORKFLOW_AGENT_CATALOG;
export type AgentSource = "package" | "project";

export interface AgentDefinition {
  name: WorkflowAgentName;
  description: string;
  body: string;
  source: AgentSource;
  path: string;
  sha256: string;
}

const MAX_AGENT_BYTES = 100_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function isWorkflowAgentName(value: string): value is WorkflowAgentName { return Object.hasOwn(WORKFLOW_AGENT_CATALOG, value); }
export function agentFilename(name: WorkflowAgentName): string { return `${name}.md`; }

export function parseAgentDefinition(bytes: Uint8Array, expectedName: WorkflowAgentName, source: AgentSource, logicalPath: string): AgentDefinition {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AGENT_BYTES) throw new Error(`Agent definition size is invalid: ${logicalPath}`);
  let text: string;
  try { text = decoder.decode(bytes); } catch { throw new Error(`Agent definition is not valid UTF-8: ${logicalPath}`); }
  const normalized = text.replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(normalized);
  if (!match) throw new Error(`Agent definition requires exact frontmatter and a body: ${logicalPath}`);
  const document = parseDocument(match[1], { uniqueKeys: true, strict: true });
  if (document.errors.length > 0) throw new Error(`Invalid agent frontmatter: ${logicalPath}: ${document.errors[0].message}`);
  const frontmatter = document.toJS() as unknown;
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) throw new Error(`Agent frontmatter must be an object: ${logicalPath}`);
  const record = frontmatter as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "description,name") throw new Error(`Agent frontmatter must contain only description and name: ${logicalPath}`);
  if (record.name !== expectedName) throw new Error(`Agent name does not match filename: ${logicalPath}`);
  if (typeof record.description !== "string" || record.description.trim() !== record.description || record.description.length < 1 || record.description.length > 1_024 || /[\u0000\r\n]/u.test(record.description)) throw new Error(`Agent description is invalid: ${logicalPath}`);
  const body = match[2];
  if (body.trim().length === 0 || Buffer.byteLength(body, "utf8") > MAX_AGENT_BYTES || body.includes("\u0000")) throw new Error(`Agent body is invalid: ${logicalPath}`);
  return { name: expectedName, description: record.description, body, source, path: logicalPath, sha256: createHash("sha256").update(normalized).digest("hex") };
}

export async function readAgentDefinition(file: string, expectedName: WorkflowAgentName, source: AgentSource, logicalPath: string): Promise<AgentDefinition> {
  return parseAgentDefinition(await readFile(file), expectedName, source, logicalPath);
}
