import type { ApprovalAdapter } from "../requirements/approval.ts";

export interface PiApprovalUi {
  select(title: string, options: string[], settings?: { signal?: AbortSignal }): Promise<string | undefined>;
}

/** Bind the deterministic approval primitive to Pi's explicit select UI in TUI/RPC modes. */
export function createPiApprovalAdapter(ui: PiApprovalUi, supported: boolean): ApprovalAdapter | undefined {
  if (!supported) return undefined;
  return {
    async request(input, signal) {
      const approve = `Approve ${input.digest}`;
      const selected = await ui.select(`Requirements proposal\n\n${input.document}`, [approve, "Revise", "Cancel"], { signal });
      if (selected === approve) return "approve";
      if (selected === "Revise") return "revise";
      if (selected === "Cancel") return "cancel";
      return undefined;
    },
  };
}
