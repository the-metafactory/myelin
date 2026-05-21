import { signAsync } from "@noble/ed25519";
import type { MyelinEnvelope } from "../types";
import { canonicalizeForSigning } from "./canonicalize";
import { getSignedByChain, MAX_CHAIN_LENGTH } from "./chain";
import { DID_RE } from "./types";
import type { SignedByEd25519, StampRole } from "./types";
import { bytesToBase64, bytesFromBase64 } from "../base64";

export interface SignEnvelopeOptions {
  /** Semantic role of the new stamp inside the chain. See {@link StampRole}. */
  role?: StampRole;
}

/**
 * Signs a MyelinEnvelope with an Ed25519 private key (myelin#31 chain mode).
 *
 * Behavior:
 * - If the envelope has no `signed_by`, a one-element chain is produced.
 * - If the envelope already has stamps, a NEW stamp is appended. The new
 *   stamp's signature input is the canonical bytes of
 *   `{...envelope, signed_by: [...prior, newStampWithoutSignature]}` —
 *   so the new stamp commits to the entire prior chain. Tampering with
 *   any earlier stamp invalidates the new one.
 *
 * The legacy "cannot re-sign" guard is removed — chain append is the
 * primary new affordance (#31). To prevent accidental double-stamping
 * by the same principal, callers should check the chain themselves.
 */
export async function signEnvelope(
  envelope: MyelinEnvelope,
  privateKey: string,
  principal: string,
  options: SignEnvelopeOptions = {},
): Promise<MyelinEnvelope> {
  if (!DID_RE.test(principal)) {
    throw new Error(`Invalid principal DID: "${principal}" — must match did:mf:<name>`);
  }

  const privKeyBytes = bytesFromBase64(privateKey);
  if (privKeyBytes.length !== 32) {
    throw new Error(`Invalid private key: expected 32-byte Ed25519 seed, got ${privKeyBytes.length} bytes`);
  }

  const priorChain = getSignedByChain(envelope);
  // Defense-in-depth: the validator caps the chain at MAX_CHAIN_LENGTH on
  // the wire boundary; fail fast here so library callers learn of the
  // limit at the affordance they're using, not downstream at validate.
  if (priorChain.length >= MAX_CHAIN_LENGTH) {
    throw new Error(
      `Envelope chain is already at MAX_CHAIN_LENGTH (${MAX_CHAIN_LENGTH}) — cannot append another stamp`,
    );
  }
  const at = new Date().toISOString();
  // R2 emit side (vocabulary migration 2026-05, PR-6) — the signer EMITS
  // the canonical `identity` stamp key. Per the manifest's JetStream-replay
  // note, myelin only *produces* the new vocabulary; the validator still
  // *accepts* the deprecated `principal` key for pre-migration / replayed
  // envelopes. Because `signed_by` is canonicalized as the bytes received,
  // emitting `identity` here makes the signature commit to the `identity`
  // key — exactly what a new-myelin verifier canonicalizes.
  const stampDraft: SignedByEd25519 = {
    method: "ed25519",
    identity: principal,
    signature: "",
    at,
    ...(options.role ? { role: options.role } : {}),
  };

  // Canonical bytes for the new stamp = prior chain (with their signatures intact)
  // + this stamp's metadata sans signature.
  const envelopeForSigning: MyelinEnvelope = {
    ...envelope,
    signed_by: [...priorChain, stampDraft],
  };
  const message = canonicalizeForSigning(envelopeForSigning);
  const signature = await signAsync(message, privKeyBytes);
  const signatureBase64 = bytesToBase64(signature);

  const newStamp: SignedByEd25519 = {
    method: "ed25519",
    identity: principal,
    signature: signatureBase64,
    at,
    ...(options.role ? { role: options.role } : {}),
  };

  return {
    ...envelope,
    signed_by: [...priorChain, newStamp],
  };
}
