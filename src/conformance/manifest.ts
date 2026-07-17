/**
 * Known-defects manifest (myelin#239, D3).
 *
 * Each entry maps a vector id → the tracking issue that will make it pass. A
 * vector is listed here when today's hand-written implementation does not yet
 * satisfy its `expect` — because the rule is spec-ahead-of-code (the RFC that
 * ratifies the behavior has landed; the ./wire codec / engine change that
 * implements it has not). The runner treats a manifested vector's failure as
 * EXPECTED (green); an unmanifested failure is a LOUD red.
 *
 * Burn-down is the epic's progress meter: as #237 (abnf-gen), #238 (./wire),
 * and the engine-debt fixes land, entries are DELETED here — and the runner
 * fails loudly if a listed vector starts passing, forcing the deletion.
 *
 * Seeded (W2) from the design-rfc-alignment.md §2 engine-debt tables + §4 ./wire
 * export surface + the open issues. Attribution by domain:
 *   myelin#238 — src/wire hand-written core: identity/subject codec, RFC-0004
 *                canonicalizer v2 + §11.3 token enum + verifier, the RFC-0006
 *                admission surface, and the RFC-0010 refusal object. (189)
 *   myelin#234 — RFC-0008 flag-day-R: capability converged-id + segment-prefix
 *                matcher + presence fold-gate. (18)
 *   myelin#233 — RFC-0007 flag-day-R: snake NakReason (resolveNakReason /
 *                dead-letter route / failure carve) + S1 reply-binding + the
 *                transport result-token vocabulary. BUILT — the ./wire transport
 *                codec (§3.4/§3/§5.1/§7.1) + §5.2 subject token now drive all 23
 *                vectors; entries deleted. Only the EMITTER flip remains. (0)
 *   myelin#261 — RFC-0005 sovereignty ingress/egress PROCEDURE conformance
 *                (strict equality, default ceiling, §6.0 partner check). MERGED
 *                (PRs #267/#272); its 11 vectors re-attributed to #11 — the
 *                decisions are now correct, only the kebab→snake NAK token
 *                remains. (0)
 *   myelin#11  — RFC-0005 sovereignty engine debt: kebab NAK tokens (the
 *                compliance-block:* → compliance_block:* flip) + §8 nak source
 *                grammar + the conformance-adapter chain-walk wiring. (13)
 *
 * NOT manifested: `era:"pre-R"` vectors (routed out of live conformance by the
 * runner — regression pins for the deprecated path), and every vector that
 * passes against today's impl (economics RFC-0009 is fully green; the accept
 * halves of the impl-backed subject/sovereignty/capability/transport primitives
 * pass; parseCorrelationId, notNowBackoffMs, and the derivable dead-letter
 * renders pass).
 */

export interface ManifestEntry {
  /** Tracking issue that lands the impl, e.g. "myelin#238". */
  issue: string;
  /** Why today's impl does not satisfy this vector. */
  note: string;
}

export const MANIFEST: Record<string, ManifestEntry> = {

  // ── admission ──

  // ── capability-discovery ──
  "capability-id-compound/code-review-typescript": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-id-compound/dev-implement": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-id/compound-deploy-k8s": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-id/masking-shared-tag": { issue: "myelin#234", note: "pre-convergence cross-grammar agreement checker converges with the converged-id work" },
  "capability-id/underscore-compound-rejected": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-id/underscore-rejected": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-tag/consecutive-hyphen-rejected": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-tag/digit-prefix-rejected": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-tag/single-char-forbidden": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-tag/trailing-hyphen-rejected": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "capability-tag/uppercase-rejected": { issue: "myelin#234", note: "only CAPABILITY_TAG_RE (single-segment) on main; converged-id codec + compound split + reason tokens is #234" },
  "match/child-does-not-match-parent": { issue: "myelin#234", note: "segment-prefix matcher is NEW code; main does exact-membership" },
  "match/equal-matches": { issue: "myelin#234", note: "segment-prefix matcher is NEW code; main does exact-membership" },
  "match/prefix-parent-matches-child": { issue: "myelin#234", note: "segment-prefix matcher is NEW code; main does exact-membership" },
  "match/segment-boundary-not-string-prefix": { issue: "myelin#234", note: "segment-prefix matcher is NEW code; main does exact-membership" },
  "presence/online-payload-valid": { issue: "myelin#234", note: "presence fold-gate validator unbuilt; deployed path folds without validation" },
  "presence/reserved-dead-letter-rejected": { issue: "myelin#234", note: "presence fold-gate validator unbuilt; deployed path folds without validation" },
  "presence/ungrammatical-capability-rejected": { issue: "myelin#234", note: "presence fold-gate validator unbuilt; deployed path folds without validation" },

  // ── envelope ──

  // ── envelope-signing ──

  // ── identifiers ──

  // ── rate-limit ──

  // ── sovereignty ──
  // RFC-0005 sovereignty PROCEDURE (#261) is MERGED (strict equality, default
  // ceiling, principal-class matcher, §6.0 partner check — PRs #267/#272). Each
  // vector below now yields the CORRECT decision (`ok` + reason axis); the sole
  // remaining failure is the kebab `compliance-block:*` NAK token vs the pack's
  // snake `compliance_block:*` — sovereignty NAK-token debt (myelin#11), the same
  // flip as `max-hop/origin-only-forwarded-block`. Re-attributed #261 → #11 so
  // #261 can close. The one exception is chain-earlier (see its note).
  "egress/block-local-escape": { issue: "myelin#11", note: "#261 procedure merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "egress/local-to-federated-block": { issue: "myelin#11", note: "#261 procedure merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "egress/public-to-local-block": { issue: "myelin#11", note: "#261 strict-equality merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "egress/residency-listed-mismatch-block": { issue: "myelin#11", note: "#261 procedure merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/chain-earlier-stamp-unmapped-invalid": { issue: "myelin#11", note: "#279 wired the adapter to engine.validateIngress; the chain-walk now runs (verifyChainSovereignty) and yields chain-invalid on the correct axis — remaining diff is the kebab compliance-block: vs snake compliance_block: NAK token (the #11 flag-day flip), same as the sibling sovereignty vectors" },
  "ingress/mapped-capability-exceeds-ceiling-block": { issue: "myelin#11", note: "#261 scope ceiling merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/mapped-subject-outside-scope-block": { issue: "myelin#11", note: "re-cut (#261): partner 'other' declared → §6.0 link passes → scope-exceeded; remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/partner-unknown-link-rejected": { issue: "myelin#11", note: "#261 §6.0 partner check merged; decision correct (partner-unknown) — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/unknown-principal-permissive-ceiling-block": { issue: "myelin#11", note: "#261 default ceiling merged; decision correct (scope-exceeded) — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/unknown-principal-reject": { issue: "myelin#11", note: "#261 procedure merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/unsigned-block": { issue: "myelin#11", note: "#261 procedure merged; decision correct (unknown-principal) — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "max-hop/origin-only-forwarded-block": { issue: "myelin#11", note: "emits kebab max-hop-exceeded; pack spells max_hop_exceeded (sovereignty NAK-token debt)" },

  // ── subject-namespace ──
  "domain/accept-open-root": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },

  // ── transport ──
  // RFC-0007 flag-day-R receive half (myelin#233) is BUILT: resolveNakReason
  // (normalize-then-coerce §3.4), the layered failure carve (§3/§4.1), the
  // dead-letter route classifier (§5.1), the §7.1 reply-to guard, and the §5.2
  // dead-letter subject token now drive the conformance vectors through the
  // ./wire transport + subject codecs. All 23 former #233 transport entries
  // burned green here — deleted. The EMITTER flip (myelin's kebab NakReason
  // union → snake) remains, and rides the two-party flag-day cut.
};
