import { Value } from "typebox/value";
import { PumpRequestSchema, type PumpRequest, type PumpReport, buildPumpReport, noActionReport } from "../lifecycle/contracts.ts";
import { runtimeId } from "./ids.ts";
import { scheduleNextCard, type ScheduledCard } from "./scheduler.ts";
import type { BoardSnapshot } from "../board/repository.ts";
import type { BoardSnapshot as SchedulerBoardSnapshot } from "./transitions.ts";
import type { LockHandle } from "../board/lock.ts";
import { LockContentionError, LockOwnershipLostError, acquireLock } from "../board/lock.ts";
import type { StateMutation, StateTransactionCoordinator, StateTransactionOutcome } from "../state-pr/transaction.ts";

export type PumpStop = "state_pr" | "external_pr" | "human_decision" | "blocker" | "external_wait" | "no_action" | "failure";

export interface PumpReconciliation {
  readonly kind: "none" | "pending" | "unresolved" | "mutation" | "wait" | "blocked";
  readonly reason?: string;
  readonly cardId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly mutation?: StateMutation;
  readonly artifacts?: readonly string[];
  readonly blockers?: readonly { code: string; message: string; evidence?: readonly string[] }[];
  readonly waits?: readonly { code: string; message: string; evidence?: readonly string[] }[];
}

export interface PumpPhaseResult {
  readonly kind: "mutation" | "wait" | "blocked" | "failure" | "cancelled" | "external";
  readonly mutation?: StateMutation;
  readonly from?: string;
  readonly to?: string;
  readonly boundary?: PumpStop;
  readonly artifacts?: readonly string[];
  readonly externalPrs?: PumpReport["external_prs"];
  readonly blockers?: readonly { code: string; message: string; evidence?: readonly string[] }[];
  readonly waits?: readonly { code: string; message: string; evidence?: readonly string[] }[];
  readonly issues?: readonly { code: string; message: string; evidence?: readonly string[] }[];
}

export interface PumpPreflightResult {
  readonly kind: "ready" | "blocked" | "failed";
  readonly blockers?: readonly { code: string; message: string; evidence?: readonly string[] }[];
  readonly issues?: readonly { code: string; message: string; evidence?: readonly string[] }[];
  readonly activeOverrides?: PumpReport["active_overrides"];
  readonly models?: PumpReport["models"];
}

export interface PumpDependencies {
  readonly root: string;
  readonly repositoryId: string;
  readonly packageVersion: string;
  /** Validate host/model/trust/policy readiness before the authoritative fetch. */
  readonly preflight?: (input: { signal: AbortSignal; heartbeat: () => Promise<void> }) => Promise<PumpPreflightResult>;
  readonly acquireLock?: (input: { cwd: string; repositoryId: string; operationId: string; command: "kanban"; ttlSeconds: number }) => Promise<LockHandle>;
  readonly ttlSeconds?: number;
  readonly heartbeatSeconds?: number;
  /** Fetch and return one authoritative, immutable board snapshot. */
  readonly authoritative: (signal: AbortSignal) => Promise<{ baseCommit: string; board: BoardSnapshot }>;
  /** Reconciliation is deliberately before scheduler selection. */
  readonly reconcile: (input: { baseCommit: string; board: BoardSnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }) => Promise<PumpReconciliation>;
  readonly dispatch: (input: { operationId: string; selected: ScheduledCard; board: BoardSnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }) => Promise<PumpPhaseResult>;
  readonly transaction: Pick<StateTransactionCoordinator, "propose"> | ((plan: { root: string; repositoryId: string; packageVersion: string; operationId: string; transactionId?: string; mutation: StateMutation; title?: string; body?: string }) => Promise<StateTransactionOutcome>);
  readonly activeOverrides?: PumpReport["active_overrides"];
  readonly models?: PumpReport["models"];
};

function issue(input: { code: string; message: string; evidence?: readonly string[] }) {
  const message = input.message.replace(/(?:^|[\s(=])\/(?!\/)[^\s,;)]*/g, "$1<path>").replace(/[A-Za-z]:\\[^\s,;)]*/g, "<path>");
  return { code: input.code, message: message.slice(0, 2000), evidence: [...(input.evidence ?? [])] };
}
function baseReport(operationId: string, request: PumpRequest, baseCommit = "none"): PumpReport {
  return {
    version: 1, workflow: "kanban", status: "failed", operation_id: operationId, base_commit: baseCommit,
    requested_phase: request.requested_phase, selected_card_id: "none", action: "none",
    transition: { from: "none", to: "none", boundary: "failure" },
    state_pr: { number: "none", url: "none", branch: "none", state: "none" }, external_prs: [], blockers: [], waits: [],
    active_overrides: [], models: [], artifacts: [], evidence_gaps: [], next_human_action: "none", issues: [],
  };
}
function reportFromPhase(report: PumpReport, phase: PumpPhaseResult, selected: ScheduledCard): PumpReport {
  const boundary = phase.boundary ?? (phase.kind === "mutation" ? "state_pr" : phase.kind === "external" ? "external_pr" : phase.kind === "wait" ? "external_wait" : phase.kind === "blocked" ? "blocker" : "failure");
  return { ...report, status: phase.kind === "mutation" ? "proposed" : phase.kind === "wait" ? "waiting" : phase.kind === "blocked" ? "blocked" : phase.kind === "cancelled" ? "cancelled" : phase.kind === "external" ? "failed_recovery_required" : "failed", selected_card_id: selected.card.id, action: selected.nextAction, transition: { from: phase.from ?? selected.card.status, to: phase.to ?? "none", boundary }, artifacts: [...(phase.artifacts ?? [])], external_prs: [...(phase.externalPrs ?? [])], blockers: [...(phase.blockers ?? [])].map(issue), waits: [...(phase.waits ?? [])].map(issue), issues: [...(phase.issues ?? [])].map(issue), next_human_action: phase.kind === "mutation" ? "Review and merge the proposed state PR." : phase.kind === "wait" ? "Wait for the reported external authority, then run another pump." : "Resolve the reported issue before retrying." };
}

/** One deterministic pump. All workflow and board authority remains in injected parent services. */
export async function runPump(requestValue: unknown, dependencies: PumpDependencies, signal?: AbortSignal): Promise<PumpReport> {
  if (!Value.Check(PumpRequestSchema, requestValue)) throw new Error("invalid pump request");
  const request = requestValue as PumpRequest;
  const operationId = runtimeId("KFOP");
  let report = baseReport(operationId, request);
  let lock: LockHandle | undefined;
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let baseCommit = "none";
  let selected: ScheduledCard | undefined;
  let externalActionsStarted = false;
  let finalReport: PumpReport | undefined;
  let heartbeatFailure: unknown;
  const acquire = dependencies.acquireLock ?? ((input) => acquireLock({ ...input, ttlSeconds: dependencies.ttlSeconds ?? 1800 }));
  const heartbeat = async () => {
    if (controller.signal.aborted) {
      if (heartbeatFailure instanceof LockOwnershipLostError) throw heartbeatFailure;
      throw new Error("pump cancelled");
    }
    if (!lock) throw new LockOwnershipLostError();
    await lock.heartbeat();
    if (signal?.aborted) throw new Error("pump cancelled");
  };
  try {
    do {
    lock = await acquire({ cwd: dependencies.root, repositoryId: dependencies.repositoryId, operationId, command: "kanban", ttlSeconds: dependencies.ttlSeconds ?? 1800 });
    await heartbeat();
    const every = Math.max(1000, (dependencies.heartbeatSeconds ?? 30) * 1000);
    timer = setInterval(() => { void heartbeat().catch((error) => { heartbeatFailure = error; controller.abort(error); }); }, every);
    await heartbeat();
    if (dependencies.preflight) {
      const readiness = await dependencies.preflight({ signal: controller.signal, heartbeat });
      report = { ...report, active_overrides: [...(readiness.activeOverrides ?? report.active_overrides)], models: [...(readiness.models ?? report.models)] };
      if (readiness.kind !== "ready") {
        const blockers = [...(readiness.blockers ?? [])].map(issue);
        const issues = [...(readiness.issues ?? [])].map(issue);
        finalReport = buildPumpReport({
          ...report,
          status: readiness.kind === "blocked" ? "blocked" : "failed",
          blockers,
          issues,
          transition: { ...report.transition, boundary: readiness.kind === "blocked" ? "blocker" : "failure" },
          next_human_action: readiness.kind === "blocked" ? "Resolve the reported trust, model, or policy blocker before retrying." : "Resolve the reported preflight failure before retrying.",
        });
        break;
      }
    }
    await heartbeat();
    const authoritative = await dependencies.authoritative(controller.signal);
    baseCommit = authoritative.baseCommit;
    await heartbeat();
    const reconciliation = await dependencies.reconcile({ baseCommit, board: authoritative.board, signal: controller.signal, heartbeat });
    if (reconciliation.kind === "pending" || reconciliation.kind === "unresolved") {
      const waits = reconciliation.kind === "pending" ? [{ code: "state_pr_pending", message: reconciliation.reason ?? "A state PR is pending" }] : [{ code: "state_authority_unresolved", message: reconciliation.reason ?? "State authority is unresolved" }];
      const result = { ...report, status: reconciliation.kind === "pending" ? "pending" : "blocked", base_commit: baseCommit, waits: reconciliation.kind === "pending" ? waits.map(issue) : [], blockers: reconciliation.kind === "unresolved" ? waits.map(issue) : [], transition: { ...report.transition, boundary: reconciliation.kind === "pending" ? "external_wait" : "blocker" }, next_human_action: reconciliation.kind === "pending" ? "Merge or resolve the pending state PR, then run another pump." : "Resolve the ambiguous state authority before retrying." } as PumpReport;
      finalReport = buildPumpReport(result);
      break;
    }
    if (reconciliation.kind === "mutation") {
      if (!reconciliation.mutation) throw new Error("reconciliation mutation is missing");
      await heartbeat();
      const transactionId = runtimeId("KFTX");
      await lock.setTransactionId(transactionId);
      externalActionsStarted = true;
      const outcome = await propose(dependencies, operationId, reconciliation.mutation, transactionId);
      finalReport = buildPumpReport(transactionReport({ ...report, base_commit: baseCommit, action: "reconcile", selected_card_id: reconciliation.cardId ?? "none", artifacts: [...(reconciliation.artifacts ?? [])], transition: { from: reconciliation.from ?? "none", to: reconciliation.to ?? "none", boundary: "state_pr" } }, outcome));
      break;
    }
    if (reconciliation.kind === "wait" || reconciliation.kind === "blocked") {
      finalReport = buildPumpReport({ ...report, base_commit: baseCommit, status: reconciliation.kind === "wait" ? "waiting" : "blocked", waits: [...(reconciliation.waits ?? [])].map(issue), blockers: [...(reconciliation.blockers ?? [])].map(issue), transition: { ...report.transition, boundary: reconciliation.kind === "wait" ? "external_wait" : "blocker" }, next_human_action: reconciliation.kind === "wait" ? "Wait for external authority, then run another pump." : "Resolve the reported blocker before retrying." });
      break;
    }
    selected = scheduleNextCard(authoritative.board as unknown as SchedulerBoardSnapshot, { wipLimit: authoritative.board.config.scheduler.wip_limit }) ?? undefined;
    if (!selected) { finalReport = noActionReport({ baseCommit, operationId, requestedPhase: request.requested_phase }); break; }
    const requestedAction = request.requested_phase === "none" ? undefined : request.requested_phase === "split_decision" ? "split_decision" : request.requested_phase;
    if (requestedAction && selected.nextAction !== requestedAction) { finalReport = buildPumpReport({ ...report, base_commit: baseCommit, status: "phase_not_eligible", transition: { ...report.transition, boundary: "no_action" }, next_human_action: "Run the requested phase when the scheduler selects a matching legal action." }); break; }
    await heartbeat();
    const phase = await dependencies.dispatch({ operationId, selected, board: authoritative.board, signal: controller.signal, heartbeat });
    if (phase.kind !== "mutation") { finalReport = buildPumpReport(reportFromPhase({ ...report, base_commit: baseCommit }, phase, selected)); break; }
    if (!phase.mutation) throw new Error("phase mutation is missing");
    await heartbeat();
    const transactionId = runtimeId("KFTX");
    await lock.setTransactionId(transactionId);
    externalActionsStarted = true;
    const outcome = await propose(dependencies, operationId, phase.mutation, transactionId);
    finalReport = buildPumpReport(transactionReport(reportFromPhase({ ...report, base_commit: baseCommit }, phase, selected), outcome));
    } while (false);
  } catch (error) {
    const external = error instanceof LockContentionError ? false : externalActionsStarted;
    const ownershipLost = error instanceof LockOwnershipLostError;
    const result = { ...report, base_commit: baseCommit, status: ownershipLost || external ? "failed_recovery_required" : signal?.aborted ? "cancelled" : "failed", issues: [issue({ code: error instanceof LockContentionError ? "lock_contention" : ownershipLost ? "lock_ownership_lost" : "pump_failed", message: error instanceof Error ? error.message : String(error), evidence: ownershipLost ? ["lock heartbeat/release evidence is unavailable"] : undefined })], next_human_action: error instanceof LockContentionError ? "Wait for the other pump to finish." : ownershipLost ? "Reconcile remote authority and inspect the lock before retrying." : "Inspect the failure and retry after reconciliation." } as PumpReport;
    finalReport = buildPumpReport(result);
  } finally {
    if (timer) clearInterval(timer);
    signal?.removeEventListener("abort", abort);
    if (lock) {
      try { await lock.release(); }
      catch (error) {
        const releaseIssue = issue({ code: "lock_release_failed", message: error instanceof Error ? error.message : String(error), evidence: ["lock release was not confirmed"] });
        const base = finalReport ?? report;
        finalReport = buildPumpReport({ ...base, status: "failed_recovery_required", issues: [...base.issues, releaseIssue], next_human_action: "Inspect lock ownership and reconcile external authority before retrying." });
      }
    }
  }
  return finalReport ?? buildPumpReport(report);
}

async function propose(dependencies: PumpDependencies, operationId: string, mutation: StateMutation, transactionId?: string): Promise<StateTransactionOutcome> {
  const plan = { root: dependencies.root, repositoryId: dependencies.repositoryId, packageVersion: dependencies.packageVersion, operationId, transactionId, mutation };
  return typeof dependencies.transaction === "function" ? dependencies.transaction(plan) : dependencies.transaction.propose(plan);
}
function transactionReport(report: PumpReport, outcome: StateTransactionOutcome): PumpReport {
  if (outcome.kind === "pending") return { ...report, status: "pending", state_pr: { number: outcome.pullRequest.number, url: outcome.pullRequest.url, branch: outcome.pullRequest.head, state: outcome.pullRequest.state }, next_human_action: "Merge or resolve the pending state PR." };
  if (outcome.kind === "proposed" || outcome.kind === "reused") return { ...report, status: "proposed", state_pr: { number: outcome.pullRequest.number, url: outcome.pullRequest.url, branch: outcome.branch, state: outcome.pullRequest.state } };
  return { ...report, status: outcome.kind === "merged" ? "pending" : "failed_recovery_required", issues: [issue({ code: "state_pr_requires_reconciliation", message: "State PR authority changed while proposing" })] };
}

export class PumpCoordinator {
  constructor(private readonly dependencies: PumpDependencies) {}
  run(request: unknown, signal?: AbortSignal): Promise<PumpReport> { return runPump(request, this.dependencies, signal); }
}
