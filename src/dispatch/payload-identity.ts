import type { ValidationError } from "../types";
import { detectDualField, readRenamedField } from "../dual-field";

// R2 (vocabulary migration 2026-05, PR-7) — dispatch-payload transition
// reader for the `principal` → `identity` rename on the lifecycle payload
// interfaces (`AssignedPayload`, `StartedPayload`, `ProgressPayload`,
// `CompletedPayload`, `FailedPayload`, `AbortedPayload`).
//
// WHY THIS IS A WIRE-SAFETY BOUNDARY
// ----------------------------------
// The dispatch lifecycle payloads ride inside the envelope `payload`
// field. `payload` is a SIGNABLE field — part of the JCS-canonicalized
// signed content. So renaming a key INSIDE a dispatch payload has the
// SAME wire-safety profile as PR-6's envelope-level R2 rename:
//
//   - Canonicalization stays correct because PR-6 canonicalizes `payload`
//     bytes-as-received (verbatim, never re-keyed). An old-form payload
//     carrying `principal` still verifies — this module NEVER re-keys a
//     payload; it only reads.
//   - The transition release READS both keys (prefer the new `identity`,
//     fall back to the deprecated `principal`).
//   - A payload carrying BOTH keys is rejected with the typed
//     `dual_field_conflict` error — the identical conflict-rejection rule
//     PR-6 applies at the envelope trust boundary. Differing values are
//     an attack; identical values an over-eager-producer bug. Either way
//     the payload is refused rather than silently coalesced.
//   - myelin EMITS only the new `identity` key (the lifecycle payload
//     interfaces declare `identity`; emitters spread caller input through
//     verbatim, so callers passing `identity` produce new-vocabulary
//     payloads).
//
// cortex's dispatch-listener consumes these payloads — it MUST use this
// reader (or an equivalent dual-read) while it still replays a
// pre-migration EVENTS stream. See the manifest JetStream-replay note.

/**
 * Resolve the actor-DID off a dispatch lifecycle payload across the R2
 * transition window.
 *
 * Returns `{ value }` with the canonical `identity` value when present,
 * else the deprecated `principal` value, else `value: undefined` when
 * neither key is set (valid for `FailedPayload` / `AbortedPayload`, whose
 * identity field is optional).
 *
 * Returns `{ conflict: true }` with a typed `dual_field_conflict` error
 * when the payload carries BOTH keys — the caller MUST reject the payload.
 * The conflict check runs before any value is consumed, mirroring the
 * envelope-level boundary.
 */
export function readPayloadIdentity(
  payload: Record<string, unknown>,
): { conflict: boolean; value: unknown; error?: ValidationError } {
  const errors: ValidationError[] = [];
  const conflict = detectDualField(
    payload,
    "principal",
    "identity",
    "payload.identity",
    errors,
  );
  if (conflict) {
    return { conflict: true, value: undefined, error: errors[0] };
  }
  return { conflict: false, value: readRenamedField(payload, "principal", "identity") };
}
