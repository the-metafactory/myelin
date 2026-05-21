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
  /**
   * The federation peer network this mapping imports from. Renamed
   * `partner_org` → `partner_network` (vocabulary migration 2026-05,
   * PR-8 / R4) — it names the network on the other side of a
   * federation handshake, which is exactly the `network` concept.
   *
   * `SovereigntyPolicy` is local operator config persisted in the
   * `SOVEREIGNTY_POLICY` KV bucket — it does NOT travel inside the
   * signed envelope `sovereignty` wire field (that is the unrelated
   * `Sovereignty` interface in `src/types.ts`). The rename is
   * therefore a plain config rename, not a signed-canonical wire
   * change; `validateScopeMapping` accepts the deprecated key on read
   * for one minor cycle so a policy JSON written pre-migration still
   * loads.
   */
  partner_network: string;
  imported_principals: string[];
  local_scope: string[];
  max_capabilities: string[];
}

export interface SovereigntyPolicy {
  version: 1;
  /**
   * The principal that owns this sovereignty policy. Renamed
   * `org` → `network` (vocabulary migration 2026-05, PR-8 / R4).
   * Config field — see the note on `ScopeMapping.partner_network`.
   */
  network: string;
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
  /**
   * The attesting identity (last stamp's DID) for the audited
   * envelope. Renamed `principal` → `identity` (vocabulary migration
   * 2026-05, PR-8 / R2) for consistency with the stamp-level
   * `signed_by[].identity` rename. The audit entry is observability
   * JSON published to the `_AUDIT` JetStream stream — it is never
   * canonicalized or signed, so this is a plain field rename (no
   * dual-key conflict machinery: it is not a signed-envelope trust
   * boundary).
   */
  identity?: string;
  subject: string;
  classification: Classification;
  data_residency: string;
}
