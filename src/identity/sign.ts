import { signAsync } from "@noble/ed25519";
import type { MyelinEnvelope } from "../types";
import { canonicalizeForSigning } from "./canonicalize";
import { DID_RE } from "./types";

/**
 * Signs a MyelinEnvelope with an Ed25519 private key.
 *
 * Uses canonicalizeForSigning() to produce the deterministic signing payload,
 * then signs with @noble/ed25519.
 *
 * @param envelope - The envelope to sign (must not already have signed_by)
 * @param privateKey - Base64-encoded Ed25519 private key (32 bytes seed)
 * @param principal - DID identifier, e.g. "did:mf:echo"
 * @returns A new envelope with signed_by populated (original is not mutated)
 * @throws If the envelope already has a signed_by field
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

  const privKeyBytes = new Uint8Array(Buffer.from(privateKey, "base64"));
  const message = canonicalizeForSigning(envelope);
  const signature = await signAsync(message, privKeyBytes);
  const signatureBase64 = Buffer.from(signature).toString("base64");

  return {
    ...envelope,
    signed_by: {
      method: "ed25519",
      principal,
      signature: signatureBase64,
      at: new Date().toISOString(),
    },
  };
}
