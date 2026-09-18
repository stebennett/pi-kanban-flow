import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Value } from "typebox/value";
import { initializeParameters } from "../../extensions/kanban-flow/tools/initialize.ts";
import { requirementsParameters } from "../../extensions/kanban-flow/tools/requirements.ts";

test("initialization and requirements tools expose exact strict public inputs", () => {
  assert.equal(Value.Check(initializeParameters, { schema_version: 1 }), true); assert.equal(Value.Check(initializeParameters, { schema_version: 1, repository_id: "owner/repo" }), false);
  assert.equal(Value.Check(requirementsParameters, { schema_version: 1, brief: "Observable behavior" }), true); assert.equal(Value.Check(requirementsParameters, { schema_version: 1, brief: "x", approve: true }), false); assert.equal(Value.Check(requirementsParameters, { schema_version: 1, brief: "" }), false);
});

test("packaged skills delegate once and contain no mutation or approval authority", async () => {
  const initialize = await readFile("skills/kanban-init/SKILL.md", "utf8"); const requirements = await readFile("skills/requirements/SKILL.md", "utf8");
  assert.match(initialize, /^---\nname: kanban-init\ndescription: .+\n---\n/); assert.match(requirements, /^---\nname: requirements\ndescription: .+\n---\n/);
  assert.equal((initialize.match(/`kanban_initialize`/g) ?? []).length, 1); assert.equal((requirements.match(/`kanban_requirements`/g) ?? []).length, 1);
  for (const skill of [initialize, requirements]) { assert.doesNotMatch(skill, /git add|git commit|git push|gh pr|docs\/cards\/CARD-[0-9]|--approve/i); assert.match(skill, /not authoritative until/i); }
  assert.doesNotMatch(initialize, /initial requirement input|brief.*kanban_initialize/i); assert.match(requirements, /one question at a time/i);
});
