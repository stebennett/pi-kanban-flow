import { parseDocument } from "yaml";
import { Value } from "typebox/value";
import { CardSchema, type Card } from "./schemas.ts";

export interface ParsedCardDocument {
  readonly card: Card;
  readonly body: string;
}

function fail(message: string): never { throw new Error(`Invalid card document: ${message}`); }

/** Parse a card's frontmatter and fixed human-readable body without writing it. */
export function parseCardDocument(markdown: string, expectedId?: string): ParsedCardDocument {
  if (markdown.includes("\r")) fail("line endings must be LF");
  if (!markdown.startsWith("---\n")) fail("frontmatter must start with ---");
  const close = markdown.indexOf("\n---\n", 4);
  if (close < 0) fail("frontmatter is not terminated");
  const document = parseDocument(markdown.slice(4, close + 1), { uniqueKeys: true, schema: "core" });
  if (document.errors.length > 0) fail(`frontmatter YAML is invalid: ${document.errors[0].message}`);
  const value = document.toJS({ mapAsMap: false }) as unknown;
  if (!Value.Check(CardSchema, value)) fail("frontmatter does not match its strict schema");
  const card = value as Card;
  if (expectedId && card.id !== expectedId) fail(`ID ${card.id} does not match ${expectedId}`);
  const body = markdown.slice(close + 5);
  const lines = body.split("\n");
  if (lines[0] !== `# ${card.id}: ${card.title}`) fail("body title does not match frontmatter");
  if (lines.slice(1).some((line) => /^# /.test(line))) fail("body has another level-one heading");
  const why = lines.reduce((count, line) => count + (line === "## Why" ? 1 : 0), 0);
  const notes = lines.reduce((count, line) => count + (line === "## Notes" ? 1 : 0), 0);
  if (why !== 1 || notes !== 1) fail("body requires exactly one ## Why and ## Notes section");
  if (lines.indexOf("## Why") > lines.indexOf("## Notes")) fail("## Why must precede ## Notes");
  return { card, body };
}
