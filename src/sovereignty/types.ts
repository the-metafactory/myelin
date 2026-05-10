import type { Classification } from "../types";

export type AuditDecision = "allow" | "block";
export type AuditDirection = "egress" | "ingress";

export type NakReasonCode =
  | "compliance-block:classification-mismatch"
  | "compliance-block:residency-violation"
  | "compliance-block:unknown-principal"
  | "compliance-block:scope-exceeded"
  | "compliance-block:chain-invalid"
  | "compliance-block:partner-unknown";

export type SovereigntyValidationResult =
  | { valid: true }
  | { valid: false; code: NakReasonCode; reason: string };

export interface EgressRule {
  classification: Classification;
  allowed_subjects: string[];
  data_residency_constraints?: Record<string, string[]>;
}

export interface ScopeMapping {
  partner_org: string;
  imported_principals: string[];
  local_scope: string[];
  max_capabilities: string[];
}

export interface SovereigntyPolicy {
  version: 1;
  org: string;
  egress: {
    block_local_escape: boolean;
    rules: EgressRule[];
  };
  ingress: {
    scope_mappings: ScopeMapping[];
    reject_unknown_partners: boolean;
  };
  chain_of_stamps: {
    verify_delegation_sovereignty: boolean;
  };
}

export interface AuditEntry {
  timestamp: string;
  envelope_id: string;
  direction: AuditDirection;
  decision: AuditDecision;
  reason?: string;
  reason_code?: NakReasonCode;
  principal?: string;
  subject: string;
  classification: Classification;
  data_residency: string;
}
