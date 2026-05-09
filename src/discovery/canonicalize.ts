import type { CapabilityAdvertisement } from "./types";

// F-11: JCS (RFC 8785) canonicalization for capability advertisements.
// Mirrors src/identity/canonicalize.ts but scoped to advertisement
// shape — keys sorted lexicographically, deterministic JSON output,
// finite numbers only.

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: non-finite numbers not allowed: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys
      .map((k) => {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined) return null;
        return `${JSON.stringify(k)}:${canonicalStringify(v)}`;
      })
      .filter((p): p is string => p !== null);
    return `{${pairs.join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

export function canonicalizeAdvertisement(advertisement: CapabilityAdvertisement): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(advertisement));
}
