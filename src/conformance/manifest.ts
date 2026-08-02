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
 *                vectors; entries deleted. The EMITTER flip has now LANDED
 *                (§3.1 canonical snake), burning down the last 12 entries. (0)
 *   myelin#261 — RFC-0005 sovereignty ingress/egress PROCEDURE conformance
 *                (strict equality, default ceiling, §6.0 partner check). MERGED
 *                (PRs #267/#272); its 11 vectors re-attributed to #11 — the
 *                decisions are now correct, only the kebab→snake NAK token
 *                remains. (0)
 *   myelin#11  — RFC-0005 sovereignty engine debt: kebab NAK tokens (the
 *                compliance-block:* → compliance_block:* flip) + §8 nak source
 *                grammar + the conformance-adapter chain-walk wiring. CLEARED by
 *                the #233 emitter flip — the token debt was the whole remaining
 *                diff; the deeper #11 engine work is tracked on its own. (0)
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
  // The 18 #234 vectors (converged-id codec §4.1, directional segment-prefix
  // matcher §4.2, presence fold-gate §7 D5, cross-grammar diagnostic §4.2) now
  // pass against src/wire/capability — entries removed as they greened.

  // ── envelope ──

  // ── envelope-signing ──

  // ── identifiers ──

  // ── rate-limit ──

  // ── sovereignty ──
  // BURNT DOWN (myelin#233, the RFC-0007 §3.1 emitter flip). RFC-0005 sovereignty
  // PROCEDURE (#261) merged first (strict equality, default ceiling,
  // principal-class matcher, §6.0 partner check — PRs #267/#272), leaving every
  // vector correct on the decision axis and failing only on the reason TOKEN:
  // kebab `compliance-block:*` / `max-hop-exceeded` vs the pack's snake
  // `compliance_block:*` / `max_hop_exceeded`. The emitter flip lands that token,
  // so all 12 entries green and are deleted here per the honesty guard.

  // ── subject-namespace ──
  // domain/accept-open-root — DELETED (myelin#290). The vector was re-cut: a
  // non-reserved (open) domain root is an ordinary scope subject, so its expected
  // projection now aligns with the scope family {classification,principal,stack,
  // type} that validatePublishedSubject already returns for a generic root. No
  // codec change; the honesty guard forces this deletion the moment it greens.

  // ── transport ──
  // RFC-0007 flag-day-R receive half (myelin#233) is BUILT: resolveNakReason
  // (normalize-then-coerce §3.4), the layered failure carve (§3/§4.1), the
  // dead-letter route classifier (§5.1), the §7.1 reply-to guard, and the §5.2
  // dead-letter subject token now drive the conformance vectors through the
  // ./wire transport + subject codecs. All 23 former #233 transport entries
  // burned green here — deleted. The EMITTER flip (myelin's kebab NakReason
  // union → snake) remains, and rides the two-party flag-day cut.
};
