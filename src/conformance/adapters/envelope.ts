import { validateEnvelope, getActorIdentity } from "../../envelope";
import { canonicalizeForSigning, canonicalizeForChainStamp } from "../../identity/canonicalize";
import { getSignedByChain } from "../../identity/chain";
import type { MyelinEnvelope } from "../../types";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/**
 * Envelope + envelope-signing adapters (RFC-0003 / RFC-0004).
 *
 * Companion to `sovereignty.ts` (the reference module) for the conformance
 * runner (#239). Two spec-ahead-of-code fronts dominate this domain, both
 * ratified in the RFC-alignment §2 debt list (verified 2026-07-17):
 *
 *  1. RESULT-TOKEN VOCABULARY (validateEnvelope). Today's `validateEnvelope`
 *     returns `{ valid, errors:[{ field, message }] }` — a field-path + human
 *     message, NOT the RFC-0004 §11.3 result-token enum ("id-not-uuid",
 *     "unknown-field", "distribution-mode-invalid", …). The invalid vectors
 *     assert those tokens. We surface the impl's ACTUAL signal — the first
 *     error's `field` — as the reason; where that field ≠ the vector's token
 *     (the norm), the runner loud-fails and the vector is manifested to
 *     myelin#238 (§11.3 token enum lands with the ./wire canonicalizer v2).
 *
 *  2. FIELD-ID CANONICALIZER v2 (canonicalize + bytesToSign). The signing
 *     vectors expect the RFC-0004 field-id encoding — keys renumbered `1..7`
 *     ("id"→1, "source"→2, …) plus the CONTEXT_TAG domain separator for
 *     bytesToSign. Today's `canonicalizeForSigning`/`canonicalizeForChainStamp`
 *     emit v1 JCS bytes keyed by the ORIGINAL field NAMES; `bytesToSign` and
 *     the dup-key/non-finite `parseAndCanonicalize` op don't exist at all. The
 *     field-id re-key + CONTEXT_TAG + dup-key reject are canonicalizer v2,
 *     myelin#238 (§4 target arch, W4 ./wire).
 *
 * `validateStampSyntax` has no standalone exported impl (stamp validation is
 * embedded inside `validateEnvelope`); the standalone stamp/chain helpers land
 * with #238. `verifyEnvelopeIdentity` exists but is ASYNC — it cannot be driven
 * by the synchronous `Adapter` contract (`(input) => VectorResult`, no await in
 * the runner) — and independently the vectors assert §11.3 tokens + D0 anchors +
 * small-order-key/canonical-point checks the deployed (noble-default) verifier
 * does not perform; the pinned-equation two-anchor verifier is #238.
 */

function asEnvelope(input: unknown): MyelinEnvelope {
  return (input ?? {}) as MyelinEnvelope;
}

function classificationOf(input: unknown): unknown {
  const s = ((input ?? {}) as Record<string, unknown>).sovereignty;
  return (s as Record<string, unknown> | undefined)?.classification;
}

// Decode canonical signing bytes back to a comparable JS value: the vectors
// express the expected canonical form as a parsed object, so decode UTF-8 and
// JSON.parse. (Today's v1 bytes parse to a NAME-keyed object; the vectors want
// the field-id NUMBER-keyed v2 form — the mismatch is the myelin#238 signal.)
function decodeCanonical(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    // Not valid JSON (should not happen for canonical bytes) — fall back to the
    // raw string so the runner's diff still shows what the impl produced.
    return text;
  }
}

export const envelopeAdapters: Record<string, Adapter> = {
  // RFC-0003 structural validation. valid vectors assert
  // `value:{classification}`; invalid vectors assert an RFC-0004 §11.3 token
  // the impl does not yet emit — we return the first error's field path as the
  // impl's actual reason (→ myelin#238 for the token-vocabulary gap).
  validateEnvelope: (input): VectorResult => {
    const r = validateEnvelope(input);
    if (r.valid) {
      return { ok: true, value: { classification: classificationOf(input) } };
    }
    const first = r.errors[0];
    return { ok: false, reason: first?.field ?? "invalid" };
  },

  // RFC-0004 actor resolution: originator.identity wins, else first stamp DID,
  // else null (unsigned). Impl returns `string | undefined`; map undefined→null
  // to match the vectors' explicit `{actor:null}`.
  getActorIdentity: (input): VectorResult => {
    const actor = getActorIdentity(asEnvelope(input));
    return { ok: true, value: { actor: actor ?? null } };
  },

  // ASYNC impl (`verifyEnvelopeIdentity` returns a Promise) — undriveable by the
  // synchronous Adapter contract — AND behaviourally spec-ahead (§11.3 tokens,
  // D0 anchors, small-order/canonical-point checks, admit-vs-reverify freshness,
  // §7.1 originator binding). The pinned-equation two-anchor verifier is #238.
  verifyEnvelopeIdentity: () => {
    throw new NotImplemented("verifyEnvelopeIdentity", "myelin#238");
  },

  // canonicalizer v1 → v2 gap: impl emits JCS bytes keyed by field NAMES; the
  // vectors expect the field-id NUMBER-keyed v2 form. Callable, so we run it and
  // return the decoded shape — the runner's diff pins the re-key gap (#238).
  canonicalizeForSigning: (input): VectorResult => {
    const bytes = canonicalizeForSigning(asEnvelope(input));
    return { ok: true, value: decodeCanonical(bytes) };
  },

  // No standalone stamp-syntax validator is exported — stamp validation lives
  // inside validateEnvelope; the standalone stamp/chain helpers land with #238.
  validateStampSyntax: () => {
    throw new NotImplemented("validateStampSyntax", "myelin#238");
  },

  // Same field-id re-key gap as canonicalizeForSigning; chain-stamp variant
  // takes `{ envelope, index }`.
  canonicalizeForChainStamp: (input): VectorResult => {
    const i = (input ?? {}) as { envelope?: unknown; index?: number };
    const bytes = canonicalizeForChainStamp(asEnvelope(i.envelope), i.index ?? 0);
    return { ok: true, value: decodeCanonical(bytes) };
  },

  // Parse-with-dup-key-detection + non-finite reject + canonicalize is a single
  // op that does not exist on main (JSON.parse silently dedupes; JCS throws a
  // freetext message, not the "non-finite-number"/"duplicate-key" tokens). The
  // dup-key + non-plain-object reject is canonicalizer v2, #238.
  parseAndCanonicalize: () => {
    throw new NotImplemented("parseAndCanonicalize", "myelin#238");
  },

  // Domain-separated signing bytes (CONTEXT_TAG `metafactory-envelope-signature-v1`
  // + NUL + field-id canonical JSON). No such op exists on main — the CONTEXT_TAG
  // domain separation is canonicalizer v2, #238.
  bytesToSign: () => {
    throw new NotImplemented("bytesToSign", "myelin#238");
  },

  // Chain-coercion shim. The vector pins myelin's CORRECT behaviour (null → []
  // unsigned); it targets the coercion shim `getSignedByChain`/`toSignedByChain`
  // (the exported `normalizeSignedBy` returns an ENVELOPE, not the chain array
  // the vector asserts). Input is the envelope; return the coerced chain.
  normalizeSignedBy: (input): VectorResult => {
    return { ok: true, value: getSignedByChain(asEnvelope(input)) };
  },
};
