import { Type } from "typebox";
import { GitAdapter } from "../state-pr/git.ts";
import { GhCliAdapter } from "../state-pr/github.ts";
import { createStateTransactionGit } from "../state-pr/transaction.ts";
import { acquireLock } from "../board/lock.ts";
import { requirePersistedTrust } from "../agents/trust.ts";
import { runtimeId } from "../engine/ids.ts";
import { InitializationCoordinator, createInitializationRepository, deriveGitHubRepositoryIdentity } from "../requirements/initialize.ts";

export const initializeParameters = Type.Object({ schema_version: Type.Literal(1) }, { additionalProperties: false });
export interface InitializeToolResult { version: 1; workflow: "initialize"; status: "proposed" | "already_initialized" | "pending" | "blocked" | "cancelled" | "failed"; operation_id: string; transaction_id: string; base_commit: string; state_pr_url: string; repository_id: string; affected_cards: []; active_overrides: []; next_action: string; issues: Array<{ code: string; message: string }> }
function base(status: InitializeToolResult["status"]): InitializeToolResult { return { version: 1, workflow: "initialize", status, operation_id: "none", transaction_id: "none", base_commit: "none", state_pr_url: "none", repository_id: "none", affected_cards: [], active_overrides: [], next_action: "", issues: [] }; }

export async function runInitializeTool(cwd: string, packageVersion: string): Promise<InitializeToolResult> {
  let lock: Awaited<ReturnType<typeof acquireLock>> | undefined; const result = base("failed");
  try {
    const git = new GitAdapter({ cwd }); const root = await git.repositoryRoot(cwd); await requirePersistedTrust(root, cwd);
    const identity = await deriveGitHubRepositoryIdentity(root, { git }); const operationId = runtimeId("KFOP"); result.operation_id = operationId; result.repository_id = identity.repositoryId;
    lock = await acquireLock({ cwd: root, repositoryId: identity.repositoryId, operationId, command: "kanban-init", ttlSeconds: 1800 });
    const github = new GhCliAdapter({ cwd: root, repository: identity.repositoryId }); const transactionGit = createStateTransactionGit(git); let transactionId = "none";
    const coordinator = new InitializationCoordinator(createInitializationRepository(git), transactionGit, github, async () => identity);
    const outcome = await coordinator.propose({ root, packageVersion, operationId, onTransactionId: async (id) => { transactionId = id; await lock!.setTransactionId(id); } });
    result.transaction_id = transactionId;
    if (outcome.kind === "already_initialized") { result.status = "already_initialized"; result.next_action = "The authoritative board is already initialized."; }
    else if (outcome.kind === "pending") { result.status = "pending"; result.state_pr_url = outcome.pullRequest.url; result.next_action = "Review and merge the existing state PR; its contents are not authoritative until merge."; }
    else { result.status = "proposed"; result.transaction_id = outcome.descriptor.id; result.base_commit = outcome.descriptor.base_commit; result.state_pr_url = outcome.pullRequest.url; result.next_action = "Review and merge the initialization state PR, then run /skill:requirements."; }
  } catch (error) { result.status = "failed"; result.issues = [{ code: "initialization_failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }]; result.next_action = "Resolve the reported issue and retry initialization."; }
  finally { if (lock) try { await lock.release(); } catch (error) { result.status = "failed"; result.issues.push({ code: "lock_release_failed", message: String(error).slice(0, 2000) }); } }
  return result;
}
