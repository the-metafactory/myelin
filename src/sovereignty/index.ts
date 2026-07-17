export type {
  SovereigntyPolicy,
  EgressRule,
  ScopeMapping,
  DefaultIngressCeiling,
  TrustedSubstrate,
  AuditEntry,
  AuditDecision,
  AuditDirection,
  NakReasonCode,
  SovereigntyValidationResult,
} from "./types";

export {
  validatePolicy,
  validateEgressRule,
  validateScopeMapping,
  validateImportedPrincipalsConfig,
  validateTrustedSubstrate,
  assertPolicy,
} from "./schema";
export type {
  ImportedPrincipalsConfigReason,
  ImportedPrincipalsConfigResult,
} from "./schema";

export { isSubstrateTrusted, findTrustedSubstrate } from "./substrates";

export { createInMemoryPolicyStore, createKVPolicyStore } from "./policy-store";
export type {
  PolicyStore,
  PolicyStoreOptions,
  InMemoryPolicyStore,
  InMemoryPolicyStoreOptions,
  KVPolicyStoreOptions,
} from "./policy-store";

export {
  validateEgress,
  checkClassificationAlignment,
  checkDataResidency,
} from "./validators/egress";

export {
  validateIngress,
  lookupPrincipalScope,
  checkScopeCeiling,
  checkDefaultCeiling,
} from "./validators/ingress";

export { verifyChainSovereignty } from "./validators/chain";

export { enforceMaxHop, enforceMaxHopEnvelope } from "./validators/max-hop";
export type { MaxHopReason, MaxHopResult } from "./validators/max-hop";

export { createSovereigntyEngine } from "./engine";
export type { SovereigntyEngine, SovereigntyEngineOptions } from "./engine";

export {
  createAuditLog,
  auditSubject,
  AUDIT_STREAM_DEFAULT,
  AUDIT_SUBJECT_PREFIX_DEFAULT,
  AUDIT_RETENTION_NS_DEFAULT,
} from "./audit-log";
export type { AuditLog, AuditLogOptions } from "./audit-log";

export {
  createSovereignTransport,
  SovereigntyBlockedError,
  SOVEREIGNTY_NAK_PREFIX_DEFAULT,
  SOVEREIGNTY_COMPLIANCE_BLOCK_TOKEN,
  SOVEREIGNTY_NAK_TYPE,
} from "./transport";
export type {
  SovereignTransport,
  SovereignTransportOptions,
  SovereigntyNakDetail,
} from "./transport";

export {
  generateExportCommands,
  generateImportCommands,
  generateFederationScript,
} from "./nsc";
export type { NscCommandOptions } from "./nsc";
