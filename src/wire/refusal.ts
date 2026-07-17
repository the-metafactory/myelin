/**
 * ./wire — refusal object + admission-key codec + multi-tier evaluation
 * (RFC-0010). The closed refusal-kind registry with transient/permanent
 * projection, kind well-formedness, the chartered seam rule, the admission-key
 * principal-segment codec (VALIDATE-not-coerce), and two-phase multi-tier
 * evaluation. Terminals from `generated/r/rate-limit`.
 */

import {
  REFUSAL_KIND_VALUES,
  KEY_SEGMENT_RE,
  type RefusalKind,
} from "./generated/r/rate-limit";

export type RefusalResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

type Obj = Record<string, unknown>;

const KNOWN_KINDS = new Set<string>(REFUSAL_KIND_VALUES);
/** Only `not_now` is transient/retryable; every other closed kind is permanent. */
function isTransient(kind: RefusalKind): boolean {
  return kind === "not_now";
}

/**
 * Project a refusal object to its closed kind + transient flag (§2.2). An
 * unknown kind falls back to `{kind:null, transient:null}` (fail-open readout —
 * an unrecognized refusal is neither trusted-transient nor trusted-permanent).
 */
export function parseRefusalObject(input: unknown): RefusalResult<{
  kind: RefusalKind | null;
  transient: boolean | null;
}> {
  const kind = (input as Obj | null)?.kind;
  if (typeof kind === "string" && KNOWN_KINDS.has(kind)) {
    return { ok: true, value: { kind: kind as RefusalKind, transient: isTransient(kind as RefusalKind) } };
  }
  return { ok: true, value: { kind: null, transient: null } };
}

/**
 * Kind-level well-formedness (§2.3). `not_now` REQUIRES `retry_after_ms`;
 * `disposition:"term"` is FORBIDDEN on an admission refusal (a rate/admission
 * gate refusal is never terminal).
 */
export function classifyRefusalKind(input: unknown): RefusalResult<{ kind: string }> {
  const o = (input ?? {}) as Obj;
  if (o.kind === "not_now" && o.retry_after_ms === undefined) {
    return { ok: false, reason: "retry-after-ms-required" };
  }
  if (o.disposition === "term") {
    return { ok: false, reason: "term-forbidden-for-admission" };
  }
  return { ok: true, value: { kind: String(o.kind) } };
}

/**
 * The chartered seam rule (§2.4): when a refusal carries both a co-transported
 * top-level `final_reason` (the 0007 token) and a nested refusal object, the
 * mirror kind MUST equal the co-carried token, else `seam-mismatch`.
 */
export function checkSeamConsistency(input: unknown): RefusalResult<{ wellFormed: true }> {
  const o = (input ?? {}) as Obj;
  const finalReason = o.final_reason;
  const nestedKind = (o.reason as Obj | undefined)?.kind;
  if (
    typeof finalReason === "string" &&
    typeof nestedKind === "string" &&
    finalReason !== nestedKind
  ) {
    return { ok: false, reason: "seam-mismatch" };
  }
  return { ok: true, value: { wellFormed: true } };
}

/**
 * Admission-key principal-segment codec (§3.3): VALIDATE-not-coerce. The key is
 * `{counter}.{tier}...`; only the `principal` tier yields a principal segment,
 * and that segment is validated (uppercase/underscore REJECT — never normalized
 * onto a shared KV key). A non-principal tier is `reserved-tier`.
 */
export function admissionKeyPrincipalSegment(key: string): RefusalResult<{ principal: string }> {
  const parts = key.split(".");
  // {counter}.{tier}.{segment}: rate.principal.amt-surface
  const tier = parts[1];
  const seg = parts[2];
  if (tier !== "principal") return { ok: false, reason: "reserved-tier" };
  if (seg === undefined || !KEY_SEGMENT_RE.test(seg)) return { ok: false, reason: "charset-violation" };
  return { ok: true, value: { principal: seg } };
}

/**
 * Two-phase multi-tier evaluation (§3.5): every tier is evaluated read-only; the
 * FIRST refusing tier wins and NOTHING is consumed (refuse read-only). Only when
 * ALL tiers admit are ALL of them consumed (all-or-none).
 */
export function evaluateMultiTier(input: unknown): RefusalResult<{
  decision: "admit" | "refuse";
  refusedBy?: string;
  consumed: string[];
}> {
  const tiers = ((input ?? {}) as { tiers?: { key: string; decision: string }[] }).tiers ?? [];
  const refusing = tiers.find((t) => t.decision === "refuse");
  if (refusing) {
    return { ok: true, value: { decision: "refuse", refusedBy: refusing.key, consumed: [] } };
  }
  return { ok: true, value: { decision: "admit", consumed: tiers.map((t) => t.key) } };
}
