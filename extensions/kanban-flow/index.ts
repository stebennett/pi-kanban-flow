import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SUPPORTED_PI_RANGE = ">=0.85.0 <0.86.0";

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function isSupportedPiVersion(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed !== undefined && parsed[0] === 0 && parsed[1] === 85;
}

export function assertSupportedPiVersion(version: string = VERSION): void {
  if (!isSupportedPiVersion(version)) {
    throw new Error(`pi-kanban-flow requires Pi ${SUPPORTED_PI_RANGE}; detected ${version}`);
  }
}

/** Thin entry point: compatibility is checked before future mutating registration. */
export default function kanbanFlowExtension(pi: ExtensionAPI): void {
  assertSupportedPiVersion(VERSION);
  // Deterministic commands and tools are registered by later Stage 1 units.
  void pi;
}
