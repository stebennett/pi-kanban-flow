import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRequirements, validateRequirementLineage } from "../../extensions/kanban-flow/board/requirements.ts";
import { validateConfigSemantics } from "../../extensions/kanban-flow/board/config.ts";
import type { Config } from "../../extensions/kanban-flow/board/schemas.ts";

const spec = `# Product specification

## REQ-0001 — Create a board

Status: active
Supersedes: none

A board can be created.

### Acceptance

- Board files are created.
`;

test("parses and validates exact requirement sections", () => {
  const requirements = parseRequirements(spec);
  assert.deepEqual(requirements[0], {
    id: "REQ-0001", title: "Create a board", status: "active", supersedes: [],
    text: "A board can be created.", acceptance: "- Board files are created.",
  });
  validateRequirementLineage(requirements);
  assert.throws(() => parseRequirements(spec.replace("## REQ-0001", "## REQ-0000")), /invalid requirement ID/);
  assert.throws(() => parseRequirements(spec.replace("### Acceptance", "### Other")), /Acceptance/);
});

test("rejects invalid supersession lineage", () => {
  const changed = `${spec}
## REQ-0002 — Replacement

Status: active
Supersedes: REQ-0001

New behavior.

### Acceptance

- Replacement works.
`;
  const requirements = parseRequirements(changed);
  validateRequirementLineage(requirements);
  const missing = parseRequirements(spec.replace("Supersedes: none", "Supersedes: REQ-0002"));
  assert.throws(() => validateRequirementLineage(missing), /missing REQ-0002/);
  const valid = parseRequirements(spec.replace("Status: active", "Status: superseded") + `\n## REQ-0002 — Replacement\n\nStatus: active\nSupersedes: REQ-0001\n\nNew behavior.\n\n### Acceptance\n\n- Replacement works.\n`);
  validateRequirementLineage(valid);
});

test("enforces config cross-field constraints", () => {
  const config = {
    repository: { forge: "github", gh_command: "gh", remote: "origin", base_branch: "main" }, state_prs: { merge_policy: "human" },
    lock: { ttl_seconds: 60, heartbeat_seconds: 5 }, scheduler: { wip_limit: 1, priority_order: "ascending" },
    rework: { design_limit: 2, implementation_limit: 2 }, review: { lenses: ["acceptance"], max_parallel: 1 },
    project_commands: { test: ["npm", "test"] }, agent_models: { default: "inherit", overrides: {} },
    agents: { allow_project_overrides: true, report_overrides: true }, resources: { broad_policy_allowed_skills: [] },
  } as unknown as Config;
  validateConfigSemantics(config);
  assert.throws(() => validateConfigSemantics({ ...config, lock: { ttl_seconds: 60, heartbeat_seconds: 20 } }), /heartbeat/);
  assert.throws(() => validateConfigSemantics({ ...config, resources: { broad_policy_allowed_skills: ["z", "a"] } }), /sorted/);
});
