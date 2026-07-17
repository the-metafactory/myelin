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
 *                transport result-token vocabulary. (23)
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
  "admission-status/reject-granted": { issue: "myelin#238", note: "AdmissionStatus enum lands with the ./wire admission surface" },
  "admission-status/reject-lowercase": { issue: "myelin#238", note: "AdmissionStatus enum lands with the ./wire admission surface" },
  "admission-status/valid-admitted": { issue: "myelin#238", note: "AdmissionStatus enum lands with the ./wire admission surface" },
  "admission-status/valid-departed-vs-revoked": { issue: "myelin#238", note: "AdmissionStatus enum lands with the ./wire admission surface" },
  "decision-claim/binding-match-accept": { issue: "myelin#238", note: "§7.3 decision identity binding (+ D7 dual-accept) lands with the ./wire admission surface" },
  "decision-claim/binding-narrow-accepted-dual-accept": { issue: "myelin#238", note: "§7.3 decision identity binding (+ D7 dual-accept) lands with the ./wire admission surface" },
  "decision-claim/canonical-bytes-admit-widened": { issue: "myelin#238", note: "canonical-JSON decision/seal claim bytes (CONTEXT_TAG) land with the ./wire admission surface" },
  "decision-claim/reject-identity-mismatch-network-id": { issue: "myelin#238", note: "§7.3 decision identity binding (+ D7 dual-accept) lands with the ./wire admission surface" },
  "decision-claim/reject-identity-mismatch-peer-pubkey": { issue: "myelin#238", note: "§7.3 decision identity binding (+ D7 dual-accept) lands with the ./wire admission surface" },
  "fetch-seam/accept-subject-match": { issue: "myelin#238", note: "§8.1 R7 fetch-seam leaf_user membership check lands with the ./wire admission surface" },
  "fetch-seam/reject-no-expected-identity": { issue: "myelin#238", note: "§8.1 R7 fetch-seam leaf_user membership check lands with the ./wire admission surface" },
  "fetch-seam/reject-subject-mismatch": { issue: "myelin#238", note: "§8.1 R7 fetch-seam leaf_user membership check lands with the ./wire admission surface" },
  "lifecycle/admitted-sublifecycle-derived": { issue: "myelin#238", note: "§4.2 ADMITTED sub-lifecycle projection lands with the ./wire admission surface" },
  "lifecycle/admitted-sublifecycle-derived-hub-authorized": { issue: "myelin#238", note: "§4.2 ADMITTED sub-lifecycle projection lands with the ./wire admission surface" },
  "lifecycle/admitted-sublifecycle-derived-unsealed": { issue: "myelin#238", note: "§4.2 ADMITTED sub-lifecycle projection lands with the ./wire admission surface" },
  "lifecycle/covered-by-principal-mine-path-not-widened": { issue: "myelin#238", note: "§4.2 D1 covered-by-principal readout lands with the ./wire admission surface" },
  "lifecycle/covered-by-principal-readout": { issue: "myelin#238", note: "§4.2 D1 covered-by-principal readout lands with the ./wire admission surface" },
  "lifecycle/depart-clears-both-fields": { issue: "myelin#238", note: "§4.2 lifecycle transition table lands with the ./wire admission surface" },
  "lifecycle/revoke-clears-both-fields": { issue: "myelin#238", note: "§4.2 lifecycle transition table lands with the ./wire admission surface" },
  "lifecycle/terminal-is-terminal-per-key": { issue: "myelin#238", note: "§4.2 lifecycle transition table lands with the ./wire admission surface" },
  "lifecycle/terminal-reregister-idempotent": { issue: "myelin#238", note: "§4.2 lifecycle transition table lands with the ./wire admission surface" },
  "request-id/reject-dashed-uuid": { issue: "myelin#238", note: "no admission impl in myelin (all in cortex); request-id grammar lands with the ./wire admission surface" },
  "request-id/reject-short": { issue: "myelin#238", note: "no admission impl in myelin (all in cortex); request-id grammar lands with the ./wire admission surface" },
  "request-id/reject-uppercase-hex": { issue: "myelin#238", note: "no admission impl in myelin (all in cortex); request-id grammar lands with the ./wire admission surface" },
  "request-id/valid-32-lower-hex": { issue: "myelin#238", note: "no admission impl in myelin (all in cortex); request-id grammar lands with the ./wire admission surface" },
  "requested-scope/reject-no-wildcard": { issue: "myelin#238", note: "requested-scope grammar lands with the ./wire admission surface" },
  "requested-scope/reject-out-of-grammar-principal": { issue: "myelin#238", note: "requested-scope grammar lands with the ./wire admission surface" },
  "requested-scope/valid-hyphenated-principal": { issue: "myelin#238", note: "requested-scope grammar lands with the ./wire admission surface" },
  "requested-scope/valid-plain": { issue: "myelin#238", note: "requested-scope grammar lands with the ./wire admission surface" },
  "seal-claim/bind-peer-pubkey": { issue: "myelin#238", note: "canonical-JSON decision/seal claim bytes (CONTEXT_TAG) land with the ./wire admission surface" },
  "seal-claim/binding-match-accept": { issue: "myelin#238", note: "§8.3 seal-write binding lands with the ./wire admission surface" },
  "seal-claim/reject-identity-mismatch": { issue: "myelin#238", note: "§8.3 seal-write binding lands with the ./wire admission surface" },
  "sealed-envelope/decode-v1-psk": { issue: "myelin#238", note: "LeafSecretEnvelope v1/v2 decoder lands with the ./wire admission surface" },
  "sealed-envelope/decode-v1-with-payload-key": { issue: "myelin#238", note: "LeafSecretEnvelope v1/v2 decoder lands with the ./wire admission surface" },
  "sealed-envelope/decode-v2-creds": { issue: "myelin#238", note: "LeafSecretEnvelope v1/v2 decoder lands with the ./wire admission surface" },
  "sealed-envelope/reject-missing-leaf-psk": { issue: "myelin#238", note: "LeafSecretEnvelope v1/v2 decoder lands with the ./wire admission surface" },
  "sealed-envelope/reject-newer-version": { issue: "myelin#238", note: "LeafSecretEnvelope v1/v2 decoder lands with the ./wire admission surface" },
  "sealed-envelope/reject-version-not-number": { issue: "myelin#238", note: "LeafSecretEnvelope v1/v2 decoder lands with the ./wire admission surface" },

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
  "sovereignty-mode/equal-matches": { issue: "myelin#238", note: "sovereignty-mode equality matcher is a ./wire capability export" },
  "sovereignty-mode/no-implied-ordering": { issue: "myelin#238", note: "sovereignty-mode equality matcher is a ./wire capability export" },

  // ── envelope ──
  "envelope/direct-missing-target": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/direct-with-target": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/distribution-broadcast": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/economics-wallet-role-anyclass": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/federated-signed-ed25519": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/hub-stamp-variant": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/id-not-uuid": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/id-urn-prefix": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/minimal-required": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/missing-source": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/mutable-channels-present": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/originator-adapter-resolved": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/originator-principal-key": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/originator-system-class": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/over-max-size": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/payload-array": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/requirements-bad-tag": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/residency-unassigned-code": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/signature-too-short": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/signed-by-shim-form": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/signed-by-surface-identity": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/source-four-segments": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/source-masking-prod-01": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/source-not-agent-class": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/sovereignty-extra-field": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/spec-version-current": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/spec-version-newer-accepted": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/stamp-principal-key": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/target-assistant-wrong-class": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/target-principal-top-level": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/timestamp-lowercase": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/timestamp-out-of-range-accepted": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/type-too-few-segments": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },
  "envelope/unknown-top-field": { issue: "myelin#238", note: "validateEnvelope emits field-path errors and a pre-R structural grammar, not the RFC-0004 §11.3 result-token enum / field-id validator" },

  // ── envelope-signing ──
  "canon/bytes-to-sign-domain-separated": { issue: "myelin#238", note: "CONTEXT_TAG domain-separated signing bytes are canonicalizer v2" },
  "canon/duplicate-key-rejected": { issue: "myelin#238", note: "dup-key + non-finite reject + canonicalize op does not exist on main" },
  "canon/mutable-carveout-masked": { issue: "myelin#238", note: "v1 JCS bytes keyed by field NAMES; vectors expect the field-id NUMBER-keyed v2 form" },
  "canon/nonfinite-number-must-fail": { issue: "myelin#238", note: "dup-key + non-finite reject + canonicalize op does not exist on main" },
  "canon/number-and-nested-sort": { issue: "myelin#238", note: "v1 JCS bytes keyed by field NAMES; vectors expect the field-id NUMBER-keyed v2 form" },
  "canon/single-object-normalizes-to-array": { issue: "myelin#238", note: "v1 JCS bytes keyed by field NAMES; vectors expect the field-id NUMBER-keyed v2 form" },
  "canon/stamp0-signing-bytes": { issue: "myelin#238", note: "chain-stamp canonicalizer is v1 name-keyed; field-id re-key is v2" },
  "canon/stamp1-commits-to-stamp0": { issue: "myelin#238", note: "chain-stamp canonicalizer is v1 name-keyed; field-id re-key is v2" },
  "canon/unsigned-minimal": { issue: "myelin#238", note: "v1 JCS bytes keyed by field NAMES; vectors expect the field-id NUMBER-keyed v2 form" },
  "stamp/at-calendar-blind-accepted": { issue: "myelin#238", note: "no standalone stamp-syntax validator (embedded in validateEnvelope)" },
  "stamp/legacy-principal-key": { issue: "myelin#238", note: "no standalone stamp-syntax validator (embedded in validateEnvelope)" },
  "stamp/signature-wrong-length": { issue: "myelin#238", note: "no standalone stamp-syntax validator (embedded in validateEnvelope)" },
  "stamp/unknown-method": { issue: "myelin#238", note: "no standalone stamp-syntax validator (embedded in validateEnvelope)" },
  "verify/at-calendar-blind-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/chain-empty-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/chain-too-long-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/domain-sep-cross-protocol-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/federated-unsigned-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/hub-stamp-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/non-canonical-point-R-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/non-canonical-scalar-S-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-cross-principal-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-federated-forward-s0-anchor-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-federated-forward-s0-anchor-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-hub-class-signer-fail-closed": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-hub-stamp-anchor-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-principal-reconcile-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-stack-cross-principal-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-stack-reconcile-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/originator-surface-self-asserted-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/small-order-key-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/small-order-point-R-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/stackless-chain-fail-closed": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/stale-admission-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/stale-reverify-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/tampered-stamp0-role-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/two-stamp-chain-ok": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/unknown-principal-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },
  "verify/untrusted-hub-rejected": { issue: "myelin#238", note: "async + spec-ahead (§11.3 tokens, D0 anchors, pinned-equation two-anchor verifier)" },

  // ── identifiers ──

  // ── rate-limit ──
  "key/reserved-tier-repurpose-rejected": { issue: "myelin#238", note: "admission-key principal-segment codec (validate-not-coerce) lands with the ./wire refusal object" },
  "key/underscore-rejected-not-coerced": { issue: "myelin#238", note: "admission-key principal-segment codec (validate-not-coerce) lands with the ./wire refusal object" },
  "key/uppercase-rejected-not-coerced": { issue: "myelin#238", note: "admission-key principal-segment codec (validate-not-coerce) lands with the ./wire refusal object" },
  "key/valid-principal-tier": { issue: "myelin#238", note: "admission-key principal-segment codec (validate-not-coerce) lands with the ./wire refusal object" },
  "kind/admission-term-forbidden": { issue: "myelin#238", note: "refusal-kind well-formedness (retry_after_ms-required / term-forbidden) lands with the ./wire refusal object" },
  "kind/compliance-block": { issue: "myelin#238", note: "RFC-0010 refusal object schema is unbuilt on main; lands with the ./wire refusal object" },
  "kind/not-now-missing-retry-rejected": { issue: "myelin#238", note: "refusal-kind well-formedness (retry_after_ms-required / term-forbidden) lands with the ./wire refusal object" },
  "kind/not-now-transient": { issue: "myelin#238", note: "RFC-0010 refusal object schema is unbuilt on main; lands with the ./wire refusal object" },
  "kind/policy-denied-permanent": { issue: "myelin#238", note: "RFC-0010 refusal object schema is unbuilt on main; lands with the ./wire refusal object" },
  "kind/unknown-falls-back": { issue: "myelin#238", note: "RFC-0010 refusal object schema is unbuilt on main; lands with the ./wire refusal object" },
  "multitier/all-admit-consumes-all": { issue: "myelin#238", note: "§3.5 two-phase multi-tier evaluation lands with the ./wire refusal object" },
  "multitier/first-refusing-tier-wins": { issue: "myelin#238", note: "§3.5 two-phase multi-tier evaluation lands with the ./wire refusal object" },
  "seam/mirror-agreement": { issue: "myelin#238", note: "§2.4 seam rule (mirror kind == co-carried token) lands with the ./wire refusal object" },
  "seam/mirror-mismatch-malformed": { issue: "myelin#238", note: "§2.4 seam rule (mirror kind == co-carried token) lands with the ./wire refusal object" },
  "seam/policy-denied-with-term-disposition": { issue: "myelin#238", note: "§2.4 seam rule (mirror kind == co-carried token) lands with the ./wire refusal object" },

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
  "ingress/chain-earlier-stamp-unmapped-invalid": { issue: "myelin#11", note: "engine verifyChainSovereignty implements chain-invalid, but the conformance adapter drives the bare validateIngress (not engine.validateIngress), so the chain-walk is not exercised → returns unknown-principal; wire the engine path to burn down" },
  "ingress/mapped-capability-exceeds-ceiling-block": { issue: "myelin#11", note: "#261 scope ceiling merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/mapped-subject-outside-scope-block": { issue: "myelin#11", note: "re-cut (#261): partner 'other' declared → §6.0 link passes → scope-exceeded; remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/partner-unknown-link-rejected": { issue: "myelin#11", note: "#261 §6.0 partner check merged; decision correct (partner-unknown) — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/unknown-principal-permissive-ceiling-block": { issue: "myelin#11", note: "#261 default ceiling merged; decision correct (scope-exceeded) — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/unknown-principal-reject": { issue: "myelin#11", note: "#261 procedure merged; decision correct — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "ingress/unsigned-block": { issue: "myelin#11", note: "#261 procedure merged; decision correct (unknown-principal) — remaining diff is kebab compliance-block: vs snake compliance_block: NAK token" },
  "max-hop/origin-only-forwarded-block": { issue: "myelin#11", note: "emits kebab max-hop-exceeded; pack spells max_hop_exceeded (sovereignty NAK-token debt)" },
  "nak/source-two-segment-invalid": { issue: "myelin#11", note: "no §8 nak-source grammar parser on main (sovereignty engine debt)" },

  // ── subject-namespace ──
  "atsegment/exempt-from-63-cap": { issue: "myelin#238", note: "standalone @-segment validator unbuilt on main" },
  "atsegment/inner-msi-segment-over-63": { issue: "myelin#238", note: "standalone @-segment validator unbuilt on main" },
  "atsegment/underscore-rejected": { issue: "myelin#238", note: "standalone @-segment validator unbuilt on main" },
  "capability/reject-dead-letter": { issue: "myelin#238", note: "CAPABILITY_TAG_RE has no reason tokens and no reserved-tag rejection" },
  "capability/reject-single-char": { issue: "myelin#238", note: "CAPABILITY_TAG_RE has no reason tokens and no reserved-tag rejection" },
  "capability/reject-trailing-hyphen": { issue: "myelin#238", note: "CAPABILITY_TAG_RE has no reason tokens and no reserved-tag rejection" },
  "deadletter/stack-named-tasks-misparse": { issue: "myelin#238", note: "legacy-priority parse misparses a stack literally named 'tasks'" },
  "direct/full-did-subject": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "dispatch/accept-dispatched-lifecycle": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "domain/accept-brain-root": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "domain/accept-open-root": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "domain/accept-review-verdict": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "domain/accept-tasks-offer": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "domain/reject-app-misuse-dispatch": { issue: "myelin#238", note: "application-publish reserved-domain guard unbuilt on main" },
  "identity/legacy-stack-not-default": { issue: "myelin#238", note: "absent-stack-must-fault resolver unbuilt (no default fabrication)" },
  "legacy/reject-silent-stackless-emit": { issue: "myelin#238", note: "primitive has no stackless-reject path (D18 arrives with ./wire)" },
  "length/reject-over-255": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "metrics/reject-uppercase": { issue: "myelin#238", note: "sanitizeSubjectToken preserves A-Z; uppercase source leaks into the metrics subject" },
  "prefix/mismatch-rejected": { issue: "myelin#238", note: "primitive returns no prefix-classification-mismatch reason token" },
  "published/reject-wildcard-principal": { issue: "myelin#238", note: "no published-subject segment-grammar validation (wildcard principal round-trips)" },
  "recipient/full-did-match": { issue: "myelin#238", note: "recipient @-segment byte-compare gate not lifted from cortex yet" },
  "recipient/full-did-mismatch": { issue: "myelin#238", note: "recipient @-segment byte-compare gate not lifted from cortex yet" },
  "reserved/inbox-by-reference": { issue: "myelin#238", note: "no reserved-space (_INBOX/_audit) subject classifier on main" },
  "reserved/nak-folds-under-audit": { issue: "myelin#238", note: "no reserved-space (_INBOX/_audit) subject classifier on main" },
  "reserved/reject-app-audit-prefix": { issue: "myelin#238", note: "application-publish reserved-domain guard unbuilt on main" },
  "scope/accept-federated": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "scope/accept-local": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "scope/accept-public-no-identity": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "scope/reject-bare-classification": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "scope/reject-unknown-prefix": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "seam/capability-id-not-subject-tag": { issue: "myelin#238", note: "CAPABILITY_TAG_RE has no reason tokens and no reserved-tag rejection" },
  "seam/principal-drift-trailing-hyphen": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "segment/reject-over-63": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "sub/accept-tasks-stream-filter": { issue: "myelin#238", note: "subscription-pattern grammar validator unbuilt on main" },
  "sub/reject-bare-arrow": { issue: "myelin#238", note: "subscription-pattern grammar validator unbuilt on main" },
  "sub/reject-reserved-space-wildcard": { issue: "myelin#238", note: "subscription-pattern grammar validator unbuilt on main" },
  "sub/reject-wildcard-classification": { issue: "myelin#238", note: "subscription-pattern grammar validator unbuilt on main" },
  "tasks/accept-bid-request-shape": { issue: "myelin#238", note: "full published-subject parse/validate unbuilt on main" },
  "tasks/reject-capability-equals-bid-request": { issue: "myelin#238", note: "CAPABILITY_TAG_RE has no reason tokens and no reserved-tag rejection" },

  // ── transport ──
  "carve/token-only-curve-applies": { issue: "myelin#233", note: "§3 layered carve (0007 token disposition + 0010 retry_after_ms override) has no combinator on main" },
  "carve/token-wearing-object": { issue: "myelin#233", note: "§3 layered carve (0007 token disposition + 0010 retry_after_ms override) has no combinator on main" },
  "dead-letter/bad-shape-rejected": { issue: "myelin#233", note: "deriveDeadLetterSubject derives correctly but throws free-text on bad shape; the unexpected-subject-shape token is RFC-0007 vocabulary" },
  "nak-reason/cant-do-canonical": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/compliance-block-canonical": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/kebab-alias-cant-do-normalized": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/kebab-alias-compliance-block-normalized": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/kebab-alias-not-now-normalized": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/kebab-alias-wont-do-normalized": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/missing-coerced": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/not-now-canonical": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/policy-denied-coerced": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/unknown-coerced": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "nak-reason/wont-do-canonical": { issue: "myelin#233", note: "normalize-then-coerce receive-alias mapper MISSING on main; snake NakReason + coerce lands at flag-day R" },
  "reply-to/bare-prefix-rejected": { issue: "myelin#233", note: "S1 reply-binding is inline in executeRequestReply with one free-text message; standalone validator with distinct tokens is #233" },
  "reply-to/concrete-inbox": { issue: "myelin#233", note: "S1 reply-binding is inline in executeRequestReply with one free-text message; standalone validator with distinct tokens is #233" },
  "reply-to/not-an-inbox-rejected": { issue: "myelin#233", note: "S1 reply-binding is inline in executeRequestReply with one free-text message; standalone validator with distinct tokens is #233" },
  "reply-to/wildcard-gt-rejected": { issue: "myelin#233", note: "S1 reply-binding is inline in executeRequestReply with one free-text message; standalone validator with distinct tokens is #233" },
  "reply-to/wildcard-star-rejected": { issue: "myelin#233", note: "S1 reply-binding is inline in executeRequestReply with one free-text message; standalone validator with distinct tokens is #233" },
  "route/below-threshold-no-route": { issue: "myelin#233", note: "route classifier exists as private DeadLetterHandler.shouldRoute keyed on pre-R kebab tokens; snake flip is flag-day R" },
  "route/compliance-block-fast-path": { issue: "myelin#233", note: "route classifier exists as private DeadLetterHandler.shouldRoute keyed on pre-R kebab tokens; snake flip is flag-day R" },
  "route/exhaustion-at-threshold": { issue: "myelin#233", note: "route classifier exists as private DeadLetterHandler.shouldRoute keyed on pre-R kebab tokens; snake flip is flag-day R" },
  "route/not-now-excluded": { issue: "myelin#233", note: "route classifier exists as private DeadLetterHandler.shouldRoute keyed on pre-R kebab tokens; snake flip is flag-day R" },
};
