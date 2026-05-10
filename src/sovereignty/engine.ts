import type { MyelinEnvelope } from "../types";
import type { PolicyStore } from "./policy-store";
import type { SovereigntyValidationResult } from "./types";
import { validateEgress as validateEgressRules } from "./validators/egress";
import { validateIngress as validateIngressRules } from "./validators/ingress";

export interface SovereigntyEngine {
  validateEgress(envelope: MyelinEnvelope, targetSubject: string): SovereigntyValidationResult;
  validateIngress(envelope: MyelinEnvelope, sourceSubject: string): SovereigntyValidationResult;
  getPolicyStore(): PolicyStore;
}

export interface SovereigntyEngineOptions {
  policyStore: PolicyStore;
}

export function createSovereigntyEngine(options: SovereigntyEngineOptions): SovereigntyEngine {
  const { policyStore } = options;

  return {
    validateEgress(envelope, targetSubject) {
      const policy = policyStore.get();
      if (policy.egress.block_local_escape && envelope.sovereignty.classification === "local") {
        if (!targetSubject.startsWith("local.")) {
          return {
            valid: false,
            code: "compliance-block:classification-mismatch",
            reason: `block_local_escape: local-classified envelope cannot publish to '${targetSubject}'`,
          };
        }
      }
      return validateEgressRules(envelope, targetSubject, policy.egress.rules);
    },
    validateIngress(envelope, sourceSubject) {
      const policy = policyStore.get();
      return validateIngressRules(envelope, sourceSubject, policy);
    },
    getPolicyStore() {
      return policyStore;
    },
  };
}
