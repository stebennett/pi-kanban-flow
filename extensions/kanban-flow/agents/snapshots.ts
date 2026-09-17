import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix } from "node:path";
import { normalizeRepositoryPath } from "./path-policy.ts";

export interface Snapshot { root: string; commit: string; cleanup(): Promise<void> }
interface TarEntry { path: string; type: "file" | "directory" | "symlink"; body: Buffer; link?: string }
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function field(block: Buffer, start: number, length: number): string { return block.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, ""); }
function octal(block: Buffer, start: number, length: number): number { const value = field(block, start, length).trim(); return value ? Number.parseInt(value, 8) : 0; }

export function parseGitArchiveTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const name = `${field(header, 345, 155)}${field(header, 345, 155) ? "/" : ""}${field(header, 0, 100)}`.replace(/\/$/, "");
    const size = octal(header, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > archive.length) throw new Error("Malformed archive size");
    const body = archive.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    const typeFlag = String.fromCharCode(header[156] || 48);
    if (typeFlag === "g") continue;
    const path = normalizeRepositoryPath(name);
    if (seen.has(path)) throw new Error(`Duplicate normalized archive path: ${path}`);
    seen.add(path);
    if (typeFlag === "0" || typeFlag === "\0") entries.push({ path, type: "file", body: Buffer.from(body) });
    else if (typeFlag === "5") entries.push({ path, type: "directory", body: Buffer.alloc(0) });
    else if (typeFlag === "2") {
      const link = field(header, 157, 100);
      if (!link || isAbsolute(link) || link.includes("\\") || link.includes("\u0000")) throw new Error(`Unsafe archive link: ${path}`);
      const resolved = posix.normalize(posix.join(posix.dirname(path), link));
      if (resolved === ".." || resolved.startsWith("../") || isAbsolute(resolved)) throw new Error(`Archive link escapes snapshot: ${path}`);
      entries.push({ path, type: "symlink", body: Buffer.alloc(0), link });
    } else throw new Error(`Unsupported archive entry type ${JSON.stringify(typeFlag)}: ${path}`);
  }
  const paths = new Set(entries.map((entry) => entry.path));
  for (const entry of entries.filter((value) => value.type === "symlink")) {
    let target = posix.normalize(posix.join(posix.dirname(entry.path), entry.link!));
    const visited = new Set([entry.path]);
    while (true) {
      if (visited.has(target)) throw new Error(`Archive symlink cycle: ${entry.path}`);
      const next = entries.find((value) => value.path === target);
      if (!next) throw new Error(`Archive symlink target is missing: ${entry.path}`);
      if (next.type !== "symlink") break;
      visited.add(target);
      target = posix.normalize(posix.join(posix.dirname(target), next.link!));
      if (target === ".." || target.startsWith("../")) throw new Error(`Archive link escapes snapshot: ${entry.path}`);
    }
  }
  return entries;
}

async function gitArchive(repository: string, commit: string): Promise<Buffer> {
  if (!/^[0-9a-f]{40,64}$/u.test(commit)) throw new Error("Snapshot commit must be a full object ID");
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["archive", "--format=tar", commit], { cwd: repository, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let total = 0; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { total += chunk.length; if (total > MAX_ARCHIVE_BYTES) child.kill("SIGKILL"); else chunks.push(chunk); });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 && total <= MAX_ARCHIVE_BYTES ? resolve(Buffer.concat(chunks)) : reject(new Error(total > MAX_ARCHIVE_BYTES ? "Git archive exceeds limit" : `git archive failed (${code}): ${stderr}`)));
  });
}

export async function materializeSnapshot(repository: string, commit: string): Promise<Snapshot> {
  const entries = parseGitArchiveTar(await gitArchive(repository, commit));
  const root = await mkdtemp(join(tmpdir(), "kanban-snapshot-"));
  try {
    for (const entry of entries.filter((value) => value.type === "directory")) await mkdir(join(root, entry.path), { recursive: true, mode: 0o755 });
    for (const entry of entries.filter((value) => value.type === "file")) { await mkdir(dirname(join(root, entry.path)), { recursive: true, mode: 0o755 }); await writeFile(join(root, entry.path), entry.body, { mode: 0o444 }); }
    for (const entry of entries.filter((value) => value.type === "symlink")) { await mkdir(dirname(join(root, entry.path)), { recursive: true, mode: 0o755 }); await symlink(entry.link!, join(root, entry.path)); }
    const directories = [...new Set([root, ...entries.map((entry) => dirname(join(root, entry.path))), ...entries.filter((entry) => entry.type === "directory").map((entry) => join(root, entry.path))])].sort((a, b) => b.length - a.length);
    for (const directory of directories) await chmod(directory, 0o555);
    return { root, commit, async cleanup() { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
