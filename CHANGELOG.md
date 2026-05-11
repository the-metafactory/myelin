# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **myelin#31** Chain-of-stamps signing. `MyelinEnvelope.signed_by` is now a
  chain (`SignedBy[]`). Each appended stamp signs the canonical bytes of the
  envelope *including the prior chain*, so tampering with any earlier stamp
  invalidates every downstream stamp. New surface:
  - `signEnvelope(envelope, privateKey, principal, { role? })` — append-mode
    signing; first call produces a one-element chain.
  - `verifyEnvelopeIdentity` walks every stamp and returns a per-stamp
    `chain: StampVerdict[]` alongside the overall verdict.
  - `requireVerifiedIdentity(envelope, registry, { minLength?, mustIncludeRole?, mustIncludePrincipalType?, mustIncludePrincipal? })`
    expresses chain-shape predicates (e.g. "chain must include an
    accountability stamp by an operator-type principal").
  - `StampRole` literal union: `origin | transit | accountability | sovereignty | notary`.
  - Helpers `toSignedByChain`, `getSignedByChain`, `normalizeSignedBy`.
- **myelin#31** Validator accepts both the canonical array form
  (`signed_by: [...]`) and the legacy single-object form (`signed_by: {...}`)
  on input — the single-object shape is normalized to a one-element chain.
  Wire serialization always emits the array form going forward.

### Changed
- **myelin#31** `signEnvelope` no longer throws when the envelope already
  carries `signed_by`; instead it appends a new stamp. Callers that needed
  the "single-signer only" semantic should inspect the existing chain
  before calling.
- **myelin#31** F-5 sovereignty engine + ingress validator read the LAST
  stamp's principal as the most recent attestor. Pre-#31 single-stamp
  envelopes collapse to a one-element chain, so behavior is preserved.
  The `chain_of_stamps.verify_delegation_sovereignty` flag remains OFF
  by default; turning it on opts into chain-walking delegation policy
  (F-5 T-6.1, separate PR).

- **F-018 MY-400**: **Core Problem**: Identity is split across three unrelated models that don't compose:
