# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **Vocabulary migration (2026-05) — PR-1 of N: type-shell only.** Following
  the grilled glossary in `CONTEXT.md` and the per-file migration manifest
  at `docs/migrations/0001-vocabulary-grilled-2026-05.md`, the canonical
  exported types are renamed:
  - `Principal` → `Identity` (the broad authenticatable-entity type)
  - `PrincipalType` → `IdentityType` (`"agent" | "service" | "operator"`)

  Both old names remain available as **deprecated re-export aliases**
  (`/** @deprecated Renamed to … */`) so external importers (cortex,
  pilot, signal) continue to compile unchanged through the next major.
  The aliases are removed in the same major bump that lands the
  Tier-2/Tier-3 breaking renames (wire `signed_by[].principal`,
  `Identity.operator`, `"operator"` enum value, `target_principal`,
  `Broadcast` dispatch mode, source-grammar fixed-3 — every one of
  which lands in a follow-up PR per the manifest's PR-1-must-compile-
  alone discipline).

  No wire-format changes in this release. No public function signatures
  change. The new names are available for internal consumers that want
  to migrate ahead of the breaking release.
- **Vocabulary migration (2026-05) — PR-2 of N: `ORG_RE` → `PRINCIPAL_RE`
  (R7).** The shared single-subject-segment grammar constant is renamed.
  `ORG_RE` was defined in `src/patterns.ts` and redefined locally in
  `src/composition/lifecycle.ts` and `src/sovereignty/schema.ts`; the two
  local copies are deleted and consolidated onto the single
  `PRINCIPAL_RE` export, with `src/observability/transport.ts` and
  `src/bidding/subjects.ts` updated to import the renamed constant. The
  regex value (`/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/`) is unchanged — this is
  a pure name change. `PRINCIPAL_RE` is internal (not part of the package
  surface), so no public API or wire change. The remaining R7 work
  (`org`→`principal` parameter renames, `{org}`→`{principal}` subject-doc
  comments) cascades in later PRs per the manifest's PR ordering.

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
