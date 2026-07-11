---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: BCP-0001                   # Best Current Practice series; number never reused
title: Wire Change Control and Versioning
status: Draft                   # Draft | Proposed | Ratified | Obsoleted
category: Best Current Practice # Standards Track | Informational | Best Current Practice
obsoletes: []                   # [NNNN, ...] RFCs this one replaces entirely
updates: []                     # [NNNN, ...] RFCs this one amends in place
authors:
  - name: Luna
    affiliation: metafactory
signatories: []                 # Ratification REQUIRES: the principal AND the hub custodian
created: 2026-07-12
ratified: null                  # ISO date once status becomes Ratified; null otherwise
grammar: null                   # this BCP is policy; it defines no syntax of its own
vectors: null                   # conformance is a checklist (Appendix B), not parse vectors
generated:                      # artifacts DERIVED from `grammar`; never hand-edited
  - []
supersedes_prose:               # informative docs this RFC makes normative
  - RELEASING.md
  - docs/migrations/0001-vocabulary-grilled-2026-05.md
  - specs/CONFORMANCE.md §"Changing the wire"
---

# RFC-BCP-0001: Wire Change Control and Versioning

## Abstract

This document specifies how the myelin wire protocol — the M3 envelope, subject namespace, and
identifier grammars of the Internet-of-Agentic-Work stack — is permitted to change over time, and
how those changes are versioned, staged, and retired. It defines the three version channels that
travel on or beside the wire (the schema `$id`, the signed `spec_version` field, and the
subject-grammar generation), the classes of change and the ordering doctrine that keeps each class
safe (verifiers before emitters for additions, emitters before verifiers for removals), the
mechanics and mandatory retirement of a dual-accept window, the pinning and vendoring discipline
required of consumers, and the ratification procedure by which any wire change becomes normative.
It is a Best Current Practice: it binds the process by which every other RFC in this series is
amended or obsoleted. It records, as findings rather than as design, the places where the deployed
protocol's own version channels have drifted from the policy stated here.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations
MUST NOT ground behaviour on a `Draft` or `Proposed` document.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are
published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** and **the hub custodian**, recorded in
`signatories`. A wire contract binds more than one party; it cannot be ratified by one. For this
BCP the two signatures are Andreas (principal) and JC (hub custodian).

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
   - 1.1 Requirements Language
   - 1.2 Terminology
2. Scope and Applicability
3. The Version Channels on the Wire
4. Version Semantics
5. Change Classes and the Emitters-vs-Verifiers Doctrine
6. The Dual-Accept Window
7. Retirement Releases
8. Consumer Pin and Vendoring Discipline
9. Ratifying a Wire Change
10. Rollback Anchors
11. Registry Considerations
12. Security Considerations
13. Privacy Considerations
14. Conformance
15. References
- Appendix A. Collected ABNF
- Appendix B. Change-Control Conformance Checklist
- Appendix C. Change Log

---

## 1. Introduction

The myelin wire protocol is small, but it is a contract between independently deployed
implementations — myelin itself (M3, the reference), and its M7 consumers cortex, pilot, and
signal. When one of them renders an identity, a subject, or an envelope field into wire bytes and
another parses it differently, the disagreement is silent and the failure is remote in space and
time. The RFC series exists to make each such representation a machine-readable contract. This BCP
governs the one thing an immutable contract cannot govern about itself: **how it is allowed to
change.**

The problem this document solves is that today no normative document owns wire change control.
The doctrine is real and battle-tested — dual-accept transition readers, a typed
`dual_field_conflict` rejection, an emitters-before-verifiers ordering exercised across the 0.3.0,
0.4.0, and 0.6.0 breaking cuts — but it is scattered across `RELEASING.md` (an informative repo
doc), the `CHANGELOG`, and a migration playbook, and the scaffold's `specs/README.md` claims the
cross-repo process "lives in compass `sops/federation-wire-protocol.md`", which contains none of
it. This BCP consolidates that doctrine into a single normative home and closes the gaps the audit
of the deployed protocol surfaced.

This document does **not** define the envelope, the subject namespace, or the identifier grammars.
Those are RFC-0003, RFC-0002, and RFC-0001 respectively. This document defines only the rules by
which those RFCs — and the artifacts they promote — may be versioned and superseded. It makes
normative the change-control and migration doctrine currently carried informatively by
`RELEASING.md` and `docs/migrations/0001-vocabulary-grilled-2026-05.md` (listed in
`supersedes_prose`).

Where the deployed protocol violates a rule stated here, this document says so explicitly and
records the reconciliation as an **[OPEN DECISION]**. It does not retroactively bless a defect: a
policy that ratified the drift it was written to prevent would be worse than none.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text or a cited finding as a
> requirement.

### 1.2. Terminology

**Wire change.** Any change to the bytes that cross a trust boundary: a subject-grammar change, an
envelope field added/removed/renamed, a value-set (enum, pattern) tightened or loosened, or a
change to what is signed.

**Breaking wire change.** A wire change after which an envelope or subject valid under the prior
grammar is rejected under the new one, OR a previously-verifying signature no longer verifies. A
field rename is breaking, because field names are the signed bytes.

**Additive change.** A wire change that only adds an OPTIONAL element, such that every prior-grammar
message remains valid and every prior signature remains verifiable. Adding a signed OPTIONAL field
is additive only because of the absent-key canonicalization invariant (§5.3).

**Version channel.** An observable on or beside the wire that carries a version: the schema `$id`,
the `spec_version` field, or the subject-grammar generation. Defined in §3.

**Emitter.** An implementation that constructs and sends a wire representation. **Verifier.** An
implementation that receives, validates, and (for signed envelopes) checks the signature over one.
A single deployment is usually both; the two roles are staged independently during a change (§5).

**Dual-accept window (transition window).** A bounded interval during which verifiers accept both
the old and the new form of a changing element. Defined in §6. A **retirement release** is the
named release that ends it (§7).

**Consumer.** A repository that constructs or parses a myelin wire representation and is therefore
bound by the conformance regime: at time of writing, cortex, pilot, and signal. Defined against the
roster in [`specs/CONFORMANCE.md`](../CONFORMANCE.md), subject to **[OPEN DECISION — Andreas + JC —
the roster is not authoritative]** (§8.4).

**Pin.** The exact myelin version a consumer depends on. A **pin-bump** is the coordinated advance
of every consumer's pin ahead of a breaking cut.

**Signature terms** (`SIGNABLE_FIELDS`, canonicalization, absent-key invariant) are used as defined
by RFC-0003 (Envelope); this document does not redefine them.

---

## 2. Scope and Applicability

This BCP applies to every change to any artifact any RFC in this series marks normative or promotes
from prose: the envelope JSON Schema, the subject-namespace grammar, the identifier grammars, the
`SIGNABLE_FIELDS` set, and the vectors that bind them.

- An implementation that emits or verifies myelin wire representations MUST follow this document
  when it changes the representation it emits or accepts.
- The reference implementation (myelin, M3) MUST NOT ship a breaking wire change except by the
  ratification procedure in §9.
- A consumer (M7) MUST follow the pin and vendoring discipline in §8.

This BCP does **not** govern changes that are invisible on the wire: internal refactors, test-only
changes, performance work, or documentation that does not state a wire rule. It does not govern the
versioning of an RFC *document* — that is the immutability-and-supersession regime in
[`specs/README.md`](../README.md) and the template's Status-of-This-Memo section. This document
governs the versioning of the *wire*, which is a distinct concern with a distinct set of channels.

---

## 3. The Version Channels on the Wire

The deployed protocol carries version information on three independent channels. This section
states what each channel is; §4 states what each MUST mean. Naming them is prerequisite to fixing
the fact — recorded throughout — that they do not today agree.

### 3.1. Schema `$id`

The envelope JSON Schema carries a version in its `$id` URL path, of the form
`https://myelin.metafactory.ai/schemas/envelope/vN`. It is the coarse, human-legible schema-version
channel. (Informative provenance: the deployed value is `.../envelope/v3`, minted at the 0.3.0
breaking cut.)

> **Finding (not a design).** The `$id` was bumped `v1 → v2` at the PR-6 transition and `v2 → v3`
> at the 0.3.0 cut, then held at `v3` through three further wire-contract changes — 0.4.0
> (`target_principal` removed), 0.5.0 (`spec_version` added), 0.6.0 (`broadcast` and
> `originator.principal` removed). The single token `v3` therefore denotes four distinct accept-sets.
> The reconciliation is **[OPEN DECISION — Andreas + JC — §4.1]**.

### 3.2. The `spec_version` field

The envelope carries an OPTIONAL signed integer `spec_version` naming the wire-grammar generation
the emitter believes it produced. It is fine-grained and, being in `SIGNABLE_FIELDS`, is
tamper-evident. (Informative provenance: current value `3`; the field is in a two-phase rollout —
B1, accept-and-sign-when-present, shipped at 0.5.0; B2, emit, is unshipped as of 0.6.0.)

### 3.3. The subject-grammar generation

A NATS subject is emitted in one of two grammar generations: the legacy 5-segment
`{class}.{principal}.{domain}.{entity}.{action}` form, or the stack-aware 6-segment
`{class}.{principal}.{stack}.{domain}.{entity}.{action}` form. The generation is **not** a field;
it is inferred from the segment count and out-of-band hints. (Informative provenance: the two forms
are not discriminable from the subject bytes alone — the third segment of a legacy subject is a
domain segment, which shares the stack alphabet — so the reference implementation's form-detection
is a heuristic that defaults to `legacy`.)

---

## 4. Version Semantics

### 4.1. Schema `$id` semantics

A breaking wire change to the envelope (§1.2) MUST be accompanied by a new schema `$id` version
(`vN → v(N+1)`). The prior `$id` version MUST remain retrievable for consumers pinned to it (see
§10 and the **[OPEN DECISION]** on publication, §10). An additive change (§1.2) MAY reuse the
current `$id`.

A verifier MUST NOT rely on the `$id` alone to select a grammar, because — as recorded in §3.1 —
the deployed `$id` has not been bumped in lockstep with breaking cuts. Until the reconciliation
below lands, the authoritative wire-version signal in practice is the package minor plus the
CHANGELOG anchor.

> **[OPEN DECISION — Andreas + JC — no tracking issue; blocked on a ratification decision]**
> Reconcile the frozen `$id`. Either (a) retroactively mint `envelope/v4`, `v5`, `v6` for the
> 0.4.0/0.5.0/0.6.0 accept-sets and publish them, or (b) ratify the package minor + CHANGELOG anchor
> as the authoritative wire-version channel and demote `$id` to a coarse structural marker. This
> document states the go-forward MUST (breaking ⇒ `$id` bump) but does not choose the remediation of
> the existing `v3`-means-four-things history.

### 4.2. `spec_version` semantics

- `spec_version`, when present, MUST be an integer ≥ 1.
- A verifier receiving a `spec_version` **greater than** the generation it implements MUST NOT
  reject the envelope on that basis alone; it SHOULD log the newer version and proceed
  (accept-and-warn forward-compatibility). It MAY still reject the envelope for any other reason
  (an unknown top-level field, a failed signature, a value out of range).
- `spec_version` is in `SIGNABLE_FIELDS` (RFC-0003) and MUST be signed when present, so that it
  cannot be downgraded or tampered in transit.
- An absent `spec_version` MUST be treated as an unversioned (legacy, pre-field) envelope and MUST
  NOT be rejected for absence, until a retirement release (§7) makes the field REQUIRED.

> **Finding (not a design).** Forward-compatible accept-and-warn is unrealizable for any change
> that adds a top-level field: the schema's `additionalProperties: false` and the verifier's
> allowed-fields sweep reject an unknown field regardless of `spec_version`. Only field-removing or
> value-tightening bumps are forward-compatible under the deployed grammar. Which change classes MAY
> bump `spec_version` — and what values `1` and `2` denote, given the field did not exist in those
> grammars — is **[OPEN DECISION — Andreas + JC — §4.2, blocked on OD-1]**.

> **Finding (not a design).** Until the B2 emit phase ships (§7, **[OPEN DECISION]**), no emitter
> stamps `spec_version`, so `absent ⇒ legacy` is ambiguous (absent may mean legacy OR
> current-emitter-that-does-not-yet-stamp) and no verifier can ever require the field. A verifier
> MUST NOT require `spec_version` before that retirement release is named and reached.

### 4.3. Package version semantics (pre-1.0)

While myelin is pre-1.0, a **minor** version bump (`0.Y → 0.(Y+1)`) MAY be a breaking wire change,
and a breaking wire change MUST be released as at least a minor bump. A **patch** bump
(`0.Y.Z → 0.Y.(Z+1)`) MUST NOT change the wire. This makes the package minor the reliable
coarse-grained wire-version signal today (see §4.1). The 1.0 line and post-1.0 semantics are out of
scope for this document and are a future **[OPEN DECISION]** when myelin approaches 1.0; the
superseded playbook doctrine that named the vocabulary migration as the 1.0 cut (it shipped as
0.3.0–0.6.0 minors) MUST NOT be followed.

---

## 5. Change Classes and the Emitters-vs-Verifiers Doctrine

Every wire change is one of three classes, and each class has a mandatory staging order. The order
exists because emitters and verifiers deploy independently; getting it backwards drops or rejects
live traffic.

### 5.1. Additive change — verifiers before emitters

To add an OPTIONAL element (a new OPTIONAL field, a widened value set):

1. A release MUST first make verifiers **accept** the new element (and, for a signed field, sign it
   when present) while no emitter produces it.
2. A **later** release MAY then make emitters produce it.

An emitter MUST NOT produce a new element before a release exists in which verifiers accept it,
because an older verifier drops an unknown field from the signing payload and would then reject the
envelope. (Informative provenance: the `spec_version` rollout is exactly this — B1 accept shipped
at 0.5.0; B2 emit is the deferred second release.)

### 5.2. Removal / window close — emitters before verifiers

To remove an element or close a transition window (reject a form previously accepted):

1. Every emitter MUST stop producing the legacy form **first** — coordinated by the pin-bump train
   (§8).
2. Only **after** every emitter has stopped MAY a release make verifiers **reject** the legacy form.

A release MUST NOT reject a legacy form while any emitter in the consumer roster still produces it.
(Informative provenance: the 0.6.0 cut removed `broadcast` and `originator.principal` only after
the CHANGELOG's G1 pin-bump train landed the emitter changes across consumers; the roster it rests
on is itself an **[OPEN DECISION]**, §8.4.)

### 5.3. The invariant that makes additive changes safe

Adding a signed OPTIONAL field is safe across a signature boundary **only** because of the
absent-key canonicalization invariant defined by RFC-0003: a field absent from an envelope never
enters the canonical signing payload, so a pre-field envelope canonicalizes byte-identically and
its old signature keeps verifying. An implementation MUST preserve this invariant; a change that
breaks it (canonicalizing a defaulted-in value for an absent key, or re-keying a field before
canonicalization) is a breaking change even if the schema looks additive. Conversely, dropping a
key from `SIGNABLE_FIELDS` permanently breaks verification of replayed pre-migration envelopes that
signed over it — such a change is breaking and REQUIRES the stream-drain discipline of §6.2.

---

## 6. The Dual-Accept Window

A wire change that renames or replaces an element, rather than purely adding or removing one, is
carried through a **dual-accept window** so that producers and consumers can cross it on independent
schedules.

### 6.1. Mechanics

During a dual-accept window for a renamed element:

- Verifiers MUST accept both the deprecated key/form and the canonical key/form.
- Verifiers SHOULD log every use of the deprecated form, so the window's readiness to close is
  observable.
- A record carrying **both** the deprecated and the canonical key of the same element MUST be
  rejected with a typed `dual_field_conflict` error — whether the two values are equal or not (an
  equal pair is an over-eager-producer bug; an unequal pair is a downgrade/confusion attack).
- The both-present conflict check MUST run **before** any canonicalization or signature-bytes
  derivation, so that an attacker cannot present one form for signature canonicalization and the
  other for downstream parsing.
- A verifier MUST NOT silently coalesce a dual-keyed record to one value.

(Informative provenance: this is the deployed `detectDualField` / `readRenamedField` machinery. Of
the four renames it has carried, three are now clean cuts; the one still-open window is the dispatch
`payload.principal → payload.identity` rename — see §7 and its **[OPEN DECISION]**.)

### 6.2. Minimum duration and stream replay

- A dual-accept window MUST remain open for at least one release.
- A consumer that replays a persisted stream (e.g. JetStream) MUST remain on a release that accepts
  the pre-migration form for **at least the full retention period of every stream it replays**. A
  consumer MUST NOT jump straight to a release that rejects the legacy form while it still replays a
  stream that can contain the legacy form.
- Before a breaking cut that drops a `SIGNABLE_FIELDS` member, the affected streams MUST be drained
  (retention fully expired) — a live stream MUST NOT be renamed in place; a new stream is created,
  dual-published or mirrored, and the old one retired after drain.

### 6.3. Both-present is a boundary, not a convenience

The `dual_field_conflict` rule (§6.1) is a security boundary and MUST behave identically in every
implementation and at every trust boundary that parses the element. A consumer that implements its
own parser (rather than importing the reference) MUST reproduce this behaviour and MUST prove it
against the conformance checklist (Appendix B). Divergence here is the exact failure the RFC series
exists to end: two parsers, one grammar, silent disagreement.

---

## 7. Retirement Releases

A dual-accept window without a named end is a migration that never ends. This section is the core
of this BCP.

- Every dual-accept window (§6) and every legacy-form acceptance MUST, at the moment it is opened,
  name the release that will retire it. The retirement release MUST be recorded in the RFC that
  opened the window and in the CHANGELOG.
- A wire change that opens a window without naming its retirement release MUST NOT be ratified
  (§9).
- Closing a window is a removal and MUST follow the emitters-before-verifiers order (§5.2): the
  emitter-side deprecation and the pin-bump train precede the verifier-side rejection.
- A validator that accepts a legacy form SHOULD emit a deprecation warning on that form for at
  least the release preceding its retirement, so that the window's traffic is observable before it
  is cut.

> **The archetype — the default-derivation window.** The legacy 5-segment (stack-omitted) subject
> form is the only wire transition window with **no** named retirement release, **no** tracking
> issue, and **no** implemented warning. The subject-namespace prose promises that "validators …
> warn on the legacy form; a later release will promote that warning to an error", but the reference
> implementation emits the 5-segment form silently and warns nowhere. This is the exact shape this
> section forbids going forward. Its remediation — naming the retirement release and landing the
> emitter warning that MUST precede it — is **[OPEN DECISION — Andreas + JC — no tracking issue;
> blocked on ecosystem cutover to explicit-stack emit]**.

> **The open field-rename window — dispatch `payload.principal`.** The dispatch
> `payload.principal → payload.identity` window is open with no named close release, no milestone,
> and no tracking issue. Naming its close release is **[OPEN DECISION — Andreas + JC — no tracking
> issue; close is emitters-before-verifiers, gated on every dispatch producer emitting
> `payload.identity`]**.

> **The deferred additive emit — `spec_version` B2.** The second phase of the `spec_version`
> rollout (emitters stamp the field) is unshipped and untracked. Until it ships, no window can ever
> be closed *by* `spec_version`, and `absent ⇒ legacy` stays ambiguous (§4.2). Scheduling and naming
> the B2 release is **[OPEN DECISION — Andreas + JC — untracked; blocked on OD-1]**.

---

## 8. Consumer Pin and Vendoring Discipline

### 8.1. One breaking minor behind

A consumer MUST NOT be more than one breaking minor behind the producer it must interoperate with.
A consumer on `0.(Y-2)` cannot safely interoperate with a `0.Y` producer. The pin-bump train — cut
the release, announce it, land the consumer pin-bumps — MUST complete before the next breaking cut.

### 8.2. Pin mechanism

A consumer MUST pin a specific, reproducible myelin version (a commit SHA or an exact release tag),
not a floating range, so that a wire change never reaches a consumer that has not been staged for
it. (Informative provenance: cortex pins by commit SHA in `package.json`. A consequence is that the
"one breaking minor behind" rule (§8.1) is mechanically unenforced today — a SHA is not
minor-comparable; enforcement is social via the pin-bump train.) A SHOULD-strength CI check that a
consumer's pin is within one breaking minor of the current release is RECOMMENDED.

### 8.3. Vendoring and drift

A consumer SHOULD import the myelin schema and vectors rather than vendor a copy. A consumer that
vendors a copy of any myelin artifact MUST fail its build when the vendored copy diverges from the
pinned version (per [`specs/CONFORMANCE.md`](../CONFORMANCE.md)). Hand-maintained metadata around a
vendored copy MUST be regenerated, never hand-edited, or it will drift.

> **Finding (not a design).** Vendored copies have already drifted: a consumer holds a vendored
> schema whose surrounding validator header cites one pin while the pin constant cites another, a
> code comment cites a source grammar (`{2,4}`) retired two cuts ago, and a hand-typed envelope
> interface omits the vendored schema's `spec_version` field; a third consumer holds the schema as a
> test fixture. Three hand-copied schema instances exist with no cross-repo drift gate. This is why
> §8.3 is a MUST.

### 8.4. The consumer roster

The emitters-before-verifiers safety of every window close (§5.2, §7) rests on the claim that every
consumer was already pin-bumped. That claim is unprovable without an authoritative consumer roster.

> **[OPEN DECISION — Andreas + JC — three divergent lists; needs a canonical home + a CI check]**
> Designate the single authoritative consumer roster. `RELEASING.md` names seven consumers, the
> CHANGELOG's pin-bump proof names six, and `specs/CONFORMANCE.md` names three. Until one home is
> authoritative and the pin-bump announcement is checked against it, "all consumers were already
> bumped" is an assertion, not a fact.

---

## 9. Ratifying a Wire Change

A wire change is never a silent edit. To become normative it MUST proceed, in order:

1. **A new RFC.** The change is specified in a new RFC that carries `Updates: NNNN` (amends) or
   `Obsoletes: NNNN` (replaces) the RFC that owned the prior grammar. A `Ratified` RFC is immutable
   and MUST NOT be edited in place.
2. **Two signatures.** The new RFC MUST be signed by the principal (Andreas) and the hub custodian
   (JC), recorded in `signatories`. One party MUST NOT ratify a wire contract alone.
3. **A schema version.** A breaking change MUST bump the schema `$id` (`vN → v(N+1)`), and the prior
   version MUST remain retrievable for pinned consumers (§10).
4. **A dual-accept window.** Receivers MUST accept both the old and the new form for at least one
   release (§6), logging use of the old form.
5. **A named retirement release.** The RFC MUST name the release that closes the window (§7). An RFC
   that opens a window without naming its retirement release MUST NOT be ratified.
6. **The staging order.** The change MUST be staged by class (§5): additions verifiers-before-emitters;
   removals/closes emitters-before-verifiers, gated on the consumer roster (§8.4).
7. **Vectors.** A syntactic change MUST ship vectors (RFC-0003 / the vectors regime) that encode the
   new form, the old form, and every masking/collision/edge case the change introduces; conformance
   is decided by the vectors, not by reading.

The cross-repo mechanics of steps 4–6 are specified here; `specs/README.md` previously deferred them
to compass `sops/federation-wire-protocol.md`, which contains no such content. This document is that
home. A future revision MAY re-home the operational runbook to compass and reference it, but the
normative rules remain here.

---

## 10. Rollback Anchors

- Each release MUST be tagged on the commit whose `package.json` carries that version. The release
  tag is the rollback anchor a consumer pins to when a cut misbehaves.
- The schema version prior to a breaking cut MUST remain retrievable, so a pinned consumer can hold
  its validator on the prior `$id` across the window.

> **Finding (not a design).** Two rollback affordances this section requires do not exist in the
> deployed protocol. (a) The 0.3.0 breaking cut — the largest, which minted schema `v3` — was never
> tagged, and the migration playbook's mandated `pre-vocab-migration` rollback tag does not exist;
> consumers cannot pin the 0.3.0 cut or the pre-migration floor by tag. (b) The "`v1`/`v2` stays
> published" affordance has no artifact: the repo carries one schema file, no CI workflow publishes
> schemas, and prior versions live only in git history. Standing up the schema publication mechanism
> (or striking the affordance) is **[OPEN DECISION — Andreas + JC — no publishing workflow exists]**.

---

## 11. Registry Considerations

This document registers the following:

- **RFC number.** `BCP-0001`, allocated in [`specs/README.md`](../README.md). BCP-series numbers are
  never reused.
- **No external registry actions.** This document defines no DID method, subject prefix, or
  identifier; it registers nothing in the [W3C DID Specification Registries][did-registries].
- **Reserved names.** None. Subject prefixes, segments, and identifiers are reserved by RFC-0001 and
  RFC-0002, not by this document.
- **Version tokens.** This document does not allocate schema `$id` version tokens; it constrains how
  they are allocated (§4.1). The allocation itself happens in each syntactic RFC.

---

## 12. Security Considerations

This document is process, but the process it governs is a security boundary: a mishandled wire
change drops, forges, or downgrades signed traffic. The threat model is a producer or consumer that
disagrees with another about what a byte sequence means, and an adversary who exploits that
disagreement.

**Invariants held by a runtime check, not by the format.** The RFC series requires that where an
invariant is held by vigilance rather than by the grammar, the document say so. For wire change
control:

- **`dual_field_conflict` is a guard, not a grammar.** JSON Schema cannot express "reject a record
  carrying both `X` and `Y`". The both-present rejection (§6.1) is enforced only by the runtime
  check, and only if that check runs before canonicalization. A verifier that omits it, or runs it
  after canonicalization, silently reopens the downgrade attack. This is a finding: the safety of
  every rename window depends on a hand-written check that the format does not enforce.
- **`spec_version` forward-compat is a guard, not the schema.** Accept-and-warn on a newer version
  (§4.2) lives only in verifier code; the schema constrains only `type` and `minimum`. A second
  verifier that validates the envelope against the schema alone (as at least one consumer does)
  neither warns nor enforces the rule — a `spec_version: 99` envelope validates silently there while
  the reference warns. Two verifiers, divergent behaviour, no normative floor. This BCP makes §4.2
  the floor; it does not by itself make the divergent consumer conform (Appendix B does).
- **The emitters-before-verifiers ordering is enforced socially.** Nothing mechanical prevents a
  verifier release that rejects a form some emitter still produces; the safety rests on the pin-bump
  train and the (non-authoritative) consumer roster (§8.4). A CI check of pin currency against the
  roster is RECOMMENDED precisely because the invariant is otherwise held by vigilance.
- **The absent-key canonicalization invariant (§5.3) is what makes additive signed fields safe.** It
  is a property of the canonicalization code, not of the schema. A change that breaks it turns an
  apparently-additive change into a signature-breaking one; §5.3 makes preserving it a MUST.

**Downgrade and confusion.** A dual-accept window is a downgrade surface: for its duration both
forms verify. The `dual_field_conflict` rule and the requirement that the conflict check precede
canonicalization (§6.1) are the defence. The mandatory retirement release (§7) bounds the exposure —
an unbounded window is an unbounded downgrade surface, which is why the default-derivation window
(open indefinitely, §7) is called out.

**The subject-grammar ambiguity is a routing/identity surface.** The two subject generations (§3.3)
are not discriminable from the wire bytes; form detection is a heuristic that defaults to `legacy`.
Where this default is applied at the *identity* layer rather than the *subscription* layer it
fabricates a `{principal}/default` identity for a stackless subject — the root-cause class of the
`default`-fabrication defect. The subject-namespace prose states the default-derivation rule at two
different RFC 2119 strengths (SHOULD in one place, MUST in another) and never scopes which layer it
applies to; a consumer's identity/roster layer now deliberately refuses to fabricate `default`,
doing the opposite of the MUST. Resolving the strength and scope is RFC-0002's to own; this BCP flags
it as a change-control finding because the ambiguity persists only because the window was never
retired (§7).

**Stale normative narration.** The envelope schema's top-level description still narrates a
pre-0.6.0 accept-set (claiming the deprecated originator form and `distribution_mode: broadcast` are
still accepted, and that `v1`/`v2` stay published) while the same file's field definitions reject
both. An implementer who generates a validator from the description gets the opposite wire contract
from one who generates it from the fields. A normative artifact's prose MUST NOT contradict its own
constraints; the description is a defect to be corrected, not a second contract.

**The unsigned extension point.** The `extensions` object is the designated no-version-bump
forward-compat channel and is excluded from the signing payload — it is mutable in transit with the
signature intact. Informative guidance recommends it for "routing hints a transport-layer middleware
reads". Routing decisions taken on unsigned, tamperable data are a spoofing surface. Anything that
must be attested MUST NOT ride `extensions`; this constraint belongs to RFC-0003's Security
Considerations and is noted here because "without a version bump" is a change-control affordance.

---

## 13. Privacy Considerations

This document specifies no identifier and mints no new observable. It does, however, govern two
version channels that are observable to any party on the transport path, and the privacy of those is
in scope for the policy that requires them.

- **`spec_version` and `$id` leak implementation generation.** Both channels advertise which
  grammar generation an emitter produces, and by inference which release of which implementation it
  runs. An observer can fingerprint a deployment's upgrade cadence and identify laggards (which are
  also the most likely to be vulnerable). This is inherent to carrying an on-wire version; the
  mitigation is not to omit the version (that reopens the ambiguity the version exists to close) but
  to keep the retirement discipline (§7) tight so the population of distinguishable generations stays
  small. Emitters SHOULD NOT carry a finer version granularity than change control requires.
- **The subject encodes principal and stack.** A subject is not a payload but it is on the wire in
  clear, and its `{principal}`/`{stack}` segments correlate a message to a deployment across
  contexts. This is a property of the namespace (RFC-0002), not of change control; it is noted here
  because widening or narrowing the subject grammar (a wire change this BCP governs) changes what the
  subject leaks.

---

## 14. Conformance

Conformance to this document is process conformance, decided by the checklist in Appendix B rather
than by parse vectors (this BCP defines no syntax). An implementation or a release conforms if and
only if it satisfies every applicable checklist item.

- The reference implementation (myelin) conforms if every wire change it ships satisfies §9 and the
  checklist.
- A consumer conforms if it satisfies §8 (pin, vendoring, roster) and reproduces the §6.1
  `dual_field_conflict` behaviour, proven against the vectors of the syntactic RFC that defines each
  renamed field.

Prose explains; the checklist binds. Where this document states a MUST and a release does not satisfy
it, the release is non-conformant regardless of whether it "works" — the failures this document
prevents are silent by construction.

---

## 15. References

### 15.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC-0003] metafactory, "Envelope" (Draft) — defines `SIGNABLE_FIELDS`, canonicalization, the
  absent-key invariant, `spec_version`, and the `$id` this document versions.
- [RFC-0002] metafactory, "Subject Namespace" (Draft) — defines the subject grammar generations and
  the default-derivation rule this document requires be retired.
- [RFC-0001] metafactory, "Identifiers and Identity (`did:mf` DID Method Specification)" (Draft) —
  defines the identifier terminals a subject/envelope change may touch.
- [CONFORMANCE] metafactory, [`specs/CONFORMANCE.md`](../CONFORMANCE.md) — the conformance regime,
  the consumer roster, and the vendored-copy drift gate.

> Note: RFC-0001/0002/0003 are `Draft` at the time of this writing. Per the grounding contract, an
> implementation MUST NOT ground behaviour on a `Draft`. Their citation here fixes the dependency;
> this BCP's normative force over their change control attaches when they and this document are
> `Ratified`.

### 15.2. Informative References

- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008. (Cited for completeness; this BCP defines no ABNF.)
- [RELEASING] myelin, `RELEASING.md` — the pre-1.0 versioning rule and migration doctrine this
  document promotes to normative (`supersedes_prose`).
- [MIG-0001] myelin, `docs/migrations/0001-vocabulary-grilled-2026-05.md` — the dual-read /
  stream-drain / rollback playbook this document promotes to normative, and whose superseded 1.0-cut
  semver doctrine §4.3 overrides.
- [CHANGELOG] myelin, `CHANGELOG.md` — the de-facto migration record (window open/close, ordering,
  pin-bump train) per breaking cut.
- [MIG-LEGACY] myelin, `docs/migration-from-legacy-nats.md` — the historical `mf.net-*` →
  `local`/`federated`/`public` migration (dual-publish/dual-subscribe + bounded dedup pattern).
- [FWP] compass, `sops/federation-wire-protocol.md` — the SOP `specs/README.md` previously named as
  the home of the dual-accept-window process; it contains none, and this document supersedes that
  deferral.

---

## Appendix A. Collected ABNF

This document is a Best Current Practice and defines **no syntax of its own**. It specifies the
process by which the syntactic RFCs (RFC-0001, RFC-0002, RFC-0003) may change; the grammars
themselves live in those RFCs and in [`specs/grammar/`](../grammar/). There is therefore no ABNF to
collect here, and the `grammar` front-matter field is `null`.

## Appendix B. Change-Control Conformance Checklist

This BCP is bound by a checklist rather than parse vectors (the `vectors` front-matter field is
`null`). Each item cites the section it enforces. A release or implementation conforms iff every
applicable item is satisfied.

**Per wire change (release-time):**

- [ ] The change is classified additive | removal/close | rename (§5, §6).
- [ ] A breaking change bumps the schema `$id` and keeps the prior version retrievable (§4.1, §10).
- [ ] An additive signed field ships verifiers-before-emitters; emit is a later release (§5.1).
- [ ] A removal/close ships emitters-before-verifiers, gated on the consumer roster (§5.2, §8.4).
- [ ] The absent-key canonicalization invariant is preserved (§5.3).
- [ ] A rename opens a dual-accept window: both forms accepted, old logged, both-present rejected
      with `dual_field_conflict` **before** canonicalization (§6.1).
- [ ] The window names its retirement release in the RFC and the CHANGELOG **at open time** (§7).
- [ ] Streams that can carry the legacy form are drained before a `SIGNABLE_FIELDS` drop (§5.3, §6.2).
- [ ] A validator that still accepts a legacy form warns on it in the release preceding retirement (§7).
- [ ] The change is specified in a new RFC (`Updates:`/`Obsoletes:`), signed by principal + hub
      custodian, with vectors for old form, new form, masking, and collisions (§9).
- [ ] The release is tagged on the commit carrying its `package.json` version (§10).

**Per consumer (continuous):**

- [ ] Pins a reproducible myelin version (commit or exact tag), not a floating range (§8.2).
- [ ] Is within one breaking minor of every producer it interoperates with (§8.1).
- [ ] Imports rather than vendors, or fails the build on vendored-copy drift (§8.3).
- [ ] Reproduces the `dual_field_conflict` behaviour for every open rename window and proves it
      against that RFC's vectors (§6.3).
- [ ] Appears on the authoritative consumer roster (§8.4).

**Standing findings that MUST be resolved (see Open Decisions):**

- [ ] Schema `$id` reconciled so a version token denotes exactly one accept-set (§4.1).
- [ ] Default-derivation (legacy 5-segment subject) window has a named retirement release and an
      implemented emitter warning (§7).
- [ ] `spec_version` B2 emit release scheduled and named (§4.2, §7).
- [ ] `payload.principal → payload.identity` dispatch window has a named close release (§7).
- [ ] Prior-`$id` schema publication mechanism exists, or the affordance is struck (§10).
- [ ] A single authoritative consumer roster is designated (§8.4).
- [ ] The `spec_version`-to-grammar coupling and the meaning of values `1`/`2` are defined (§4.2).

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes
ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Consolidates the change-control and migration doctrine from RELEASING.md, docs/migrations/0001, CHANGELOG, and specs/CONFORMANCE.md §"Changing the wire" into a normative BCP; names the three version channels; specifies the emitters-vs-verifiers ordering, the dual-accept window mechanics, mandatory retirement releases, consumer pin/vendoring discipline, and the ratification procedure; records seven open decisions and the standing findings the audit surfaced (frozen `$id`, unretired default-derivation window, unshipped `spec_version` B2, open `payload.principal` window, missing schema publication, non-authoritative consumer roster, undefined `spec_version`/grammar coupling). |

## Acknowledgments

This document is grounded in an audit of the deployed myelin wire protocol (origin/main) and its M7
consumers, and in the change-control doctrine authored by the myelin and cortex maintainers across
the 2026-05 vocabulary migration.

## Authors' Addresses

Luna (metafactory) — on behalf of the principal, Andreas.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/