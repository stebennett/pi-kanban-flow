import { stringify } from "yaml";
import type { Board, Config } from "../board/schemas.ts";
import type { BoardSnapshot, CardRecord } from "../board/repository.ts";
import type { LockHandle } from "../board/lock.ts";
import { renderBoard } from "../engine/render.ts";
import { runtimeId } from "../engine/ids.ts";
import type { StateMutation, StateMutationContext, StateTransactionCoordinator, StateTransactionOutcome } from "../state-pr/transaction.ts";
import type { ApprovalAdapter, RequirementsApprovalBundle } from "./approval.ts";
import { RequirementsApprovalRequest, assertApprovalFresh, prepareRequirementsApproval } from "./approval.ts";
import type { RequirementsDispatchChecked, RequirementsDispatchOutcome, RequirementsDispatchService } from "./dispatch.ts";
import { materializeRequirements, renderRequirements } from "./render.ts";
import { validateBoardSemantics } from "../board/semantic-validation.ts";
import { RequirementsDesignClosureError } from "../reconciliation/requirements.ts";
import type { ParentModel } from "../agents/models.ts";
import { prepareOperationRecordStore, type OperationRecordStore } from "./operations.ts";

function yaml(value: unknown): string { return stringify(value, { lineWidth: 0 }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n"); }
function canonical(value: unknown): string { return JSON.stringify(value); }
export interface RequirementsCandidate { readonly snapshot: BoardSnapshot; readonly files: Readonly<Record<string, string>>; readonly mutation: StateMutation }

/** Assemble exact state-owned bytes; no filesystem or external action occurs here. */
export function buildRequirementsCandidate(input: { authoritative: BoardSnapshot; checked: RequirementsDispatchChecked; packageVersion: string; context: StateMutationContext }): RequirementsCandidate {
  const requirements = renderRequirements(materializeRequirements(input.authoritative, input.checked.proposal, input.checked.allocation));
  const cards = input.checked.impact.cards as readonly CardRecord[]; const dashboard = renderBoard(cards);
  const files: Record<string, string> = {};
  if (requirements !== input.authoritative.requirements) files["docs/spec.md"] = requirements;
  for (const candidate of input.checked.impact.renderedCards) files[`docs/cards/${candidate.card.id}.md`] = candidate.bytes;
  for (const artifact of input.checked.artifacts) files[artifact.path] = artifact.bytes;
  if (dashboard !== input.authoritative.canonicalDashboard) files["docs/cards/BOARD.md"] = dashboard;
  const paths = [...Object.keys(files), "docs/cards/board.yaml"].sort();
  const board: Board = { ...input.authoritative.board, last_writer_package_version: input.packageVersion, ids: { next_requirement: input.checked.allocation.next.requirement, next_card: input.checked.allocation.next.card, next_acceptance_criterion: input.checked.allocation.next.acceptanceCriterion, next_finding: input.checked.allocation.next.finding }, state: { last_reconciled_at: input.context.plannedAt, last_state_transaction: { id: input.context.transactionId, operation_id: input.context.operationId, planned_at: input.context.plannedAt, base_commit: input.context.baseCommit, card_ids: [...input.checked.impact.affectedCardIds], paths } } };
  files["docs/cards/board.yaml"] = yaml(board);
  validateBoardSemantics({ board, config: input.authoritative.config, cards, requirements: materializeRequirements(input.authoritative, input.checked.proposal, input.checked.allocation), findingIds: [...(input.authoritative.findingIds ?? []), ...input.checked.allocation.producerFindingIds, ...input.checked.allocation.checkerFindingIds] });
  const snapshot: BoardSnapshot = Object.freeze({ root: input.authoritative.root, board, config: input.authoritative.config, cards: Object.freeze([...cards]), findingIds: Object.freeze([...(input.authoritative.findingIds ?? []), ...input.checked.allocation.producerFindingIds, ...input.checked.allocation.checkerFindingIds].sort()), requirements, dashboard, canonicalDashboard: dashboard, dashboardDrift: false });
  const expected = canonical({ board: input.authoritative.board, cards: input.authoritative.cards, requirements: input.authoritative.requirements, findingIds: input.authoritative.findingIds ?? [] });
  const mutation: StateMutation = { cardIds: input.checked.impact.affectedCardIds, apply(authoritative, context) {
    if (canonical({ board: authoritative.board, cards: authoritative.cards, requirements: authoritative.requirements, findingIds: authoritative.findingIds ?? [] }) !== expected) throw new Error("Authoritative board changed after requirements approval");
    if (context.operationId !== input.context.operationId || context.transactionId !== input.context.transactionId || context.baseCommit !== input.context.baseCommit || context.plannedAt !== input.context.plannedAt) throw new Error("State transaction identity changed after requirements approval");
    return { snapshot, files: Object.freeze({ ...files }) };
  } };
  return Object.freeze({ snapshot, files: Object.freeze(files), mutation: Object.freeze(mutation) });
}

export interface RequirementsPreflightReady { kind: "ready"; baseCommit: string; snapshot: BoardSnapshot; managedState: unknown }
export type RequirementsPreflight = RequirementsPreflightReady | { kind: "pending"; url: string } | { kind: "reconciliation_proposed"; url: string } | { kind: "blocked"; issue: string };
export interface RequirementsWorkflowDependencies {
  acquireLock(input: { root: string; repositoryId: string; operationId: string }): Promise<LockHandle>;
  preflight(input: { root: string; repositoryId: string; operationId: string }): Promise<RequirementsPreflight>;
  dispatch: Pick<RequirementsDispatchService, "run">;
  approvalAdapter?: ApprovalAdapter;
  interactive: boolean;
  normalization: { roots: Readonly<Record<string, string>>; secrets?: readonly string[] };
  revalidate(input: { ready: RequirementsPreflightReady; checked: RequirementsDispatchChecked; bundle: RequirementsApprovalBundle; candidate: RequirementsCandidate }): Promise<RequirementsApprovalBundle>;
  closeDesign(input: { checked: RequirementsDispatchChecked; operationId: string; baseCommit: string; assertOwnership(): Promise<void> }): Promise<void>;
  transaction: Pick<StateTransactionCoordinator, "propose">;
  now?: () => Date;
}
export type RequirementsWorkflowStatus = "proposed" | "pending" | "reconciliation_proposed" | "revision_required" | "prepared_noninteractive" | "stale" | "blocked" | "cancelled" | "failed" | "failed_recovery_required";
export interface RequirementsWorkflowOutcome { status: RequirementsWorkflowStatus; operationId: string; transactionId: string | null; baseCommit: string | null; statePrUrl: string | null; approvalDigest: string | null; affectedCards: readonly string[]; grandfatheredCards: readonly string[]; activeOverrides: readonly { name: string; path: string; sha256: string }[]; models: readonly { agent: string; provider: string; model: string; thinking: string }[]; issue?: string; document?: string }
function result(status: RequirementsWorkflowStatus, operationId: string, values: Partial<Omit<RequirementsWorkflowOutcome, "status" | "operationId">> = {}): RequirementsWorkflowOutcome { return { status, operationId, transactionId: null, baseCommit: null, statePrUrl: null, approvalDigest: null, affectedCards: [], grandfatheredCards: [], activeOverrides: [], models: [], ...values }; }

export class RequirementsWorkflow {
  private readonly now: () => Date;
  constructor(private readonly dependencies: RequirementsWorkflowDependencies) { this.now = dependencies.now ?? (() => new Date()); }
  async run(input: { root: string; repositoryId: string; packageVersion: string; brief: string; parentModel: ParentModel }, parentSignal?: AbortSignal): Promise<RequirementsWorkflowOutcome> {
    const operationId = runtimeId("KFOP", this.now()); let lock: LockHandle | undefined; let records: OperationRecordStore | undefined; let timer: NodeJS.Timeout | undefined; let ownershipError: Error | undefined; const controller = new AbortController();
    const parentAbort = () => controller.abort(parentSignal?.reason); parentSignal?.addEventListener("abort", parentAbort, { once: true });
    let outcome: RequirementsWorkflowOutcome = result("failed", operationId, { issue: "workflow did not complete" });
    let externalActionsStarted = false;
    try {
      lock = await this.dependencies.acquireLock({ root: input.root, repositoryId: input.repositoryId, operationId });
      const commonDirectory = (lock.record as any).git_common_dir;
      if (typeof commonDirectory === "string") records = await prepareOperationRecordStore(commonDirectory, operationId, this.now());
      const heartbeat = async () => { if (ownershipError) throw ownershipError; try { await lock!.heartbeat(); } catch (error) { ownershipError = error instanceof Error ? error : new Error(String(error)); controller.abort(ownershipError); throw ownershipError; } };
      timer = setInterval(() => { void heartbeat().catch(() => undefined); }, Math.max(1000, Math.floor((lock.record.expires_at ? new Date(lock.record.expires_at).getTime() - new Date(lock.record.heartbeat_at).getTime() : 30000) / 3)));
      await heartbeat(); const ready = await this.dependencies.preflight({ root: input.root, repositoryId: input.repositoryId, operationId });
      if (ready.kind === "pending") outcome = result("pending", operationId, { statePrUrl: ready.url });
      else if (ready.kind === "reconciliation_proposed") outcome = result("reconciliation_proposed", operationId, { statePrUrl: ready.url });
      else if (ready.kind === "blocked") outcome = result("blocked", operationId, { issue: ready.issue });
      else {
        const transactionId = runtimeId("KFTX", this.now()); const plannedAt = this.now().toISOString();
        await heartbeat(); const dispatched: RequirementsDispatchOutcome = await this.dependencies.dispatch.run({ root: input.root, repositoryId: input.repositoryId, baseCommit: ready.baseCommit, brief: input.brief, snapshot: ready.snapshot, operationId, transactionId, plannedAt, parentModel: input.parentModel }, controller.signal);
        if (dispatched.kind === "failed") outcome = result("failed", operationId, { baseCommit: ready.baseCommit, issue: dispatched.error });
        else if (dispatched.kind === "revision_required") outcome = result("revision_required", operationId, { baseCommit: ready.baseCommit, issue: dispatched.payload.summary });
        else {
          const context = { operationId, transactionId, baseCommit: ready.baseCommit, plannedAt }; const candidate = buildRequirementsCandidate({ authoritative: ready.snapshot, checked: dispatched, packageVersion: input.packageVersion, context });
          const bundle = prepareRequirementsApproval({ checked: dispatched, snapshot: ready.snapshot, baseCommit: ready.baseCommit, proposedPaths: Object.keys(candidate.files), normalization: this.dependencies.normalization });
          const common = { transactionId, baseCommit: ready.baseCommit, approvalDigest: bundle.digest, affectedCards: dispatched.impact.affectedCardIds, grandfatheredCards: dispatched.impact.grandfatheredCardIds, activeOverrides: dispatched.discovery.active.filter(({ source }) => source === "project" && Boolean(source)).map(({ name, path, sha256 }) => ({ name, path, sha256: sha256! })), models: [{ agent: "requirements-producer", provider: dispatched.models.producer.provider, model: dispatched.models.producer.id, thinking: dispatched.models.producer.thinking }, { agent: "requirements-checker", provider: dispatched.models.checker.provider, model: dispatched.models.checker.id, thinking: dispatched.models.checker.thinking }] };
          outcome = result("failed", operationId, common);
          if (!this.dependencies.interactive || !this.dependencies.approvalAdapter) outcome = result("prepared_noninteractive", operationId, { ...common, document: bundle.document });
          else {
            await heartbeat(); const decision = await new RequirementsApprovalRequest(bundle).decide(this.dependencies.approvalAdapter, controller.signal);
            if (decision.kind === "revision_required") outcome = result("revision_required", operationId, common);
            else if (decision.kind === "cancelled") outcome = result("cancelled", operationId, { ...common, issue: decision.reason });
            else {
              await heartbeat(); const fresh = await this.dependencies.revalidate({ ready, checked: dispatched, bundle, candidate }); assertApprovalFresh(decision, fresh);
              await heartbeat(); externalActionsStarted = dispatched.impact.designClosures.length > 0; await this.dependencies.closeDesign({ checked: dispatched, operationId, baseCommit: ready.baseCommit, assertOwnership: heartbeat });
              await heartbeat(); await lock.setTransactionId(transactionId);
              externalActionsStarted = true;
              const transaction = await this.dependencies.transaction.propose({ root: input.root, repositoryId: input.repositoryId, packageVersion: input.packageVersion, operationId, transactionId, plannedAt, mutation: candidate.mutation, title: "Apply approved requirements", body: `Approved requirements digest: ${bundle.digest}` });
              outcome = this.transactionOutcome(transaction, operationId, common);
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const stale = error instanceof RequirementsDesignClosureError && error.stale || /approval is stale|origin\/main changed|Authoritative board changed/.test(message);
      outcome = result(stale ? "stale" : externalActionsStarted ? "failed_recovery_required" : controller.signal.aborted && !ownershipError ? "cancelled" : "failed", operationId, { issue: ownershipError ? "lock_ownership_lost" : message, baseCommit: outcome.baseCommit, approvalDigest: outcome.approvalDigest, transactionId: outcome.transactionId, affectedCards: outcome.affectedCards, grandfatheredCards: outcome.grandfatheredCards, activeOverrides: outcome.activeOverrides, models: outcome.models });
    } finally {
      if (timer) clearInterval(timer); parentSignal?.removeEventListener("abort", parentAbort);
      if (records) try { await records.finish({ version: 1, operation_id: operationId, status: outcome.status, transaction_id: outcome.transactionId ?? "none", base_commit: outcome.baseCommit ?? "none", approval_digest: outcome.approvalDigest ?? "none", affected_cards: outcome.affectedCards, grandfathered_cards: outcome.grandfatheredCards }); } catch (error) { outcome = result("failed", operationId, { issue: `operation_record_failed: ${error instanceof Error ? error.message : String(error)}` }); }
      if (lock) try { await lock.release(); } catch (error) { outcome = result("failed", operationId, { issue: `lock_release_failed: ${error instanceof Error ? error.message : String(error)}` }); }
    }
    return outcome;
  }
  private transactionOutcome(transaction: StateTransactionOutcome, operationId: string, common: Partial<RequirementsWorkflowOutcome>): RequirementsWorkflowOutcome {
    if (transaction.kind === "proposed" || transaction.kind === "reused") return result("proposed", operationId, { ...common, statePrUrl: transaction.pullRequest.url });
    if (transaction.kind === "pending") return result("pending", operationId, { ...common, statePrUrl: transaction.pullRequest.url });
    return result("stale", operationId, { ...common, statePrUrl: transaction.pullRequest.url, issue: "state transaction already merged; refresh authority" });
  }
}
