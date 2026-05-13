/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) — shared serializer.
 *
 * Used by every signing/verification path that hashes a JSON value:
 *   - identity/canonicalize.ts (envelope signing)
 *   - discovery/canonicalize.ts (capability advertisement signing)
 *
 * Single source of truth: a fix here propagates to all signed artifacts.
 *
 * Rules:
 *   - Object keys sorted lexicographically at every level.
 *   - undefined-valued keys dropped (consistent with JSON.stringify).
 *   - Numbers in shortest form (no trailing zeros, no leading zeros) via
 *     ES2024 Number::toString, which matches JCS for finite numbers.
 *   - Standard JSON string escaping via JSON.stringify(string).
 *   - Non-finite numbers and unsupported types throw.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`JCS: non-finite numbers are not allowed: ${value}`);
    }
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalStringify(item));
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const pairs = keys
      .map((key) => {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) return null;
        return `${JSON.stringify(key)}:${canonicalStringify(v)}`;
      })
      .filter((pair): pair is string => pair !== null);
    return `{${pairs.join(",")}}`;
  }

  throw new Error(`JCS: unsupported type: ${typeof value}`);
}
