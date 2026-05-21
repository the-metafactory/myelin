import type { MyelinEnvelope } from "../types";
import { canonicalStringify } from "../jcs";
import { toSignedByChain } from "./chain";
import type { SignedBy } from "./types";

/**
 * Fields included in the canonical signing payload.
 * Order does not matter here — keys are sorted lexicographically during serialization.
 *
 * signed_by fields (method, identity/principal, at, role, stamped_by) ARE
 * signed — prevents replay/rewrite. The current stamp's signature is
 * excluded from its own input (can't sign itself); earlier stamps in the
 * chain keep their signatures (myelin#31).
 *
 * R2/R13 transition (vocabulary migration 2026-05, PR-6) — the canonical
 * bytes are derived from the envelope's keys AS RECEIVED. This set lists
 * BOTH the deprecated and the renamed key for every wire-field rename
 * (`target_principal` / `target_assistant`; the stamp's `principal` /
 * `identity` lives inside the `signed_by` sub-object and is preserved
 * verbatim because the whole `signed_by` value is copied). Listing both
 * keys is what makes an old-form envelope canonicalize against the bytes
 * its original signer saw — the reader NEVER re-keys before canonicalizing.
 * A wire record carrying BOTH keys is rejected by `validateEnvelope`
 * (`dual_field_conflict`) before this function is ever reached.
 *
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
  // R13 — both keys listed so an envelope carrying the canonical
  // `target_assistant` OR the deprecated `target_principal` canonicalizes
  // against the bytes its signer saw (only ever one is present — the
  // validator rejects both).
  "target_assistant",
  "target_principal",
  // myelin#160 — originator is the policy-attribution claim; signer commits to it
  "originator",
]);

function pickSignableFields(envelope: MyelinEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(envelope)) {
    if (SIGNABLE_FIELDS.has(key)) {
      out[key] = (envelope as unknown as Record<string, unknown>)[key];
    }
  }
  return out;
}

function stripSignature(stamp: SignedBy): Record<string, unknown> {
  const { signature: _sig, ...rest } = stamp as unknown as Record<string, unknown>;
  return rest;
}

function buildChainForSigning(chain: SignedBy[], stripIndex: number | null): Record<string, unknown>[] {
  return chain.map((stamp, i) =>
    stripIndex !== null && i === stripIndex ? stripSignature(stamp) : (stamp as unknown as Record<string, unknown>),
  );
}

/**
 * Produces a deterministic canonical byte representation of a MyelinEnvelope
 * for signing purposes, following RFC 8785 (JSON Canonicalization Scheme).
 *
 * Pre-#31 behavior preserved: when called with a fully-formed envelope
 * whose `signed_by` is a single stamp (back-compat shim) OR a chain, the
 * LAST stamp's signature is the one being signed and is stripped. Earlier
 * stamps keep their signatures (the new stamp commits to them).
 *
 * Unsigned envelopes serialize without a `signed_by` field.
 *
 * @param envelope - The envelope to canonicalize. May contain `signed_by`
 *   as either a single object (legacy) or an array (chain).
 * @returns UTF-8 encoded bytes of the canonical JSON
 */
export function canonicalizeForSigning(envelope: MyelinEnvelope): Uint8Array {
  const signable = pickSignableFields(envelope);
  const chain = toSignedByChain(signable.signed_by);

  if (chain.length === 0) {
    delete signable.signed_by;
  } else {
    // Strip the LAST stamp's signature — that's the one being signed/verified.
    signable.signed_by = buildChainForSigning(chain, chain.length - 1);
  }

  const canonical = canonicalStringify(signable);
  return new TextEncoder().encode(canonical);
}

/**
 * myelin#31 — canonical bytes for verifying stamp at `index` inside an
 * existing chain. Stamps 0..index-1 keep their signatures (the verifier
 * needs the bytes the appender saw); stamp at `index` has its signature
 * stripped.
 *
 * Caller passes the FULL envelope with its complete `signed_by` chain.
 *
 * @throws if index is out of range or the envelope has no chain.
 */
export function canonicalizeForChainStamp(
  envelope: MyelinEnvelope,
  index: number,
): Uint8Array {
  const chain = toSignedByChain(envelope.signed_by);
  if (chain.length === 0) {
    throw new Error("canonicalizeForChainStamp: envelope has no signed_by chain");
  }
  if (index < 0 || index >= chain.length) {
    throw new Error(
      `canonicalizeForChainStamp: index ${index} out of range [0, ${chain.length})`,
    );
  }
  const signable = pickSignableFields(envelope);
  // Slice chain to [0..index] and strip the signature at `index`.
  const truncated = chain.slice(0, index + 1);
  signable.signed_by = buildChainForSigning(truncated, index);
  const canonical = canonicalStringify(signable);
  return new TextEncoder().encode(canonical);
}
