import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Value } from "typebox/value";
import { kanbanPumpParameters } from "../../extensions/kanban-flow/tools/kanban-pump.ts";
import { blockerResolutionParameters } from "../../extensions/kanban-flow/tools/blocker-resolution.ts";
import { runKanbanPump } from "../../extensions/kanban-flow/tools/kanban-pump.ts";

test("Pi surface inputs are strict and reject unknown or oversized authority", () => {
  assert.equal(Value.Check(kanbanPumpParameters, { schema_version: 1, requested_phase: "none" }), true);
  assert.equal(Value.Check(kanbanPumpParameters, { schema_version: 1, requested_phase: "none", card_id: "CARD-0001" }), false);
  assert.equal(Value.Check(blockerResolutionParameters, { schema_version: 1, card_id: "CARD-0001", resume_status: "ready_for_implementation", decision: "proceed_unsplit", reason: "Reviewed scope" }), true);
  assert.equal(Value.Check(blockerResolutionParameters, { schema_version: 1, card_id: "CARD-0001", resume_status: "ready_for_implementation", decision: "proceed_unsplit", reason: "x", extra: true }), false);
});

test("registered pump assembles the real coordinator and fails closed without parent context", async () => {
  const git = { repositoryRoot: async () => process.cwd() } as any;
  const report = await runKanbanPump(process.cwd(), "0.0.0", { schema_version: 1, requested_phase: "none" }, undefined, { git, repositoryId: "owner/repo" });
  assert.equal(report.status, "failed");
  assert.notEqual(report.issues[0]?.code, "workflow_requires_parent_model");
  assert.equal(report.issues[0]?.code, "parent_model_unavailable");
});

test("all lifecycle skills use frontmatter and delegate one pump request", async () => {
  for (const name of ["kanban", "design", "implement", "review", "ship"]) {
    const content = await readFile(`skills/${name}/SKILL.md`, "utf8");
    assert.match(content, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    assert.equal((content.match(/kanban_pump/g) ?? []).length, 1);
    assert.doesNotMatch(content, /git add|git commit|git push|gh pr|state transaction|write board/i);
  }
});
