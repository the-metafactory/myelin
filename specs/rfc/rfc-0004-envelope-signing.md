---
rfc: 0004
title: Envelope Signing and Canonicalization
status: Ratified
category: Standards Track
obsoletes: []
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories:                    # Single-principal ratification (v1) per docs/adr/0001-single-principal-ratification.md. Two-signature (adding the hub custodian) reinstates on a 2nd impl / live peer.
  - name: Andreas
    affiliation: metafactory
created: 2026-07-12
ratified: 2026-07-13
grammar: specs/grammar/envelope-signing.abnf
vectors: specs/vectors/envelope-signing/
generated:
  - schemas/envelope.schema.json#/$defs/signedByStamp   # stamp shape: method, identity, at, role, stamped_by
  - src/wire/generated/r/envelope-signing.ts            # canonical-signature / public-key regexes + signing-method enum + context-tag, derived by tools/abnf-gen (#237). Fixes the prior category error that listed `grammar:` (the SOURCE) as its own generated OUTPUT.
crossRefs:                      # sibling RFCs this document cites (cascade sweep 2026-07-13, REVISIONS.md C10)
  - "0001"                      # did:mf terminals for identity/stamped_by; two-plane taxonomy; agent prefix binding; §11 hard-cut migration
  - "0002"                      # subject namespace — the subject is NOT signed (§9 finding)
  - "0003"                      # envelope field inventory (carries the field-id↔name table); stamp JSON shape; spec_version
  - "0007"                      # transport — freshness/replay (§7.4) couples to the TASKS JetStream redelivery + Nats-Msg-Id
  - "0010"                      # refusal taxonomy — the §7.1 non-agent originator binding reject (§11.3 `originator-principal-binding-violation`) wire-surfaces as `policy_denied` (RFC-0010 §2.2), Draft (myelin#251)
openDecisions:                  # the 3 RETAINED open decisions after the 32-decision grill (grill-logs/rfc-0004.md, Andreas 2026-07-13). Every other OD is RESOLVED in this revision.
  - id: hub-vouching-authority-scope        # D14 — which identities a trusted hub MAY vouch for; blocked on cortex Phase D federation hub trust
  - id: local-scope-unsigned-fallback       # D23 — whether local-scope (non-federated) traffic MAY silently fall back to unsigned; Andreas + JC
  - id: resign-on-ingest-promotion          # D25 — whether to promote re-sign-on-ingest to a named wire concept; Andreas + JC
supersedes_prose:
  - docs/identity.md (§Canonical Signing Payload, §Chain of Stamps, §Signing methods, §Verification Rules)
  - docs/envelope.md (§ mutable carve-out for correlation_id/economics/extensions)
---

# RFC-0004: Envelope Signing and Canonicalization

## Abstract

This document specifies the cryptographic core of the myelin wire protocol: the exact
sequence of bytes an implementation signs when it attests to an envelope, and the exact
procedure another implementation follows to verify that attestation. It defines the JSON
Canonicalization Scheme profile used to reduce an envelope to a deterministic byte string,
the **field-identifier indirection** by which those bytes key on a permanent numeric id rather
than a field name (so a rename is never cryptographically breaking), the fixed set of
envelope fields that enter the signature, the three fields deliberately left mutable outside
it, the domain-separation prefix that binds every signature to this protocol, the `signed_by`
chain of stamps and the rule by which each stamp commits to every stamp before it, the two
signing methods (`ed25519` and `hub-stamp`), the fully-pinned Ed25519 verification equation,
and the admission-time freshness control. Two independent implementations that follow this
document produce identical signing bytes for the same envelope and accept each other's
signatures. The scheme specified here is the **strict form**, effective at flag-day R (the
RFC-0001 §9 hard cut that regenerates every signature): where the live implementation and best
cryptographic practice diverged, this document adopts the strict rule, which is near-free to
adopt now and prohibitive later. The four places where live code must still be moved onto the
strict rule are recorded in §9 as flag-day-R code follow-ups, not silently encoded.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Ratified` (single-principal, 2026-07-13) under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md). Only a document with status
`Ratified` is normative; implementations MUST NOT ground behaviour on a `Draft` or `Proposed`
document. Ratification is single-principal per ADR-0001: while myelin is the only implementation
and no federated peer is live, the principal alone ratifies; the full two-signature act (principal
+ hub custodian) reinstates the moment a second independent implementation exists or a live
federated peer principal joins.

This revision resolves the thirty-two decisions of the RFC-0004 grill
([`grill-logs/rfc-0004.md`](grill-logs/rfc-0004.md), ratified by the principal 2026-07-13) and
removes every open-decision marker they closed. Three open decisions are explicitly **retained**
(§9): the hub vouching-authority scope (D14, blocked on cortex Phase D), the local-scope
unsigned-fallback blessing (D23), and the re-sign-on-ingest promotion (D25). Under ADR-0001 a
`Ratified` living-spec document MAY carry explicitly-flagged open sub-decisions like these: the
decided content is normative, while each `[OPEN DECISION]` point is not-yet-decided and resolves
by revision — it does not hold up ratification of the rest.

Under ADR-0001 a `Ratified` RFC is a **living spec**: `Ratified` means the current best contract
the implementation tracks, and a hole is resolved by revising the RFC and reimplementing what is
required. Section numbering stays stable so citations hold. The immutable-once-`Ratified`
discipline (changes shipped only as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN`) is
the reinstate-target that returns with the two-signature rule.

Ratification (v1) requires the signature of **the principal** alone, recorded in `signatories`
(ADR-0001). The full two-signature act (principal + hub custodian) is suspended, not deleted: it
reinstates the moment the wire binds a party we do not control — a second independent
implementation, or a live federated peer principal.

The authoritative index of RFCs, their numbers and their statuses is
[`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
2. The Signing Model
3. The Canonicalization Scheme (JCS Profile)
4. The Signable Projection and the Field-ID Registry
5. The Stamp and the Chain
6. Signing
7. Verification
8. Registry Considerations
9. Security Considerations
10. Privacy Considerations
11. Conformance
12. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

Every trusted envelope on the myelin bus carries a `signed_by` chain of one or more
cryptographic **stamps**. A stamp is an Ed25519 signature over a canonical byte
representation of the envelope. The value of a signature is entirely determined by the bytes
signed: if two implementations disagree by a single byte on what those bytes are, every
signature one produces is rejected by the other, silently, on the happy path. This document
exists to remove that possibility.

The bytes-to-sign contract was, before this specification, expressed only in reference
TypeScript (`src/jcs.ts`, `src/identity/canonicalize.ts`, `src/identity/sign.ts`,
`src/identity/verify.ts`) and in informative prose (`docs/identity.md`, `docs/envelope.md`).
The envelope JSON Schema (RFC-0003) captures the *shape* of a stamp but structurally cannot
express which fields are signed, in what order the bytes are produced, how a chain commits to
its own history, how a hub's trust is resolved, or the freshness window. No artifact an
independent implementer could ground on defined these. This RFC is that artifact.

**The strict form, effective at the cut (L0a).** Where the live wire and best cryptographic
practice diverged — malleable signature encodings, no domain separation, loose canonicalization
corners, an over-permissive verification equation — this document specifies the strict form.
Because flag-day R (the RFC-0001 §9 DID-encoding hard cut) regenerates every signature
atomically, adopting the strict rule now is near-free and prohibitive later. Each tightening
was surfaced and ratified individually in the grill; this document is their resolution, not a
fresh design.

**Independent-implementation grade (L0b).** A second implementation (Go, Python, Rust) with no
access to the reference TypeScript MUST be able to verify byte-for-byte from this document and
its vectors alone. Consequently the JCS profile is pinned to the byte (number serialization,
string escapes, key ordering, absent-vs-null), every corner carries a conformance vector, and
"read the reference source" is never part of the contract.

**The central structural change (D1).** This revision replaces name-addressed signing with
**field-identifier indirection**: the bytes signed key on a permanent numeric id assigned to
each signable field, not on the field's name (§4). A field rename is therefore no longer a
cryptographic break. This is a new crypto surface and is specified deliberately in §4, not
bolted onto the cut.

**What this document specifies.** The JCS profile and its parse model (§3); the signable field
set, the mutable carve-out, and the field-ID registry that keys the canonical form (§4); the
stamp object, the chain, the chain-commit / chain-slice rule, and the chain authority semantics
(§5); the `ed25519` signing procedure, the canonical signature and public-key encodings, and the
domain-separation prefix (§6); the per-stamp verification procedure, the fully-pinned Ed25519
equation, hub-trust resolution, admission-time freshness, and the verifier conformance classes
and deployment postures (§7).

**What this document does not specify.** The `did:mf` identifier syntax carried in a stamp's
`identity` and `stamped_by` fields — that is RFC-0001, referenced here. The envelope's field
inventory, types, and JSON structure, and the id↔name mapping table for the field-ID registry —
that is RFC-0003, referenced here (this document owns *membership*, RFC-0003 *carries the table*).
The NATS subject an envelope is published on — that is RFC-0002, and the subject is **not**
signed (§9). Transport redelivery, `Nats-Msg-Id`, and the JetStream duplicate window — that is
RFC-0007. Key generation, storage, rotation, and revocation — out of scope of the format, with
the consequences noted in §9.

**Four live-code gaps remain, flagged not encoded.** Four properties this document makes
normative are not yet true of the live verifier; each lands at flag-day R and is recorded as a
code follow-up in §9 (F-5 origin re-anchor, freshness admit-vs-re-verify separation, the
federation floor, and the gateway stamp-before-admit reorder). This document specifies the
target rule; it does not claim the code already conforms.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords
> in all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.2. Terminology

- **Envelope** — the M3 message object whose fields, types, and JSON shape are defined in
  RFC-0003. This document treats the envelope as a JSON object and signs a projection of it.
- **Stamp** — one cryptographic attestation: an object carrying a signing `method`, an
  attesting `identity` DID, a base64 `signature`, an ISO-8601 timestamp `at`, and an OPTIONAL
  semantic `role`. The hub-stamp variant additionally carries `stamped_by`.
- **`signed_by` chain** — the ordered sequence of stamps attached to an envelope, origin
  first, most-recent last. On the wire it is either a single stamp object (legacy input shim)
  or an array; its canonical form and its signed form are always the array (§4.3).
- **Signable projection** — the sub-object of the envelope consisting of exactly the keys in
  the signable field set (§4.1) that are present.
- **Field-ID registry** — the permanent assignment of a numeric identifier to each signable
  field (§4.1). The canonical form keys on these ids, not on field names (§4.4).
- **Mutable carve-out** — the three envelope fields (`correlation_id`, `economics`,
  `extensions`) deliberately excluded from every signature so that relays may annotate them
  without invalidating a stamp (§4.2). These fields carry no field-id.
- **Canonicalization** — the deterministic reduction of a JSON value to a byte string (§3),
  a profile of JCS [RFC8785] over the field-ID-keyed projection.
- **Canonical form** — the JCS string of the signable projection after its top-level keys have
  been re-mapped from names to their decimal field-id strings (§4.4).
- **Domain-separation prefix / `CONTEXT_TAG`** — the fixed octet prefix prepended to the
  canonical bytes before signing, binding a signature to this protocol (§6.1).
- **Bytes-to-sign** — `CONTEXT_TAG` followed by the UTF-8 encoding of the canonical form with
  the chain prepared per §5.4; the input to Ed25519 (§6.1).
- **Chain-commit** — the property that stamp *i*'s bytes-to-sign include stamps `0..i-1` with
  their signatures intact, so that tampering with any earlier stamp invalidates stamp *i*.
- **Signing method** — `ed25519` (an identity signs with its own key) or `hub-stamp` (a
  registry-trusted hub signs on an identity's behalf).
- **Identity registry** — the off-wire trust anchor mapping a DID to a single public key and
  a type, plus the set of trusted hubs (§8). It is not part of the envelope.
- **Freshness window** — the admission-time bound on `abs(now − at)`; ±5 minutes by default,
  applied **once** at the trust boundary and never re-applied on re-verification (§7.4).
- **Conformance class** — an abstract verifier behaviour (e.g. *enforcing*) onto which a
  deployment posture maps; the unit a conformance claim is stated against (§7.6).

Terms defined in other RFCs — `did`, `did:mf`, `method-specific-id` (RFC-0001); the envelope
field inventory and `spec_version` (RFC-0003); the NATS subject grammar (RFC-0002) — are
cited, not redefined.

---

## 2. The Signing Model

A stamp is produced by these steps, each specified normatively later in this document:

1. Take the envelope as a JSON object.
2. Retain only the signable fields (§4.1); drop everything else, including the mutable
   carve-out (§4.2).
3. Normalize `signed_by` to array form and prepare the chain for the stamp being produced
   (§5.4).
4. Re-key the projection's top-level names to their decimal field-ids (§4.4), then
   canonicalize the result to a string (§3).
5. Prepend the domain-separation prefix `CONTEXT_TAG` to the UTF-8 encoding of that string to
   form the bytes-to-sign (§6.1).
6. Sign the bytes with Ed25519 and encode the 64-byte signature as canonical base64 (§6.2).
7. Append the completed stamp to `signed_by`.

Verification (§7) inverts steps 3–6 for each stamp in the chain and additionally checks
registry membership, the fully-pinned Ed25519 equation (§7.2), the chain authority semantics
(§5.5), and — at the trust boundary only — freshness (§7.4).

The signing bytes commit to the envelope's identity-bearing content (`id`, `source`, `type`,
`timestamp`, `sovereignty`, `payload`, the task-routing fields, `originator`, `spec_version`)
via their field-ids, and to the entire prior chain, but NOT to `correlation_id`, `economics`,
`extensions`, and NOT to the NATS subject the envelope rides. §9 records the consequences of
each exclusion.

---

## 3. The Canonicalization Scheme (JCS Profile)

Canonicalization is a total function from a JSON value to a UTF-8 string, following the JSON
Canonicalization Scheme [RFC8785]. This section specifies the profile exactly, because it is
the single most interoperability-critical algorithm in the protocol. It transcribes
`src/jcs.ts` (`canonicalStringify`). The field-ID re-keying that precedes it is specified in
§4.4; this section governs the serialization of whatever value it is given.

### 3.1. Value serialization

An implementation MUST serialize a JSON value to its canonical string as follows, recursively.

- A **null** value MUST serialize as the three characters `null`. (An `undefined` value, which
  arises only as an object member value and is dropped by §3.3, is treated as absent, not as
  `null`.)
- A **boolean** MUST serialize as `true` or `false`.
- A **number** MUST be finite; a non-finite number (NaN, +Infinity, -Infinity) MUST cause
  canonicalization to fail (result token `non-finite-number`, Appendix B
  `canon/nonfinite-number-must-fail`). A finite number MUST serialize using the ECMAScript
  `Number.prototype.toString` / `JSON.stringify` algorithm — the shortest decimal string that
  round-trips to the same IEEE-754 double (§3.2). A numeric value that does not round-trip
  (a value that cannot be recovered exactly from its shortest decimal form) is non-conforming.
- A **string** MUST serialize with JSON string escaping per [RFC8785] §3.2.2.2: wrapped in
  double quotes; the characters `"` and `\` and the control characters U+0000–U+001F escaped
  (using the short forms `\b \t \n \f \r \" \\` where defined, otherwise `\uXXXX` with
  lowercase hex); the solidus `/` NOT escaped; all other characters, including non-ASCII,
  emitted literally as UTF-8.
- An **array** MUST serialize as `[`, the canonical strings of its elements in array order
  joined by a single `,`, then `]`. Array element order is preserved; it is NOT sorted.
- An **object** MUST serialize as `{`, then for each member — taken in ascending order of key
  (§3.3) and excluding members whose value is `undefined` — the JSON-escaped key, a single
  `:`, and the canonical string of the value, members joined by a single `,`, then `}`.

No insignificant whitespace is emitted anywhere.

### 3.2. Number serialization (interoperability caveat)

The number rule binds the canonical form to the ECMAScript numeric-formatting algorithm.
Concretely: `1.0` serializes as `1`; `10` as `10`; `1e21` as `1e+21`; `-0` as `0`. A
non-JavaScript implementation MUST reproduce this exact formatting — the shortest
round-tripping decimal, with ECMAScript's exponent thresholds and its `e+`/`e-` exponent
syntax — or it will diverge on any non-integer or large-magnitude number and its signatures
will not verify. This coupling to a language-specific number-to-string algorithm is a known
interoperability hazard; implementers SHOULD restrict signable numeric content to integers and
small-scale decimals whose formatting is unambiguous, and SHOULD rely on the number vectors
(Appendix B, `canon/number-and-nested-sort`) rather than on prose.

### 3.3. Key ordering and the input domain

Object member keys MUST be ordered ascending by UTF-16 code unit — the ordering produced by
the default ECMAScript string comparison and mandated by [RFC8785]. The empty-string key, if
present, sorts first. This ordering is applied at every level of nesting. Because the
field-ID re-keying (§4.4) turns the top-level keys into decimal *strings*, this same UTF-16
rule sorts them lexically, so `"10"` sorts **before** `"2"` (Appendix B, `canon/unsigned-minimal`).

The canonicalizer's input domain is plain-JSON values: null, booleans, finite numbers, strings,
arrays, and plain objects. A value of an unsupported type (function, symbol, bigint) MUST
cause canonicalization to fail.

**Non-plain objects (D5) — MUST reject.** An implementation MUST canonicalize only plain-JSON
values. A non-plain object — a `Date`, `Map`, `Set`, or any host object carrying no own
enumerable string keys — MUST cause canonicalization to fail; it MUST NOT be coerced to `{}`.
The reference formerly treated any value of JavaScript type `object` as a plain map, so a
`Date` canonicalized to `{}` while the same `Date` on the wire (via `JSON.stringify`, honouring
`toJSON`) serialized to a string, silently diverging the signer's bytes from the wire bytes.
That is a defect of input-domain handling; passing a non-plain object to the signable projection
is a caller error and the canonicalizer MUST fail rather than mask it. This is a
programmatic-misuse guard that cannot arise from parsed JSON (a `Date`/`Map`/`Set` is not
expressible as JSON input), so it is prose-normative and carries no JSON vector (§3.4, §11).

### 3.4. Parse model and I-JSON constraints (D2)

Canonicalization operates on a value obtained by **parsing then re-canonicalizing**: an
implementation MUST NOT canonicalize over the raw wire text, and MUST NOT rely on any content
that a conforming parse would have shadowed or discarded. The parse MUST satisfy the I-JSON
[RFC7493] constraints as they bear on the signed bytes:

- **Duplicate object keys MUST be rejected where detectable** (result token `duplicate-key`,
  Appendix B `canon/duplicate-key-rejected`). Silently taking the last (or first) value of a
  repeated key is non-conforming: it would let an adversary present one value to a lenient
  reader and a different value to a strict one over the same bytes. A permissive `JSON.parse`
  that collapses a duplicate before the canonicalizer sees it does not satisfy this rule; the
  detection MUST happen at or before the parse boundary.
- **Non-finite and non-round-tripping numbers are non-conforming** (§3.1). A syntactically valid
  JSON token such as `1e400` parses to a non-finite double; the operation MUST fail with
  `non-finite-number` (Appendix B `canon/nonfinite-number-must-fail`).

These two vectors take **raw JSON text** as input precisely so that the parse step (which a
lenient `JSON.parse` would erase) is exercised.

---

## 4. The Signable Projection and the Field-ID Registry

### 4.1. The signable field set and its permanent field-ids

Before canonicalization, an implementation MUST reduce the envelope to the sub-object
containing exactly those top-level keys that are BOTH present in the envelope AND members of
the signable field set below. Every other top-level key MUST be excluded — including the
mutable carve-out (§4.2) and any field not enumerated here. A key that is absent from the
envelope contributes nothing (it is simply not present in the projection); this is what lets
an envelope that omits an optional signable field verify against a signature produced before
that field existed.

The signable field set, and the **permanent field-id** each member is addressed by in the
canonical form (§4.4), is:

| id | field | id | field |
|----|-------|----|-------|
| 1 | `id` | 8 | `requirements` |
| 2 | `source` | 9 | `sovereignty_required` |
| 3 | `type` | 10 | `deadline` |
| 4 | `timestamp` | 11 | `distribution_mode` |
| 5 | `sovereignty` | 12 | `target_assistant` |
| 6 | `payload` | 13 | `originator` |
| 7 | `signed_by` | 14 | `spec_version` |

**Ownership (D3).** RFC-0004 OWNS the *membership* of this set and the field-id assignments —
ownership sits where the cryptographic consequences of a change are analysed. RFC-0003's field
inventory CARRIES the id↔name mapping alongside each field's definition; this document is the
authority for which ids exist and what they mean. The two documents cite one another; neither
duplicates the other's table.

What is normative is **membership and id**: a field in this set is signed when present, keyed by
its id; a field not in this set is never signed. The table's row order is documentary only —
§3.3 sorts the decimal-string keys, so `"10"` precedes `"2"` in the bytes regardless of how the
table is laid out.

Semantics of the non-obvious members:

- `signed_by` (id 7) is itself signable; §5.4 governs exactly which bytes of it enter which
  stamp's signature.
- `requirements`, `sovereignty_required`, `deadline`, `distribution_mode`, `target_assistant`
  (ids 8–12) are the F-021 task-routing fields: signed so that a tampered requirement, target,
  deadline, or mode invalidates the chain. `target_assistant` is the canonical name; the removed
  `target_principal` key (R13 breaking cut) is NOT a member and MUST NOT be signed — a stray
  `target_principal` is an unknown field rejected by envelope validation before it could enter
  the projection.
- `originator` (id 13) is the policy-attribution claim (myelin#160); the signer commits to it.
- `spec_version` (id 14) is the wire-grammar version (RFC-0003). It is signed so it cannot be
  downgraded in transit. Because it is absent from pre-`spec_version` envelopes, its absence
  keeps their canonical bytes — and therefore their old signatures — unchanged.

### 4.1.1. The allocation rule (permanent)

The field-id registry is permanent and append-only:

- **(a)** ids are assigned as consecutive positive integers starting at 1;
- **(b)** an id is NEVER reused and NEVER reassigned;
- **(c)** **renaming** a field KEEPS its id — this is the point of the indirection: a rename is
  invisible to the signed bytes, so it is no longer a cryptographic break;
- **(d)** **adding** a signable field takes the next unused id and is **integrity-by-default**
  (D4): a new field is signed unless it is explicitly placed in the §4.2 carve-out;
- **(e)** **removing** a field TOMBSTONES its id forever (the id is never re-allocated).

Any change to this registry — adding, tombstoning, or re-scoping a member — is a wire-encoding
change and MUST follow the change-control procedure (§8, §11, BCP-0001). A **rename alone is
not** a wire-encoding change, because it does not alter any signed byte; it is a documentation
change to the id↔name table (RFC-0003). This is the concrete payoff of D1.

### 4.2. The mutable carve-out

Exactly three fields are, by design, excluded from every signature and carry **no field-id**:

```
correlation_id
economics
extensions
```

An implementation MUST NOT include these in the signable projection and MUST NOT assign them a
field-id. The exclusion is deliberate: relays and hubs MUST be able to thread a `correlation_id`
after the fact, aggregate cost into `economics` as work fans out, and annotate `extensions` with
routing or trace metadata, all without invalidating any stamp in the chain. This is the single
bounded exception to integrity-by-default (D4): everything else the envelope carries is signed.

The direct consequence, which an implementation MUST honour, is that **no party signs what it
writes into these three fields.** A consumer MUST NOT make any trust, security, authorization,
or routing-integrity decision on the contents of `correlation_id`, `economics`, or
`extensions`. When a relay needs to bind an annotation cryptographically, the correct action
is to append a stamp (§5), not to rely on a carve-out field. §9 records the residual risks
(unbounded unauthenticated channels; reply-correlation on an unsigned field).

### 4.3. `signed_by` shape normalization

On the wire `signed_by` (field-id 7) MAY appear as a single stamp object (a legacy input shim)
or as an array of stamps. For all purposes of this document — canonicalization, signing, and
verification — an implementation MUST first normalize `signed_by` to array form: a single
object becomes a one-element array; an absent, `null`, or non-array-non-object `signed_by`
normalizes to the **empty array** and denotes an unsigned envelope (§5.3). A shim that returns a
one-element chain wrapping a `null` or primitive value is non-conforming (Appendix B
`canon/shim-null-signed-by-is-empty`; §9 cross-repo drift).

The canonical bytes MUST always serialize `signed_by` in **array** form under field-id 7, even
when the wire carried the single-object shape. That is: an envelope received with
`"signed_by":{...}` and the same envelope received with `"signed_by":[{...}]` MUST produce
byte-identical canonical output (Appendix B, `canon/single-object-normalizes-to-array`). An
implementation that canonicalizes the single-object shape literally is non-conforming.

### 4.4. The canonical (field-ID-keyed) form

After the projection (§4.1) and `signed_by` normalization (§4.3), an implementation MUST form
the canonical value by **re-keying the top-level members from their field names to the decimal
string of their field-id**, then canonicalizing that value per §3. Only the fourteen top-level
signable names are re-keyed; **nested** content — inside `payload`, `sovereignty`, a stamp
object, or any deeper value — keeps its own string keys unchanged and is canonicalized as-is
(Appendix B, `canon/number-and-nested-sort`).

Worked reference (Appendix B, `canon/unsigned-minimal`): an envelope carrying `id`, `source`,
`type`, `timestamp`, `sovereignty`, `payload` re-keys to top-level keys `"1"`,`"2"`,`"3"`,`"4"`,
`"5"`,`"6"` and canonicalizes to

```
{"1":"550e8400-e29b-41d4-a716-446655440000","2":"andreas.meta-factory.local","3":"review.completed","4":"2026-05-07T12:00:00Z","5":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"6":{"pr":42,"verdict":"approved"}}
```

A rename of any of `id`,`source`,`type`,… cannot change these bytes, because the bytes key on
the id, not the name. That is the whole point of the indirection (D1).

---

## 5. The Stamp and the Chain

### 5.1. Stamp object

A stamp is a JSON object. Its structural shape is owned by RFC-0003
(`schemas/envelope.schema.json` `$defs/signedByStamp`); this section specifies the semantics
of its fields and the syntax of its value-carrying fields (Appendix A).

Every stamp MUST carry:

- `method` — one of `ed25519` or `hub-stamp` (`signing-method`, Appendix A). No other value
  is valid (result token `unknown-signing-method`).
- `identity` — the DID of the identity the stamp attests for, matching `did` (RFC-0001). Per
  the two-plane taxonomy of RFC-0001 §2.1 — owned there, cited here — a stamp identity MUST be
  a **keyed-plane** DID (class `principal`, `stack`, `agent`, or `hub`; e.g.
  `did:mf:stack.andreas.meta-factory`, `did:mf:agent.andreas.meta-factory.echo`); a
  **self-asserted** DID (class `surface` or `system`) holds no key, MUST NOT appear anywhere in
  `signed_by`, and a verifier MUST NOT resolve a self-asserted DID in the keyed registry
  (RFC-0001 §2.1). The deprecated `principal` key was removed from the wire (R2 breaking cut,
  myelin#182); a stamp carrying `principal` MUST be rejected (result token `legacy-principal-key`).
- `signature` — the canonical base64 signature (`signature`, Appendix A; §6.2).
- `at` — the attestation timestamp (`at`, Appendix A; §7.4).

A stamp MAY carry:

- `role` — a `stamp-role` (Appendix A). OPTIONAL for back-compatibility; a stamp without a
  role is valid.

A `hub-stamp` stamp MUST additionally carry:

- `stamped_by` — the DID of the hub that produced the signature, matching `did` (RFC-0001); a
  keyed-plane DID of class `hub` (e.g. `did:mf:hub.testnet`). The two-plane restriction on
  `identity` above applies to `stamped_by` identically.

A stamp MUST NOT carry any other member (`additionalProperties: false` in the schema).

### 5.2. Stamp role

`role` is a semantic label describing what a stamp ATTESTS, not what the identity IS. The
value set is closed (`stamp-role`): `origin`, `transit`, `accountability`, `sovereignty`,
`notary`. A role is self-asserted by its own stamper; this document defines no positional,
uniqueness, ordering, or authorization constraint on roles. Authority is anchored on the
**origin stamp `s[0]`** (§5.5, D11), never on a self-claimed role: a `role` value MUST NOT
drive an authorization decision. §9 records the security consequence.

### 5.3. Chain order and bounds

The chain is ordered: the origin stamps first, and each subsequent relay/hub/policy-enforcer
APPENDS its stamp at the end. The most recent attestor is the last element.

A signed envelope MUST carry a chain of at least one stamp. An envelope with no `signed_by`,
or with an empty array, is **unsigned** (result token `chain-empty`); it carries no verifiable
identity and MUST NOT be treated as trusted. Whether an unsigned envelope is *admissible* is a
conformance-class decision (§7.6): the *enforcing* class MUST reject it.

**Chain-length bound (D6).** A chain MUST NOT exceed **16** stamps (`MAX_CHAIN_LENGTH`;
`schema maxItems: 16`). A signer MUST refuse to append a stamp to a chain already at 16. A
verifier MUST fail cleanly on a chain longer than 16 (result token `chain-too-long`) and MAY
reject it before performing any signature work (§7.1 cheap-reject, D19; Appendix B
`verify/chain-too-long-rejected`). A successor RFC MAY harden the verifier's MAY-reject to a
MUST-reject beyond the floor; the floor is a MUST-fail-cleanly today.

### 5.4. Chain-commit and chain-slice (the bytes-to-sign for stamp *i*)

This is the load-bearing rule of the whole document.

Let the normalized chain be `s[0], s[1], …, s[n-1]`.

**Signing stamp *i* (append at position `i = n`):** the canonical bytes are formed (§4.4) from
the signable projection (§4) in which `signed_by` (field-id 7) is set to
`[ s[0], …, s[i-1], d ]`, where `s[0..i-1]` are the existing stamps **with their `signature`
members intact** and `d` is the new stamp being produced **without a `signature` member** (a
stamp cannot sign its own signature). The bytes-to-sign are then `CONTEXT_TAG` followed by the
UTF-8 encoding of that canonical string (§6.1). Because `s[0..i-1]` carry their signatures
inside stamp *i*'s signed bytes, stamp *i* cryptographically commits to the entire prior chain
(chain-commit; Appendix B, `canon/stamp1-commits-to-stamp0`).

**Verifying stamp *i*:** the bytes stamp *i* signed are `CONTEXT_TAG` followed by the UTF-8
encoding of the canonical string of the signable projection in which `signed_by` is set to the
slice `[ s[0], …, s[i] ]` with `s[i]`'s `signature` member **stripped** and `s[0..i-1]`'s
`signature` members **intact**. Stamps at positions `> i` are NOT included. A verifier MUST
reconstruct exactly these bytes for each stamp (Appendix B, `canon/stamp0-signing-bytes`,
`canon/stamp1-commits-to-stamp0`, `canon/bytes-to-sign-domain-separated`).

Consequences an implementation MUST preserve: stripping happens on exactly one stamp — the one
being signed or verified; every earlier stamp keeps its signature verbatim, byte for byte;
tampering with any field of any earlier stamp (identity, at, role, method, or signature)
invalidates every later stamp (Appendix B, `verify/tampered-stamp0-role-rejected`).

### 5.5. Chain authority semantics (D11–D16)

The chain is verified as authentication for each hop, but attribution and authorization derive
from specific positions. The following are normative.

- **Origin is the authority anchor (D11).** `s[0]` is the origin stamp; it is the anchor for
  **attribution and authorization**. It is truncation-safe: an adversary cannot strip earlier
  stamps to change the origin, because the origin is the lowest-index stamp and every later
  stamp commits to it (§5.4). A consumer MUST anchor an authorization decision on the verified
  origin `s[0]` (and, for an agent-class `originator`, on the RFC-0001 §2.2 prefix binding,
  §7.1), never on the most recent hop.
- **The last hop authenticates only (D11).** `s[n-1]` is the current hop; it establishes who
  most recently handled the envelope and is used for AUTHENTICATION ONLY. A verifier/consumer
  MUST NOT drive an authorization decision from `s[n-1]`. (The live sovereignty ingress gate
  authorizes on `s[n-1]` today; re-anchoring its **AUTHORITY** decision — actor scope and the
  capability ceiling — to `s[0]` is a flag-day-R code follow-up, §9 F-5. The gate's **LINK**
  decision — the federation-partner check and the `imported_principals` delivery test of
  RFC-0005 §6.1 — legitimately keys on `s[n-1]` and is NOT what F-5 moves; see the two-question
  split below.)
- **Trailing stamps are strippable (D12).** Because a chain APPENDS, a trailing stamp can be
  removed by any party and the truncated chain still verifies (each remaining stamp's bytes are
  unchanged). A consumer that relies on the *presence* of a trailing attestation MUST verify
  that attestation is present rather than assume it; absence is not detectable from the bytes
  alone. This residual is recorded for the H4-successor RFC.
- **Append is attestation, not endorsement (D13).** Appending a stamp attests "I, this
  identity, handled this envelope at this time"; in v1 it does NOT assert that the appender
  endorses, approves, or vouches for the content or for earlier hops. A consumer MUST NOT read a
  later stamp as an endorsement of an earlier one. A v2 endorsement semantics is a forward
  pointer, not part of this document.
- **Hub-stamp mechanics are pinned; scope is open (D14).** The `hub-stamp` verification
  mechanics are normative (§7.3). **Which identities a trusted hub MAY vouch for** (the
  vouching-authority scope) is a **retained open decision** (§9), blocked on cortex Phase D:
  until it closes, a trusted hub is omnipotent within its trusting registry, and hub-trust
  grants MUST be treated accordingly.
- **Trust-vs-bytes split (D15).** Two independent checks run per stamp: the **bytes** check
  (does the signature verify over the reconstructed bytes, §5.4/§7.2) and the **trust** check
  (does the identity resolve, and — for a hub-stamp — is the hub trusted, §7.3). A verifier MAY
  short-circuit the **trust** check for the receiving stack's OWN DID (it already trusts itself),
  but it MUST NEVER short-circuit the **bytes** check. Self-trust never means self-verify.
- **Stackless chain fails closed (D16).** An envelope that names an agent-class `originator`
  whose `{principal-id}.{stack-slug}` prefix binding (RFC-0001 §2.2) cannot be established
  against the verified chain — because the chain carries no stack stamp to bind to — MUST be
  REJECTED (result token `chain-stack-binding-unresolved`; Appendix B
  `verify/stackless-chain-fail-closed`). It MUST NOT be admitted. When `originator` is absent
  the binding is vacuous and this rule does not fire. Extraction, ordering, and precedence follow
  RFC-0001's lowest-index (truncation-safe) anchor.

**The two-question split — AUTHORITY anchors here, LINK anchors in RFC-0005 (D0).** §5.5 governs
one question only: **AUTHORITY** — "whose work is this," i.e. actor scope, attribution, and the
capability ceiling — which anchors on the origin `s[0]` (D11), truncation-safe per D12 and, for an
agent-class `originator`, on the §7.1 prefix binding. It does **not** govern the distinct **LINK**
question — "who delivered this crossing into my boundary," i.e. the federation-partner check and
the `imported_principals` delivery-membership test — which legitimately keys on the last stamp
`s[n-1]` and is owned by RFC-0005 §6.1. The two are not in tension and do not race: the last hop
authenticates the delivering principal (LINK), the origin authorizes the work (AUTHORITY), and a
consumer answers each from its own anchor — neither anchor answers the other's question. This is
the resolution of the standing RFC-0004↔RFC-0005 anchor contradiction recorded as audit D1
(`SERIES-COMPLETION-AUDIT.md`; myelin#257).

---

## 6. Signing

### 6.1. Producing the bytes-to-sign

To sign, an implementation MUST: (1) verify the signing identity DID matches `did` (RFC-0001)
and the private key is a 32-byte Ed25519 seed; (2) refuse if the prior chain is already at
`MAX_CHAIN_LENGTH` (§5.3); (3) construct the stamp draft with `method`, `identity`, `at`
(current time, ISO-8601), and OPTIONAL `role`, and no `signature`; (4) form the signable
projection with `signed_by` prepared per §5.4 for the appended stamp; (5) re-key to field-ids
and canonicalize (§3, §4.4); (6) prepend `CONTEXT_TAG` to the UTF-8 encoding to form the
bytes-to-sign.

**Domain separation (D9).** The bytes-to-sign are `CONTEXT_TAG || UTF-8(canonical)`, where

```
CONTEXT_TAG = UTF-8("metafactory-envelope-signature-v1") || 0x00
```

— the UTF-8 octets of the ASCII string `metafactory-envelope-signature-v1` followed by a single
`0x00` separator. Because canonical JSON text never contains an unescaped NUL, the boundary
between the tag and the canonical bytes is unambiguous. Prepending the tag makes a
metafactory-envelope signature structurally unusable in any other Ed25519 protocol and kills the
cross-protocol NKey-reuse class (§9). An implementation MUST sign and verify over the tagged
bytes; a signature computed over the bare canonical bytes (what a foreign protocol or a raw-JCS
signer would emit) MUST fail (Appendix B, `canon/bytes-to-sign-domain-separated`,
`verify/domain-sep-cross-protocol-rejected`).

### 6.2. Ed25519 and the canonical signature encoding

An implementation MUST sign the bytes-to-sign with Ed25519 [RFC8032] (PureEdDSA) under the
identity's 32-byte seed, producing a 64-byte signature. Ed25519 signing is deterministic: the
same bytes and key always yield the same signature (this is what makes the Appendix B vectors
reproducible).

**Canonical signature encoding (D7).** The signature MUST be encoded with **standard** base64
[RFC4648 §4] — the `A–Z a–z 0–9 + /` alphabet with `=` padding, NOT the URL-safe alphabet — in
its **canonical, exactly-88-character** form. A 64-byte signature is 85 free base64 characters,
one final-quantum character carrying 2 significant + 4 zero bits (drawn from the 4-element set
`{A, Q, g, w}`), and `==` padding (`signature`, Appendix A). Both emit AND verify MUST enforce
this exact form at flag-day R. The former deployed accept-grammar (`/^[A-Za-z0-9+/]+=*$/` plus
`minLength: 88`) is RETIRED: it admitted the four trailing-bit variants of the final quantum
(all decode to the same 64 bytes — a malleability) and unbounded length. Anything not exactly-88
canonical MUST be rejected (result token `signature-wrong-length`; Appendix B
`stamp/signature-wrong-length`). This closes the last-stamp signature-malleability finding (§9).

### 6.3. Public-key interchange encoding (D10)

The **wire carries no key**: a stamp names only `identity`, and a verifier resolves the key from
the off-wire registry (§8). The normative crypto-core interchange encoding for a 32-byte Ed25519
public key is **base64-raw**: 42 free base64 characters, one final-quantum character carrying 4
significant + 2 zero bits (drawn from the 16-element set
`{A,E,I,M,Q,U,Y,c,g,k,o,s,w,0,4,8}`), and a single `=` pad — 44 characters total (`public-key`,
Appendix A). The registry and every key-interchange boundary carry a public key in this form. A
local NKey base32 form is a valid representation but MUST bridge to base64-raw at the boundary.

---

## 7. Verification

`verifyEnvelopeIdentity(envelope, registry, options)` walks the chain and returns `verified`
(every stamp valid), or `rejected` with a stable reason token (§11) naming the first failing
stamp.

### 7.1. Per-stamp procedure

Cheap checks precede expensive ones: an implementation MUST hold every rule below, and SHOULD
evaluate the cheap tier (structure, length, registry membership, chain bound) before the
expensive tier (canonicalization and the Ed25519 equation) per stamp (D19). This is not a rigid
total order; it is a cost ordering, and negative vectors carry exactly one defect each.

Before walking the chain, a verifier MUST reject a chain that is empty (`chain-empty`, §5.3
under the enforcing class) or longer than `MAX_CHAIN_LENGTH` (`chain-too-long`, §5.3).

For each stamp `s[i]` in chain order, a verifier MUST, in order:

1. Read the attesting DID from `s[i].identity`; if absent (or if a `principal` key is present),
   reject (`legacy-principal-key` / structural).
2. Resolve `s[i].identity` in the registry (§8); if unknown, reject (`unknown-principal`).
3. Read `s[i].at`; if it is not a syntactically valid ISO-8601 timestamp (Appendix A `at`) and
   parseable to a finite instant, reject (`at-not-iso8601`).
4. **At the trust boundary only**, apply the freshness rule (§7.4); if outside tolerance, reject
   (`at-outside-freshness`). On a re-verification (not at a trust boundary) this step MUST be
   skipped (D17).
5. Dispatch on `s[i].method`: `ed25519` → §7.2; `hub-stamp` → §7.3; any other value →
   reject (`unknown-signing-method`).

The chain is `verified` iff every stamp is valid. On success the verifier returns the LAST
verified identity as the convenience principal (the most recent attestor); a per-stamp verdict
list MUST also be available so a caller can see which hop failed, and the origin `s[0]` MUST be
available as the authority anchor (§5.5). On the first failing stamp the verifier MUST reject and
MUST NOT continue.

> **Composition with the agent prefix binding (RFC-0001 §2.2).** RFC-0001 defines one
> verify-time invariant that this section's chain verification composes with: an `agent`-class
> `originator`'s `{principal-id}.{stack-slug}` prefix MUST equal the method-specific-id tail of
> the **innermost signing stack**, checked against the verified `signed_by` chain — never
> against the originator's self-description. That check is owned by RFC-0001 (vectors
> `bind/agent-prefix-accept`, `bind/agent-prefix-reject`); its fail-closed disposition when the
> chain carries no stack to bind to is D16 (§5.5, `chain-stack-binding-unresolved`). It is the
> one normative binding between a self-asserted attribution field and the verified chain
> (contrast `source`, §9).

> **Composition with the non-agent originator binding (RFC-0003 §3.17, myelin#251).** A second
> verify-time invariant composes with the chain walk — the split-plane sibling of the agent binding
> above, for the non-agent originator classes that carry a principal. A **`principal`- or
> `stack`-class** `originator.identity` MUST have its **principal component** (msi segment 1)
> reconcile with the principal component of the innermost signing identity `s[0].identity`, checked
> against the verified chain, **never** against the originator's self-description. A mismatch is a
> reject, result token `originator-principal-binding-violation` (§11.3). The anchor is the
> truncation-safe origin `s[0]` (§5.5 D11–D12), so an appended (federated-forward) transit or hub
> stamp cannot re-key the check off `s[n-1]`; under a `hub-stamp` origin the principal is read from
> `s[0].identity` (the vouched entity), not `stamped_by`, its strength bounded by the open
> hub-vouching scope (§5.5 D14); a `hub`-class innermost signer exposes no principal component and
> fails closed with `originator-principal-binding-violation` (the D16 fail-closed family; vector
> `.../originator-hub-class-signer-fail-closed`). `surface`-, `system`-, and `hub`-class originators carry no
> principal component and are unconstrained by this reconciliation **by construction** — their
> compensating actor-authority cap is RFC-0003 §7. Vectors
> `envelope-signing/verify/originator-principal-reconcile-ok`,
> `.../originator-stack-reconcile-ok`, `.../originator-surface-self-asserted-ok`,
> `.../originator-hub-stamp-anchor-ok`, `.../originator-federated-forward-s0-anchor-ok`, and their
> reject counterparts (`.../originator-cross-principal-rejected`,
> `.../originator-stack-cross-principal-rejected`,
> `.../originator-federated-forward-s0-anchor-rejected`).

### 7.2. Method `ed25519` — the verification equation (D8)

The verifier MUST: decode `s[i].signature` from canonical base64 (§6.2) and reject unless it is
exactly 64 bytes; resolve the identity's `public_key` from the registry and reject unless it is
exactly 32 bytes; reconstruct the tagged bytes stamp *i* signed per §5.4/§6.1; and verify the
Ed25519 signature over those bytes under the identity's public key using the **strictest,
fully-pinned** equation below.

The equation is the intersection where every conforming library agrees (noble, libsodium, and
Go's `crypto/ed25519` diverge outside it — the interoperability trap this pinning exists to
close). A conforming verifier MUST:

- use **PureEdDSA** [RFC8032] (Ed25519, not Ed25519ph or Ed25519ctx);
- verify **cofactorless** — check `[S]B = R + [k]A`, NOT the cofactored `[8S]B = [8]R + [8k]A`;
- **reject a small-order point** on BOTH the public key `A` and the signature component `R`
  (result tokens `small-order-key`, `small-order-point`; Appendix B
  `verify/small-order-key-rejected`, `verify/small-order-point-R-rejected`) — note a small-order
  `R` may be canonically encoded (`y < p`), so a bare canonicity check does not catch it; an
  explicit order check is REQUIRED;
- **reject a non-canonical point encoding** (`y`-coordinate `≥ p`) on `A` and `R` (result token
  `non-canonical-point`; Appendix B `verify/non-canonical-point-R-rejected`);
- **reject a non-canonical scalar** `S ≥ L`, where `L` is the group order — the RFC 8032 §5.1.7
  `S < L` check that closes signature malleability (result token `non-canonical-scalar`;
  Appendix B `verify/non-canonical-scalar-S-rejected`).

Any verification failure MUST reject (`stamp-signature-invalid`). myelin adds these checks to its
noble `verifyAsync` sites at flag-day R; the edge-case vectors pin each rule so an independent
implementation can confirm it enforces the same intersection.

### 7.3. Method `hub-stamp` and hub-trust resolution

For a `hub-stamp`, the identity in `identity` is the entity vouched FOR; the signature is
produced by the hub named in `stamped_by`. The verifier MUST: resolve `stamped_by` in the set
of **trusted hubs** (§8) and reject unless present (`untrusted-hub`; Appendix B
`verify/untrusted-hub-rejected`); decode the signature (exactly 64 bytes, §6.2) and the hub's
`public_key` (exactly 32 bytes); reconstruct the §5.4/§6.1 tagged bytes; and verify the signature
under the **hub's** public key using the §7.2 equation. The vouched identity MUST still resolve
in the registry (step 7.1.2). Mechanics are pinned by Appendix B `verify/hub-stamp-ok`.

> **Retained open decision — hub vouching-authority scope (D14).** The hub-stamp **mechanics**
> above are normative. Two scope questions remain **[OPEN DECISION — Andreas + JC — blocked on
> cortex Phase D federation hub trust]** and are NOT resolved here: (a) **which** registry's
> trusted-hub set governs a *federated* (cross-principal) envelope — trust is file-local, and a
> hub trusted by the receiver need not be trusted by the originator; (b) **which identities** a
> trusted hub MAY vouch for — nothing binds a hub-stamp's `stamped_by` to its `identity`, so any
> trusted hub may stamp for any registered identity. Until this closes, a trusted hub is
> omnipotent within its trusting registry (§5.5 D14). Separately, the cortex consumer's
> structural verifier historically **skipped** hub-stamps (surfacing them as `skipped`, deferred
> to its Phase D); the layered conformance rule (§11, D32) requires cortex to run the hub-stamp
> vectors against its own walker precisely to surface that divergence.

### 7.4. Freshness (admission-only) and replay

**Freshness is an admission-only control (D17).** The freshness window bounds `abs(now − at)` and
is checked **exactly once**, at the trust boundary — the first cross-boundary receipt (for a
JetStream stream, at stream entry, not at each consumer read). A verifier MUST reject a stamp at
admission whose `at` differs from the verifier's current clock by more than the tolerance:
`abs(now − at) > windowMs` rejects (result token `at-outside-freshness`; Appendix B
`verify/stale-admission-rejected`). The default tolerance is **±5 minutes**
(`DEFAULT_CLOCK_SKEW_MS = 300000 ms`); it MAY be overridden by the caller.

Re-verifying a stored or replayed envelope MUST NOT re-apply the window (Appendix B
`verify/stale-reverify-ok`): the signature over a six-month-old archived envelope is still
valid, so it re-verifies; only admission is time-bounded. This is what lets archive replay and
freshness coexist and resolves the freshness-vs-replay contradiction the audit surfaced. (The
live verifier re-checks freshness on every call; separating admit-time from re-verify is a
flag-day-R code follow-up, §9.)

**The `at` timestamp is the sole freshness anchor (D20).** No other field participates in the
freshness decision. Chain monotonicity (each hop's `at` being ≥ the previous hop's) is a SHOULD
(§7.5), promotable to a MUST only on a zero-violation fleet audit; the anchor is meaningful only
with respect to admission (D17).

**Replay (D18).** A consumer SHOULD guard against replay in general and MUST guard against replay
for **task-dispatch admission**, where a duplicate is a double-execution. This document owns the
**replay-vs-redelivery vocabulary** and the consumer obligation; RFC-0007 owns the transport
mechanism (`Nats-Msg-Id`, the JetStream `duplicate_window`). There is **no nonce in the signed
bytes in v1**: because the signable content carries no nonce and no subject binding, a stamp that
verifies on one subject verifies on any subject, and cross-subject anti-replay, if required, MUST
be enforced by the consumer (§9).

### 7.5. Chain-shape predicates

A verifier MAY expose predicates over a *verified* chain — minimum length, "must include a
stamp of role X", "must include an identity of type Y", "must include identity D", chain
`at`-monotonicity. These compose with AND semantics and are evaluated only after cryptographic
verification succeeds. Because a role is self-asserted (§5.2, §9) and authority anchors on the
origin (§5.5, D11), a predicate such as "must include role `accountability`" is satisfied by any
hop's self-claim and MUST NOT be read as a proof of authority.

### 7.6. Verifier conformance classes and monotone rejection (D21, D22)

This document defines abstract verifier **conformance classes**; deployment postures map onto
them (§7.8). A class claim covers **every** envelope the implementation admits — an
implementation cannot claim a class for one code path and silently apply a weaker rule on
another. A verifier that bypasses verification when the trusted set is empty (trust-empty
bypass) does not conform and is recorded as a FINDING (§9).

- The **enforcing** class MUST reject an unsigned envelope (`chain-empty`), MUST reject an
  invalid signature or a broken chain, and MUST resolve every stamp identity (and hub) in the
  registry.
- Classes differ ONLY on whether an **unsigned** envelope is admissible. They do NOT differ on
  signed traffic.

**Monotone rejection (D22).** A NON-EMPTY `signed_by` that fails SIGNATURE or CHAIN verification
MUST reject at **every** class — there is no posture under which a present-but-invalid signature
is admissible. This scopes to the signature and chain checks ONLY; it MUST NOT sweep in the §7.4
freshness rule, which is admission-only (D17) and is therefore not part of the monotone-reject
guarantee.

### 7.7. Emitter obligations (D23)

An emitter of **boundary-scope** (cross-principal / federated) traffic MUST sign what it emits.
Silently falling back to emitting an unsigned envelope on boundary traffic is a **fail-open**
condition and is recorded as a FINDING (§9): a verifier downstream cannot distinguish a
never-signed envelope from a stripped one.

> **Retained open decision — local-scope unsigned-fallback blessing (D23).** Whether an emitter
> of **local-scope** (non-federated) traffic MAY be blessed to fall back to unsigned is **[OPEN
> DECISION — Andreas + JC]**. Only the boundary-scope MUST above is ratified.

### 7.8. Federation verification floor (D24) and the announced-key rule (D25)

**Enforce floor on all federated traffic (D24).** Cross-principal (federated) traffic ALWAYS
receives *enforcing*-class verification regardless of the local deployment posture:
**reject-unsigned + reject-invalid + resolve-peer-key**. The posture ladder governs `local.*`
traffic ONLY; it cannot relax federated verification. Registry reachability (resolving the peer's
key) is a **correctness precondition** on this path, not an optimization (Appendix B
`verify/federated-unsigned-rejected`). This is a behaviour change, not merely codified deployed
behaviour: making the live permissive stacks fully fail-closed on federated traffic is a
flag-day-R code follow-up (§9).

**Announced / presence key confers nothing (D25).** A public key learned from an announced or
presence signal (as opposed to the trust anchor of §8) confers NO verification authority: it MUST
NOT be used to admit or trust an envelope. A verifier MUST resolve keys from the registry trust
anchor, never from presence.

> **Retained open decision — re-sign-on-ingest promotion (D25 tail).** Whether to promote
> re-sign-on-ingest to a named wire concept (as opposed to the gateway mechanics of §7.9) is
> **[OPEN DECISION — Andreas + JC]**.

### 7.9. Gateway stamp-before-admit (D26)

Under the *enforcing* class, when a gateway admits an unsigned first hop from a non-native
surface, the bound stack MUST re-sign that first hop **before** the chain gate evaluates it, and
MUST drop the envelope on a signing failure (stamp-before-admit). The re-sign step MUST be
ordered ahead of the empty-chain gate, so that a to-be-re-signed envelope is not rejected as
`chain-empty` before it is signed. (The live dispatch path returns on the empty-chain gate before
the re-sign step; reordering the re-sign ahead of it is a flag-day-R code follow-up, §9.)

---

## 8. Registry Considerations

**RFC number.** `0004`, allocated in [`specs/README.md`](../README.md). Numbers are never
reused.

**External registries.** This document defines no DID method and registers nothing with the
W3C DID Specification Registries; the `did:mf` method is RFC-0001's concern. It reserves no
NATS subject, segment, or identifier prefix.

**Enumerations and registries this document governs.** Three closed value sets are normative
here and change only by a new RFC under change control (§11, BCP-0001):

- the **signing methods** `ed25519` and `hub-stamp` (§5.1);
- the **stamp roles** `origin`, `transit`, `accountability`, `sovereignty`, `notary` (§5.2);
- the **field-ID registry** (§4.1): the enumerated membership of the fourteen signable fields
  and their permanent numeric ids. This document OWNS membership and id assignment (D3); RFC-0003
  CARRIES the id↔name table alongside its field inventory. Adding or tombstoning a member is a
  wire-encoding change; a **rename is not**, because the signed bytes key on the id (§4.1.1).

**The identity registry** (the DID → public-key / type / trusted-hub mapping consumed by §7)
is an off-wire trust anchor, not part of this or any envelope. Its file shape and the
`did:mf` identity syntax are owned by RFC-0001; this document only requires that a verifier can
resolve a stamp's `identity` (and, for hub-stamps, `stamped_by`) to a 32-byte Ed25519 public
key encoded base64-raw (§6.3) and, for hubs, to trusted-hub membership. Only keyed-plane DIDs are
resolvable here; a self-asserted DID (`surface`, `system`) never appears in a stamp and MUST NOT
be resolved in the keyed registry (RFC-0001 §2.1, §5.1 above).

---

## 9. Security Considerations

This section is REQUIRED and is not empty. The threat model: an active network adversary who
can read, drop, reorder, replay, and inject envelopes on the bus, and who may control a relay
that legitimately appends stamps. The signing scheme defends the integrity and authenticity of
the signable content and the ordering of the chain; it does not defend confidentiality (the
envelope is plaintext) and, as recorded below, it leaves several properties to consumer policy
or to three retained open decisions.

### 9.1. Resolved by this revision

The following audit findings are RESOLVED by the ratified decisions and are no longer open:

- **Field-rename fragility → RESOLVED (D1).** The signed bytes key on permanent field-ids, not
  names (§4). A rename is no longer a cryptographic break; only add/tombstone is a wire-encoding
  change (§4.1.1).
- **Signature malleability → RESOLVED (D7).** The signature is the canonical exactly-88-character
  base64 form on both emit and verify (§6.2); the malleable final-quantum variants and unbounded
  length are rejected (`signature-wrong-length`). Envelope-level byte identity and dedup are
  restored.
- **No domain separation → RESOLVED (D9).** `CONTEXT_TAG` binds every signature to this protocol
  (§6.1), making a metafactory signature structurally unusable elsewhere and killing the
  cross-protocol NKey-reuse class.
- **Over-permissive verification equation → RESOLVED (D8).** The fully-pinned cofactorless
  PureEdDSA equation with small-order, non-canonical-point, and `S < L` checks (§7.2) closes the
  cross-library divergence.
- **Freshness-vs-replay contradiction → RESOLVED (D17).** Freshness is admission-only; re-verify
  never re-applies the window (§7.4). Archive replay and freshness coexist.
- **Verifier chain-length DoS → RESOLVED (D6) at the floor.** The verifier MUST fail cleanly on a
  chain longer than 16 and MAY cheap-reject it (§5.3, §7.1). Canonicalization depth/width is NOT
  pinned to a number — cortex caps it, myelin does not — so `canonicalization-depth` is a
  RESERVED result token with **no binding vector**; a successor RFC MAY pin a limit (§11, D31).
- **I-JSON / duplicate-key ambiguity → RESOLVED (D2).** Parse-then-re-canonicalize; reject
  duplicate keys where detectable; never rely on shadowed content (§3.4).
- **Non-plain-object coercion → RESOLVED (D5).** The canonicalizer MUST reject non-plain objects
  (§3.3).
- **Single-object `signed_by` ambiguity → RESOLVED.** The array form is always what is signed
  (§4.3).

### 9.2. Retained findings (held by consumer discipline, not by the format)

- **Self-asserted stamp role (`signing-canon/stamp-role-self-asserted`).** A role is signed only
  by its own stamper. Any verified signer may claim any role at any position. Authority anchors on
  the origin `s[0]` (§5.5, D11), never on a role; a policy that reads a role MUST additionally
  constrain WHICH identity asserted it. Role predicates (§7.5) prove self-assertion, not authority.
- **`source` is not bound to the chain.** The envelope `source` (RFC-0003) is self-asserted and
  is not a signable-chain-derived value; the only specified subject↔envelope consistency check is
  classification-prefix alignment (RFC-0002). A validly-signed envelope may carry a `source` whose
  principal segment names a different principal than any stamp. Consumers MUST take the verified
  `signed_by` chain (and, for an agent `originator`, the RFC-0001 §2.2 prefix binding, §7.1),
  never `source`, as the trust anchor for attribution.
- **The NATS subject is not signed.** No field-id covers the subject; the subject an envelope
  rides is outside every signature. A receiver MUST NOT derive trust from the subject beyond the
  classification-prefix check RFC-0002 specifies.
- **Mutable carve-out is an unauthenticated, unbounded channel
  (`envelope/mutable-channels-unbounded-prose-only-trust`).** `correlation_id`, `economics`, and
  `extensions` are writable by any intermediary without invalidating a stamp and carry no size
  bound. Any consumer decision on their contents is a trust decision on unsigned data and is
  forbidden (§4.2). Request-reply that correlates solely on the unsigned `correlation_id` (a
  transport concern) inherits this: a reply is not authenticated by correlation alone.
- **No key identifier forecloses rotation (`signing-canon/no-key-id-forecloses-rotation`).** A
  stamp names only `identity`, never which key signed; the registry binds exactly one
  `public_key` per identity, and key rotation and revocation are out of scope of the format.
  Rotating a key invalidates every in-flight and archived envelope signed under the old key.
  Under D1 a key-id/epoch slot could be added as a new field-id **without breaking existing
  signatures** (integrity-by-default, §4.1.1) — the indirection removes the coupling that
  formerly blocked this — but no such field is defined in v1. Operators MUST treat a key as
  effectively permanent for the lifetime of any envelope that must remain verifiable, and MUST
  NOT rely on revocation for compromise response.
- **Calendar-blind timestamp (`signing-canon/at-timestamp-three-strictness-levels`) — RETAINED,
  not tightened.** The `at` grammar (Appendix A) is a digit-shape regex that admits month 13, day
  40, hour 25; the grill did NOT ratify a calendar-valid tightening. The value is accepted at the
  syntax layer (Appendix B `stamp/at-calendar-blind-accepted`) and rejected at verify because it
  does not parse to a finite instant (`at-not-iso8601`; Appendix B `verify/at-calendar-blind-rejected`).
  One field, two strictness levels — the honest behaviour, unchanged.
- **Cross-repo drift (`signing-canon/cortex-chain-shim-drift`, `…/two-jcs-canonicalizers-unpinned`)
  → surfaced by conformance (D32).** cortex re-implements the `signed_by` shim (and diverges on
  `null`/primitive inputs: myelin returns `[]`, cortex returns a one-element chain wrapping the bad
  value — Appendix B `canon/shim-null-signed-by-is-empty`), and the ecosystem runs two independent
  JCS canonicalizers kept byte-equivalent only by discipline. The layered conformance rule (§11)
  requires each implementation to run these vectors against its OWN shim/canonicalizer/walker,
  which is what surfaces the drift.

### 9.3. Flag-day-R code follow-ups (target rule specified, live code not yet conforming)

Four properties this document makes normative are not yet true of the live verifier. Each lands
at flag-day R and is tracked as a filed issue; this document specifies the target, not a claim
that the code already conforms.

- **F-5 — origin re-anchor (D11, D0).** The live sovereignty ingress gate (myelin
  `validateIngress`) evaluates on the strippable last hop `s[n-1]`; it MUST move its **AUTHORITY**
  decision — actor scope and the capability ceiling — to the origin `s[0]` anchor (§5.5), per the
  two-question split (D0). Its **LINK** decision — the federation-partner check and the
  `imported_principals` delivery-membership test of RFC-0005 §6.1 — legitimately keys on `s[n-1]`
  and is OUT of F-5's scope. A strip-a-trailing-stamp tampering vector against the AUTHORITY
  decision exists until F-5 lands.
- **Freshness admit-vs-re-verify (D17).** The verifier re-checks freshness on every call
  (`verify.ts:19,63,130`); it MUST separate admit-time from re-verify (§7.4).
- **Federation floor gap (D24).** Permissive local stacks do not fully fail-closed on federated
  traffic; the enforce floor (§7.8) MUST be applied to all cross-principal traffic regardless of
  local posture.
- **Gateway re-sign reorder (D26).** The gateway re-sign runs AFTER the empty-chain gate under
  enforce (`dispatch-listener.ts` returns on empty_chain before the re-sign); the re-sign MUST be
  reordered ahead of the empty-chain gate (§7.9).

### 9.4. Retained open decisions (recorded, not resolved)

Three decisions are explicitly retained and are marked in place above and in the document's
`openDecisions` front matter:

- **[OPEN DECISION — Andreas + JC — blocked on cortex Phase D federation hub trust]** Hub
  vouching-authority scope (D14; §5.5, §7.3): which registry's trusted-hub set governs a federated
  envelope, and which identities a trusted hub may vouch for. Mechanics are pinned; scope is open.
- **[OPEN DECISION — Andreas + JC]** Local-scope unsigned-fallback blessing (D23; §7.7): whether a
  local-scope (non-federated) emitter may be blessed to fall back to unsigned. Boundary-scope MUST
  sign is ratified; local-scope is open.
- **[OPEN DECISION — Andreas + JC]** Re-sign-on-ingest promotion (D25; §7.8): whether to promote
  re-sign-on-ingest to a named wire concept.

---

## 10. Privacy Considerations

This document specifies identifiers (the `did:mf` DIDs carried in `identity` and `stamped_by`)
and per-hop timestamps, so Privacy Considerations are REQUIRED.

**What the chain exposes, to every reader of the envelope.** The `signed_by` chain is, by
construction, an append-only record of the processing path: the DID of the origin and of every
relay/hub/policy-enforcer that handled the envelope, each with a precise `at` timestamp. A
reader therefore learns the identity topology and the timing of the originating network — not
merely that the envelope is authentic, but by whom and when it was handled at each hop
(`signing-canon/chain-metadata-privacy-unwritten`).

**Correlation.** A DID is a stable, cross-context identifier: the same `did:mf:...` appearing
in stamps across many envelopes correlates all of them to one actor. Per-hop timestamps further
enable traffic-analysis correlation of related envelopes.

**Federation boundary.** The ecosystem posture is that cross-boundary visibility is aggregated
metadata, not individual interior detail. The `signed_by` chain runs counter to that posture in
spirit: an envelope that crosses a principal boundary carries the full internal hop DIDs and
timings of the sending side. No artifact today specifies whether transit stamps MAY or SHOULD
be pruned, aggregated, or blinded at a boundary — and pruning a stamp breaks chain-commit for
every later stamp (§5.4), so blinding is not free. Whether and how to blind transit metadata at
a federation boundary is out of scope for v1 and SHOULD be addressed before the format is relied
upon for cross-principal privacy. This document does not invent a blinding scheme.

**Minimization guidance.** Because roles and identities are self-asserted labels, an
implementation SHOULD avoid placing personal or otherwise sensitive data in `identity` display
context, and MUST NOT place secrets anywhere in the signable projection (it is plaintext and
permanently archived alongside the signature).

---

## 11. Conformance

An implementation conforms to this document if and only if it passes every vector under the
path named in `vectors` (`specs/vectors/envelope-signing/`) as scoped by the layered rule below.
Prose explains; **vectors bind.**

### 11.1. Layered conformance by inheritance (D32)

The conformance unit is **each independently-maintained codepath**. A consumer MUST run the
vectors against its OWN:

- shim (`normalizeSignedBy`),
- canonicalizer (`canonicalizeForSigning` / `…ForChainStamp` / `bytesToSign` /
  `parseAndCanonicalize`), and
- chain walker (`verifyEnvelopeIdentity` / `validateStampSyntax`).

A consumer MAY satisfy the pure Ed25519 **sign/verify primitive** kinds by a **version-pinned
reference import**, declared in a per-consumer conformance MANIFEST. It MUST NOT import the
reference for the shim, canonicalizer, or walker layers — those are exactly where interop drift
lives. This replaces the former blanket "MUST NOT import the reference": conformance is scoped
to the verify/validate/canonicalize layer and excludes the consumer's enforcement postures
(§7.6–§7.9), which are policy, not format. `canon/shim-null-signed-by-is-empty` is expected to
FAIL against cortex's current re-implemented shim — that is the desired outcome; it surfaces the
drift recorded in §9.2.

### 11.2. Demonstration matrix

To claim conformance an implementation MUST demonstrate, via the vectors:

1. **Canonicalization** — byte-exact canonical output for the field-ID-keyed JCS profile (§3,
   §4.4), the mutable carve-out masking (§4.2), number/nested-sort normalization, the
   single-object → array normalization (§4.3), the byte-exact domain-separation prefix (§6.1),
   the shim null-to-empty behaviour (§4.3), and the two I-JSON MUST-fail cases (§3.4).
2. **Chain bytes** — byte-exact reconstruction of the §5.4 signing/verification bytes for both
   stamp 0 and a chain-committing stamp 1.
3. **Signing/verification** — a full sign→verify round trip for a two-stamp `ed25519` chain and a
   `hub-stamp` chain against a registry; rejection of a chain in which any earlier stamp was
   tampered; the admission-vs-re-verify freshness pair (§7.4); the cross-protocol
   domain-separation rejection (§6.1).
4. **Rejection** — the stable machine reason token for each negative case (§11.3), including the
   D8 verification-equation edge cases, the D6 chain-length cap, and the D16 stackless fail-closed.

### 11.3. Stable rejection tokens (D27)

A verifier/validator MUST map its internal failures to these tokens. They are the normative
**result-object vocabulary** and NEVER appear on the wire. Each has one binding vector unless
noted:

`signature-wrong-length`, `unknown-signing-method`, `legacy-principal-key`, `at-not-iso8601`,
`unknown-principal`, `untrusted-hub`, `stamp-signature-invalid`, `chain-empty`,
`at-outside-freshness`, `chain-too-long`, `chain-stack-binding-unresolved` (D16),
`originator-principal-binding-violation` (myelin#251 — the §7.1 non-agent originator binding,
RFC-0003 §3.17), `small-order-key`, `small-order-point`, `non-canonical-point`,
`non-canonical-scalar` (D8), `non-finite-number`, `duplicate-key` (D2).

Like every token here, `originator-principal-binding-violation` is a **result-object** value that
never rides the wire. When a refused envelope is surfaced on the task path, the corresponding wire
refusal is RFC-0010 §2.2 **`policy_denied`** — a pre-spawn authorization-gate refusal, permanent,
`term` (no redelivery) — because a cross-principal originator assertion is an authorization failure,
not a capability (`cant_do`) or capacity (`not_now`) condition, and retrying cannot cure it
(myelin#251).

`canonicalization-depth` is a **RESERVED** token with **no binding vector**: D6 ratified only the
chain-length cap (16); canonicalization depth/width is impl-defined (cortex caps, myelin does
not), so no number is pinned and the vector set does not overclaim one (D31).

Note that some vectors encode a RETAINED FINDING rather than a desired end-state (e.g.
`stamp/at-calendar-blind-accepted` MUST be accepted at the syntax layer because the deployed
grammar accepts it, then rejected at verify). These are marked in their `why`.

### 11.4. The vector generator and set (D28–D31)

A committed vector **generator** (`generate.ts`, D28) recomputes every canonical byte string and
every signature deterministically and self-verifies before writing; a CI harness runs it. The
generator imports only `node:crypto`. Signatures are real (deterministic Ed25519, RFC 8032).

The ratification vectors bind the **post-cut class-explicit dot-form** DIDs (D29; RFC-0001 §6.2).
The pre-cut **flat** form (e.g. the abbreviation `did:mf:echo`) is illustrative only and appears
in prose (Appendix B), never as a binding vector. Because a DID string is inside the canonical
bytes (§4.4, §5.4), the DID strings and every signature regenerate atomically at the RFC-0001 §9
hard cut.

Test keys are DESIGNATED TEST VECTORS (D30) with fixed byte-fill seeds; never production keys.
The hub test identity is `did:mf:hub.testnet`, deliberately OFF the reserved real
`did:mf:hub.metafactory` (RFC-0001/registry reservation).

The full matrix (D31) carries one vector per §11.3 token, the stamp-1 chain-commit rejection, and
the shim-divergence case; the ONLY canonicalizer MUST-fail vector is the non-finite-number case
(the JCS-negatives class is scoped to that, not overclaimed).

### 11.5. Changing the wire

Any change to the canonicalization scheme, the field-ID registry membership (add/tombstone — a
**rename is not** a wire change, §4.1.1), the method or role enumerations, the signature or
public-key encoding, or the `CONTEXT_TAG` is an encoding change. Under single-principal
ratification (v1, [ADR-0001](../../docs/adr/0001-single-principal-ratification.md)), such a change
is handled by **revise-and-reimplement**: change the RFC, regenerate the derived artifacts, and
prove it with the conformance vectors — the two-signature act and the dual-accept window are the
reinstate-target, not required in v1. The fuller procedure in
[`specs/CONFORMANCE.md`](../CONFORMANCE.md), BCP-0001, and compass
`sops/federation-wire-protocol.md` — a new RFC (`Updates:`/`Obsoletes:`), both signatures, a new
schema version where applicable, and a dual-accept window and a named retirement release —
reinstates the moment a second independent implementation exists or a live federated peer principal
joins. One scoped exception is already ratified: the **DID-encoding migration** (the flat →
class-explicit `method-specific-id` flip, which changes the DID strings inside `identity`/
`stamped_by` and therefore the canonical bytes of every signed envelope) is a coordinated **hard
cut** — one flag-day release, envelope-field DID and subject `@`-segment flipping atomically, NO
dual-accept window, with the destructive purge gated as a `[principal-hands]` checklist (RFC-0001
§9). Once the two-signature discipline reinstates (ADR-0001), dual-accept is BCP-0001's default for every other and future signing-profile change.

---

## 12. References

### 12.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC4648] Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014.
- [RFC7493] Bray, T., Ed., "The I-JSON Message Format", RFC 7493, March 2015.
- [RFC8032] Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Ratified (single-principal, 2026-07-13, ADR-0001). Source of the `did` terminal used by `identity` and `stamped_by`; owner of the two-plane keyed/self-asserted taxonomy (§5.1, §8), the agent prefix binding (§7.1, §5.5), the class-explicit dot-form (§4.4, §11), and the hard-cut DID-encoding migration (§11 §9).
- [RFC-0003] metafactory, "Envelope", **Ratified**. Owner of the envelope field inventory, the stamp JSON structure, `spec_version`, and the carrier of the field-ID registry's id↔name table (§4.1).
- [RFC-0010] metafactory, "Rate-limit and Refusal Taxonomy", **Draft**. Owner of the refusal `kind` registry (§2.2), including `policy_denied` — the wire refusal that this document's §11.3 result token `originator-principal-binding-violation` maps to when a refused envelope is surfaced on the task path (myelin#251). A normative dependency of that mapping; cited at its current `Draft` status pending ratification (ADR-0001 bars grounding behaviour on a Draft document — the mapping is recorded so it lands when RFC-0010 ratifies).
- [BCP-0001] metafactory, "Wire-Protocol Change Control", **Ratified**. The change-control procedure (dual-accept window, retirement release) governing every encoding change (§4.1.1, §8, §11).

### 12.2. Informative References

- [RFC-0002] metafactory, "Subject Namespace", **Ratified**. The NATS subject is not signed; its grammar is referenced only in the subject-binding finding (§9).
- [RFC-0007] metafactory, "Transport and Reliability", **Ratified**. Owner of the TASKS JetStream stream, `Nats-Msg-Id`, and the JetStream duplicate window, to which the freshness/replay decision (§7.4, §9) couples; this document owns the replay-vs-redelivery vocabulary, RFC-0007 owns the mechanism.
- myelin `docs/identity.md`, `docs/envelope.md` — the informative prose this RFC's signing/canonicalization sections supersede (`supersedes_prose`).
- compass `sops/federation-wire-protocol.md` — the cross-repo wire-change procedure, including the default dual-accept window. For the DID-encoding migration specifically, the ratified hard cut of RFC-0001 §9 supersedes the dual-accept default (§11).
- [`grill-logs/rfc-0004.md`](grill-logs/rfc-0004.md) — the 32-decision grill log this revision resolves (ratified 2026-07-13; RFC Ratified single-principal, ADR-0001).

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named
in `grammar` (`specs/grammar/envelope-signing.abnf`) is the source of truth and is what CI
validates. This grammar covers the lexical syntax of a stamp's value-carrying fields plus the
two crypto-core interchange constants and the field-ID registry; the canonicalization ALGORITHM
(§3–§6) is procedural and is not, and cannot be, expressed as ABNF.

```abnf
; specs/grammar/envelope-signing.abnf
; RFC-0004 — Envelope Signing and Canonicalization
; Status: Ratified (single-principal, 2026-07-13, ADR-0001). Normative as of
; ratification (see specs/README.md); revisable as a living spec.
;
; REVISION NOTE (Andreas 2026-07-13, grill log grill-logs/rfc-0004.md, 32/32).
; This file is REVISED to the ratified crypto core. The former OPEN DECISION
; placeholders are RESOLVED and REMOVED. Three retained open decisions
; (D14 hub vouching-authority scope, D23 local-scope unsigned-fallback blessing,
; D25 re-sign-on-ingest promotion) are prose-level policy and do NOT touch this
; grammar; they are cited in the RFC, not carried here.
;
; ─────────────────────────────────────────────────────────────────────────
; SCOPE. This file defines the LEXICAL syntax of the value-carrying fields of
; a `signed_by` stamp, PLUS the two crypto-core interchange constants (the
; canonical signature encoding and the base64-raw public-key encoding) and the
; field-ID registry that keys the canonical signing form. It deliberately does
; NOT express:
;   - the JSON object STRUCTURE of a stamp or of the envelope (that is the
;     envelope JSON Schema's job — RFC-0003), and
;   - the canonicalization ALGORITHM or the bytes-to-sign, which are a
;     stepwise PROCEDURE, not a grammar (RFC-0004 §3-§6). A grammar cannot
;     express "project the signable subset, re-key by field-ID, sort keys,
;     strip stamp i's signature, UTF-8 encode, prepend CONTEXT_TAG,
;     Ed25519-sign". The field-ID REGISTRY and its allocation rule (§ below)
;     ARE grammar-adjacent constants and are pinned here.
;
; Identifier terminals (`did`, `did-prefix`, `method-specific-id`) are the
; SINGLE SOURCE OF TRUTH of RFC-0001 (specs/grammar/identifiers.abnf) and are
; REFERENCED here, never redefined (grammar/README.md rule 5). Under the
; ratified class-explicit dot-form (RFC-0001 §6.2), a stamp `identity` /
; `stamped_by` is a KEYED-plane DID (class principal | stack | agent | hub);
; a self-asserted class (surface | system) MUST NOT appear in signed_by[].
;
; Core rules ALPHA, DIGIT are imported from RFC 5234 Appendix B. Case-sensitive
; string literals use the %s form of RFC 7405. Every %s literal below is
; byte-exact: no case-folding, no normalization (independent-impl grade, L0b).

; ─────────────────────────────────────────────────────────────────────────
; 1. Signing method — the `method` discriminator on every stamp.
;    Transcribes SigningMethod, myelin src/identity/types.ts:25
;      export type SigningMethod = "ed25519" | "hub-stamp";
;    A closed enum: any other discriminator is rejected at the wire boundary
;    (result token `unknown-signing-method`, RFC-0004 §11).
; ─────────────────────────────────────────────────────────────────────────
signing-method  = %s"ed25519" / %s"hub-stamp"

; ─────────────────────────────────────────────────────────────────────────
; 2. Stamp role — OPTIONAL semantic label on a stamp.
;    Transcribes StampRole, myelin src/identity/types.ts:51-56 and schema
;    $defs.stampRole. A role is SELF-ASSERTED by its own stamper and carries
;    no positional, uniqueness, ordering, or authorization constraint — see
;    RFC-0004 §5.2, §9 "Self-asserted stamp role", and the D11 anchor rule
;    (authority anchors on the ORIGIN stamp s[0], never on a self-claimed role).
; ─────────────────────────────────────────────────────────────────────────
stamp-role      = %s"origin" / %s"transit" / %s"accountability"
                / %s"sovereignty" / %s"notary"

; ─────────────────────────────────────────────────────────────────────────
; 3. Signature — the canonical base64 of a 64-byte Ed25519 signature (D7).
;
;    RATIFIED (D7, tighten-at-cut): the signature is the EXACTLY-88-character
;    canonical base64 encoding, enforced on BOTH emit and verify at flag-day R.
;    The former deployed accept-grammar `1*base64-char *"="` (BASE64_RE,
;    src/identity/types.ts:2  /^[A-Za-z0-9+/]+=*$/  + schema minLength:88) is
;    REMOVED as the normative rule — it admitted (a) the 4 trailing-bit variants
;    of the final quantum (malleable: all decode to the same 64 bytes) and
;    (b) unbounded length. Both are wire-breaking below R (result token
;    `signature-wrong-length`, RFC-0004 §11).
;
;    STANDARD base64 alphabet [RFC4648 §4] — NOT url-safe (no "-"/"_").
;    64 bytes = 21 full 3-byte groups (84 chars) + 1 trailing byte -> 2 chars
;    + "==" padding = 88 chars. The 86th (last non-pad) character carries 2
;    significant bits and 4 zero bits, so canonically it is drawn from a
;    4-element set; any other value is a non-canonical (malleable) encoding.
; ─────────────────────────────────────────────────────────────────────────
signature           = 85base64-char final-quantum-2bit "=="
final-quantum-2bit  = %s"A" / %s"Q" / %s"g" / %s"w"
base64-char         = ALPHA / DIGIT / "+" / "/"

; ─────────────────────────────────────────────────────────────────────────
; 3b. Public key — base64-raw interchange encoding of a 32-byte Ed25519
;     public key (D10). NORMATIVE crypto-core constant: the registry and every
;     key-interchange boundary carry a public key in THIS form; a local NKey
;     base32 form is valid but MUST bridge to base64-raw at the boundary. The
;     WIRE CARRIES NO KEY — a stamp names only `identity`; the verifier
;     resolves the key from the off-wire registry (RFC-0004 §8).
;
;     32 bytes = 10 full 3-byte groups (40 chars) + 2 trailing bytes -> 3 chars
;     + "=" padding = 44 chars. The 43rd (last non-pad) character carries 4
;     significant bits and 2 zero bits -> a 16-element canonical set.
; ─────────────────────────────────────────────────────────────────────────
public-key          = 42base64-char final-quantum-4bit "="
final-quantum-4bit  = %s"A" / %s"E" / %s"I" / %s"M" / %s"Q" / %s"U"
                    / %s"Y" / %s"c" / %s"g" / %s"k" / %s"o" / %s"s"
                    / %s"w" / %s"0" / %s"4" / %s"8"

; ─────────────────────────────────────────────────────────────────────────
; 4. Stamp timestamp `at` — the attestation time; the SOLE freshness anchor
;    (D20). Faithful transcription of ISO8601_RE, myelin src/identity/verify.ts
;    and src/envelope.ts:
;      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
;
;    CASE FIX (D3): the literal "T" and the zulu "Z" are UPPERCASE-ONLY (the
;    source regex has no /i flag), so they are pinned with %s. NOTE: RFC-0003's
;    envelope.abnf `datetime` rule shares this defect with a bare "T"/"Z"
;    (ABNF literals are case-INSENSITIVE by default, RFC 5234) — it therefore
;    wrongly admits lowercase "t"/"z"; D3 tightens it onto this case-sensitive
;    rule at flag-day R. This grammar is the authority for the stamp `at`.
;
;    CALENDAR-BLIND (retained finding, not resolved by the grill): this rule
;    admits month 13, day 40, hour 25. The verifier ADDITIONALLY requires the
;    value to parse to a finite instant (RFC-0004 §7.1), so a wire-valid `at`
;    may still be verify-rejected (result token `at-not-iso8601`). A fractional
;    second is OPTIONAL.
; ─────────────────────────────────────────────────────────────────────────
at              = full-date %s"T" full-time
full-date       = 4DIGIT "-" 2DIGIT "-" 2DIGIT
full-time       = partial-time time-offset
partial-time    = 2DIGIT ":" 2DIGIT ":" 2DIGIT [ "." 1*DIGIT ]
time-offset     = %s"Z" / ( ( "+" / "-" ) 2DIGIT ":" 2DIGIT )

; ─────────────────────────────────────────────────────────────────────────
; 5. Stamp DID fields. `identity` (every stamp) and `stamped_by` (hub-stamp
;    only) are metafactory DIDs. Their syntax is `did`, defined in RFC-0001
;    (specs/grammar/identifiers.abnf) and REFERENCED — never redefined — here.
;      stamp-identity   = did      ; RFC-0001; KEYED-plane only
;      stamp-stamped-by = did      ; RFC-0001; hub-stamp only; class `hub`
;    The removed `principal` key (R2 breaking cut, myelin#182) is NOT a stamp
;    member; a stamp carrying it is rejected (result token `legacy-principal-key`).
; ─────────────────────────────────────────────────────────────────────────

; ─────────────────────────────────────────────────────────────────────────
; 6. Field-ID indirection — the canonical signing form is KEYED BY FIELD-ID,
;    NOT by literal field name (D1, the biggest structural change).
;
;    RATIONALE. Before canonicalization, the signable projection's top-level
;    keys are remapped from their NAMES to their permanent FIELD-IDs, so that
;    renaming a signable field is never again cryptographically breaking: the
;    signed bytes key on the id, not the string. Only the 14 top-level
;    SIGNABLE_FIELDS are indirected; nested content (inside `payload`,
;    `sovereignty`, a stamp object, …) keeps its own string keys.
;
;    field-id — the decimal id a signable field is addressed by in the
;    canonical form. Positive integer, no leading zero.
field-id        = nonzero-digit *DIGIT
nonzero-digit   = %x31-39                         ; 1-9

;    THE FIELD-ID REGISTRY (authoritative membership owned by RFC-0004 §4.1 /
;    §8, per D3; the id<->name table is CARRIED alongside each field's
;    definition in RFC-0003's field inventory, per D1 — cite, do not
;    duplicate). The 14 SIGNABLE_FIELDS and their permanent ids:
;
;         id  field                        id  field
;         --  --------------------         --  --------------------
;          1  id                            8  requirements
;          2  source                        9  sovereignty_required
;          3  type                         10  deadline
;          4  timestamp                    11  distribution_mode
;          5  sovereignty                  12  target_assistant
;          6  payload                      13  originator
;          7  signed_by                    14  spec_version
;
;    ALLOCATION RULE (permanent). (a) ids are assigned as consecutive positive
;    integers starting at 1; (b) an id is NEVER reused and NEVER reassigned;
;    (c) RENAMING a field KEEPS its id (this is the whole point — the rename is
;    invisible to the signed bytes); (d) ADDING a signable field takes the next
;    unused id and is integrity-by-default (D4 — signed unless explicitly placed
;    in the §4.2 carve-out); (e) REMOVING a field TOMBSTONES its id forever.
;    Any change to this registry is a wire-encoding change (BCP-0001; RFC-0004
;    §11). The mutable carve-out `correlation_id`, `economics`, `extensions`
;    has NO field-id and is never signed (§4.2).
;
;    CANONICAL KEY ORDER. The field-id keys are decimal STRINGS and are sorted
;    by the JCS UTF-16 code-unit rule (RFC-0004 §3.3) like any other object key
;    — so "10" sorts before "2". This is pure JCS over the re-keyed object; no
;    special numeric sort. The exact byte string is pinned by the vectors
;    (canonicalize.json `canon/*`).
; ─────────────────────────────────────────────────────────────────────────

; ─────────────────────────────────────────────────────────────────────────
; 7. Domain-separation prefix — bytes-to-sign = CONTEXT_TAG || canonical (D9).
;
;    A metafactory-envelope signature is made structurally unusable in any
;    other protocol by prepending a fixed context tag to the canonical bytes
;    before signing/verifying (kills the cross-protocol NKey-reuse class,
;    RFC-0004 §9). The tag is the UTF-8 octets of the ASCII string below
;    followed by a single 0x00 separator; because canonical JSON text never
;    contains an unescaped NUL, the boundary between tag and canonical bytes is
;    unambiguous.
;
;    context-tag — the fixed prefix octets.
context-tag     = %s"metafactory-envelope-signature-v1" %x00

;    bytes-to-sign (PROCEDURE, not a grammar rule; RFC-0004 §6.1): the octets
;    of `context-tag` immediately followed by the UTF-8 octets of the canonical
;    signing string (the JCS text of the field-ID-keyed signable projection with
;    the chain prepared per §5.4). Ed25519 [RFC8032] signs these octets; the
;    result is `signature`. The byte-exact prefix is pinned by the vector
;    canonicalize.json `canon/bytes-to-sign-domain-separated`.
; ─────────────────────────────────────────────────────────────────────────

; ─────────────────────────────────────────────────────────────────────────
; 8. Chain length bound (D6). A `signed_by` chain MUST NOT exceed 16 stamps
;    (MAX_CHAIN_LENGTH; schema maxItems:16). A signer MUST refuse to append to a
;    chain already at 16; a verifier MUST fail cleanly on a longer chain (result
;    token `chain-too-long`) and MAY reject before any signature work (cheap-
;    reject, D19). This is a COUNT bound on the array, not a lexical rule, so it
;    is stated here in prose rather than expanded as an ABNF repetition.
; ─────────────────────────────────────────────────────────────────────────

; ─────────────────────────────────────────────────────────────────────────
; 9. Verification equation (D8) — NOT a grammar; recorded here so the crypto
;    core is complete in one place. A conforming Ed25519 verifier MUST use the
;    strictest fully-pinned equation (the cross-library-agreeing intersection):
;    PureEdDSA [RFC8032], COFACTORLESS; REJECT a small-order point on BOTH the
;    public key A and the signature component R; REJECT a non-canonical point
;    encoding (y >= p) on A and R; REJECT a non-canonical scalar S >= L. Result
;    tokens: `small-order-key`, `small-order-point`, `non-canonical-point`,
;    `non-canonical-scalar`. Each rule is pinned by a negative vector in
;    reject.json.
; ─────────────────────────────────────────────────────────────────────────
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/envelope-signing/`, so an implementation in any
language can consume them. This appendix reproduces the interop-deciding subset and the key
material; it is not the only copy. See [`specs/vectors/README.md`](../vectors/README.md) for the
schema. Every vector carries a `why`.

**Key material (DESIGNATED TEST VECTORS; deterministic).** Ed25519 seeds are fixed byte fills so
signatures are reproducible; these are TEST keys, never production keys (D30). DIDs are the
ratified class-explicit dot-form (RFC-0001 §6.2, D29). The hub test identity is `did:mf:hub.testnet`,
deliberately OFF the reserved real `did:mf:hub.metafactory` (D30).

| Identity | Class | Seed | Public key (base64-raw, 32 bytes) |
|---|---|---|---|
| `did:mf:agent.andreas.meta-factory.echo` | agent | `0x01 × 32` | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=` |
| `did:mf:stack.andreas.meta-factory` | stack | `0x03 × 32` | `7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=` |
| `did:mf:hub.testnet` | hub | `0x02 × 32` | `gTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5Q=` |

> **Post-cut binding vs illustrative flat form (D29).** The binding vectors bind the class-explicit
> dot-form above. The pre-cut **flat** abbreviation (`did:mf:echo`, and similar) is illustrative
> only and never appears as a binding vector. Because a stamp's DID string is inside the canonical
> bytes (§4.4, §5.4), the key-material DIDs, every canonical byte string, and every signature below
> were generated under the dot-form and regenerate atomically at the RFC-0001 §9 hard cut.

**Interop-deciding examples.**

- Unsigned canonical bytes (field-ID-keyed projection + JCS sort; `canon/unsigned-minimal`):

  ```
  {"1":"550e8400-e29b-41d4-a716-446655440000","2":"andreas.meta-factory.local","3":"review.completed","4":"2026-05-07T12:00:00Z","5":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"6":{"pr":42,"verdict":"approved"}}
  ```

- Stamp 0 signing bytes (echo, role `origin`, `at=2026-05-07T12:00:00Z`; field-id 7 carries the
  one-element array with stamp 0's own signature stripped; `canon/stamp0-signing-bytes`):

  ```
  {"1":"550e8400-e29b-41d4-a716-446655440000","2":"andreas.meta-factory.local","3":"review.completed","4":"2026-05-07T12:00:00Z","5":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"6":{"pr":42,"verdict":"approved"},"7":[{"at":"2026-05-07T12:00:00Z","identity":"did:mf:agent.andreas.meta-factory.echo","method":"ed25519","role":"origin"}]}
  ```

  With `CONTEXT_TAG` prepended (`canon/bytes-to-sign-domain-separated` pins the base64 of the whole
  tagged octet string), the Ed25519 signature under the echo TEST seed is
  `cQVFICZQGupS/Z8inR1c5OMdXvmLnltUHBequ5jxQ0V7bqaVvs4Ql3nC5IlYNyjoD0xJ5syfy3omFBvr/+mLCQ==`.

- Stamp 1 signing bytes (hub `did:mf:hub.testnet`, role `accountability`, `at=2026-05-07T12:00:05Z`;
  includes stamp 0 **with** its signature — chain-commit; `canon/stamp1-commits-to-stamp0`) →
  Ed25519 signature `SLThnKIHbi+aCZet0CWmQpAMuj3om4aZrhAOKY3jRg1Pb2uMynhqLw3v1EULUVzf61bbRGAu62Olt7+hXxEwBA==`.

- Verifying the two-stamp chain against a registry holding both public keys yields `verified`,
  chain length 2, convenience principal `did:mf:hub.testnet` (`verify/two-stamp-chain-ok`). Flipping
  stamp 0's `role` from `origin` to `sovereignty` after signing yields `rejected` at stamp 0 with
  `stamp-signature-invalid` (`verify/tampered-stamp0-role-rejected`) — the role is inside the signed
  bytes, so it cannot be rewritten in transit.

- A `hub-stamp` in which the hub `did:mf:hub.testnet` vouches for the stack
  `did:mf:stack.andreas.meta-factory` (role `notary`) verifies under the hub's key, returning the
  vouched stack as principal (`verify/hub-stamp-ok`, signature
  `mKOcDO+u0lXhGUjgVgzSg1skqSa8AE6ztI9XdMhhPbkEGp7xQH3D8K7OxAfrYepYD1X9ZF78Msxf1f22zqr7AQ==`).

**The full 31-vector matrix.**

- `canonicalize.json` (10): `canon/unsigned-minimal`, `canon/mutable-carveout-masked`,
  `canon/number-and-nested-sort`, `canon/single-object-normalizes-to-array`,
  `canon/stamp0-signing-bytes`, `canon/stamp1-commits-to-stamp0`,
  `canon/bytes-to-sign-domain-separated` (D9, byte-exact tag), `canon/shim-null-signed-by-is-empty`
  (D32, raw shim input), `canon/nonfinite-number-must-fail` (D2/D31, raw JSON text),
  `canon/duplicate-key-rejected` (D2, raw JSON text).
- `sign-verify.json` (6): `verify/two-stamp-chain-ok`, `verify/tampered-stamp0-role-rejected`,
  `verify/hub-stamp-ok` (D14 mechanics), `verify/stale-admission-rejected` +
  `verify/stale-reverify-ok` (D17 admission-vs-re-verify), `verify/domain-sep-cross-protocol-rejected`
  (D9 negative).
- `reject.json` (15): `stamp/signature-wrong-length` (D7), `stamp/unknown-method`,
  `stamp/legacy-principal-key`, `stamp/at-calendar-blind-accepted` (retained finding) +
  `verify/at-calendar-blind-rejected`, `verify/chain-empty-rejected` (D27),
  `verify/federated-unsigned-rejected` (D24), `verify/chain-too-long-rejected` (D6),
  `verify/unknown-principal-rejected`, `verify/untrusted-hub-rejected`,
  `verify/stackless-chain-fail-closed` (D16), and the four D8 edge cases
  `verify/small-order-key-rejected`, `verify/small-order-point-R-rejected`,
  `verify/non-canonical-point-R-rejected`, `verify/non-canonical-scalar-S-rejected`.

The `canonicalization-depth` token is RESERVED and has no vector (D31). Signatures are real
(deterministic Ed25519, RFC 8032); the committed generator (`generate.ts`, D28) self-verifies every
positive signature before writing.

## Appendix C. Change Log

| Date | Status | Change |
|---|---|---|
| 2026-07-17 | Ratified | **D0 two-anchor split — AUTHORITY on `s[0]`, LINK on `s[n-1]` (myelin#257; audit D1).** Resolves the standing RFC-0004↔RFC-0005 contradiction (`SERIES-COMPLETION-AUDIT.md` audit D1): RFC-0004 §5.5/F-5 anchored authorization on the origin `s[0]` while RFC-0005 §6.1/§12 keyed ingress on the last stamp `s[n-1]` unconditionally — simultaneous conformance was impossible. Ruling (D0, `docs/design-rfc-alignment.md` §3): the two are distinct questions. §5.5 gains a normative **two-question split** paragraph — §5.5 governs the **AUTHORITY** question ("whose work is this": actor scope, attribution, capability ceiling), which anchors on `s[0]` (D11–D12, §7.1 prefix binding); the **LINK** question ("who delivered this crossing": partner check + `imported_principals` delivery test) legitimately keys on `s[n-1]` and is owned by RFC-0005 §6.1. The D11 last-hop bullet and the §9.3 F-5 finding are narrowed accordingly: F-5 moves only the AUTHORITY decision to `s[0]`; the LINK decision stays on `s[n-1]` and is out of F-5's scope. No grammar, schema, or vector `expect` changed (the originator/authority vectors already anchor on `s[0]`, incl. the definitive federated-forward `s[n-1]`-matches-but-`s[0]`-doesn't reject; the sovereignty crossing vectors already key `imported_principals` on the last stamp — the split names what both families already embody); ingress/authorization vector `why`s annotated with which question + anchor. Spec-only (W0, myelin#235). |
| 2026-07-17 | Ratified | **Non-agent originator binding — verify-time enforcement point (myelin#251; external review NorthwoodsSentinel, PR #230).** §7.1 gains a second composition block, the split-plane sibling of the agent-prefix binding: a `principal`- or `stack`-class `originator.identity` MUST reconcile its principal component with the innermost signer `s[0].identity`, against the chain not the self-description; the rule text is RFC-0003 §3.17. Anchored on the truncation-safe origin `s[0]` (§5.5 D11–D12) so appended federated-forward stamps cannot re-key off `s[n-1]`; under a `hub-stamp` origin the principal reads from `s[0].identity`, bounded by the open hub-vouching scope (§5.5 D14); a `hub`-class innermost signer fails closed (D16 family). §11.3 registry gains result token `originator-principal-binding-violation`, with its wire-refusal mapping stated: RFC-0010 §2.2 `policy_denied` (authorization-gate, permanent, `term`) — rationale: a cross-principal originator assertion is an authorization failure, not `cant_do`/`not_now`, and retrying cannot cure it. `surface`/`system`/`hub`-class originators carry no principal component and are unconstrained by construction (compensating actor-authority cap is RFC-0003 §7). New verify vectors in `sign-verify.json` (5 accepts incl. hub-stamp-anchor + federated-forward-s0-anchor) and `reject.json` (3 rejects incl. the definitive federated-forward `s[n-1]`-matches-but-`s[0]`-doesn't case); `generate.ts` adds a 4th TEST identity `did:mf:stack.jc.forge` (seed `0x04`, second principal) to build the cross-principal chains — README test-key table updated. No grammar touched (verify-time semantic, as with the agent-prefix binding); Appendix A unchanged. **Adversarial review (PR #255 FIX-FIRST):** recorded RFC-0010 as a normative `crossRef` + a Draft `[RFC-0010]` reference in §12 (the `originator-principal-binding-violation` → `policy_denied` mapping is a real normative dependency, cited at Draft status per ADR-0001); added the `verify/originator-hub-class-signer-fail-closed` reject vector (hub-class innermost signer, no principal to reconcile → fail-closed with `originator-principal-binding-violation`). |
| 2026-07-12 | Draft | Initial draft. Codifies the JCS profile, SIGNABLE_FIELDS, the chain-commit/slice rule, the two signing methods and hub-trust resolution, and the freshness window, all against `myelin origin/main`. Records nineteen findings from the wire-protocol audit; five carried as explicit open decisions (H4 canonicalization stance, canonical base64, freshness-vs-replay, hub-trust scope, verifier DoS bounds). Ships deterministic Ed25519 interop vectors generated from the reference implementation. |
| 2026-07-13 | Draft | Cascade sweep (decision-free; RFC-0001 ratifications + REVISIONS.md C10/C11). Two-plane keyed-DID citations; agent-originator prefix binding cross-referenced; dual-accept scoped vs the DID-encoding hard cut; `0007` added to crossRefs; Appendix B pre-flag-day encoding note. No open decision resolved. |
| 2026-07-13 | Draft | **Grill resolution (grill-logs/rfc-0004.md, 32/32, principal-ratified).** Resolved and removed every open-decision marker the grill closed; **three retained** (D14 hub vouching-authority scope; D23 local-scope unsigned-fallback; D25 re-sign-on-ingest promotion). §4 rewritten around **field-ID indirection** + the permanent field-id registry and allocation rule (D1, D3, D4); §3.3/§3.4 added I-JSON + non-plain-object MUST-reject (D2, D5). §6 pinned the canonical exactly-88 signature (D7), the `CONTEXT_TAG` domain-separation prefix (D9), and the base64-raw public-key encoding (D10). §5.5 added the chain authority semantics table (D11–D16: origin anchor / last-hop-auth-only / strippable trailing / append-not-endorsement / hub mechanics / trust-vs-bytes / stackless fail-closed). §7.2 pinned the fully-pinned cofactorless Ed25519 equation (D8); §7.4 made freshness admission-only + replay vocab (D17, D18, D20); §7.6–§7.9 added conformance classes, monotone reject, emitter obligation, federation floor, announced-key rule, and gateway stamp-before-admit (D21–D26). §9 reframed resolved findings, kept the retained findings, and added the four flag-day-R code follow-ups (F-5 origin re-anchor, freshness admit-vs-re-verify, federation floor, gateway re-sign reorder). §11 rewritten to layered conformance-by-inheritance (D32) with the generator/matrix/test-key/dot-form rules (D28–D31) and the D27 token registry (`signature-too-short` → `signature-wrong-length`; added the D8/D2/chain tokens; `canonicalization-depth` reserved, no vector). Appendices A/B re-synced to the revised ABNF and the post-cut dot-form vectors (hub off `hub.metafactory`). BCP-0001 and RFC 7493 (I-JSON) added to references. Status at authoring: Draft. |
| 2026-07-13 | Ratified | Single-principal ratification by the principal (Andreas) under ADR-0001; the decided content is normative, three open sub-decisions (D14 hub vouching-authority scope; D23 local-scope unsigned-fallback; D25 re-sign-on-ingest promotion) retained as flagged and unresolved in the now-Ratified living spec; two-signature reinstates on a 2nd implementation or live federated peer. |

## Acknowledgments

Grounded in the wire-protocol audit (dimension `signing-canon`), the reference implementation on
`myelin origin/main` (`src/jcs.ts`, `src/identity/*`), and the 32-decision RFC-0004 grill
([`grill-logs/rfc-0004.md`](grill-logs/rfc-0004.md), ratified by the principal 2026-07-13).

## Authors' Addresses

Luna — metafactory.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
