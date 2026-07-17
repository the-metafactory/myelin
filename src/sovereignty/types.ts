import type { Classification } from "../types";

export type AuditDecision = "allow" | "block";
export type AuditDirection = "egress" | "ingress";

export type NakReasonCode =
  | "compliance-block:classification-mismatch"
  | "compliance-block:residency-violation"
  | "compliance-block:unknown-principal"
  | "compliance-block:scope-exceeded"
  | "compliance-block:chain-invalid"
  | "compliance-block:partner-unknown"
  | "compliance-block:max-hop-exceeded";

export type SovereigntyValidationResult =
  | { valid: true }
  | { valid: false; code: NakReasonCode; reason: string };

export interface EgressRule {
  classification: Classification;
  allowed_subjects: string[];
  data_residency_constraints?: Record<string, string[]>;
}

/**
 * Default scope/capability ceiling applied to an UNMAPPED principal in
 * permissive mode (`reject_unknown_partners: false`) — RFC-0005 §6.2 (grill
 * D6, closes the OD-5 trust inversion). The §6.3 checks run against this
 * default exactly as they run against a mapping, so an undeclared stranger is
 * no longer unconditionally allowed.
 *
 * Both members are OPTIONAL and config-supplied. When `local_scope` is absent
 * the built-in default is `["federated.>"]` (federated ingress admits only
 * federated subjects — a local.* escalation target is refused). When
 * `max_capabilities` is absent the capability dimension is unconstrained
 * (subject scope alone bounds the stranger); an operator tightens it here.
 */
export interface DefaultIngressCeiling {
  local_scope?: string[];
  max_capabilities?: string[];
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

/**
 * A non-local substrate the principal declares inside their trust
 * boundary (DD-122, meta-factory `design/design-decisions.md`): the
 * principal boundary extends to principal-owned cloud tenancy iff
 * declared here. Deny-by-default — an absent `trusted_substrates`
 * section or an unmatched entry means a component must not consume or
 * produce `local`-classified traffic from that substrate.
 *
 * This section is the declared-intent + audit surface; DD-122 point 3
 * assigns enforcement to scoped NSC credentials provisioned against
 * it — an external infrastructure step this module neither performs nor
 * verifies. Nothing in-process can stop a substrate that was never
 * declared — what this enables is the inverse: a runtime that loads
 * the policy can refuse to start on an undeclared substrate
 * (`isSubstrateTrusted` in `substrates.ts`).
 */
export interface TrustedSubstrate {
  /** Substrate provider slug, e.g. `cloudflare`. */
  provider: string;
  /**
   * Principal-owned tenancy identifier within the provider — e.g. a
   * Cloudflare account id. Opaque to myelin; compared by exact string
   * equality.
   */
  tenancy: string;
  /** Component roles allowed to run on this substrate, e.g. `reflex-edge`. */
  roles: string[];
  /**
   * DD-122 point 4 resolution (a): declared acceptance that payload
   * plaintext at rest on this substrate is inside the boundary. Roles
   * that persist impulse/decision payloads (e.g. `reflex-edge` writing
   * decision rows to D1) require `true`; a `false` entry trusts the
   * substrate for transit/compute only. Runtimes that persist payloads
   * must self-assert this flag — `isSubstrateTrusted` alone does not
   * check it (see `substrates.ts`).
   */
  data_residency_accepted: boolean;
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
    /**
     * OPTIONAL default ceiling for the permissive branch (RFC-0005 §6.2, D6).
     * Absent → built-in default (`local_scope: ["federated.>"]`, unbounded
     * capabilities). Never grants an unmapped stranger unconditional access.
     */
    default_scope?: DefaultIngressCeiling;
  };
  chain_of_stamps: {
    verify_delegation_sovereignty: boolean;
  };
  /**
   * Non-local substrates declared inside the principal boundary
   * (DD-122). OPTIONAL and deny-by-default: omitting the section is
   * valid and equivalent to an empty list — no non-local substrate is
   * trusted. Pre-existing policy JSON therefore loads unchanged.
   */
  trusted_substrates?: TrustedSubstrate[];
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
