import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function normalizeRepositoryPath(input: string): string {
  const value = input.startsWith("@") ? input.slice(1) : input;
  if (!value || isAbsolute(value) || value.includes("\\") || value.includes("\u0000") || /[\r\n]/u.test(value)) throw new Error("Path must be a normalized repository-relative path");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Path contains a forbidden segment");
  return parts.join("/");
}

export function isContained(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

export async function authorizeExistingPath(root: string, input: string): Promise<{ relativePath: string; absolutePath: string }> {
  const relativePath = normalizeRepositoryPath(input);
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(resolve(canonicalRoot, relativePath));
  if (!isContained(canonicalRoot, canonical)) throw new Error("Path escapes the authorized root");
  return { relativePath, absolutePath: canonical };
}

export async function authorizeCreatePath(root: string, input: string): Promise<{ relativePath: string; absolutePath: string }> {
  const relativePath = normalizeRepositoryPath(input);
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, relativePath);
  const canonicalParent = await realpath(dirname(target));
  if (!isContained(canonicalRoot, canonicalParent)) throw new Error("Path escapes the authorized root");
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Writes through symlinks are forbidden"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { relativePath, absolutePath: target };
}
