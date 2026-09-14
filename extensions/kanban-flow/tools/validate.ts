import { Type, type Static } from "typebox";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { readBoardRepository, type BoardSnapshot } from "../board/repository.ts";
import { DirectProcessRunner, type ProcessRunner } from "../state-pr/process.ts";
import { discoverManagedPullRequests, type GitHubAdapter, type ManagedPullRequest } from "../state-pr/github.ts";
import { GhCliAdapter } from "../state-pr/github.ts";

export const validateParameters = Type.Object(
  { query_markers: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type ValidateParameters = Static<typeof validateParameters>;

export interface DiagnosticIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
}

export interface DiagnosticReport {
  readonly version: 1;
  readonly ok: boolean;
  readonly runtime: {
    pi: { version: string; compatible: boolean };
    node: { version: string; compatible: boolean };
  };
  readonly executables: {
    git: { available: boolean; version: string | null };
    gh: { available: boolean; version: string | null };
  };
  readonly repository: {
    found: boolean;
    board_valid: boolean;
    card_ids: readonly string[];
    dashboard_drift: boolean;
    markers_queried: boolean;
    managed_prs: readonly ManagedPullRequestSummary[];
  };
  readonly issues: readonly DiagnosticIssue[];
}

export interface ManagedPullRequestSummary {
  readonly number: number;
  readonly kind: string;
  readonly operation_id: string;
  readonly card_ids: readonly string[];
  readonly state: string;
}

export interface DiagnosticDependencies {
  readonly runner?: ProcessRunner;
  readonly readRepository?: (root: string) => Promise<BoardSnapshot>;
  readonly github?: GitHubAdapter;
  readonly locateRoot?: (cwd: string, runner: ProcessRunner) => Promise<string | undefined>;
  readonly nodeVersion?: string;
  readonly piVersion?: string;
}

const NODE_MINIMUM = [22, 19, 0] as const;

function versionParts(value: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function atLeast(value: string, minimum: readonly [number, number, number]): boolean {
  const parsed = versionParts(value);
  return parsed !== undefined && parsed.some((part, index) => part !== minimum[index])
    ? parsed[0] > minimum[0] || (parsed[0] === minimum[0] && (parsed[1] > minimum[1] || (parsed[1] === minimum[1] && parsed[2] >= minimum[2])))
    : parsed !== undefined;
}

function issue(code: string, message: string, path?: string, severity: "error" | "warning" = "error"): DiagnosticIssue {
  return path === undefined ? { code, severity, message } : { code, severity, message, path };
}

async function defaultLocateRoot(cwd: string, runner: ProcessRunner): Promise<string | undefined> {
  const result = await runner.run("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.code !== 0) return undefined;
  const root = result.stdout.trim();
  return root && !root.includes("\n") ? root : undefined;
}

async function executableVersion(runner: ProcessRunner, executable: string, cwd: string): Promise<{ available: boolean; version: string | null }> {
  const result = await runner.run(executable, ["--version"], { cwd });
  if (result.code !== 0) return { available: false, version: null };
  const firstLine = result.stdout.trim().split("\n", 1)[0]?.trim() ?? "";
  return { available: firstLine.length > 0, version: firstLine.length > 0 ? firstLine.slice(0, 128) : null };
}

function sortIssues(issues: readonly DiagnosticIssue[]): DiagnosticIssue[] {
  return [...issues].sort((left, right) => {
    const leftKey = `${left.code}:${left.path ?? ""}`;
    const rightKey = `${right.code}:${right.path ?? ""}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function summarizePullRequests(prs: readonly ManagedPullRequest[]): ManagedPullRequestSummary[] {
  return prs
    .map(({ marker, pullRequest }) => ({
      number: pullRequest.number,
      kind: marker.kind,
      operation_id: marker.operation_id,
      card_ids: [...marker.card_ids],
      state: pullRequest.state,
    }))
    .sort((left, right) => left.number - right.number);
}

/**
 * Run the shared, read-only diagnostic service. It never acquires the board
 * lock, writes files, creates Git objects, invokes a model, or calls GitHub
 * unless query_markers is explicitly true.
 */
export async function diagnose(
  cwd: string,
  parameters: ValidateParameters = {},
  dependencies: DiagnosticDependencies = {},
): Promise<DiagnosticReport> {
  const runner = dependencies.runner ?? new DirectProcessRunner();
  const piVersion = dependencies.piVersion ?? VERSION;
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node;
  const issues: DiagnosticIssue[] = [];
  const compatiblePi = /^0\.85\.\d+(?:\+[^\s]+)?$/.test(piVersion);
  if (!compatiblePi) issues.push(issue("PI_VERSION_UNSUPPORTED", `Pi ${piVersion} is outside >=0.85.0 <0.86.0`));
  const compatibleNode = atLeast(nodeVersion, NODE_MINIMUM);
  if (!compatibleNode) issues.push(issue("NODE_VERSION_UNSUPPORTED", `Node ${nodeVersion} is below >=22.19.0`));

  const executableCwd = cwd;
  const [git, gh] = await Promise.all([
    executableVersion(runner, "git", executableCwd),
    executableVersion(runner, "gh", executableCwd),
  ]);
  if (!git.available) issues.push(issue("GIT_UNAVAILABLE", "Git executable is unavailable", undefined, "warning"));
  if (!gh.available) issues.push(issue("GH_UNAVAILABLE", "GitHub CLI executable is unavailable", undefined, "warning"));

  const locateRoot = dependencies.locateRoot ?? defaultLocateRoot;
  const root = await locateRoot(cwd, runner).catch(() => undefined);
  if (!root) {
    issues.push(issue("REPOSITORY_NOT_FOUND", "The current directory is not inside a Git repository"));
    return {
      version: 1,
      ok: false,
      runtime: { pi: { version: piVersion, compatible: compatiblePi }, node: { version: nodeVersion, compatible: compatibleNode } },
      executables: { git, gh },
      repository: { found: false, board_valid: false, card_ids: [], dashboard_drift: false, markers_queried: false, managed_prs: [] },
      issues: sortIssues(issues),
    };
  }

  let snapshot: BoardSnapshot | undefined;
  try {
    snapshot = await (dependencies.readRepository ?? readBoardRepository)(root);
  } catch (error) {
    issues.push(issue("BOARD_INVALID", error instanceof Error ? error.message.slice(0, 500) : "Board validation failed"));
  }

  let managedPrs: ManagedPullRequestSummary[] = [];
  let markersQueried = false;
  if (parameters.query_markers && snapshot) {
    if (!gh.available) {
      issues.push(issue("MARKERS_UNAVAILABLE", "Marker query requested but GitHub CLI is unavailable"));
    } else {
      try {
        const github = dependencies.github ?? new GhCliAdapter({ runner, cwd: root, repository: snapshot.board.project.repository_id });
        managedPrs = summarizePullRequests(await discoverManagedPullRequests(github));
        markersQueried = true;
      } catch (error) {
        issues.push(issue("MARKERS_UNAVAILABLE", error instanceof Error ? error.message.slice(0, 500) : "Managed marker query failed"));
      }
    }
  }

  if (snapshot?.dashboardDrift) issues.push(issue("DASHBOARD_DRIFT", "docs/cards/BOARD.md differs from canonical in-memory rendering", "docs/cards/BOARD.md", "warning"));
  const boardValid = snapshot !== undefined;
  return {
    version: 1,
    ok: compatiblePi && compatibleNode && boardValid && issues.every((entry) => entry.severity !== "error"),
    runtime: { pi: { version: piVersion, compatible: compatiblePi }, node: { version: nodeVersion, compatible: compatibleNode } },
    executables: { git, gh },
    repository: {
      found: true,
      board_valid: boardValid,
      card_ids: snapshot?.cards.map((card) => card.id).sort() ?? [],
      dashboard_drift: snapshot?.dashboardDrift ?? false,
      markers_queried: markersQueried,
      managed_prs: managedPrs,
    },
    issues: sortIssues(issues),
  };
}

export function diagnosticText(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}
