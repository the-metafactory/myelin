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

export interface MyelinEnvelope {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  correlation_id?: string;
  sovereignty: Sovereignty;
  signed_by?: SignedBy;
  economics?: Record<string, unknown>;
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
