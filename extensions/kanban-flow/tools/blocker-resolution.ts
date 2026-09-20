import { Type, type Static } from "typebox";
import { stringify } from "yaml";
import { readBoardRepository } from "../board/repository.ts";
import { renderBoard } from "../engine/render.ts";
import { planLifecycleTransition } from "../lifecycle/effects.ts";
import { renderCardDocument } from "../requirements/render.ts";
import { runtimeId } from "../engine/ids.ts";
import { GitAdapter } from "../state-pr/git.ts";
import { GhCliAdapter } from "../state-pr/github.ts";
import { createStateTransactionGit, createStateTransactionRepository, StateTransactionCoordinator, type StateMutation } from "../state-pr/transaction.ts";
import { deriveGitHubRepositoryIdentity } from "../requirements/initialize.ts";
import { packageRoot } from "../paths.ts";

const RESUME = ["backlog", "designing", "design_review", "ready_for_implementation", "implementing", "implementation_review", "ready_to_ship", "shipping"] as const;
export const blockerResolutionParameters = Type.Object({
  schema_version: Type.Literal(1), card_id: Type.String({ pattern: "^CARD-[0-9]{4}$" }),
  resume_status: Type.Union(RESUME.map((status) => Type.Literal(status))),
  decision: Type.Union([Type.Literal("resolve"), Type.Literal("proceed_unsplit"), Type.Literal("cancel")]),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2000, pattern: "^[^\\u0000\\r\\n]+$" })),
}, { additionalProperties: false });
export type BlockerResolutionParameters = Static<typeof blockerResolutionParameters>;
export interface BlockerResolutionResult { version: 1; workflow: "blocker_resolution"; status: "proposed" | "cancelled" | "failed"; operation_id: string; state_pr_url: string; card_id: string; next_action: string; issues: readonly { code: string; message: string }[] }

export async function runBlockerResolution(input: { cwd: string; packageVersion: string; params: BlockerResolutionParameters; signal?: AbortSignal }): Promise<BlockerResolutionResult> {
  const operationId = runtimeId("KFOP");
  if (input.params.decision === "cancel") return { version: 1, workflow: "blocker_resolution", status: "cancelled", operation_id: operationId, state_pr_url: "none", card_id: input.params.card_id, next_action: "The blocker remains unchanged.", issues: [] };
  if (!input.params.reason) return { version: 1, workflow: "blocker_resolution", status: "failed", operation_id: operationId, state_pr_url: "none", card_id: input.params.card_id, next_action: "Provide a bounded reason and retry.", issues: [{ code: "reason_required", message: "A human reason is required for blocker resolution." }] };
  try {
    const git = new GitAdapter({ cwd: input.cwd }); const root = await git.repositoryRoot(input.cwd); const identity = await deriveGitHubRepositoryIdentity(root, { git });
    const initial = await readBoardRepository(root); const card = initial.cards.find((candidate) => candidate.id === input.params.card_id); if (!card) throw new Error("Card was not found in the authoritative board");
    if (!card.blocked) throw new Error("Card is not blocked");
    const github = new GhCliAdapter({ cwd: root, repository: identity.repositoryId });
    const mutation: StateMutation = { cardIds: [card.id], apply(authoritative, context) {
      const current = (authoritative as any).cards.find((candidate: any) => candidate.id === card.id); if (!current) throw new Error("Card disappeared from authoritative board");
      const transition = planLifecycleTransition(authoritative as any, { cardId: card.id, designLimit: 10, implementationLimit: 1, metadata: { at: context.plannedAt, operationId: context.operationId, transactionId: context.transactionId, historyId: runtimeId("KFH"), summary: `Resolve blocker: ${input.params.reason}` }, event: {
        kind: "blocker_resolved", resumeStatus: input.params.resume_status,
        ...(input.params.decision === "proceed_unsplit" ? { proceedUnsplit: { reason: input.params.reason!, decidedAt: context.plannedAt, splitResultPath: current.workflow.split_decision.result_path ?? undefined } } : {}),
      } as any });
      const next = transition.proposedSnapshot as any; const files: Record<string, string> = {};
      for (const changed of next.cards as readonly any[]) { const before = (authoritative as any).cards.find((candidate: any) => candidate.id === changed.id); if (JSON.stringify(before) !== JSON.stringify(changed)) files[`docs/cards/${changed.id}.md`] = renderCardDocument(changed, changed.why ?? before?.why ?? "", changed.notes ?? before?.notes ?? ""); }
      files["docs/cards/BOARD.md"] = renderBoard(next.cards as any);
      files["docs/cards/board.yaml"] = stringify(next.board, { lineWidth: 0 }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n");
      return { snapshot: next, files };
    } };
    const coordinator = new StateTransactionCoordinator(createStateTransactionRepository(), createStateTransactionGit(git), github);
    const outcome = await coordinator.propose({ root, repositoryId: identity.repositoryId, packageVersion: input.packageVersion, operationId, mutation });
    if (outcome.kind === "pending") return { version: 1, workflow: "blocker_resolution", status: "proposed", operation_id: operationId, state_pr_url: outcome.pullRequest.url, card_id: card.id, next_action: "Review and merge the state PR; resolution is not authoritative until merge.", issues: [] };
    if (outcome.kind !== "proposed" && outcome.kind !== "reused") throw new Error("State authority changed; reconcile before retrying");
    return { version: 1, workflow: "blocker_resolution", status: "proposed", operation_id: operationId, state_pr_url: outcome.pullRequest.url, card_id: card.id, next_action: "Review and merge the state PR, then run another pump.", issues: [] };
  } catch (error) { return { version: 1, workflow: "blocker_resolution", status: "failed", operation_id: operationId, state_pr_url: "none", card_id: input.params.card_id, next_action: "Resolve the reported failure and retry after reconciliation.", issues: [{ code: "blocker_resolution_failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }] }; }
}

export async function packageVersionForBlocker(): Promise<string> { const { readFile } = await import("node:fs/promises"); const manifest = JSON.parse(await readFile(`${await packageRoot()}/package.json`, "utf8")) as { version?: string }; return manifest.version ?? "0.0.0"; }
