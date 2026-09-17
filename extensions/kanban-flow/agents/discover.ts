import { execFile } from "node:child_process";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { packageRoot } from "../paths.ts";
import { agentFilename, isWorkflowAgentName, readAgentDefinition, WORKFLOW_AGENT_CATALOG, type AgentDefinition, type WorkflowAgentName } from "./definitions.ts";
import { verifyPersistedTrust, type PersistedTrustReader } from "./trust.ts";

const execFileAsync = promisify(execFile);

export interface OverrideReportEntry { name: WorkflowAgentName; source: "package" | "project"; path: string; sha256?: string; reason?: string }
export interface AgentDiscoveryReport { active: OverrideReportEntry[]; ignored: OverrideReportEntry[]; unavailable: OverrideReportEntry[] }
export interface AgentDiscoveryResult { agents: Map<WorkflowAgentName, AgentDefinition>; report: AgentDiscoveryReport; repositoryRoot: string; dispatchCwd: string; persistedTrust: boolean }

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}
function logical(root: string, candidate: string): string { return relative(root, candidate).split(sep).join("/"); }

export async function findGitRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 10_000 });
  return realpath(stdout.trim());
}

async function safeDefinition(candidate: string, root: string, name: WorkflowAgentName): Promise<AgentDefinition> {
  const entry = await lstat(candidate);
  if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error(`Agent override is not a regular file: ${logical(root, candidate)}`);
  const canonical = await realpath(candidate);
  if (!contained(root, canonical)) throw new Error(`Agent override escapes the repository: ${logical(root, candidate)}`);
  if (!(await stat(canonical)).isFile()) throw new Error(`Agent override is not a regular file: ${logical(root, candidate)}`);
  return readAgentDefinition(canonical, name, "project", logical(root, candidate));
}

function ancestors(cwd: string, root: string): string[] {
  if (!contained(root, cwd)) throw new Error("Dispatch cwd is outside the repository root");
  const values: string[] = [];
  for (let current = cwd;; current = dirname(current)) {
    values.push(current);
    if (current === root) return values;
  }
}

export async function discoverAgents(options: { cwd: string; repositoryRoot?: string; packageAgentsRoot?: string; overridesEnabled: boolean; trustReader?: PersistedTrustReader }): Promise<AgentDiscoveryResult> {
  const repositoryRoot = await realpath(options.repositoryRoot ?? await findGitRoot(options.cwd));
  const dispatchCwd = await realpath(options.cwd);
  if (!contained(repositoryRoot, dispatchCwd)) throw new Error("Dispatch cwd is outside the repository root");
  const packageAgentsRoot = await realpath(options.packageAgentsRoot ?? join(await packageRoot(), "agents"));
  const trust = await verifyPersistedTrust(repositoryRoot, dispatchCwd, options.trustReader);
  const agents = new Map<WorkflowAgentName, AgentDefinition>();
  const report: AgentDiscoveryReport = { active: [], ignored: [], unavailable: [] };

  for (const name of Object.keys(WORKFLOW_AGENT_CATALOG).sort() as WorkflowAgentName[]) {
    const packagedPath = join(packageAgentsRoot, agentFilename(name));
    try {
      const definition = await readAgentDefinition(packagedPath, name, "package", `agents/${agentFilename(name)}`);
      agents.set(name, definition);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      report.unavailable.push({ name, source: "package", path: `agents/${agentFilename(name)}`, reason: "not_implemented" });
    }
  }

  for (const name of Object.keys(WORKFLOW_AGENT_CATALOG).sort() as WorkflowAgentName[]) {
    const candidates: string[] = [];
    for (const directory of ancestors(dispatchCwd, repositoryRoot)) {
      const agentsDirectory = join(directory, ".pi", "agents");
      let entries: string[];
      try { entries = await readdir(agentsDirectory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      const exact = entries.filter((entry) => entry === agentFilename(name));
      if (exact.length > 1) throw new Error(`Duplicate same-precedence agent override: ${logical(repositoryRoot, agentsDirectory)}/${agentFilename(name)}`);
      if (exact.length === 1) candidates.push(join(agentsDirectory, exact[0]));
    }
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const path = logical(repositoryRoot, candidate);
      if (!options.overridesEnabled || !trust.trusted) {
        report.ignored.push({ name, source: "project", path, reason: !options.overridesEnabled ? "overrides_disabled" : "persisted_trust_required" });
        continue;
      }
      const definition = await safeDefinition(candidate, repositoryRoot, name);
      if (index === 0) agents.set(name, definition);
      else report.ignored.push({ name, source: "project", path, sha256: definition.sha256, reason: "shadowed_by_nearer_override" });
    }
  }

  for (const [name, definition] of [...agents.entries()].sort(([left], [right]) => left.localeCompare(right))) report.active.push({ name, source: definition.source, path: definition.path, sha256: definition.sha256 });
  report.ignored.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  report.unavailable.sort((left, right) => left.name.localeCompare(right.name));
  return { agents, report, repositoryRoot, dispatchCwd, persistedTrust: trust.trusted };
}

export function assertAgentAvailable(result: AgentDiscoveryResult, name: WorkflowAgentName): AgentDefinition {
  const definition = result.agents.get(name);
  if (!definition) throw new Error(`Workflow agent is not implemented: ${name}`);
  return definition;
}
