import { verifyAsync } from "@noble/ed25519";
import type { SignedCapabilityRegistration, CapabilityVerificationResult } from "./types";
import type { IdentityRegistry } from "../identity/registry";
import { canonicalizeAdvertisement } from "./canonicalize";
import { bytesFromBase64 } from "../base64";

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Verify a SignedCapabilityRegistration:
 *   1. signed_by.principal matches advertisement.principal (anti-spoof)
 *   2. Public key resolves from registry
 *   3. Ed25519 signature valid over canonical(advertisement)
 *   4. signed_by.at within clock skew tolerance
 */
export async function verifyCapabilityRegistration(
  registration: SignedCapabilityRegistration,
  registry: IdentityRegistry,
  options?: { clockSkewMs?: number },
): Promise<CapabilityVerificationResult> {
  const { advertisement, signed_by } = registration;

  if (signed_by.principal !== advertisement.principal) {
    return {
      status: "rejected",
      reason: `principal mismatch: signed_by=${signed_by.principal} advertisement=${advertisement.principal}`,
    };
  }

  const principal = registry.resolve(advertisement.principal);
  if (!principal) {
    return { status: "rejected", reason: `unknown principal: ${advertisement.principal}` };
  }

  const skewMs = options?.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const at = Date.parse(signed_by.at);
  if (Number.isNaN(at)) {
    return { status: "rejected", reason: `invalid signed_by.at: ${signed_by.at}` };
  }
  const drift = Math.abs(Date.now() - at);
  if (drift > skewMs) {
    return { status: "rejected", reason: `clock skew exceeded: ${drift}ms > ${skewMs}ms tolerance` };
  }

  let publicKey: Uint8Array;
  try {
    publicKey = bytesFromBase64(principal.public_key);
  } catch {
    return { status: "rejected", reason: `invalid public_key encoding for ${advertisement.principal}` };
  }

  const message = canonicalizeAdvertisement(advertisement);
  let signature: Uint8Array;
  try {
    signature = bytesFromBase64(signed_by.signature);
  } catch {
    return { status: "rejected", reason: "invalid signature encoding" };
  }

  let valid: boolean;
  try {
    valid = await verifyAsync(signature, message, publicKey);
  } catch (err) {
    return { status: "rejected", reason: `signature verification threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!valid) {
    return { status: "rejected", reason: "signature does not verify" };
  }

  return { status: "verified", principal: advertisement.principal, advertisement };
}
