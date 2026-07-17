import type { MyelinEnvelope } from "../../types";
import { getLastStampPrincipal } from "../../identity/chain";
import { principalComponentOf } from "../../identity/did-class";
import type {
  DefaultIngressCeiling,
  ScopeMapping,
  SovereigntyPolicy,
  SovereigntyValidationResult,
} from "../types";
import { subjectMatchesPattern } from "../../subject-matching";

const ALLOW: SovereigntyValidationResult = Object.freeze({ valid: true });

/**
 * Built-in default ingress scope when the operator supplies no
 * `policy.ingress.default_scope.local_scope` — federated ingress admits only
 * federated subjects, so an unmapped stranger cannot land on a `local.*`
 * escalation target (RFC-0005 §6.2, D6).
 */
const DEFAULT_INGRESS_LOCAL_SCOPE = ["federated.>"];

/**
 * The crossing's originating **partner** for the §6.0 link-level check — the
 * SECOND segment of the `sourceSubject` (its declared origin network), for
 * `federated.*` crossings only (RFC-0005 §6.0; derivation pinned by Andreas
 * 2026-07-17, myelin#261). `local.*` / `public.*` traffic is not a federated
 * crossing and has no partner link, so it is exempt (returns `null`).
 *
 * Caveat (recorded, myelin#261): subject segments are UNSIGNED. Binding this
 * to the last stamp's identity ("the stamp confirms the partner") is a
 * candidate future hardening on the myelin#11 path, not adopted here.
 */
export function sourceSubjectPartner(sourceSubject: string): string | null {
  if (!sourceSubject.startsWith("federated.")) return null;
  const segments = sourceSubject.split(".");
  // segments[0] === "federated"; the partner is the next segment.
  return segments[1] ?? null;
}

/**
 * Build the local **partner registry** — the set of federation partners the
 * stack peers with: the `partner_network` value of every scope mapping, plus
 * an optional dedicated `partner_roster` (RFC-0005 §6.0; registry composition
 * pinned by Andreas 2026-07-17, myelin#261).
 */
export function buildPartnerRegistry(ingress: SovereigntyPolicy["ingress"]): Set<string> {
  const registry = new Set<string>();
  for (const mapping of ingress.scope_mappings) registry.add(mapping.partner_network);
  for (const partner of ingress.partner_roster ?? []) registry.add(partner);
  return registry;
}

/**
 * Look up the scope mapping whose `imported_principals` contains the given
 * last-stamp identity. Matching is by **principal component** (RFC-0005 §6.1,
 * grill D9): a principal-class entry admits every agent of that principal.
 * Legacy (non-class-explicit) DIDs reduce to themselves via
 * {@link principalComponentOf}, so pre-flag-day-R entries keep matching
 * byte-for-byte.
 */
export function lookupPrincipalScope(
  principal: string,
  mappings: ScopeMapping[],
): ScopeMapping | null {
  const target = principalComponentOf(principal);
  for (const mapping of mappings) {
    if (mapping.imported_principals.some((entry) => principalComponentOf(entry) === target)) {
      return mapping;
    }
  }
  return null;
}

/**
 * Apply the §6.3 scope/capability ceiling to an UNMAPPED principal under the
 * permissive branch (RFC-0005 §6.2, grill D6). Replaces the deployed
 * unconditional ALLOW: an undeclared stranger is bounded by the default
 * ceiling exactly as a declared partner is bounded by its mapping. Absent a
 * configured `default_scope`, the built-in default is `federated.>` scope with
 * unbounded capabilities.
 */
export function checkDefaultCeiling(
  envelope: MyelinEnvelope,
  sourceSubject: string,
  defaultScope: DefaultIngressCeiling | undefined,
): SovereigntyValidationResult {
  const localScope = defaultScope?.local_scope ?? DEFAULT_INGRESS_LOCAL_SCOPE;
  const subjectAllowed = localScope.some((p) => subjectMatchesPattern(sourceSubject, p));
  if (!subjectAllowed) {
    return {
      valid: false,
      code: "compliance-block:scope-exceeded",
      reason: `unmapped principal: source subject '${sourceSubject}' outside the default ingress scope`,
    };
  }
  // Absent max_capabilities → unbounded (subject scope alone bounds the stranger).
  const maxCapabilities = defaultScope?.max_capabilities;
  if (maxCapabilities && envelope.requirements && envelope.requirements.length > 0) {
    for (const cap of envelope.requirements) {
      if (!maxCapabilities.includes(cap)) {
        return {
          valid: false,
          code: "compliance-block:scope-exceeded",
          reason: `unmapped principal: requirement '${cap}' outside the default capability ceiling`,
        };
      }
    }
  }
  return ALLOW;
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
  // RFC-0005 §6.0 (link-level partner check; derivation pinned by Andreas
  // 2026-07-17, myelin#261). BEFORE any principal-level evaluation, gate on
  // which federation link the crossing arrived over: the partner is the
  // sourceSubject's origin network (2nd segment), tested against the local
  // partner registry. Under `reject_unknown_partners`, a federated crossing
  // from a partner absent from a NON-EMPTY registry is refused at the link
  // boundary with `partner-unknown`, before the last-stamp principal is read.
  //
  // Gating: an EMPTY registry means the operator configured no partner
  // filtering (the check is opt-in) — fall through to the §6.1 principal check
  // so an unmapped principal still fails closed as `unknown-principal`, not
  // `partner-unknown`. `local.*`/`public.*` crossings have no partner link
  // (sourceSubjectPartner → null) and are exempt.
  if (policy.ingress.reject_unknown_partners) {
    const partner = sourceSubjectPartner(sourceSubject);
    if (partner !== null) {
      const registry = buildPartnerRegistry(policy.ingress);
      if (registry.size > 0 && !registry.has(partner)) {
        return {
          valid: false,
          code: "compliance-block:partner-unknown",
          reason: `crossing from partner '${partner}' (sourceSubject '${sourceSubject}') is not in the partner registry`,
        };
      }
    }
  }

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
      reason: "envelope is unsigned (no signed_by.identity)",
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
    // RFC-0005 §6.2 (grill D6): permissive mode still bounds the stranger by the
    // default ceiling — NOT an unconditional ALLOW. Declaring a partner MUST NOT
    // reduce its access relative to an undeclared stranger's.
    return checkDefaultCeiling(envelope, sourceSubject, policy.ingress.default_scope);
  }
  return checkScopeCeiling(envelope, sourceSubject, mapping);
}
