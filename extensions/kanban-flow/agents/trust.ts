import { realpath } from "node:fs/promises";
import { ProjectTrustStore, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PersistedTrustEntry { path: string; decision: boolean }
export interface PersistedTrustReader { getEntry(path: string): PersistedTrustEntry | null }

export interface PersistedTrustResult {
  trusted: boolean;
  repositoryRoot: string;
  dispatchCwd: string;
  decisionPath?: string;
  reason: "saved_yes" | "saved_no" | "absent";
}

export async function verifyPersistedTrust(repositoryRoot: string, dispatchCwd: string, reader: PersistedTrustReader = new ProjectTrustStore(getAgentDir())): Promise<PersistedTrustResult> {
  const [root, cwd] = await Promise.all([realpath(repositoryRoot), realpath(dispatchCwd)]);
  if (cwd !== root && !cwd.startsWith(`${root}/`)) throw new Error("Dispatch cwd is outside the canonical repository root");
  const entry = reader.getEntry(cwd);
  if (!entry) return { trusted: false, repositoryRoot: root, dispatchCwd: cwd, reason: "absent" };
  return { trusted: entry.decision === true, repositoryRoot: root, dispatchCwd: cwd, decisionPath: entry.path, reason: entry.decision === true ? "saved_yes" : "saved_no" };
}

export async function requirePersistedTrust(repositoryRoot: string, dispatchCwd: string, reader?: PersistedTrustReader): Promise<PersistedTrustResult> {
  const result = await verifyPersistedTrust(repositoryRoot, dispatchCwd, reader);
  if (!result.trusted) throw new Error(`Persisted project trust is required (${result.reason})`);
  return result;
}
