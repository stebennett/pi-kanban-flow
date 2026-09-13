import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SHORT = "[0-9a-hjkmnp-tv-z]{8}";
const PREFIXES = ["KFRUN", "KFOP", "KFTX", "KFH"] as const;
export type RuntimeIdPrefix = (typeof PREFIXES)[number];

export function numericId(prefix: "REQ" | "CARD" | "AC" | "FINDING", value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 9999) throw new RangeError("numeric ID must be 1..9999");
  return `${prefix}-${String(value).padStart(4, "0")}`;
}

export function isNumericId(value: string, prefix: "REQ" | "CARD" | "AC" | "FINDING"): boolean {
  return new RegExp(`^${prefix}-[0-9]{4}$`).test(value) && Number(value.slice(-4)) > 0;
}

export function runtimeId(prefix: RuntimeIdPrefix, now: Date = new Date(), random: string = randomSuffix()): string {
  if (!PREFIXES.includes(prefix) || !/^([0-9a-hjkmnp-tv-z]){8}$/.test(random)) throw new Error("invalid runtime ID suffix");
  const iso = now.toISOString();
  const time = iso.slice(11, 23).replaceAll(":", "").replace(".", "");
  const timestamp = `${iso.slice(0, 10).replaceAll("-", "")}T${time}Z`;
  return `${prefix}-${timestamp}-${random}`;
}

function randomSuffix(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function isRuntimeId(value: string, prefix: RuntimeIdPrefix): boolean {
  return new RegExp(`^${prefix}-\\d{8}T\\d{6}\\d{3}Z-${SHORT}$`).test(value);
}

export function isObjectId(value: string): boolean { return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value); }
export function isUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}
