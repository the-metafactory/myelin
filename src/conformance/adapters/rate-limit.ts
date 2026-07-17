import {
  parseRefusalObject,
  classifyRefusalKind,
  checkSeamConsistency,
  admissionKeyPrincipalSegment,
  evaluateMultiTier,
} from "../../wire/refusal";
import { type Adapter, type VectorResult } from "../types";

/**
 * Rate-limit / refusal-object adapters (RFC-0010). Wired to the ./wire refusal
 * surface (myelin#238): the closed refusal-kind registry + transient/permanent
 * projection, kind well-formedness, the seam rule, the admission-key
 * validate-not-coerce codec, and two-phase multi-tier evaluation.
 */

function fromWire(r: { ok: true; value: unknown } | { ok: false; reason: string }): VectorResult {
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
}

export const rateLimitAdapters: Record<string, Adapter> = {
  parseRefusalObject: (input): VectorResult => fromWire(parseRefusalObject(input)),
  classifyRefusalKind: (input): VectorResult => fromWire(classifyRefusalKind(input)),
  checkSeamConsistency: (input): VectorResult => fromWire(checkSeamConsistency(input)),
  admissionKeyPrincipalSegment: (input): VectorResult =>
    fromWire(admissionKeyPrincipalSegment(input as string)),
  evaluateMultiTier: (input): VectorResult => fromWire(evaluateMultiTier(input)),
};
