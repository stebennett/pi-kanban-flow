import { isAbsolute, posix } from "node:path";

export function repositoryRelativePath(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || value.includes("\n") || isAbsolute(value)) {
    throw new Error(`invalid repository-relative path: ${value.slice(0, 120)}`);
  }
  const normalized = posix.normalize(value);
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.split("/").some((part) => part === "")) {
    throw new Error(`invalid repository-relative path: ${value.slice(0, 120)}`);
  }
  return normalized;
}

export function sortedUniquePaths(paths: readonly string[]): string[] {
  const normalized = paths.map(repositoryRelativePath);
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) throw new Error("duplicate repository-relative path");
  return unique.sort();
}
