import { signAsync } from "@noble/ed25519";
import type { CapabilityAdvertisement, SignedCapabilityRegistration, SigningIdentity } from "./types";
import type { CapabilityStore } from "./store";
import { canonicalizeAdvertisement } from "./canonicalize";
import { DID_RE } from "../identity/types";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function clampLoad(load: number): number {
  if (!Number.isFinite(load)) {
    throw new Error(`registerCapabilities: load must be finite (got ${load})`);
  }
  if (load < 0) return 0;
  if (load > 1) return 1;
  return load;
}

/**
 * Build a SignedCapabilityRegistration: canonicalize the advertisement,
 * sign with the identity's Ed25519 private key, return the bundle. Does
 * not publish; caller invokes store.put() (or via registerCapabilities
 * helper).
 *
 * Validates:
 *   - advertisement.principal matches identity.did (no spoofing)
 *   - DID format
 *   - load ∈ [0, 1]
 *   - maxConcurrent ≥ 1
 */
export async function signCapabilityRegistration(
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<SignedCapabilityRegistration> {
  if (!DID_RE.test(advertisement.principal)) {
    throw new Error(`signCapabilityRegistration: invalid DID '${advertisement.principal}'`);
  }
  if (advertisement.principal !== identity.did) {
    throw new Error(
      `signCapabilityRegistration: advertisement.principal (${advertisement.principal}) must match identity.did (${identity.did})`,
    );
  }
  if (!Number.isInteger(advertisement.maxConcurrent) || advertisement.maxConcurrent < 1) {
    throw new Error(`signCapabilityRegistration: maxConcurrent must be a positive integer (got ${advertisement.maxConcurrent})`);
  }
  const normalized: CapabilityAdvertisement = {
    ...advertisement,
    load: clampLoad(advertisement.load),
    capabilities: [...advertisement.capabilities],
  };

  const bytes = canonicalizeAdvertisement(normalized);
  const privKey = new Uint8Array(Buffer.from(identity.privateKey, "base64"));
  if (privKey.length !== 32) {
    throw new Error(`signCapabilityRegistration: expected 32-byte private key (got ${privKey.length})`);
  }
  const signature = await signAsync(bytes, privKey);

  return {
    advertisement: normalized,
    signed_by: {
      method: "ed25519",
      principal: identity.did,
      signature: bytesToBase64(signature),
      at: new Date().toISOString(),
    },
  };
}

/**
 * Sign + put in one call. The default agent self-registration entry
 * point.
 */
export async function registerCapabilities(
  store: CapabilityStore,
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<void> {
  const registration = await signCapabilityRegistration(advertisement, identity);
  await store.put(registration);
}

/**
 * Update an existing registration's load. Reads the current entry from
 * the store, updates load + updatedAt, re-signs, and puts. Throws if
 * the principal has no existing registration.
 */
export async function updateLoad(
  store: CapabilityStore,
  principal: string,
  load: number,
  identity: SigningIdentity,
): Promise<void> {
  const existing = await store.get(principal);
  if (!existing) {
    throw new Error(`updateLoad: no registration found for ${principal}`);
  }
  if (existing.advertisement.principal !== identity.did) {
    throw new Error(`updateLoad: identity ${identity.did} cannot update registration for ${existing.advertisement.principal}`);
  }
  const updated: CapabilityAdvertisement = {
    ...existing.advertisement,
    load: clampLoad(load),
    updatedAt: new Date().toISOString(),
  };
  const registration = await signCapabilityRegistration(updated, identity);
  await store.put(registration);
}
