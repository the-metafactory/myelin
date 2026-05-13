import type { MyelinEnvelope } from "../../types";
import { getLastStampPrincipal } from "../../identity/chain";
import type { ScopeMapping, SovereigntyPolicy, SovereigntyValidationResult } from "../types";
import { subjectMatchesPattern } from "../../subject-matching";

const ALLOW: SovereigntyValidationResult = Object.freeze({ valid: true });

export function lookupPrincipalScope(
  principal: string,
  mappings: ScopeMapping[],
): ScopeMapping | null {
  for (const mapping of mappings) {
    if (mapping.imported_principals.includes(principal)) return mapping;
  }
  return null;
}

export function checkScopeCeiling(
  envelope: MyelinEnvelope,
  sourceSubject: string,
  mapping: ScopeMapping,
): SovereigntyValidationResult {
  const subjectAllowed = mapping.local_scope.some((p) => subjectMatchesPattern(sourceSubject, p));
  if (!subjectAllowed) {
    return {
      valid: false,
      code: "compliance-block:scope-exceeded",
      reason: `principal scope does not include subject '${sourceSubject}'`,
    };
  }
  if (envelope.requirements && envelope.requirements.length > 0) {
    for (const cap of envelope.requirements) {
      if (!mapping.max_capabilities.includes(cap)) {
        return {
          valid: false,
          code: "compliance-block:scope-exceeded",
          reason: `requirement '${cap}' exceeds max_capabilities for principal`,
        };
      }
    }
  }
  return ALLOW;
}

export function validateIngress(
  envelope: MyelinEnvelope,
  sourceSubject: string,
  policy: SovereigntyPolicy,
): SovereigntyValidationResult {
  // myelin#31 — ingress checks the LAST stamp's principal (the most recent
  // attestor, i.e. the entity that actually published on this hop). The
  // chain-of-stamps feature flag (policy.chain_of_stamps.verify_delegation_sovereignty)
  // is the opt-in toggle that walks earlier stamps for delegation policy;
  // it is wired separately so existing single-stamp behavior is unchanged.
  const principal = getLastStampPrincipal(envelope);
  if (!principal) {
    return {
      valid: false,
      code: "compliance-block:unknown-principal",
      reason: "envelope is unsigned (no signed_by.principal)",
    };
  }
  const mapping = lookupPrincipalScope(principal, policy.ingress.scope_mappings);
  if (!mapping) {
    if (policy.ingress.reject_unknown_partners) {
      return {
        valid: false,
        code: "compliance-block:unknown-principal",
        reason: `principal '${principal}' has no scope mapping`,
      };
    }
    return ALLOW;
  }
  return checkScopeCeiling(envelope, sourceSubject, mapping);
}
