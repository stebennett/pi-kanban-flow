import { stringify } from "yaml";
import { Value } from "typebox/value";
import { ArtifactAttestationSchema } from "../board/schemas.ts";
import type { StructuredResult } from "./result-tools.ts";

export function artifactKind(tool: string, payload: any): string {
  if (tool === "submit_producer_result") return payload.phase === "requirements" ? "requirements-producer" : payload.phase === "design" ? "design-producer" : payload.phase === "implementation" ? "implementation-producer" : "ship-producer";
  if (tool === "submit_checker_result") return payload.phase === "requirements" ? "requirements-check" : payload.phase === "design" ? "design-check" : "ship-check";
  if (tool === "submit_reviewer_result") return `review-${payload.lens}`;
  if (tool === "submit_split_decision") return "split-decision";
  if (tool === "submit_probe_result" || tool === "parent_probe") return `probe-${String(payload.probe).replaceAll("_", "-")}`;
  throw new Error(`Unknown artifact tool: ${tool}`);
}

export function artifactPath(attestation: Record<string, any>): string {
  if (!Value.Check(ArtifactAttestationSchema, attestation)) throw new Error("Invalid artifact attestation");
  const payload = attestation.payload as StructuredResult; const card = (payload as any).card_id; const directory = card === "none" ? "requirements" : card; const kind = artifactKind(attestation.tool, payload);
  return `docs/cards/artifacts/${directory}/${kind}-${attestation.run_id}.yaml`;
}

export function renderArtifact(attestation: Record<string, unknown>): { path: string; bytes: string } {
  const path = artifactPath(attestation as Record<string, any>);
  const bytes = stringify(attestation, { lineWidth: 0, sortMapEntries: true }).replace(/\r\n?/g, "\n").replace(/\n*$/u, "\n");
  return { path, bytes };
}
