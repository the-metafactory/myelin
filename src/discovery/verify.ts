import { verifyAsync } from "@noble/ed25519";
import type { SignedCapabilityRegistration, CapabilityVerificationResult } from "./types";
import type { IdentityRegistry } from "../identity/registry";
import { stampIdentityDid } from "../identity/types";
import { canonicalizeAdvertisement } from "./canonicalize";
import { readAdvertisementIdentity } from "./advertisement-identity";
import { bytesFromBase64 } from "../base64";

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Verify a SignedCapabilityRegistration:
 *   1. signed_by stamp DID matches advertisement actor-DID (anti-spoof)
 *   2. Public key resolves from registry
 *   3. Ed25519 signature valid over canonical(advertisement)
 *   4. signed_by.at within clock skew tolerance
 *
 * R2 (vocabulary migration 2026-05, PR-9) — both the stamp DID and the
 * advertisement actor-DID are read through transition-aware accessors:
 *   - the `signed_by` stamp DID via `stampIdentityDid` (PR-6 accessor,
 *     resolves either the `identity` or deprecated `principal` arm);
 *   - the advertisement actor-DID via `readAdvertisementIdentity`, the
 *     dual-field reader — a both-keys advertisement is rejected with
 *     `dual_field_conflict` BEFORE any canonicalization.
 * The advertisement is canonicalized bytes-as-received (never re-keyed),
 * so a pre-migration advertisement carrying `principal` still verifies.
 */
export async function verifyCapabilityRegistration(
  registration: SignedCapabilityRegistration,
  registry: IdentityRegistry,
  options?: { clockSkewMs?: number },
): Promise<CapabilityVerificationResult> {
  const { advertisement, signed_by } = registration;

  // Dual-field transition read of the advertisement actor-DID. Runs
  // BEFORE canonicalization — a both-keys advertisement is refused here,
  // so an attacker cannot canonicalize one form and have a consumer parse
  // the other.
  const advRead = readAdvertisementIdentity(advertisement as unknown as Record<string, unknown>);
  if (advRead.conflict) {
    return { status: "rejected", reason: advRead.error?.message ?? "dual_field_conflict" };
  }
  const advertisementDid = advRead.value;
  if (typeof advertisementDid !== "string") {
    return { status: "rejected", reason: "advertisement missing identity" };
  }

  // Stamp DID resolves across the R2 transition via the PR-6 accessor.
  const stampDid = stampIdentityDid(signed_by);
  if (stampDid !== advertisementDid) {
    return {
      status: "rejected",
      reason: `identity mismatch: signed_by=${String(stampDid)} advertisement=${advertisementDid}`,
    };
  }

  const identity = registry.resolve(advertisementDid);
  if (!identity) {
    return { status: "rejected", reason: `unknown identity: ${advertisementDid}` };
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
    publicKey = bytesFromBase64(identity.public_key);
  } catch {
    return { status: "rejected", reason: `invalid public_key encoding for ${advertisementDid}` };
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

  return { status: "verified", identity: advertisementDid, advertisement };
}
