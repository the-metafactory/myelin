/**
 * ./wire — envelope structural validator (RFC-0003 + RFC-0004 §11.3 result
 * tokens) and standalone stamp-syntax validator.
 *
 * `validateEnvelope` enforces the closed-contract wire grammar and emits the
 * §11.3 result-token enum (`unknown-field`, `id-not-uuid`, `source-arity-
 * mismatch`, `distribution-mode-invalid`, …) instead of a human field-path
 * message. Terminals are consumed from `generated/r/envelope`.
 */

import {
  UUID_RE,
  DATETIME_RE,
  TARGET_ASSISTANT_RE,
  TYPE_RE,
  CAPABILITY_TAG_RE,
} from "./generated/r/envelope";
import { SIGNATURE_RE, SIGNING_METHOD_VALUES } from "./generated/r/envelope-signing";
import { parseDid, resolvePlane } from "./identity";

export type EnvelopeResult =
  | { ok: true; value: { classification: unknown } }
  | { ok: false; reason: string };

type Obj = Record<string, unknown>;

/** Whole-envelope receive bound (RFC-0003 D11 / RFC-0004 §11): 1 MiB. */
export const MAX_ENVELOPE_BYTES = 1_048_576;

const REQUIRED_FIELDS = ["id", "source", "type", "timestamp", "sovereignty", "payload"] as const;

/** Closed top-level contract: 14 signable + the mutable carve-out + channels. */
const ALLOWED_TOP = new Set([
  "id", "source", "type", "timestamp", "sovereignty", "payload", "signed_by",
  "requirements", "sovereignty_required", "deadline", "distribution_mode",
  "target_assistant", "originator", "spec_version",
  "correlation_id", "economics", "extensions", "channels",
]);

const ALLOWED_SOVEREIGNTY = new Set([
  "classification", "data_residency", "max_hop", "frontier_ok", "model_class",
]);

const ALLOWED_ORIGINATOR = new Set(["identity", "attribution"]);

const DISTRIBUTION_MODES = new Set(["offer", "direct", "delegate"]);

const SIGNATURE_MIN_LEN = 88;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const fail = (reason: string): EnvelopeResult => ({ ok: false, reason });

/** Calendar-valid check for a structurally-ISO8601 timestamp. */
function isCalendarValid(ts: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(ts);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || s > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function checkSource(source: string): string | null {
  const p = parseDid(source);
  if (p.ok) return p.value.cls === "agent" ? null : "source-not-agent-class";
  if (source.startsWith("did:mf:agent.")) return "source-arity-mismatch";
  return "source-not-agent-class";
}

/** Validate a whole envelope and return its classification, or a §11.3 token. */
export function validateEnvelope(input: unknown): EnvelopeResult {
  if (!isObj(input)) return fail("not-an-object");

  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_ENVELOPE_BYTES) {
    return fail("envelope-too-large");
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP.has(key)) return fail("unknown-field");
  }
  for (const req of REQUIRED_FIELDS) {
    if (input[req] === undefined) return fail("missing-required-field");
  }

  // id — bare UUID; no urn: prefix (D-…).
  const id = input.id as string;
  if (id.startsWith("urn:")) return fail("id-urn-prefix-forbidden");
  if (!UUID_RE.test(id)) return fail("id-not-uuid");

  // source — agent-class DID with correct arity.
  const srcErr = checkSource(input.source as string);
  if (srcErr) return fail(srcErr);

  // type — 2..5 dot segments.
  if (!TYPE_RE.test(input.type as string)) return fail("type-segment-count");

  // timestamp — uppercase ISO8601, calendar-valid.
  const ts = input.timestamp as string;
  if (!DATETIME_RE.test(ts)) {
    if (DATETIME_RE.test(ts.toUpperCase())) return fail("datetime-lowercase-designator");
    return fail("datetime-not-calendar-valid");
  }
  if (!isCalendarValid(ts)) return fail("datetime-not-calendar-valid");

  // payload — object, never an array.
  if (!isObj(input.payload)) return fail("payload-not-object");

  // sovereignty — closed sub-contract.
  const sov = input.sovereignty;
  if (!isObj(sov)) return fail("payload-not-object");
  for (const key of Object.keys(sov)) {
    if (!ALLOWED_SOVEREIGNTY.has(key)) return fail("unknown-field-in-sovereignty");
  }

  // signed_by — array of well-formed stamps.
  if (input.signed_by !== undefined) {
    if (!Array.isArray(input.signed_by)) return fail("signed-by-not-array");
    for (const stamp of input.signed_by) {
      if (!isObj(stamp)) return fail("signed-by-not-array");
      if ("principal" in stamp) return fail("stamp-legacy-principal-key");
      const idn = stamp.identity;
      if (typeof idn === "string") {
        const pd = parseDid(idn);
        if (pd.ok && resolvePlane(pd.value.cls) === "self-asserted") {
          return fail("self-asserted-in-signed-by");
        }
      }
      const sig = stamp.signature;
      if (typeof sig === "string" && sig.length < SIGNATURE_MIN_LEN) {
        return fail("signature-too-short");
      }
    }
  }

  // distribution_mode + target_assistant coupling.
  const mode = input.distribution_mode as string | undefined;
  if (mode !== undefined && !DISTRIBUTION_MODES.has(mode)) return fail("distribution-mode-invalid");
  if ((mode === "direct" || mode === "delegate") && input.target_assistant === undefined) {
    return fail("target-assistant-required");
  }
  if (input.target_assistant !== undefined && !TARGET_ASSISTANT_RE.test(input.target_assistant as string)) {
    return fail("target-assistant-not-agent");
  }

  // originator — closed sub-contract.
  if (input.originator !== undefined) {
    if (!isObj(input.originator)) return fail("unknown-field-in-originator");
    for (const key of Object.keys(input.originator)) {
      if (!ALLOWED_ORIGINATOR.has(key)) return fail("unknown-field-in-originator");
    }
  }

  // requirements — capability-tag array.
  if (input.requirements !== undefined) {
    const reqs = input.requirements;
    if (!Array.isArray(reqs)) return fail("capability-tag-invalid");
    for (const tag of reqs) {
      if (typeof tag !== "string" || !CAPABILITY_TAG_RE.test(tag)) return fail("capability-tag-invalid");
    }
  }

  return { ok: true, value: { classification: sov.classification } };
}

// ---------------------------------------------------------------------------
// validateStampSyntax — standalone stamp well-formedness (calendar-blind)
// ---------------------------------------------------------------------------

export type StampSyntaxResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate a single `signed_by` stamp's SYNTAX (RFC-0004 §4). Blind to calendar
 * validity of `at` (that is a verify-time freshness concern) — checks the
 * signing method, the legacy `principal` key ban, and the canonical-88 signature
 * form.
 */
export function validateStampSyntax(stamp: unknown): StampSyntaxResult {
  if (!isObj(stamp)) return { ok: false, reason: "stamp-not-object" };
  const method = stamp.method;
  if (typeof method !== "string" || !(SIGNING_METHOD_VALUES as readonly string[]).includes(method)) {
    return { ok: false, reason: "unknown-signing-method" };
  }
  if ("principal" in stamp) return { ok: false, reason: "legacy-principal-key" };
  const sig = stamp.signature;
  if (typeof sig !== "string" || !SIGNATURE_RE.test(sig)) {
    return { ok: false, reason: "signature-wrong-length" };
  }
  return { ok: true };
}
