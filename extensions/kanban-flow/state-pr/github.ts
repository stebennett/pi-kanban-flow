import { assertMarkerMatchesBranch, parsePullRequestMarker, type ManagedPullRequestKind, type PullRequestMarker } from "./markers.ts";
import { DirectProcessRunner, type ProcessOptions, type ProcessRunner } from "./process.ts";

export type PullRequestState = "open" | "closed" | "merged";
export interface GitHubPullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  head: string;
  base: string;
  state: PullRequestState;
  head_commit: string;
  merge_commit: string | null;
}
export interface GitHubComment { id: number; body: string; author: string; created_at: string }
export interface GitHubCheck {
  name: string;
  status: string;
  conclusion: string | null;
  required: boolean;
  code_evidence?: boolean;
}
export interface GitHubReview {
  reviewer: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" | "COMMENTED";
  submitted_at: string;
}
export interface GitHubAdapter {
  listPullRequests(options?: { state?: "open" | "closed" | "all" }): Promise<readonly GitHubPullRequest[]>;
  createPullRequest(input: { title: string; body: string; head: string; base: string }): Promise<GitHubPullRequest>;
  addComment(number: number, body: string): Promise<GitHubComment>;
  closePullRequest(number: number): Promise<void>;
  reopenPullRequest(number: number): Promise<void>;
  getComments(number: number): Promise<readonly GitHubComment[]>;
  /** Parent-owned external facts used by shipping reconciliation. */
  getChecks?(number: number): Promise<readonly GitHubCheck[]>;
  getReviews?(number: number): Promise<readonly GitHubReview[]>;
}

export interface ManagedPullRequest {
  pullRequest: GitHubPullRequest;
  marker: PullRequestMarker;
}
export interface ManagedQuery { kind?: ManagedPullRequestKind; operationId?: string; transactionId?: string; cardIds?: readonly string[] }

function sameIds(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id, index) => id === right[index]); }
function assertPrShape(pr: GitHubPullRequest): void {
  if (!Number.isInteger(pr.number) || pr.number < 1 || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(pr.url)) throw new Error("invalid GitHub PR identity");
  if (pr.base !== "main" || !pr.head || !pr.head_commit || (pr.state === "merged" && !pr.merge_commit)) throw new Error(`invalid GitHub PR #${pr.number} metadata`);
}

/** Discover managed PRs only when every candidate has exactly one valid marker and identity. */
export async function discoverManagedPullRequests(github: GitHubAdapter, query: ManagedQuery = {}): Promise<ManagedPullRequest[]> {
  const prs = await github.listPullRequests({ state: "all" });
  const found: ManagedPullRequest[] = [];
  for (const pr of prs) {
    assertPrShape(pr);
    let marker: PullRequestMarker;
    try { marker = parsePullRequestMarker(pr.body); } catch (error) {
      if (pr.body.includes("kanban-flow:")) throw new Error(`malformed managed marker in PR #${pr.number}`, { cause: error });
      continue;
    }
    assertMarkerMatchesBranch(marker, pr.head);
    if (query.kind && marker.kind !== query.kind) continue;
    if (query.operationId && marker.operation_id !== query.operationId) continue;
    if (query.transactionId && marker.transaction_id !== query.transactionId) continue;
    if (query.cardIds && !sameIds(marker.card_ids, query.cardIds)) continue;
    found.push({ pullRequest: pr, marker });
  }
  found.sort((a, b) => a.pullRequest.number - b.pullRequest.number);
  return found;
}

export async function findUniqueManagedPullRequest(github: GitHubAdapter, query: ManagedQuery): Promise<ManagedPullRequest | undefined> {
  const found = await discoverManagedPullRequests(github, query);
  if (found.length > 1) throw new Error(`ambiguous managed PR candidates: ${found.map(({ pullRequest }) => `#${pullRequest.number}`).join(", ")}`);
  return found[0];
}

export interface GhAdapterOptions { runner?: ProcessRunner; executable?: string; cwd?: string; repository?: string }
export class GhCliAdapter implements GitHubAdapter {
  private readonly runner: ProcessRunner;
  private readonly executable: string;
  private readonly cwd?: string;
  private readonly repository?: string;
  constructor(options: GhAdapterOptions = {}) { this.runner = options.runner ?? new DirectProcessRunner(); this.executable = options.executable ?? "gh"; this.cwd = options.cwd; this.repository = options.repository; }
  private async run(args: readonly string[], options?: ProcessOptions): Promise<string> {
    const result = await this.runner.run(this.executable, args, { cwd: options?.cwd ?? this.cwd, ...options });
    if (result.code !== 0) throw new Error(`gh command failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`);
    return result.stdout;
  }
  private async runAllowExit(args: readonly string[], allowed: readonly number[], options?: ProcessOptions): Promise<string> {
    const result = await this.runner.run(this.executable, args, { cwd: options?.cwd ?? this.cwd, ...options });
    if (result.code !== 0 && !allowed.includes(result.code)) throw new Error(`gh command failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`);
    return result.stdout;
  }
  private repoArgs(): string[] { return this.repository ? ["--repo", this.repository] : []; }
  async listPullRequests(options: { state?: "open" | "closed" | "all" } = {}): Promise<readonly GitHubPullRequest[]> {
    const output = await this.run(["pr", "list", ...this.repoArgs(), "--state", options.state ?? "all", "--limit", "1000", "--json", "number,url,title,body,headRefName,baseRefName,state,headRefOid,mergeCommit"]);
    const rows = JSON.parse(output) as Array<Record<string, unknown>>;
    return rows.map((row) => normalizePullRequest(row));
  }
  async createPullRequest(input: { title: string; body: string; head: string; base: string }): Promise<GitHubPullRequest> {
    const output = await this.run(["pr", "create", ...this.repoArgs(), "--title", input.title, "--body", input.body, "--head", input.head, "--base", input.base, "--json", "number,url,title,body,headRefName,baseRefName,state,headRefOid,mergeCommit"]);
    return normalizePullRequest(JSON.parse(output) as Record<string, unknown>);
  }
  async addComment(number: number, body: string): Promise<GitHubComment> {
    const output = await this.run(["pr", "comment", String(number), ...this.repoArgs(), "--body", body, "--json", "id,body,author,createdAt"]);
    return normalizeComment(JSON.parse(output) as Record<string, unknown>);
  }
  async closePullRequest(number: number): Promise<void> { await this.run(["pr", "close", String(number), ...this.repoArgs()]); }
  async reopenPullRequest(number: number): Promise<void> { await this.run(["pr", "reopen", String(number), ...this.repoArgs()]); }
  async getComments(number: number): Promise<readonly GitHubComment[]> {
    const output = await this.run(["pr", "view", String(number), ...this.repoArgs(), "--json", "comments"]);
    const value = JSON.parse(output) as { comments?: Array<Record<string, unknown>> };
    return (value.comments ?? []).map(normalizeComment);
  }
  async getChecks(number: number): Promise<readonly GitHubCheck[]> {
    const output = await this.runAllowExit(["pr", "checks", String(number), ...this.repoArgs(), "--required", "--json", "name,state,bucket"], [8]);
    const rows = JSON.parse(output) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const bucket = String(row.bucket ?? "").toLowerCase();
      const state = String(row.state ?? "unknown").toLowerCase();
      const conclusion = bucket === "pass" ? "success" : bucket === "skipping" ? "skipped" : bucket === "fail" ? "failure" : bucket === "cancel" ? "cancelled" : bucket === "pending" || ["queued", "requested", "waiting", "pending", "in_progress"].includes(state) ? "queued" : "unknown";
      return { name: String(row.name ?? ""), status: ["queued", "requested", "waiting", "pending"].includes(state) ? "in_progress" : state, conclusion, required: true };
    });
  }
  async getReviews(number: number): Promise<readonly GitHubReview[]> {
    const output = await this.run(["pr", "view", String(number), ...this.repoArgs(), "--json", "reviews"]);
    const value = JSON.parse(output) as { reviews?: Array<Record<string, unknown>> };
    return (value.reviews ?? []).map((row) => {
      const author = row.author && typeof row.author === "object" ? String((row.author as { login?: unknown }).login ?? "") : String(row.author ?? "");
      const state = String(row.state ?? "COMMENTED").toUpperCase();
      if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED", "COMMENTED"].includes(state)) throw new Error(`unknown GitHub review state ${state}`);
      return { reviewer: author, state: state as GitHubReview["state"], submitted_at: String(row.submittedAt ?? row.submitted_at ?? "") };
    });
  }
}

function normalizePullRequest(row: Record<string, unknown>): GitHubPullRequest {
  const state = row.state === "OPEN" ? "open" : row.state === "MERGED" ? "merged" : "closed";
  const merge = row.mergeCommit;
  return { number: Number(row.number), url: String(row.url), title: String(row.title ?? ""), body: String(row.body ?? ""), head: String(row.headRefName), base: String(row.baseRefName), state, head_commit: String(row.headRefOid), merge_commit: merge && typeof merge === "object" ? String((merge as { oid?: unknown }).oid ?? "") || null : null };
}
function normalizeComment(row: Record<string, unknown>): GitHubComment {
  const author = row.author && typeof row.author === "object" ? String((row.author as { login?: unknown }).login ?? "") : String(row.author ?? "");
  return { id: Number(row.id), body: String(row.body ?? ""), author, created_at: String(row.createdAt ?? "") };
}
