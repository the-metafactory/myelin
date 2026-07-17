/**
 * ./wire — canonicalizer v2 (RFC-0004 §3/§4, the signing-bytes core).
 *
 * THE CRYPTO KEYSTONE. Field-id indirection (§3.3 / grammar §6): the signable
 * projection's top-level names are re-keyed to their PERMANENT field-ids before
 * JCS serialization, so renaming a signable field is never cryptographically
 * breaking. Domain separation (§7): bytes-to-sign = CONTEXT_TAG || canonical, so
 * a metafactory signature is structurally unusable in any other Ed25519 protocol.
 *
 * Every byte here is pinned by `specs/vectors/envelope-signing/canonicalize.json`
 * — the vectors carry real Ed25519 signatures over these exact bytes.
 */

import { canonicalStringify } from "../jcs";

/**
 * THE FIELD-ID REGISTRY (RFC-0004 §4.1 / grammar §6). 14 SIGNABLE_FIELDS, each
 * with a PERMANENT id. Ids are never reused/reassigned; renaming keeps the id.
 * The mutable carve-out (`correlation_id`, `economics`, `extensions`) has NO
 * field-id and is never signed (§4.2).
 */
export const FIELD_IDS: Readonly<Record<string, number>> = {
  id: 1,
  source: 2,
  type: 3,
  timestamp: 4,
  sovereignty: 5,
  payload: 6,
  signed_by: 7,
  requirements: 8,
  sovereignty_required: 9,
  deadline: 10,
  distribution_mode: 11,
  target_assistant: 12,
  originator: 13,
  spec_version: 14,
};

/** The §7 domain-separation tag: UTF-8 of the ASCII string + one 0x00. */
export const CONTEXT_TAG_STRING = "metafactory-envelope-signature-v1";
export const CONTEXT_TAG_BYTES: Uint8Array = (() => {
  const ascii = new TextEncoder().encode(CONTEXT_TAG_STRING);
  const out = new Uint8Array(ascii.length + 1);
  out.set(ascii, 0);
  out[ascii.length] = 0x00;
  return out;
})();

type Obj = Record<string, unknown>;

/** Normalize a `signed_by` value to a stamp array (single object → one-element). */
export function normalizeSignedByValue(value: unknown): Obj[] {
  if (Array.isArray(value)) return value.filter((s): s is Obj => isPlainObject(s));
  if (isPlainObject(value)) return [value];
  return []; // null / primitive → unsigned (D32 shim divergence)
}

function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripSignature(stamp: Obj): Obj {
  const { signature: _sig, ...rest } = stamp;
  return rest;
}

/**
 * Project the present signable fields and re-key them by field-id (decimal
 * string). `signed_by` (id 7) is normalized to an array; `chainStrip` selects a
 * stamp index whose OWN signature is removed (chain-slice, §5.4). The mutable
 * carve-out is dropped (no field-id). Returns the field-id-keyed object ready
 * for JCS.
 */
function reKey(
  envelope: Obj,
  opts: { chainSlice?: number } = {},
): Obj {
  const out: Obj = {};
  for (const [name, value] of Object.entries(envelope)) {
    const id = FIELD_IDS[name];
    if (id === undefined) continue; // carve-out / unknown → not signed
    if (name === "signed_by") {
      let chain = normalizeSignedByValue(value);
      if (chain.length === 0) continue; // unsigned → omit field-id 7
      if (opts.chainSlice !== undefined) {
        chain = chain.slice(0, opts.chainSlice + 1);
        chain = chain.map((stamp, i) => (i === opts.chainSlice ? stripSignature(stamp) : stamp));
      }
      out[String(id)] = chain;
    } else {
      out[String(id)] = value;
    }
  }
  return out;
}

/**
 * Canonical signing string for a whole envelope (all stamp signatures kept;
 * single-object `signed_by` normalized to a one-element array). Field-id-keyed,
 * JCS-serialized.
 */
export function canonicalizeForSigning(envelope: Obj): string {
  return canonicalStringify(reKey(envelope));
}

/**
 * Canonical signing string for stamp `index` in the chain (§5.4): `signed_by` is
 * sliced to chain[0..index] and stamp `index`'s OWN signature is stripped (a
 * stamp cannot sign its own signature); earlier stamps keep their signatures, so
 * tampering with any earlier stamp breaks this one.
 */
export function canonicalizeForChainStamp(envelope: Obj, index: number): string {
  return canonicalStringify(reKey(envelope, { chainSlice: index }));
}

/** bytes-to-sign = CONTEXT_TAG || UTF-8(canonicalizeForChainStamp(env, index)). */
export function bytesToSign(envelope: Obj, index: number): Uint8Array {
  const canonical = new TextEncoder().encode(canonicalizeForChainStamp(envelope, index));
  const out = new Uint8Array(CONTEXT_TAG_BYTES.length + canonical.length);
  out.set(CONTEXT_TAG_BYTES, 0);
  out.set(canonical, CONTEXT_TAG_BYTES.length);
  return out;
}

// ---------------------------------------------------------------------------
// parseAndCanonicalize — I-JSON (dup-key reject + non-finite reject) then canon
// ---------------------------------------------------------------------------

export type CanonResult =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Parse RAW JSON TEXT under the I-JSON constraint (D2) and canonicalize. A
 * duplicate top-level (or nested) key is rejected (`duplicate-key`, never
 * silently shadowed), and a non-finite number token (`1e400` → Infinity) is
 * rejected (`non-finite-number`, §3.1). Both are expressible only against raw
 * text — a permissive `JSON.parse` collapses a duplicate before canonicalization
 * ever sees it.
 */
export function parseAndCanonicalize(text: string): CanonResult {
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text);
  } catch (err) {
    const reason = (err as { reason?: string }).reason;
    return { ok: false, reason: reason ?? `parse-error:${(err as Error).message}` };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: "not-an-object" };
  try {
    return { ok: true, value: canonicalizeForSigning(parsed) };
  } catch (err) {
    if ((err as Error).message.includes("non-finite")) return { ok: false, reason: "non-finite-number" };
    return { ok: false, reason: `canonicalize-error:${(err as Error).message}` };
  }
}

/** Error carrying a stable reason token for the strict parser. */
class StrictJsonError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "StrictJsonError";
  }
}

/**
 * A minimal strict recursive-descent JSON parser (I-JSON): rejects duplicate
 * object keys (`duplicate-key`) at ANY depth and non-finite numbers
 * (`non-finite-number`). Written by hand because `JSON.parse` silently collapses
 * duplicates before any hook can observe them — the trust root cannot rely on it.
 */
export function parseStrictJson(text: string): unknown {
  let i = 0;

  const err = (reason: string): never => {
    throw new StrictJsonError(reason);
  };

  const ws = (): void => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };

  const parseValue = (): unknown => {
    ws();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return parseNumber();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    return err("parse-error:unexpected-token");
  };

  const parseObject = (): Obj => {
    i++; // {
    const out: Obj = {};
    const seen = new Set<string>();
    ws();
    if (text[i] === "}") { i++; return out; }
    for (;;) {
      ws();
      if (text[i] !== '"') err("parse-error:expected-key");
      const key = parseString();
      if (seen.has(key)) err("duplicate-key");
      seen.add(key);
      ws();
      if (text[i] !== ":") err("parse-error:expected-colon");
      i++;
      out[key] = parseValue();
      ws();
      const ch = text[i];
      if (ch === ",") { i++; continue; }
      if (ch === "}") { i++; return out; }
      err("parse-error:expected-comma-or-brace");
    }
  };

  const parseArray = (): unknown[] => {
    i++; // [
    const out: unknown[] = [];
    ws();
    if (text[i] === "]") { i++; return out; }
    for (;;) {
      out.push(parseValue());
      ws();
      const ch = text[i];
      if (ch === ",") { i++; continue; }
      if (ch === "]") { i++; return out; }
      err("parse-error:expected-comma-or-bracket");
    }
  };

  const parseString = (): string => {
    i++; // opening quote
    let s = "";
    for (;;) {
      const c = text[i];
      if (c === undefined) throw new StrictJsonError("parse-error:unterminated-string");
      if (c === '"') { i++; return s; }
      if (c === "\\") {
        const e = text[i + 1];
        switch (e) {
          case '"': s += '"'; break;
          case "\\": s += "\\"; break;
          case "/": s += "/"; break;
          case "b": s += "\b"; break;
          case "f": s += "\f"; break;
          case "n": s += "\n"; break;
          case "r": s += "\r"; break;
          case "t": s += "\t"; break;
          case "u": {
            const hex = text.slice(i + 2, i + 6);
            s += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default: err("parse-error:bad-escape");
        }
        i += 2;
        continue;
      }
      s += c;
      i++;
    }
  };

  const isDigit = (ch: string | undefined): boolean =>
    ch !== undefined && ch >= "0" && ch <= "9";

  const parseNumber = (): number => {
    const start = i;
    if (text[i] === "-") i++;
    while (isDigit(text[i])) i++;
    if (text[i] === ".") { i++; while (isDigit(text[i])) i++; }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      while (isDigit(text[i])) i++;
    }
    const n = Number(text.slice(start, i));
    if (!Number.isFinite(n)) err("non-finite-number");
    return n;
  };

  const value = parseValue();
  ws();
  if (i !== text.length) err("parse-error:trailing-content");
  return value;
}
