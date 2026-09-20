import { stringify } from "yaml";
import { Value } from "typebox/value";
import { ArtifactAttestationSchema } from "../board/schemas.ts";
import { lifecycleArtifactPath, renderLifecycleArtifact, validateLifecycleArtifact } from "../lifecycle/artifacts.ts";
import type { StructuredResult } from "./result-tools.ts";

export function artifactKind(tool: string, payload: any): string {
  if (tool === "submit_producer_result") return payload.phase === "requirements" ? "requirements-producer" : payload.phase === "design" ? "design-producer" : payload.phase === "implementation" ? "implementation-producer" : "ship-producer";
  if (tool === "submit_checker_result") return payload.phase === "requirements" ? "requirements-check" : payload.phase === "design" ? "design-check" : "ship-check";
  if (tool === "submit_reviewer_result") return `review-${payload.lens}`;
  if (tool === "submit_split_decision") return "split-decision";
  if (tool === "submit_probe_result" || tool === "parent_probe") return `probe-${String(payload.probe).replaceAll("_", "-")}`;
  throw new Error(`Unknown artifact tool: ${tool}`);
}

function isLifecycleArtifact(attestation: Record<string, any>, payload: Record<string, any>): boolean {
  return attestation.tool === "parent_probe" || (payload.card_id !== "none" && ["submit_producer_result", "submit_checker_result", "submit_reviewer_result", "submit_split_decision", "submit_probe_result"].includes(attestation.tool));
}

export function artifactPath(attestation: Record<string, any>): string {
  if (!Value.Check(ArtifactAttestationSchema, attestation)) throw new Error("Invalid artifact attestation");
  const payload = attestation.payload as StructuredResult;
  if (isLifecycleArtifact(attestation, payload as Record<string, any>)) {
    return lifecycleArtifactPath(attestation);
  }
  const card = (payload as any).card_id; const directory = card === "none" ? "requirements" : card; const kind = artifactKind(attestation.tool, payload);
  return `docs/cards/artifacts/${directory}/${kind}-${attestation.run_id}.yaml`;
}

export function renderArtifact(attestation: Record<string, unknown>): { path: string; bytes: string } {
  const value = attestation as Record<string, any>;
  const payload = value.payload as Record<string, unknown> | undefined;
  if (payload && isLifecycleArtifact(value, payload)) {
    return renderLifecycleArtifact(value);
  }
  const path = artifactPath(value);
  const bytes = stringify(value, { lineWidth: 0, sortMapEntries: true }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n");
  return { path, bytes };
}

export { validateLifecycleArtifact };
