import assert from "node:assert/strict";
import { test } from "node:test";

function accept(lines: readonly string[], expectedTool: string, maxBytes = 512): void {
  let bytes = 0; let result = 0; let afterResult = false;
  for (const line of lines) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > maxBytes) throw new Error("stream exceeds byte limit");
    let event: { type?: string; toolName?: string };
    try { event = JSON.parse(line); } catch { throw new Error("malformed JSON event"); }
    if (afterResult) throw new Error("event after result");
    if (event.type === "tool") {
      result += 1;
      if (result > 1) throw new Error("duplicate result");
      if (event.toolName !== expectedTool) throw new Error("wrong role result tool");
      afterResult = true;
    }
  }
  if (result !== 1) throw new Error("missing result");
}

test("result stream prototype rejects malformed, wrong, duplicate, post-result, and oversized inputs", () => {
  const valid = JSON.stringify({ type: "tool", toolName: "submit_expected" });
  assert.doesNotThrow(() => accept([valid], "submit_expected"));
  assert.throws(() => accept(["{"], "submit_expected"), /malformed/);
  assert.throws(() => accept([JSON.stringify({ type: "tool", toolName: "submit_sibling" })], "submit_expected"), /wrong role/);
  assert.throws(() => accept([valid, valid], "submit_expected"), /event after result/);
  assert.throws(() => accept([valid, JSON.stringify({ type: "turn_end" })], "submit_expected"), /event after result/);
  assert.throws(() => accept([JSON.stringify({ type: "text", value: "x".repeat(1024) })], "submit_expected"), /stream exceeds/);
});
