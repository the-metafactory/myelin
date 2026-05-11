export type {
  SovereigntyPolicy,
  EgressRule,
  ScopeMapping,
  AuditEntry,
  AuditDecision,
  AuditDirection,
  NakReasonCode,
  SovereigntyValidationResult,
} from "./types";

export { validatePolicy, validateEgressRule, validateScopeMapping, assertPolicy } from "./schema";

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
} from "./validators/ingress";

export { verifyChainSovereignty } from "./validators/chain";

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
  SOVEREIGNTY_NAK_SOURCE_DEFAULT,
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
