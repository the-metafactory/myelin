import { NotImplemented, type Adapter } from "../types";

/**
 * Admission adapters (RFC-0006, specs/vectors/admission).
 *
 * Runner-first (design-rfc-alignment.md D3). Admission is the one domain whose
 * reference implementation lives ENTIRELY in cortex — §2: "Admission (0006, all
 * in cortex). Mostly CONFORMS." myelin has no admission code today: `grep`
 * across `src/` finds none of `parseRequestId`, `parseRequestedScope`,
 * `parseAdmissionStatus`, `canonicalizeDecisionClaim`,
 * `enforceDecisionIdentityBinding`, `enforceSealWriteBinding`,
 * `bindLeafUserToMember`, `applyLifecycleTransition`,
 * `projectAdmittedSublifecycle`, `projectCoveredByPrincipal`, or
 * `decodeLeafSecretEnvelope`.
 *
 * Per D4/D5 the codec is built ONCE in myelin's hand-written ./wire core
 * (myelin#238); §4's admission export surface lists exactly this set:
 * "AdmissionStatus + transition table, claim shapes … canonicalized under
 * CONTEXT_TAG, LeafSecretEnvelope v1/v2 decoder, request-id/scope grammars."
 * So every kind registers (the vectors are accounted for, NOT unknown kinds)
 * and throws NotImplemented; each admission vector is a manifest entry →
 * myelin#238. (This runner also CLOSES myelin#232 — "admission conformance
 * vectors are unexecuted, no runner" — by executing them; #238 is what makes
 * them pass.)
 */

function notYet(kind: string): Adapter {
  return () => {
    throw new NotImplemented(kind, "myelin#238");
  };
}

export const admissionAdapters: Record<string, Adapter> = {
  // §3 request-id / requested-scope grammars.
  parseRequestId: notYet("parseRequestId"),
  parseRequestedScope: notYet("parseRequestedScope"),
  // §4.1 the five-token AdmissionStatus enum.
  parseAdmissionStatus: notYet("parseAdmissionStatus"),
  // §7.2 canonical-JSON decision/seal claim bytes (widened with
  // peer_pubkey+network_id; RFC-0004-owned canonicalization + CONTEXT_TAG).
  canonicalizeDecisionClaim: notYet("canonicalizeDecisionClaim"),
  // §7.3 decision identity binding (row-compare peer_pubkey+network_id, with the
  // D7 dual-accept narrow window).
  enforceDecisionIdentityBinding: notYet("enforceDecisionIdentityBinding"),
  // §8.3 seal-write binding (bound peer_pubkey == target_stack_pubkey).
  enforceSealWriteBinding: notYet("enforceSealWriteBinding"),
  // §8.1 R7 fetch-seam install-time leaf_user ∈ expected-identities check.
  bindLeafUserToMember: notYet("bindLeafUserToMember"),
  // §4.2 lifecycle transition table (depart/revoke clear both fields; terminal
  // re-register idempotent).
  applyLifecycleTransition: notYet("applyLifecycleTransition"),
  // §4.2 derived ADMITTED sub-lifecycle projection (unsealed→sealed→hub-authorized,
  // read off field presence — never a sixth enum token).
  projectAdmittedSublifecycle: notYet("projectAdmittedSublifecycle"),
  // §4.2 D1 covered-by-principal display-only readout (join_gate_input MUST be false).
  projectCoveredByPrincipal: notYet("projectCoveredByPrincipal"),
  // §8.1 LeafSecretEnvelope v1(psk)/v2(creds) version-discriminated decoder.
  decodeLeafSecretEnvelope: notYet("decodeLeafSecretEnvelope"),
};
