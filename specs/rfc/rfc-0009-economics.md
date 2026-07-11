---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 9
title: Economics
status: Draft
category: Informational
obsoletes: []
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories: []
created: 2026-07-12
ratified: null
grammar: specs/grammar/economics.abnf
vectors: specs/vectors/economics/
generated:
  - []
supersedes_prose: []
---

# RFC-0009: Economics

## Abstract

This document describes the `economics` annotation block of the myelin envelope: an OPTIONAL,
mutable object carrying token budgets, actual resource usage, a paying-party wallet identifier,
a billing reference, and a currency code. It records the block exactly as the wire carries it
today — a validated JSON shape with no emitter and no consumer — and it states, deliberately and
in full, what the block does **not** yet specify: the unit and precision of cost, the meaning of
the currency field against the USD-named cost fields, the relationship between the token counts,
and the semantics of aggregation across a delegate chain. Because those questions are unresolved,
this document is **Informational** and the block is **RESERVED**. It fixes no economic behaviour;
it fixes the current shape, the one hard trust contract that already binds it, and the list of
decisions that must be made before any Standards-Track successor can give the block meaning.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations
MUST NOT ground behaviour on a `Draft` or `Proposed` document. In particular, no implementation
may treat the `economics` block as an interoperable contract on the strength of this document.

This document's category is **Informational**: even when ratified it describes and reserves; it
does not define a Standards-Track wire contract. Giving the block interoperable economic meaning
REQUIRES a separate Standards-Track RFC that resolves the open decisions in §5.

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
2. The Economics Block — Current Shape
3. Reserved Status: schema without semantics
4. Mutable-Field Placement and Its Consequences
5. Open Questions (to resolve before Standards Track)
6. Registry Considerations
7. Security Considerations
8. Privacy Considerations
9. Conformance
10. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

The myelin envelope (RFC-0003) carries an OPTIONAL object named `economics`. It exists so that a
producer can attach a spending budget to a unit of work, an executor can attach the tokens and
cost actually consumed, and a hub can attribute that cost to a paying wallet — all as observability
metadata that travels with the message.

Today the block is a **shape without semantics**. It is present in the JSON Schema
([`schemas/envelope.schema.json`](../../schemas/envelope.schema.json) lines 74–127, informative),
shape-validated by the reference implementation (`src/envelope.ts` `validateEconomics`, lines
488–540, informative), and mirrored in a consumer's vendored validator (cortex
`src/bus/myelin/envelope-validator.ts` lines 111–116, informative). Nothing **emits** it: the
reference `createEnvelope` copies it through only if a caller supplies it (`src/envelope.ts:97`),
and no metafactory code path populates it. Nothing **consumes** it: no myelin code reads `budget`
to constrain execution, and the consumer (cortex) carries the type and a vendored schema copy but
has no reader of the block's values. It is, in the truest sense, reserved wire real estate.

This document specifies that reserved state precisely, so that the block cannot quietly acquire
meaning by convention in four independent implementations — the exact failure the RFC series
exists to prevent. It **does not** invent economic behaviour. Where a semantic must exist before
the block can be used interoperably (a cost unit, a currency binding, a reconciliation rule, an
aggregation rule), this document marks it **[OPEN DECISION]** in §5 rather than choosing it.

### 1.0. What this document does and does not do

- It **does** transcribe the current lexical shape as ABNF (Appendix A) and pin it with vectors
  (Appendix B), so the shape is unambiguous across implementations.
- It **does** carry forward the one hard trust contract that already binds the block (§3.3, §7.1).
- It **does not** define what a cost *means*, what currency a cost is in, how token counts relate,
  how hubs aggregate, or who may write the block. Those are §5.
- It **does not** promote any prose to normative (`supersedes_prose` is empty). The mutable-field
  trust contract remains sourced from `docs/architecture.md` §5.2, cited here informatively.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement. This
> document is a `Draft`; even its capitalised keywords do not bind until it is `Ratified`, and
> even then only as an Informational description — never as a Standards-Track economic contract.

### 1.2. Terminology

- **Economics block** — the OPTIONAL envelope-level `economics` object described here.
- **Budget** — the `economics.budget` sub-object: publisher-set constraints (`max_tokens`,
  `max_cost_usd`). Declared, not enforced (§3.2).
- **Actual** — the `economics.actual` sub-object: executor-reported usage (`input_tokens`,
  `output_tokens`, `total_tokens`, `model`, `duration_ms`, `cost_usd`).
- **Wallet** — the `economics.wallet` DID naming the party said to receive or pay for the work.
  It is a `did:mf` DID as defined by RFC-0001; this document does not redefine the DID grammar.
- **Billing reference** (`billing_ref`) — a free external tracking string, ≤ 256 characters.
- **Currency** — the `economics.currency` ISO 4217 [ISO4217] alphabetic code.
- **Mutable field** — an envelope field intentionally placed **outside** the L4 signature so
  intermediaries may annotate it without invalidating a stamp. `economics` is a mutable field
  (RFC-0003; `src/identity/canonicalize.ts:24–26`, informative).
- **SIGNABLE field** — a field included in the canonical bytes over which each stamp signs (defined
  by RFC-0003 / the signing canonicalization). `economics` is **not** one.
- **Emitter** — code that populates a field before publishing. The economics block has none.
- **RESERVED** — present and shape-validated on the wire, but carrying no interoperable meaning;
  producers SHOULD NOT depend on any consumer interpreting it, and consumers MUST NOT act on it
  beyond the trust contract in §3.3.
- **did:mf DID** — an identifier as specified by RFC-0001. Its terminal grammar is defined there
  and is **not** redefined here (grammar/README rule 5).

Terms not listed here — envelope, `signed_by`, stamp, canonical bytes, classification,
principal, stack, assistant — are defined in RFC-0001 (identifiers) and RFC-0003 (envelope) and
are used here with those meanings.

---

## 2. The Economics Block — Current Shape

This section is descriptive. It transcribes the block as the reference validator and schema define
it today. The lexical terminals are given normatively (for this Informational description) as ABNF
in Appendix A; the numeric bounds are validator constraints and are stated here in prose.

### 2.1. Position in the envelope

`economics` is an OPTIONAL top-level envelope property of JSON type `object`. It is not in the
envelope's `required` set. When present it MUST be an object (a non-object value — string, number,
array, null — is rejected; `src/envelope.ts:495–497`, informative). All of its sub-fields are
OPTIONAL; an empty object `{}` is valid.

`economics` is `additionalProperties: true` at the top level and at both the `budget` and `actual`
levels. Unknown keys are accepted and ignored by validation, at every level (§2.7).

### 2.2. `budget` — publisher-set constraints

`economics.budget` is an OPTIONAL object. Its defined fields:

| Field | Type | Constraint | Note |
|---|---|---|---|
| `max_tokens` | integer | `>= 1` (positive) | A `0` value is **rejected**. |
| `max_cost_usd` | number | `>= 0` | A `0` value is **accepted** (zero-budget). |

The name `max_cost_usd` bakes "USD" into the field; the interaction with `economics.currency`
(§2.6) is **[OPEN DECISION]** — see §5.2. `budget` is a **declaration only**: no myelin or consumer
code path reads it to block or throttle work (§3.2).

### 2.3. `actual` — executor-reported usage

`economics.actual` is an OPTIONAL object. Its defined fields:

| Field | Type | Constraint |
|---|---|---|
| `input_tokens` | integer | `>= 0` |
| `output_tokens` | integer | `>= 0` |
| `total_tokens` | integer | `>= 0` |
| `duration_ms` | integer | `>= 0` |
| `cost_usd` | number | `>= 0` |
| `model` | string | `model-id` (Appendix A) — `^[a-z][a-z0-9-]*$` |

Two properties of `model` the reader MUST NOT assume away, because they diverge from the
capability-tag and DID alphabets used elsewhere on the wire: a `model-id` MAY contain **consecutive
hyphens** and MAY end in a hyphen (there is no `-(?!-)` lookahead). It MUST start with a lowercase
letter, so the real identifier `gpt-4o` is accepted but a bare `4o` is not. `model` is bound to no
model registry; it is a free-form vendor string (§6).

The reference validator does **not** check any arithmetic relationship among the token counts:
`total_tokens` need not equal `input_tokens + output_tokens`. This is intentional in the code
(comment: "hubs aggregate across delegate chains where the relationship is not arithmetic";
`src/envelope.ts:488–494`, informative). Whether a reader may reconcile or sum these fields is
**[OPEN DECISION]** — §5.3. The vector `economics/total-tokens-inconsistent-accepted` (Appendix B)
pins this as a **masking case**: code that assumes reconciliation exists will pass every valid
envelope until the day the counts disagree.

### 2.4. `wallet` — paying/receiving party

`economics.wallet` is an OPTIONAL string constrained to a `did:mf` DID (`wallet-did`, Appendix A),
using the **same** pattern as every other DID field in the envelope. This document does **not**
define a distinct wallet-identifier grammar; a wallet is a `did:mf` DID per RFC-0001. Because it
reuses that flat namespace, a wallet value can be byte-identical to a principal, stack, agent,
service or hub DID (RFC-0001, flat-namespace class collision). "Which party is paid" therefore
rests on convention, not on the grammar — see §5.6, blocked on cortex#1880.

### 2.5. `billing_ref` — external reference

`economics.billing_ref` is an OPTIONAL free string of at most **256** characters (schema
`maxLength: 256`; `src/envelope.ts:533`, informative). It has no lexical pattern — every code point
is permitted — so Appendix A gives it no ABNF production. A 256-character value is accepted; a
257-character value is rejected (Appendix B boundary vectors).

### 2.6. `currency` — ISO 4217 code

`economics.currency` is an OPTIONAL string matching `currency-code` (Appendix A) — exactly three
uppercase ASCII letters, transcribing `^[A-Z]{3}$`. The grammar does **not** check membership in
the ISO 4217 register (`ZZZ` is syntactically valid). The schema description reads "ISO 4217
currency code when not USD", which implies absent ⇒ USD — but the cost fields are themselves named
`*_usd`, so the meaning of a non-USD `currency` alongside a `cost_usd` value is undefined. This is
**[OPEN DECISION]** §5.2 and is pinned by the collision vector
`economics/currency-vs-usd-ambiguity-accepted` (Appendix B).

### 2.7. Forward-compatibility (`additionalProperties: true`)

Unknown keys are accepted and ignored at the top level and inside `budget` and `actual`
(`economics.test.ts:163–177`, informative). This makes the block forward-compatible **and**
turns it into an open, unbounded write surface. Combined with its placement outside the signature
(§4), this is a security-relevant property (§7.2) and an **[OPEN DECISION]** on bounds (§5.5).

---

## 3. Reserved Status: schema without semantics

### 3.1. No emitter

No metafactory code produces an economics block. The reference `createEnvelope` includes the block
only when a caller passes one in (`src/envelope.ts:97`, informative); it never populates `budget`,
`actual`, `wallet`, `billing_ref` or `currency` on its own. This mirrors the `spec_version`
"verifiers before emitters" doctrine (RFC-0003) — except here there is not yet even a verifier that
*acts* on the block, only one that shape-validates it.

### 3.2. No consumer

No code reads the block to make a decision. In myelin, `budget.max_tokens` / `max_cost_usd` are
range-checked but never consulted as a limit (`src/envelope.ts:503–507`, informative). In the
consumer (cortex), the block appears only as a vendored type and a vendored schema copy
(`src/bus/myelin/envelope-validator.ts:111–116`; `vendor/envelope.schema.json:74`, informative)
and one empty-object test fixture — there is **no reader of any economics value** on `origin/main`.

Consequently the block MUST be treated as RESERVED: a producer that populates it SHOULD NOT expect
any consumer to interpret it, and a consumer MUST NOT begin interpreting it as an interoperable
contract on the basis of this document (§9).

### 3.3. The one hard contract: not trust-bearing

Exactly one property already binds and is carried forward here unchanged. Clients **MUST NOT** make
security or trust decisions based on the values in the economics block. The schema states it inline
("MUST NOT inform security or trust decisions"; `schemas/envelope.schema.json:76`) and
`docs/architecture.md` §5.2 states the general rule for all mutable fields ("clients MUST NOT make
security or trust decisions based on mutable-field values"). This is the single normative-in-spirit
statement in this document; §7.1 gives the threat model behind it. Everything else about the block
is OPEN.

---

## 4. Mutable-Field Placement and Its Consequences

`economics` is deliberately **excluded** from the SIGNABLE field set: the reference
canonicalization lists `correlation_id, economics, extensions` as "mutable without invalidating
signature" and omits them from the bytes each stamp signs (`src/identity/canonicalize.ts:24–26`,
informative; the SIGNABLE set is RFC-0003's concern). The intent is legitimate — a hub in a
delegate chain can annotate cost without re-signing — but it has three consequences a
Standards-Track successor MUST address, not assume:

1. **Unauthenticated.** No stamp attests any economics value. A value present at the receiver may
   have been written by the origin, by any relay, or by the transport. There is no cryptographic
   binding between a cost and the actor who claims to have incurred it.
2. **Unbounded.** With `additionalProperties: true` and no `maxProperties`/`maxLength` (except
   `billing_ref`'s 256), the block is an open, size-unbounded write channel on a signed message.
   Appendix B pins this (`economics/unbounded-unknown-field-accepted`).
3. **Aggregation is asserted but unspecified.** The schema says `actual` is "aggregated by hubs in
   delegate chains" and the block "intermediaries may aggregate", yet no rule says which fields
   aggregate, by what operation, over which hops, or who wins a conflict (§5.4).

These are why the block is Informational/RESERVED rather than Standards-Track today.

---

## 5. Open Questions (to resolve before Standards Track)

Each item below is an **[OPEN DECISION]**. This document records them; it does not resolve them.
Owners are the principal and the hub custodian (ratification signatories). A Standards-Track
successor to this RFC is REQUIRED before the block carries interoperable meaning, and that
successor MUST resolve each of these.

### 5.1. Cost unit & precision — [OPEN DECISION — Andreas + JC — blocked on: unfiled]

`cost_usd` / `max_cost_usd` are JSON numbers. Undefined: the currency they denote absent an
explicit `currency` (the name says USD; §5.2 complicates it), the decimal precision (binary float
vs fixed-point minor units), the rounding rule, and — for `duration_ms` — the clock basis. Money
carried as an IEEE-754 float invites cross-implementation representation drift.

### 5.2. Currency vs `_usd` ambiguity — [OPEN DECISION — Andreas + JC — blocked on: unfiled]

The cost fields are named `_usd`; `currency` is a free ISO 4217 code "when not USD". When
`currency` ≠ `USD`, is `cost_usd` reinterpreted in that currency, invalid, or ignored? Both a
`_usd` field and a non-USD `currency` validate simultaneously (vector
`economics/currency-vs-usd-ambiguity-accepted`). Candidate resolutions: rename cost fields to
currency-neutral `cost`/`max_cost`; forbid `currency`; or bind the cost fields to the declared
`currency`. **Not chosen here.**

### 5.3. Dual-token carriage & reconciliation — [OPEN DECISION — Andreas + JC — blocked on: unfiled]

`input_tokens`, `output_tokens` and `total_tokens` are carried independently and the validator
enforces no relationship among them. Undefined: which is authoritative, whether a reader may sum
input+output, and whether `total_tokens` is a cross-hop aggregate (in which case it legitimately
exceeds this hop's input+output). Pinned as a masking case in Appendix B.

### 5.4. Aggregation semantics — [OPEN DECISION — Andreas + JC — blocked on: unfiled]

"Aggregated by hubs in delegate chains" / "intermediaries may aggregate" is asserted with no
mechanism. Undefined: the set of aggregatable fields, the operation (sum / max / last-writer-wins),
the hop scope, idempotency under replay (RFC-0003's freshness/replay tension), and the authority
rule when an annotated value and a stamp-derived value disagree.

### 5.5. Bounds for the unauthenticated mutable channel — [OPEN DECISION — Andreas + JC — blocked on: shared with RFC-0003 mutable-field bounds]

`economics` is unbounded and unsigned (§4). Decide `maxProperties`/`maxLength` bounds and whether
an attested economics digest (or a per-stamp economics bag on the signed chain) is required for any
use that needs the values to be both mutable **and** trustworthy. This decision is shared with the
general mutable-channel bounds question in RFC-0003.

### 5.6. Wallet DID class — [OPEN DECISION — Andreas + JC — blocked on: the-metafactory/cortex#1880]

`wallet` reuses the flat `did:mf` namespace, so a wallet value is indistinguishable by grammar from
a principal/stack/agent/service/hub DID. Correct billing attribution may require a class-unambiguous
DID. This is downstream of RFC-0001's method-specific-id encoding decision (cortex#1880); this
document cannot resolve it independently.

### 5.7. Emitter / populator doctrine — [OPEN DECISION — Andreas + JC — blocked on: unfiled]

No code emits or consumes the block (§3). Before it leaves RESERVED status, define who populates
`budget` (producer?) vs `actual` (executor? each hub?), at which stamp/hop, and whether `budget`
is advisory or an enforced ceiling (and if enforced, by whom — enforcement of an unsigned budget
contradicts §3.3 / §7.1).

---

## 6. Registry Considerations

- **RFC number** — 0009, allocated in [`specs/README.md`](../README.md); numbers are never reused.
- **Reserved envelope key** — this document reserves the top-level envelope key `economics` and its
  sub-keys `budget`, `actual`, `wallet`, `billing_ref`, `currency`, and the `budget` fields
  (`max_tokens`, `max_cost_usd`) and `actual` fields (`input_tokens`, `output_tokens`,
  `total_tokens`, `model`, `duration_ms`, `cost_usd`). Their **semantics** are reserved for a
  future Standards-Track RFC (§5); their **shape** is as in §2.
- **DID method** — this document registers no DID method. `wallet` reuses the `did:mf` method whose
  registration status is RFC-0001's concern; no W3C DID Specification Registries action arises here.
- **Model identifier** — `economics.actual.model` is a free-form string bound to **no** registry.
  Whether a canonical model registry (or a namespaced model identifier) should exist is left open
  and is out of scope for this document.
- **Currency codes** — `economics.currency` references the external ISO 4217 register [ISO4217];
  this document does not maintain a currency registry and does not validate membership.
- **Open sub-namespace** — because the block is `additionalProperties: true`, the `economics.*`
  field namespace is currently open. Whether future field names must be registered (rather than
  admitted silently) is part of §5.5.

## 7. Security Considerations

This section is REQUIRED and is not empty.

### 7.1. Cost as a trust side-channel (the load-bearing contract)

The economics block is **advisory metadata, not evidence**. Its values are unsigned (§4) and may be
written or altered by any hop. Therefore clients **MUST NOT** make security or trust decisions based
on economics values — the same hard contract stated in `docs/architecture.md` §5.2 and inline in
the schema. Concretely: a low reported `cost_usd` or a "within-budget" `actual` MUST NOT be used to
grant trust, relax verification, or authorise an action; a `wallet` MUST NOT be treated as an
authenticated payer. Anything that needs to be both mutable **and** attested is a signal to add a
new attested mechanism (RFC-0003), not to trust this block.

### 7.2. Unauthenticated, unbounded injection channel

Because the block is excluded from SIGNABLE fields and is `additionalProperties: true` with no size
bound (except `billing_ref`), an intermediary can inject or alter arbitrary, arbitrarily-large
content on a signed federated envelope **without invalidating any stamp** (vector
`economics/unbounded-unknown-field-accepted`). Risks: (a) a resource-amplification / storage-DoS
vector if downstream systems persist the block verbatim; (b) covert-channel carriage of data in
unknown keys past a verifier that only checks the signed fields. Mitigation is deferred to the
bounds decision (§5.5). **This is a runtime/format gap, not a defended property** — recorded here
rather than encoded as a fait accompli.

### 7.3. Cost as a computation/traffic side-channel

Even used honestly, the block leaks. `input_tokens`, `output_tokens`, `total_tokens` and
`duration_ms` disclose the size and complexity of a payload that may otherwise be opaque or
end-to-end confidential; `model` discloses which model processed a message. An observer who cannot
read a payload can still infer a great deal from its economics. A producer SHOULD consider omitting
the block (it is OPTIONAL) on messages whose size/complexity is itself sensitive. See §8.

### 7.4. Budget is declared, not enforced

`budget` looks like a spending ceiling but nothing enforces it (§3.2). An implementation MUST NOT
assume a message was executed within its declared budget merely because a budget is present; and,
per §7.1, an *unsigned* budget MUST NOT be turned into a security control without first resolving
§5.5/§5.7 (attestation) — enforcing an attacker-writable ceiling is worse than enforcing none.

### 7.5. Grammar-vs-runtime boundary (explicit)

Per the scaffold's requirement to record where an invariant is held by a runtime check rather than
by the format: **every** constraint on this block is a runtime check. The shape/patterns are held
by `validateEconomics` and the JSON Schema (not by any ratified grammar until this RFC or a
successor is ratified); the trust contract (§7.1) is a runtime discipline, not a wire property; and
the size/authenticity gaps (§7.2) are held by *nothing* today. A conforming implementation is
therefore an independent re-implementation of runtime checks — which is exactly the divergence the
vectors (Appendix B) exist to bound.

## 8. Privacy Considerations

This section is REQUIRED because this document specifies an identifier (`wallet`, a `did:mf` DID).

- **`wallet` correlates a payer across all their traffic.** A `did:mf` wallet DID is a stable
  identifier; the same wallet on many envelopes links otherwise-unrelated work to one paying party.
  Because it reuses the flat `did:mf` namespace (§5.6), a wallet may also be correlated with the
  same identifier appearing as a principal/stack/agent DID elsewhere, linking "who paid" to "who
  acted".
- **`billing_ref` links wire traffic to external systems.** An invoice/tracking reference bridges
  the message to a billing or accounting system, potentially de-anonymising a workflow to anyone
  who can join the two.
- **`model`, token counts and `duration_ms` are a metadata leak** even when the payload is opaque
  (§7.3): they reveal processing choices and payload magnitude.
- **The block is mutable and unsigned**, so these disclosures can be *added* by an intermediary the
  origin did not choose, not only by the origin.

Guidance: the block is OPTIONAL; producers with privacy-sensitive payloads SHOULD weigh omitting
`wallet`/`billing_ref` or the whole block. A Standards-Track successor SHOULD state whether wallet
and billing identifiers may be pseudonymised or must be minimised on `federated`/`public` traffic.

## 9. Conformance

An implementation conforms to this document if and only if it passes every vector under the path
named in `vectors` (`specs/vectors/economics/`). Prose explains; **vectors bind**.

Because the block is RESERVED and not-yet-emitted, conformance here is scoped narrowly:

1. An implementation that **validates** an envelope's economics block MUST agree with the vectors —
   accepting every `valid.json` input and rejecting every `invalid.json` input with the stated
   reason. It MUST NOT impose stricter constraints (e.g. rejecting a `model` with `--`, or
   enforcing `total_tokens = input + output`) unless it declares a non-conforming profile.
2. An implementation MUST honour the trust contract of §3.3/§7.1: it MUST NOT make a security or
   trust decision from any economics value.
3. An implementation is **not** REQUIRED to emit or to consume the block. No conformance claim is
   made about the *meaning* of the values, because this document assigns none.

A consumer that today re-implements economics validation (as cortex's vendored validator does) is,
by construction, an independent implementation of an unspecified shape; running these vectors is
how that implementation demonstrates it agrees with the reference. See
[`specs/CONFORMANCE.md`](../CONFORMANCE.md).

## 10. References

### 10.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC8259] Bray, T., Ed., "The JavaScript Object Notation (JSON) Data Interchange Format", STD 90, RFC 8259, December 2017.
- [ISO4217] ISO 4217, "Codes for the representation of currencies", International Organization for Standardization.
- [RFC-0001] metafactory, "Identifiers and Identity (`did:mf` DID Method Specification)". *(Draft — the `did` and `lower` terminals imported by Appendix A are defined there; this RFC does not redefine them. Grounding on RFC-0001 is valid only once it is Ratified.)*
- [RFC-0003] metafactory, "Envelope". *(Draft — owns the envelope shape that carries this block, and the SIGNABLE/mutable field boundary that places `economics` outside the signature.)*

### 10.2. Informative References

- `schemas/envelope.schema.json` (lines 74–127) — the economics block shape.
- `src/envelope.ts` `validateEconomics` (lines 488–540), `CURRENCY_RE` (406), `MODEL_ID_RE` (407) — the reference validator.
- `src/identity/canonicalize.ts` (lines 24–26) — the mutable-field exclusion placing `economics` outside the signature.
- `src/types.ts` (lines 83–122) — the `Economics` TypeScript shape.
- `src/economics.test.ts` — the behaviour the Appendix B vectors are drawn from.
- `docs/architecture.md` §5.2 — "Mutable fields are NOT trust-bearing" (source of the §3.3/§7.1 contract; not promoted to normative here).
- cortex `src/bus/myelin/envelope-validator.ts` (111–116) and `vendor/envelope.schema.json` (74) — the consumer's vendored copy; evidence of an independent implementation with no reader of the block.
- the-metafactory/cortex#1880 — the `did:mf` method-specific-id encoding decision that §5.6 (wallet DID class) is blocked on.
- W3C DID Core — the DID data model `wallet` conforms to via RFC-0001.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in
`grammar` (`specs/grammar/economics.abnf`) is the source of truth and is what CI validates. It
describes only the string-typed terminals; numeric bounds are validator constraints (§2.2–§2.3),
not grammar productions.

```abnf
; see specs/grammar/economics.abnf

; Imported (NOT redefined here) from RFC-0001, specs/grammar/identifiers.abnf:
;   lower = %x61-7A            ; a-z
;   did   = did-prefix method-specific-id   ; did:mf DID — OPEN (cortex#1880)

UPPER           = %x41-5A                        ; A-Z

; economics.currency — ISO 4217 alpha code. CURRENCY_RE  /^[A-Z]{3}$/
; Not checked against the ISO register. Meaning vs the `_usd` cost fields
; is OPEN (RFC §5.2).
currency-code   = 3UPPER

; economics.actual.model — free-form vendor model id. MODEL_ID_RE
;   /^[a-z][a-z0-9-]*$/  — NO length bound; trailing "-" and "--" PERMITTED
;   (diverges from capability tags and did:mf); must start with a letter,
;   so "gpt-4o" passes but "4o-mini" is rejected.
model-id        = lower *( lower / DIGIT / "-" )

; economics.wallet — the did:mf DID of RFC-0001, unchanged. Subject to the
; SAME flat-namespace class collision (RFC §5.6).
wallet-did      = did

; economics.billing_ref — free string, <= 256 chars, NO lexical pattern;
;   intentionally has no ABNF production (a rule would over-constrain it).
; economics.budget.max_tokens (int>=1), max_cost_usd (num>=0),
; economics.actual.{input_tokens,output_tokens,total_tokens,duration_ms}
;   (int>=0), cost_usd (num>=0) — JSON numbers [RFC8259]; range is a
;   validator constraint, NOT a grammar rule (RFC §2, §5.3).
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/economics/`, consumable from any language. This appendix
reproduces a representative subset; it is **not** the only copy. Every vector carries a `why`
(enforced in CI). The `kind` is `validateEconomics`; `value` echoes the block verbatim (economics
is never normalized). The file returned with this draft is `economics/valid.json` (the accept set,
which includes the masking, collision and unbounded-channel cases). The companion `invalid.json`
below is authored alongside it — its rejection reasons are the stable machine tokens the reference
validator emits.

### B.1. `valid.json` (representative)

```jsonc
// masking — reconciliation NOT enforced; masks the dual-token gap (§5.3)
{ "id": "economics/total-tokens-inconsistent-accepted", "rfc": 9, "kind": "validateEconomics",
  "input": { "actual": { "input_tokens": 10, "output_tokens": 5, "total_tokens": 100 } },
  "expect": { "ok": true, "value": { "actual": { "input_tokens": 10, "output_tokens": 5, "total_tokens": 100 } } },
  "why": "100 != 15 validates; a reader assuming total = input+output passes until the counts disagree." }

// collision of meaning — USD-named fields + non-USD currency both validate (§5.2)
{ "id": "economics/currency-vs-usd-ambiguity-accepted", "rfc": 9, "kind": "validateEconomics",
  "input": { "budget": { "max_cost_usd": 5 }, "actual": { "cost_usd": 3 }, "currency": "CHF" },
  "expect": { "ok": true, "value": { "budget": { "max_cost_usd": 5 }, "actual": { "cost_usd": 3 }, "currency": "CHF" } },
  "why": "The wire cannot say whether 5/3 are USD or CHF; two implementations may bill differently." }

// security — unbounded, unsigned injection channel (§4, §7.2)
{ "id": "economics/unbounded-unknown-field-accepted", "rfc": 9, "kind": "validateEconomics",
  "input": { "wallet": "did:mf:ops-team", "injected_by_relay": "arbitrary annotation ..." },
  "expect": { "ok": true, "value": { "wallet": "did:mf:ops-team", "injected_by_relay": "arbitrary annotation ..." } },
  "why": "additionalProperties:true + no size bound + excluded from SIGNABLE: a relay injects without breaking a stamp." }
```

### B.2. `invalid.json` (companion — reasons are stable tokens)

```jsonc
{ "id": "economics/model-starts-with-digit-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "actual": { "model": "4o-mini" } },
  "expect": { "ok": false, "reason": "economics.actual.model" },
  "why": "model-id MUST start with a letter; contrast the accepted `gpt-4o`. Edge of MODEL_ID_RE." }

{ "id": "economics/currency-lowercase-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "currency": "usd" },
  "expect": { "ok": false, "reason": "economics.currency" },
  "why": "currency-code is 3 UPPERCASE letters; lowercase is rejected." }

{ "id": "economics/currency-wrong-length-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "currency": "USDC" },
  "expect": { "ok": false, "reason": "economics.currency" },
  "why": "Exactly three letters; 'US' and 'USDC' are both rejected." }

{ "id": "economics/max-tokens-zero-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "budget": { "max_tokens": 0 } },
  "expect": { "ok": false, "reason": "economics.budget.max_tokens" },
  "why": "max_tokens is a POSITIVE integer (>=1); 0 is rejected — contrast max_cost_usd where 0 is valid." }

{ "id": "economics/cost-usd-negative-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "actual": { "cost_usd": -0.01 } },
  "expect": { "ok": false, "reason": "economics.actual.cost_usd" },
  "why": "cost_usd is a non-negative number." }

{ "id": "economics/wallet-consecutive-hyphen-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "wallet": "did:mf:hub--metafactory" },
  "expect": { "ok": false, "reason": "economics.wallet" },
  "why": "wallet is a did:mf DID; the DID grammar forbids '--'. Cross-ref RFC-0001. Contrast model-id, which permits '--'." }

{ "id": "economics/billing-ref-257-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": { "billing_ref": "<257 chars>" },
  "expect": { "ok": false, "reason": "economics.billing_ref" },
  "why": "billing_ref maxLength is 256; 257 is the just-over boundary." }

{ "id": "economics/not-an-object-rejected", "rfc": 9, "kind": "validateEconomics",
  "input": "10000",
  "expect": { "ok": false, "reason": "economics" },
  "why": "economics MUST be an object when present; a string is rejected (economics.test.ts:179-182)." }
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen;
changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Documents the RESERVED `economics` block shape (§2), its no-emitter/no-consumer state (§3), mutable-field placement (§4), and seven open decisions blocking Standards-Track promotion (§5). ABNF for `currency-code`/`model-id`/`wallet-did` (Appendix A). Vectors incl. masking (token reconciliation), collision (currency vs USD) and unbounded-channel cases (Appendix B). |

## Acknowledgments

This draft is grounded in the wire-protocol audit of the `discovery-econ` dimension and the myelin
`origin/main` source cited throughout. It records current behaviour; it does not redesign it.

## Authors' Addresses

Luna, metafactory.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/