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

export { createSovereigntyEngine } from "./engine";
export type { SovereigntyEngine, SovereigntyEngineOptions } from "./engine";
