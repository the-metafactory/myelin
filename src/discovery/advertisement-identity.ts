import type { ValidationError } from "../types";
import { detectDualField, readRenamedField } from "../dual-field";

// R2 (vocabulary migration 2026-05, PR-9) — discovery transition reader
// for the `principal` → `identity` rename on `CapabilityAdvertisement`
// (the actor-DID field) and on the discovery registration `signed_by`
// stamp.
//
// WHY THIS IS A WIRE-SAFETY BOUNDARY
// ----------------------------------
// A `SignedCapabilityRegistration` is a SIGNED object: the agent signs
// `canonicalize(advertisement)` with its own Ed25519 key (see
// `signCapabilityRegistration` in `register.ts`,
// `verifyCapabilityRegistration` in `verify.ts`).
// `canonicalizeAdvertisement` (`canonicalize.ts`) JCS-serializes the
// ENTIRE advertisement object — so the `principal`/`identity` actor-DID
// key is part of the signed canonical bytes. Renaming it therefore has
// the SAME wire-safety profile as PR-6's envelope-level stamp R2 and
// PR-7's dispatch-payload R2:
//
//   - Canonicalization stays correct ONLY if the advertisement is
//     canonicalized bytes-as-received — verbatim, never re-keyed. An
//     old-form advertisement carrying `principal` was signed over bytes
//     containing `"principal"`, so a new-myelin verifier MUST canonicalize
//     that same key to reproduce the signed bytes. This module NEVER
//     re-keys an advertisement; it only reads.
//   - The transition release READS both keys (prefer the canonical
//     `identity`, fall back to the deprecated `principal`).
//   - An advertisement carrying BOTH keys is rejected with the typed
//     `dual_field_conflict` error — the identical conflict-rejection rule
//     PR-6/PR-7/PR-8 apply at every signed trust boundary. Differing
//     values are an attack; identical values an over-eager-producer bug.
//     Either way the record is refused rather than silently coalesced.
//   - myelin EMITS only the canonical `identity` key — both the
//     `CapabilityAdvertisement` interface and the registration `signed_by`
//     stamp now declare `identity`.
//
// The dual-field machinery itself lives in `../dual-field` (introduced in
// PR-6, reused by PR-7/PR-8). This module does NOT reinvent it — the
// conflict-rejection rule is a security boundary and must behave
// identically everywhere.

/**
 * Resolve the actor-DID off a `CapabilityAdvertisement` across the R2
 * transition window.
 *
 * Returns `{ value }` with the canonical `identity` value when present,
 * else the deprecated `principal` value, else `value: undefined` when
 * neither key is set (a malformed advertisement — the caller validates
 * the DID separately).
 *
 * Returns `{ conflict: true }` with a typed `dual_field_conflict` error
 * when the advertisement carries BOTH keys — the caller MUST reject the
 * registration. The conflict check runs before any value is consumed and
 * before any canonicalization, mirroring the envelope-level boundary.
 */
export function readAdvertisementIdentity(
  advertisement: Record<string, unknown>,
): { conflict: boolean; value: unknown; error?: ValidationError } {
  const errors: ValidationError[] = [];
  const conflict = detectDualField(
    advertisement,
    "principal",
    "identity",
    "advertisement.identity",
    errors,
  );
  if (conflict) {
    return { conflict: true, value: undefined, error: errors[0] };
  }
  return {
    conflict: false,
    value: readRenamedField(advertisement, "principal", "identity"),
  };
}
