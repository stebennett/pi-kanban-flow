import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { Type } from "typebox";
import { authorizeExistingPath } from "./path-policy.ts";

const MAX_FILE_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 50_000;
const MAX_MATCHES = 500;
const MAX_FILES = 5_000;
const PathParameters = Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false });

function bounded(value: string): string { const bytes = Buffer.from(value); return bytes.length <= MAX_OUTPUT_BYTES ? value : `${bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8")}\n[truncated]`; }
async function textFile(path: string): Promise<string> { const info = await stat(path); if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("File is not a bounded regular file"); const value = await readFile(path, "utf8"); if (value.includes("\u0000")) throw new Error("Binary files are not exposed"); return value; }

async function walk(root: string, start: string): Promise<string[]> {
  const files: string[] = []; const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!; const info = await lstat(current);
    if (info.isSymbolicLink()) continue;
    if (info.isFile()) files.push(relative(root, current).split(sep).join("/"));
    else if (info.isDirectory()) for (const name of (await readdir(current)).sort()) queue.push(`${current}${sep}${name}`);
    if (files.length + queue.length > MAX_FILES) throw new Error("Repository file-count limit exceeded");
  }
  return files.sort();
}

export function registerReadRepositoryTools(pi: ExtensionAPI, root: string): void {
  pi.registerTool({ name: "kanban_read", label: "kanban_read", description: "Read a bounded UTF-8 file inside the authorized repository snapshot.", parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })) }, { additionalProperties: false }), async execute(_id, params) { const target = await authorizeExistingPath(root, params.path); const lines = (await textFile(target.absolutePath)).split("\n"); const start = (params.offset ?? 1) - 1; return { content: [{ type: "text" as const, text: bounded(lines.slice(start, start + (params.limit ?? 2_000)).join("\n")) }], details: { path: target.relativePath } }; } });
  pi.registerTool({ name: "kanban_ls", label: "kanban_ls", description: "List one authorized directory in deterministic order.", parameters: PathParameters, async execute(_id, params) { const target = await authorizeExistingPath(root, params.path); const values = (await readdir(target.absolutePath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`); return { content: [{ type: "text" as const, text: bounded(values.join("\n")) }], details: { count: values.length } }; } });
  pi.registerTool({ name: "kanban_find", label: "kanban_find", description: "Find authorized repository paths by bounded substring pattern.", parameters: Type.Object({ path: Type.String(), pattern: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }), async execute(_id, params) { const target = await authorizeExistingPath(root, params.path); const files = (await walk(root, target.absolutePath)).filter((path) => path.includes(params.pattern)).slice(0, MAX_MATCHES); return { content: [{ type: "text" as const, text: bounded(files.join("\n")) }], details: { count: files.length } }; } });
  pi.registerTool({ name: "kanban_grep", label: "kanban_grep", description: "Search bounded UTF-8 files under an authorized path.", parameters: Type.Object({ path: Type.String(), pattern: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }), async execute(_id, params) { const target = await authorizeExistingPath(root, params.path); const expression = new RegExp(params.pattern, "u"); const matches: string[] = []; for (const file of await walk(root, target.absolutePath)) { let text: string; try { text = await textFile(`${root}${sep}${file}`); } catch { continue; } for (const [index, line] of text.split("\n").entries()) if (expression.test(line)) { matches.push(`${file}:${index + 1}:${line}`); if (matches.length >= MAX_MATCHES) break; } if (matches.length >= MAX_MATCHES) break; } return { content: [{ type: "text" as const, text: bounded(matches.join("\n")) }], details: { count: matches.length } }; } });
}
