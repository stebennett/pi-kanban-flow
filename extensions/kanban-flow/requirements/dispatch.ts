import { readFile } from "node:fs/promises";
import { packageRoot, resolvePackageAsset } from "../paths.ts";
import type { BoardSnapshot } from "../board/repository.ts";
import { validateProducerResult, validateCheckerResult, type ProducerResult, type CheckerResult } from "../board/result-schemas.ts";
import { discoverAgents, assertAgentAvailable, type AgentDiscoveryResult } from "../agents/discover.ts";
import { resolveDispatchModel, type ModelResolver, type ParentModel, type ResolvedModel } from "../agents/models.ts";
import { policyForAgent } from "../agents/policy.ts";
import { assembleSystemPrompt } from "../agents/prompts.ts";
import { createDispatchPlan, executeDispatch, type DispatchPlan, type DispatchSuccess } from "../agents/runner.ts";
import { materializeSnapshot, type Snapshot } from "../agents/snapshots.ts";
import { buildChildAttestation, type NormalizationInput } from "../agents/attestation.ts";
import { renderArtifact } from "../agents/artifacts.ts";
import { runtimeId } from "../engine/ids.ts";
import { REQUIREMENTS_CRITERIA } from "./criteria.ts";
import { normalizeRequirementsProposal, type NormalizedRequirementsProposal } from "./proposal.ts";
import { allocateRequirementsProposal, type ProposalAllocation } from "./allocate.ts";
import { planRequirementsImpact, type RequirementsImpactPlan } from "./impact.ts";

export interface RequirementsDispatchInput {
  readonly root: string;
  readonly repositoryId: string;
  readonly baseCommit: string;
  readonly brief: string;
  readonly snapshot: BoardSnapshot;
  readonly operationId: string;
  readonly transactionId: string;
  readonly plannedAt: string;
  readonly parentModel: ParentModel;
  readonly contextPaths?: readonly string[];
  readonly secrets?: readonly string[];
}
export interface RequirementsDispatchArtifact { readonly path: string; readonly bytes: string; readonly attestation: Readonly<Record<string, unknown>> }
export interface RequirementsDispatchChecked {
  readonly kind: "checked";
  readonly proposal: NormalizedRequirementsProposal;
  readonly allocation: ProposalAllocation;
  readonly impact: RequirementsImpactPlan;
  readonly producer: ProducerResult;
  readonly checker: CheckerResult;
  readonly artifacts: readonly RequirementsDispatchArtifact[];
  readonly discovery: AgentDiscoveryResult["report"];
  readonly models: Readonly<{ producer: ResolvedModel; checker: ResolvedModel }>;
}
export type RequirementsDispatchOutcome = RequirementsDispatchChecked | { kind: "revision_required"; stage: "producer" | "checker"; payload: ProducerResult | CheckerResult; discovery: AgentDiscoveryResult["report"]; models: Readonly<{ producer: ResolvedModel; checker: ResolvedModel }> } | { kind: "failed"; error: string };
export interface RequirementsDispatchDependencies {
  readonly modelResolver: ModelResolver;
  readonly discover?: typeof discoverAgents;
  readonly createPlan?: typeof createDispatchPlan;
  readonly execute?: typeof executeDispatch;
  readonly snapshotter?: typeof materializeSnapshot;
  readonly protocol?: string;
  readonly now?: () => Date;
}
function stable(value: unknown): string { return JSON.stringify(value, null, 2); }
function producerStatus(payload: ProducerResult): payload is ProducerResult & { status: "completed" } { return payload.status === "completed"; }
function checkedPayload(success: DispatchSuccess, role: "producer" | "checker"): ProducerResult | CheckerResult {
  const payload = success.runtime.payload as ProducerResult | CheckerResult;
  if (role === "producer" && (payload as ProducerResult).phase !== "requirements") throw new Error("Requirements producer returned the wrong phase");
  if (role === "checker" && (payload as CheckerResult).phase !== "requirements") throw new Error("Requirements checker returned the wrong phase");
  return payload;
}
function impactHistoryKeys(snapshot: BoardSnapshot, proposal: NormalizedRequirementsProposal): string[] {
  const keys = new Set(snapshot.cards.map(({ id }) => id));
  for (const change of proposal.cardChanges) keys.add(change.action === "create" ? change.temporaryKey! : change.action === "replace" ? `replace:${change.targetCard}` : change.targetCard!);
  return [...keys].sort();
}

/** Sequential producer/checker service. It has no board, GitHub, or state-transaction mutation authority. */
export class RequirementsDispatchService {
  private readonly discover: typeof discoverAgents; private readonly createPlan: typeof createDispatchPlan; private readonly execute: typeof executeDispatch; private readonly snapshotter: typeof materializeSnapshot; private readonly now: () => Date;
  constructor(private readonly dependencies: RequirementsDispatchDependencies) {
    this.discover = dependencies.discover ?? discoverAgents; this.createPlan = dependencies.createPlan ?? createDispatchPlan; this.execute = dependencies.execute ?? executeDispatch; this.snapshotter = dependencies.snapshotter ?? materializeSnapshot; this.now = dependencies.now ?? (() => new Date());
  }
  async run(input: RequirementsDispatchInput, signal?: AbortSignal): Promise<RequirementsDispatchOutcome> {
    let checkerSnapshot: Snapshot | undefined;
    try {
      const discovery = await this.discover({ cwd: input.root, repositoryRoot: input.root, overridesEnabled: input.snapshot.config.agents.allow_project_overrides });
      if (!discovery.persistedTrust) throw new Error("Persisted saved trust is required for requirements dispatch");
      const producerAgent = assertAgentAvailable(discovery, "requirements-producer"); const checkerAgent = assertAgentAvailable(discovery, "requirements-checker");
      const overrides = input.snapshot.config.agent_models.overrides;
      const producerModel = await resolveDispatchModel(input.parentModel, "requirements-producer", overrides, this.dependencies.modelResolver);
      const checkerModel = await resolveDispatchModel(input.parentModel, "requirements-checker", overrides, this.dependencies.modelResolver);
      const models = Object.freeze({ producer: producerModel, checker: checkerModel });
      const protocol = this.dependencies.protocol ?? await readFile(await resolvePackageAsset("templates/agents/child-protocol.md"), "utf8");
      const producerDispatch = runtimeId("KFRUN", this.now());
      const producerInputs = stable({ brief: input.brief, authoritative_base: input.baseCommit, board: input.snapshot.board, requirements: input.snapshot.requirements ?? null, cards: input.snapshot.cards });
      const producerPrompt = await assembleSystemPrompt({ repositoryRoot: input.root, protocol, agent: producerAgent, contextPaths: input.contextPaths, skillPaths: input.snapshot.config.resources.broad_policy_allowed_skills, dispatchInputs: producerInputs });
      const producerPlan = await this.createPlan({ dispatchId: producerDispatch, agent: producerAgent, model: producerModel, policy: policyForAgent("requirements-producer"), cwd: input.root, systemPrompt: producerPrompt, task: "Produce one requirements proposal for the dispatch inputs. Submit exactly one producer result." });
      const producerSuccess = await this.execute(producerPlan, { role: "producer", tool: producerPlan.policy.resultTool, dispatchId: producerDispatch, cardId: "none", phase: "requirements" }, signal);
      const producer = checkedPayload(producerSuccess, "producer") as ProducerResult;
      validateProducerResult(producer, { dispatchId: producerDispatch, cardId: "none", phase: "requirements" });
      if (!producerStatus(producer)) return Object.freeze({ kind: "revision_required", stage: "producer", payload: producer, discovery: discovery.report, models });

      const proposal = normalizeRequirementsProposal(producer, input.snapshot);
      const provisional = allocateRequirementsProposal(input.snapshot, proposal);
      const historyIds = Object.fromEntries(impactHistoryKeys(input.snapshot, proposal).map((key) => [key, runtimeId("KFH", this.now())]));
      const renderContext = { at: input.plannedAt, operationId: input.operationId, transactionId: input.transactionId, historyIds };
      const provisionalImpact = planRequirementsImpact(input.snapshot, proposal, provisional, renderContext);

      checkerSnapshot = await this.snapshotter(input.root, input.baseCommit);
      const checkerDispatch = runtimeId("KFRUN", this.now());
      const checkerInputs = stable({ authoritative_base: input.baseCommit, criteria: REQUIREMENTS_CRITERIA, proposal, allocation: provisional, affected_cards: provisionalImpact.affectedCardIds, grandfathered_cards: provisionalImpact.grandfatheredCardIds, design_closures: provisionalImpact.designClosures });
      const checkerPrompt = await assembleSystemPrompt({ repositoryRoot: checkerSnapshot.root, protocol, agent: checkerAgent, dispatchInputs: checkerInputs });
      const checkerPlan = await this.createPlan({ dispatchId: checkerDispatch, agent: checkerAgent, model: checkerModel, policy: policyForAgent("requirements-checker"), cwd: checkerSnapshot.root, systemPrompt: checkerPrompt, task: "Check every ordered requirements criterion exactly once. Submit exactly one checker result." });
      const criteria = REQUIREMENTS_CRITERIA.map(({ key }) => key);
      const checkerSuccess = await this.execute(checkerPlan, { role: "checker", tool: checkerPlan.policy.resultTool, dispatchId: checkerDispatch, cardId: "none", phase: "requirements", criteria }, signal);
      const checker = checkedPayload(checkerSuccess, "checker") as CheckerResult;
      validateCheckerResult(checker, { dispatchId: checkerDispatch, cardId: "none", phase: "requirements", criteria });
      if (checker.status !== "pass") return Object.freeze({ kind: "revision_required", stage: "checker", payload: checker, discovery: discovery.report, models });

      const allocation = allocateRequirementsProposal(input.snapshot, proposal, { producer: producer.findings.length, checker: checker.findings.length });
      const impact = planRequirementsImpact(input.snapshot, proposal, allocation, renderContext);
      const normalization: NormalizationInput = { roots: { "<PACKAGE_ROOT>": await packageRoot(), "<REPOSITORY_ROOT>": input.root, "<SNAPSHOT_ROOT>": checkerSnapshot.root }, secrets: input.secrets };
      const producerAttestation = buildChildAttestation(producerPlan, producerSuccess, { kind: "parent", repository_id: input.repositoryId, branch: null, commit: input.baseCommit, snapshotCommit: null }, normalization, allocation.producerFindingIds);
      const checkerAttestation = buildChildAttestation(checkerPlan, checkerSuccess, { kind: "immutable_snapshot", repository_id: input.repositoryId, branch: null, commit: input.baseCommit, snapshotCommit: input.baseCommit }, normalization, allocation.checkerFindingIds);
      const artifacts = [producerAttestation, checkerAttestation].map((attestation) => Object.freeze({ ...renderArtifact(attestation), attestation: Object.freeze(attestation) }));
      return Object.freeze({ kind: "checked", proposal, allocation, impact, producer, checker, artifacts: Object.freeze(artifacts), discovery: discovery.report, models });
    } catch (error) {
      return Object.freeze({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (checkerSnapshot) try { await checkerSnapshot.cleanup(); } catch (error) {
        return Object.freeze({ kind: "failed", error: `Checker snapshot cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
}
