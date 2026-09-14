import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { readBoardRepository, type CardRecord } from "../../extensions/kanban-flow/board/repository.ts";
import { renderBoard } from "../../extensions/kanban-flow/engine/render.ts";

const board = {
  harness: "pi", board_schema_version: 1, last_writer_package_version: "0.0.0-dev", project: { repository_id: "owner/repo" },
  ids: { next_requirement: 2, next_card: 2, next_acceptance_criterion: 2, next_finding: 1 },
  state: { last_reconciled_at: "2026-01-15T10:30:00Z", last_state_transaction: null }, migration: null,
};
const config = {
  repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" },
  lock: { ttl_seconds: 1800, heartbeat_seconds: 30 }, scheduler: { wip_limit: 1, priority_order: "ascending" },
  rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance", "tests"], max_parallel: 2 },
  project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} },
  agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] },
};

function card(id = "CARD-0001", status = "backlog", priority = 100, blocked: { reason: string } | null = null): CardRecord {
  return {
    id, title: "Example card", status, requirements: ["REQ-0001"], grandfathered_requirements: [],
    acceptance_criteria: [{ id: "AC-0001", text: "An observable result", requirement: "REQ-0001" }], dependencies: [], replaces: [], replaced_by: [],
    replacement_reason: null, priority, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", started_at: null, delivered_at: null,
    blocked, workflow: {
      design: { branch: null, pr: null, producer_result_paths: [], checker_result_paths: [], approved_commit: null },
      split_decision: { result_path: null, decided_at: null, override: null },
      implementation: { branch: null, result_paths: [], head_commit: null }, review: { result_paths: [], reviewed_commit: null, completed_at: null },
      ship: { product_pr: null, verification_result_paths: [], merged_commit: null },
    }, rework: { design: 0, implementation: 0 }, history: [],
  } as CardRecord;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-kanban-flow-repository-"));
  await mkdir(join(root, "docs", "cards"), { recursive: true });
  await writeFile(join(root, "docs", "cards", "board.yaml"), stringify(board));
  await writeFile(join(root, "docs", "cards", "config.yaml"), stringify(config));
  await writeFile(join(root, "docs", "cards", "CARD-0001.md"), `---\n${stringify(card())}---\n# CARD-0001: Example card\n\n## Why\n\nBecause.\n\n## Notes\n\nNotes.\n`);
  return root;
}

test("reads a complete card layout and reports canonical dashboard drift", async () => {
  const root = await fixture();
  const snapshot = await readBoardRepository(root);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.dashboard, undefined);
  assert.equal(snapshot.dashboardDrift, true);
  assert.match(snapshot.canonicalDashboard, /^# Kanban board\n/);
  await writeFile(join(root, "docs", "cards", "BOARD.md"), snapshot.canonicalDashboard);
  const reread = await readBoardRepository(root);
  assert.equal(reread.dashboardDrift, false);
  assert.equal(await readFile(join(root, "docs", "cards", "BOARD.md"), "utf8"), reread.canonicalDashboard);
});

test("rejects duplicate YAML keys, unknown files, CRLF, and symlinks", async () => {
  const duplicate = await fixture();
  await writeFile(join(duplicate, "docs", "cards", "board.yaml"), "harness: pi\nharness: pi\n");
  await assert.rejects(readBoardRepository(duplicate), /duplicate key|invalid YAML/i);
  const unknown = await fixture();
  await writeFile(join(unknown, "docs", "cards", "unexpected.txt"), "nope");
  await assert.rejects(readBoardRepository(unknown), /unknown board file/);
  const crlf = await fixture();
  await writeFile(join(crlf, "docs", "cards", "config.yaml"), (await readFile(join(crlf, "docs", "cards", "config.yaml"), "utf8")).replaceAll("\n", "\r\n"));
  await assert.rejects(readBoardRepository(crlf), /LF line endings/);
  const linked = await fixture();
  await symlink(join(linked, "docs", "cards", "board.yaml"), join(linked, "docs", "cards", "linked.yaml"));
  await assert.rejects(readBoardRepository(linked), /symlink/);
});

test("renders deterministic ordering and suffix precedence", () => {
  const blocked = card("CARD-0002", "implementing", 1, { reason: "needs input" });
  const ready = card("CARD-0001", "ready_to_ship", 2);
  ready.workflow.design.pr = { url: "https://github.com/owner/repo/pull/1" };
  ready.workflow.ship.product_pr = { url: "https://github.com/owner/repo/pull/2" };
  const output = renderBoard([ready, blocked]);
  assert.ok(output.indexOf("## Blocked") < output.indexOf("CARD-0002"));
  assert.ok(output.indexOf("CARD-0002") < output.indexOf("## Backlog"));
  assert.match(output, /CARD-0002.*status: implementing · blocked: needs input/);
  assert.match(output, /CARD-0001.*design PR: https:\/\/github\.com\/owner\/repo\/pull\/1/);
  assert.doesNotMatch(output, /CARD-0001.*product PR/);
  assert.equal(output.endsWith("\n"), true);
});
