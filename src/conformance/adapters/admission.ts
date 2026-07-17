import {
  parseRequestId,
  parseRequestedScope,
  parseAdmissionStatus,
  canonicalizeDecisionClaim,
  enforceDecisionIdentityBinding,
  enforceSealWriteBinding,
  bindLeafUserToMember,
  applyLifecycleTransition,
  projectAdmittedSublifecycle,
  projectCoveredByPrincipal,
  decodeLeafSecretEnvelope,
} from "../../wire/admission";
import { type Adapter, type VectorResult } from "../types";

/**
 * Admission adapters (RFC-0006). Wired to the ./wire admission surface
 * (myelin#238): request-id/scope grammars, the AdmissionStatus enum + lifecycle
 * transition table, the decision/seal claim canonicalizer + identity-binding
 * gates, the fetch-seam membership check, the ADMITTED sub-lifecycle projection,
 * the covered-by-principal readout, and the LeafSecretEnvelope v1/v2 decoder.
 */

type Obj = Record<string, unknown>;

function fromWire(r: { ok: true; value: unknown } | { ok: false; reason: string }): VectorResult {
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
}

export const admissionAdapters: Record<string, Adapter> = {
  parseRequestId: (input): VectorResult => fromWire(parseRequestId(input as string)),
  parseRequestedScope: (input): VectorResult => fromWire(parseRequestedScope(input as string)),
  parseAdmissionStatus: (input): VectorResult => fromWire(parseAdmissionStatus(input as string)),
  canonicalizeDecisionClaim: (input): VectorResult => fromWire(canonicalizeDecisionClaim(input)),
  enforceDecisionIdentityBinding: (input): VectorResult =>
    fromWire(enforceDecisionIdentityBinding(input as { claim: Obj; row: Obj })),
  enforceSealWriteBinding: (input): VectorResult =>
    fromWire(enforceSealWriteBinding(input as { claim: Obj; entry: Obj })),
  bindLeafUserToMember: (input): VectorResult =>
    fromWire(bindLeafUserToMember(input as { leaf_user: string; expected_identities: string[] })),
  applyLifecycleTransition: (input): VectorResult =>
    fromWire(applyLifecycleTransition(input as { row: Obj; transition: string; actor?: string })),
  projectAdmittedSublifecycle: (input): VectorResult =>
    fromWire(projectAdmittedSublifecycle(input as { status: string; sealed_secret?: unknown; hub_authorized_at?: unknown })),
  projectCoveredByPrincipal: (input): VectorResult => fromWire(projectCoveredByPrincipal(input as Obj)),
  decodeLeafSecretEnvelope: (input): VectorResult => fromWire(decodeLeafSecretEnvelope(input as string)),
};
