---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: BCP-0001                   # Best Current Practice series; number never reused
title: Wire Change Control and Versioning
status: Draft                   # Draft | Proposed | Ratified | Obsoleted — v1: 'Proposed' rung dormant (ADR-0001); pipeline is grill→author→verify→Ratified
category: Best Current Practice # Standards Track | Informational | Best Current Practice
obsoletes: []                   # [NNNN, ...] RFCs this one replaces entirely
updates: []                     # [NNNN, ...] RFCs this one amends in place
authors:
  - name: Luna
    affiliation: metafactory
signatories: []                 # v1 (ADR-0001): the principal alone ratifies (Andreas). Reinstate-target adds the hub custodian (JC).
created: 2026-07-12
ratified: null                  # ISO date once status becomes Ratified; null otherwise
grammar: null                   # this BCP is policy; it defines no syntax of its own
vectors: null                   # conformance is a checklist (Appendix B), not parse vectors
generated:                      # artifacts DERIVED from `grammar`; never hand-edited
  - []
crossRefs:                      # sibling RFCs this document references (REVISIONS C6/C7 ownership intake)
  - "0001"                      # ratified (single-principal, ADR-0001) DID-migration coordinated cut (RFC-0001 §9) — scoped here (§6.4) as a destructive [principal-hands] cut, NOT a "dual-accept exception" (no mandatory dual-accept default in v1)
  - "0002"                      # legacy 5-segment subject: grammar + legacy accept/reject rule stay there (RFC-0002 §8.2, D17/D18); retirement window + release naming owned HERE (§7, C6)
  - "0003"                      # spec_version emission-release naming + $id/version-channel reconciliation owned HERE (§4.1, §7, C7); RFC-0003 resolves field-presence as envelope-law (its D3/D5) and defers scheduling here
  - "0004"                      # canonicalization, the signable field set + permanent field-ids, and the absent-key invariant are owned there (RFC-0004 §3, §4.1); cited HERE as the canonicalization owner (D22)
  - "0007"                      # TASKS_DEAD stream-filter alignment slice stays there (RFC-0007 OD-4); retirement window + release naming owned HERE (§7, C6)
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
safe (verifiers before emitters for additions, emitters before verifiers for removals), the pinning
and vendoring discipline required of consumers, and the procedure by which any wire change becomes
normative. It states, as its own normative model, the **v1 single-principal / living-spec** regime
of [ADR-0001](../../docs/adr/0001-single-principal-ratification.md): while myelin is the only
implementation and no federated peer is live, a wire change is a coordinated revise-and-reimplement
cut proven by the conformance vectors, and the heavier ceremony — immutability-once-`Ratified`, the
two-signature act, and a mandatory dual-accept window — is a documented **reinstate-target**, not a
v1 requirement. What v1 keeps is the load-bearing safety: the emitters-vs-verifiers staging order,
the mandatory naming of a retirement release, the persisted-stream drain discipline, and the
`[principal-hands]` go/no-go checklist that gates any destructive, history-discarding cut (§6.4). It
is a Best Current Practice: it binds the process by which every other RFC in this series is amended
or obsoleted. It records, as findings rather than as design, the places where the deployed protocol's
own version channels have drifted from the policy stated here.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations
MUST NOT ground behaviour on a `Draft` or `Proposed` document. Under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md) the `Proposed` rung is **dormant**
in v1 — the pipeline runs grill → author → verify → `Ratified` directly — but it is suspended, not
deleted, and returns with the two-signature discipline.

Under **single-principal ratification (v1)** — [ADR-0001](../../docs/adr/0001-single-principal-ratification.md)
— a `Ratified` RFC is a **living spec**, not a stone tablet: `Ratified` means the current best
contract the implementation tracks, and a hole found in review or use is closed by **revising the
RFC and reimplementing what is required**. The immutability ceremony — never edited in place,
changes shipped only as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` — is the documented
**reinstate-target** (§2.2), not a v1 rule.

Ratification in v1 requires the signature of **the principal alone** (Andreas), recorded in
`signatories`. The two-signature act — adding **the hub custodian** (JC) — is **suspended, not
deleted**: a wire contract that binds more than one party cannot be ratified by one, which is why the
second signature returns the moment a second independent implementation exists or a live federated
peer principal joins (§2.2). The hub custodian (JC) has declined to co-sign for now; under ADR-0001
that does not block ratification while the room the second signature guards is still empty.

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
   - 2.1 The v1 change-control model (single-principal, living spec)
   - 2.2 The reinstate trigger; suspended vs. retained discipline
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
records the reconciliation. It does not retroactively bless a defect: a policy that ratified the
drift it was written to prevent would be worse than none. The open reconciliations the first draft
carried are resolved by the ratified grill (2026-07-14) and are now stated as go-forward
requirements, not deferred questions.

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
the old and the new form of a changing element. Defined in §6. In v1 it is OPTIONAL (§2.2) and is the
reinstate-target default. A **retirement release** is the named release that ends a transitional
acceptance, mandatory whenever one is opened (§7).

**Hard cut (flag-day migration).** A coordinated single-release wire change with **no** transitional
(dual-accept) window: every emitter and verifier flips at one named release. In v1 (§2.1) a wire
change is ordinarily a coordinated cut of exactly this shape. A hard cut that is also **destructive**
— it discards persisted signed history that will no longer verify — additionally requires the
`[principal-hands]` go/no-go discipline of §6.4; the migration on record is the DID-encoding
migration (RFC-0001 §9).

**Consumer.** A repository that constructs or parses a myelin wire representation and is therefore
bound by the conformance regime: at time of writing, cortex, pilot, and signal. The authoritative
roster is the one in [`specs/CONFORMANCE.md`](../CONFORMANCE.md) (§8.4). A consumer is **not** an
independent implementation (below): it carries RFC-0004 layered-conformance obligations (its own
parser/shim runs the vectors; inherited pure primitives may be), but it is under our control and
does not, by existing, trip the ADR-0001 reinstate trigger.

**Independent implementation.** An implementation of the myelin wire that is **external** — not
under our control — and has built against a version it expects to stay stable. This is the term in
the ADR-0001 reversal trigger (a): its existence reinstates the full discipline (§2.2). In-ecosystem
consumers (cortex, pilot, signal) that hand-roll a parser or vendor the schema are **Consumers**
(above) with RFC-0004 layered-conformance obligations, **not** independent implementations, and do
not trip the trigger. The term names an outside party the wire binds — the room the suspended
discipline guards.

**Pin.** The exact myelin version a consumer depends on. A **pin-bump** is the coordinated advance
of every consumer's pin ahead of a breaking cut.

**Signature terms** — the signable field set (`SIGNABLE_FIELDS`) and its permanent field-ids,
canonicalization, and the absent-key invariant — are used as defined by RFC-0004 (Envelope Signing &
Canonicalization) §3/§4.1, which owns them; the envelope fields that carry them (including
`spec_version`) are RFC-0003. This document does not redefine them.

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
[`specs/README.md`](../README.md) and the template's Status-of-This-Memo section, itself scoped by
ADR-0001 (§2.1). This document governs the versioning of the *wire*, which is a distinct concern
with a distinct set of channels.

### 2.1. The v1 change-control model (single-principal, living spec)

This section states the v1 model as this BCP's own normative regime; it mirrors the doctrine of
[`specs/CONFORMANCE.md`](../CONFORMANCE.md) §"Changing the wire" and is governed by
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md).

Under **single-principal ratification (v1)**, a `Ratified` RFC in this series is a **living spec**,
not a stone tablet: `Ratified` means the current best contract the one implementation tracks. While
myelin is the only implementation and no federated peer is live:

- A wire change is handled by **revise-and-reimplement**: change the owning RFC, regenerate the
  derived artifacts (the grammar-generated regexes/schemas, and the vectors), and prove the change
  with the **conformance vectors** — the load-bearing artifact under this model. The change is
  ratified on the **principal's signature alone** (§9).
- A wire change **MAY** ship as a coordinated single-release cut. A dual-accept window is **NOT
  REQUIRED** in v1 (§6); the emitters-vs-verifiers staging order (§5), the persisted-stream drain
  discipline (§6.2), the mandatory naming of a retirement release (§7), and the destructive-cut
  `[principal-hands]` discipline (§6.4) still apply — they are the safety, not the ceremony.
- The change record for a wire change is the mechanism ADR-0001 retains: an Appendix-C change-log
  entry in the owning RFC, the committed grill log, and the regenerated vectors. This BCP references
  that mechanism; §2 disclaims RFC-*document* versioning, so the boilerplate is owned by the
  template and `rfc/PLAN.md`, not here.

Nothing in §2.1 licenses a *silent* wire change: every wire change is still specified, vectored, and
logged (§9). What v1 drops is the immutability ceremony and the mandatory dual-accept window, not the
rigor that catches holes.

### 2.2. The reinstate trigger; suspended vs. retained discipline

The heavier discipline in this document — the mandatory dual-accept window (§6), immutability-once-
`Ratified` and the two-signature ratification act (§9), and the `Proposed` review rung — is the
**reinstate-target**. It is **suspended, not deleted**, and it **reinstates in full** the moment
either (the ADR-0001 reversal trigger):

- **(a)** a **second independent implementation** of the wire (as defined in §1.2 — external, not
  under our control) exists, **or**
- **(b)** a **live federated peer principal** joins a network.

At that point the wire binds a party we do not control and an implementation has built against a
version it expects to be stable; the safeguards' purpose is no longer dormant. Reinstatement is a
**prerequisite**, not a discretionary review item.

**Suspended in v1** (returns on the trigger): immutability-once-`Ratified`; two-signature
ratification; and the mandatory dual-accept window.

**Retained in v1** (live now — the value ADR-0001 keeps): the logged grill decisions, the conformance
vectors, and the adversarial-verify passes — plus the change-control safety that does not depend on
the ceremony: the emitters-vs-verifiers staging order (§5), the persisted-stream drain discipline
(§6.2), the mandatory retirement-release naming (§7), consumer pin/vendoring/roster discipline (§8),
and the destructive-cut `[principal-hands]` go/no-go (§6.4).

Where a later section states the suspended discipline as a MUST, read it as the reinstate-target
requirement scoped by this section; the v1 requirement is the retained-column safety above.

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
> The reconciliation is fixed in §4.1: the `v1→v2→v3` history is documented as provenance and **not**
> retro-minted, and the go-forward channels are pinned (breaking-structural ⇒ `$id` bump; the package
> minor + CHANGELOG anchor is the authoritative wire-version signal).

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

A breaking wire change to the **structural** envelope container (§1.2) MUST be accompanied by a new
schema `$id` version (`vN → v(N+1)`). The prior `$id` version MUST remain retrievable for consumers
pinned to it (§10). An additive change (§1.2) MAY reuse the current `$id`.

A verifier MUST NOT rely on the `$id` alone to select a grammar, because — as recorded in §3.1 —
the deployed `$id` has not been bumped in lockstep with breaking cuts. The **authoritative
wire-version signal is the package minor plus the CHANGELOG anchor** (§4.3); the `$id` is a coarse
**structural** marker.

**Reconciliation of the frozen `$id` (resolved, REVISIONS C7).** The `v3`-denotes-four-accept-sets
drift (§3.1) is **not** retro-minted: the `v1→v2→v3` history is recorded here and in RFC-0003 as
provenance, and no `envelope/v4|v5|v6` are minted for the 0.4.0/0.5.0/0.6.0 accept-sets. Instead the
package minor + CHANGELOG anchor is ratified as the authoritative wire-version channel and `$id` is
demoted to the coarse structural-schema marker it already is. **Go-forward**, the two move together
again: a breaking change to the container shape MUST bump `$id`, and the DID-migration flag-day
release R already carries one such bump (RFC-0001 §9.1 item 3), consistent with this rule. This
reconciliation has a single owner — it is decided **here**; RFC-0003 resolves the `spec_version`
field-presence question as envelope-law (its D3/D5: warn-on-newer + permanent closed contract) and
defers the emission-release scheduling and this `$id` reconciliation to this document (§4.2, §7).

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
> allowed-fields sweep reject an unknown field regardless of `spec_version` (RFC-0003 D3: the closed
> contract is permanent). Only field-removing or value-tightening bumps are forward-compatible under
> the deployed grammar.
>
> **Resolution (D5) — `spec_version` reconciles with the `$id` generation counter.** `spec_version`
> **is** the wire-grammar generation number, and it shares one counter with the schema `$id`: the
> generation whose schema is `$id vN` is `spec_version` `N`. The current generation is **3** (it
> coincides with `envelope/v3`). Values `1` and `2` therefore denote the earlier envelope generations
> (the `v1`/`v2` schemas) that predate the field; they are **defined but never emitted** — a live
> emitter only ever stamps the current generation (`≥ 3`), so no envelope legitimately carries
> `spec_version` `1` or `2`. Going forward a breaking wire-grammar change increments the generation
> (and, when it is a structural-container change, bumps `$id` in lockstep, §4.1); an additive change
> does not.

> **Finding (not a design).** Until the B2 emit phase ships (§7 — scheduled for **0.7.0**), no
> emitter stamps `spec_version`, so `absent ⇒ legacy` is ambiguous (absent may mean legacy OR a
> current emitter that does not yet stamp) and no verifier can require the field. A verifier MUST NOT
> require `spec_version` before the named emission release (§7) has shipped and the transitional
> acceptance it opens has reached its retirement release.

### 4.3. Package version semantics (pre-1.0)

While myelin is pre-1.0, a **minor** version bump (`0.Y → 0.(Y+1)`) MAY be a breaking wire change,
and a breaking wire change MUST be released as at least a minor bump. A **patch** bump
(`0.Y.Z → 0.Y.(Z+1)`) MUST NOT change the wire. This makes the package minor the **authoritative**
coarse-grained wire-version signal (§4.1). The 1.0 line and post-1.0 semantics are out of scope for
this document and are a future revision item when myelin approaches 1.0; the superseded playbook
doctrine that named the vocabulary migration as the 1.0 cut (it shipped as 0.3.0–0.6.0 minors) MUST
NOT be followed.

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
on is now the authoritative one in `specs/CONFORMANCE.md`, §8.4.)

### 5.3. The invariant that makes additive changes safe

Adding a signed OPTIONAL field is safe across a signature boundary **only** because of the
absent-key canonicalization invariant defined by RFC-0004 (Envelope Signing & Canonicalization) §4.1:
a field absent from the signable field set never enters the canonical signing payload, so a pre-field
envelope canonicalizes byte-identically and its old signature keeps verifying. An implementation MUST
preserve this invariant; a change that breaks it (canonicalizing a defaulted-in value for an absent
key, or re-keying a field before canonicalization) is a breaking change even if the schema looks
additive. Conversely, dropping a key from the signable field set (`SIGNABLE_FIELDS`, whose membership
RFC-0004 §4.1 owns) permanently breaks verification of replayed pre-migration envelopes that signed
over it — such a change is breaking and REQUIRES the stream-drain discipline of §6.2.

---

## 6. The Dual-Accept Window

A wire change that renames or replaces an element, rather than purely adding or removing one, is —
**once the discipline reinstates** (§2.2) — carried through a **dual-accept window** so that
producers and consumers can cross it on independent schedules. **In v1 (§2.1) a dual-accept window is
NOT REQUIRED**: a rename MAY ship as a coordinated revise-and-reimplement cut. The window is defined
in this section (a) as the reinstate-target default and (b) as an OPTIONAL v1 tool; whenever a window
**is** opened — in v1 by choice, or mandatorily once reinstated — its mechanics (§6.1–§6.3) bind in
full. Two parts of this section are **live v1 discipline regardless of any window**: the
persisted-stream drain/replay safety (§6.2) and the destructive-cut `[principal-hands]` discipline
(§6.4).

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
the four renames it has carried, three are now clean cuts; the one still-open transition is the
dispatch `payload.principal → payload.identity` rename, whose coordinated close is now named in §7.)

### 6.2. Minimum duration and stream replay

The stream-replay and drain rules below are **live v1 discipline** (§2.2): persisted history is the
one place a coordinated v1 cut still needs care, because a cut that outruns a stream's retention
silently loses the ability to verify replayed history. Only the first bullet (window minimum
duration) is reinstate-target — it binds when a dual-accept window is actually opened.

- When a dual-accept window is opened it MUST remain open for at least one release (reinstate-target
  default; in v1 it binds to any window opened by choice).
- A consumer that replays a persisted stream (e.g. JetStream) MUST remain on a release that accepts
  the pre-migration form for **at least the full retention period of every stream it replays**. A
  consumer MUST NOT jump straight to a release that rejects the legacy form while it still replays a
  stream that can contain the legacy form.
- Before a breaking cut that drops a `SIGNABLE_FIELDS` member, the affected streams MUST be drained
  (retention fully expired) — a live stream MUST NOT be renamed in place; a new stream is created,
  dual-published or mirrored, and the old one retired after drain.

### 6.3. Both-present is a boundary, not a convenience

The `dual_field_conflict` rule (§6.1) is a security boundary and, for any transition window that is
open (in v1 by choice, or under the reinstated default), MUST behave identically in every
implementation and at every trust boundary that parses the element. A consumer that implements its
own parser (rather than importing the reference) MUST reproduce this behaviour and MUST prove it
against the conformance checklist (Appendix B) and RFC-0004's layered-conformance vectors. Divergence
here is the exact failure the RFC series exists to end: two parsers, one grammar, silent disagreement.

### 6.4. Destructive and irreversible cuts — the `[principal-hands]` discipline (the DID-encoding migration)

In v1 a wire change is ordinarily a coordinated cut (§2.1), so a hard cut is not an *exception* to a
mandatory default — there is no mandatory dual-accept default in v1 to except. What a cut can be is
**destructive**: a cut after which persisted, previously-signed history no longer verifies and is
**discarded, not migrated**. Any such destructive, irreversible cut — at any scale, in v1 or under
the reinstated discipline — is **live discipline** here: it MUST be gated behind a `[principal-hands]`
cutover checklist with its own go/no-go, executed by the principals rather than by automation, and
its destructive consequence MUST be recorded and accepted **with** the decision, not discovered after
it.

The migration on record is the `did:mf` encoding migration to the class-explicit dot-form, **ratified
single-principal** (Andreas, per [ADR-0001](../../docs/adr/0001-single-principal-ratification.md);
RFC-0001 §9) as a coordinated **hard cut**: one flag-day release **R** flips every emitter and
verifier together; the envelope-field DID and the subject `@`-segment — deriving from one source —
flip **atomically, per emitter** (RFC-0001 §9.1); there is NO transitional window and NO
dual-registration; and the destructive purge of persisted old-form state is gated behind a
`[principal-hands]` cutover checklist with its own go/no-go, executed by the principals, not by
automation (RFC-0001 §9.3). The cut's destructive consequence — pre-cut signed history stops
verifying and is discarded, not migrated — was accepted with the decision, not discovered after it
(RFC-0001 §9.2).

That ruling recorded an explicit **proportionality** judgement: the cost and downgrade surface of
mixed-generation machinery were judged to exceed the cost of one coordinated flag day (RFC-0001 §8.9).
It conforms to the rest of this document: release R carries the schema `$id` bump §4.1 requires of a
breaking structural change (RFC-0001 §9.1 item 3), and the flag-day release is itself the named cut
§7 demands — there is simply no window between open and close.

The `[principal-hands]` discipline generalises beyond that migration:

- Any wire change that discards persisted signed history MUST gate every destructive step behind a
  `[principal-hands]` checklist with a go/no-go, MUST record the proportionality reasoning, and MUST
  state the destructive consequence up front — exactly as RFC-0001 §9 does. This holds in v1; it is
  not softened by the living-spec model, because history loss is irreversible independently of any
  signature or window ceremony.
- Once the two-signature + dual-accept discipline reinstates (§2.2), a hard cut additionally requires
  the ratification override the reinstated §6/§9 impose (an RFC that states it overrides the
  dual-accept default and records the same proportionality reasoning). In v1 that override is moot —
  there is no mandatory default to override — but the destructive-cut checklist above still binds.

The DID migration does not extend past its subject. Every other transition in this document — the
legacy 5-segment subject retirement (§7), the dispatch `payload.principal` rename (§7), the
`spec_version` B2 emit (§7) — is a non-destructive wire-grammar change handled by the ordinary v1
coordinated-cut path (or the reinstated dual-accept path), **not** the RFC-0001 §9 hard cut. In
particular the legacy 5-segment subject retirement is a subject-grammar change, and RFC-0007 OD-4
correctly records that this BCP's change-control regime applies to it, not the RFC-0001 §9 DID hard
cut.

---

## 7. Retirement Releases

A transitional acceptance without a named end is a migration that never ends. This section is the
core of this BCP, and it is **live v1 discipline** (§2.2): the living-spec model drops the mandatory
dual-accept window, **not** the requirement to name — and reach — the release that ends a legacy-form
acceptance.

- Every transitional acceptance — a dual-accept window (§6), or a plain legacy-form acceptance kept
  for a coordinated v1 cut — MUST, at the moment it is opened, **name the release that will retire
  it**. The retirement release MUST be recorded in the RFC that opened the acceptance and in the
  CHANGELOG.
- A wire change that opens a transitional acceptance without naming its retirement release MUST NOT
  be ratified (§9).
- Closing a transitional acceptance is a removal and MUST follow the emitters-before-verifiers order
  (§5.2): the emitter-side deprecation and the pin-bump train precede the verifier-side rejection.
- A validator that accepts a legacy form **MUST** emit a deprecation warning on that form for at
  least the release preceding its retirement, so that the window's traffic is observable before it is
  cut. (This is promoted from SHOULD to a v1 MUST: it is machine-checkable and it is the forcing
  function that makes a coordinated cut safe — see the archetype below.)

**The v1 forcing function.** Under single-principal v1 there is no external counterpart whose
schedule dictates the window; the forcing function is internal and mechanical: (1) the retirement
release is named at open and tracked in the CHANGELOG; (2) the deprecation warning MUST ship no later
than the release before retirement; (3) the coordinated cut lands at the named release once every
consumer on the authoritative roster (§8.4) emits the canonical form. A named target the forcing
function has not yet met is **revised** to the next release under the living-spec model — but it is
never left unnamed.

> **The archetype — the default-derivation window (resolved).** The legacy 5-segment (stack-omitted)
> subject form was the only wire transition with no named retirement release, no tracking issue, and
> no implemented warning. The subject-namespace prose (`specs/namespace.md`, "Backward
> compatibility") promised that "validators … warn on the legacy form; a later release will promote
> that warning to an error", but the reference implementation emitted the 5-segment form silently and
> warned nowhere. **Finding:** that unimplemented promise is a non-conformance against this section.
> **Requirement (v1):** a validator that accepts the legacy 5-segment form MUST emit the deprecation
> warning (above); the warning MUST ship at **0.7.0**, and the legacy form is retired — the warning
> promoted to a hard reject — at **0.8.0** as a coordinated cut, gated on every roster consumer
> emitting the explicit-stack 6-segment form (the v1 forcing function). This is a subject-grammar
> change under this BCP's change-control regime (in v1 a coordinated cut; the dual-accept window is
> the reinstate-target), **not** the RFC-0001 §9 DID hard cut (§6.4).
>
> **Ownership (REVISIONS C6 split — this BCP is the schedule's single owner).** **RFC-0002** owns the
> subject grammar and the legacy accept/reject rule (RFC-0002 §8.2, D17/D18), and defers the release
> naming *here*. **This BCP** owns the retirement window, the release naming, AND the
> warn-before-retire deprecation-warning requirement of this section — the namespace.md promise with
> no implementation is a non-conformance against *this* section, and the warning requirement does not
> move when RFC-0002 supersedes that prose. **RFC-0007** owns only the `TASKS_DEAD` stream-filter
> alignment slice (its OD-4).

> **The field-rename window — dispatch `payload.principal` (resolved).** The dispatch
> `payload.principal → payload.identity` window is retired at **0.7.0** as a coordinated cut, gated on
> every dispatch producer emitting `payload.identity` (the forcing function; emitters-before-verifiers,
> §5.2). If the forcing function is not met at 0.7.0 the target is revised to the next minor and
> re-recorded in the CHANGELOG — but a named close release is mandatory (it MUST NOT return to
> unnamed). In v1 no dual-accept window is required; if one is kept for the crossing, its §6.1
> `dual_field_conflict` mechanics bind.

> **The deferred additive emit — `spec_version` B2 (resolved).** The second phase of the
> `spec_version` rollout (emitters stamp the field) ships at **0.7.0** — the next minor after 0.6.0
> (D6). It is an additive change and MUST ship verifiers-before-emitters (§5.1); the accept-and-sign
> B1 phase already shipped at 0.5.0, so 0.7.0 satisfies the ordering. Until 0.7.0 ships, no window can
> be closed *by* `spec_version` and `absent ⇒ legacy` stays ambiguous (§4.2); once it ships, a later
> named release MAY make the field REQUIRED (§4.2).
>
> **Ownership (REVISIONS C7).** This BCP is the single owner of naming the B2 emission release and of
> the schema-`$id`/version-channel reconciliation (§4.1). RFC-0003 resolves the residual
> field-presence question as envelope-law (its D3/D5) and defers this scheduling here. The coupling
> that made the emission release un-nameable in isolation — `spec_version` was added to a closed
> contract (`additionalProperties: false`) at `$id v3` without a bump, so a consumer pinned to a
> pre-field copy of `v3` hard-rejects the moment emission begins — is resolved by §4.1's channel
> reconciliation plus the verifiers-before-emitters ordering and the roster pin-bump (§8): every
> roster consumer MUST be on a pin that accepts `spec_version` before 0.7.0 emits it.

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

**Resolution (D14).** The single authoritative consumer roster is the one in
[`specs/CONFORMANCE.md`](../CONFORMANCE.md) — the same document that owns the conformance regime and
the vendored-copy drift gate (RFC-0004's conformance home). The divergent lists elsewhere
(`RELEASING.md` names seven, the CHANGELOG's pin-bump proof names six) are **not** authoritative and
MUST be reconciled *to* the CONFORMANCE.md roster, not treated as parallel sources. A CI check that
the pin-bump announcement covers exactly the CONFORMANCE.md roster is RECOMMENDED, and becomes the
mechanical enforcement of the §5.2 emitters-before-verifiers gate; until it exists the gate is held
by the pin-bump train and the roster read together. Adding or removing a consumer is a change to
CONFORMANCE.md, not to this document.

---

## 9. Ratifying a Wire Change

A wire change is never a silent edit. **In v1 (§2.1)** it MUST proceed, in order:

1. **Specify and reimplement.** The change is specified in the owning RFC and reimplemented; the RFC
   is revised in place under the living-spec model (§2.1). *Reinstate-target:* the change is instead
   specified in a **new** RFC carrying `Updates: NNNN` (amends) or `Obsoletes: NNNN` (replaces), and
   the prior `Ratified` RFC becomes immutable and MUST NOT be edited in place (§2.2).
2. **Ratify.** The RFC is ratified on the **principal's signature alone** (Andreas), recorded in
   `signatories` (§2.1). *Reinstate-target:* the RFC MUST additionally be signed by the hub custodian
   (JC); one party MUST NOT then ratify a wire contract alone (§2.2).
3. **A schema version.** A breaking change to the structural container MUST bump the schema `$id`
   (`vN → v(N+1)`), and the prior version MUST remain retrievable for pinned consumers (§10). *(Live
   v1.)*
4. **Stage the crossing.** In v1 the change MAY ship as a coordinated single-release cut; a
   dual-accept window is **not required** (§6). *Reinstate-target:* receivers MUST accept both the
   old and the new form for at least one release (§6), logging use of the old form. Either way, a
   **destructive** cut (it discards persisted signed history) MUST carry the `[principal-hands]`
   go/no-go purge checklist and the recorded proportionality reasoning §6.4 requires, and MUST drain
   the affected streams first (§6.2). *(§6.2 and §6.4 are live v1.)*
5. **A named retirement release.** The RFC MUST name the release that retires any legacy-form
   acceptance it opens (§7). An RFC that opens a transitional acceptance without naming its retirement
   release MUST NOT be ratified. (For a §6.4 flag-day cut, the named release is itself the cut; there
   is no window to retire.) *(Live v1.)*
6. **The staging order.** The change MUST be staged by class (§5): additions verifiers-before-emitters;
   removals/closes emitters-before-verifiers, gated on the consumer roster (§8.4). *(Live v1 — this is
   the real safety the living-spec model retains.)*
7. **Vectors.** A syntactic change MUST ship vectors (RFC-0004 / the vectors regime) that encode the
   new form, the old form, and every masking/collision/edge case the change introduces; conformance is
   decided by the vectors, not by reading. *(Live v1 — the load-bearing artifact.)*

In v1 the **change record** for the wire change is, per ADR-0001: an Appendix-C change-log entry in
the owning RFC, the committed grill log, and the regenerated vectors (§2.1). This document references
that mechanism rather than owning its boilerplate (§2 disclaims RFC-*document* versioning).

The cross-repo mechanics of steps 3–6 are specified **here**; `specs/README.md` previously deferred
them to compass `sops/federation-wire-protocol.md`, which contains no such content — that deferral is
superseded (§15.2). A future revision MAY re-home the operational runbook to compass and reference it,
but the normative rules remain here.

---

## 10. Rollback Anchors

- Each release MUST be tagged on the commit whose `package.json` carries that version. The release
  tag is the rollback anchor a consumer pins to when a cut misbehaves.
- The schema version prior to a breaking cut MUST remain retrievable, so a pinned consumer can hold
  its validator on the prior `$id` across the crossing.

**Resolution (D7) — retrievability is by release tag, not a hosted publication endpoint.** In v1
"remain retrievable" is satisfied by the git **release tag** plus the schema file committed at that
tag: the prior `$id`/schema is recoverable at `git show <tag>:schemas/envelope.schema.json`, and
consumers pin by commit SHA or tag (§8.2), so they already hold the exact bytes they validate
against. A separate hosted schema-publication workflow (serving `envelope/vN` at a URL) is **NOT
REQUIRED** in v1, and the "`v1`/`v2` stays published as a URL" affordance is **struck** in favour of
tag retrievability; standing up a hosted publication endpoint is a **reinstate-target** for when an
external independent implementation needs to fetch a pinned schema it cannot get from our git history
(§2.2).

> **Finding (not a design).** The 0.3.0 breaking cut — the largest, which minted schema `v3` — was
> never tagged, and the migration playbook's mandated `pre-vocab-migration` rollback tag does not
> exist; consumers cannot pin the 0.3.0 cut or the pre-migration floor by tag. This is a historical
> gap, not a go-forward affordance: the go-forward **MUST** (above) is that every release is tagged on
> its `package.json` commit, which makes tag-retrievability hold from here on. The untagged historical
> cuts SHOULD be back-tagged where the commits are identifiable.

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
canonicalization (§6.1) are the defence whenever such a window is open. The mandatory retirement
release (§7) bounds the exposure — an unbounded window is an unbounded downgrade surface, which is why
the default-derivation window (formerly open indefinitely) is now given a named retirement (§7). **In
v1 the downgrade surface is smaller by construction:** a coordinated cut (§2.1) opens no window, so no
interval exists in which both forms verify and no mixed-generation machinery exists to get wrong — at
the cost that a *destructive* cut discards signed history (RFC-0001 §9.2), which is exactly what the
§6.4 `[principal-hands]` go/no-go weighs. The window's downgrade surface returns only when a window is
opened (optionally in v1, or mandatorily once the dual-accept discipline reinstates, §2.2).

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
- A consumer conforms if it satisfies §8 (pin, vendoring, roster) and, for any open transition
  window, reproduces the §6.1 `dual_field_conflict` behaviour, proven against the vectors of the
  syntactic RFC that defines each renamed field. Canonicalization and signing conformance follows
  RFC-0004's layered-conformance regime (a consumer's own parser/shim runs the vectors; inherited
  pure primitives may be) — a consumer is a Consumer, not an independent implementation (§1.2).

Prose explains; the checklist binds. Where this document states a MUST and a release does not satisfy
it, the release is non-conformant regardless of whether it "works" — the failures this document
prevents are silent by construction.

---

## 15. References

### 15.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [ADR-0001] metafactory, [`docs/adr/0001-single-principal-ratification.md`](../../docs/adr/0001-single-principal-ratification.md)
  — single-principal ratification + living-spec model for the RFC series (v1). Governs this
  document's status model (§2.1, §2.2, Status of This Memo) and the reinstate trigger.
- [RFC-0004] metafactory, "Envelope Signing & Canonicalization" (Ratified, single-principal) — owns
  the signable field set (`SIGNABLE_FIELDS`) and its permanent field-ids, canonicalization (JCS
  profile), the absent-key invariant (§5.3), and the layered-conformance regime a consumer's
  parser/shim proves against.
- [RFC-0003] metafactory, "Envelope Format" (Ratified, single-principal) — defines the envelope
  fields (including `spec_version`) and the `$id` this document versions; resolves the `spec_version`
  field-presence question as envelope-law (its D3/D5) and defers the emission-release scheduling and
  `$id` reconciliation here (§4).
- [RFC-0002] metafactory, "Subject Namespace" (Ratified, single-principal) — owns the subject grammar
  generations and the legacy accept/reject rule (its §8.2, D17/D18), and defers the legacy-form
  retirement window + release naming here (§7).
- [RFC-0001] metafactory, "Identifiers & the `did:mf` DID Method" (Ratified, single-principal) —
  defines the identifier terminals a subject/envelope change may touch; its §9 hard cut is the
  destructive coordinated cut governed by §6.4's `[principal-hands]` discipline.
- [CONFORMANCE] metafactory, [`specs/CONFORMANCE.md`](../CONFORMANCE.md) — the conformance regime,
  the authoritative consumer roster (§8.4), and the vendored-copy drift gate.

> Note: RFC-0001, RFC-0002, RFC-0003, and RFC-0004 are `Ratified` (single-principal, ADR-0001) at
> the time of this writing; RFC-0007 (Transport & Reliability) is `Draft`. Per the grounding
> contract, an implementation MUST NOT ground behaviour on a `Draft`. This BCP is authored as `Draft`
> and, once authored and verified, is itself ratifiable single-principal (D19); its normative force
> over the series' change control attaches when it reaches `Ratified`.

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

- [ ] The change is classified additive | removal/close | rename (§5, §6) — or carries an
      explicitly ratified hard-cut ruling (§6.4).
- [ ] A breaking change bumps the schema `$id` and keeps the prior version retrievable (§4.1, §10).
- [ ] An additive signed field ships verifiers-before-emitters; emit is a later release (§5.1).
- [ ] A removal/close ships emitters-before-verifiers, gated on the consumer roster (§5.2, §8.4).
- [ ] The absent-key canonicalization invariant is preserved (§5.3).
- [ ] A rename is crossed by a coordinated cut (v1) or, if a transition window is opened, its §6.1
      mechanics hold (both forms accepted, old logged, both-present rejected with `dual_field_conflict`
      **before** canonicalization). A **destructive** cut carries the `[principal-hands]` purge
      checklist, recorded proportionality reasoning, and stream drain (§6.2, §6.4, §9).
- [ ] Every transitional/legacy-form acceptance names its retirement release in the RFC and the
      CHANGELOG **at open time** (§7). *(Live v1.)*
- [ ] Streams that can carry the legacy form are drained before a `SIGNABLE_FIELDS` drop (§5.3, §6.2).
- [ ] A validator that still accepts a legacy form MUST warn on it in the release preceding retirement
      (§7 — promoted to a v1 MUST).
- [ ] The change is specified and reimplemented, ratified on the principal's signature alone (v1,
      ADR-0001), with vectors for old form, new form, masking, and collisions (§9); the change record
      is the Appendix-C entry + committed grill log + regenerated vectors. *Reinstate-target:* a new
      RFC (`Updates:`/`Obsoletes:`) signed by principal + hub custodian (§2.2, §9).
- [ ] The release is tagged on the commit carrying its `package.json` version (§10).

**Per consumer (continuous):**

- [ ] Pins a reproducible myelin version (commit or exact tag), not a floating range (§8.2).
- [ ] Is within one breaking minor of every producer it interoperates with (§8.1).
- [ ] Imports rather than vendors, or fails the build on vendored-copy drift (§8.3).
- [ ] Reproduces the `dual_field_conflict` behaviour for every open rename window and proves it
      against that RFC's vectors (§6.3).
- [ ] Appears on the authoritative consumer roster (§8.4).

**Standing dispositions (resolved by the ratified grill, 2026-07-14 — now go-forward requirements):**

- [x] Schema `$id` reconciled: history documented as provenance, **not** retro-minted; package minor +
      CHANGELOG anchor is authoritative, `$id` a coarse structural marker; breaking-structural ⇒ `$id`
      bump go-forward (§4.1, D4).
- [x] Default-derivation (legacy 5-segment subject) window: deprecation warning ships **0.7.0**,
      retirement cut **0.8.0** gated on ecosystem explicit-stack emit; warning is a v1 MUST (§7, D8–D10;
      this BCP owns window + warning per the C6 split, RFC-0002 §8.2 D17/D18 owns grammar/accept-reject,
      RFC-0007 OD-4 only the `TASKS_DEAD` filter alignment).
- [x] `spec_version` B2 emit release scheduled and named: **0.7.0** (§4.2, §7, D6).
- [x] `payload.principal → payload.identity` dispatch window: named close **0.7.0**, gated on producers
      emitting `payload.identity` (§7, D11).
- [x] Prior-`$id` retrievability: by release tag + committed schema-at-tag; hosted publication endpoint
      NOT REQUIRED in v1 (reinstate-target) (§10, D7).
- [x] Authoritative consumer roster designated: `specs/CONFORMANCE.md` (§8.4, D14).
- [x] `spec_version`↔`$id` generation counter reconciled; values `1`/`2` denote the pre-field `v1`/`v2`
      generations (defined, never emitted); live emitters stamp `≥ 3` (§4.2, D5).

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. Under single-principal v1 (ADR-0001) a
`Ratified` RFC is a **living spec** — revisable on a hole, with the change logged here and proven by
regenerated vectors; the immutable-once-`Ratified` / new-RFC-per-change regime is the reinstate-target
(§2.2).

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Consolidates the change-control and migration doctrine from RELEASING.md, docs/migrations/0001, CHANGELOG, and specs/CONFORMANCE.md §"Changing the wire" into a normative BCP; names the three version channels; specifies the emitters-vs-verifiers ordering, the dual-accept window mechanics, mandatory retirement releases, consumer pin/vendoring discipline, and the ratification procedure; records seven open decisions and the standing findings the audit surfaced (frozen `$id`, unretired default-derivation window, unshipped `spec_version` B2, open `payload.principal` window, missing schema publication, non-authoritative consumer roster, undefined `spec_version`/grammar coupling). |
| 2026-07-14 | Draft | Reconciliation with [ADR-0001](../../docs/adr/0001-single-principal-ratification.md) (single-principal / living spec), resolving all 22 decisions of the ratified grill (`grill-logs/rfc-bcp-0001.md`). **D1:** new §2.1 states the v1 living-spec/single-principal model as this BCP's own normative regime (mirroring CONFORMANCE.md §"Changing the wire", minus its FWP-deferral tail); Status-of-This-Memo + front matter flipped to principal-alone-in-v1 (hub custodian on reinstate), ADR-0001 cited inline. **D2:** §1.2 defines "independent implementation" as external/not-under-our-control — in-ecosystem consumers do not trip the reinstate trigger. **D3/D16:** §2.2 fixes suspended (immutability, two-signature, mandatory dual-accept, `Proposed` rung) vs retained (grill log, vectors, adversarial verify, staging order, stream-drain, retirement naming, pin/roster, `[principal-hands]`). **D4–D7:** §4.1/§4.2 resolve the `$id` reconciliation (no retro-mint; package-minor authoritative), reconcile `spec_version` with the generation counter (values 1/2 = pre-field generations), name B2 emit at 0.7.0; §10 resolves prior-`$id` retrievability by tag. **D8–D11:** §7 resolves the three open windows (legacy 5-segment warn 0.7.0 / retire 0.8.0; dispatch `payload.principal` close 0.7.0; `spec_version` B2 0.7.0), promotes the warn-before-retire warning to a v1 MUST, adds the v1 forcing function. **D12/D13:** §6.4 recast as the destructive-cut `[principal-hands]` discipline (live v1), dropping the "exception-to-a-mandatory-dual-accept-default" framing; "pending JC" corrected to Ratified single-principal. **D14/D15:** §8.4 designates CONFORMANCE.md as the authoritative roster; machine-checkable invariants promoted to v1-MUSTs. **D17:** v1 change-record referenced (Appendix-C entry + grill log + vectors), not over-owned. **D18–D22:** residual two-party language reconciled; ADR-0001 cited; cross-RFC decision IDs corrected (RFC-0002 §8.2 D17/D18, RFC-0003 D3/D5, RFC-0007 OD-4); RFC-0004 added to `crossRefs`/references as the canonicalization owner. Status stays `Draft` (ratifiable single-principal after verify, D19). |
| 2026-07-13 | Draft | Cascade sweep (REVISIONS.md pass + RFC-0001 ratification propagation). **Scoping:** new §6.4 records that the DID-encoding migration was ratified (RFC-0001 §9, Andreas 2026-07-12, pending JC co-signature) as a coordinated HARD CUT — a deliberate proportionality ruling for a two-principal ecosystem, gated by a `[principal-hands]` purge checklist — superseding the dual-accept default *for that migration only*; any future hard cut requires the same explicit ruling. §1.2 (Hard cut term), §6 intro, §9 steps 4–5, §12 (downgrade), Abstract, Appendix B, and §15.1 scoped accordingly. **C6:** §7 archetype takes single ownership of the legacy 5-segment subject retirement window/release naming + the warn-before-retire deprecation warning (the unimplemented namespace.md promise); RFC-0002 keeps grammar + accept/reject (OD-2), RFC-0007 keeps only `TASKS_DEAD` filter alignment (OD-4). **C7:** §4.1 OD + §7 B2 quote take single ownership of the `spec_version` emission-release naming + `$id`/version-channel reconciliation; RFC-0003 defers scheduling here, retaining only field-presence (its OD-6). Front matter gains `crossRefs` (0001, 0002, 0003, 0007). DID-example cascade: no-op (this BCP carries no `did:mf` examples). |

## Acknowledgments

This document is grounded in an audit of the deployed myelin wire protocol (origin/main) and its M7
consumers, and in the change-control doctrine authored by the myelin and cortex maintainers across
the 2026-05 vocabulary migration.

## Authors' Addresses

Luna (metafactory) — on behalf of the principal, Andreas.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/