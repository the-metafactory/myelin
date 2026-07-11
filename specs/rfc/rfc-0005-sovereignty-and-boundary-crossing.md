---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0005
title: Sovereignty and Boundary-Crossing
status: Draft
category: Standards Track
obsoletes: []
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories: []                 # Ratification REQUIRES: the principal AND the hub custodian
created: 2026-07-12
ratified: null
grammar: specs/grammar/sovereignty.abnf
vectors: specs/vectors/sovereignty/
generated:
  - schemas/envelope.schema.json   # properties.sovereignty subtree + sovereignty_required — co-owned with RFC-0003; the classification / model_class / data_residency / sovereignty_required patterns are derived artifacts of this grammar
supersedes_prose:
  - docs/sovereignty.md
  - docs/sovereignty-operator.md
---

# RFC-0005: Sovereignty and Boundary-Crossing

## Abstract

Every myelin envelope carries a `sovereignty` block — its passport — declaring where the
message may travel and what may process it. This document specifies that block: its five
required fields (`classification`, `data_residency`, `max_hop`, `frontier_ok`, `model_class`),
their syntax, and the boundary-crossing rules that govern a message as it leaves one principal
and arrives at another. It specifies the egress decision procedure (classification budget,
`block_local_escape`, allowed-subject allowlist, data-residency constraints) and the ingress
decision procedure (last-stamp principal lookup, scope mappings, subject scope, capability
ceiling), and it records where a declared invariant is held by a runtime check, by a
consumer-side gate, or by nothing at all. It is a Standards Track specification for the
sovereignty plane of the M3 wire protocol; the enforcement engine that implements it is F-5.

This document promotes the crossing semantics of `docs/sovereignty.md` and
`docs/sovereignty-operator.md` from informative prose to normative form. It codifies the wire
as it exists; several dead, fail-open, and contradictory behaviours the current implementation
exhibits are flagged in place as OPEN DECISIONS and Security Considerations rather than
silently ratified.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative.
Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are
published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** and **the hub custodian**, recorded in
`signatories`. A wire contract binds more than one party; it cannot be ratified by one.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
2. The Sovereignty Block
3. Attestation: Sovereignty Is a Signable Field
4. Classification and the Subject Prefix
5. Egress: Leaving a Boundary
6. Ingress: Arriving Across a Boundary
7. The Two-Layer Crossing Contract
8. Enforcement-Channel Artifacts (Naks and Audit)
9. Registry Considerations
10. Security Considerations
11. Privacy Considerations
12. Conformance
13. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

myelin's founding invariant is that **sovereignty travels with the message**. Policy is
self-carried in the envelope, never fetched out-of-band, so a message replayed from a
six-month-old archive still names the constraints attached at its origin. The unit of
sovereignty travel is the `sovereignty` block: a required, closed, five-field object on every
envelope.

This document specifies two distinct things that the informative prose conflates:

- **The block** — the wire syntax and required fields of `sovereignty`, and the separate
  top-level `sovereignty_required` routing field. This is *declaration*: what the message says
  about itself.
- **The crossing rules** — the decision procedures a node runs to decide whether a message may
  leave (egress) or be delivered (ingress) across a principal boundary. This is *enforcement*:
  what a node does with the declaration.

The block's *shape* is owned by the envelope schema (RFC-0003 promotes
`schemas/envelope.schema.json`). This document owns the block's *meaning* and the crossing
rules, which live today only in `docs/sovereignty.md` and `docs/sovereignty-operator.md` —
informative background with no normative force. This RFC promotes them.

### 1.0. Scope

This document specifies:

- the `sovereignty` block fields and their syntax (§2);
- that the block is a signable field, and the consequences (§3);
- the projection of `classification` into the subject prefix, and its alignment (§4);
- the egress decision procedure (§5) and the ingress decision procedure (§6);
- the two-layer (NSC + engine) crossing contract (§7);
- the enforcement channel's own wire artifacts — naks and audit (§8).

This document does **not** specify: the envelope's other fields (RFC-0003); the subject
grammar (RFC-0002); identifier terminals or the `did:mf` method (RFC-0001); the
canonicalization and signature bytes (a signing RFC, not yet allocated); the `SovereigntyPolicy`
KV document's transport, storage, or hot-reload mechanics (operator concern); or NSC
credential provisioning (operator/infra concern).

### 1.0.1. What this document does not resolve

Auditing the running implementation surfaced fields that are declared and signed but read by no
enforcement path, a residency check that fails open, an ingress rule that grants a stranger more
access than a declared partner, and two contradictory definitions of prefix alignment shipping
at once. This document does **not** invent fixes for these. It specifies the behaviour that
ships today where that behaviour is coherent, and marks each incoherent or dead behaviour as an
**OPEN DECISION** (collected in §9.2 and resolved only by ratification-time decision, not by this
Draft). Per the scaffold's Rule 6, an invariant held shut by a runtime check — or by nothing —
is a finding, not a design.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text, a description of
> current implementation behaviour, or an OPEN DECISION as a requirement.

### 1.2. Terminology

**Principal boundary.** The trust perimeter of one principal (the owner of one or more stacks).
Crossing it is what "federation" means. A `local`-classified message never crosses it.

**Classification.** One of `local`, `federated`, `public` — the maximum travel scope declared
by a message. Defined by `CLASSIFICATION_VALUES` (myelin `src/classifications.ts`).

**Data residency.** An ISO 3166-1 alpha-2 country code carried by the message as a geographic
constraint.

**Hop.** A federation forwarding. `max_hop` is the declared budget. This document does **not**
define how a receiver observes a hop; that is OD-2.

**Frontier model.** A cloud-hosted (non-local) AI model. `frontier_ok` and `model_class`
declare whether such a model may process the message.

**Egress.** The decision made when a message is about to leave a node onto a subject.

**Ingress.** The decision made when a message arrives at a node, before any application handler
sees it.

**Sovereignty engine (F-5).** The runtime component that runs the egress and ingress procedures,
driven by an operator-provisioned `SovereigntyPolicy` document. Its reference implementation is
`src/sovereignty/` in myelin.

**SovereigntyPolicy.** Operator-side configuration in the `SOVEREIGNTY_POLICY` KV bucket. It is
**not** carried in the signed envelope; it does not travel on the wire. It drives the crossing
decisions.

**Scope mapping.** A per-partner ingress contract: `imported_principals` (which identities may
land), `local_scope` (which subjects they may reach), and `max_capabilities` (the ceiling on
their declared `requirements`).

**Last-stamp principal.** The identity DID of the most recent `signed_by` stamp — the entity
that published on this hop. Returned by `getLastStampPrincipal`. See OD-8 on its granularity.

**Nak.** A structured compliance-block notification the engine publishes when it blocks a
message. See §8.

Terms defined in sibling RFCs (`did`, `principal-id`, `stack-slug`, `source`, `classified-subject`)
are cited, not redefined. See RFC-0001 (identifiers), RFC-0002 (subjects), RFC-0003 (envelope).

---

## 2. The Sovereignty Block

### 2.1. Structure

Every envelope MUST carry a `sovereignty` object. The object MUST contain exactly the five
members `classification`, `data_residency`, `max_hop`, `frontier_ok`, and `model_class`, each
REQUIRED, and MUST NOT contain any other member (the object is closed:
`additionalProperties: false`). An envelope with no `sovereignty` object, missing any of the
five members, or carrying an unrecognized member MUST be rejected.

> Provenance (informative): schema `required` list and `properties.sovereignty`
> (`schemas/envelope.schema.json`); `src/envelope.ts:156-178`;
> `examples/invalid-missing-sovereignty.json` is the canonical negative example on `origin/main`.

The syntax of each member's value is defined by the ABNF in Appendix A. The block is a JSON
object; this document defines only the value alphabets and enumerations, not the JSON framing.

### 2.2. `classification`

`classification` MUST be one of the case-sensitive tokens `local`, `federated`, or `public`
(`classification`, Appendix A). Its meaning:

- `local` — the message MUST NOT cross a principal boundary.
- `federated` — the message MAY cross principal boundaries, subject to the crossing rules in
  §5 and §6.
- `public` — the message is unrestricted with respect to boundary crossing.

> **[OPEN DECISION — OD-9 — Andreas + JC — blocked on R9 vocabulary follow-up]** The envelope
> schema describes `local` as "never leaves org boundary", while `namespace.md` and the running
> enforcement define it as never leaving the **principal** boundary. Post-R9, one network
> (`metafactory`) contains multiple principals, so the two are materially different: the schema
> text would permit intra-network cross-principal `local` traffic that leaf-node non-replication
> and `block_local_escape` actually forbid. This document specifies the **principal** boundary
> (§2.2) and flags the schema text as stale; the reconciliation is OD-9.

### 2.3. `data_residency`

`data_residency` MUST match `data-residency` (Appendix A): exactly two uppercase ASCII letters,
an ISO 3166-1 alpha-2 country code.

The grammar admits any two uppercase letters, **including** codes that ISO 3166-1 leaves
unassigned (e.g. `ZZ`, `XX`) and the informal regional convention `EU`. This document does **not**
constrain the value to the set of assigned codes; the wider alphabet is a finding (see §10 and
OD-4), because the fail-open residency check in §5.4 lets a sender evade residency gating by
declaring a code the operator did not enumerate.

> **[OPEN DECISION — OD-4 — Andreas + JC — blocked on myelin#11]** Whether an unassigned or
> unrecognized residency code is a rejection, and what the valid residency-code registry is.

### 2.4. `max_hop`

`max_hop` MUST match `max-hop` (Appendix A): a non-negative integer, `0` meaning origin-only.

`max_hop` is a **signable** field (§3): every `signed_by` stamp commits to it. No enforcement
path in myelin or in the reference consumer (cortex) reads `max_hop` for an allow/block decision.
This document therefore specifies its **shape** only. Its documented semantic — "each forwarding
consumes one" (`docs/envelope.md`) — is **not** specified here as a requirement, because it is
unimplementable against the signing rules: a forwarder cannot decrement a signable field without
invalidating every prior stamp.

> **[OPEN DECISION — OD-2 — Andreas + JC — blocked on myelin#11; cortex surface-router
> chain-length gate]** The meaning of `max_hop`. Candidates: (a) redefine as a receiver-observed
> bound on `signed_by` chain length — the interpretation cortex already invented
> (`getSignedByChain(envelope).length > network.max_hop` → `max_hop_exceeded`), noting that
> interpretation is itself self-contradictory (it rejects a directly-signed 1-stamp envelope
> against a `max_hop=0` that is documented as "accept directly-signed"); (b) move `max_hop` out
> of the signable set so a forwarder may decrement it; (c) retire the field. Until OD-2 resolves,
> implementations MUST NOT attribute enforcement meaning to `max_hop`.

### 2.5. `frontier_ok` and `model_class`

`frontier_ok` MUST be a JSON boolean (`frontier-ok`, Appendix A). `model_class` MUST be one of
`local-only`, `frontier`, or `any` (`model-class`, Appendix A).

Together these declare "what may process this message". In the current implementation they are
**shape-validated only**. No myelin decision path reads them. The single myelin reader is
`parseSovereignty` (`src/envelope.ts:614-629`), which derives an advisory boolean
`canReachFrontier = frontier_ok AND model_class != "local-only"` and has **no caller inside a
myelin enforcement path**. The only stack-wide enforcement is cortex's consumer-side
`sovereignty-gate`, whose enforce flag **defaults to `false`** (audit-parity logging).

This document specifies the two fields' syntax. It does **not** specify a MUST-block behaviour
for them, because none is implemented; specifying one would be redesign, not codification.

> **[OPEN DECISION — OD-1 — Andreas + JC — blocked on myelin#11]** Whether `frontier_ok` and
> `model_class` are enforced (in a myelin egress/ingress path) or are declared advisory
> (declaration-only) with a named retirement release. Also: the combination `frontier_ok: false`
> with `model_class: frontier` is schema-valid (the fields are independent, no cross-field
> constraint) yet semantically unsatisfiable — no cloud model may process it, but only frontier
> models are permitted. No spec, validator, or doc decides this combination; `parseSovereignty`
> derives `canReachFrontier = false`, and cortex's gate routes it to a local-only agent despite
> `model_class` saying frontier-only. OD-1 MUST decide it.

### 2.6. `sovereignty_required` (a separate field, not part of the block)

`sovereignty_required` is a **separate**, OPTIONAL, top-level envelope field — it is **not** a
member of the `sovereignty` block. When present it MUST be one of `open`, `selective`, `strict`,
or `bidding` (`sovereignty-mode`, Appendix A). It is an F-021 task-routing knob (the minimum
agent sovereignty *mode* required to ack a task), and it is a signable field.

Its value is consumed by no decision logic in either myelin or cortex. The field name implies a
"minimum" ordering over the four modes, but no ordering or match rule exists in any source; the
sole reference (`matchesSovereigntyMode` in a docs query snippet) is a dangling identifier that
exists in no source file.

> **[OPEN DECISION — OD-7 — Andreas + JC — blocked on a discovery/task-routing RFC, not yet
> allocated]** The comparison semantics of `sovereignty_required` (the "minimum" ordering, and
> what each mode obliges an agent to do), or its reassignment to a discovery/economics RFC.

---

## 3. Attestation: Sovereignty Is a Signable Field

The `sovereignty` block is a **signable** field: it is in `SIGNABLE_FIELDS`
(`src/identity/canonicalize.ts`), so every `signed_by` stamp commits to it. Tampering with the
block after a stamp is added invalidates that stamp and every subsequent one.

Consequently:

- A relay or intermediary MUST NOT mutate any member of the `sovereignty` block. A mutated block
  is a broken signature chain, and a verifier MUST reject it under the signing rules.
- Because the block is immutable under signature, any field within it whose documented semantics
  require *mutation on forward* — notably `max_hop` (§2.4) — is unimplementable as documented.
  This is the root of OD-2.

The three-layer model (informative): sovereignty is **declared** at L3 (the envelope field),
**attested** at L4 (the signature chain commits to it), and **enforced** at L2 (the F-5 engine
wrapping the transport). The declaration alone is documentation until a gate refuses (§5, §6).

The stamp-role enum reserves `sovereignty` as one of five roles (`origin`, `transit`,
`accountability`, `sovereignty`, `notary`). Nothing in myelin or cortex mints, verifies, or
branches on a `sovereignty`-role stamp; `sign.ts` merely passes a caller-supplied role through.
The value is reserved with undefined semantics; this document does **not** assign it meaning
(see §10).

---

## 4. Classification and the Subject Prefix

### 4.1. The projection

`classification` projects one-to-one onto the leading token of a NATS subject:
`local` → `local.`, `federated` → `federated.`, `public` → `public.` (`classification-prefix`,
Appendix A). The full subject grammar is RFC-0002's; this document defines only the prefix token
that grammar consumes, and the *alignment* between the prefix and the block.

### 4.2. Two coexisting definitions of alignment

There are, in the running system, **two contradictory definitions** of what it means for a
subject prefix and a `classification` to align:

1. **Strict equality** (`namespace.md`, `subjectPrefixAligns` in `src/subjects.ts`,
   `validateSubjectEnvelopeAlignment`): the subject prefix MUST equal the classification. Any
   mismatch is declared "a protocol violation" and `EnvelopeTransport` throws before delivery.

2. **Downward-superset reachability budget** (the egress engine,
   `CLASSIFICATION_PREFIX_BUDGET` in `src/sovereignty/validators/egress.ts`): a message may
   target any subject whose prefix class is *at or below* its own classification —
   `local` → `{local}`, `federated` → `{local, federated}`, `public` → `{local, federated,
   public}`. Under this definition a `public`-classified envelope publishing to a `local.*`
   subject is a **deliberate allow** (e.g. an internal observability copy of a public event).

The same (envelope, subject) pair — a `public` envelope to a `local.*` subject — is a protocol
violation under definition (1) and an allow under definition (2). Both ship today. This document
records both and specifies **neither as the single normative rule**; a conformant implementation
MUST NOT rely on either interpretation being authoritative until OD-3 resolves. §5 specifies the
egress procedure using the reachability budget because that is what the enforcement path runs;
the strict-equality throw in `EnvelopeTransport` is a separate, earlier check that this document
flags as contradictory.

> **[OPEN DECISION — OD-3 — Andreas + JC — blocked on reconciliation between RFC-0002 and
> RFC-0005]** Which definition of prefix↔classification alignment is normative. The other becomes
> a defect to be fixed.

---

## 5. Egress: Leaving a Boundary

This section specifies the egress decision procedure as implemented by the F-5 engine
(`src/sovereignty/engine.ts` `validateEgress` + `src/sovereignty/validators/egress.ts`), driven
by `policy.egress` from the `SovereigntyPolicy` document. An implementation claiming conformance
MUST reproduce the allow/block outcome of this procedure on the vectors named in §12.

The procedure evaluates, in order:

### 5.1. `block_local_escape`

`policy.egress.block_local_escape` is a REQUIRED boolean. When it is `true`, a
`local`-classified envelope whose target subject does not begin with `local.` MUST be blocked
with code `compliance-block:classification-mismatch`. This check runs first, before any rule
evaluation.

> Provenance (informative): `engine.ts:99-106`; the reason string carries the literal
> `block_local_escape`.

### 5.2. Classification budget

If §5.1 did not block, the target subject MUST carry a recognized classification prefix
(`local.`, `federated.`, or `public.`); a subject with no such prefix MUST be blocked with
`compliance-block:classification-mismatch`. The envelope's `classification` MUST be permitted to
reach the target subject's prefix class under the reachability budget of §4.2 definition (2);
otherwise the message MUST be blocked with `compliance-block:classification-mismatch`.

### 5.3. Allowed subjects

`policy.egress.rules` is a list of per-classification rules, each with `classification` and an
`allowed_subjects` list of NATS-style patterns (`*` single token, `>` multi-token). A rule for
the envelope's `classification` MUST exist, or the message MUST be blocked with
`compliance-block:classification-mismatch`. The target subject MUST match at least one pattern
in that rule's `allowed_subjects`, or the message MUST be blocked with
`compliance-block:classification-mismatch`.

> Note (informative): because §5.3 gates every classification including `public`, the running
> engine constrains `public` traffic — contradicting `namespace.md`'s claim that `public.`
> traffic has "no sovereignty constraints applied". This document specifies the gate; the
> `namespace.md` claim is a documentation defect for RFC-0002 to correct.

### 5.4. Data-residency constraints

If the matched rule has a `data_residency_constraints` map and that map contains the envelope's
`data_residency` code as a key, then the target subject MUST match at least one pattern in that
code's constraint list, or the message MUST be blocked with `compliance-block:residency-violation`.

The current implementation **fails open** in two cases: if the rule has no
`data_residency_constraints` map, or if the map does not contain the envelope's residency code
as a key, the message is ALLOWED unconstrained (`if (!constraints) return ALLOW`,
`egress.ts:60-70`). Combined with §2.3's wide alphabet, a sender evades residency gating entirely
by declaring a code the operator did not enumerate (e.g. `ZZ`). This document specifies the
constrained path (the MUST above) as the behaviour when a residency code *is* listed; it does
**not** specify the fail-open as a requirement, and flags it as a finding (§10, OD-4).

> **[OPEN DECISION — OD-4 — Andreas + JC — blocked on myelin#11]** (also §2.3) Whether an
> unlisted residency code fails open (current) or fails closed.

---

## 6. Ingress: Arriving Across a Boundary

This section specifies the ingress decision procedure
(`src/sovereignty/validators/ingress.ts`, orchestrated by `engine.ts` `validateIngress`), driven
by `policy.ingress`. An implementation claiming conformance MUST reproduce the allow/block
outcome of this procedure on the vectors named in §12.

The chain-of-stamps delegation check (`verifyChainSovereignty`) runs first but is gated by
`policy.chain_of_stamps.verify_delegation_sovereignty`, which defaults to `false`; when off, the
procedure is the single-last-stamp check below. This document specifies the default (flag-off)
procedure; the chain walk is out of scope pending its own treatment.

### 6.1. Last-stamp principal

The procedure keys on the **last** `signed_by` stamp's identity DID (the entity that published
on this hop), obtained via `getLastStampPrincipal`. An envelope with no `signed_by` identity is
unsigned and MUST be blocked with `compliance-block:unknown-principal`, **independent** of any
policy flag. This is the fail-closed floor: an unsigned envelope can never satisfy ingress.

> **[OPEN DECISION — OD-8 — Andreas + JC — blocked on RFC-0001 identity-class resolution
> (cortex#1880)]** The match key is the last stamp's `identity` — an **assistant-level** DID
> (`stampIdentityDid` returns `stamp.identity`), despite the function being named
> `getLastStampPrincipal` and the policy field being named `imported_principals`. Whether the
> operator populates `imported_principals` with principal-level or assistant-identity-level DIDs
> is undefined; §6.2 cannot be authored precisely until OD-8 (and the class-collision decision in
> RFC-0001) resolves.

### 6.2. Scope mapping lookup and the permissive branch

The last-stamp principal is looked up across `policy.ingress.scope_mappings[].imported_principals`.

- **Mapped.** If a mapping contains the principal, the procedure applies the scope ceiling
  (§6.3).
- **Unmapped, strict.** If no mapping contains the principal and
  `policy.ingress.reject_unknown_partners` is `true`, the message MUST be blocked with
  `compliance-block:unknown-principal`.
- **Unmapped, permissive.** If no mapping contains the principal and `reject_unknown_partners`
  is `false`, the current implementation returns an **unconditional ALLOW** that bypasses both
  the subject-scope check and the capability ceiling of §6.3.

The permissive branch is a **trust inversion**: a declared partner is constrained by its
`local_scope` and `max_capabilities`, while an *undeclared* stranger is not constrained at all.
Declaring a partner therefore *reduces* its access relative to a stranger's. This document
specifies the strict branch and the mapped branch as requirements; it does **not** specify the
permissive unconditional-allow as a requirement, and flags it as a finding (§10, OD-5).

> **[OPEN DECISION — OD-5 — Andreas + JC — blocked on myelin#11]** Whether permissive mode
> (`reject_unknown_partners: false`) must still apply a default scope/ceiling to an unmapped
> principal, closing the trust inversion.

### 6.3. Scope ceiling

For a mapped principal, the message's source subject MUST match at least one pattern in the
mapping's `local_scope`, or the message MUST be blocked with `compliance-block:scope-exceeded`.
If the envelope carries `requirements`, every entry MUST appear in the mapping's
`max_capabilities`, or the message MUST be blocked with `compliance-block:scope-exceeded`.

> Provenance (informative): `checkScopeCeiling`, `ingress.ts`.

---

## 7. The Two-Layer Crossing Contract

A federated crossing requires **two** independent layers to agree; they compose, they are not
alternatives.

| Layer | Owned by | Gates | Reject path |
|---|---|---|---|
| NSC export/import | Operator (via `nsc` CLI) | Cross-account **subject** reachability at the NATS layer | NATS-level permission deny (leaf-node block, `no responders`) |
| `validateIngress` (this doc, §6) | F-5 engine | **Principal** scope: last-stamp identity ∈ `imported_principals`, subject ∈ `local_scope`, requirements ⊆ `max_capabilities` | `compliance-block:unknown-principal` / `:scope-exceeded` nak |

A conformant deployment MUST satisfy both layers for a `federated` message to cross. The NSC
layer makes a crossing **possible** (without a matching export/import the message never reaches
the cluster); the engine layer makes it **safe** (even with the pipe open, the envelope must
satisfy the partner's scope contract before any handler sees it). A principal present in NSC but
absent from the policy mapping passes NATS and blocks at ingress; the converse also holds.

This document specifies the engine layer. The NSC layer is an operator/infra concern; its
configuration is derived from the same `SovereigntyPolicy` document
(`generateFederationScript`), but its provisioning is out of scope here.

---

## 8. Enforcement-Channel Artifacts (Naks and Audit)

When the engine blocks a message it emits two observability artifacts:

- a **structured nak** — a synthesized `MyelinEnvelope` published on
  `_nak.sovereignty.<direction>.<envelope_id>` (`direction` ∈ `egress`, `ingress`), whose
  payload is a `SovereigntyNakDetail` carrying the `NakReasonCode` (`nak-reason-code`,
  Appendix A);
- an **audit entry** — JSON on `_audit.sovereignty.<decision>.<direction>`.

The nak is published through the **raw underlying transport**, deliberately bypassing the
engine's own `validateEgress`, to avoid recursion. The enforcement channel therefore exempts its
own traffic from the rules it enforces, and the current nak envelope has several defects that
make it non-conformant to the very wire it polices:

- **Schema-invalid source.** The default nak `source` is `sovereignty.engine` — two dotted
  segments — while the envelope `source` grammar (RFC-0003) requires exactly three
  (`{principal}.{stack}.{assistant}`). Any subscriber that schema-validates inbound envelopes
  rejects the message explaining why its own envelope was blocked.
- **Unsigned.** The nak carries no `signed_by`. The enforcement verdict on `_nak.sovereignty.>`
  is therefore unauthenticated and forgeable by anyone with publish permission on that subject
  tree.
- **Undecidable alignment.** The nak stamps `classification: "local"` onto a `_nak.sovereignty.*`
  subject that has no classification prefix — a combination the alignment rule of §4 cannot
  decide.
- **Unregistered prefix.** The `_nak.` reserved prefix appears nowhere in `namespace.md`'s
  reserved-prefix table (which registers the sibling `_audit.`), contradicting `namespace.md`'s
  claim that every subject starts with one of three classification prefixes.

This document specifies the nak subject family and the `NakReasonCode` enum as the current
contract, and flags the above as findings.

> **[OPEN DECISION — OD-6 — Andreas + JC — blocked on RFC-0002 reserved-prefix registration;
> RFC-0003 source grammar; signed-KV myelin#31]** Define a conformant, signed nak envelope
> (valid three-segment source, a `signed_by` stamp so verdicts are authenticated, a decidable
> classification/subject pairing) and register the `_nak.` prefix in the subject namespace.

The subscribe surfaces differ observably: `publish` throws `SovereigntyBlockedError` to the
producer; `subscribe` acks-and-drops (handler never called) and emits a nak; `subscribeBestEffort`
drops silently with **no** nak. Alerting on `_nak.sovereignty.>` alone therefore misses
best-effort blocks; the audit stream (`_audit.sovereignty.block.>`) is the complete record.

---

## 9. Registry Considerations

### 9.1. Registrations this document makes

- **RFC number.** `0005`, allocated in [`specs/README.md`](../README.md); never reused.
- **Reserved subject prefix.** This document **requests** registration of the `_nak.`
  enforcement-channel prefix in the RFC-0002 subject namespace's reserved-prefix table
  (currently unregistered). The registration is blocked on OD-6.
- **`NakReasonCode` enum.** The closed six-value enum (`nak-reason-code`, Appendix A) is
  registered by this document as the stable machine-token vocabulary for compliance blocks.
- **No external registry.** This document defines no DID method and registers nothing with the
  W3C DID registries (that is RFC-0001). The `data_residency` value space references ISO 3166-1
  alpha-2 but this document does not register or mint country codes.

### 9.2. Open decisions

The following OPEN DECISIONS are unresolved and MUST be resolved (by the principal and hub
custodian) before any of the affected behaviour can be specified normatively. They are also
recorded in the front matter's downstream tooling.

| ID | Subject | Blocked on |
|---|---|---|
| OD-1 | `frontier_ok`/`model_class` enforced vs advisory; the unsatisfiable `false`+`frontier` combo | myelin#11 |
| OD-2 | `max_hop` meaning (signable field cannot be decremented) | myelin#11; cortex chain-length gate |
| OD-3 | prefix↔classification: strict equality vs reachability budget | RFC-0002 ⇄ RFC-0005 reconciliation |
| OD-4 | `data_residency` fail-open + valid-code registry | myelin#11 |
| OD-5 | ingress permissive-mode trust inversion | myelin#11 |
| OD-6 | conformant, signed, registered nak envelope | RFC-0002; RFC-0003; myelin#31 |
| OD-7 | `sovereignty_required` matching semantics | discovery/task-routing RFC (unallocated) |
| OD-8 | `imported_principals` granularity (principal vs assistant identity) | RFC-0001 (cortex#1880) |
| OD-9 | `local` = org vs principal boundary | R9 vocabulary follow-up |

---

## 10. Security Considerations

This section is REQUIRED and is not empty.

**Threat model.** The sovereignty plane defends a principal's boundary against three things: a
`local` message escaping onto a federated or public subject; a federated partner reaching a
subject or exercising a capability beyond its contracted ceiling; and an unsigned or unknown
sender being delivered as if trusted. It does **not** defend payload confidentiality (the
sovereignty block is plaintext), and it assumes signature verification has already run upstream
(the engine checks *authorization*, not *authenticity*).

Per the scaffold's Rule 6, the following invariants are held by a runtime check — or by nothing —
rather than by the grammar, and are findings, not designs:

1. **`frontier_ok`/`model_class` enforced nowhere in the protocol (critical).** The block's
   "what can process it" promise is shape-only. No myelin decision path reads either field; the
   sole reader (`parseSovereignty`) is advisory with no enforcement caller, and the only stack
   enforcement is cortex's off-by-default consumer gate. A message declaring `local-only` can be
   processed by a frontier model with nothing on the wire path refusing it. See OD-1.

2. **`data_residency` fails open for unlisted codes (§5.4).** A residency code absent from the
   operator's `data_residency_constraints` map is completely unconstrained. Combined with the
   wide alphabet (§2.3), a sender declaring an unassigned code (`ZZ`, `XX`, `EU`) evades
   residency gating entirely. See OD-4.

3. **Ingress trust inversion (§6.2).** Under `reject_unknown_partners: false`, an unmapped
   principal receives an unconditional ALLOW that bypasses the subject-scope and capability
   checks a mapped partner is subject to. Declaring a partner reduces its access relative to a
   stranger. This inverts the engine's own "fail closed" design principle and is documented in no
   operator guide. See OD-5.

4. **`max_hop` is a dead, signed field (§2.4).** It is required and covered by every stamp, yet
   read by no enforcement path, and its documented decrement-on-forward semantic is
   cryptographically unimplementable against the signing rules. A federation loop is not bounded
   by `max_hop` today. See OD-2.

5. **The enforcement channel is unauthenticated and off-spec (§8).** Compliance-block naks are
   unsigned (forgeable by anyone with publish rights on `_nak.sovereignty.>`), carry a
   schema-invalid two-segment source, and ride an unregistered subject prefix. An attacker can
   forge "your message was blocked" verdicts; a strict subscriber rejects genuine ones. See OD-6.

6. **Subject↔envelope binding is prefix-only.** The only receive-side subject↔envelope check is
   the classification prefix (§4); the subject's principal and stack segments are not bound to the
   envelope's `source` or to the verified signature chain by any rule in this document. A validly
   signed envelope may be published on a subject naming a different principal without this plane
   objecting. (The provenance binding is the concern of RFC-0002/RFC-0003; recorded here because
   it weakens the boundary this plane defends.)

7. **`sovereignty` stamp-role has undefined semantics (§3).** The reserved role attests nothing;
   a verifier can conclude nothing from its presence. A reserved wire value with no meaning is an
   attack-surface placeholder, not a control.

**What this plane does defend (when configured fail-closed).** With `block_local_escape: true`
and `reject_unknown_partners: true` (the operator guide's minimum policy), a `local` message
cannot escape its namespace (§5.1), an unsigned message is rejected (§6.1), and an unmapped
principal is rejected (§6.2). These paths are grammar-and-procedure enforced and are pinned by
vectors (§12). The findings above are the gaps outside that configured floor.

---

## 11. Privacy Considerations

This document specifies identifiers and metadata that ride on every envelope; a Privacy
Considerations section is therefore REQUIRED.

**What the block leaks by construction.** The `sovereignty` block is plaintext on every
envelope. Every intermediary and every leaf node that sees the envelope (or, for
`classification`, merely the subject prefix) observes:

- **`data_residency`** — a jurisdiction (country code) attached to the message. This correlates a
  message, and by aggregation a workload, to a legal jurisdiction, regardless of payload
  encryption.
- **`classification`** — projected into the subject prefix (§4), so the travel scope of a message
  is visible to anyone who can observe subject metadata, without reading the envelope.
- **`model_class` / `frontier_ok`** — the processing constraints, revealing something about the
  sensitivity a publisher assigns to the message.

**What the enforcement channel leaks.** The audit entry (§8) records, per decision, the
`envelope_id`, `subject`, `classification`, `data_residency`, and the **last-stamp identity DID**
of the audited envelope, retained on the `_AUDIT` stream (90-day default). This correlates
sender identities to subjects and jurisdictions over time. The nak, being unsigned and
publicly-forgeable on `_nak.sovereignty.>`, also exposes the `envelope_id`, subject, and block
reason to any subscriber on that tree.

**Operator-side, not on the wire.** The `SovereigntyPolicy` document (`imported_principals`,
`local_scope`, `max_capabilities`, `partner_network`, `trusted_substrates`) is local operator
configuration in a KV bucket and does **not** travel inside the signed envelope; it is not a
wire-privacy exposure of this protocol. The last-stamp identity DID *is* on the wire and is the
correlatable identifier this plane consumes.

Minimizing exposure (informative): a principal that must not reveal jurisdiction to intermediaries
should treat `data_residency` as observable and route accordingly; there is no mechanism in this
document to encrypt or omit it, because it is a required signable field.

---

## 12. Conformance

An implementation conforms to this document if and only if it passes every vector under the path
named in the `vectors` front-matter field (`specs/vectors/sovereignty/`). Reading this
specification is not conformance; passing the vectors is.

A conforming implementation MUST:

- reject an envelope whose `sovereignty` block is absent, missing any of the five required
  members, carries an unknown member, or whose member values violate Appendix A (§2);
- treat the `sovereignty` block as immutable under signature and reject a message whose block was
  mutated after stamping (§3);
- reproduce the egress allow/block decision and `NakReasonCode` of §5 for the egress vectors;
- reproduce the ingress allow/block decision and `NakReasonCode` of §6 for the ingress vectors;
- key ingress on the last-stamp identity and fail closed on an unsigned envelope (§6.1).

A conforming implementation MUST NOT attribute enforcement meaning to `max_hop`, `frontier_ok`,
`model_class`, or `sovereignty_required` while OD-1, OD-2, and OD-7 are unresolved.

The vectors deliberately include **finding vectors** that pin current defective behaviour
(`egress/residency-unlisted-fail-open`, `ingress/unknown-principal-permissive-allow`,
`residency/unassigned-code-accepted`, `frontier/contradiction-schema-valid`,
`nak/source-two-segment-invalid`). These are marked in their `why`. When an OPEN DECISION
resolves a finding, its vector is deleted with a note in Appendix C — never silently edited — and
replaced by the vector for the resolved behaviour. Per `specs/CONFORMANCE.md`, where a vector and
the ratified grammar disagree, the grammar governs and the vector is a defect.

See [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and [`specs/vectors/README.md`](../vectors/README.md).

## 13. References

### 13.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Draft. Source of the `did`, `principal-id`, `stack-slug`, and `stack-id` terminals referenced here.
- [RFC-0002] metafactory, "Subject Namespace", Draft. Owner of the classified-subject grammar into which `classification-prefix` projects, and of the reserved-prefix registry (§9.1, OD-6).
- [RFC-0003] metafactory, "Envelope", Draft. Owner of the envelope schema (`schemas/envelope.schema.json`), the `source` grammar (§8), and the signable-field / canonicalization boundary (§3).
- [ISO3166-1] ISO 3166-1, "Codes for the representation of names of countries and their subdivisions — Part 1: Country codes". The value space `data_residency` references (§2.3).

### 13.2. Informative References

- `docs/sovereignty.md` — F-5 sovereignty engine architecture (promoted by this document).
- `docs/sovereignty-operator.md` — F-5 operator guide (promoted by this document).
- `docs/envelope.md` — envelope field reference and the `max_hop` "each forwarding consumes one" prose (§2.4).
- `specs/namespace.md` — NATS namespace convention; the strict prefix-alignment definition (§4.2) and the reserved-prefix table (§8).
- `src/sovereignty/validators/egress.ts`, `.../ingress.ts`, `src/sovereignty/engine.ts`, `src/sovereignty/transport.ts`, `src/sovereignty/types.ts`, `src/envelope.ts` — the reference implementation this document codifies.
- The wire-protocol gap analysis (`docs/wire-protocol-gap-analysis.md`) and the sovereignty audit that surfaced the findings in §10.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in
`grammar` (`specs/grammar/sovereignty.abnf`) is the source of truth and is what CI validates.
Identifier terminals (`did`, `principal-id`, `stack-slug`) are defined in RFC-0001 and cited by
name, never redefined here.

```abnf
; specs/grammar/sovereignty.abnf
; RFC-0005 — Sovereignty and Boundary-Crossing (Draft; NOT normative until Ratified)

UPPER            = %x41-5A                        ; A-Z

classification   = %s"local" / %s"federated" / %s"public"
classification-prefix = classification "."

data-residency   = 2UPPER                         ; ISO 3166-1 alpha-2; alphabet is WIDER
                                                  ; than the assigned set (admits ZZ/XX/EU) —
                                                  ; finding, see Security Considerations (OD-4)

max-hop          = "0" / (nonzero-digit *DIGIT)
nonzero-digit    = %x31-39                        ; 1-9

frontier-ok      = %s"true" / %s"false"

model-class      = %s"local-only" / %s"frontier" / %s"any"

sovereignty-mode = %s"open" / %s"selective" / %s"strict" / %s"bidding"

nak-reason-code  = %s"compliance-block:" reason-token
reason-token     = %s"classification-mismatch"
                 / %s"residency-violation"
                 / %s"unknown-principal"
                 / %s"scope-exceeded"
                 / %s"chain-invalid"
                 / %s"partner-unknown"
```

## Appendix B. Test Vectors

Vectors live as JSON under [`specs/vectors/sovereignty/`](../vectors/sovereignty/). The starter
file is `crossing.json`, a single self-describing array (each element carries `expect.ok`); as
the set grows it SHOULD be split into `valid.json` / `invalid.json` per
[`specs/vectors/README.md`](../vectors/README.md). This appendix reproduces a representative
subset; it is not the only copy.

The starter set covers: block shape (required members, closed object, residency format); the
**masking** cases (`residency/unassigned-code-accepted`, `egress/residency-listed-match-allow`,
`frontier/contradiction-schema-valid`); the **collision** pair (`egress/public-to-local-allow` —
an allow under the reachability budget that is a violation under strict alignment, OD-3); the
**fail-open** finding (`egress/residency-unlisted-fail-open`, OD-4); the **trust-inversion**
finding (`ingress/unknown-principal-permissive-allow`, OD-5); and the enforcement-channel defect
(`nak/source-two-segment-invalid`, OD-6). Representative entries:

```jsonc
{
  "id": "egress/public-to-local-allow",
  "rfc": 5,
  "kind": "validateEgress",
  "input": {
    "envelope": { "sovereignty": { "classification": "public", "data_residency": "CH",
                                   "max_hop": 0, "frontier_ok": true, "model_class": "any" } },
    "targetSubject": "local.metafactory.default.obs.copy.made",
    "policy": { "egress": { "block_local_escape": true,
      "rules": [ { "classification": "public", "allowed_subjects": ["local.>", "public.>"] } ] } }
  },
  "expect": { "ok": true, "value": { "decision": "allow" } },
  "why": "COLLISION: downward-superset budget makes public->local.* a deliberate allow, while namespace.md's strict alignment calls it a protocol violation. The two definitions contradict (OD-3)."
}
```

```jsonc
{
  "id": "ingress/unknown-principal-permissive-allow",
  "rfc": 5,
  "kind": "validateIngress",
  "input": { "...": "unmapped last-stamp principal, reject_unknown_partners:false, a mapped partner also present" },
  "expect": { "ok": true, "value": { "decision": "allow" } },
  "why": "FINDING (trust inversion): an unmapped principal gets unconditional ALLOW bypassing local_scope and the capability ceiling, while the mapped partner is constrained. A fix under OD-5 flips this vector."
}
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here.
A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes the crossing semantics of `docs/sovereignty.md` and `docs/sovereignty-operator.md` to normative form; specifies the block (§2), signable attestation (§3), prefix alignment (§4), egress (§5) and ingress (§6) procedures, the two-layer contract (§7), and the enforcement channel (§8). Records OD-1..OD-9 and six Security Considerations findings; ships a starter vector set including masking, collision, fail-open, and trust-inversion cases. |

## Acknowledgments

This document is grounded in the wire-protocol audit of the sovereignty dimension and in the
running F-5 reference implementation. It codifies the wire as it is and flags — rather than
ratifies — its defects, per the specs directory's founding rule that a grammar must not let you
write down an ambiguity you could hide in prose.

## Authors' Addresses

Luna (metafactory)
