import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnose, diagnosticText, type DiagnosticDependencies } from "../../extensions/kanban-flow/tools/validate.ts";

const snapshot = {
  root: "/private/absolute/path",
  board: { project: { repository_id: "owner/repo" } },
  cards: [{ id: "CARD-0002" }, { id: "CARD-0001" }],
  dashboardDrift: true,
};

function dependencies(overrides: Partial<DiagnosticDependencies> = {}): DiagnosticDependencies {
  return {
    piVersion: "0.85.1",
    nodeVersion: "24.18.1",
    locateRoot: async () => "/private/absolute/path",
    readRepository: async () => snapshot as never,
    runner: {
      async run(executable, args) {
        if (executable === "git" && args[0] === "--version") return { executable, args, code: 0, stdout: "git version 2.54.0\n", stderr: "" };
        if (executable === "gh" && args[0] === "--version") return { executable, args, code: 0, stdout: "gh version 2.97.0\n", stderr: "" };
        return { executable, args, code: 0, stdout: "", stderr: "" };
      },
    },
    ...overrides,
  };
}

test("diagnostics are deterministic, read-only, and report drift with relative paths", async () => {
  const report = await diagnose(".", {}, dependencies());
  assert.equal(report.ok, true);
  assert.deepEqual(report.repository.card_ids, ["CARD-0001", "CARD-0002"]);
  assert.equal(report.repository.markers_queried, false);
  assert.deepEqual(report.issues, [{ code: "DASHBOARD_DRIFT", severity: "warning", message: "docs/cards/BOARD.md differs from canonical in-memory rendering", path: "docs/cards/BOARD.md" }]);
  assert.equal(diagnosticText(report).includes("/private/absolute/path"), false);
});

test("marker queries are opt-in and use the injected authority", async () => {
  let calls = 0;
  const report = await diagnose(".", { query_markers: true }, dependencies({
    github: {
      async listPullRequests() { calls++; return []; },
      async createPullRequest() { throw new Error("not used"); },
      async addComment() { throw new Error("not used"); },
      async closePullRequest() { throw new Error("not used"); },
      async reopenPullRequest() { throw new Error("not used"); },
      async getComments() { throw new Error("not used"); },
    },
  }));
  assert.equal(calls, 1);
  assert.equal(report.repository.markers_queried, true);
});

test("missing repositories and incompatible runtimes fail clearly", async () => {
  const report = await diagnose(".", {}, dependencies({
    piVersion: "0.86.0",
    nodeVersion: "20.0.0",
    locateRoot: async () => undefined,
  }));
  assert.equal(report.ok, false);
  assert.equal(report.repository.found, false);
  assert.deepEqual(report.issues.map(({ code }) => code), ["NODE_VERSION_UNSUPPORTED", "PI_VERSION_UNSUPPORTED", "REPOSITORY_NOT_FOUND"]);
});
