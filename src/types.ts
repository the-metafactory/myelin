import type { SignedBy } from "./identity/types";
import type { SubjectClassification } from "./classifications";

/**
 * Envelope-side alias for the canonical classification names defined in
 * `./classifications`. Identical type — re-aliased here so envelope-facing
 * code can keep importing `Classification` from `./types` without a churn.
 */
export type Classification = SubjectClassification;
export type ModelClass = 'local-only' | 'frontier' | 'any';

export type SovereigntyRequirement = 'open' | 'selective' | 'strict' | 'bidding';
/**
 * R11 (vocabulary migration 2026-05, PR-6) — `'broadcast'` → `'offer'`.
 * This is the *transition* release: BOTH values are accepted on the wire.
 * `'broadcast'` is deprecated; new publishers emit `'offer'`. The breaking
 * major drops `'broadcast'` and tightens this union to
 * `'offer' | 'direct' | 'delegate'`.
 */
export type DistributionMode = 'broadcast' | 'offer' | 'direct' | 'delegate';

/**
 * Attribution mode for an envelope's {@link Originator} (myelin#160).
 *
 * Names HOW the signer learned the originator identity — not WHO the
 * originator is. Policy engines may treat modes differently (e.g.
 * `federated` claims may require an additional accountability stamp).
 *
 * | mode | meaning |
 * |---|---|
 * | `adapter-resolved` | An adapter (Discord/Slack/Mattermost/HTTP) mapped a non-Myelin identifier to a Myelin principal. Signer attests the mapping was valid at sign time. |
 * | `federated` | The originator claim was relayed from another network. The chain-of-stamps proves the cross-network hop; `originator.identity` names the upstream actor. |
 * | `delegated` | The signer holds delegation credentials for the originator (e.g. a service principal acting on behalf of a network). |
 */
export type AttributionMode = 'adapter-resolved' | 'federated' | 'delegated';

/**
 * Envelope-level originator (myelin#160).
 *
 * Carries the policy-level actor identity separately from the cryptographic
 * `signed_by[]` chain. The chain proves WHO signed; the originator names
 * WHO the signer claims to be acting on behalf of.
 *
 * When absent, the signer is the actor (degenerate case — equivalent to
 * `originator.identity === signed_by[0]` DID). When present,
 * `signed_by` is still verified against the signer's key, and the
 * originator field is consulted by policy engines for attribution.
 *
 * `originator` IS covered by the signature (a signable field) — the
 * signer commits to the attribution claim. Tampering with `originator`
 * invalidates every subsequent stamp.
 *
 * R2 (vocabulary migration 2026-05, PR-6) — the actor-DID field renamed
 * `principal` → `identity`. This is the transition release: the validator
 * accepts either key, canonicalization uses the bytes as received, and a
 * block carrying BOTH is rejected with `dual_field_conflict`.
 */
interface OriginatorBase {
  /** How the signer learned the originator identity. */
  attribution: AttributionMode;
}

/**
 * Originator-DID shape. The actor-DID field is `identity` (R2 breaking cut,
 * vocabulary migration 2026-05). The deprecated `principal` key was removed
 * from the wire — an originator carrying it is now rejected as an unknown
 * field. `identity` xor the old key is no longer modelled; only `identity`.
 */
interface OriginatorDidKey {
  /** DID of the actor whose capabilities this envelope asserts. */
  identity: string;
}

export type Originator = OriginatorBase & OriginatorDidKey;

export interface Sovereignty {
  classification: Classification;
  data_residency: string;
  max_hop: number;
  frontier_ok: boolean;
  model_class: ModelClass;
}

/**
 * F-15: Economics block — token budget, actual usage, billing attribution.
 * Mutable annotation field, intentionally outside the L4 signature so
 * intermediaries can accumulate cost without invalidating attestations.
 * MUST NOT inform security or trust decisions (architecture.md §5.2).
 */
export interface EconomicsBudget {
  /** Maximum total tokens (input + output) permitted. */
  max_tokens?: number;
  /** Maximum cost in USD. */
  max_cost_usd?: number;
  [key: string]: unknown;
}

export interface EconomicsActual {
  /** LLM input tokens consumed. */
  input_tokens?: number;
  /** LLM output tokens generated. */
  output_tokens?: number;
  /** Convenience total — may equal input + output, may not (delegate aggregation). */
  total_tokens?: number;
  /** Lowercase model identifier, e.g., "claude-sonnet-4", "gpt-4o". */
  model?: string;
  /** Execution duration in milliseconds. */
  duration_ms?: number;
  /** Computed cost in USD. */
  cost_usd?: number;
  [key: string]: unknown;
}

export interface Economics {
  /** Publisher-set constraints on resource usage. */
  budget?: EconomicsBudget;
  /** Actual usage populated by executor (and accumulated by hubs in delegate chains). */
  actual?: EconomicsActual;
  /** DID of principal receiving/paying for this work. */
  wallet?: string;
  /** External invoice or tracking reference. */
  billing_ref?: string;
  /** ISO 4217 currency code when not USD. */
  currency?: string;
  [key: string]: unknown;
}

export interface MyelinEnvelope {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  /**
   * Wire grammar version (myelin#B1 / spec_version rollout). Optional
   * integer; `3` is the current grammar. Absent ⇒ a legacy pre-field
   * envelope. A SIGNABLE field — but because absent keys are never
   * included in the canonical payload, envelopes without it verify exactly
   * as before it existed.
   *
   * Phase 4a (this release): ACCEPTED and signed when present, but
   * `createEnvelope` does NOT emit it yet — verifiers before emitters, per
   * the migration doctrine. Emission lands in a later, separately-released
   * phase (B2).
   */
  spec_version?: number;
  correlation_id?: string;
  sovereignty: Sovereignty;
  /**
   * Identity chain (myelin#31). Each stamp signs the canonical bytes of
   * the envelope *including the prior chain* — tampering with any earlier
   * stamp invalidates every subsequent stamp's signature. See
   * `docs/identity.md` §Chain of stamps.
   *
   * Internally always an array. The wire format ALSO accepts a single
   * `SignedBy` object as a back-compat shim — `validateEnvelope` and
   * `normalizeSignedBy` coerce it to a one-element chain.
   */
  signed_by?: SignedBy[];
  economics?: Economics;
  extensions?: Record<string, unknown>;
  payload: Record<string, unknown>;
  // F-021 task routing fields (all optional; absent = offer / no filter)
  requirements?: string[];
  sovereignty_required?: SovereigntyRequirement;
  deadline?: string;
  distribution_mode?: DistributionMode;
  /**
   * F-021: required when `distribution_mode` is `direct` or `delegate`.
   * DID of the receiving assistant — the @-target named assistant (the
   * `@`-segment of a Tasks-Domain subject names an assistant, not a
   * principal; see CONTEXT.md).
   *
   * R13 (vocabulary migration 2026-05, breaking cut) — renamed from
   * `target_principal`; the deprecated key was removed from the wire.
   * `target_assistant` is a SIGNABLE field.
   */
  target_assistant?: string;
  /**
   * myelin#160 — policy-level actor identity, separate from the
   * cryptographic `signed_by` chain. See {@link Originator}.
   */
  originator?: Originator;
}

export interface CreateEnvelopeInput {
  source: string;
  type: string;
  sovereignty: Sovereignty;
  payload: Record<string, unknown>;
  correlation_id?: string;
  extensions?: Record<string, unknown>;
  economics?: Economics;
  // F-021 task routing fields
  requirements?: string[];
  sovereignty_required?: SovereigntyRequirement;
  deadline?: string;
  distribution_mode?: DistributionMode;
  /** F-021: DID of the receiving assistant (R13 — renamed from `target_principal`, breaking cut). */
  target_assistant?: string;
  /** myelin#160 — see {@link Originator}. */
  originator?: Originator;
}

export interface ValidationError {
  field: string;
  message: string;
  /**
   * Optional machine-readable error code. Present for failures consumers
   * may need to branch on programmatically rather than string-matching.
   *
   * `dual_field_conflict` (vocabulary migration 2026-05, PR-6) — a wire
   * field carries BOTH its deprecated and its canonical name (e.g. a
   * dispatch `payload` with both `principal` and `identity`). At a
   * signed-envelope trust boundary the validator refuses to choose:
   * differing values are an attack vector, identical values an over-eager
   * producer bug. Either way the envelope is rejected. The check runs BEFORE
   * any canonicalization or signature-bytes derivation. (The `originator`
   * rename is now a clean R2 breaking cut and no longer uses this path.)
   */
  code?: 'dual_field_conflict';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
