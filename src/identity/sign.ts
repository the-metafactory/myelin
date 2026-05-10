import { signAsync } from "@noble/ed25519";
import type { MyelinEnvelope } from "../types";
import { canonicalizeForSigning } from "./canonicalize";
import { DID_RE } from "./types";
import { bytesToBase64, bytesFromBase64 } from "../base64";

/**
 * Signs a MyelinEnvelope with an Ed25519 private key.
 *
 * Build signed_by metadata first (method, principal, at), add to envelope,
 * then canonicalize (which includes signed_by minus signature) and sign.
 * This ensures the signature covers the identity claim itself.
 */
export async function signEnvelope(
  envelope: MyelinEnvelope,
  privateKey: string,
  principal: string,
): Promise<MyelinEnvelope> {
  if (envelope.signed_by) {
    throw new Error("Envelope is already signed — cannot re-sign");
  }
  if (!DID_RE.test(principal)) {
    throw new Error(`Invalid principal DID: "${principal}" — must match did:mf:<name>`);
  }

  const privKeyBytes = bytesFromBase64(privateKey);
  if (privKeyBytes.length !== 32) {
    throw new Error(`Invalid private key: expected 32-byte Ed25519 seed, got ${privKeyBytes.length} bytes`);
  }

  const at = new Date().toISOString();

  // Build envelope with signed_by metadata (no signature yet) for canonicalization
  const envelopeWithMeta: MyelinEnvelope = {
    ...envelope,
    signed_by: {
      method: "ed25519",
      principal,
      signature: "",
      at,
    },
  };

  const message = canonicalizeForSigning(envelopeWithMeta);
  const signature = await signAsync(message, privKeyBytes);
  const signatureBase64 = bytesToBase64(signature);

  return {
    ...envelope,
    signed_by: {
      method: "ed25519",
      principal,
      signature: signatureBase64,
      at,
    },
  };
}
