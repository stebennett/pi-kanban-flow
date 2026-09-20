import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../../extensions/kanban-flow/index.ts";

test("extension registration is thin and exposes deterministic workflow tools plus diagnostics", () => {
  const commands: string[] = [];
  const tools: string[] = [];
  const fakePi = {
    registerCommand(name: string) { commands.push(name); },
    registerTool(tool: { name: string }) { tools.push(tool.name); },
  };
  extension(fakePi as never);
  assert.deepEqual(commands, ["kanban-validate"]);
  assert.deepEqual(tools, ["kanban_initialize", "kanban_requirements", "kanban_pump", "kanban_blocker_resolution", "kanban_validate"]);
});
