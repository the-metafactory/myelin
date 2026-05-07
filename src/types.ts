import type { SignedBy } from "./identity/types";

export type Classification = 'local' | 'federated' | 'public';
export type ModelClass = 'local-only' | 'frontier' | 'any';

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
}

export interface CreateEnvelopeInput {
  source: string;
  type: string;
  sovereignty: Sovereignty;
  payload: Record<string, unknown>;
  correlation_id?: string;
  extensions?: Record<string, unknown>;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
