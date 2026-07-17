import { CAPABILITY_TAG_RE } from "../../patterns";
import { matchSovereigntyMode as wireMatchSovereigntyMode } from "../../wire/capability";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/**
 * Capability-discovery adapters (RFC-0008, specs/vectors/capability-discovery).
 *
 * Runner-first (design-rfc-alignment.md D3): every kind here is bound to the
 * capability code that exists on main TODAY, or — where the op is spec-ahead —
 * throws {@link NotImplemented} against its tracking issue so the vector is
 * accounted for in the manifest rather than silently skipped.
 *
 * The KEY fact about the capability domain (design-rfc-alignment.md §4/§5 W6):
 * the converged capability-id codec, the segment-prefix matcher, the
 * sovereignty-mode equality matcher, and the presence fold-gate validator are
 * all NEW code — "matcher is NEW code in myelin" (§5 W6, myelin#234). The ONLY
 * capability artifact on main is `CAPABILITY_TAG_RE` (patterns.ts) — the
 * single-segment tag grammar. So exactly one kind (`parseCapabilityId`) binds a
 * real impl; the rest arrive with the converged-id work (#234) or the ./wire
 * capability surface (#238).
 *
 * Issue attribution:
 *   - myelin#234 — capability converged-id + F-11 retirement (§5 W6): the
 *     converged grammar, its segment-prefix matcher, the presence fold-gate
 *     that parses each capability as a §4.1 converged id, and the pre-
 *     convergence cross-grammar masking case.
 *   - myelin#238 — the ./wire capability surface (§4): the sovereignty-mode
 *     equality matcher, and a synchronously-callable, dependency-injected
 *     registration sign/verify (today's F-11 `signCapabilityRegistration` /
 *     `verifyCapabilityRegistration` are async and take a private key / an
 *     `IdentityRegistry` the vector input does not carry — not drivable from
 *     this sync, input-only harness).
 */

export const capabilityAdapters: Record<string, Adapter> = {
  // parseCapabilityId is the CONVERGED-id parser (single tags AND dotted
  // compounds like `dev.implement`, returning `{tag}` or `{segments}` plus
  // reason tokens). Today's only capability grammar is CAPABILITY_TAG_RE
  // (patterns.ts) — SINGLE-SEGMENT only, boolean, no reason tokens, no compound
  // split. Bound here as `validateCapabilityTag` is in the subjects adapter:
  // single-segment accepts PASS (value `{tag}`); every reject-half vector
  // (missing reason token) and every compound vector (grammar rejects the dot,
  // so ok:false vs the expected accept/segments) manifests → the converged-id
  // codec, myelin#234.
  parseCapabilityId: (input): VectorResult => {
    const id = input as string;
    return CAPABILITY_TAG_RE.test(id) ? { ok: true, value: { tag: id } } : { ok: false };
  },

  // Segment-prefix matcher — NEW code (design-rfc-alignment.md §5 W6: "matcher
  // is NEW code in myelin"). Today's dispatch does exact-membership
  // (`caps.includes(tag)`, docs/discovery.md:154) inline in a filter — there is
  // no exported matcher to bind, and exact membership FAILS the prefix-parent
  // vector (the named defect). Arrives with the converged-id work.
  matchCapabilityId: () => {
    throw new NotImplemented("matchCapabilityId", "myelin#234");
  },

  // Presence fold-gate validator (D5, §7) — every capabilities[] entry MUST
  // parse as a §4.1 converged id (and reserved tags rejected) BEFORE the
  // announcement folds into the registry. The deployed path folds WITHOUT
  // validation (§9.1 named defect) and no fold-gate function is exported.
  // Arrives with the converged-id trust-boundary gate.
  validatePresenceAnnouncement: () => {
    throw new NotImplemented("validatePresenceAnnouncement", "myelin#234");
  },

  // Sovereignty-mode equality matcher (RFC-0005 OD-7 / §6.5) — capability
  // export surface (§4), built in ./wire. `matchesSovereigntyMode` in
  // docs/discovery.md:155 is illustrative pseudo-code; no such function exists
  // on main. Arrives with #238.
  matchSovereigntyMode: (input): VectorResult => {
    const i = (input ?? {}) as { required: string; declared: string };
    const r = wireMatchSovereigntyMode(i);
    return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
  },

  // Pre-convergence cross-grammar agreement (masking-shared-tag): a HISTORICAL
  // case showing a shared seed tag passed BOTH pre-convergence grammars (myelin
  // tag + cortex compound) and hid the C-3 divergence. "Post-D1 there is one
  // grammar" — the checker converges with the converged-id work, myelin#234.
  crossGrammarAgreement: () => {
    throw new NotImplemented("crossGrammarAgreement", "myelin#234");
  },

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
