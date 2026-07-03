# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Breaking
- **`distribution_mode: "broadcast"` removed — R11 transition window closed
  (C2, closes #180).** `"offer"` is the canonical routing mode; `"broadcast"` is
  no longer a valid value. `validateEnvelope` rejects it, the JSON schema enum
  drops it, the `DistributionMode` type tightens to `"offer" | "direct" |
  "delegate"`, and `createEnvelope`'s emit-side `broadcast → offer` normalisation
  is removed (nothing accepts `broadcast` anymore). The deprecated
  `broadcastTaskSubject` alias (and its root re-export) are deleted — use
  `offerTaskSubject`. Safe to cut now: all consumers were bumped (G1) to pins
  ≥ v0.5.0 that emit `"offer"` — cortex#1473, pilot#182, sage#98, cedar#5,
  reflex#31, grove#344 (all merged) — emitters-before-verifiers.
- **`originator.principal` removed from the wire — R2 transition window closed
  (C1).** The originator actor-DID field is canonical `identity`; the deprecated
  `principal` key is no longer accepted (no longer a `dual_field_conflict` — an
  old-form originator now fails with a missing-`originator.identity` error plus an
  unknown-field `originator.principal` error). `validateOriginator` requires
  `identity`; the JSON schema drops the `principal` property and the `oneOf`;
  `Originator`'s type collapses to `{ identity, attribution }`. The actor-DID
  accessor is renamed `getActorPrincipal` → **`getActorIdentity`** (canonical);
  `getActorPrincipal` stays as a `@deprecated` alias for one cycle and drops its
  old `originator.principal` fallback. Safe to cut now: all consumers were bumped (G1) to
  a myelin pin ≥ v0.5.0 that emits `originator.identity` — cortex#1473, pilot#182,
  sage#98, cedar#5, reflex#31, grove#344 (all merged). Producers must emit
  `identity` before pulling this release (emitters-before-verifiers). The separate
  `payload.principal` → `payload.identity` dispatch window is untouched.

## [0.5.1] — 2026-07

### Fixed
- **`src/` now passes `noUncheckedIndexedAccess`.** myelin ships raw `.ts`
  source, so strict downstream consumers (e.g. grove) type-check its internals;
  under `noUncheckedIndexedAccess: true` the non-identity subsystems previously
  produced ~50 errors (composition, bidding, observability, transport,
  sovereignty). All fixed with real guards (early returns, destructure-and-guard,
  `?? fallback`) — no behavior change, no public API change; the full suite
  (1384 tests) stays green. The flag is now on the main `tsconfig.json`, so this
  can't regress. Unblocks strict consumers from having to weaken their own
  `tsconfig`.
- Known gap (tracked separately): `tests/integration/` and `bench/` are not yet
  covered by a `tsc` gate and carry latent type issues; they are dev-only, not
  in the package barrel, and do not affect consumers.

## [0.5.0] — 2026-07

Adds the `spec_version` envelope field (accept-never-emit) plus a large internal
orchestrator refactor, and publishes the R26 substrate admission spec.
**Non-breaking on its own** — nothing emits `spec_version` yet — but this is the
verifiers-before-emitters half of a two-phase rollout: **every verifier MUST be
on ≥ 0.5.0 before the B2 (emit) release ships**, or it will reject envelopes that
carry the new field.

### Added
- **`spec_version` envelope field — Phase 4a: accept, never emit (B1).**
  Optional integer wire-grammar version (`3` = current grammar; absent ⇒
  legacy pre-field envelope). `validateEnvelope` accepts it and warns (does
  not reject) on a value newer than this library understands; it is added to
  `SIGNABLE_FIELDS`, so once an envelope is signed a tampered `spec_version`
  is detected and rejected at identity verification (like any signed field).
  **`createEnvelope` does NOT emit it yet** — this is the verifiers-before-emitters half of a
  two-phase rollout (emission is B2, a later separate release). Safe by
  construction: absent keys are never included in the canonical signing
  payload, so envelopes without `spec_version` canonicalize and verify
  byte-identically to before the field existed — pinned by an
  exact-canonical-bytes assertion against the frozen pre-field form in
  `src/spec-version.test.ts` (plus sign/verify + tamper-reject round-trips).
  Schema (`schemas/envelope.schema.json`)
  gains the optional property; `MyelinEnvelope` gains `spec_version?: number`.
- **`specs/admission.md` — the substrate admission contract (R26 phase 1,
  myelin#195).** Defines the shared, KV-arbitrated admission state that makes
  substrate rate limiting exact under horizontal scale: the per-(principal,
  stack) NATS-KV bucket (`admission_{principal}_{stack}`), the tiered key
  grammar (`rate.*` / `inflight.*`, tiers 1–2 shipped, 3–4 reserved), the
  versioned entry formats (per-window token buckets + self-expiring in-flight
  leases), the compare-and-swap arbitration protocol (refusals are read-only;
  every consumption is CAS-guarded), the refusal-taxonomy mapping (`not_now` +
  `retry_after_ms`, never `term`), and the failure posture (degrade-local with
  a loud `system.*` event; the anonymous public principal fails closed).
  Spec-only — the first implementation is cortex `src/bus/admission/`
  (cortex#1371); code migrates into `@the-metafactory/myelin` alongside
  signed-KV (myelin#31) in R26 phase 3.

### Changed
- **Internal: split `src/composition/orchestrator.ts` (1632 → 399 lines)** into
  `orchestrator/{context,state,validation,execute,recovery}.ts` (E4). Mechanical,
  behavior-preserving — the 2265-line `orchestrator.test.ts` passes unmodified.
  No public API change; `createOrchestrator` and all exported types are
  unchanged.

## [0.4.0] — Vocabulary migration breaking cut: target_assistant (2026-05)

Continues the 2026-05 vocabulary migration. Pre-1.0 minor = breaking.
Producers and consumers on `0.3.x` must update before pulling `0.4.0`; the
dual-key reader for the routing target landed in `0.3.x` was the transition
runway, and is now removed.

### Breaking
- **`target_principal` → `target_assistant` — the routing-target field
  renamed and the deprecated key removed from the wire (R13).** This is
  the alignment with the resolved cortex CONTEXT.md: the `@`-segment of a
  Tasks-Domain subject names an **assistant**, not a principal. A
  Direct/Delegate dispatch targets a *named assistant* (`@echo`, `@pilot`),
  so the envelope field that carries that DID is `target_assistant`. The
  deprecated `target_principal` key is now rejected by both the TS
  validator (`validateEnvelope` — it is no longer in `allowedFields`, so an
  envelope carrying it fails the `additionalProperties: false` sweep) and
  the JSON schema (the `target_principal` property is dropped;
  `additionalProperties: false` rejects it). The dual-schema reader on
  `validateEnvelope`, the `resolveCreateTarget` back-compat hook on
  `createEnvelope`, and the `dual_field_conflict` handling for the target
  field are all removed; `createEnvelope` reads only `input.target_assistant`.
  `target_principal` is also dropped from `SIGNABLE_FIELDS`
  (`src/identity/canonicalize.ts`) — pre-migration / JetStream-replayed
  envelopes carrying the old key no longer canonicalize or verify; drain
  replay windows before deploying.
  - **Scope boundary:** ONLY the dispatch-target field and the `@`-target
    subject token change. The **2nd subject segment** `{principal}` (the
    namespace owner in `{scope}.{principal}.{stack}.…`, established by
    myelin#185) STAYS `principal`. `distribution_mode` `broadcast` (R11)
    and `originator.principal` (R2) remain in their own transition windows.
  - **Subject token:** the `@`-target token `tasks.@{principal}` →
    `tasks.@{assistant}` in `specs/namespace.md`, `docs/envelope.md`,
    `docs/identity.md`, `docs/discovery.md`,
    `docs/design-agent-task-routing.md`, and the examples.
  - **Package version bumped to 0.4.0.**

  Unblocks the cortex-side `target_assistant` rename once cortex pulls new
  myelin.

## [0.3.0] — Vocabulary migration breaking cut (2026-05)

First breaking cut of the 2026-05 vocabulary migration. Pre-1.0 minor =
breaking. Producers and consumers on `0.2.x` must update before pulling
`0.3.0`; the dual-key reader landed in `0.2.x` (myelin#167) was the
transition runway.

### Breaking
- **`signed_by[].principal` removed from the wire (myelin#182).** Stamps
  must carry `signed_by[].identity` — the deprecated `principal` key is
  rejected by both the TS validator (`validateSignedByStamp`) and the
  JSON schema (`signedByStamp` no longer admits `principal` and is
  `additionalProperties: false`). JetStream-replayed envelopes that
  predate the rename are no longer accepted; drain replay windows
  before deploying. Unblocks `cortex#452` (drops the
  `stamp.identity ?? stamp.principal` accessor shim).
- **`{org}` placeholder renamed to `{principal}` in subject grammar
  (myelin#185, sibling PR).** Subject template authors should now use
  `{principal}.{stack}.{assistant}` (or the per-domain equivalent). The
  `ORG_RE`/`PRINCIPAL_RE` runtime regex is unchanged — this is a
  documentation + parameter-name rename — but downstream code that
  imported the old name must update.
- **Source grammar tightened to strict 3 segments (myelin#185, sibling
  PR).** The `source` field is now exactly `{principal}.{stack}.{assistant}`;
  the legacy `{2,4}` segment range (3–5 dot-separated tokens) is no
  longer accepted on read. Producers emitting 4- or 5-segment sources
  must collapse them before publishing.



### Breaking
- **Vocabulary migration (2026-05) — myelin#183: `{org}` → `{principal}` +
  strict source grammar (breaking cut).** Finishes the R6 + R7 transition
  started in PR-2 (`PRINCIPAL_RE` consolidation) and PR-6 (transition-window
  `source` grammar `{2,4}`). Per `CONTEXT.md` line 99 + 108:
  - **`envelope.source` grammar tightened to exactly 3 segments**
    (`{principal}.{stack}.{assistant}`). The legacy 3–5 segment
    `org.agent.instance` shape (the one the pilot review-loop bug
    exploited) is no longer accepted at validation time. The
    schema-level pattern `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$` becomes
    `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$`. The R6 deprecation warning
    on the legacy 4–5 segment form is dropped — legacy envelopes are now
    rejected.
  - **`{org}` → `{principal}` in subject-grammar documentation and code.**
    `specs/namespace.md` already canonical; the remaining `{org}` references
    in source comments, error messages, and TypeScript interface field
    names are renamed: `DeadLetterHandlerOptions.org` → `.principal`;
    `NakContext.org` → `.principal`; `LifecycleEmitterOptions.org` →
    `.principal`; `SubscribeLifecycleOptions.org` → `.principal`;
    `ObservableTransportOptions.metricsAutoEmit.org` → `.principal`;
    `ObservableTransport.metricsSubject(org, …)` argument renamed;
    `BiddingPublisherOptions.org` → `.principal`; `BiddingAgentOptions.org`
    → `.principal`; `CreateBidLifecycleEventOptions.org` → `.principal`;
    `OrchestratorOptions.org` → `.principal`;
    `CreateWorkflowLifecycleEventOptions.org` → `.principal`. The
    `assertSegment` error labels rename from `"org"` to `"principal"`,
    so test regexes matching `/Invalid org segment/` now read
    `/Invalid principal segment/`.
  - **Schema version bumped to v3** (`$id` `…/envelope/v2` → `…/envelope/v3`).
    v2 stays published for consumers pinned to the transition grammar; v1
    stays published for consumers pinned to the pre-migration grammar.
  - **Package version bumped to 0.3.0**.

  Unblocks `cortex#453` (cortex-side `{org}` rename + local-code rename
  once cortex pulls new myelin).

## [0.2.0] — 2026-05

Agent vocabulary + auth-strict transport, tagged `v0.2.0` (2026-05-14). The
transition runway for the vocabulary migration: type-shell renames land as
deprecated aliases (non-breaking), and chain-of-stamps signing ships. The
breaking cuts that consume this runway land in `0.3.0`.

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
  - **Deployment ordering — verifiers before emitters.** "Backward-
    compatible" is a *reader* property. A myelin on this release **emits**
    the new `identity`-keyed wire form, which a pre-transition peer cannot
    verify. Every node that *verifies* signed envelopes must therefore be
    on this transition release (or newer) before — or simultaneously with
    — any node that *emits*. The ecosystem upgrade is coordinated (lockstep
    companion PRs per the manifest), so there is no organic mixed-version
    window; operators must still roll out verifiers first.
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
- **Vocabulary migration (2026-05) — PR-7 of N: `src/dispatch/*` (R2
  payload + R7/R11/R13).** The dispatch lifecycle cluster joins the
  transition release. Every change is backward-compatible.
  - **R2 — dispatch-payload DID field `principal` → `identity`.** The six
    lifecycle payload interfaces (`AssignedPayload`, `StartedPayload`,
    `ProgressPayload`, `CompletedPayload`, `FailedPayload`,
    `AbortedPayload`) rename their actor-DID key. These payloads ride
    inside the envelope `payload` field, which is **signable** — so the
    rename has the same wire-safety profile as PR-6's envelope-level R2.
    The payload bytes are canonicalized as received (never re-keyed), so a
    pre-migration / JetStream-replayed payload carrying `principal` still
    validates AND verifies. myelin **emits** `identity` (the interfaces
    declare it; emitters spread caller input through verbatim). The TS
    types model "exactly one of `identity` xor `principal`" as exclusive
    unions, mirroring PR-6's `OriginatorDidKey`.
  - **Dual-field conflict rejection — extended to the dispatch payload.**
    A new `readPayloadIdentity` transition reader (`src/dispatch/`) reuses
    the `detectDualField` / `readRenamedField` pair PR-6 introduced — now
    extracted to `src/dual-field.ts` so `envelope.ts` and the dispatch
    cluster share ONE implementation of the security boundary. A payload
    carrying BOTH `principal` and `identity` is rejected with the typed
    `dual_field_conflict` error, whether the values match or differ.
    Consumers replaying a pre-migration `EVENTS` stream MUST use this
    reader; a companion cortex dispatch-listener PR is required.
  - **R13 — dispatch `ReceivedPayload.target_principal` → `target_assistant`.**
    Both keys are accepted on read through the transition window; the
    deprecated key is removed in the breaking major.
  - **R11 — `"broadcast"` → `"offer"`** in dispatch comments and tests.
  - **R7 — `{org}` → `{principal}`** in dispatch subject-grammar comments,
    and the `org` code parameter renamed to `principal` in
    `deriveLifecycleSubject` / `deriveLifecycleWildcard` /
    `lifecycleSubjectAndType` and `getEventsStreamConfig`. The
    `assertSegment` error-message label stays `"org"` (user-facing prose,
    deferred to the R12a doc pass).
  - **Cross-version regression tests** ship in
    `src/dispatch/payload-identity.test.ts` proving an old-`principal`-key
    payload validates + verifies, a new-`identity`-key payload validates +
    verifies, and a both-keys payload is rejected with `dual_field_conflict`.

### Added
- **F-018 (MY-400), myelin#8** Identity attestation baseline: single-stamp
  Ed25519 `signed_by`, JCS (RFC 8785) canonical signing payload, and the
  identity registry — the L4 foundation the chain-of-stamps (#31) below
  extends. (This entry consolidates a design note that was previously left
  dangling at the end of the file.)
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
