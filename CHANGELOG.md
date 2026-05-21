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
- **Vocabulary migration (2026-05) — PR-3 of N: `src/identity/*` rename
  (R1/R3/R5).** Identity-layer renames that do **not** change any signed
  envelope bytes. **No wire-format change in this release.**
  - **R1 — registry type names.** `PrincipalRegistry` → `IdentityRegistry`
    and `PrincipalRegistryFile` → `IdentityRegistryFile`, plus
    `validatePrincipal` → `validateIdentity`. The old type names remain as
    **deprecated re-export aliases** from `src/identity/registry` and the
    package entrypoint, so external importers compile unchanged.
  - **R3 — verify-option keys.** `requireVerifiedIdentity`'s options
    `mustIncludePrincipalType` / `mustIncludePrincipal` are renamed to
    `mustIncludeIdentityType` / `mustIncludeIdentity`. Both old and new
    keys are accepted for one minor cycle; setting both names on the same
    options object raises a typed `dual_field_conflict` error (the option
    is an authorization predicate, so a silent coalesce is rejected).
  - **R5 — type-literal value.** `IdentityType` value `"operator"` →
    `"hub"`; the registry-file `type` validator's accepted set follows.
  - **Registry-file format change.** The persisted registry JSON key
    `principals` is renamed to `identities` and the file `version` is
    bumped `1` → `2`. `loadRegistry` is a transition reader: it accepts
    both `version: 1` (`principals`) and `version: 2` (`identities`)
    files. A file carrying BOTH keys is rejected with a typed
    `dual_field_conflict` error (whether the lists match or differ) — the
    registry is the trusted-identity list, and silently choosing a key is
    a trust-list confusion path. Writers emit only the new shape.
  - **R2 deferred to PR-6.** The stamp wire field `signed_by[].principal`
    → `.identity` is **intentionally NOT in this PR.** `signed_by` is a
    signable field — renaming a stamp key changes the JCS canonical bytes
    and the Ed25519 signing input, breaking cross-version verification of
    retained / peer-signed envelopes. The wire-field rename ships in PR-6
    alongside the envelope schema `$id` → v2 bump and the dual-schema
    transition reader. The `StampVerdict` / `VerificationResult`
    resolved-object `.principal` keys move with it.
  - **Also deferred per the manifest's PR ordering:** R4
    (`Identity.operator` → `.network`), `originator.principal` →
    `.identity` (`src/types.ts` — PR-7), `advertisement.principal`
    (PR-9), and the `src/index.ts` `Identity`/`Principal` type re-export
    formalisation (PR-4).
- **Vocabulary migration (2026-05) — PR-5 of N: `src/agent-identity/*`
  rename (R1/R4).** Agent-identity-layer renames that do **not** change
  any signed envelope bytes. **No wire-format change in this release.**
  - **R1 — helper rename.** `toPrincipal` → `toIdentity` (the helper
    that projects an `AgentIdentity` to a public-only `Identity` for
    registry submission). The old name remains as a **deprecated alias**
    (`export const toPrincipal = toIdentity`) re-exported from
    `src/agent-identity` and the package entrypoint, so external
    importers compile unchanged through the next major.
  - **R4 — `operator` object field → `network`.** The owning-network
    field is renamed on three shapes: `Identity.operator`,
    `AgentIdentity.operator`, and `GenerateAgentIdentityInput.operator`
    all become `.network`. This is a **safe rename** — `Identity` and
    `AgentIdentity` are locally-resolved objects (registry entries and
    on-disk identity files), not signed canonical content: `operator`
    is not in `SIGNABLE_FIELDS` (see `src/identity/canonicalize.ts`),
    so renaming it does not change the JCS canonical bytes or the
    Ed25519 signing input. The `src/identity/registry.ts`
    `validateIdentity` field check (`identities[i].network`) and its
    error string follow as the compile-coupled consumer.
  - **R2 still deferred to PR-6.** The stamp wire field
    `signed_by[].principal` is unchanged here for the same wire-safety
    reason recorded under PR-3.
- **Vocabulary migration (2026-05) — PR-6 of N: envelope wire transition
  (R2/R6/R11/R13).** The wire-affecting renames land here as the
  **transition release** — every change is backward-compatible. The
  envelope JSON schema `$id` bumps to `…/schemas/envelope/v2`; `v1` stays
  published for consumers pinned to the old grammar. This is **not** the
  breaking major: the validator/parser accepts BOTH the old and the new
  wire form of every renamed field.
  - **R2 — stamp + originator DID field `principal` → `identity`.** The
    `signed_by[]` stamp DID key and the `originator` actor-DID key are
    renamed. `signed_by` and `originator` are **signable fields**, so the
    canonical bytes are derived from the keys *as received* — the reader
    never re-keys before canonicalizing. A new myelin **emits** `identity`;
    a pre-migration / JetStream-replayed envelope carries `principal` and
    still validates AND verifies (its signature was taken over the
    `principal`-keyed bytes). The TS stamp/originator types model "exactly
    one of" as a discriminated union (`identity` xor `principal`).
  - **R6 — `source` grammar.** The canonical grammar is the fixed-3 form
    `{principal}.{stack}.{assistant}`. The transition validator keeps the
    legacy `{2,4}` (3–5 segment) pattern — the fixed-3 form is a strict
    subset, so accepting `{2,4}` accepts both; a legacy 4–5-segment
    `source` logs a deprecation warning. The breaking major tightens to
    exactly 3 segments.
  - **R11 — `distribution_mode` `"broadcast"` → `"offer"`.** The validator
    accepts both values; `createEnvelope` **emits** `"offer"` (a
    `"broadcast"` input is normalised). `"broadcast"` is deprecated and
    dropped in the breaking major.
  - **R13 — envelope `target_principal` → `target_assistant`.** The
    validator accepts either key; `createEnvelope` emits `target_assistant`.
    `target_assistant` is a signable field — an old-form `target_principal`
    envelope canonicalizes against the bytes its signer saw (both keys are
    listed in `SIGNABLE_FIELDS`).
  - **Dual-field conflict rejection.** Per the manifest's JetStream-replay
    security note, a wire record carrying BOTH the deprecated and the
    canonical name of any renamed field (stamp `principal`+`identity`,
    `originator` `principal`+`identity`, `target_principal`+
    `target_assistant`) is rejected with a typed `dual_field_conflict`
    error (`ValidationError.code === 'dual_field_conflict'`), whether the
    values match or differ. The conflict check runs **before** any
    signature-bytes canonicalization, so an attacker cannot canonicalize
    one form and have a consumer parse the other. `createEnvelope` throws
    `dual_field_conflict` if its input carries both target keys.
  - **Error-string lockstep.** A renamed field's validator error path
    flips with the field (one error carries one `field` value) — the
    stamp-DID and originator-DID errors now report `signed_by[N].identity`
    / `originator.identity`, and the cross-field routing error reports
    `target_assistant`.
  - **Cross-version regression tests** ship in `src/envelope-transition.test.ts`
    proving, per renamed field: old-form validates + verifies, new-form
    validates + verifies, both-forms is rejected with `dual_field_conflict`.

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
