import type { MyelinEnvelope } from "../types";

/**
 * Fields included in the canonical signing payload.
 * Order does not matter here — keys are sorted lexicographically during serialization.
 *
 * signed_by fields (method, principal, at) ARE signed — prevents replay/rewrite.
 * signed_by.signature is excluded (can't sign the signature itself).
 * Excluded fields (mutable without invalidating signature):
 *   correlation_id, economics, extensions
 */
const SIGNABLE_FIELDS = new Set([
  "id",
  "source",
  "type",
  "timestamp",
  "sovereignty",
  "payload",
  "signed_by",
  // F-021 task routing fields — signed so a tampered requirement / target / deadline / mode invalidates
  "requirements",
  "sovereignty_required",
  "deadline",
  "distribution_mode",
  "target_principal",
]);

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) serialization.
 * - Keys sorted lexicographically at every nesting level
 * - Numbers in shortest form (no trailing zeros, no leading zeros)
 * - Standard JSON string escaping
 *
 * JavaScript's JSON.stringify with a replacer that sorts keys
 * handles number serialization correctly per the spec (ES2024 Number::toString
 * matches JCS requirements for safe integers and standard doubles).
 */
function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    // JSON.stringify handles number serialization per ES spec,
    // which aligns with RFC 8785 for finite numbers
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
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map((key) => {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) return null;
      return `${JSON.stringify(key)}:${canonicalStringify(v)}`;
    }).filter((pair): pair is string => pair !== null);
    return `{${pairs.join(",")}}`;
  }

  throw new Error(`JCS: unsupported type: ${typeof value}`);
}

/**
 * Produces a deterministic canonical byte representation of a MyelinEnvelope
 * for signing purposes, following RFC 8785 (JSON Canonicalization Scheme).
 *
 * Only signable fields are included: id, source, type, timestamp, sovereignty, payload.
 * Excluded: correlation_id, economics, extensions, signed_by.
 *
 * @param envelope - The envelope to canonicalize
 * @returns UTF-8 encoded bytes of the canonical JSON
 */
export function canonicalizeForSigning(envelope: MyelinEnvelope): Uint8Array {
  const signable: Record<string, unknown> = {};
  for (const key of Object.keys(envelope)) {
    if (SIGNABLE_FIELDS.has(key)) {
      signable[key] = (envelope as unknown as Record<string, unknown>)[key];
    }
  }

  // signed_by is included but signature field is stripped (can't sign itself)
  if (signable.signed_by && typeof signable.signed_by === "object") {
    const { signature, ...rest } = signable.signed_by as Record<string, unknown>;
    signable.signed_by = rest;
  }

  const canonical = canonicalStringify(signable);
  return new TextEncoder().encode(canonical);
}
