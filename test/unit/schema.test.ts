import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { BoardSchema, ConfigSchema, EvidenceSchema, MigrationSchema, TransactionDescriptorSchema, parseModelSelector, type Config } from "../../extensions/kanban-flow/board/schemas.ts";
import { validateConfigSemantics } from "../../extensions/kanban-flow/board/config.ts";

const validBoard = {
  harness: "pi",
  board_schema_version: 1,
  last_writer_package_version: "0.0.0-dev",
  project: { repository_id: "owner/repo" },
  ids: { next_requirement: 1, next_card: 1, next_acceptance_criterion: 1, next_finding: 1 },
  state: { last_reconciled_at: "2026-01-15T10:30:00Z", last_state_transaction: null },
  migration: null,
};

const validConfig: Config = {
  repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" },
  state_prs: { merge_policy: "human" },
  lock: { ttl_seconds: 1800, heartbeat_seconds: 30 },
  scheduler: { wip_limit: 1, priority_order: "ascending" },
  rework: { design_limit: 2, implementation_limit: 2 },
  review: { lenses: ["acceptance", "tests"], max_parallel: 2 },
  project_commands: { test: ["npm", "test"] },
  agent_models: { default: "inherit", overrides: { "design-checker": "provider/model:high" } },
  agents: { allow_project_overrides: true, report_overrides: true },
  resources: { broad_policy_allowed_skills: [] },
};

test("accepts valid board and config examples", () => {
  assert.equal(Value.Check(BoardSchema, validBoard), true);
  assert.equal(Value.Check(ConfigSchema, validConfig), true);
  assert.equal(Value.Check(BoardSchema, { ...validBoard, project: { repository_id: "owner./repo" } }), false);
  const malformedSelector = { ...validConfig, agent_models: { default: "inherit", overrides: { "design-checker": "not-a-selector" } } };
  assert.equal(Value.Check(ConfigSchema, malformedSelector), true);
  assert.throws(() => validateConfigSemantics(malformedSelector as Config));
});

test("migration records and model selectors follow the versioned contracts", () => {
  const migration = { source_harness: "claude", source_version: "0.10.0", source_commit: "a".repeat(40), migrated_at: "2026-01-15T10:30:00Z" };
  assert.equal(Value.Check(MigrationSchema, migration), true);
  assert.equal(Value.Check(MigrationSchema, { ...migration, operation_id: "KFOP-20260115T103000000Z-abcdefgh" }), false);
  assert.equal(Value.Check(MigrationSchema, { ...migration, source_commit: "invalid" }), false);
  assert.deepEqual(parseModelSelector("provider/model:high"), { provider: "provider", model: "model", thinking: "high" });
  assert.deepEqual(parseModelSelector("provider/model:custom"), { provider: "provider", model: "model:custom", thinking: null });
  assert.deepEqual(parseModelSelector("provider/model/path:max"), { provider: "provider", model: "model/path", thinking: "max" });
  assert.throws(() => parseModelSelector("provider/"));
  assert.throws(() => parseModelSelector("provider/has space"));
  const config = structuredClone(validConfig);
  config.agent_models.overrides["design-checker"] = "provider/model/path:max";
  validateConfigSemantics(config);
});

test("rejects unknown fields at every tested object boundary", () => {
  assert.equal(Value.Check(BoardSchema, { ...validBoard, unknown: true }), false);
  assert.equal(Value.Check(BoardSchema, { ...validBoard, project: { ...validBoard.project, unknown: true } }), false);
  assert.equal(Value.Check(ConfigSchema, { ...validConfig, unknown: true }), false);
  assert.equal(Value.Check(ConfigSchema, { ...validConfig, repository: { ...validConfig.repository, unknown: true } }), false);
  assert.equal(Value.Check(EvidenceSchema, { kind: "file", reference: "x", summary: "y", unknown: true }), false);
});

test("validates strict transaction descriptors and nested records", () => {
  const descriptor = {
    id: "KFTX-20260115T103000000Z-abcdefgh",
    operation_id: "KFOP-20260115T103000000Z-abcdefgh",
    planned_at: "2026-01-15T10:30:00Z",
    base_commit: "a".repeat(40),
    card_ids: [],
    paths: ["docs/cards/board.yaml"],
  };
  assert.equal(Value.Check(TransactionDescriptorSchema, descriptor), true);
  assert.equal(Value.Check(TransactionDescriptorSchema, { ...descriptor, paths: ["/tmp/escape"] }), false);
  assert.equal(Value.Check(TransactionDescriptorSchema, { ...descriptor, extra: 1 }), false);
});
