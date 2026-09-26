import { lstat, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import type { BoardSnapshot as RepositorySnapshot, CardRecord } from "../board/repository.ts";
import type { Config, PRRecord } from "../board/schemas.ts";
import { parseRequirements } from "../board/requirements.ts";
import { validateBoardSemantics } from "../board/semantic-validation.ts";
import type { ProducerResult, CheckerResult, ReviewerResult, SplitDecisionResult, ProbeResult } from "../board/result-schemas.ts";
import { validateProducerResult, validateCheckerResult, validateReviewerResult, validateSplitDecisionResult, validateProbeResult } from "../board/result-schemas.ts";
import { runtimeId, isObjectId } from "../engine/ids.ts";
import type { ScheduledCard } from "../engine/scheduler.ts";
import type { PumpDependencies, PumpPhaseResult, PumpPreflightResult, PumpReconciliation } from "../engine/pump.ts";
import { planLifecycleTransition, type TransitionEvent, type TransitionMetadata } from "./effects.ts";
import { validateDesignProducerResult, validateDesignCheckerResult, validateDesignDocument, designBranch, designCommitTrailers, designMarker, designPrBody, type DesignPath } from "./design.ts";
import { validateSplitScope, allocateSplit } from "./split.ts";
import { validateImplementationProducerResult, productCommitTrailers, validateImplementationDiff, productBranch } from "./implementation.ts";
import { aggregateReviewPanel } from "./review.ts";
import { productPullRequestBody, validateProductPullRequestBody, verifyShipEvidence, productPrTitle, type ProductDiffEntry } from "./ship.ts";
import { DESIGN_CRITERION_KEYS, SHIP_CRITERION_KEYS, validateConfiguredLenses, type ReviewLens } from "./criteria.ts";
import { appendArtifactPaths, allocateFindingIds, renderLifecycleArtifact, type FindingAllocation } from "./artifacts.ts";
import { renderBoard } from "../engine/render.ts";
import { renderCardDocument } from "../requirements/render.ts";
import { ManagedWorktreeManager, type ManagedWorktree } from "../git/worktrees.ts";
import { GitAdapter } from "../state-pr/git.ts";
import { discoverManagedPullRequests, findUniqueManagedPullRequest, type GitHubAdapter, type GitHubPullRequest, type GitHubCheck, type GitHubReview } from "../state-pr/github.ts";
import { parsePullRequestMarker, serializePullRequestMarker } from "../state-pr/markers.ts";
import type { StateMutation, StateMutationContext } from "../state-pr/transaction.ts";
import { discoverAgents, assertAgentAvailable, type AgentDiscoveryResult, type OverrideReportEntry } from "../agents/discover.ts";
import { verifyPersistedTrust, type PersistedTrustReader } from "../agents/trust.ts";
import { resolveDispatchModel, type ModelResolver, type ParentModel, type ResolvedModel } from "../agents/models.ts";
import { policyForAgent, type RolePolicy } from "../agents/policy.ts";
import { assembleSystemPrompt } from "../agents/prompts.ts";
import { createDispatchPlan, executeDispatch, executeParallelStrict, type DispatchPlan, type DispatchSuccess, type StrictDispatchTask } from "../agents/runner.ts";
import { materializeSnapshot, type Snapshot } from "../agents/snapshots.ts";
import { buildChildAttestation, type ExecutionIdentity } from "../agents/attestation.ts";
import { renderArtifact } from "../agents/artifacts.ts";
import { runProjectCommand, classifyProjectCommand, boundedRedacted, PROJECT_COMMAND_ORDER, type ProjectCommandObservation } from "../agents/project-command.ts";
import { resolvePackageAsset, packageRoot } from "../paths.ts";
import { StateTransactionError } from "../state-pr/transaction.ts";

export interface LifecycleCoordinatorDependencies {
  readonly root: string;
  readonly repositoryId: string;
  readonly packageVersion: string;
  readonly parentModel?: ParentModel;
  readonly modelResolver?: ModelResolver;
  readonly trustReader?: PersistedTrustReader;
  readonly git: GitAdapter;
  readonly github: GitHubAdapter;
  readonly discover?: typeof discoverAgents;
  readonly createPlan?: typeof createDispatchPlan;
  readonly execute?: typeof executeDispatch;
  readonly snapshotter?: typeof materializeSnapshot;
  readonly now?: () => Date;
}

interface ChildAttempt {
  readonly plan: DispatchPlan;
  readonly success: DispatchSuccess;
  readonly identity: ExecutionIdentity;
}
interface DurableArtifact { readonly path: string; readonly bytes: string; readonly findingIds: readonly string[]; readonly payload?: ProbeResult }
interface ParentProbeInput { readonly cardId: string; readonly probe: ProbeResult["probe"]; readonly observations: readonly { key: string; status: "pass" | "fail" | "unknown"; detail: string }[]; readonly commit: string; readonly branch: string | null; readonly summary: string }
interface PreparedCandidate {
  readonly mutation: StateMutation;
  readonly artifacts: readonly DurableArtifact[];
  readonly artifactPaths: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly boundary?: PumpPhaseResult["boundary"];
}

function stable(value: unknown): string { return JSON.stringify(value); }
function yaml(value: unknown): string { return stringify(value, { lineWidth: 0, sortMapEntries: false }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n"); }
function nowIso(now: () => Date): string { return now().toISOString(); }
function bounded(value: string, max = 3900): string { const text = value.replace(/[\r\n]+/g, " "); return [...text].length <= max ? text : `${[...text].slice(0, max - 14).join("")}...[truncated]`; }
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:^|[\s(=])\/(?!\/)[^\s,;)]*/g, "$1<path>").replace(/[A-Za-z]:\\[^\s,;)]*/g, "<path>").slice(0, 2000);
}
function checkStatus(check: { status?: unknown; conclusion?: unknown }): "pass" | "fail" | "unknown" {
  const status = String(check.status ?? "").toLowerCase();
  const conclusion = String(check.conclusion ?? "").toLowerCase();
  if (["queued", "requested", "waiting", "in_progress", "pending"].includes(status)) return "unknown";
  if (["success", "neutral", "skipped"].includes(conclusion)) return "pass";
  if (conclusion === "failure") return "fail";
  return "unknown";
}
function recordIssue(code: string, message: string, evidence: readonly string[] = []) { return { code, message: message.slice(0, 2000), evidence: [...evidence] }; }
function cardRecord(snapshot: RepositorySnapshot, id: string): CardRecord {
  const card = snapshot.cards.find((candidate) => candidate.id === id);
  if (!card) throw new Error(`Card ${id} is not present in the authoritative snapshot`);
  return card;
}
function asPrRecord(pr: GitHubPullRequest, operationId: string, at: string): PRRecord {
  return { number: pr.number, url: pr.url, head: pr.head, base: "main", state: pr.state, operation_id: operationId, head_commit: pr.head_commit, merge_commit: pr.merge_commit, last_checked_at: at };
}
function actionForPath(path: string, planned: ReadonlyMap<string, "create" | "modify" | "delete">): "create" | "modify" | "delete" {
  const action = planned.get(path);
  if (!action) throw new Error(`Path ${path} is outside the approved product design`);
  return action;
}
function cardFingerprint(snapshot: RepositorySnapshot): string {
  return stable({ board: snapshot.board, config: snapshot.config, cards: snapshot.cards, requirements: snapshot.requirements, findingIds: snapshot.findingIds ?? [] });
}
function cardArtifactPaths(value: DurableArtifact[]): readonly string[] { return Object.freeze(value.map((artifact) => artifact.path)); }
function mergeArtifacts(...groups: readonly DurableArtifact[][]): readonly DurableArtifact[] { return Object.freeze(groups.flat()); }
function commandMap(config: Config): Record<string, { executable: string; argv: string[] }> {
  const result: Record<string, { executable: string; argv: string[] }> = {};
  for (const [name, argv] of Object.entries(config.project_commands)) if (argv) result[name] = { executable: argv[0]!, argv: [...argv.slice(1)] };
  return result;
}
function commandObject(config: Config): Partial<Record<(typeof PROJECT_COMMAND_ORDER)[number], { executable: string; argv: readonly string[] }>> {
  const result: Partial<Record<(typeof PROJECT_COMMAND_ORDER)[number], { executable: string; argv: readonly string[] }>> = {};
  for (const key of PROJECT_COMMAND_ORDER) { const argv = config.project_commands[key]; if (argv) result[key] = { executable: argv[0]!, argv: argv.slice(1) }; }
  return result;
}
function designPathsFromDocument(content: string): readonly DesignPath[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const heading = lines.indexOf("## Planned paths");
  if (heading < 0) throw new Error("Approved design has no Planned paths section");
  const result: DesignPath[] = [];
  for (let index = heading + 1; index < lines.length && !/^## /.test(lines[index]!); index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const match = /^[-*]\s+([^|]+?)\s*\|\s*(create|modify|delete)\s*\|\s*(TASK-[A-Z0-9][A-Z0-9_-]*)\s*$/.exec(line);
    if (!match) throw new Error(`Invalid approved design path line: ${line}`);
    result.push({ path: match[1]!.trim(), action: match[2]! as DesignPath["action"] });
  }
  if (result.length === 0) throw new Error("Approved design has no product paths");
  return Object.freeze(result);
}
function relativePath(root: string, path: string): string { return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path; }
function sameProductDiff(left: readonly ProductDiffEntry[], right: readonly ProductDiffEntry[]): boolean {
  const normalize = (entries: readonly ProductDiffEntry[]) => entries.map((entry) => `${entry.action}:${entry.path}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
/** Select one current external PR while retaining merged/closed PRs as history. */
function activeManagedPr<T extends { pullRequest: GitHubPullRequest }>(facts: readonly T[], recordedNumber?: number): T | undefined {
  const open = facts.filter((fact) => fact.pullRequest.state === "open");
  if (open.length > 1) throw new Error("multiple managed open PRs are ambiguous");
  if (open[0]) return open[0];
  if (recordedNumber !== undefined) return facts.find((fact) => fact.pullRequest.number === recordedNumber);
  return facts.at(-1);
}

/**
 * Parent-owned Stage 4 lifecycle coordinator.  Child results are evidence only;
 * all branch, command, GitHub, artifact, ID, and state operations remain here.
 */
export class OneCardLifecycleCoordinator {
  private readonly discover: typeof discoverAgents;
  private readonly createPlan: typeof createDispatchPlan;
  private readonly execute: typeof executeDispatch;
  private readonly snapshotter: typeof materializeSnapshot;
  private readonly now: () => Date;
  private discovery: AgentDiscoveryResult | undefined;
  private models = new Map<string, ResolvedModel>();
  private protocol: string | undefined;
  private packageRootPath = process.cwd();
  private externalActionStarted = false;

  constructor(private readonly dependencies: LifecycleCoordinatorDependencies) {
    this.discover = dependencies.discover ?? discoverAgents;
    this.createPlan = dependencies.createPlan ?? createDispatchPlan;
    this.execute = dependencies.execute ?? executeDispatch;
    this.snapshotter = dependencies.snapshotter ?? materializeSnapshot;
    this.now = dependencies.now ?? (() => new Date());
  }

  async preflight(): Promise<PumpPreflightResult> {
    if (!this.dependencies.parentModel) return { kind: "failed", issues: [recordIssue("parent_model_unavailable", "The active Pi execution context did not provide a parent model; lifecycle dispatch cannot start.")] };
    if (!this.dependencies.modelResolver) return { kind: "failed", issues: [recordIssue("model_registry_unavailable", "The active Pi execution context did not provide a model registry resolver.")] };
    try {
      const board = await (await import("../board/repository.ts")).readBoardRepository(this.dependencies.root);
      validateConfiguredLenses(board.config.review.lenses);
      if (board.board.project.repository_id !== this.dependencies.repositoryId) return { kind: "blocked", blockers: [recordIssue("repository_identity_mismatch", `Board identity ${board.board.project.repository_id} does not match ${this.dependencies.repositoryId}.`)] };
      const trust = await verifyPersistedTrust(this.dependencies.root, this.dependencies.root, this.dependencies.trustReader);
      if (!trust.trusted) return { kind: "blocked", blockers: [recordIssue("saved_project_trust_required", `Saved project trust is required before lifecycle dispatch (${trust.reason}).`)] };
      const discovery = await this.discover({ cwd: this.dependencies.root, repositoryRoot: this.dependencies.root, overridesEnabled: board.config.agents.allow_project_overrides, trustReader: this.dependencies.trustReader });
      if (!discovery.persistedTrust) return { kind: "blocked", blockers: [recordIssue("saved_project_trust_required", "Saved project trust is required before broad child dispatch.")] };
      this.discovery = discovery;
      const required = ["design-producer", "design-checker", "split-decider", "implementer", "reviewer", "ship-producer", "ship-checker"] as const;
      for (const name of required) assertAgentAvailable(discovery, name);
      const models: Array<{ agent: string; provider: string; model: string; thinking: ParentModel["thinking"] }> = [];
      this.models.clear();
      for (const name of required) {
        const model = await resolveDispatchModel(this.dependencies.parentModel, name, board.config.agent_models.overrides, this.dependencies.modelResolver);
        this.models.set(name, model);
        models.push({ agent: name, provider: model.provider, model: model.id, thinking: model.thinking });
      }
      this.packageRootPath = await packageRoot();
      this.protocol = await readFile(await resolvePackageAsset("templates/agents/child-protocol.md"), "utf8");
      const activeOverrides = discovery.report.active.filter((entry) => entry.source === "project" && entry.sha256).map((entry) => ({ name: entry.name, source: "project" as const, path: entry.path, sha256: entry.sha256! }));
      return { kind: "ready", activeOverrides, models };
    } catch (error) {
      const message = safeError(error);
      const code = /model|authenticated|tool/i.test(message) ? "model_preflight_failed" : /agent|override|asset|trust/i.test(message) ? "policy_preflight_failed" : "lifecycle_preflight_failed";
      return { kind: "failed", issues: [recordIssue(code, message)] };
    }
  }

  async dispatch(input: { operationId: string; selected: ScheduledCard; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpPhaseResult> {
    this.externalActionStarted = false;
    try {
      if (!this.discovery || this.models.size === 0) {
        const readiness = await this.preflight();
        if (readiness.kind !== "ready") return { kind: readiness.kind === "blocked" ? "blocked" : "failure", blockers: readiness.blockers, issues: readiness.issues };
      }
      switch (input.selected.nextAction) {
        case "design": return await this.design(input);
        case "split_decision": return await this.split(input);
        case "implement": return await this.implement(input);
        case "review": return await this.review(input);
        case "ship": return await this.ship(input);
        case "reconcile": return { kind: "wait", boundary: "external_wait", waits: [{ code: "reconciliation_required", message: "Shipping reconciliation must complete before a ship action." }] };
        case "design_review": return { kind: "wait", boundary: "external_wait", waits: [{ code: "design_reconciliation_required", message: "The design PR must be reconciled before another workflow action." }] };
      }
    } catch (error) {
      if (this.externalActionStarted) return { kind: "external", boundary: "external_pr", issues: [recordIssue("lifecycle_external_action_requires_recovery", safeError(error))] };
      return { kind: "failure", issues: [recordIssue("lifecycle_dispatch_failed", safeError(error))] };
    }
  }

  async reconcile(input: { baseCommit: string; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpReconciliation> {
    try {
      await input.heartbeat();
      const managed = await discoverManagedPullRequests(this.dependencies.github, { });
      // State PRs are append-only history on GitHub.  Only an open PR or a
      // closed-unmerged PR is an outstanding authority conflict; treating all
      // historical merged state PRs as a duplicate would make the second pump
      // fail forever after the first transaction merged.
      const state = managed.filter(({ marker }) => marker.kind === "state");
      const openStates = state.filter(({ pullRequest }) => pullRequest.state === "open");
      if (openStates.length > 1) return { kind: "unresolved", reason: "Multiple managed open state PRs are ambiguous." };
      if (openStates[0]) return { kind: "pending", reason: `State PR #${openStates[0].pullRequest.number} is pending.` };
      const closedState = state.find(({ pullRequest }) => pullRequest.state === "closed");
      if (closedState) return { kind: "unresolved", reason: `State PR #${closedState.pullRequest.number} is closed without an explicit resolution.` };
      for (const { pullRequest } of state) {
        if (pullRequest.state !== "merged" || !pullRequest.merge_commit || !(await this.dependencies.git.isAncestor(pullRequest.merge_commit, input.baseCommit, this.dependencies.root))) {
          return { kind: "unresolved", reason: "Merged state PR is not reachable from fresh origin/main." };
        }
      }
      const designFacts = managed.filter(({ marker }) => marker.kind === "design");
      const productFacts = managed.filter(({ marker }) => marker.kind === "product");
      const effects: Array<{ cardId: string; result: PumpReconciliation }> = [];
      for (const rawCard of input.board.cards) {
        const card = rawCard as any;
        await input.heartbeat();
        const design = designFacts.filter(({ marker }) => marker.card_ids.length === 1 && marker.card_ids[0] === card.id);
        if (design.length > 1) return { kind: "blocked", blockers: [recordIssue("duplicate_design_pr", `Multiple managed design PRs exist for ${card.id}.`)] };
        if (design[0] && ["design_review", "backlog", "designing"].includes(card.status)) {
          if (!card.workflow.design.pr) return { kind: "blocked", blockers: [recordIssue("design_orphan_requires_recovery", `A marked design PR exists for ${card.id} without authoritative card metadata.`)] };
          const pr = asPrRecord(design[0].pullRequest, design[0].marker.operation_id, this.now().toISOString());
          const diff = await this.dependencies.git.diffNameStatus(input.baseCommit, pr.head_commit, this.dependencies.root).catch(() => []);
          const outcome = await (await import("../reconciliation/design.ts")).reconcileDesign({ card, board: input.board as any, pullRequest: pr, freshMainCommit: input.baseCommit, diff, expectedDesignPath: `docs/designs/${card.id}.md`, isReachableFromMain: (merge, main) => this.dependencies.git.isAncestor(merge, main, this.dependencies.root), designLimit: input.board.config.rework.design_limit, transition: { metadata: { at: this.now().toISOString(), operationId: runtimeId("KFOP", this.now()), transactionId: runtimeId("KFTX", this.now()), historyId: runtimeId("KFH", this.now()) }, implementationLimit: input.board.config.rework.implementation_limit } as any });
          if (outcome.kind === "wait") effects.push({ cardId: card.id, result: { kind: "wait", waits: [{ code: "design_pr_open", message: outcome.reason ?? "Design PR is open." }] } });
          else if (outcome.kind === "merged" || outcome.kind === "recovery_adoption" || outcome.kind === "closed_retry" || outcome.kind === "closed_blocked") {
            const event = outcome.kind === "merged" ? { kind: "design_merged", evidence: { pr, approvedCommit: pr.head_commit } } as TransitionEvent : outcome.kind === "recovery_adoption" ? { kind: "recovery_design_merged", evidence: { pr, approvedCommit: pr.head_commit } } as TransitionEvent : outcome.kind === "closed_retry" || outcome.kind === "closed_blocked" ? { kind: "design_closed", evidence: outcome.evidence } as TransitionEvent : undefined;
            if (event) effects.push({ cardId: card.id, result: this.reconciliationMutation(input.board, card, event, outcome.kind === "closed_retry" ? "designing" : outcome.kind === "merged" || outcome.kind === "recovery_adoption" ? "ready_for_implementation" : "design_review") });
          } else effects.push({ cardId: card.id, result: { kind: "blocked", blockers: [recordIssue("design_reconciliation_blocked", outcome.reason ?? "Design PR evidence is ambiguous.", outcome.evidence)] } });
        }
        const products = productFacts.filter(({ marker }) => marker.card_ids.length === 1 && marker.card_ids[0] === card.id);
        if (products.length > 1) return { kind: "blocked", blockers: [recordIssue("duplicate_product_pr", `Multiple managed product PRs exist for ${card.id}.`)] };
        if (products[0] && (card.status === "shipping" || card.status === "ready_to_ship")) {
          if (!card.workflow.implementation.branch || !card.workflow.review.reviewed_commit) return { kind: "blocked", blockers: [recordIssue("product_orphan_requires_recovery", `A marked product PR exists for ${card.id} without complete authoritative implementation metadata.`)] };
          const discoveredPr = products[0].pullRequest;
          const exactOpenRecovery = card.status === "ready_to_ship" && discoveredPr.state === "open" && discoveredPr.head === card.workflow.implementation.branch && discoveredPr.head_commit === card.workflow.review.reviewed_commit && discoveredPr.base === "main";
          if (exactOpenRecovery) continue;
          if (card.status === "shipping" && !card.workflow.ship.product_pr) return { kind: "blocked", blockers: [recordIssue("product_orphan_requires_recovery", `A marked product PR exists for ${card.id} without authoritative shipping metadata.`)] };
          const pr = asPrRecord(discoveredPr, products[0].marker.operation_id, this.now().toISOString());
          await input.heartbeat();
          const checks = await this.readChecks(products[0].pullRequest.number);
          const reviews = await this.readReviews(products[0].pullRequest.number);
          const mergedProof = await this.productMergeProof(card, pr, input.baseCommit);
          const checkProbe = this.parentProbe({ cardId: card.id, probe: "ci_status", commit: pr.head_commit, branch: pr.head, summary: "Parent observed the provider check rollup for the marked product PR.", observations: checks.map((check: any) => ({ key: String(check.name), status: checkStatus(check), detail: boundedRedacted(JSON.stringify(check)) })) });
          const prProbe = this.parentProbe({ cardId: card.id, probe: "pr_state", commit: pr.head_commit, branch: pr.head, summary: "Parent observed the marked product PR identity and review state.", observations: [{ key: "product-pr", status: "pass", detail: boundedRedacted(JSON.stringify({ number: pr.number, state: pr.state, base: pr.base, head: pr.head, head_commit: pr.head_commit, merge_commit: pr.merge_commit })) }, ...reviews.map((review: any, index: number) => ({ key: `review:${String(review.reviewer)}:${index}`, status: "pass" as const, detail: boundedRedacted(JSON.stringify(review)) }))] });
          const reconciliationArtifacts = [checkProbe, prProbe];
          const verificationResultPaths = reconciliationArtifacts.map((artifact) => artifact.path);
          const reconciliationMetadata: TransitionMetadata = { at: this.now().toISOString(), operationId: runtimeId("KFOP", this.now()), transactionId: runtimeId("KFTX", this.now()), historyId: runtimeId("KFH", this.now()) };
          const outcome = (await import("../engine/reconcile.ts")).reconcileProduct({ board: input.board as any, card, pullRequest: pr, checks, reviews, freshMainCommit: input.baseCommit, mergeReachable: mergedProof.reachable, reviewedTreeCompatible: mergedProof.treeCompatible, includedReviewedHead: mergedProof.included, implementationLimit: input.board.config.rework.implementation_limit, verificationResultPaths, metadata: reconciliationMetadata });
          if (outcome.kind === "wait") effects.push({ cardId: card.id, result: { kind: "wait", waits: [{ code: "product_external_wait", message: outcome.reason ?? "Product PR is awaiting external authority." }] } });
          else if (outcome.transition && ["merged", "code_failure", "reconciled", "recovery_adoption"].includes(outcome.kind)) {
            const event: TransitionEvent = outcome.kind === "merged" ? { kind: "product_merged", pr, mergeCommit: pr.merge_commit!, deliveredAt: this.now().toISOString() } : outcome.kind === "recovery_adoption" ? { kind: "recovery_product_merged", pr: { ...pr, operation_id: reconciliationMetadata.operationId }, mergeCommit: pr.merge_commit!, deliveredAt: this.now().toISOString(), evidence: verificationResultPaths } : outcome.kind === "code_failure" ? { kind: "shipping_code_failure", evidence: [...card.workflow.ship.verification_result_paths, ...verificationResultPaths] } : { kind: "shipping_reconciled", evidence: { pr, verificationResultPaths } };
            const recoveryEvent = outcome.kind === "recovery_adoption" ? (context: StateMutationContext): TransitionEvent => ({ ...event, pr: { ...pr, operation_id: context.operationId } } as TransitionEvent) : event;
            effects.push({ cardId: card.id, result: this.reconciliationMutation(input.board, card, recoveryEvent, outcome.kind === "merged" || outcome.kind === "recovery_adoption" ? "done" : outcome.kind === "code_failure" ? "implementing" : "shipping", reconciliationArtifacts) });
          } else if (outcome.kind === "blocked") effects.push({ cardId: card.id, result: { kind: "blocked", blockers: [recordIssue("product_reconciliation_blocked", outcome.reason ?? "Product PR evidence is inconclusive.", card.workflow.ship.verification_result_paths)] } });
          else if (outcome.kind === "ambiguous") effects.push({ cardId: card.id, result: { kind: "blocked", blockers: [recordIssue("product_reconciliation_ambiguous", outcome.reason ?? "Product PR identity is ambiguous.", card.workflow.ship.verification_result_paths)] } });
        }
      }
      const actionable = effects.filter(({ result }) => result.kind !== "wait");
      if (actionable.length > 1) return { kind: "blocked", blockers: [recordIssue("ambiguous_reconciliation", "More than one independent card reconciliation effect is ready; no one-card mutation was selected.")] };
      if (actionable.length === 1) return actionable[0]!.result;
      const waits = effects.filter(({ result }) => result.kind === "wait").map(({ result }) => result.waits ?? []).flat();
      return waits.length > 0 ? { kind: "wait", waits } : { kind: "none" };
    } catch (error) {
      const message = safeError(error);
      if (/gh command failed|network|timed out|timeout|rate limit|ECONN|fetch/i.test(message)) return { kind: "wait", waits: [{ code: "github_unavailable", message: "GitHub authority could not be queried; retry reconciliation without inferring external state." }] };
      return { kind: "blocked", blockers: [recordIssue("reconciliation_failed", message)] };
    }
  }

  private reconciliationMutation(board: RepositorySnapshot, card: CardRecord, event: TransitionEvent | ((context: StateMutationContext) => TransitionEvent), to: string, artifacts: readonly DurableArtifact[] = []): PumpReconciliation {
    const mutation = this.makeMutation(board, [card.id], (_authoritative, context) => typeof event === "function" ? event(context) : event, artifacts);
    return { kind: "mutation", cardId: card.id, from: card.status, to, mutation, artifacts: cardArtifactPaths([...artifacts]) };
  }

  private async readChecks(number: number): Promise<readonly any[]> {
    if (!this.dependencies.github.getChecks) return [{ name: "provider", conclusion: "unknown", status: "unknown", required: true }];
    return this.dependencies.github.getChecks(number);
  }
  private async readReviews(number: number): Promise<readonly any[]> {
    if (!this.dependencies.github.getReviews) return [];
    return (await this.dependencies.github.getReviews(number)).map((review) => ({ reviewer: review.reviewer, state: review.state, submittedAt: review.submitted_at }));
  }
  private async productMergeProof(card: CardRecord, pr: PRRecord, base: string): Promise<{ reachable: boolean; treeCompatible: boolean; included: boolean }> {
    const reviewedCommit = (card as any).workflow.review.reviewed_commit as string | null;
    if (pr.state !== "merged" || !pr.merge_commit || !reviewedCommit) return { reachable: false, treeCompatible: false, included: false };
    const reachable = await this.dependencies.git.isAncestor(pr.merge_commit, base, this.dependencies.root);
    if (!reachable) return { reachable: false, treeCompatible: false, included: false };
    const reviewed = await this.dependencies.git.diffNameOnly(base, reviewedCommit, this.dependencies.root).catch(() => []);
    const merged = await this.dependencies.git.diffNameOnly(base, pr.merge_commit, this.dependencies.root).catch(() => []);
    const treeCompatible = !merged.some((path) => path === "docs/spec.md" || path.startsWith("docs/cards/") || path.startsWith("docs/designs/"));
    const included = (await this.dependencies.git.isAncestor(reviewedCommit, pr.merge_commit, this.dependencies.root)) || JSON.stringify([...reviewed].sort()) === JSON.stringify([...merged].sort());
    return { reachable, treeCompatible, included };
  }

  private async design(input: { operationId: string; selected: ScheduledCard; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpPhaseResult> {
    const card = cardRecord(input.board, input.selected.card.id) as any;
    const branch = designBranch(card.id, card.title);
    const manager = new ManagedWorktreeManager(this.dependencies.git, this.dependencies.root, this.dependencies.repositoryId);
    await input.heartbeat();
    const worktree = await manager.ensure({ repositoryId: this.dependencies.repositoryId, kind: "design", cardId: card.id, branch }, await this.dependencies.git.resolveRef("origin/main", this.dependencies.root), { expectedHead: card.workflow.design.pr?.head_commit ?? undefined, allowCommittedHistory: Boolean(card.workflow.design.pr) });
    const base = await this.dependencies.git.resolveRef("origin/main", this.dependencies.root);
    const designInputs = stable({ authoritative_base: base, card, requirements: input.board.requirements ?? null, dependents: input.board.cards.filter((candidate) => candidate.dependencies.includes(card.id)), approved_design: card.workflow.design.approved_commit });
    // Never let the design producer inspect the mutable checkout: it is also
    // used for worktree and external-action coordination. Archive the exact
    // authoritative commit and keep that root alive through dispatch.
    const producerSnapshot = await this.snapshotter(this.dependencies.root, base);
    let producer: ChildAttempt;
    try {
      producer = await this.child(input, "design-producer", "producer", producerSnapshot.root, base, null, designInputs, { role: "producer", tool: "submit_producer_result", dispatchId: "pending", cardId: card.id, phase: "design" }, producerSnapshot);
    } finally {
      await producerSnapshot.cleanup();
    }
    const producerPayload = producer.success.runtime.payload as ProducerResult;
    validateProducerResult(producerPayload, { dispatchId: producer.plan.dispatchId, cardId: card.id, phase: "design" });
    let designValidation;
    try { designValidation = validateDesignProducerResult(producerPayload, { cardId: card.id, title: card.title, acceptanceCriteria: card.acceptance_criteria.map((criterion: any) => criterion.id) }); }
    catch (error) { return { kind: "failure", issues: [recordIssue("design_validation_failed", safeError(error))] }; }
    const designPath = `docs/designs/${card.id}.md`;
    await input.heartbeat();
    await this.writeDesignFile(worktree, designPath, designValidation.content);
    const diff = await this.dependencies.git.workingDiffPaths(base, worktree.path);
    if (diff.length !== 1 || diff[0] !== designPath) return { kind: "failure", issues: [recordIssue("design_diff_policy_failed", "Design worktree did not contain exactly the canonical design path.")] };
    const commit = await manager.commitExact({ worktree, paths: new Map([[designPath, card.workflow.design.pr ? "modify" : "create"]]), message: `kanban: design ${card.id}`, trailers: designCommitTrailers(input.operationId, card.id) });
    await input.heartbeat();
    const checkerSnapshot = await this.snapshotter(this.dependencies.root, commit);
    let checker: ChildAttempt;
    try {
      const checkerInputs = stable({ authoritative_base: base, design_commit: commit, card, requirements: input.board.requirements ?? null, planned_paths: designValidation.plannedPaths, criteria: DESIGN_CRITERION_KEYS });
      checker = await this.child(input, "design-checker", "checker", checkerSnapshot.root, commit, branch, checkerInputs, { role: "checker", tool: "submit_checker_result", dispatchId: "pending", cardId: card.id, phase: "design", criteria: DESIGN_CRITERION_KEYS }, checkerSnapshot);
    } finally { await checkerSnapshot.cleanup(); }
    const checkerPayload = checker.success.runtime.payload as CheckerResult;
    validateDesignCheckerResult(checkerPayload, checker.plan.dispatchId, card.id);
    const artifacts = this.finalizeAttempts(input.board, [producer, checker]);
    if (checkerPayload.status !== "pass") {
      const event: TransitionEvent = checkerPayload.status === "fail" ? { kind: "design_changes_requested", evidence: { producerResultPath: artifacts[0]!.path, checkerResultPath: artifacts[1]!.path } } : { kind: "design_blocked", reason: checkerPayload.summary, evidence: [artifacts[1]!.path] };
      const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
      return { kind: "mutation", mutation: candidate, from: card.status, to: checkerPayload.status === "fail" && card.rework.design < input.board.config.rework.design_limit ? "designing" : card.status, artifacts: cardArtifactPaths([...artifacts]), boundary: "state_pr" };
    }
    await input.heartbeat();
    this.externalActionStarted = true;
    await this.dependencies.git.push("origin", branch, worktree.path);
    await this.dependencies.git.fetch("origin", this.dependencies.root);
    const marker = designMarker(input.operationId, card.id);
    const existing = await findUniqueManagedPullRequest(this.dependencies.github, { kind: "design", cardIds: [card.id] });
    let pr: GitHubPullRequest;
    if (existing) {
      if (existing.pullRequest.head !== branch || existing.pullRequest.base !== "main" || existing.pullRequest.head_commit !== commit) throw new Error("Existing design PR does not match the checked commit");
      if (existing.pullRequest.state === "closed") { await input.heartbeat(); this.externalActionStarted = true; await this.dependencies.github.reopenPullRequest(existing.pullRequest.number); }
      pr = (await findUniqueManagedPullRequest(this.dependencies.github, { kind: "design", cardIds: [card.id] }))?.pullRequest ?? existing.pullRequest;
      if (pr.head !== branch || pr.head_commit !== commit || pr.base !== "main") throw new Error("Existing design PR does not match the checked commit");
    } else {
      const body = designPrBody({ cardId: card.id, title: card.title, commit, base: "main", plannedPaths: designValidation.plannedPaths, producerArtifact: artifacts[0]!.path, checkerArtifact: artifacts[1]!.path, operationId: input.operationId });
      this.externalActionStarted = true;
      pr = await this.dependencies.github.createPullRequest({ title: `kanban: design ${card.id} — ${card.title}`, body, head: branch, base: "main" });
      if (pr.head !== branch || pr.head_commit !== commit || pr.base !== "main" || pr.state !== "open") throw new Error("Created design PR identity is invalid");
      const parsed = parsePullRequestMarker(pr.body);
      if (parsed.kind !== marker.kind || parsed.operation_id !== marker.operation_id || parsed.card_ids[0] !== card.id) throw new Error("Created design PR marker is invalid");
    }
    const event: TransitionEvent = { kind: "design_passed", evidence: { branch, producerResultPath: artifacts[0]!.path, checkerResultPath: artifacts[1]!.path, pr: asPrRecord(pr, existing?.marker.operation_id ?? input.operationId, this.now().toISOString()) } };
    const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
    return { kind: "mutation", mutation: candidate, from: card.status, to: "design_review", artifacts: cardArtifactPaths([...artifacts]), externalPrs: [this.reportPr("design", card.id, pr)], boundary: "state_pr" };
  }

  private async split(input: { operationId: string; selected: ScheduledCard; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpPhaseResult> {
    const card = cardRecord(input.board, input.selected.card.id) as any;
    if (card.workflow.split_decision.override) {
      const branch = productBranch(card.id, card.title);
      const manager = new ManagedWorktreeManager(this.dependencies.git, this.dependencies.root, this.dependencies.repositoryId);
      await input.heartbeat();
      await manager.ensure({ repositoryId: this.dependencies.repositoryId, kind: "product", cardId: card.id, branch }, await this.dependencies.git.resolveRef("origin/main", this.dependencies.root), { expectedHead: card.workflow.implementation.head_commit ?? undefined, allowCommittedHistory: Boolean(card.workflow.implementation.head_commit) });
      const event: TransitionEvent = { kind: "split_decided", evidence: { resultPath: card.workflow.split_decision.result_path!, decidedAt: card.workflow.split_decision.decided_at!, decision: "split_required" } };
      const candidate = this.makeMutation(input.board, [card.id], () => event, []);
      return { kind: "mutation", mutation: candidate, from: card.status, to: "implementing", artifacts: [], boundary: "state_pr" };
    }
    const approved = card.workflow.design.approved_commit;
    if (!approved) return { kind: "failure", issues: [recordIssue("approved_design_missing", "A split decision requires an approved design commit.")] };
    await input.heartbeat();
    const snapshot = await this.snapshotter(this.dependencies.root, approved);
    let attempt: ChildAttempt;
    try {
      const inputs = stable({ approved_design_commit: approved, card, requirements: input.board.requirements ?? null, dependents: input.board.cards.filter((candidate) => candidate.dependencies.includes(card.id)), repository_structure: "Inspect the immutable snapshot with the supplied read tools." });
      attempt = await this.child(input, "split-decider", "splitDecision", snapshot.root, approved, null, inputs, { role: "splitDecision", tool: "submit_split_decision", dispatchId: "pending", cardId: card.id }, snapshot);
    } finally { await snapshot.cleanup(); }
    const result = attempt.success.runtime.payload as SplitDecisionResult;
    validateSplitDecisionResult(result, { dispatchId: attempt.plan.dispatchId, cardId: card.id, originalCriteria: card.acceptance_criteria.map((criterion: any) => criterion.id), dependents: input.board.cards.filter((candidate) => candidate.dependencies.includes(card.id)).map((candidate) => candidate.id) });
    validateSplitScope({ card: card as any, board: input.board as any, result });
    const artifacts = this.finalizeAttempts(input.board, [attempt]);
    const path = artifacts[0]!.path;
    if (result.status === "needs_human") {
      const event: TransitionEvent = { kind: "split_needs_human", resultPath: path, decidedAt: this.now().toISOString(), reason: result.rationale, evidence: [path] };
      const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
      return { kind: "mutation", mutation: candidate, from: card.status, to: card.status, artifacts: [path], blockers: [recordIssue("split_needs_human", result.rationale, [path])], boundary: "human_decision" };
    }
    if (result.status === "no_split") {
      const branch = productBranch(card.id, card.title);
      const manager = new ManagedWorktreeManager(this.dependencies.git, this.dependencies.root, this.dependencies.repositoryId);
      await input.heartbeat();
      await manager.ensure({ repositoryId: this.dependencies.repositoryId, kind: "product", cardId: card.id, branch }, await this.dependencies.git.resolveRef("origin/main", this.dependencies.root));
      const event: TransitionEvent = { kind: "split_decided", evidence: { resultPath: path, decidedAt: this.now().toISOString(), decision: "no_split" } };
      const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
      return { kind: "mutation", mutation: candidate, from: card.status, to: "implementing", artifacts: [path], boundary: "state_pr" };
    }
    const previewMetadata: TransitionMetadata = { at: this.now().toISOString(), operationId: input.operationId, transactionId: runtimeId("KFTX", this.now()), historyId: runtimeId("KFH", this.now()) };
    const preview = allocateSplit({ card: card as any, board: input.board as any, result, nextCard: input.board.board.ids.next_card, nextAcceptanceCriterion: input.board.board.ids.next_acceptance_criterion, metadata: previewMetadata });
    const affected = [card.id, ...input.board.cards.filter((candidate) => candidate.dependencies.includes(card.id)).map((candidate) => candidate.id), ...preview.replacementIds].sort();
    const eventFactory = (authoritative: RepositorySnapshot, context: StateMutationContext): TransitionEvent => {
      const baseMeta: TransitionMetadata = { at: context.plannedAt, operationId: context.operationId, transactionId: context.transactionId, historyId: runtimeId("KFH", this.now()), summary: "Card replaced by pre-implementation split decision" };
      const first = allocateSplit({ card: cardRecord(authoritative, card.id) as any, board: authoritative as any, result, nextCard: authoritative.board.ids.next_card, nextAcceptanceCriterion: authoritative.board.ids.next_acceptance_criterion, metadata: baseMeta });
      const ids = Object.fromEntries([card.id, ...first.replacementIds, ...authoritative.cards.filter((candidate) => candidate.dependencies.includes(card.id)).map((candidate) => candidate.id)].map((id) => [id, runtimeId("KFH", this.now())]));
      const allocated = allocateSplit({ card: cardRecord(authoritative, card.id) as any, board: authoritative as any, result, nextCard: authoritative.board.ids.next_card, nextAcceptanceCriterion: authoritative.board.ids.next_acceptance_criterion, metadata: { ...baseMeta, historyIds: ids } as any, historyIds: ids });
      return { kind: "split_decided", evidence: { resultPath: path, decidedAt: baseMeta.at, decision: "split_required", replacementCards: allocated.cards.filter((candidate) => candidate.id !== card.id && candidate.replaces?.includes(card.id)) } };
    };
    const candidate = this.makeMutation(input.board, affected, eventFactory, artifacts, { splitResult: result, selectedCardId: card.id });
    return { kind: "mutation", mutation: candidate, from: card.status, to: "replaced", artifacts: [path], boundary: "state_pr" };
  }

  private async implement(input: { operationId: string; selected: ScheduledCard; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpPhaseResult> {
    const card = cardRecord(input.board, input.selected.card.id) as any;
    const approved = card.workflow.design.approved_commit;
    const branch = card.workflow.implementation.branch ?? productBranch(card.id, card.title);
    if (!approved || !card.workflow.split_decision.result_path) return { kind: "failure", issues: [recordIssue("implementation_precondition_failed", "Implementation requires an approved design and split decision.")] };
    await input.heartbeat();
    const designSnapshot = await this.snapshotter(this.dependencies.root, approved);
    let designContent: string;
    try { designContent = await readFile(join(designSnapshot.root, "docs", "designs", `${card.id}.md`), "utf8"); }
    finally { await designSnapshot.cleanup(); }
    const planned = validateDesignDocument({ cardId: card.id, title: card.title, acceptanceCriteria: card.acceptance_criteria.map((criterion: any) => criterion.id), plannedPaths: designPathsFromDocument(designContent), content: designContent }).plannedPaths;
    const expectedHead = card.workflow.implementation.head_commit ?? undefined;
    const manager = new ManagedWorktreeManager(this.dependencies.git, this.dependencies.root, this.dependencies.repositoryId);
    await input.heartbeat();
    const worktree = await manager.ensure({ repositoryId: this.dependencies.repositoryId, kind: "product", cardId: card.id, branch }, await this.dependencies.git.resolveRef("origin/main", this.dependencies.root), { expectedHead, allowCommittedHistory: Boolean(expectedHead) });
    const planMap = new Map(planned.map((entry) => [entry.path, entry.action]));
    const dispatchInputs = stable({ card, approved_design_commit: approved, design: designContent, planned_paths: planned, branch, product_base: await this.dependencies.git.resolveRef("origin/main", this.dependencies.root), test_first: true });
    const attempt = await this.child(input, "implementer", "producer", worktree.path, expectedHead ?? worktree.base, branch, dispatchInputs, { role: "producer", tool: "submit_producer_result", dispatchId: "pending", cardId: card.id, phase: "implementation" }, undefined, { planned: Object.fromEntries(planMap), commands: commandMap(input.board.config), protectedPrefixes: [".git", "docs/cards", "docs/designs"], timeoutMs: 300_000 });
    const result = attempt.success.runtime.payload as ProducerResult;
    validateImplementationProducerResult(result, { dispatchId: attempt.plan.dispatchId, cardId: card.id });
    const artifacts = this.finalizeAttempts(input.board, [attempt]);
    if (result.status !== "completed") {
      const event: TransitionEvent = { kind: "implementation_blocked", reason: result.summary, evidence: [artifacts[0]!.path] };
      const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
      return { kind: "mutation", mutation: candidate, from: card.status, to: card.status, artifacts: [artifacts[0]!.path], blockers: [recordIssue("implementation_blocked", result.summary, [artifacts[0]!.path])], boundary: "blocker" };
    }
    const actual = await validateImplementationDiff(worktree.path, planMap);
    if (actual.some((path) => actionForPath(path, planMap) !== planMap.get(path))) return { kind: "failure", issues: [recordIssue("implementation_path_policy_failed", "Implementation diff did not match the approved design paths.")] };
    await input.heartbeat();
    const head = await manager.commitExact({ worktree, paths: planMap, message: `kanban: product ${card.id}`, trailers: productCommitTrailers(input.operationId, card.id) });
    if (!isObjectId(head)) return { kind: "failure", issues: [recordIssue("implementation_commit_invalid", "Git did not return a valid implementation commit.")] };
    const event: TransitionEvent = { kind: "implementation_completed", evidence: { resultPath: artifacts[0]!.path, headCommit: head } };
    const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
    return { kind: "mutation", mutation: candidate, from: card.status, to: "implementation_review", artifacts: [artifacts[0]!.path], boundary: "state_pr" };
  }

  private async review(input: { operationId: string; selected: ScheduledCard; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpPhaseResult> {
    const card = cardRecord(input.board, input.selected.card.id) as any;
    const head = card.workflow.implementation.head_commit;
    const branch = card.workflow.implementation.branch;
    if (!head || !branch) return { kind: "failure", issues: [recordIssue("review_precondition_failed", "Review requires an immutable implementation head and product branch.")] };
    const manager = new ManagedWorktreeManager(this.dependencies.git, this.dependencies.root, this.dependencies.repositoryId);
    await input.heartbeat();
    const worktree = await manager.ensure({ repositoryId: this.dependencies.repositoryId, kind: "product", cardId: card.id, branch }, await this.dependencies.git.resolveRef("origin/main", this.dependencies.root), { expectedHead: head, allowCommittedHistory: true });
    const probeRun = runtimeId("KFRUN", this.now());
    const observations: ProjectCommandObservation[] = [];
    let mutationDetected = false;
    const identity = (this.dependencies.git as any).repositoryIdentity as ((cwd: string) => Promise<{ head: string; branch: string | null; refs: string }>) | undefined;
    const commandIdentity = identity ? await identity.call(this.dependencies.git, worktree.path) : { head, branch, refs: "" };
    for (const key of PROJECT_COMMAND_ORDER) {
      const command = input.board.config.project_commands[key];
      if (!command) continue;
      await input.heartbeat();
      const result = await runProjectCommand({ executable: command[0]!, argv: command.slice(1) }, worktree.path, { timeoutMs: 300_000, signal: input.signal });
      const observation = { ...({ key, argv: command, status: classifyProjectCommand(result), detail: boundedRedacted(JSON.stringify({ argv: command, exit_code: result.exitCode, signal: result.signal ?? null, timed_out: result.timedOut, aborted: result.aborted ?? false, output_overflow: result.outputOverflow ?? false, stdout: result.stdout, stderr: result.stderr })) } as any), ...result } as ProjectCommandObservation;
      observations.push(observation);
      const dirty = await this.dependencies.git.workingDiffPaths(head, worktree.path);
      const afterIdentity = identity ? await identity.call(this.dependencies.git, worktree.path) : commandIdentity;
      // A probe is valid only when commands leave the exact reviewed commit,
      // branch identity, and every ref untouched. Working-tree output is not
      // sufficient: commands can move HEAD or refs without a diff.
      if (dirty.length > 0 || afterIdentity.head !== commandIdentity.head || afterIdentity.branch !== commandIdentity.branch || afterIdentity.refs !== commandIdentity.refs) mutationDetected = true;
    }
    const probe = this.parentProbe({ cardId: card.id, probe: "project_commands", observations: observations.map((observation) => ({ key: observation.key, status: mutationDetected ? "unknown" : observation.status, detail: observation.detail })), commit: head, branch, summary: mutationDetected ? "A configured command changed the managed worktree." : `Executed ${observations.length} configured project command(s).`, runId: probeRun });
    await input.heartbeat();
    const snapshot = await this.snapshotter(this.dependencies.root, head);
    const lenses = validateConfiguredLenses(input.board.config.review.lenses);
    const tasks: StrictDispatchTask[] = [];
    const plans: DispatchPlan[] = [];
    let parallel: Awaited<ReturnType<typeof executeParallelStrict>>;
    try {
      for (const lens of lenses) {
        await input.heartbeat();
        const dispatchId = runtimeId("KFRUN", this.now());
        const agent = assertAgentAvailable(this.discovery!, "reviewer");
        const model = this.models.get("reviewer")!;
        const policy = policyForAgent("reviewer");
        const prompt = await assembleSystemPrompt({ repositoryRoot: snapshot.root, protocol: this.protocol!, agent, dispatchInputs: stable({ card, design_commit: card.workflow.design.approved_commit, implementation_commit: head, lens, product_branch: branch, command_probe: probe.payload, planned_paths: "Read the approved design and immutable diff." }) });
        const plan = await this.createPlan({ dispatchId, agent, model, policy, cwd: snapshot.root, systemPrompt: prompt, task: `Review the immutable implementation through the ${lens} lens only. Submit exactly one reviewer result.` });
        plans.push(plan);
        tasks.push({ plan, expectation: { role: "reviewer", tool: "submit_reviewer_result", dispatchId, cardId: card.id, phase: "implementation_review", lens, plannedThinking: model.thinking } });
      }
      parallel = await executeParallelStrict(tasks, input.board.config.review.max_parallel, input.signal, async (plan, expectation, signal) => { await input.heartbeat(); return this.execute(plan, expectation, signal); });
    } finally {
      await snapshot.cleanup();
    }
    const attempts: ChildAttempt[] = [];
    for (const outcome of parallel.outcomes) if (outcome.state === "completed" && outcome.result) attempts.push({ plan: plans[outcome.index]!, success: outcome.result, identity: { kind: "immutable_snapshot", repository_id: this.dependencies.repositoryId, branch, commit: head, snapshotCommit: head } });
    if (parallel.ok && attempts.length === lenses.length) {
      const reviewerResults = attempts.map((attempt) => attempt.success.runtime.payload as ReviewerResult);
      for (let index = 0; index < reviewerResults.length; index += 1) validateReviewerResult(reviewerResults[index]!, { dispatchId: attempts[index]!.plan.dispatchId, cardId: card.id, lens: lenses[index]! });
    }
    const artifacts = this.finalizeAttempts(input.board, attempts);
    const allPaths = [probe.path, ...artifacts.map((artifact) => artifact.path)];
    if (!parallel.ok || attempts.length !== lenses.length) {
      const candidate = this.makeMutation(input.board, [card.id], () => ({ kind: "review_blocked", reason: "One or more configured review lenses failed to produce a valid result.", evidence: allPaths } as TransitionEvent), [probe, ...artifacts]);
      return { kind: "mutation", mutation: candidate, from: card.status, to: card.status, artifacts: allPaths, blockers: [recordIssue("review_panel_inconclusive", "Every configured lens must complete successfully; no partial panel is accepted.", allPaths)], boundary: "blocker" };
    }
    const reviewerResults = attempts.map((attempt) => attempt.success.runtime.payload as ReviewerResult);
    const panel = aggregateReviewPanel({ cardId: card.id, lenses, results: reviewerResults, probe: probe.payload! as ProbeResult, implementationRework: card.rework.implementation, implementationReworkLimit: input.board.config.rework.implementation_limit, dispatchIds: new Map(lenses.map((lens, index) => [lens, attempts[index]!.plan.dispatchId])) });
    const evidence = [probe, ...artifacts];
    if (panel.decision === "rework") {
      const event: TransitionEvent = { kind: "review_changes_requested", evidence: allPaths };
      const candidate = this.makeMutation(input.board, [card.id], () => event, evidence);
      return { kind: "mutation", mutation: candidate, from: card.status, to: "implementing", artifacts: allPaths, boundary: "state_pr" };
    }
    if (panel.decision === "blocked") {
      const event: TransitionEvent = { kind: "review_blocked", reason: panel.reason === "budget_exhausted" ? "Implementation rework budget exhausted." : "Review evidence is inconclusive.", evidence: allPaths };
      const candidate = this.makeMutation(input.board, [card.id], () => event, evidence);
      return { kind: "mutation", mutation: candidate, from: card.status, to: card.status, artifacts: allPaths, blockers: [recordIssue("review_blocked", event.reason, allPaths)], boundary: "blocker" };
    }
    const event: TransitionEvent = { kind: "review_passed", evidence: { resultPaths: allPaths, reviewedCommit: head, completedAt: this.now().toISOString() } };
    const candidate = this.makeMutation(input.board, [card.id], () => event, evidence);
    return { kind: "mutation", mutation: candidate, from: card.status, to: "ready_to_ship", artifacts: allPaths, boundary: "state_pr" };
  }

  private async ship(input: { operationId: string; selected: ScheduledCard; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }): Promise<PumpPhaseResult> {
    const card = cardRecord(input.board, input.selected.card.id) as any;
    const head = card.workflow.review.reviewed_commit ?? card.workflow.implementation.head_commit;
    const branch = card.workflow.implementation.branch;
    if (!head || !branch) return { kind: "failure", issues: [recordIssue("ship_precondition_failed", "Shipping requires a reviewed implementation head and product branch.")] };
    const base = await this.dependencies.git.resolveRef("origin/main", this.dependencies.root);
    const manager = new ManagedWorktreeManager(this.dependencies.git, this.dependencies.root, this.dependencies.repositoryId);
    await input.heartbeat();
    const worktree = await manager.ensure({ repositoryId: this.dependencies.repositoryId, kind: "product", cardId: card.id, branch }, base, { expectedHead: head, allowCommittedHistory: true });
    const diff = await this.dependencies.git.diffNameStatus(base, head, this.dependencies.root);
    await input.heartbeat();
    const designSnapshot = card.workflow.design.approved_commit ? await this.snapshotter(this.dependencies.root, card.workflow.design.approved_commit) : undefined;
    let designContent = "";
    if (designSnapshot) {
      try { designContent = await readFile(join(designSnapshot.root, "docs", "designs", `${card.id}.md`), "utf8"); }
      finally { await designSnapshot.cleanup(); }
    }
    let planned: readonly ProductDiffEntry[];
    try {
      planned = validateDesignDocument({ cardId: card.id, title: card.title, acceptanceCriteria: card.acceptance_criteria.map((criterion: any) => criterion.id), plannedPaths: designPathsFromDocument(designContent), content: designContent }).plannedPaths;
    } catch (error) {
      return { kind: "failure", issues: [recordIssue("ship_design_validation_failed", safeError(error))] };
    }
    if (!sameProductDiff(diff, planned)) return { kind: "failure", issues: [recordIssue("ship_diff_policy_failed", "The reviewed product diff does not exactly match the approved design paths.")] };
    await input.heartbeat();
    const producerSnapshot = await this.snapshotter(this.dependencies.root, head);
    let producer: ChildAttempt;
    try {
      producer = await this.child(input, "ship-producer", "producer", producerSnapshot.root, head, branch, stable({ card, approved_design: designContent, reviewed_commit: head, product_diff: diff, review_artifacts: card.workflow.review.result_paths }), { role: "producer", tool: "submit_producer_result", dispatchId: "pending", cardId: card.id, phase: "ship" }, producerSnapshot);
    } finally {
      await producerSnapshot.cleanup();
    }
    const producerPayload = producer.success.runtime.payload as ProducerResult;
    validateProducerResult(producerPayload, { dispatchId: producer.plan.dispatchId, cardId: card.id, phase: "ship" });
    const bodyArtifact = producerPayload.artifacts.find((artifact) => artifact.type === "product_pr_body");
    if (producerPayload.status !== "completed" || !bodyArtifact) {
      const artifacts = this.finalizeAttempts(input.board, [producer]);
      const candidate = this.makeMutation(input.board, [card.id], () => ({ kind: "ready_to_ship_blocked", reason: producerPayload.summary, evidence: [artifacts[0]!.path] } as TransitionEvent), artifacts);
      return { kind: "mutation", mutation: candidate, from: card.status, to: card.status, artifacts: [artifacts[0]!.path], blockers: [recordIssue("ship_producer_blocked", producerPayload.summary, [artifacts[0]!.path])], boundary: "blocker" };
    }
    const sections = [bodyArtifact.content, `Card ${card.id} acceptance criteria: ${card.acceptance_criteria.map((criterion: any) => criterion.id).join(", ")}.`, `Reviewed implementation commit ${head}; product paths are parent-verified.`, `Review evidence: ${card.workflow.review.result_paths.join(", ") || "none"}.`, "Human merge is required; no operation approves or merges this product PR."];
    const body = productPullRequestBody({ cardId: card.id, title: card.title, operationId: card.workflow.ship.product_pr?.operation_id ?? input.operationId, branch, reviewedCommit: head, summary: sections[0]!, scopeAndAcceptance: sections[1]!, verification: sections[2]!, review: sections[3]!, mergeBoundary: sections[4]! });
    validateProductPullRequestBody(body, { cardId: card.id, operationId: card.workflow.ship.product_pr?.operation_id ?? input.operationId });
    await input.heartbeat();
    const existing = await findUniqueManagedPullRequest(this.dependencies.github, { kind: "product", cardIds: [card.id] });
    let pr: GitHubPullRequest;
    if (existing) {
      pr = existing.pullRequest;
      if (pr.state !== "open" || pr.head !== branch || pr.head_commit !== head || pr.base !== "main") throw new Error("Existing product PR does not match reviewed implementation identity");
      validateProductPullRequestBody(pr.body, { cardId: card.id, operationId: existing.marker.operation_id });
      if (pr.title !== productPrTitle(card.id, card.title)) throw new Error("Existing product PR title does not match the canonical identity");
    } else {
      if (!(await this.dependencies.git.remoteBranchExists(branch, "origin", this.dependencies.root))) { this.externalActionStarted = true; await this.dependencies.git.push("origin", branch, worktree.path); }
      await this.dependencies.git.fetch("origin", this.dependencies.root);
      const afterPush = await this.dependencies.git.resolveRef(`refs/remotes/origin/${branch}`, this.dependencies.root);
      if (afterPush !== head) throw new Error("Product branch head changed during push");
      this.externalActionStarted = true;
      pr = await this.dependencies.github.createPullRequest({ title: productPrTitle(card.id, card.title), body, head: branch, base: "main" });
      if (pr.state !== "open" || pr.head !== branch || pr.head_commit !== head || pr.base !== "main") throw new Error("Created product PR identity is invalid");
      const marker = parsePullRequestMarker(pr.body);
      if (marker.kind !== "product" || marker.card_ids[0] !== card.id) throw new Error("Created product PR marker is invalid");
    }
    const probeDiff = this.parentProbe({ cardId: card.id, probe: "diff_policy", commit: head, branch, summary: "Parent verified the exact product diff against the approved design paths.", observations: diff.map((entry) => ({ key: entry.path, status: "pass", detail: JSON.stringify(entry) })) });
    const probePr = this.parentProbe({ cardId: card.id, probe: "pr_state", commit: head, branch, summary: "Parent verified the marked product PR identity.", observations: [{ key: "product-pr", status: "pass", detail: JSON.stringify({ number: pr.number, base: pr.base, head: pr.head, head_commit: pr.head_commit }) }] });
    await input.heartbeat();
    const checkerSnapshot = await this.snapshotter(this.dependencies.root, head);
    let checker: ChildAttempt;
    try {
      checker = await this.child(input, "ship-checker", "checker", checkerSnapshot.root, head, branch, stable({ card, product_pr: pr, body, product_diff: diff, criteria: SHIP_CRITERION_KEYS, checks: await this.readChecks(pr.number) }), { role: "checker", tool: "submit_checker_result", dispatchId: "pending", cardId: card.id, phase: "ship", criteria: SHIP_CRITERION_KEYS }, checkerSnapshot);
    } finally { await checkerSnapshot.cleanup(); }
    const checkerPayload = checker.success.runtime.payload as CheckerResult;
    validateCheckerResult(checkerPayload, { dispatchId: checker.plan.dispatchId, cardId: card.id, phase: "ship", criteria: SHIP_CRITERION_KEYS });
    const childArtifacts = this.finalizeAttempts(input.board, [producer, checker]);
    const artifacts = mergeArtifacts([probeDiff, probePr], childArtifacts);
    const verification = verifyShipEvidence({ repository: this.dependencies.repositoryId, cardId: card.id, base: "main", branch, reviewedCommit: head, pr, marker: parsePullRequestMarker(pr.body), diff, planned, requiredChecks: await this.readChecks(pr.number) });
    if (checkerPayload.status !== "pass" || verification.failures.length > 0 || verification.inconclusive) {
      if (verification.pending && checkerPayload.status === "pass" && verification.failures.length === 0 && !verification.inconclusive) {
        // Pending checks are a normal shipping boundary; the product PR is
        // recorded and later reconciliation owns the wait.
      } else {
        const evidence = { pr: asPrRecord(pr, existing?.marker.operation_id ?? input.operationId, this.now().toISOString()), verificationResultPaths: artifacts.map((artifact) => artifact.path) };
        const candidate = this.makeMutation(input.board, [card.id], () => card.status === "ready_to_ship" ? ({ kind: "product_pr_opened_blocked", reason: checkerPayload.summary || verification.failures.join("; ") || "Ship evidence is inconclusive.", evidence } as TransitionEvent) : ({ kind: "shipping_blocked", reason: checkerPayload.summary || verification.failures.join("; ") || "Ship evidence is inconclusive.", evidence: artifacts.map((artifact) => artifact.path) } as TransitionEvent), artifacts);
        return { kind: "mutation", mutation: candidate, from: card.status, to: card.status, artifacts: cardArtifactPaths([...artifacts]), blockers: [recordIssue("ship_check_failed", checkerPayload.summary, artifacts.map((artifact) => artifact.path))], boundary: "blocker", externalPrs: [this.reportPr("product", card.id, pr)] };
      }
    }
    const eventOperationId = card.status === "shipping" ? existing?.marker.operation_id ?? input.operationId : input.operationId;
    const event: TransitionEvent = { kind: card.status === "shipping" ? "shipping_reconciled" : "product_pr_opened", evidence: { pr: asPrRecord(pr, eventOperationId, this.now().toISOString()), verificationResultPaths: artifacts.map((artifact) => artifact.path) } };
    const candidate = this.makeMutation(input.board, [card.id], () => event, artifacts);
    return { kind: "mutation", mutation: candidate, from: card.status, to: "shipping", artifacts: cardArtifactPaths([...artifacts]), externalPrs: [this.reportPr("product", card.id, pr)], boundary: "state_pr" };
  }

  private reportPr(kind: "design" | "product", cardId: string, pr: GitHubPullRequest) {
    return { kind, card_id: cardId, number: pr.number, url: pr.url, state: pr.state, head: pr.head, head_commit: pr.head_commit, merge_commit: pr.merge_commit } as any;
  }

  private async writeDesignFile(worktree: ManagedWorktree, path: string, content: string): Promise<void> {
    const target = join(worktree.path, path);
    const info = await lstat(target).catch(() => undefined);
    if (info && (info.isSymbolicLink() || !info.isFile())) throw new Error("Design destination is not a regular file");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  }

  private async child(input: { operationId: string; board: RepositorySnapshot; signal: AbortSignal; heartbeat: () => Promise<void> }, agentName: any, role: any, cwd: string, commit: string, branch: string | null, dispatchInputs: string, expectation: any, snapshot?: Snapshot, broadToolPolicy?: { planned: Record<string, "create" | "modify" | "delete">; commands: Record<string, { executable: string; argv: string[] }>; protectedPrefixes?: string[]; timeoutMs?: number }): Promise<ChildAttempt> {
    await input.heartbeat();
    const agent = assertAgentAvailable(this.discovery!, agentName);
    const model = this.models.get(agentName);
    if (!model) throw new Error(`No resolved model for ${agentName}`);
    const policy = policyForAgent(agentName);
    const prompt = await assembleSystemPrompt({ repositoryRoot: cwd, protocol: this.protocol!, agent, dispatchInputs });
    const dispatchId = runtimeId("KFRUN", this.now());
    const plan = await this.createPlan({ dispatchId, agent, model, policy, cwd, systemPrompt: prompt, task: `Complete the assigned ${agentName} role for this immutable dispatch. Submit exactly one ${policy.resultTool} result.`, broadToolPolicy });
    await input.heartbeat();
    const expected = { ...expectation, dispatchId, plannedThinking: model.thinking };
    const success = await this.execute(plan, expected, input.signal);
    const payload = success.runtime.payload as any;
    if (payload.dispatch_id !== dispatchId) throw new Error(`Child ${agentName} returned a mismatched dispatch ID`);
    return { plan, success, identity: { kind: snapshot ? "immutable_snapshot" : policy.cwdKind === "product_worktree" ? "product_worktree" : "parent", repository_id: this.dependencies.repositoryId, branch, commit, snapshotCommit: snapshot?.commit ?? null } };
  }

  private finalizeAttempts(board: RepositorySnapshot, attempts: readonly ChildAttempt[]): DurableArtifact[] {
    if (attempts.length === 0) return [];
    const allocation: FindingAllocation = allocateFindingIds({ nextFinding: board.board.ids.next_finding, priorFindingIds: board.findingIds ?? [], attempts: attempts.map((attempt) => attempt.success.runtime.payload) });
    const output: DurableArtifact[] = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]!;
      const attestation = buildChildAttestation(attempt.plan, attempt.success, attempt.identity, { roots: { "<PACKAGE_ROOT>": this.packageRootPath, "<REPOSITORY_ROOT>": this.dependencies.root, "<SNAPSHOT_ROOT>": attempt.identity.snapshotCommit ?? "", "<WORKTREE_ROOT>": this.dependencies.root } }, allocation.byAttempt[index]!);
      const rendered = renderLifecycleArtifact(attestation);
      output.push({ path: rendered.path, bytes: rendered.bytes, findingIds: allocation.byAttempt[index]! });
    }
    return output;
  }

  private parentProbe(input: ParentProbeInput & { runId?: string }): DurableArtifact {
    const runId = input.runId ?? runtimeId("KFRUN", this.now());
    const started = this.now().toISOString();
    const statuses = input.observations.map((observation) => observation.status);
    const status: ProbeResult["status"] = statuses.includes("unknown") ? "inconclusive" : statuses.includes("fail") ? "failure" : "success";
    const payload: ProbeResult = { schema_version: 1, dispatch_id: runId, card_id: input.cardId, probe: input.probe, status, summary: bounded(input.summary, 500), observations: input.observations.map((observation) => ({ key: observation.key, status: observation.status, detail: bounded(observation.detail, 3900) })), evidence: [] };
    validateProbeResult(payload, { dispatchId: runId, cardId: input.cardId, probe: input.probe });
    const attestation: Record<string, unknown> = { run_id: runId, dispatch_id: runId, tool: "parent_probe", agent: null, model: null, policy: { name: "parent", tools: [], snapshot_commit: input.commit }, execution_context: { kind: "parent", repository_id: this.dependencies.repositoryId, branch: input.branch, commit: input.commit }, argv: ["parent_probe", input.probe], started_at: started, completed_at: this.now().toISOString(), exit_code: status === "success" ? 0 : -1, stop_reason: "parent", finding_ids: [], payload };
    const rendered = renderLifecycleArtifact(attestation);
    return { path: rendered.path, bytes: rendered.bytes, findingIds: [], payload };
  }

  private makeMutation(board: RepositorySnapshot, cardIds: readonly string[], eventFactory: (authoritative: RepositorySnapshot, context: StateMutationContext) => TransitionEvent, artifacts: readonly DurableArtifact[], options: { splitResult?: SplitDecisionResult; selectedCardId?: string } = {}): StateMutation {
    const expected = cardFingerprint(board);
    const findingNext = board.board.ids.next_finding + artifacts.reduce((count, artifact) => count + artifact.findingIds.length, 0);
    const packageVersion = this.dependencies.packageVersion;
    return { cardIds: [...cardIds].sort(), async apply(authoritative, context) {
      if (cardFingerprint(authoritative) !== expected) throw new StateTransactionError("Authoritative board changed after lifecycle dispatch");
      const event = eventFactory(authoritative, context);
      const selectedId = options.selectedCardId ?? cardIds[0]!;
      const request = { cardId: selectedId, event, metadata: { at: context.plannedAt, operationId: context.operationId, transactionId: context.transactionId, historyId: runtimeId("KFH"), summary: context.operationId }, designLimit: authoritative.config.rework.design_limit, implementationLimit: authoritative.config.rework.implementation_limit } as any;
      const transition = planLifecycleTransition(authoritative as any, request);
      let cards = [...(transition.proposedSnapshot as any).cards] as CardRecord[];
      const nextBoard = structuredClone(authoritative.board) as any;
      nextBoard.last_writer_package_version = packageVersion;
      nextBoard.ids.next_finding = findingNext;
      if (options.splitResult?.status === "split_required") {
        nextBoard.ids.next_card += options.splitResult.replacement_cards.length;
        nextBoard.ids.next_acceptance_criterion += options.splitResult.replacement_cards.reduce((count, replacement) => count + replacement.acceptance_criteria.length, 0);
      }
      const files: Record<string, string> = {};
      const before = new Map(authoritative.cards.map((card) => [card.id, card]));
      for (const card of cards) {
        const previous = before.get(card.id);
        if (!previous || stable(previous) !== stable(card)) files[`docs/cards/${card.id}.md`] = renderCardDocument(card as any, (card as any).why ?? previous?.why ?? "", (card as any).notes ?? previous?.notes ?? "");
      }
      for (const artifact of artifacts) files[artifact.path] = artifact.bytes;
      const dashboard = renderBoard(cards as any);
      if (dashboard !== authoritative.canonicalDashboard) files["docs/cards/BOARD.md"] = dashboard;
      const descriptorPaths = [...new Set([...Object.keys(files), "docs/cards/board.yaml"])].sort();
      nextBoard.state = { last_reconciled_at: context.plannedAt, last_state_transaction: { id: context.transactionId, operation_id: context.operationId, planned_at: context.plannedAt, base_commit: context.baseCommit, card_ids: [...new Set(cardIds)].sort(), paths: descriptorPaths } };
      files["docs/cards/board.yaml"] = yaml(nextBoard);
      const findingIds = [...(authoritative.findingIds ?? []), ...artifacts.flatMap((artifact) => artifact.findingIds)].sort();
      validateBoardSemantics({ board: nextBoard, config: authoritative.config, cards: cards as any, requirements: authoritative.requirements ? parseRequirements(authoritative.requirements) : undefined, findingIds });
      const snapshot: RepositorySnapshot = Object.freeze({ root: authoritative.root, board: nextBoard, config: authoritative.config, cards: Object.freeze(cards), findingIds: Object.freeze(findingIds), requirements: authoritative.requirements, dashboard, canonicalDashboard: dashboard, dashboardDrift: false });
      return { snapshot, files: Object.freeze(files) };
    } };
  }
}

export type LifecyclePumpDependencies = PumpDependencies;
