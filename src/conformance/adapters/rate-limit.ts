import { NotImplemented, type Adapter } from "../types";

/**
 * Rate-limit / refusal-object adapters (RFC-0010, specs/vectors/rate-limit).
 *
 * Runner-first (design-rfc-alignment.md D3). The RFC-0010 refusal object and
 * its seam/tier machinery are the classic spec-ahead-of-code case: NONE of these
 * ops exist on main. `grep` across `src/` (excluding tests) finds no
 * `parseRefusalObject`, `classifyRefusalKind`, `checkSeamConsistency`,
 * `admissionKeyPrincipalSegment`, or `evaluateMultiTier` — and §2 confirms the
 * gap ("cortex `keySegment` COERCES where §3.3 says reject"; the codec is
 * myelin-side new code).
 *
 * The whole surface lands with the hand-written ./wire core, myelin#238 — whose
 * title names it explicitly: "src/wire: … token enums, refusal object
 * (TRUST-PATH)". §4's transport/refusal export surface lists "refusal-kind enum
 * + object schema, admission-key codec (validate-not-coerce), checkSeamConsistency"
 * as the #238 deliverable. Every kind therefore registers (so it is NOT an
 * unknown kind — the vectors are accounted for) and throws NotImplemented; each
 * vector is a manifest entry → myelin#238, not a loud fail.
 */

function notYet(kind: string): Adapter {
  return () => {
    throw new NotImplemented(kind, "myelin#238");
  };
}

export const rateLimitAdapters: Record<string, Adapter> = {
  // §2.2 closed refusal-kind registry + transient/permanent projection.
  parseRefusalObject: notYet("parseRefusalObject"),
  // §2.3 kind-level well-formedness (not_now REQUIRES retry_after_ms; term
  // FORBIDDEN for admission) — the reject tokens `retry-after-ms-required` /
  // `term-forbidden-for-admission`.
  classifyRefusalKind: notYet("classifyRefusalKind"),
  // §2.4 the chartered seam rule — a mirror kind MUST equal the co-carried 0007
  // token, else `seam-mismatch`.
  checkSeamConsistency: notYet("checkSeamConsistency"),
  // §3.3 admission-key principal-segment codec — VALIDATE-not-coerce (uppercase
  // / underscore / reserved-tier all REJECT, never normalize onto a shared KV
  // key). The exact "COERCES where §3.3 says reject" defect (§2).
  admissionKeyPrincipalSegment: notYet("admissionKeyPrincipalSegment"),
  // §3.5 two-phase multi-tier evaluation (refuse read-only, consume-all-or-none).
  evaluateMultiTier: notYet("evaluateMultiTier"),
};
