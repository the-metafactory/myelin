import { signAsync } from "@noble/ed25519";
import type { CapabilityAdvertisement, SignedCapabilityRegistration, SigningIdentity } from "./types";
import type { CapabilityStore } from "./store";
import { canonicalizeAdvertisement } from "./canonicalize";
import { readAdvertisementIdentity } from "./advertisement-identity";
import { DID_RE } from "../identity/types";
import { bytesToBase64, bytesFromBase64 } from "../base64";

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
 *   - advertisement.identity matches identity.did (no spoofing)
 *   - DID format
 *   - load ∈ [0, 1]
 *   - maxConcurrent ≥ 1
 *
 * R2 (vocabulary migration 2026-05, PR-9) — the advertisement actor-DID
 * field is read through `readAdvertisementIdentity`, the dual-field
 * transition reader: a transition-window advertisement may still carry
 * the deprecated `principal` key, and an advertisement carrying BOTH
 * `principal` and `identity` is rejected with `dual_field_conflict`.
 * The advertisement is NEVER re-keyed before canonicalization — it is
 * signed bytes-as-received so an old-form advertisement stays verifiable.
 */
export async function signCapabilityRegistration(
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<SignedCapabilityRegistration> {
  // Dual-field transition read of the advertisement actor-DID. Runs
  // BEFORE canonicalization — a both-keys advertisement is refused here.
  const didRead = readAdvertisementIdentity(advertisement as unknown as Record<string, unknown>);
  if (didRead.conflict) {
    throw new Error(`signCapabilityRegistration: ${didRead.error?.message ?? "dual_field_conflict"}`);
  }
  const advertisementDid = didRead.value;
  if (typeof advertisementDid !== "string" || !DID_RE.test(advertisementDid)) {
    throw new Error(`signCapabilityRegistration: invalid DID '${String(advertisementDid)}'`);
  }
  if (advertisementDid !== identity.did) {
    throw new Error(
      `signCapabilityRegistration: advertisement.identity (${advertisementDid}) must match identity.did (${identity.did})`,
    );
  }
  if (!Number.isInteger(advertisement.maxConcurrent) || advertisement.maxConcurrent < 1) {
    throw new Error(`signCapabilityRegistration: maxConcurrent must be a positive integer (got ${advertisement.maxConcurrent})`);
  }
  // `normalized` is built by spreading `advertisement` — the actor-DID key
  // is preserved verbatim (whichever of `principal`/`identity` was
  // supplied). The advertisement is NEVER re-keyed, so the canonical bytes
  // an old-form advertisement was signed over are reproduced exactly.
  const normalized: CapabilityAdvertisement = {
    ...advertisement,
    load: clampLoad(advertisement.load),
    capabilities: [...advertisement.capabilities],
  };

  const bytes = canonicalizeAdvertisement(normalized);
  const privKey = bytesFromBase64(identity.privateKey);
  if (privKey.length !== 32) {
    throw new Error(`signCapabilityRegistration: expected 32-byte private key (got ${privKey.length})`);
  }
  const signature = await signAsync(bytes, privKey);

  return {
    advertisement: normalized,
    // R2 (vocabulary migration 2026-05, PR-9) — discovery's registration
    // stamp now emits the canonical `identity` key on `SignedByEd25519`
    // (the discriminated union landed in PR-6). The stamp DID is NOT part
    // of `canonicalize(advertisement)` — only the advertisement is signed
    // — so switching the emitted key here is wire-safe on its own; it does
    // not invalidate any signature.
    signed_by: {
      method: "ed25519",
      identity: identity.did,
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
 * the identity has no existing registration.
 *
 * R2 (vocabulary migration 2026-05, PR-9) — the existing advertisement's
 * actor-DID is read through `readAdvertisementIdentity` so a stored
 * pre-migration advertisement (carrying `principal`) is still updatable.
 * The re-signed advertisement is rebuilt by spreading `existing` — the
 * actor-DID key is preserved verbatim, never re-keyed.
 */
export async function updateLoad(
  store: CapabilityStore,
  identity_did: string,
  load: number,
  identity: SigningIdentity,
): Promise<void> {
  const existing = await store.get(identity_did);
  if (!existing) {
    throw new Error(`updateLoad: no registration found for ${identity_did}`);
  }
  const existingRead = readAdvertisementIdentity(existing.advertisement as unknown as Record<string, unknown>);
  if (existingRead.conflict) {
    throw new Error(`updateLoad: ${existingRead.error?.message ?? "dual_field_conflict"}`);
  }
  if (existingRead.value !== identity.did) {
    throw new Error(`updateLoad: identity ${identity.did} cannot update registration for ${String(existingRead.value)}`);
  }
  const updated: CapabilityAdvertisement = {
    ...existing.advertisement,
    load: clampLoad(load),
    updatedAt: new Date().toISOString(),
  };
  const registration = await signCapabilityRegistration(updated, identity);
  await store.put(registration);
}
