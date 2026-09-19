import { Type } from "typebox";
import type { ApprovalAdapter } from "../requirements/approval.ts";
import { packageRoot } from "../paths.ts";
import { GitAdapter } from "../state-pr/git.ts";
import { GhCliAdapter, discoverManagedPullRequests } from "../state-pr/github.ts";
import { createStateTransactionGit, createStateTransactionRepository, StateTransactionCoordinator } from "../state-pr/transaction.ts";
import { acquireLock } from "../board/lock.ts";
import { readBoardRepository } from "../board/repository.ts";
import { requirePersistedTrust } from "../agents/trust.ts";
import { discoverAgents } from "../agents/discover.ts";
import { RequirementsDispatchService } from "../requirements/dispatch.ts";
import { RequirementsWorkflow } from "../requirements/workflow.ts";
import { deriveGitHubRepositoryIdentity } from "../requirements/initialize.ts";
import { executeRequirementsDesignClosures } from "../reconciliation/requirements.ts";
import type { ModelResolver, ParentModel } from "../agents/models.ts";

export const requirementsParameters = Type.Object({ schema_version: Type.Literal(1), brief: Type.String({ minLength: 1, maxLength: 40000 }) }, { additionalProperties: false });
export interface PiApprovalUi { select(title: string, options: string[], settings?: { signal?: AbortSignal }): Promise<string | undefined> }
export interface RequirementsToolResult { version: 1; workflow: "requirements"; status: string; operation_id: string; transaction_id: string; base_commit: string; state_pr_url: string; approval_digest: string; affected_cards: readonly string[]; grandfathered_cards: readonly string[]; active_overrides: readonly { name: string; path: string; sha256: string }[]; models: readonly { agent: string; provider: string; model: string; thinking: string }[]; next_action: string; issues: readonly { code: string; message: string }[]; approval_document?: string }

export function createPiApprovalAdapter(ui: PiApprovalUi, supported: boolean): ApprovalAdapter | undefined {
  if (!supported) return undefined;
  return { async request(input, signal) { const approve = `Approve ${input.digest}`; const selected = await ui.select(`Requirements proposal\n\n${input.document}`, [approve, "Revise", "Cancel"], { signal }); if (selected === approve) return "approve"; if (selected === "Revise") return "revise"; if (selected === "Cancel") return "cancel"; return undefined; } };
}
function normalizeBrief(value: string): string {
  const brief = value.replace(/\r\n?/g, "\n").trim(); let count = 0; for (const character of brief) count += 1;
  if (!brief || count > 20000 || /\u0000|[\uD800-\uDFFF]/u.test(brief)) throw new Error("Requirements brief must be 1-20000 valid Unicode code points"); return brief;
}

export async function runRequirementsTool(input: { cwd: string; packageVersion: string; brief: string; parentModel: ParentModel; modelResolver: ModelResolver; approvalAdapter?: ApprovalAdapter; interactive: boolean; signal?: AbortSignal }): Promise<RequirementsToolResult> {
  const brief = normalizeBrief(input.brief); const git = new GitAdapter({ cwd: input.cwd }); const root = await git.repositoryRoot(input.cwd); await requirePersistedTrust(root, input.cwd); const identity = await deriveGitHubRepositoryIdentity(root, { git });
  const initial = await readBoardRepository(root); if (initial.board.project.repository_id !== identity.repositoryId) throw new Error("Board repository identity does not match GitHub");
  const github = new GhCliAdapter({ cwd: root, repository: identity.repositoryId }); const transactionGit = createStateTransactionGit(git); const dispatch = new RequirementsDispatchService({ modelResolver: input.modelResolver });
  const workflow = new RequirementsWorkflow({
    acquireLock: ({ operationId }) => acquireLock({ cwd: root, repositoryId: identity.repositoryId, operationId, command: "requirements", ttlSeconds: initial.config.lock.ttl_seconds }),
    preflight: async () => {
      await git.fetch("origin", root); const baseCommit = await git.resolveRef("origin/main", root); if (await git.resolveRef("HEAD", root) !== baseCommit) return { kind: "blocked", issue: "The canonical checkout must exactly match origin/main" } as const; const dirty = await git.workingDiffPaths(baseCommit, root); if (dirty.some((path) => path === "docs/spec.md" || path.startsWith("docs/cards/"))) return { kind: "blocked", issue: "Dirty state-owned paths block requirements work" } as const; const snapshot = await readBoardRepository(root); if (snapshot.board.project.repository_id !== identity.repositoryId) return { kind: "blocked", issue: "Board repository identity does not match GitHub" } as const;
      const state = await discoverManagedPullRequests(github, { kind: "state" }); if (state.length > 1) return { kind: "blocked", issue: "Multiple managed state PRs are ambiguous" } as const; if (state[0]?.pullRequest.state === "open") return { kind: "pending", url: state[0].pullRequest.url } as const; if (state[0]) return { kind: "blocked", issue: "A merged or closed state PR requires reconciliation before requirements work" } as const;
      return { kind: "ready", baseCommit, snapshot, managedState: [] } as const;
    }, dispatch, approvalAdapter: input.approvalAdapter, interactive: input.interactive, normalization: { roots: { "<PACKAGE_ROOT>": await packageRoot(), "<REPOSITORY_ROOT>": root } },
    revalidate: async ({ ready, checked, bundle }) => {
      await git.fetch("origin", root); if (await git.resolveRef("origin/main", root) !== ready.baseCommit) throw new Error("origin/main changed after approval"); const fresh = await readBoardRepository(root);
      const before = JSON.stringify({ board: ready.snapshot.board, cards: ready.snapshot.cards, requirements: ready.snapshot.requirements, findings: ready.snapshot.findingIds }); const after = JSON.stringify({ board: fresh.board, cards: fresh.cards, requirements: fresh.requirements, findings: fresh.findingIds }); if (before !== after) throw new Error("Authoritative board changed after approval");
      const agents = await discoverAgents({ cwd: root, repositoryRoot: root, overridesEnabled: fresh.config.agents.allow_project_overrides }); if (!agents.persistedTrust || JSON.stringify(agents.report) !== JSON.stringify(checked.discovery)) throw new Error("Active requirements agent overrides changed after approval");
      const state = await discoverManagedPullRequests(github, { kind: "state" }); if (state.length > 0) throw new Error("Managed state PR state changed after approval"); return bundle;
    },
    closeDesign: ({ checked, operationId, baseCommit, assertOwnership }) => executeRequirementsDesignClosures({ actions: checked.impact.designClosures, operationId, baseCommit, github, assertOwnership, refreshBase: async () => { await git.fetch("origin", root); return git.resolveRef("origin/main", root); } }),
    transaction: new StateTransactionCoordinator(createStateTransactionRepository(), transactionGit, github),
  });
  const outcome = await workflow.run({ root, repositoryId: identity.repositoryId, packageVersion: input.packageVersion, brief, parentModel: input.parentModel }, input.signal);
  const next: Record<string, string> = { proposed: "Review and merge the state PR; proposed content is not authoritative until merge.", pending: "Review and resolve the pending state PR.", prepared_noninteractive: "Run this workflow in TUI or RPC mode to approve the displayed digest.", revision_required: "Revise the requirements brief and start a fresh run.", stale: "Refresh authoritative state and start a fresh requirements run.", cancelled: "No state was proposed.", reconciliation_proposed: "Review and merge the reconciliation state PR before retrying.", failed_recovery_required: "Inspect the recorded external action and retry for marker-based recovery.", failed: "Resolve the reported failure and retry.", blocked: "Resolve the blocking repository state and retry." };
  return { version: 1, workflow: "requirements", status: outcome.status, operation_id: outcome.operationId, transaction_id: outcome.transactionId ?? "none", base_commit: outcome.baseCommit ?? "none", state_pr_url: outcome.statePrUrl ?? "none", approval_digest: outcome.approvalDigest ?? "none", affected_cards: outcome.affectedCards, grandfathered_cards: outcome.grandfatheredCards, active_overrides: outcome.activeOverrides, models: outcome.models, next_action: next[outcome.status] ?? "Inspect the workflow result.", issues: outcome.issue ? [{ code: outcome.status, message: outcome.issue.slice(0, 2000) }] : [], ...(outcome.document ? { approval_document: outcome.document } : {}) };
}
