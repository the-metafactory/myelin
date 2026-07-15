---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0005
title: Sovereignty and Boundary-Crossing
status: Ratified
category: Standards Track
obsoletes: []
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories:                    # Single-principal ratification (v1) per docs/adr/0001-single-principal-ratification.md.
  - name: Andreas               # Two-signature (adding the hub custodian) reinstates on a 2nd implementation or a live federated peer.
    affiliation: metafactory
created: 2026-07-12
ratified: 2026-07-15
grammar: specs/grammar/sovereignty.abnf
vectors: specs/vectors/sovereignty/
crossRefs: ["0001", "0002", "0003", "0004", "0006", "0007", "0008"]   # 0008 added 2026-07-13 cascade sweep (REVISIONS C1/C4/C10): normative owner of sovereignty_required match semantics (OD-7); 0004/0006/0007 reconciled to §13.1 Normative References (#236 item 6)
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
and arrives at another. It specifies the egress decision procedure (classification alignment,
`block_local_escape`, allowed-subject allowlist, data-residency constraints) and the ingress
decision procedure (last-stamp principal lookup, scope mappings, subject scope, capability
ceiling), and it records where a declared invariant is held by a runtime check, by a
consumer-side gate, or by nothing at all. It is a Standards Track specification for the
sovereignty plane of the M3 wire protocol; the enforcement engine that implements it is F-5.

This document promotes the crossing semantics of `docs/sovereignty.md` and
`docs/sovereignty-operator.md` from informative prose to normative form. The 2026-07-15 grill
resolved every open decision under one keystone stance (**ENFORCE**, grill D1): the sovereignty
gates are normative MUSTs — residency fail-closed, a default ingress ceiling for unmapped
principals, model-placement checks on `frontier_ok`/`model_class`, `max_hop` enforced against
the signature chain — and every dead, fail-open, or contradictory behaviour the implementation
audit surfaced is recorded as a **named conformance defect** fixed on the enforcement path
(myelin#11), never silently ratified. Sovereignty is binding, not a gentleman's agreement.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Ratified` (single-principal, 2026-07-15) under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md). Only a document with status
`Ratified` is normative; implementations MUST NOT ground behaviour on a `Draft` or `Proposed`
document. This document is normative and buildable-against; as a living spec it stays revisable
if review or use finds a hole.

Ratification is single-principal per
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md): while myelin is the only
implementation and no federated peer is live, the principal alone ratifies, recorded in
`signatories`. Under ADR-0001 a `Ratified` RFC is a **living spec** — revisable if review or use
finds a hole; the two-signature act and immutable-once-`Ratified` discipline reinstate on a
second independent implementation or a live federated peer.

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
canonicalization and signature bytes (RFC-0004, Ratified); the `SovereigntyPolicy`
KV document's transport, storage, or hot-reload mechanics (operator concern); or NSC
credential provisioning (operator/infra concern).

### 1.0.1. What this document does not resolve

Auditing the running implementation surfaced fields that are declared and signed but read by no
enforcement path, a residency check that fails open, an ingress rule that grants a stranger more
access than a declared partner, and two contradictory definitions of prefix alignment shipping
at once. Each of these was resolved by the 2026-07-15 grill (decision log
[`grill-logs/rfc-0005.md`](grill-logs/rfc-0005.md)) under the **ENFORCE** keystone (D1): the
rule is specified normatively, and the deployed gap is recorded as a **named conformance
defect** fixed on the enforcement path (myelin#11) — the spec leads the deployment, per the
RFC-0006/0007 precedent. §9.2 records the disposition of every former open decision. Per the
scaffold's Rule 6, an invariant held shut by a runtime check — or by nothing — is a finding,
not a design; this revision names each one.

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

**Hop.** A federation forwarding. `max_hop` is the origin-declared forwarding TTL; a receiver
observes hops via the `signed_by` chain — `len(chain) − 1` forwards (§2.4, grill D3).

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
that published on this hop. Returned by `getLastStampPrincipal`; matched at principal granularity (§6.1, grill D9).

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

> **Resolved (grill D10, closes OD-9).** `local` means the **principal** boundary — the message
> MUST NOT leave the publishing principal's own boundary. This matches the R9 vocabulary
> (operator→principal), the subject grammar whose boundary segment IS the principal
> (`local.{principal}.>`, RFC-0002), the per-principal admission model (RFC-0006), and the
> running enforcement (leaf-node non-replication + `block_local_escape`). Post-R9 one network
> contains multiple principals, so the envelope schema's older "never leaves org boundary" text
> is materially wrong — it would permit intra-network cross-principal `local` traffic the
> enforcement forbids. That schema text is a named documentation defect; the sweep rides the
> flag-day R follow-ups.

### 2.3. `data_residency`

`data_residency` MUST match `data-residency` (Appendix A): exactly two uppercase ASCII letters,
an ISO 3166-1 alpha-2 country code.

The grammar admits any two uppercase letters as a *shape*; the **value registry is closed**
(grill D5, closes OD-4): a conformant validator MUST accept only ISO 3166-1 alpha-2 **assigned**
codes plus the regional convention `EU`. An unassigned or unrecognized code (e.g. `ZZ`, `XX`)
MUST be rejected at envelope validation — **fail-closed**. The deployed fail-open behaviour
(§5.4: a sender evades residency gating by declaring a code the principal did not enumerate) is
a **named conformance defect** fixed on the enforcement path (myelin#11); until fixed, the
reference implementation is non-conformant to this rule. Extending the registry (new regional
conventions) is a wire change per BCP-0001.

### 2.4. `max_hop`

`max_hop` MUST match `max-hop` (Appendix A): a non-negative integer, `0` meaning origin-only.

`max_hop` is a **signable** field (§3): every `signed_by` stamp commits to it, and it is
therefore **immutable in flight** — the older documented semantic "each forwarding consumes one"
(`docs/envelope.md`) is unimplementable against the signing rules (a forwarder cannot decrement
a signable field without invalidating every prior stamp) and is retired.

**Resolved (grill D3, closes OD-2): `max_hop` is an origin-declared forwarding TTL, enforced
against the observed signature chain.** RFC-0004's `signed_by` chain is the hop-count
observable — the origin's stamp is chain position 1, and each forwarding hop appends one stamp —
so no mutable counter is needed. A receiver or forwarder MUST reject an envelope, with the
transport disposition of a permanent failure, when

```
len(signed_by chain) − 1  >  max_hop
```

i.e. `max_hop` bounds the number of **forwards beyond the origin**, not the number of stamps.
`max_hop: 0` therefore means **origin-only**: a directly-signed envelope (one stamp, zero
forwards) is accepted, and any forwarded copy is rejected — consistent with the field's
documented "accept directly-signed" meaning. The interpretation cortex invented
(`getSignedByChain(envelope).length > network.max_hop`) has an **off-by-one** against this rule
(it rejects the directly-signed 1-stamp envelope at `max_hop: 0`); that is a named conformance
defect corrected on the myelin#11 path.

**Caveat — chain truncation (RFC-0004 D12).** Because a `signed_by` chain APPENDS, trailing stamps
are *strippable*: any party may remove a trailing stamp and the truncated chain still verifies
(RFC-0004 §"Trailing stamps are strippable", D12). That can only **shorten** the observed chain, so
it can only make the `len(signed_by chain) − 1 > max_hop` test *more* lenient — it can never present
a chain longer than was actually signed. The loop/amplification bound `max_hop` enforces therefore
still holds: extending the forward path past the TTL requires *appending* a stamp (every hop is
observable and unforgeable — a party cannot mint an origin stamp under a peer's key), which trips the
reject; stripping only discards the stripper's own forwarding evidence and manufactures no additional
hops. `max_hop` is thus a forwarding-TTL loop bound, not an integrity guarantee on the exact hop
count; a receiver relying on chain length for anything beyond that bound MUST respect the distinction.

### 2.5. `frontier_ok` and `model_class`

`frontier_ok` MUST be a JSON boolean (`frontier-ok`, Appendix A). `model_class` MUST be one of
`local-only`, `frontier`, or `any` (`model-class`, Appendix A).

Together these declare "what may process this message" — the model-placement dimension of
sovereignty that residency alone does not capture.

**Resolved (grill D1/D2, closes OD-1): the fields are ENFORCED, not advisory.** A consumer that
executes (or routes for execution) MUST validate the executing model's placement against the
declaration before processing: a `frontier_ok: false` or `model_class: "local-only"` envelope
MUST NOT be processed by a frontier/cloud model, and a `model_class: "frontier"` envelope MUST
NOT be routed to a local-only executor. The **unsatisfiable combination**
`frontier_ok: false` + `model_class: "frontier"` — no cloud model may process it, yet only
frontier models are permitted — is a **malformed declaration** and MUST be rejected at envelope
validation (a contradiction is caught at the schema/validation seam, never discovered as a
runtime routing surprise).

Deployed state (recorded, the named conformance defects): no myelin decision path reads the
fields — the single reader is the advisory `parseSovereignty`
(`canReachFrontier = frontier_ok AND model_class != "local-only"`, `src/envelope.ts:614-629`)
with no enforcement caller; cortex's consumer-side `sovereignty-gate` enforce flag defaults to
`false` (audit-parity logging) and routes the unsatisfiable combination to a local-only agent.
Both gaps close on the enforcement path (myelin#11); until then the reference stack is
non-conformant to this rule — the rule is the contract, the gap is the defect (grill D1:
sovereignty is binding, not a gentleman's agreement).

### 2.6. `sovereignty_required` (a separate field, not part of the block)

`sovereignty_required` is a **separate**, OPTIONAL, top-level envelope field — it is **not** a
member of the `sovereignty` block. When present it MUST be one of `open`, `selective`, `strict`,
or `bidding` (`sovereignty-mode`, Appendix A). It is an F-021 task-routing knob (the minimum
agent sovereignty *mode* required to ack a task), and it is a signable field.

Its value is consumed by no decision logic in either myelin or cortex. The field name implies a
"minimum" ordering over the four modes, but no ordering or match rule exists in any source; the
sole reference (`matchesSovereigntyMode` in a docs query snippet) is a dangling identifier that
exists in no source file.

The matching and ordering semantics of `sovereignty_required` are owned normatively by
**RFC-0008 §6.5** (Capability Discovery and Advertisement; grill D3). This document owns the field's
wire syntax and signability only; it references RFC-0008 for the match rule and defines none
itself (one owner per wire rule).

> **Resolved as a recorded deferral (grill D8, closes OD-7 as this document's decision).** The
> comparison semantics of `sovereignty_required` (the "minimum" ordering, and what each mode
> obliges an agent to do) are owned by **RFC-0008 §6.5** (grill D3) — the single normative owner of
> capability-matching semantics — and were resolved at RFC-0008's grill (RFC-0008 now Ratified).
> This document owns the field's wire syntax and signability, cites RFC-0008 forward for the
> match rule, and makes no independent decision (one owner per wire rule — the same
> boundary-deferral pattern as RFC-0007 → RFC-0010).

---

## 3. Attestation: Sovereignty Is a Signable Field

The `sovereignty` block is a **signable** field: it is in `SIGNABLE_FIELDS`
(`src/identity/canonicalize.ts`), so every `signed_by` stamp commits to it. Tampering with the
block after a stamp is added invalidates that stamp and every subsequent one.

Consequently:

- A relay or intermediary MUST NOT mutate any member of the `sovereignty` block. A mutated block
  is a broken signature chain, and a verifier MUST reject it under the signing rules.
- Because the block is immutable under signature, no field within it may carry
  mutation-on-forward semantics. `max_hop` (§2.4) is accordingly an origin-declared TTL enforced
  against the observed chain length — never decremented (grill D3).

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
violation under definition (1) and an allow under definition (2). Both ship today.

**Resolved (grill D4, closes OD-3): STRICT EQUALITY is normative — determined by ratified
RFC-0002 §8.3**, which pins it with binding vectors (`prefix/aligns-local`,
`prefix/mismatch-rejected`): "A subject's prefix and its envelope's `sovereignty.classification`
MUST align... A mismatch is a protocol violation." This document cites that rule; it does not
re-own it. The egress engine's downward-superset reachability budget
(`CLASSIFICATION_PREFIX_BUDGET`, `src/sovereignty/validators/egress.ts`) is therefore the
**named conformance defect** — it allows what a ratified sibling forbids. The legitimate pattern
the budget served (an internal observability copy of a `public` event) is served conformantly by
**re-publishing a distinct `local`-classified envelope**, not by carrying one envelope onto a
lower-classified subject. §5's egress procedure is specified accordingly: the classification
step is the §8.3 equality check; the budget table is recorded as v-current deployed behaviour
pending the fix (myelin#11 path).

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
with code `compliance_block:classification-mismatch`. This check runs first, before any rule
evaluation.

> Provenance (informative): `engine.ts:99-106`; the reason string carries the literal
> `block_local_escape`.

### 5.2. Classification alignment

If §5.1 did not block, the target subject MUST carry a recognized classification prefix
(`local.`, `federated.`, or `public.`); a subject with no such prefix MUST be blocked with
`compliance_block:classification-mismatch`. The subject's prefix MUST **equal** the envelope's
`classification` — the strict-equality rule of ratified RFC-0002 §8.3, cited via §4.2 (grill
D4); a mismatch MUST be blocked with `compliance_block:classification-mismatch`. The deployed
engine's downward-superset reachability budget (`CLASSIFICATION_PREFIX_BUDGET`) allows what this
rule forbids and is the named conformance defect recorded in §4.2; a legitimate lower-scope copy
is re-published as a distinct envelope, never carried across on the same one.

### 5.3. Allowed subjects

`policy.egress.rules` is a list of per-classification rules, each with `classification` and an
`allowed_subjects` list of NATS-style patterns (`*` single token, `>` multi-token). A rule for
the envelope's `classification` MUST exist, or the message MUST be blocked with
`compliance_block:classification-mismatch`. The target subject MUST match at least one pattern
in that rule's `allowed_subjects`, or the message MUST be blocked with
`compliance_block:classification-mismatch`.

> Note (informative): because §5.3 gates every classification including `public`, the running
> engine constrains `public` traffic — contradicting `namespace.md`'s claim that `public.`
> traffic has "no sovereignty constraints applied". This document specifies the gate; the
> `namespace.md` claim is a documentation defect for RFC-0002 to correct.

### 5.4. Data-residency constraints

If the matched rule has a `data_residency_constraints` map and that map contains the envelope's
`data_residency` code as a key, then the target subject MUST match at least one pattern in that
code's constraint list, or the message MUST be blocked with `compliance_block:residency-violation`.

**Resolved (grill D5, closes OD-4 — with §2.3).** The evasion vector is closed at the
**validation seam**, not inside this check: §2.3's closed registry rejects an unassigned or
unrecognized code (`ZZ`, `XX`) at envelope validation, fail-closed, so a sender can no longer
evade residency gating by declaring a code no principal would enumerate. Given a
**registry-valid** code, this check's semantics are then deliberate, not fail-open: a rule with
no `data_residency_constraints` map, or a map that does not list the envelope's (valid) code,
imposes **no residency constraint** on that message — the principal's policy simply has nothing
to say about that residency, and other gates (§5.1–§5.3, §6) still apply. The deployed
implementation (`if (!constraints) return ALLOW`, `egress.ts:60-70`) is conformant to this rule
**only once the §2.3 registry rejection exists upstream**; shipping the unconstrained-allow
without the registry gate is the named conformance defect (myelin#11 path).

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
unsigned and MUST be blocked with `compliance_block:unknown-principal`, **independent** of any
policy flag. This is the fail-closed floor: an unsigned envelope can never satisfy ingress.

> **Resolved (grill D9, closes OD-8).** RFC-0001 (Ratified, single-principal) makes the two
> granularities syntactically distinct; the operational choice is decided:
> **`imported_principals` entries MUST be principal-class DIDs**
> (`did:mf:principal.{principal-id}`); an agent-class entry MUST be rejected at configuration
> validation. A principal-class entry admits **every agent of that principal**, subject to the
> mapping's `local_scope`/`max_capabilities` ceiling — trust in the ingress mapping is
> per-principal, matching ADR-0013 (sovereign identity), RFC-0006's per-principal admission
> roster, and the lookup's own name. The matcher therefore MUST compare the **principal
> component extracted from** the last stamp's agent-class identity DID against the entry — not
> the full agent DID byte-for-byte. Per-agent trust ceilings, if ever needed, arrive as
> mapping-detail fields, never as identity-granularity mixing.

### 6.2. Scope mapping lookup and the permissive branch

The last-stamp principal is looked up across `policy.ingress.scope_mappings[].imported_principals`.

- **Mapped.** If a mapping contains the principal, the procedure applies the scope ceiling
  (§6.3).
- **Unmapped, strict.** If no mapping contains the principal and
  `policy.ingress.reject_unknown_partners` is `true`, the message MUST be blocked with
  `compliance_block:unknown-principal`.
- **Unmapped, permissive.** If no mapping contains the principal and `reject_unknown_partners`
  is `false`, the current implementation returns an **unconditional ALLOW** that bypasses both
  the subject-scope check and the capability ceiling of §6.3.

Entries in `imported_principals` are principal-class DIDs (§6.1, grill D9); the principal
component extracted from the last stamp's agent-class identity is compared **byte-for-byte**
against the entry, so entries migrate with the wire: per the RFC-0001 §9 coordinated hard cut,
they flip to the class-explicit form at the single flag-day release R. There is no dual-accept window in which a legacy classless
entry still matches — RFC-0001 rejects the legacy form at decode from R — so pre-staging the
rewritten mappings is part of the RFC-0001 §9 `[principal-hands]` cutover checklist, not a
gradual migration this document schedules.

The deployed permissive branch is a **trust inversion**: a declared partner is constrained by
its `local_scope` and `max_capabilities`, while an *undeclared* stranger is not constrained at
all — declaring a partner *reduces* its access relative to a stranger's.

**Resolved (grill D6, closes OD-5): the trust inversion is closed.** Permissive mode
(`reject_unknown_partners: false`) MUST still apply a **default scope and capability ceiling**
to an unmapped principal — the §6.3 checks run against the default exactly as they run against
a mapping — and that default MUST NOT exceed what a declared partner's mapping could grant:
declaring a partner MUST NOT reduce its access relative to an undeclared stranger's. The
deployed unconditional-ALLOW (bypasses both the subject-scope check and the §6.3 ceiling) is a
**named conformance defect** fixed on the enforcement path (myelin#11); until fixed, running
`reject_unknown_partners: false` is running a non-conformant ingress. The strict branch and the
mapped branch are unchanged requirements.

### 6.3. Scope ceiling

For a mapped principal, the message's source subject MUST match at least one pattern in the
mapping's `local_scope`, or the message MUST be blocked with `compliance_block:scope-exceeded`.
If the envelope carries `requirements`, every entry MUST appear in the mapping's
`max_capabilities`, or the message MUST be blocked with `compliance_block:scope-exceeded`.

> Provenance (informative): `checkScopeCeiling`, `ingress.ts`.

---

## 7. The Two-Layer Crossing Contract

A federated crossing requires **two** independent layers to agree; they compose, they are not
alternatives.

| Layer | Owned by | Gates | Reject path |
|---|---|---|---|
| NSC export/import | Operator (via `nsc` CLI) | Cross-account **subject** reachability at the NATS layer | NATS-level permission deny (leaf-node block, `no responders`) |
| `validateIngress` (this doc, §6) | F-5 engine | **Principal** scope: last-stamp identity ∈ `imported_principals`, subject ∈ `local_scope`, requirements ⊆ `max_capabilities` | `compliance_block:unknown-principal` / `:scope-exceeded` nak |

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

**Resolved (grill D7, closes OD-6) — determined by the ratified siblings.** The conformant
enforcement artifact is specified as follows; every deployed divergence below is a named
conformance defect fixed on the enforcement path (myelin#11):

1. **Subject.** There is no top-level `_nak.` prefix — ratified RFC-0002 D21 folds sovereignty
   enforcement-NAKs under the **reserved `_audit.` prefix**: the nak family moves to
   `_audit.sovereignty.nak.<direction>.<envelope_id>`, alongside the existing audit entries
   (`_audit.sovereignty.<decision>.<direction>`). The unregistered `_nak.` prefix retires at
   flag-day R.
2. **Source.** The nak envelope's `source` MUST be a full class-explicit **agent-class** DID
   (ratified RFC-0003 D16) — the **enforcing stack's own identity**
   (`did:mf:agent.{principal}.{stack}.{assistant}` of the stack running the engine). The
   two-segment `sovereignty.engine` form is schema-invalid and gone.
3. **Signed.** The nak MUST carry a `signed_by` stamp — the enforcing stack signs its own
   verdict (RFC-0004). An unsigned enforcement verdict is forgeable by anyone with publish
   rights on the audit tree; a signed one is attributable and verifiable.
4. **Classification/subject pairing.** The nak envelope is classified `local` and the `_audit.`
   reserved space is exempt from the §4 alignment rule by registration (reserved prefixes are
   outside the three-prefix classification grammar, RFC-0002 §9) — the pairing is decidable by
   exemption, not undecidable by omission.
5. **Recursion exemption, narrowed.** The enforcement channel's bypass of `validateEgress` is
   retained but scoped: the exemption applies **only** to `_audit.`-prefixed enforcement
   artifacts emitted by the engine itself. Any other traffic through the raw transport is
   non-conformant.
6. **Sovereignty block present.** The nak is itself a conformant `MyelinEnvelope`, so it carries
   the full **five-member `sovereignty` block** (§2: `classification`, `data_residency`, `max_hop`,
   `frontier_ok`, `model_class`) like every other envelope on the wire (§2, §12). The narrowed
   recursion exemption of point 5 is an exemption from **`validateEgress`** — the egress policy
   check — and **only** that; it is **not** an exemption from schema validation. The enforcement
   channel bypasses the policy gate to avoid recursion, but a nak that omitted the sovereignty block
   would be schema-invalid exactly as §2/§12 require of any envelope, so the block is always emitted.

The `NakReasonCode` enum (the `compliance_block` sub-codes) remains this document's registry —
RFC-0007 §3.5 cites it via ratified RFC-0002 D21.

The subscribe surfaces differ observably: `publish` throws `SovereigntyBlockedError` to the
producer; `subscribe` acks-and-drops (handler never called) and emits a nak; `subscribeBestEffort`
drops silently with **no** nak. Alerting on the nak family alone therefore misses
best-effort blocks; the audit stream (`_audit.sovereignty.block.>`) is the complete record.

---

## 9. Registry Considerations

### 9.1. Registrations this document makes

- **RFC number.** `0005`, allocated in [`specs/README.md`](../README.md); never reused.
- **Reserved subject prefix.** None requested: per grill D7 (ratified RFC-0002 D21) the
  enforcement-channel nak family lives under the already-registered `_audit.` prefix
  (`_audit.sovereignty.nak.<direction>.<envelope_id>`); the unregistered `_nak.` prefix retires
  at flag-day R and no new reservation is needed.
- **`NakReasonCode` enum.** The closed six-value enum (`nak-reason-code`, Appendix A) is
  registered by this document as the stable machine-token vocabulary for compliance blocks.
- **No external registry.** This document defines no DID method and registers nothing with the
  W3C DID registries (that is RFC-0001). The `data_residency` value space references ISO 3166-1
  alpha-2 but this document does not register or mint country codes.

### 9.2. Open decisions

All nine open decisions were RESOLVED by the 2026-07-15 grill (decision log
[`grill-logs/rfc-0005.md`](grill-logs/rfc-0005.md)); OD-7 resolves as a recorded deferral to
RFC-0008 §6.5 (grill D3), the single normative owner. Dispositions:

| ID | Subject | Resolution |
|---|---|---|
| OD-1 | `frontier_ok`/`model_class` | **ENFORCED** (§2.5, grill D1/D2); `false`+`frontier` rejected at validation |
| OD-2 | `max_hop` meaning | **Forwarding TTL**: `len(signed_by chain) − 1 ≤ max_hop` (§2.4, D3); cortex off-by-one = named defect |
| OD-3 | prefix↔classification | **Strict equality** per ratified RFC-0002 §8.3 (§4.2, D4); reachability budget = named defect |
| OD-4 | `data_residency` fail-open | **Fail-closed at validation** + closed code registry (§2.3/§5.4, D5) |
| OD-5 | permissive-mode trust inversion | **Closed**: default scope/ceiling for unmapped principals (§6.2, D6) |
| OD-6 | conformant nak envelope | **`_audit.sovereignty.nak.*`** + agent-class source + signed + narrowed exemption (§8, D7) |
| OD-7 | `sovereignty_required` matching | **Recorded deferral** to RFC-0008 §6.5 (grill D3) (§2.6, D8) — RFC-0008 now Ratified; owner settled |
| OD-8 | `imported_principals` granularity | **Principal-class DIDs**; agent-class rejected at config validation (§6.1, D9) |
| OD-9 | `local` boundary | **Principal boundary** (§2.2, D10); stale schema text = named doc defect |

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
   processed by a frontier model with nothing on the wire path refusing it. RESOLVED as a rule (§2.5, grill D1/D2): enforcement is a MUST; this gap is the named conformance defect.

2. **`data_residency` fails open for unlisted codes (§5.4).** A residency code absent from the
   operator's `data_residency_constraints` map is completely unconstrained. Combined with the
   wide alphabet (§2.3), a sender declaring an unassigned code (`ZZ`, `XX`, `EU`) evades
   residency gating entirely. RESOLVED (§2.3/§5.4, grill D5): the closed value registry rejects unassigned codes at validation, fail-closed; this gap is the named conformance defect.

3. **Ingress trust inversion (§6.2).** Under `reject_unknown_partners: false`, an unmapped
   principal receives an unconditional ALLOW that bypasses the subject-scope and capability
   checks a mapped partner is subject to. Declaring a partner reduces its access relative to a
   stranger. This inverts the engine's own "fail closed" design principle and is documented in no
   operator guide. RESOLVED (§6.2, grill D6): permissive mode applies a default scope/ceiling; the unconditional-allow is the named conformance defect.

4. **`max_hop` is a dead, signed field (§2.4).** It is required and covered by every stamp, yet
   read by no enforcement path, and its documented decrement-on-forward semantic is
   cryptographically unimplementable against the signing rules. A federation loop is not bounded
   by `max_hop` today. RESOLVED (§2.4, grill D3): forwarding-TTL enforcement against the signature chain; the unread field is the named conformance defect.

5. **The enforcement channel is unauthenticated and off-spec (§8).** Compliance-block naks are
   unsigned (forgeable by anyone with publish rights on `_nak.sovereignty.>`), carry a
   schema-invalid two-segment source, and ride an unregistered subject prefix. An attacker can
   forge "your message was blocked" verdicts; a strict subscriber rejects genuine ones. Closed by §8 (grill D7): the verdict is signed and schema-valid.

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

A conforming implementation MUST enforce `max_hop` (§2.4), `frontier_ok`/`model_class` (§2.5),
residency fail-closed (§2.3/§5.4), strict prefix equality (§5.2), and the permissive-mode
default ceiling (§6.2) — the grill resolved OD-1..OD-6, OD-8, OD-9 (grill-logs/rfc-0005.md).
The single remaining deferral is `sovereignty_required` matching semantics (§2.6): a conforming
implementation attributes matching/ordering meaning to it only per RFC-0008 §6.5 (grill D3), the
single normative owner (equality-matched v1; ordering reserved).

The grill resolutions INVERTED the former finding vectors into rule vectors (noted in
Appendix C per the delete-with-note rule): `residency/unassigned-code-accepted` →
`residency/unassigned-code-rejected` (D5); `frontier/contradiction-schema-valid` →
`frontier/contradiction-rejected` (D2); `egress/public-to-local-allow` →
`egress/public-to-local-block` (D4); `egress/residency-unlisted-fail-open` re-scoped to
`egress/residency-valid-unlisted-unconstrained` (D5). Added: the trust-inversion closer
(`ingress/unknown-principal-permissive-ceiling-block`, D6), the `enforceMaxHop` TTL family
(D3), and the principal-class config guard
(`ingress/agent-class-import-entry-rejected`, D9). Several rule vectors deliberately FAIL
against the deployed engine — each names its conformance defect in `why`; the rule is the
contract, the gap is the defect. `nak/source-two-segment-invalid` remains as the §8 source-rule
vector. Per `specs/CONFORMANCE.md`, where a vector and the ratified grammar disagree, the
grammar governs and the vector is a defect.

See [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and [`specs/vectors/README.md`](../vectors/README.md).

## 13. References

### 13.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", **Ratified**. Source of the `did`, `principal-id`, `stack-slug`, and `stack-id` terminals referenced here; the §9 flag-day governs the `imported_principals` entry migration (§6.2).
- [RFC-0002] metafactory, "Subject Namespace", **Ratified**. Owner of the classified-subject grammar into which `classification-prefix` projects, of the §8.3 prefix↔classification strict-equality rule this document cites (§4.2), and of the reserved-prefix registry — incl. `_audit.` under which the enforcement-nak family lives (§8, D21).
- [RFC-0003] metafactory, "Envelope", **Ratified**. Owner of the envelope schema (`schemas/envelope.schema.json`), the `source` grammar — agent-class DID, D16, which the §8 enforcement nak MUST satisfy — and the signable-field boundary (§3).
- [RFC-0004] metafactory, "Envelope Signing", **Ratified**. Owner of the `signed_by` chain the §2.4 `max_hop` TTL is enforced against and of the stamp that authenticates the §8 enforcement verdict.
- [RFC-0006] metafactory, "Membership and Admission", **Ratified**. The per-principal admission model the §6.1 principal-class granularity matches.
- [RFC-0007] metafactory, "Transport and Reliability", **Ratified**. Owner of the transport NAK token vocabulary (`compliance_block` is its snake_case token); §3.5 cites this document's `NakReasonCode` sub-codes via RFC-0002 D21.
- [RFC-0008] metafactory, "Capability Discovery and Advertisement", **Ratified**. Normative owner of the `sovereignty_required` match/ordering semantics (§2.6, OD-7).
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
; RFC-0005 — Sovereignty and Boundary-Crossing
; Status: Ratified (single-principal, 2026-07-15, ADR-0001). This grammar is
; normative. See specs/README.md.
;
; This file defines the sovereignty-plane terminals: the classification token
; and its subject-prefix projection, the data-residency code, the model-class
; and sovereignty-mode enumerations, the max-hop / frontier-ok scalar shapes,
; and the closed nak-reason-code enum stamped on every compliance_block nak.
; Pairing prefix is the RFC-0007 snake transport token; the sub-code
; reason-tokens stay kebab as ratified RFC-0007 §3.5 records them.
;
; Identifier terminals (principal-id, stack-slug, stack-id, did) are defined
; ONCE in RFC-0001 (specs/grammar/identifiers.abnf) and are cited by name in
; prose, never redefined here (grammar/README.md rule 5). The full
; classified-subject grammar is RFC-0002's; this file defines only the
; classification-prefix token that RFC-0002's subject grammar consumes.
;
; Each rule that mirrors a live regex or constant cites its source in a
; comment; after generation the arrow reverses and the source is generated
; from here.
;
; Core rules DIGIT are imported from RFC 5234 Appendix B.

; ---------------------------------------------------------------------------
; 1. Uppercase alphabet (residency codes). RFC 5234 ALPHA is A-Z / a-z; the
;    residency code is uppercase-only, so the alphabet is narrowed here.
; ---------------------------------------------------------------------------
UPPER            = %x41-5A                        ; A-Z

; ---------------------------------------------------------------------------
; 2. classification — the message's maximum travel scope. Transcribes
;    CLASSIFICATION_VALUES (myelin src/classifications.ts) and the schema enum
;    (schemas/envelope.schema.json properties.sovereignty.classification).
;    Case-sensitive lowercase tokens.
; ---------------------------------------------------------------------------
classification   = %s"local" / %s"federated" / %s"public"

; classification-prefix — the projection of `classification` into the leading
; token of a NATS subject (RFC-0002 owns the full subject). deriveSubject /
; deriveNatsSubject build it 1:1 from sovereignty.classification
; (myelin src/subjects.ts). It is exactly the classification token then ".".
classification-prefix = classification "."

; ---------------------------------------------------------------------------
; 3. data-residency — an ISO 3166-1 alpha-2 country code. Transcribes the
;    schema pattern ^[A-Z]{2}$ (schemas/envelope.schema.json). The grammar
;    admits ANY two uppercase letters as SHAPE; the VALUE registry is closed
;    (RFC §2.3, grill D5): assigned ISO 3166-1 codes + EU only; an unassigned
;    code (ZZ, XX) is rejected at envelope validation, fail-closed.
; ---------------------------------------------------------------------------
data-residency   = 2UPPER

; ---------------------------------------------------------------------------
; 4. max-hop — a non-negative integer federation-hop budget (schema
;    minimum: 0). A JSON number with no fraction, no sign, no leading zero.
;    Origin-declared forwarding TTL (RFC §2.4, grill D3): receivers enforce
;    len(signed_by chain) - 1 <= max_hop; max_hop 0 = origin-only.
; ---------------------------------------------------------------------------
max-hop          = "0" / (nonzero-digit *DIGIT)
nonzero-digit    = %x31-39                        ; 1-9

; ---------------------------------------------------------------------------
; 5. frontier-ok — a JSON boolean. Shape-only; no myelin enforcement path
;    read it before the grill; enforcement is now a MUST (RFC §2.5, grill D1/D2).
; ---------------------------------------------------------------------------
frontier-ok      = %s"true" / %s"false"

; ---------------------------------------------------------------------------
; 6. model-class — the class of model permitted to process the signal.
;    Schema enum (schemas/envelope.schema.json). Shape-only; no myelin
;    enforcement path read it before the grill; enforcement is now a MUST (RFC §2.5, grill D1/D2).
; ---------------------------------------------------------------------------
model-class      = %s"local-only" / %s"frontier" / %s"any"

; ---------------------------------------------------------------------------
; 7. sovereignty-mode — the value space of the SEPARATE top-level
;    `sovereignty_required` field (F-021). It is NOT part of the sovereignty
;    block. Schema enum (schemas/envelope.schema.json). Its comparison
;    semantics are owned by RFC-0008 §6.5 (RFC §2.6, grill D3; D8 deferral).
; ---------------------------------------------------------------------------
sovereignty-mode = %s"open" / %s"selective" / %s"strict" / %s"bidding"

; ---------------------------------------------------------------------------
; 8. nak-reason-code — the closed enum stamped on every compliance-block nak
;    and audit entry (myelin src/sovereignty/types.ts NakReasonCode).
; ---------------------------------------------------------------------------
nak-reason-code  = %s"compliance_block:" reason-token
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

The set covers: block shape (required members, closed object, residency format); the grill-
resolved rule vectors (`residency/unassigned-code-rejected` D5,
`frontier/contradiction-rejected` D2, `egress/public-to-local-block` D4 — strict equality per
ratified RFC-0002 §8.3); the deliberate-semantics case
(`egress/residency-valid-unlisted-unconstrained`, D5); the **trust-inversion**
closer (`ingress/unknown-principal-permissive-ceiling-block`, D6); the `enforceMaxHop` TTL
family and the principal-class config guard (D3/D9); and the enforcement-channel source rule
(`nak/source-two-segment-invalid`, §8). Several rule vectors deliberately FAIL against the
deployed engine — the rule is the contract, the gap is the named defect (§12). Representative
entries:

```jsonc
{
  "id": "egress/public-to-local-block",
  "rfc": 5,
  "kind": "validateEgress",
  "input": {
    "envelope": { "sovereignty": { "classification": "public", "data_residency": "CH",
                                   "max_hop": 0, "frontier_ok": true, "model_class": "any" } },
    "targetSubject": "local.metafactory.default.obs.copy.made",
    "policy": { "egress": { "block_local_escape": true,
      "rules": [ { "classification": "public", "allowed_subjects": ["local.>", "public.>"] } ] } }
  },
  "expect": { "ok": false, "reason": "compliance_block:classification-mismatch" },
  "why": "Strict equality per ratified RFC-0002 §8.3 (grill D4, closes OD-3): a public-classified envelope on a local.* subject is a protocol violation. The deployed CLASSIFICATION_PREFIX_BUDGET allows it — the named conformance defect; the internal-copy pattern re-publishes a distinct local-classified envelope."
}
```

```jsonc
{
  "id": "ingress/unknown-principal-permissive-allow",
  "rfc": 5,
  "kind": "validateIngress",
  "input": { "...": "unmapped last-stamp principal, reject_unknown_partners:false, a mapped partner also present" },
  "expect": { "ok": true, "value": { "decision": "allow" } },
  "why": "Grill D6 (closes OD-5): permissive mode still allows an unmapped principal, but under the DEFAULT scope/ceiling — this subject is inside it. The constrained half is ingress/unknown-principal-permissive-ceiling-block, which FAILS against the deployed unconditional-allow (the named defect)."
}
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here.
A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes the crossing semantics of `docs/sovereignty.md` and `docs/sovereignty-operator.md` to normative form; specifies the block (§2), signable attestation (§3), prefix alignment (§4), egress (§5) and ingress (§6) procedures, the two-layer contract (§7), and the enforcement channel (§8). Records OD-1..OD-9 and six Security Considerations findings; ships a starter vector set including masking, collision, fail-open, and trust-inversion cases. |
| 2026-07-15 | Draft | **Grill outcome woven** ([`grill-logs/rfc-0005.md`](grill-logs/rfc-0005.md), 10 decisions, Andreas 2026-07-15). Keystone **D1 ENFORCE**: sovereignty gates are normative MUSTs; every deployed gap is a named conformance defect on the myelin#11 path — spec leads deployment. All nine ODs closed: OD-9 `local` = principal boundary (D10); OD-4 residency fail-closed + closed registry, §5.4 valid-but-unlisted re-scoped as deliberate (D5); OD-2 `max_hop` = forwarding TTL `len(chain)−1 ≤ max_hop`, cortex off-by-one named (D3); OD-1 `frontier_ok`/`model_class` ENFORCED, `false`+`frontier` rejected at validation (D1/D2); OD-7 recorded deferral to RFC-0008 OD-5 (D8); OD-3 strict equality per ratified RFC-0002 §8.3, budget = named defect, §5.2 retitled (D4); OD-5 permissive-mode default ceiling closes the trust inversion (D6); OD-6 enforcement nak → `_audit.sovereignty.nak.*`, agent-class source, signed, narrowed recursion exemption (D7); OD-8 principal-class `imported_principals`, agent-class rejected at config validation (D9). Vectors: 3 inversions + 1 re-scope + 5 new (26 total; deleted-with-note per the rule). `compliance_block:` pairing prefix snake per ratified RFC-0007; sub-codes stay kebab per its §3.5. References swept (0001/0003 Ratified; 0004/0006/0007 added). Memo swept to ADR-0001 single-principal wording. Appendix A made a complete byte-identical copy. |
| 2026-07-13 | Draft | Cascade sweep (decision-free; REVISIONS C1/C4/C10 + RFC-0001 ratification propagation). OD-7 retargeted: the stale "no discovery/economics RFC is yet planned" clause deleted; §2.6 now states RFC-0008 (OD-5) is the single normative owner of `sovereignty_required` match/ordering semantics, this document defers. OD-8 retargeted: the cortex#1880 identity-class blocker is resolved by RFC-0001 (class-explicit dot-form, pending JC co-signature); candidate `imported_principals` granularities rendered in class-explicit form (`did:mf:principal.{principal-id}` vs `did:mf:agent.{principal-id}.{stack-slug}.{assistant-id}`); the operator granularity choice remains open. §6.2 records that `imported_principals` entries flip at the RFC-0001 §9 coordinated hard cut (single flag-day, no dual-accept window). Front matter gains `crossRefs` incl. 0008; [RFC-0008] added to Normative References; §9.2 table and §12 updated to match. No open decision resolved, weakened, or removed. |

## Acknowledgments

This document is grounded in the wire-protocol audit of the sovereignty dimension and in the
running F-5 reference implementation. It codifies the wire as it is and flags — rather than
ratifies — its defects, per the specs directory's founding rule that a grammar must not let you
write down an ambiguity you could hide in prose.

## Authors' Addresses

Luna (metafactory)
