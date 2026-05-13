import type { MyelinEnvelope } from "../../types";
import { getSignedByChain, MAX_CHAIN_LENGTH } from "../../identity/chain";
import type { SovereigntyPolicy, SovereigntyValidationResult } from "../types";
import { lookupPrincipalScope } from "./ingress";

const ALLOW: SovereigntyValidationResult = Object.freeze({ valid: true });

/**
 * F-5 T-6.1 chain-of-stamps sovereignty validator.
 *
 * Walks the envelope's signed_by chain (myelin#31) and checks that
 * every stamp's principal would clear the sovereignty bar at the time
 * of that stamp — i.e. each delegating hop must itself be a known
 * federation partner under the current policy. A single
 * unknown-principal hop anywhere in the chain (under
 * `reject_unknown_partners: true`) invalidates the entire delegation
 * with `compliance-block:chain-invalid`.
 *
 * The check is gated by
 * `policy.chain_of_stamps.verify_delegation_sovereignty`. When the
 * flag is off (default), the validator returns ALLOW immediately so
 * existing single-stamp behavior is unchanged. The existing
 * `validateIngress` last-stamp check is independent and always
 * active — this validator covers the EARLIER stamps in a chain.
 *
 * Note: this is a SOVEREIGNTY check (does the principal have a scope
 * mapping?), not a SIGNATURE check (did the principal actually sign?).
 * Signature verification is the identity layer's responsibility
 * (`verifyEnvelopeIdentity` in `src/identity/verify.ts`). Both layers
 * must agree for a chain to be both authentic and authorized.
 */
export function verifyChainSovereignty(
  envelope: MyelinEnvelope,
  policy: SovereigntyPolicy,
): SovereigntyValidationResult {
  if (!policy.chain_of_stamps.verify_delegation_sovereignty) return ALLOW;

  const chain = getSignedByChain(envelope);

  if (chain.length === 0) {
    return {
      valid: false,
      code: "compliance-block:chain-invalid",
      reason: "envelope has empty signed_by chain",
    };
  }

  if (chain.length > MAX_CHAIN_LENGTH) {
    return {
      valid: false,
      code: "compliance-block:chain-invalid",
      reason: `signed_by chain has ${chain.length} stamps, exceeds MAX_CHAIN_LENGTH (${MAX_CHAIN_LENGTH})`,
    };
  }

  // A single-stamp envelope is not a delegation chain — the existing
  // last-stamp ingress check already covers it. Return ALLOW so we
  // don't double-reject the same condition with a different code.
  if (chain.length === 1) return ALLOW;

  const mappings = policy.ingress.scope_mappings;
  const rejectUnknown = policy.ingress.reject_unknown_partners;

  for (let i = 0; i < chain.length; i++) {
    const principal = chain[i].principal;
    const mapping = lookupPrincipalScope(principal, mappings);
    if (!mapping && rejectUnknown) {
      return {
        valid: false,
        code: "compliance-block:chain-invalid",
        reason: `chain stamp ${i} principal '${principal}' has no scope mapping`,
      };
    }
  }

  return ALLOW;
}
