import { isNumericId } from "../engine/ids.ts";

export type RequirementStatus = "active" | "superseded" | "retired";
export interface Requirement {
  readonly id: string;
  readonly title: string;
  readonly status: RequirementStatus;
  readonly supersedes: readonly string[];
  readonly text: string;
  readonly acceptance: string;
}

const HEADING = /^## (REQ-\d{4}) — (.+)$/;
const STATUS = /^Status: (active|superseded|retired)$/;
const SUPERSEDES = /^Supersedes: (none|REQ-\d{4}(?:, REQ-\d{4})*)$/;

function fail(message: string): never { throw new Error(`Invalid requirements specification: ${message}`); }
function line(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000\r\n]/.test(trimmed)) fail(`${label} is invalid`);
  return trimmed;
}

/** Parse the exact machine-readable requirement sections from docs/spec.md. */
export function parseRequirements(markdown: string): readonly Requirement[] {
  if (markdown.includes("\r")) fail("must use LF line endings");
  const lines = markdown.split("\n");
  const first = lines.find((value) => value.trim() !== "");
  if (first !== "# Product specification") fail("first non-empty line must be # Product specification");
  if (lines.some((value, index) => index > 0 && /^# /.test(value))) fail("only one level-one heading is allowed");
  const starts = lines.map((value, index) => ({ value, index })).filter(({ value }) => HEADING.test(value));
  if (starts.length === 0) fail("at least one requirement is required");
  const requirements: Requirement[] = [];
  for (let position = 0; position < starts.length; position += 1) {
    const { value: heading, index } = starts[position];
    const end = position + 1 < starts.length ? starts[position + 1].index : lines.length;
    const match = HEADING.exec(heading);
    if (!match) fail(`malformed requirement heading at line ${index + 1}`);
    const [, id, title] = match;
    if (!isNumericId(id, "REQ")) fail(`invalid requirement ID ${id}`);
    if (requirements.some((item) => item.id === id)) fail(`duplicate requirement ID ${id}`);
    const body = lines.slice(index + 1, end);
    const nonEmpty = body.map((lineValue, offset) => ({ value: lineValue, index: offset })).filter(({ value }) => value.trim() !== "");
    if (nonEmpty.length < 4) fail(`${id} is incomplete`);
    const statusMatch = STATUS.exec(nonEmpty[0].value);
    const supersedesMatch = SUPERSEDES.exec(nonEmpty[1].value);
    if (!statusMatch || !supersedesMatch) fail(`${id} must begin with Status and Supersedes metadata`);
    const acceptanceIndex = body.findIndex((lineValue) => lineValue === "### Acceptance");
    if (acceptanceIndex < 0 || body.findIndex((lineValue, offset) => lineValue === "### Acceptance" && offset !== acceptanceIndex) >= 0) fail(`${id} needs exactly one ### Acceptance section`);
    const prose = body.slice(nonEmpty[1].index + 1, acceptanceIndex).filter((lineValue) => lineValue.trim() !== "").join("\n").trim();
    if (!prose) fail(`${id} needs non-empty requirement prose`);
    const acceptanceLines = body.slice(acceptanceIndex + 1).filter((lineValue) => lineValue.trim() !== "");
    if (!acceptanceLines.some((lineValue) => /^- \S/.test(lineValue))) fail(`${id} needs a non-empty acceptance bullet`);
    const supersedes = supersedesMatch[1] === "none" ? [] : supersedesMatch[1].split(", ");
    if (supersedes.some((target) => target === id) || supersedes.some((target, i) => !isNumericId(target, "REQ") || (i > 0 && target <= supersedes[i - 1]))) fail(`${id} has invalid Supersedes order`);
    requirements.push({ id, title: line(title, 200, `${id} title`), status: statusMatch[1] as RequirementStatus, supersedes, text: prose, acceptance: acceptanceLines.join("\n") });
  }
  const ordered = [...requirements].sort((left, right) => left.id.localeCompare(right.id));
  if (ordered.some((item, index) => item.id !== requirements[index]?.id)) fail("requirements must be ordered by numeric ID");
  return requirements;
}

export function validateRequirementLineage(requirements: readonly Requirement[]): void {
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  for (const requirement of requirements) {
    for (const targetId of requirement.supersedes) {
      const target = byId.get(targetId);
      if (!target) fail(`${requirement.id} supersedes missing ${targetId}`);
      if (target.status === "retired") fail(`${requirement.id} supersedes retired ${targetId}`);
    }
    if (requirement.status === "superseded") {
      const replacement = requirements.some((candidate) => candidate.status === "active" && candidate.supersedes.includes(requirement.id));
      if (!replacement) fail(`${requirement.id} has no active replacement`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(`requirement supersession cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of byId.get(id)?.supersedes ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const requirement of requirements) visit(requirement.id);
}
