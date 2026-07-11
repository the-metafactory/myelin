---
rfc: 0004
title: Envelope Signing and Canonicalization
status: Draft
category: Standards Track
obsoletes: []
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories: []
created: 2026-07-12
ratified: null
grammar: specs/grammar/envelope-signing.abnf
vectors: specs/vectors/envelope-signing/
generated:
  - schemas/envelope.schema.json#/$defs/signedByStamp   # signature, at, role sub-schemas
  - src/identity/types.ts (BASE64_RE)
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
the fixed set of envelope fields that enter the signature, the three fields deliberately
left mutable outside it, the `signed_by` chain of stamps and the rule by which each stamp
commits to every stamp before it, the two signing methods (`ed25519` and `hub-stamp`), and
the per-stamp verification procedure including the freshness window. Two independent
implementations that follow this document produce identical signing bytes for the same
envelope and accept each other's signatures. Where an interoperability-critical property is
today held by a runtime check or by shared code rather than by a written contract, this
document records it as a finding rather than promoting it to a design.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative.
Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are
published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** and **the hub custodian**, recorded
in `signatories`. A wire contract binds more than one party; it cannot be ratified by one.

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
4. The Signable Projection
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

The bytes-to-sign contract is, at time of writing, expressed only in reference TypeScript
(`src/jcs.ts`, `src/identity/canonicalize.ts`, `src/identity/sign.ts`,
`src/identity/verify.ts`) and in informative prose (`docs/identity.md`, `docs/envelope.md`).
The envelope JSON Schema (RFC-0003) captures the *shape* of a stamp but structurally cannot
express which fields are signed, in what order the bytes are produced, how a chain commits to
its own history, how a hub's trust is resolved, or the freshness window. No artifact an
independent implementer could ground on defines these. This RFC is that artifact.

**What this document specifies.** The JCS profile (§3); the exact set of signable fields and
the mutable carve-out (§4); the stamp object, the chain, and the chain-commit / chain-slice
rule (§5); the `ed25519` signing procedure and signature encoding (§6); the per-stamp
verification procedure, the two methods, hub-trust resolution, and the freshness window (§7).

**What this document does not specify.** The `did:mf` identifier syntax carried in a stamp's
`identity` and `stamped_by` fields — that is RFC-0001, referenced here. The envelope's field
inventory, types, and JSON structure — that is RFC-0003. The NATS subject an envelope is
published on — that is RFC-0002, and the subject is **not** signed (§9). Key generation,
storage, rotation, and revocation — out of scope of the format, with the consequences noted
in §9.

**Codifying, not redesigning.** This document describes the wire as it is on
`myelin origin/main`. Several behaviours the audit surfaced are defects, not designs. This
document calls each one out — as a Security Consideration (§9) or as an
`[OPEN DECISION]` — and does **not** silently encode a fix. One structural decision (the H4
canonicalization stance) blocks any 1.0-stable bytes-to-sign contract and is recorded as the
first open decision.

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
  the signable field set (§4.1) that are present; the input to canonicalization.
- **Mutable carve-out** — the three envelope fields (`correlation_id`, `economics`,
  `extensions`) deliberately excluded from every signature so that relays may annotate them
  without invalidating a stamp (§4.2).
- **Canonicalization** — the deterministic reduction of a JSON value to a byte string (§3),
  a profile of JCS [RFC8785].
- **Bytes-to-sign** — the UTF-8 encoding of the canonical string of the signable projection
  with the chain prepared per §5.4; the input to Ed25519.
- **Chain-commit** — the property that stamp *i*'s bytes-to-sign include stamps `0..i-1` with
  their signatures intact, so that tampering with any earlier stamp invalidates stamp *i*.
- **Signing method** — `ed25519` (an identity signs with its own key) or `hub-stamp` (a
  registry-trusted hub signs on an identity's behalf).
- **Identity registry** — the off-wire trust anchor mapping a DID to a single public key and
  a type, plus the set of trusted hubs (§8). It is not part of the envelope.
- **Clock-skew window** — the maximum absolute difference between a verifier's clock and a
  stamp's `at` for which a stamp is accepted; 5 minutes by default (§7.4).

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
4. Canonicalize the resulting object to a string (§3), then UTF-8 encode it to the
   bytes-to-sign (§6.1).
5. Sign the bytes with Ed25519 and base64-encode the 64-byte signature (§6.2).
6. Append the completed stamp to `signed_by`.

Verification (§7) inverts steps 3–5 for each stamp in the chain and additionally checks
registry membership, key and signature lengths, and freshness.

The signing bytes commit to the envelope's identity-bearing content (`id`, `source`, `type`,
`timestamp`, `sovereignty`, `payload`, task-routing fields, `originator`, `spec_version`) and
to the entire prior chain, but NOT to `correlation_id`, `economics`, `extensions`, and NOT to
the NATS subject the envelope rides. §9 records the consequences of each exclusion.

---

## 3. The Canonicalization Scheme (JCS Profile)

Canonicalization is a total function from a JSON value to a UTF-8 string, following the JSON
Canonicalization Scheme [RFC8785]. This section specifies the profile exactly, because it is
the single most interoperability-critical algorithm in the protocol. It transcribes
`src/jcs.ts` (`canonicalStringify`).

### 3.1. Value serialization

An implementation MUST serialize a JSON value to its canonical string as follows, recursively.

- A **null** value MUST serialize as the three characters `null`. (An `undefined` value, which
  arises only as an object member value and is dropped by §3.3, is treated as absent, not as
  `null`.)
- A **boolean** MUST serialize as `true` or `false`.
- A **number** MUST be finite; a non-finite number (NaN, +Infinity, -Infinity) MUST cause
  canonicalization to fail. A finite number MUST serialize using the ECMAScript
  `Number.prototype.toString` / `JSON.stringify` algorithm — the shortest decimal string that
  round-trips to the same IEEE-754 double (§3.2).
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
(Appendix B) rather than on prose.

### 3.3. Key ordering and the input domain

Object member keys MUST be ordered ascending by UTF-16 code unit — the ordering produced by
the default ECMAScript string comparison and mandated by [RFC8785]. The empty-string key, if
present, sorts first. This ordering is applied at every level of nesting.

The canonicalizer's input domain is JSON values: null, booleans, finite numbers, strings,
arrays, and plain objects. A value of an unsupported type (function, symbol, bigint) MUST
cause canonicalization to fail.

> **Finding — non-plain objects (`signing-canon/jcs-nonplain-objects-undecided`).** The
> reference treats *any* value of JavaScript type `object` as a plain map: a `Date`, `Map`,
> or `Set` canonicalizes to `{}` (it has no own enumerable string keys) rather than failing,
> even though the same `Date` on the wire (via `JSON.stringify`, which honours `toJSON`)
> serializes to a string. Signer-side canonical bytes would then silently differ from the
> wire bytes and the signature could never verify after a round trip. This is a defect of the
> reference's input-domain handling, not a design. An implementation MUST canonicalize only
> plain-JSON values; passing a non-plain object to the signable projection is a caller error.
> The precise required behaviour (fail vs coerce) is left to the H4 resolution (§9) since it
> touches the canonicalizer contract.

---

## 4. The Signable Projection

### 4.1. The signable field set

Before canonicalization, an implementation MUST reduce the envelope to the sub-object
containing exactly those top-level keys that are BOTH present in the envelope AND members of
the signable field set below. Every other top-level key MUST be excluded — including the
mutable carve-out (§4.2) and any field not enumerated here. A key that is absent from the
envelope contributes nothing (it is simply not present in the projection); this is what lets
an envelope that omits an optional signable field verify against a signature produced before
that field existed.

The signable field set is, verbatim (`src/identity/canonicalize.ts` `SIGNABLE_FIELDS`):

```
id
source
type
timestamp
sovereignty
payload
signed_by
requirements
sovereignty_required
deadline
distribution_mode
target_assistant
originator
spec_version
```

The enumeration order above is documentary only; because §3.3 sorts keys, the order in which
the set is written has no effect on the bytes. What is normative is **membership**: a field in
this set is signed when present; a field not in this set is never signed.

Semantics of the non-obvious members:

- `signed_by` is itself signable (§5.4 governs exactly which bytes of it enter which stamp's
  signature).
- `requirements`, `sovereignty_required`, `deadline`, `distribution_mode`, `target_assistant`
  are the F-021 task-routing fields: signed so that a tampered requirement, target, deadline,
  or mode invalidates the chain. `target_assistant` is the canonical name; the removed
  `target_principal` key (R13 breaking cut) is NOT a member and MUST NOT be signed — a stray
  `target_principal` is an unknown field rejected by envelope validation before it could enter
  the projection.
- `originator` is the policy-attribution claim (myelin#160); the signer commits to it.
- `spec_version` is the wire-grammar version (RFC-0003). It is signed so it cannot be
  downgraded in transit. Because it is absent from pre-`spec_version` envelopes, its absence
  keeps their canonical bytes — and therefore their old signatures — unchanged.

> **Change control.** The membership of this set is part of the wire contract. Adding,
> removing, or **renaming** any member changes the canonical bytes of every envelope that
> carries the affected field, and therefore breaks every existing signature over such
> envelopes. There is at present no field-identifier indirection that would decouple names
> from signed bytes; whether to introduce one is the H4 open decision (§9). Any change to this
> set is an encoding change and MUST follow the wire-change procedure (§8, §11).

### 4.2. The mutable carve-out

Exactly three fields are, by design, excluded from every signature:

```
correlation_id
economics
extensions
```

An implementation MUST NOT include these in the signable projection. The exclusion is
deliberate: relays and hubs MUST be able to thread a `correlation_id` after the fact,
aggregate cost into `economics` as work fans out, and annotate `extensions` with routing or
trace metadata, all without invalidating any stamp in the chain.

The direct consequence, which an implementation MUST honour, is that **no party signs what it
writes into these three fields.** A consumer MUST NOT make any trust, security, authorization,
or routing-integrity decision on the contents of `correlation_id`, `economics`, or
`extensions`. When a relay needs to bind an annotation cryptographically, the correct action
is to append a stamp (§5), not to rely on a carve-out field. §9 records the residual risks
(unbounded unauthenticated channels; reply-correlation on an unsigned field).

### 4.3. `signed_by` shape normalization

On the wire `signed_by` MAY appear as a single stamp object (a legacy input shim) or as an
array of stamps. For all purposes of this document — canonicalization, signing, and
verification — an implementation MUST first normalize `signed_by` to array form: a single
object becomes a one-element array; an absent `signed_by` denotes an unsigned envelope (§5.3).

The canonical bytes MUST always serialize `signed_by` in **array** form, even when the wire
carried the single-object shape. That is: an envelope received with `"signed_by":{...}` and
the same envelope received with `"signed_by":[{...}]` MUST produce byte-identical canonical
output (Appendix B, `canon/single-object-normalizes-to-array`).

> **Finding — resolved here (`signing-canon/single-object-canonical-bytes-ambiguity`).** The
> reference's own doctrine says canonical bytes are derived from the envelope's keys "as
> received", yet it always re-shapes a single-object `signed_by` into array form before
> canonicalizing. Those two statements conflict, and no artifact stated which wins. This
> section resolves the ambiguity normatively in favour of the observed behaviour: the array
> form is always what is signed. An implementation that canonicalizes the single-object shape
> literally is non-conforming.

---

## 5. The Stamp and the Chain

### 5.1. Stamp object

A stamp is a JSON object. Its structural shape is owned by RFC-0003
(`schemas/envelope.schema.json` `$defs/signedByStamp`); this section specifies the semantics
of its fields and the syntax of its value-carrying fields (Appendix A).

Every stamp MUST carry:

- `method` — one of `ed25519` or `hub-stamp` (`signing-method`, Appendix A). No other value
  is valid.
- `identity` — the DID of the identity the stamp attests for, matching `did` (RFC-0001). The
  deprecated `principal` key was removed from the wire (R2 breaking cut, myelin#182); a stamp
  carrying `principal` MUST be rejected as an unknown field.
- `signature` — the base64 signature (`signature`, Appendix A; §6.2).
- `at` — the attestation timestamp (`at`, Appendix A; §7.4).

A stamp MAY carry:

- `role` — a `stamp-role` (Appendix A). OPTIONAL for back-compatibility; a stamp without a
  role is valid.

A `hub-stamp` stamp MUST additionally carry:

- `stamped_by` — the DID of the hub that produced the signature, matching `did` (RFC-0001).

A stamp MUST NOT carry any other member (`additionalProperties: false` in the schema).

### 5.2. Stamp role

`role` is a semantic label describing what a stamp ATTESTS, not what the identity IS. The
value set is closed (`stamp-role`): `origin`, `transit`, `accountability`, `sovereignty`,
`notary`. A role is self-asserted by its own stamper; this document defines no positional,
uniqueness, ordering, or authorization constraint on roles, and §9 records the security
consequence.

### 5.3. Chain order and bounds

The chain is ordered: the origin stamps first, and each subsequent relay/hub/policy-enforcer
APPENDS its stamp at the end. The most recent attestor is the last element.

A signed envelope MUST carry a chain of at least one stamp. An envelope with no `signed_by`,
or with an empty array, is **unsigned**; whether an unsigned envelope is admissible is a
consumer policy decision, but it carries no verifiable identity and MUST NOT be treated as
trusted.

A chain MUST NOT exceed **16** stamps (`MAX_CHAIN_LENGTH`; `schema maxItems: 16`). A signer
MUST refuse to append a stamp to a chain already at 16. A verifier's obligation to enforce
this bound is the subject of an open decision (§9); the schema bound governs the wire
regardless.

### 5.4. Chain-commit and chain-slice (the bytes-to-sign for stamp *i*)

This is the load-bearing rule of the whole document.

Let the normalized chain be `s[0], s[1], …, s[n-1]`.

**Signing stamp *i* (append at position `i = n`):** the bytes-to-sign are the canonical string
(§3) of the signable projection (§4) in which `signed_by` is set to
`[ s[0], …, s[i-1], d ]`, where `s[0..i-1]` are the existing stamps **with their `signature`
members intact** and `d` is the new stamp being produced **without a `signature` member** (a
stamp cannot sign its own signature). Because `s[0..i-1]` carry their signatures inside stamp
*i*'s signed bytes, stamp *i* cryptographically commits to the entire prior chain
(chain-commit).

**Verifying stamp *i*:** the bytes stamp *i* signed are the canonical string of the signable
projection in which `signed_by` is set to the slice `[ s[0], …, s[i] ]` with `s[i]`'s
`signature` member **stripped** and `s[0..i-1]`'s `signature` members **intact**. Stamps at
positions `> i` are NOT included. A verifier MUST reconstruct exactly these bytes for each
stamp (Appendix B, `canon/stamp0-signing-bytes`, `canon/stamp1-commits-to-stamp0`).

Consequences an implementation MUST preserve: stripping happens on exactly one stamp — the one
being signed or verified; every earlier stamp keeps its signature verbatim, byte for byte;
tampering with any field of any earlier stamp (identity, at, role, method, or signature)
invalidates every later stamp (Appendix B, `verify/tampered-stamp0-role-rejected`).

---

## 6. Signing

### 6.1. Producing the bytes-to-sign

To sign, an implementation MUST: (1) verify the signing identity DID matches `did` (RFC-0001)
and the private key is a 32-byte Ed25519 seed; (2) refuse if the prior chain is already at
`MAX_CHAIN_LENGTH` (§5.3); (3) construct the stamp draft with `method`, `identity`, `at`
(current time, ISO-8601), and OPTIONAL `role`, and no `signature`; (4) form the signable
projection with `signed_by` prepared per §5.4 for the appended stamp; (5) canonicalize (§3)
and UTF-8 encode to the bytes-to-sign.

### 6.2. Ed25519 and signature encoding

An implementation MUST sign the bytes-to-sign with Ed25519 [RFC8032] under the identity's
32-byte seed, producing a 64-byte signature. Ed25519 signing is deterministic: the same bytes
and key always yield the same signature (this is what makes the Appendix B vectors
reproducible).

The signature MUST be encoded with **standard** base64 [RFC4648 §4] — the `A–Z a–z 0–9 + /`
alphabet with `=` padding — NOT the URL-safe alphabet. A 64-byte signature encodes to exactly
88 characters (`86` base64 characters followed by `==`).

> **Finding — non-canonical base64 accepted (`signing-canon/base64-signature-malleable`,
> `signing-canon/signature-no-upper-bound`).** The deployed accept-grammar (`signature`,
> Appendix A) plus `minLength: 88` accepts (a) the 4-trailing-bit variants of the final base64
> quantum, which all decode to the same 64 bytes, and (b) strings far longer than 88
> characters. Because the **last** stamp's `signature` string is itself signed by no one, an
> intermediary can re-encode it to an equivalent-but-byte-distinct form, yielding two wire
> envelopes that both verify — defeating any hash-of-the-envelope dedup or audit identity —
> while a strict base64 decoder in another language rejects what the reference accepts.
> Requiring canonical, exactly-88-character encoding (`canonical-signature`, Appendix A) on
> both emit and verify is an `[OPEN DECISION]` (§9); this document does not silently mandate
> it because doing so would reject currently-valid production envelopes without a migration
> window.

---

## 7. Verification

`verifyEnvelopeIdentity(envelope, registry, options)` walks the chain and returns `verified`
(every stamp valid), or `rejected` with a reason naming the first failing stamp.

### 7.1. Per-stamp procedure

For each stamp `s[i]` in chain order, a verifier MUST, in order:

1. Read the attesting DID from `s[i].identity`; if absent, reject.
2. Resolve `s[i].identity` in the registry (§8); if unknown, reject (`unknown-principal`).
3. Read `s[i].at`; if it is not a syntactically valid ISO-8601 timestamp (Appendix A `at`) and
   parseable to a finite instant, reject.
4. Apply the freshness rule (§7.4); if outside tolerance, reject.
5. Dispatch on `s[i].method`: `ed25519` → §7.2; `hub-stamp` → §7.3; any other value →
   reject (`unknown-signing-method`).

The chain is `verified` iff every stamp is valid. On success the verifier returns the LAST
verified identity as the convenience principal (the most recent attestor); a per-stamp verdict
list MUST also be available so a caller can see which hop failed. On the first failing stamp
the verifier MUST reject and MUST NOT continue.

### 7.2. Method `ed25519`

The verifier MUST: base64-decode `s[i].signature` and reject unless it is exactly 64 bytes;
resolve the identity's `public_key` from the registry and reject unless it is exactly 32
bytes; reconstruct the bytes stamp *i* signed per §5.4; and verify the Ed25519 signature over
those bytes under the identity's public key. Verification failure MUST reject.

### 7.3. Method `hub-stamp` and hub-trust resolution

For a `hub-stamp`, the identity in `identity` is the entity vouched FOR; the signature is
produced by the hub named in `stamped_by`. The verifier MUST: resolve `stamped_by` in the set
of **trusted hubs** (§8) and reject unless present (`untrusted-hub`); decode the signature
(exactly 64 bytes) and the hub's `public_key` (exactly 32 bytes); reconstruct the §5.4 bytes;
and verify the signature under the **hub's** public key. The vouched identity MUST still
resolve in the registry (step 7.1.2).

> **Finding — hub-trust scope and cross-repo divergence
> (`signing-canon/hub-stamp-cross-repo-divergence`).** Two properties are unspecified and left
> to the open decision in §9: (a) **which** registry's trusted-hub set governs a *federated*
> (cross-principal) envelope — trust is file-local, and a hub trusted by the receiver need not
> be trusted by the originator; (b) **which identities** a trusted hub may vouch for — nothing
> binds a hub-stamp's `stamped_by` to its `identity`, so any trusted hub may stamp for any
> registered identity. Separately, the cortex consumer's structural verifier **skips**
> hub-stamps entirely (surfacing them as `skipped`, deferred to its Phase D), so the *same
> chain* is cryptographically trusted by the myelin verifier and passed-through-unverified by
> cortex. Conformance (§11) requires each implementation to run the hub-stamp vectors against
> its own verifier precisely to expose this.

### 7.4. Freshness (clock-skew window)

A verifier MUST reject a stamp whose `at` differs from the verifier's current clock by more
than the clock-skew tolerance, applied per stamp: `abs(now - at) > clockSkewMs` rejects. The
default tolerance is **5 minutes** (`DEFAULT_CLOCK_SKEW_MS = 300000 ms`). The tolerance MAY be
overridden by the caller.

> **Finding — freshness contradicts replay (`signing-canon/freshness-vs-replay-contradiction`).**
> Because the window is applied to every stamp against the verifier's wall clock, **no
> envelope older than the tolerance can ever pass identity verification** — yet the ecosystem
> documents six-month archive replay as a feature and operates a JetStream stream that
> redelivers. The normative reconciliation (verify-at-admission vs verify-at-read; what a
> replay consumer does with a signed-but-stale envelope) is an `[OPEN DECISION]` (§9). This
> document specifies the deployed rule and flags the contradiction; it does not invent the
> resolution. Conformance vectors that exercise signatures disable the window (Appendix B) so
> that signature correctness is testable independently of wall-clock time.

### 7.5. Chain-shape predicates

A verifier MAY expose predicates over a *verified* chain — minimum length, "must include a
stamp of role X", "must include an identity of type Y", "must include identity D". These
compose with AND semantics and are evaluated only after cryptographic verification succeeds.
Because a role is self-asserted (§5.2, §9), a predicate such as "must include role
`accountability`" is satisfied by any hop's self-claim and MUST NOT be read as a proof of
authority.

---

## 8. Registry Considerations

**RFC number.** `0004`, allocated in [`specs/README.md`](../README.md). Numbers are never
reused.

**External registries.** This document defines no DID method and registers nothing with the
W3C DID Specification Registries; the `did:mf` method is RFC-0001's concern. It reserves no
NATS subject, segment, or identifier prefix.

**Enumerations this document governs.** Three closed value sets are normative here and change
only by a new RFC (§11):

- the **signing methods** `ed25519` and `hub-stamp` (§5.1);
- the **stamp roles** `origin`, `transit`, `accountability`, `sovereignty`, `notary` (§5.2);
- the **signable field set** (§4.1). This last is registry-like: it is an enumerated list
  whose every member name is part of the signed bytes. Adding, removing, or renaming a member
  is a wire-breaking encoding change. Whether to replace the name-addressed set with a stable
  field-identifier registry (so renames stop breaking signatures) is the H4 open decision
  (§9).

**The identity registry** (the DID → public-key / type / trusted-hub mapping consumed by §7)
is an off-wire trust anchor, not part of this or any envelope. Its file shape and the
`did:mf` identity syntax are owned by RFC-0001; this document only requires that a verifier can
resolve a stamp's `identity` (and, for hub-stamps, `stamped_by`) to a 32-byte Ed25519 public
key and, for hubs, to trusted-hub membership.

---

## 9. Security Considerations

This section is REQUIRED and is not empty. The threat model: an active network adversary who
can read, drop, reorder, replay, and inject envelopes on the bus, and who may control a relay
that legitimately appends stamps. The signing scheme defends the integrity and authenticity of
the signable content and the ordering of the chain; it does not defend confidentiality (the
envelope is plaintext) and, as recorded below, it leaves several properties to runtime checks
or to unresolved decisions.

**Runtime-held invariants (findings, per scaffold rule 6).** The following properties are held
by a runtime check or by discipline rather than by the format, and MUST be read as findings:

- **Unbounded verification work (`signing-canon/verify-unbounded-work`).** The verifier
  imports no chain-length cap (`MAX_CHAIN_LENGTH` is enforced only at sign/validate time) and
  re-canonicalizes the whole envelope once per stamp — O(*n*) full canonicalizations over
  attacker-controlled input, verified *before* any signature is proven. The canonicalizer
  itself has no recursion-depth or width cap. A verifier SHOULD reject any chain longer than
  `MAX_CHAIN_LENGTH` (16, the schema's `maxItems`) and SHOULD bound canonicalization depth and
  width; whether these become MUSTs, and the exact limits, is `[OPEN DECISION — Andreas + JC —
  no issue yet]` (§ open decisions).
- **Self-asserted stamp role (`signing-canon/stamp-role-self-asserted`).** A role is signed
  only by its own stamper. Any verified signer may claim any role at any position, and the
  double-stamp guard was removed ("callers should check the chain themselves"). Role predicates
  (§7.5) therefore prove self-assertion, not authority. No artifact defines ordering,
  uniqueness, positional, or authorization constraints on roles; a policy that trusts a role
  MUST additionally constrain WHICH identity asserted it.
- **`source` is not bound to the chain.** The envelope `source` (RFC-0003) is self-asserted and
  is NOT a signable-chain-derived value; the only specified subject↔envelope consistency check
  is classification-prefix alignment (RFC-0002). A validly-signed envelope may carry a `source`
  whose principal segment names a different principal than any stamp. Consumers MUST take the
  verified `signed_by` chain, never `source`, as the trust anchor for attribution.
- **The NATS subject is not signed.** `SIGNABLE_FIELDS` contains no subject; the subject an
  envelope rides is outside every signature. A receiver MUST NOT derive trust from the subject
  beyond the classification-prefix check RFC-0002 specifies.
- **Mutable carve-out is an unauthenticated, unbounded channel
  (`envelope/mutable-channels-unbounded-prose-only-trust`).** `correlation_id`, `economics`,
  and `extensions` are writable by any intermediary without invalidating a stamp, and carry no
  size bound. Any consumer decision on their contents is a trust decision on unsigned data and
  is forbidden (§4.2). Request-reply that correlates solely on the unsigned `correlation_id`
  (a transport concern) inherits this: a reply is not authenticated by correlation alone.

**Replay.** Two replay surfaces exist. (1) Freshness (§7.4) bounds naive replay to a
5-minute window but simultaneously makes archived/replayed signed envelopes unverifiable —
the unresolved tension is an open decision below. (2) Because the signable content does not
include a nonce or a subject binding, a stamp that verifies on one subject verifies on any
subject; anti-replay across subjects, if required, MUST be enforced by the consumer.

**Signature malleability (`signing-canon/base64-signature-malleable`).** See §6.2. The last
stamp's signature string is malleable (non-canonical base64) and unbounded in length; the
integrity of the *signed bytes* is unaffected, but envelope-level byte identity and dedup are.

**No key identifier forecloses rotation (`signing-canon/no-key-id-forecloses-rotation`).** A
stamp names only `identity`, never which key signed; the registry binds exactly one
`public_key` per identity, and key rotation and revocation are explicitly out of scope.
Rotating a key therefore invalidates every in-flight and archived envelope signed under the
old key, and there is no key-id/epoch slot on the wire. Retrofitting one would add a signable
field and thus change canonical bytes — coupling this problem to the H4 decision below.
Operators MUST treat a key as effectively permanent for the lifetime of any envelope that must
remain verifiable, and MUST NOT rely on revocation for compromise response.

**Calendar-blind timestamp (`signing-canon/at-timestamp-three-strictness-levels`).** The
deployed `at` grammar (Appendix A) is a digit-shape regex that admits month 13, day 40, and
hour 25; the same field is checked to three different strictness levels across the schema
(`format: date-time`, non-assertive by default), the envelope validator (regex only), and the
verifier (regex plus `Date.parse` finiteness). A wire-valid `at` can be verify-unparseable.
The single normative rule (calendar-valid ISO-8601) is a fix flagged in the open decisions,
not silently encoded here.

**Cross-repo drift (`signing-canon/cortex-chain-shim-drift`, `signing-canon/two-jcs-canonicalizers-unpinned`).**
cortex re-implements the `signed_by` normalization shim and already diverges on `null`/
primitive inputs (myelin returns `[]`; cortex returns a one-element chain containing the bad
value), and the ecosystem runs two independent JCS canonicalizers (myelin `src/jcs.ts`; cortex
`src/common/registry/canonical-json.ts`, which additionally hard-caps nesting depth) kept
byte-equivalent only by discipline. Conformance (§11) exists to end exactly this: each
implementation MUST run these vectors against its OWN code, never import the reference.

**Open decisions (recorded, not resolved).** Each is marked in place above and in the
document's `openDecisions`:

- **[OPEN DECISION — Andreas + JC — blocked on myelin `Plans/decision-1.0-canonicalization.md`
  (H4)]** The 1.0 canonicalization stance: freeze the signable-field vocabulary (Option A) vs
  canonicalize over stable field IDs (Option B). Until resolved, no stable bytes-to-sign
  contract can be frozen and every signable-field rename is a latent wire break.
- **[OPEN DECISION — Andreas + JC — no issue yet]** Canonical signature encoding (§6.2).
- **[OPEN DECISION — Andreas + JC — no issue yet]** Freshness vs replay semantics (§7.4).
- **[OPEN DECISION — Andreas + JC — blocked on cortex Phase D federation hub trust]** Hub-trust
  scope and vouching authority (§7.3).
- **[OPEN DECISION — Andreas + JC — no issue yet]** Verifier DoS bounds (chain-length cap and
  canonicalization depth/width caps).

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
metadata, not individual interior detail. The signed_by chain runs counter to that posture in
spirit: an envelope that crosses a principal boundary carries the full internal hop DIDs and
timings of the sending side. No artifact today specifies whether transit stamps MAY or SHOULD
be pruned, aggregated, or blinded at a boundary — and pruning a stamp breaks chain-commit for
every later stamp (§5.4), so blinding is not free. Whether and how to blind transit metadata at
a federation boundary is left open and SHOULD be addressed before the format is relied upon for
cross-principal privacy. This document does not invent a blinding scheme.

**Minimization guidance.** Because roles and identities are self-asserted labels, an
implementation SHOULD avoid placing personal or otherwise sensitive data in `identity` display
context, and MUST NOT place secrets anywhere in the signable projection (it is plaintext and
permanently archived alongside the signature).

---

## 11. Conformance

An implementation conforms to this document if and only if it passes every vector under the
path named in `vectors` (`specs/vectors/envelope-signing/`). Prose explains; **vectors bind.**

Per [`specs/CONFORMANCE.md`](../CONFORMANCE.md), a conforming implementation MUST run the
vectors against its **own** canonicalizer, signer, and verifier — it MUST NOT import the myelin
reference implementation to pass them, because that tests myelin, not the implementation. This
requirement is pointed: cortex currently imports `@the-metafactory/myelin/identity` for
verification and re-implements the chain shim and a second canonicalizer, so its signature
interop today rests on shared code, not on a binding artifact. Running these vectors against
cortex's own parser is what would surface the hub-stamp and chain-shim divergences recorded in
§9.

To claim conformance an implementation MUST demonstrate, via the vectors:

1. **Canonicalization** — byte-exact canonical output for the JCS profile (§3), the signable
   projection and the mutable carve-out (§4), number/sort normalization, and the
   single-object → array normalization (§4.3).
2. **Chain bytes** — byte-exact reconstruction of the §5.4 signing/verification bytes for both
   stamp 0 and a chain-committing stamp 1.
3. **Signing/verification** — a full sign→verify round trip for a two-stamp chain against a
   registry, and rejection of a chain in which any earlier stamp was tampered.
4. **Rejection** — the stable machine reasons for the negative cases.

**Stable rejection tokens.** A verifier/validator MUST map its internal failures to these
tokens (used in the vectors): `signature-too-short`, `unknown-signing-method`,
`at-not-iso8601`, `legacy-principal-key`, `unknown-principal`, `untrusted-hub`,
`stamp-signature-invalid`. Reasons are stable machine tokens, not human sentences.

Note that some vectors encode findings rather than desired behaviour (e.g.
`stamp/at-calendar-blind-accepted` MUST be accepted at the syntax layer because the deployed
grammar accepts it). These are marked in their `why`; a conforming implementation matches the
**deployed** behaviour until an open decision (§9) changes it through the wire-change procedure.

**Changing the wire.** Any change to the canonicalization scheme, the signable field set, the
method or role enumerations, or the signature encoding is an encoding change. It MUST follow
the procedure in [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and compass
`sops/federation-wire-protocol.md`: a new RFC (`Updates:`/`Obsoletes:`), both signatures, a new
schema version where applicable, a dual-accept window, and a named retirement release.

---

## 12. References

### 12.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC4648] Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014.
- [RFC8032] Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Draft. Source of the `did` terminal used by `identity` and `stamped_by`.
- [RFC-0003] metafactory, "Envelope", Draft. Owner of the envelope field inventory, the stamp JSON structure, and `spec_version`.

### 12.2. Informative References

- [RFC-0002] metafactory, "Subject Namespace", Draft. The NATS subject is not signed; its grammar is referenced only in the subject-binding finding (§9).
- myelin `docs/identity.md`, `docs/envelope.md` — the informative prose this RFC's signing/canonicalization sections supersede (`supersedes_prose`).
- myelin `Plans/decision-1.0-canonicalization.md` — the H4 decision memo; the first open decision (§9) is blocked on it.
- compass `sops/federation-wire-protocol.md` — the cross-repo wire-change procedure, including the dual-accept window.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named
in `grammar` (`specs/grammar/envelope-signing.abnf`) is the source of truth and is what CI
validates. This grammar covers only the lexical syntax of a stamp's value-carrying fields; the
canonicalization ALGORITHM (§3–§6) is procedural and is not, and cannot be, expressed as ABNF.

```abnf
; specs/grammar/envelope-signing.abnf
; RFC-0004 — Envelope Signing and Canonicalization
; Status: Draft. NOT normative until Ratified (specs/README.md).
;
; Identifier terminals (did, did-prefix, method-specific-id) are defined ONCE
; in RFC-0001 (specs/grammar/identifiers.abnf) and REFERENCED here. Core rules
; ALPHA, DIGIT are from RFC 5234 Appendix B. Case-sensitive literals use the
; %s form of RFC 7405.

; 1. Signing method — src/identity/types.ts:25  "ed25519" | "hub-stamp"
signing-method  = %s"ed25519" / %s"hub-stamp"

; 2. Stamp role (OPTIONAL, self-asserted) — src/identity/types.ts:51-56
stamp-role      = %s"origin" / %s"transit" / %s"accountability"
                / %s"sovereignty" / %s"notary"

; 3a. Signature — DEPLOYED grammar. BASE64_RE (src/identity/types.ts:2)
;     /^[A-Za-z0-9+/]+=*$/ + schema minLength:88. STANDARD alphabet, not
;     url-safe. Pins no upper length and no canonical encoding — findings,
;     RFC-0004 §6.2 / §9.
signature       = 1*base64-char *"="
base64-char     = ALPHA / DIGIT / "+" / "/"

; 3b. canonical-signature — the exactly-88-char canonical form (86 base64
;     chars + "=="); the 86th char carries 2 significant + 4 zero bits.
;     PRESENTED for the OPEN DECISION (§9), NOT the deployed accept-grammar.
canonical-signature = 85base64-char final-quantum-2bit "=="
final-quantum-2bit  = %s"A" / %s"Q" / %s"g" / %s"w"

; 4. Stamp timestamp `at` — ISO8601_RE (src/identity/verify.ts:20):
;    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
;    CALENDAR-BLIND (admits month 13, day 40, hour 25 — RFC-0004 §9).
;    "T" and "Z" are UPPERCASE-ONLY.
at              = full-date %s"T" full-time
full-date       = 4DIGIT "-" 2DIGIT "-" 2DIGIT
full-time       = partial-time time-offset
partial-time    = 2DIGIT ":" 2DIGIT ":" 2DIGIT [ "." 1*DIGIT ]
time-offset     = %s"Z" / ( ( "+" / "-" ) 2DIGIT ":" 2DIGIT )

; 5. Stamp DID fields — did is RFC-0001; referenced, never redefined.
;    stamp-identity   = did      ; every stamp
;    stamp-stamped-by = did      ; hub-stamp only
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/envelope-signing/`, so an implementation in any
language can consume them. This appendix reproduces the interop-deciding subset and the key
material; it is not the only copy. See [`specs/vectors/README.md`](../vectors/README.md) for
the schema. Every vector carries a `why`.

**Key material (test-only; deterministic).** Ed25519 seeds are fixed byte patterns so that
signatures are reproducible.

| Identity | Type | Seed (base64, 32 bytes) | Public key (base64, 32 bytes) |
|---|---|---|---|
| `did:mf:echo` | agent | `AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=` (0x01×32) | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=` |
| `did:mf:hub.metafactory` | hub | `AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=` (0x02×32) | `gTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5Q=` |

**Interop-deciding examples.**

- Unsigned canonical bytes (the SIGNABLE_FIELDS projection + JCS sort):

  ```
  {"id":"550e8400-e29b-41d4-a716-446655440000","payload":{"pr":42,"verdict":"approved"},"source":"metafactory.echo.local","sovereignty":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"timestamp":"2026-05-07T12:00:00Z","type":"review.completed"}
  ```

- Stamp 0 signing bytes (echo, role `origin`, `at=2026-05-07T12:00:00Z`) →
  Ed25519 signature `tK+CZ4Xb9WJ5cxE1RbldV+FOrqxLx7FgZIMHTZCBVStA0705NQHUumg7Lq0m3vrZS4GNcns7L3EaxzgWYmSgBA==`.

- Stamp 1 signing bytes (hub, role `accountability`, `at=2026-05-07T12:00:05Z`; includes
  stamp 0 **with** its signature) →
  Ed25519 signature `o6iTuFJX/SvNH4sbyDwFA3JXKRYfUqeazvSNUUM8/D3k/VvU6+UoOmBiE6VcS4/DHhabDyKEA0+WZZoWvOSTDg==`.

- Verifying the two-stamp chain against a registry holding both public keys yields
  `verified`, chain length 2, principal `did:mf:hub.metafactory`. Flipping stamp 0's `role`
  to `sovereignty` after signing yields `rejected` at stamp 0 (`stamp-signature-invalid`).

Adversarial/masking vectors included in the set: the mutable-carve-out masking case
(`correlation_id`/`economics`/`extensions` present but excluded, bytes equal the unsigned
case); the single-object → array normalization; the number/sort normalization; short/over-long
and non-canonical signature notes; the calendar-blind `at`; the dropped `principal` key; the
unknown method. The verification vectors disable the freshness window because it is
wall-clock-dependent and is itself an open decision (§9).

## Appendix C. Change Log

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Codifies the JCS profile, SIGNABLE_FIELDS, the chain-commit/slice rule, the two signing methods and hub-trust resolution, and the freshness window, all against `myelin origin/main`. Records nineteen findings from the wire-protocol audit; five carried as explicit open decisions (H4 canonicalization stance, canonical base64, freshness-vs-replay, hub-trust scope, verifier DoS bounds). Ships deterministic Ed25519 interop vectors generated from the reference implementation. |

## Acknowledgments

Grounded in the wire-protocol audit (dimension `signing-canon`) and the reference
implementation on `myelin origin/main` (`src/jcs.ts`, `src/identity/*`). The H4 analysis is
owed to `Plans/decision-1.0-canonicalization.md`.

## Authors' Addresses

Luna — metafactory.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/