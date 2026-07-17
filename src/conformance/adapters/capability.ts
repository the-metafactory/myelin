import {
  parseCapabilityId as wireParseCapabilityId,
  matchCapabilityId as wireMatchCapabilityId,
  validatePresenceAnnouncement as wireValidatePresenceAnnouncement,
  crossGrammarAgreement as wireCrossGrammarAgreement,
  matchSovereigntyMode as wireMatchSovereigntyMode,
  type CapabilityResult,
} from "../../wire/capability";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/** Normalize a wire {@link CapabilityResult} into a runner {@link VectorResult}. */
function toVectorResult<T>(r: CapabilityResult<T>): VectorResult {
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
}

/**
 * Capability-discovery adapters (RFC-0008, specs/vectors/capability-discovery).
 *
 * Runner-first (design-rfc-alignment.md D3): every kind here is bound to the
 * capability code that exists on main TODAY, or — where the op is spec-ahead —
 * throws {@link NotImplemented} against its tracking issue so the vector is
 * accounted for in the manifest rather than silently skipped.
 *
 * The converged capability-id codec, the directional segment-prefix matcher, the
 * presence fold-gate, the cross-grammar diagnostic, and the sovereignty-mode
 * equality matcher now live in `src/wire/capability` (myelin#234, §4.1/§4.2/§4.3/
 * §7). Those five kinds bind the real wire functions here. The two F-11
 * registration ops remain spec-ahead and throw {@link NotImplemented}.
 *
 * Issue attribution:
 *   - myelin#234 — capability converged-id (§4.1), its directional segment-prefix
 *     matcher (§4.2), the presence fold-gate (§7 D5), and the pre-convergence
 *     cross-grammar masking diagnostic (§4.2). LANDED — driven live below.
 *   - myelin#238 — a synchronously-callable, dependency-injected registration
 *     sign/verify (today's F-11 `signCapabilityRegistration` /
 *     `verifyCapabilityRegistration` are async and take a private key / an
 *     `IdentityRegistry` the vector input does not carry — not drivable from
 *     this sync, input-only harness).
 */

export const capabilityAdapters: Record<string, Adapter> = {
  // Converged-id parser (§4.1): single tags → `{tag}`, dotted compounds →
  // `{segments}`, rejects carry the specific reason token. Drives the real
  // ./wire codec.
  parseCapabilityId: (input): VectorResult => toVectorResult(wireParseCapabilityId(input)),

  // Directional segment-prefix matcher (§4.2): required-segments-prefix-of-
  // advertised, compared on parsed arrays (not string startsWith). Drives the
  // real ./wire matcher.
  matchCapabilityId: (input): VectorResult =>
    toVectorResult(wireMatchCapabilityId((input ?? {}) as { required: unknown; advertised: unknown })),

  // Presence fold-gate (§7 D5): every capabilities[] entry must parse as a §4.1
  // converged id and reserved tags (§4.3) are rejected BEFORE fold. Drives the
  // real ./wire gate.
  validatePresenceAnnouncement: (input): VectorResult =>
    toVectorResult(wireValidatePresenceAnnouncement((input ?? {}) as { capabilities?: unknown })),

  // Sovereignty-mode equality matcher (RFC-0005 OD-7 / §6.5). Drives the real
  // ./wire matcher.
  matchSovereigntyMode: (input): VectorResult =>
    toVectorResult(wireMatchSovereigntyMode((input ?? {}) as { required: string; declared: string })),

  // Pre-convergence cross-grammar diagnostic (§4.2 masking-shared-tag): reports
  // whether a seed tag is admitted by BOTH pre-convergence grammars. Drives the
  // real ./wire diagnostic.
  crossGrammarAgreement: (input): VectorResult => toVectorResult(wireCrossGrammarAgreement(input)),

  // F-11 `verifyCapabilityRegistration` (verify.ts) EXISTS but is `async` and
  // resolves the signer public key from an `IdentityRegistry` — neither the
  // await nor the registry is available to this sync, input-only harness (the
  // vector carries only `{advertisement, signed_by}`). Even the pre-crypto
  // fast-rejects these vectors exercise (identity-mismatch, dual_field_conflict)
  // sit inside the async body. A sync-callable, dep-injected verify arrives with
  // the ./wire codec, myelin#238. (Reason tokens also diverge: the impl emits
  // sentence-form `identity mismatch: …`, not the `identity-mismatch` token.)
  verifyCapabilityRegistration: () => {
    throw new NotImplemented("verifyCapabilityRegistration", "myelin#238");
  },

  // F-11 `signCapabilityRegistration` (register.ts) EXISTS but is `async` and
  // signs with a `SigningIdentity` private key the vector input does not carry
  // — not drivable from this sync, input-only harness. The validation these
  // vectors exercise (maxConcurrent positive-integer, load clamp) THROWS a
  // sentence-form Error rather than returning a reason token / value. A
  // sync-callable, dep-injected sign arrives with the ./wire codec, myelin#238.
  signCapabilityRegistration: () => {
    throw new NotImplemented("signCapabilityRegistration", "myelin#238");
  },
};
