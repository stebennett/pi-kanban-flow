import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateFindingIds,
  appendArtifactPaths,
  lifecycleArtifactPath,
  renderLifecycleArtifact,
  validateLifecycleArtifact,
  validateRenderedLifecycleArtifact,
} from "../../extensions/kanban-flow/lifecycle/artifacts.ts";
import { DESIGN_CRITERION_KEYS, SHIP_CRITERION_KEYS } from "../../extensions/kanban-flow/lifecycle/criteria.ts";
import { artifactPath, renderArtifact } from "../../extensions/kanban-flow/agents/artifacts.ts";

const commit = "a".repeat(40);
const at = "2026-01-15T10:30:00Z";
let sequence = 0;
const run = () => `KFRUN-20260115T103000000Z-${["abcdefgh", "bcdefghj", "cdefghjk", "defghjkm", "efghjkmn", "fghjkmnp", "ghjkmnpq", "hjkmnpqr", "jkmnpqrs", "kmnpqrst", "mnpqrstv"][sequence++] ?? `n${String(sequence).padStart(7, "0")}`}`;

function childAttestation(tool: string, payload: any): any {
  const id = payload.dispatch_id;
  return {
    run_id: id,
    dispatch_id: id,
    tool,
    agent: { name: "stage4-agent", source: "package", path: "agents/stage4-agent.md", sha256: "b".repeat(64) },
    model: { provider: "provider", id: "model", thinking: "high" },
    policy: { name: "strict", tools: ["kanban_read", "submit_result"], snapshot_commit: commit },
    execution_context: { kind: "immutable_snapshot", repository_id: "owner/repo", branch: "kanban/card/CARD-0001-example", commit },
    argv: ["pi", "--mode", "json"],
    started_at: at,
    completed_at: at,
    exit_code: 0,
    stop_reason: "toolUse",
    finding_ids: [],
    payload,
  };
}

function producer(phase: "design" | "implementation" | "ship"): any {
  const id = run();
  return childAttestation("submit_producer_result", {
    schema_version: 1,
    dispatch_id: id,
    card_id: "CARD-0001",
    phase,
    status: "completed",
    summary: "bounded result",
    artifacts: [{ type: phase === "design" ? "design_document" : phase === "implementation" ? "implementation_summary" : "product_pr_body", content: "content" }],
    findings: [],
    questions: [],
    evidence: [],
    requirement_changes: [],
    card_changes: [],
    planned_paths: phase === "design" ? [{ path: "src/index.ts", action: "modify" }] : [],
  });
}

function checker(phase: "design" | "ship"): any {
  const id = run();
  const keys = phase === "design" ? DESIGN_CRITERION_KEYS : SHIP_CRITERION_KEYS;
  return childAttestation("submit_checker_result", {
    schema_version: 1,
    dispatch_id: id,
    card_id: "CARD-0001",
    phase,
    status: "pass",
    summary: "all criteria pass",
    criteria: keys.map((key) => ({ key, verdict: "pass", evidence: [{ kind: "file", reference: "design.md:1", summary: "checked" }] })),
    findings: [],
    evidence: [],
  });
}

function reviewer(): any {
  const id = run();
  return childAttestation("submit_reviewer_result", {
    schema_version: 1,
    dispatch_id: id,
    card_id: "CARD-0001",
    phase: "implementation_review",
    lens: "security",
    status: "pass",
    summary: "pass",
    findings: [],
    evidence: [],
    rerun_recommended: false,
  });
}

function splitDecision(): any {
  const id = run();
  return childAttestation("submit_split_decision", {
    schema_version: 1,
    dispatch_id: id,
    card_id: "CARD-0001",
    status: "no_split",
    rationale: "The card is independently deliverable.",
    replacement_cards: [],
    evidence: [],
  });
}

function parentProbe(probe: "project_commands" | "ci_status" | "pr_state" | "diff_policy"): any {
  const id = run();
  return {
    run_id: id,
    dispatch_id: id,
    tool: "parent_probe",
    agent: null,
    model: null,
    policy: { name: "parent", tools: [], snapshot_commit: commit },
    execution_context: { kind: "parent", repository_id: "owner/repo", branch: "kanban/card/CARD-0001-example", commit },
    argv: ["npm", "test"],
    started_at: at,
    completed_at: at,
    exit_code: 0,
    stop_reason: "parent",
    finding_ids: [],
    payload: {
      schema_version: 1,
      dispatch_id: id,
      card_id: "CARD-0001",
      probe,
      status: "success",
      summary: "parent observed pass",
      observations: [{ key: "test", status: "pass", detail: "exit code 0" }],
      evidence: [],
    },
  };
}

test("every Stage 4 role and parent probe has one engine-derived canonical path", () => {
  const artifacts = [producer("design"), checker("design"), splitDecision(), producer("implementation"), reviewer(), producer("ship"), checker("ship"), parentProbe("project_commands"), parentProbe("ci_status"), parentProbe("pr_state"), parentProbe("diff_policy")];
  const paths = artifacts.map((artifact) => {
    const result = renderLifecycleArtifact(artifact);
    assert.equal(result.path.startsWith("docs/cards/artifacts/CARD-0001/"), true);
    assert.equal(result.bytes.endsWith("\n"), true);
    assert.equal(result.bytes.includes("KFRUN-"), true);
    assert.equal(validateLifecycleArtifact(artifact), result.path);
    assert.equal(artifactPath(artifact), result.path);
    assert.deepEqual(renderArtifact(artifact), result);
    assert.deepEqual(validateRenderedLifecycleArtifact(result.bytes, result.path), artifact);
    return result.path;
  });
  assert.deepEqual(paths.map((path) => path.replace(/^.*\//, "").replace(/-KFRUN-.*\.yaml$/, "")), [
    "design-producer", "design-check", "split-decision", "implementation-producer", "review-security", "ship-producer", "ship-check", "probe-project-commands", "probe-ci-status", "probe-pr-state", "probe-diff-policy",
  ]);
});

test("child lifecycle artifacts require a successful tool-use termination", () => {
  const invalid = producer("design");
  invalid.exit_code = 1;
  assert.throws(() => validateLifecycleArtifact(invalid), /exit_code 0/);
  const stopped = producer("design");
  stopped.stop_reason = "aborted";
  assert.throws(() => validateLifecycleArtifact(stopped), /stop_reason toolUse/);
});

test("criteria order and redacted/immutable attestation failures are rejected", () => {
  const invalid = checker("design");
  invalid.payload.criteria.reverse();
  assert.throws(() => validateLifecycleArtifact(invalid), /criteria/);
  const probe = parentProbe("project_commands");
  probe.argv = ["/tmp/private-secret-command"];
  assert.throws(() => validateLifecycleArtifact(probe), /absolute machine path/);
  const design = producer("design");
  const rendered = renderLifecycleArtifact(design);
  assert.throws(() => validateRenderedLifecycleArtifact(`${rendered.bytes}\n`, rendered.path), /canonically/);
});

test("finding IDs allocate in payload order and previous attempts remain append-only", () => {
  const first = { findings: [{}, {}] };
  const second = { payload: { findings: [{}] } };
  const allocation = allocateFindingIds({ nextFinding: 3, priorFindingIds: ["FINDING-0001", "FINDING-0002"], attempts: [first, second] });
  assert.deepEqual(allocation.byAttempt, [["FINDING-0003", "FINDING-0004"], ["FINDING-0005"]]);
  assert.equal(allocation.nextFinding, 6);
  assert.deepEqual(appendArtifactPaths(["docs/cards/artifacts/CARD-0001/design-producer-KFRUN-20260115T103000001Z-abcdefgh.yaml"], ["docs/cards/artifacts/CARD-0001/design-producer-KFRUN-20260115T103000001Z-abcdefgh.yaml"]), ["docs/cards/artifacts/CARD-0001/design-producer-KFRUN-20260115T103000001Z-abcdefgh.yaml"]);
  assert.throws(() => allocateFindingIds({ nextFinding: 2, priorFindingIds: ["FINDING-0002"], attempts: [] }));
  assert.throws(() => appendArtifactPaths([], ["../escape"]));
});
