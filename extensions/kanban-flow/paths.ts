import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class MissingPackageAssetError extends Error {
  readonly asset: string;
  constructor(asset: string) {
    const bounded = asset.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 200);
    super(`Required pi-kanban-flow asset is missing: ${bounded}`);
    this.name = "MissingPackageAssetError";
    this.asset = bounded;
  }
}

/** Resolve the installed package root from this module, including symlinked installs. */
export async function packageRoot(): Promise<string> {
  return realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
}

/** Resolve an asset without permitting absolute paths or package-root escapes. */
export async function resolvePackageAsset(asset: string): Promise<string> {
  if (!asset || isAbsolute(asset) || asset.includes("\\") || asset.split("/").some((part) => part === "..")) {
    throw new MissingPackageAssetError(asset || "<empty>");
  }
  const root = await packageRoot();
  const candidate = resolve(root, asset);
  const canonical = await realpath(candidate).catch(() => undefined);
  if (!canonical || (relative(root, canonical).startsWith("..") || isAbsolute(relative(root, canonical)))) {
    throw new MissingPackageAssetError(asset);
  }
  return canonical;
}

export function packageRootFromModule(moduleUrl: string = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../..");
}
