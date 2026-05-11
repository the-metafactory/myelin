import type { SignedBy } from "./identity/types";

export type Classification = 'local' | 'federated' | 'public';
export type ModelClass = 'local-only' | 'frontier' | 'any';

export type SovereigntyRequirement = 'open' | 'selective' | 'strict' | 'bidding';
export type DistributionMode = 'broadcast' | 'direct' | 'delegate';

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
  // F-021 task routing fields (all optional; absent = broadcast / no filter)
  requirements?: string[];
  sovereignty_required?: SovereigntyRequirement;
  deadline?: string;
  distribution_mode?: DistributionMode;
  target_principal?: string;
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
  target_principal?: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
