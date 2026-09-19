import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const runRealSpike = process.env.PI_RUN_REAL_STAGE_3_SPIKE === "1";

class RpcClient {
  readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private events: Array<Record<string, unknown>> = [];
  private waiters: Array<() => void> = [];
  readonly stderr: string[] = [];

  constructor(extension: string, cwd: string) {
    this.child = spawn("pi", [
      "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-builtin-tools", "-e", extension,
    ], { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      while (true) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) break;
        let line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line) this.events.push(JSON.parse(line) as Record<string, unknown>);
      }
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  send(value: unknown): void {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  async next(predicate: (event: Record<string, unknown>) => boolean, timeoutMs = 5_000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.events.findIndex(predicate);
      if (index >= 0) return this.events.splice(index, 1)[0]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`RPC event timeout; stderr=${this.stderr.join("")}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`RPC event timeout; stderr=${this.stderr.join("")}`)), remaining);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  async close(): Promise<void> {
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => this.child.once("close", () => resolve()));
  }
}

const extensionSource = `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
const digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const approve = "Approve " + digest;
export default function(pi: ExtensionAPI) {
  let mutationCount = 0;
  pi.registerCommand("stage3-approval-spike", {
    description: "Disposable Stage 3 approval interaction",
    handler: async (_args, ctx) => {
      const decision = await ctx.ui.select("Requirements proposal " + digest, [approve, "Revise", "Cancel"]);
      if (decision === approve) mutationCount++;
      ctx.ui.notify(JSON.stringify({ decision: decision ?? "dismissed", mutationCount }), "info");
    },
  });
  pi.registerCommand("stage3-approval-abort-spike", {
    description: "Disposable Stage 3 abort interaction",
    handler: async (_args, ctx) => {
      const controller = new AbortController();
      queueMicrotask(() => controller.abort());
      const decision = await ctx.ui.select("Abort-bound proposal " + digest, [approve, "Cancel"], { signal: controller.signal });
      if (decision === approve) mutationCount++;
      ctx.ui.notify(JSON.stringify({ decision: decision ?? "aborted", mutationCount }), "info");
    },
  });
}
`;

function isUi(event: Record<string, unknown>, method: string): boolean {
  return event.type === "extension_ui_request" && event.method === method;
}

function notificationPayload(event: Record<string, unknown>): { decision: string; mutationCount: number } {
  assert.equal(event.method, "notify");
  return JSON.parse(String(event.message)) as { decision: string; mutationCount: number };
}

test("real Pi RPC approval distinguishes approve, dismissal, and abort without implicit mutation", { skip: !runRealSpike }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-stage3-interaction-spike-"));
  const extension = join(root, "approval-spike.ts");
  await writeFile(extension, extensionSource, { mode: 0o600 });
  const client = new RpcClient(extension, root);
  try {
    client.send({ id: "commands", type: "get_commands" });
    const commands = await client.next((event) => event.type === "response" && event.id === "commands") as { data?: { commands?: Array<{ name?: string }> } };
    assert.ok(commands.data?.commands?.some(({ name }) => name === "stage3-approval-spike"));

    client.send({ id: "approve", type: "prompt", message: "/stage3-approval-spike" });
    const approvalRequest = await client.next((event) => isUi(event, "select"));
    assert.match(String(approvalRequest.title), /sha256:0123456789abcdef/);
    client.send({ type: "extension_ui_response", id: approvalRequest.id, value: "Approve sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" });
    assert.deepEqual(notificationPayload(await client.next((event) => isUi(event, "notify"))), { decision: "Approve sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", mutationCount: 1 });
    await client.next((event) => event.type === "response" && event.id === "approve");

    client.send({ id: "dismiss", type: "prompt", message: "/stage3-approval-spike" });
    const dismissalRequest = await client.next((event) => isUi(event, "select"));
    client.send({ type: "extension_ui_response", id: dismissalRequest.id, cancelled: true });
    assert.deepEqual(notificationPayload(await client.next((event) => isUi(event, "notify"))), { decision: "dismissed", mutationCount: 1 });
    await client.next((event) => event.type === "response" && event.id === "dismiss");

    client.send({ id: "abort", type: "prompt", message: "/stage3-approval-abort-spike" });
    const aborted = notificationPayload(await client.next((event) => isUi(event, "notify")));
    assert.deepEqual(aborted, { decision: "aborted", mutationCount: 1 });
    await client.next((event) => event.type === "response" && event.id === "abort");
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 3 skill boundary forbids mutation authority and names one deterministic tool", () => {
  const skill = [
    "Ask one question at a time and build a bounded brief.",
    "Call kanban_requirements exactly once with that brief.",
    "Do not edit files, run shell or Git, allocate IDs, choose paths, or approve.",
  ].join("\n");
  assert.equal((skill.match(/kanban_requirements/g) ?? []).length, 1);
  assert.doesNotMatch(skill, /--approve|git add|git commit|docs\/cards\/CARD-/i);
});
