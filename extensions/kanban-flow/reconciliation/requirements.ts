import type { GitHubAdapter, GitHubPullRequest } from "../state-pr/github.ts";
import { parseActionMarker, serializeActionMarker, type ActionMarker } from "../state-pr/markers.ts";
import type { DesignClosureAction } from "../requirements/impact.ts";

export class RequirementsDesignClosureError extends Error {
  constructor(message: string, readonly stale = false) { super(message); this.name = "RequirementsDesignClosureError"; }
}
function exactPullRequest(pullRequests: readonly GitHubPullRequest[], action: DesignClosureAction): GitHubPullRequest {
  const matches = pullRequests.filter(({ number }) => number === action.number); if (matches.length !== 1) throw new RequirementsDesignClosureError(`Design PR #${action.number} is missing or ambiguous`);
  const pr = matches[0]; if (pr.url !== action.url || pr.base !== "main" || pr.head !== action.head || pr.head_commit !== action.headCommit) throw new RequirementsDesignClosureError(`Design PR #${action.number} identity changed`, true);
  return pr;
}
function closureMarkers(comments: readonly { body: string }[], cardId: string): ActionMarker[] {
  const markers: ActionMarker[] = [];
  for (const comment of comments) {
    if (!comment.body.includes("kanban-flow-action:")) continue;
    let marker: ActionMarker; try { marker = parseActionMarker(comment.body); } catch (error) { throw new RequirementsDesignClosureError(`Malformed design closure marker: ${error instanceof Error ? error.message : String(error)}`); }
    if (marker.kind === "requirements-design-close" && marker.card_id === cardId) markers.push(marker);
  }
  if (markers.length > 1) throw new RequirementsDesignClosureError(`Duplicate requirements design closure markers for ${cardId}`);
  return markers;
}

/** Execute only a previously approved exact design-close plan. */
export async function executeRequirementsDesignClosures(input: { actions: readonly DesignClosureAction[]; operationId: string; baseCommit: string; github: GitHubAdapter; assertOwnership(): Promise<void>; refreshBase(): Promise<string> }): Promise<void> {
  for (const action of input.actions) {
    await input.assertOwnership();
    const comments = await input.github.getComments(action.number); const markers = closureMarkers(comments, action.cardId);
    let pullRequest = exactPullRequest(await input.github.listPullRequests({ state: "all" }), action);
    if (pullRequest.state === "merged") throw new RequirementsDesignClosureError(`Design PR #${action.number} merged before requirements closure`, true);
    if (pullRequest.state === "open") {
      if (markers.length === 0) {
        await input.assertOwnership();
        await input.github.addComment(action.number, serializeActionMarker({ version: 1, kind: "requirements-design-close", operation_id: input.operationId, card_id: action.cardId, criterion: null }));
      }
      await input.assertOwnership(); await input.github.closePullRequest(action.number);
      pullRequest = exactPullRequest(await input.github.listPullRequests({ state: "all" }), action);
    } else if (markers.length === 0) {
      throw new RequirementsDesignClosureError(`Closed design PR #${action.number} has no requirements closure marker`);
    }
    if (pullRequest.state !== "closed" || pullRequest.merge_commit !== null) throw new RequirementsDesignClosureError(`Design PR #${action.number} did not close without merge`, pullRequest.state === "merged");
  }
  await input.assertOwnership(); if (await input.refreshBase() !== input.baseCommit) throw new RequirementsDesignClosureError("origin/main changed during design closure", true);
}
