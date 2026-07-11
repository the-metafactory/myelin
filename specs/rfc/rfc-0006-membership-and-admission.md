---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0006
title: Membership and Admission
status: Draft                   # Draft | Proposed | Ratified | Obsoleted
category: Standards Track       # Standards Track | Informational | Best Current Practice
obsoletes: []                   # RFC numbers only; the specs/admission.md relabel is prose (§11 + OD-1)
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories: []                 # Ratification REQUIRES: the principal AND the hub custodian
created: 2026-07-12
ratified: null
grammar: specs/grammar/admission.abnf
vectors: specs/vectors/admission/
generated:                      # artifacts DERIVED from `grammar`; none regenerated into myelin yet
  - []
supersedes_prose: []            # no myelin membership doc exists to promote; the ADRs remain informative (§15.2)
---

# RFC-0006: Membership and Admission

## Abstract

This document specifies the **membership admission protocol** by which a sovereign
peer stack becomes a recognized member of a metafactory federation network's roster:
the flow `register → PENDING → admit / reject → seal → authorize → revoke / depart`.
It defines the wire artifacts that cross the principal boundary — the `AdmissionStatus`
lifecycle enum, the `AdmissionRequest` record, the admission `request-id` and
`requested-scope` identifiers, the Ed25519-signed admission decision claim and its
canonical byte profile, the opaque sealed-secret envelope that carries a member's leaf
transport credential, and the `hub_authorized_at` liveness stamp — together with the
two-party authority gate (a registry-admin admits; a hub-admin seals) that governs
them.

This contract exists today only as consumer implementation code in the cortex
network-registry plus a set of cortex architecture decision records; it has no
specification or schema in myelin. This document promotes that de-facto contract to a
normative myelin wire specification. It also records that the existing `specs/admission.md`
is mislabelled: that document is the *substrate rate-limit* contract, a distinct concern,
and is relabelled accordingly here.

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
2. The Two Admissions — a Naming Correction
3. Transport and Trust Model
4. The Membership Lifecycle
5. The AdmissionRequest Record
6. Identifier Syntax
7. The Signed Admission Decision Claim
8. Sealed-Secret Delivery and Hub Authorization
9. Member Proof-of-Possession Reads
10. The Control Channel (Reference Route Surface)
11. Registry Considerations
12. Security Considerations
13. Privacy Considerations
14. Conformance
15. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

A metafactory **network** is a federation of principals whose stacks interconnect at the
NATS leaf-node layer. A private network needs a gate on *who* is admitted to its roster.
That gate is the **membership admission protocol**: a sovereign newcomer registers their
stack pubkey with the network registry, requests admission, an admin approves them onto the
roster, a hub custodian seals them a leaf transport credential, and the newcomer's leaf link
comes up. Members can later be revoked (kicked) by the hub or depart (leave) of their own
accord.

This protocol is **built and deployed** — as HTTPS control-plane routes on the cortex
network-registry Cloudflare Worker, admin-signed decision claims, an opaque sealed-secret
delivery channel, and cortex architecture decision records ADR-0015, ADR-0018, ADR-0019 and
ADR-0020 — but it has **no myelin specification, no schema, no ABNF and no vectors**. Its wire
contract is exactly the "independent implementation of an unspecified grammar" condition that
[`specs/CONFORMANCE.md`](../CONFORMANCE.md) says this RFC series exists to end. Any second
implementation (a non-cortex M7 surface, a third-party principal's own registry client) must
reconstruct the enum tokens, the canonical byte profile, the sealed envelope shape and the
authority split from reading TypeScript.

**This document does not solve.** It does not redesign the protocol; it codifies the wire as
it is. Where the audit that motivated this RFC found a defect, that defect is called out — as
a Security Consideration (§12) and an Open Decision — never silently encoded as intended
behaviour. In particular this RFC does **not** resolve: the identifier terminal grammar
(inherited from RFC-0001, blocked on cortex#1880); the decision-claim binding scope; the
canonicalization profile pin; or the v1-PSK envelope retirement. Each is marked
**[OPEN DECISION]** in place.

**What this document makes normative.** The `AdmissionStatus` enum, the `AdmissionRequest`
record shape, the `request-id` and `requested-scope` grammars (Appendix A), the signed
admission-decision claim and its canonical bytes, the sealed-secret envelope (v1 and v2), and
the `hub_authorized_at` semantics. The transport substrate that carries these (HTTPS to the
registry, versus a NATS subject) is described in §3 but is not itself the contract — the
**bytes that cross the principal boundary** are.

The membership admission protocol references identifier terminals owned by **RFC-0001**
(Identifiers and Identity — `principal-id`), the subject namespace of **RFC-0002** (Subject
Namespace — the `federated.` prefix and subtree wildcard), and the envelope date-time and
signature primitives of **RFC-0003** (Envelope). It does not redefine them.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.2. Terminology

- **Membership admission** — the protocol this RFC specifies: making a sovereign peer stack a
  recognized member of a network roster. Distinct from *rate-limit admission* (see §2).
- **Network** — a federation of principals whose stacks interconnect at the NATS leaf layer.
- **AdmissionRequest** — the persisted metadata record a verified registration creates (§5).
  It mints nothing and carries no readable secret.
- **AdmissionStatus** — the lifecycle enum: `PENDING`, `ADMITTED`, `REJECTED`, `REVOKED`,
  `DEPARTED` (§4.1).
- **Registry-admin** — the authority whose Ed25519 key is on the registry admin allowlist
  (global `REGISTRY_ADMIN_PUBKEYS` or a per-network allowlist, RFC-0020 territory). Signs the
  admit / reject decision. **Mints nothing.**
- **Hub-admin** — the authority whose key is on the hub-admin allowlist
  (`REGISTRY_HUB_ADMIN_PUBKEYS`, falling back to `REGISTRY_ADMIN_PUBKEYS` when the two collapse
  into one principal). Mints the per-member leaf secret, writes the hub `authorization` entry,
  seals the bearer copy, and stamps `hub_authorized_at`.
- **Two-party gate** — the ADR-0015 / ADR-0018 separation of registry-admin (roster) from
  hub-admin (transport). For the `metafactory` network both collapse operationally into one
  concierge agent (Luna via FleetAdmit), but the two authorities stay separable in the contract.
- **Member proof-of-possession (PoP)** — an operation authorized purely by an Ed25519
  signature over the claim with the member's registered `peer_pubkey`; no admin key, no
  allowlist. The signature *is* the authorization.
- **Roster** — a network's `members[]`, sourced from `ADMITTED` rows (ADR-0018 Q3), never
  derived from announced capabilities.
- **Sealed-secret envelope** (`LeafSecretEnvelope`) — the small UTF-8 JSON object, sealed to a
  member's pubkey with libsodium `crypto_box_seal`, that carries the member's leaf transport
  credential (§8). The registry holds only the opaque ciphertext.
- **Leaf secret** — the transport auth material inside the envelope: a per-member PSK (v1) or a
  scoped-user `.creds` file (v2, ADR-0023). It is a *transport* credential, not an *identity*
  credential (ADR-0013 / ADR-0018).
- **`hub_authorized_at`** — the ISO-8601 timestamp the hub owner stamps once they have applied
  the member's leaf `authorization` entry on their own hub (§8.2).
- **`requested_scope`** — the NATS subject subtree the peer requests: `federated.{principal}.>`.
- **`request-id`** — the AdmissionRequest primary key: 32 lowercase hex digits (§6.1).

---

## 2. The Two Admissions — a Naming Correction

The word "admission" names **two different protocols** in the metafactory stack, and only one
of them has ever had a myelin document. This RFC is about the first; the second is a distinct
concern that this RFC does **not** specify.

| | This RFC (RFC-0006) | The rate-limit contract |
|---|---|---|
| Concern | **Membership** — who is on a network roster | **Substrate throttling** — how fast a stack may dispatch |
| Wire | Control-plane HTTPS to the registry; signed claims; sealed blobs | NATS-KV shared state; token buckets; CAS |
| Home today | cortex network-registry code + ADR-0015/18/19/20 | `specs/admission.md` (v1.0.0, Status Draft) |
| Lifecycle | `PENDING → ADMITTED → REVOKED/DEPARTED` | `rate.*` / `inflight.*` counters, refusal → `not_now` |

The scaffold index ([`specs/README.md`](../README.md), "Prose that is not (yet) normative")
lists `admission.md` as "admission flow" — a **mislabel**: that document is the rate-limit
contract, not the membership flow. (The merged repository `README.md` indexes it correctly as
"Substrate admission contract — KV-arbitrated rate limiting".)

This document therefore **relabels** `specs/admission.md`. That document MUST be retitled to
name it unambiguously the *substrate rate-limit* contract, and it MUST be allocated its own
Standards-Track RFC number so it stops living as a Draft that a consumer already grounds on
(cortex `src/bus/admission/state.ts` cites its §4–§5 normatively — a violation of the
"ground only on Ratified" rule). This relabel and re-homing is
**[OPEN DECISION — Andreas + JC — blocked on allocating an RFC number in specs/README.md for the rate-limit contract]**
(OD-1). This RFC does not `obsoletes:` it, because it does not replace its technical content;
the two protocols are siblings, not successor and predecessor.

> Where a Security Consideration below concerns the rate-limit half (the unsigned KV entries,
> the charset coercion of KV key segments), it is included because those id-coercion collisions
> occur on identifiers this RFC's membership protocol also derives from the same principal ids.

---

## 3. Transport and Trust Model

### 3.1. The control channel is HTTPS to the registry, not a NATS subject

Unlike the envelope (RFC-0003) or a subject (RFC-0002), the membership admission protocol does
**not** ride the NATS bus. It is a set of HTTPS routes on the network-registry service
(§10). The interoperability surface is therefore not a subject grammar but the **request and
response bodies** — the signed claims, the `AdmissionRequest` JSON, and the sealed envelope —
which two independent principals' deployments MUST agree on byte-for-byte. An implementation
MAY host these routes on any transport that preserves the bodies; the bodies are the contract.

Every registry `GET` that returns a record returns it wrapped in a registry-signed assertion
(`SignedAssertion<T>`), and a client MUST verify that assertion against the pinned registry
pubkey before trusting it. That envelope is RFC-0002/RFC-0003 territory and is referenced, not
redefined, here.

### 3.2. Two separable authorities (the two-party gate)

Per ADR-0015 §2 and ADR-0018 Q5, admission is a **two-party** act, and the two authorities
MUST stay separable in the contract even where one principal holds both:

1. **Registry-admin.** Signs the admit / reject decision, transitioning `PENDING → ADMITTED`
   or `PENDING → REJECTED`. It **MUST mint no secret**. Admission gates roster membership only.
2. **Hub-admin.** Mints the per-member leaf secret, writes the member's hub `authorization`
   entry, reloads the hub, seals the bearer copy onto the row (§8.1), and stamps
   `hub_authorized_at` (§8.2). The admit route is **not** the seal route.

For the `metafactory` network both authorities collapse operationally into one concierge agent
(Luna, run under the FleetAdmit procedure), and the hub-admin allowlist falls back to the
registry-admin allowlist. Implementations MUST keep the two gates code-separable so a network
whose registry-admin is not its hub host still functions.

A third authority appears at the roster edges: **member proof-of-possession** (§9). A member's
own Ed25519 key authorizes reads of their own rows and the `depart` write, with no admin key
involved.

---

## 4. The Membership Lifecycle

### 4.1. AdmissionStatus

The lifecycle enum has exactly five tokens. They are RESERVED (§11), case-sensitive, and an
unknown token is a FAULT — a parser MUST NOT coerce it to the nearest state.

```abnf
admission-status = "PENDING" / "ADMITTED" / "REJECTED" / "REVOKED" / "DEPARTED"
```

| Token | Meaning |
|---|---|
| `PENDING` | Registered and requesting admission; awaiting a decision. |
| `ADMITTED` | Approved onto the roster. The one state that confers membership. |
| `REJECTED` | An admin declined the request (terminal). |
| `REVOKED` | The hub-admin kicked a formerly-admitted member (terminal). |
| `DEPARTED` | A member left of their own accord (terminal). |

`REVOKED` (kicked) and `DEPARTED` (left) MUST remain distinct terminal states: the roster and
the audit surface distinguish an eviction from a voluntary departure.

### 4.2. Transitions

```
   register
  (member-signed)                 admit                 seal / authorize
     ──────────▶  [PENDING]  ─────────────────▶  [ADMITTED]  ────────────▶ [ADMITTED]
                     │       (registry-admin)        │  (hub-admin, in place)
                     │ reject                        │
                     │ (registry-admin)              ├── revoke  (hub-admin)  ──▶ [REVOKED]
                     ▼                               │
                 [REJECTED]                          └── depart  (member PoP) ──▶ [DEPARTED]
```

Normative transition rules:

- **`register` creates `PENDING`.** A verified stack registration (member-signed) MUST, as a
  side effect, upsert a `PENDING` AdmissionRequest keyed on `(principal_id, peer_pubkey,
  network_id)`. The upsert MUST be idempotent: re-registering the same triple MUST return the
  existing row, not insert a duplicate. If the upsert fails, the registration MUST NOT be
  rejected (the principal record is already committed), and the failure MUST NOT be silent —
  the implementation MUST surface it (a structured error log AND a non-fatal warning on the
  register response) so a monitor can re-raise the missing `PENDING` row.
- **`admit` / `reject`** MUST be authorized by a registry-admin signed decision (§7) and MUST
  apply only to a `PENDING` row. A decision on an already-decided row MUST return
  `409 already_decided`. `admit` yields `ADMITTED`; `reject` yields `REJECTED`.
- **`seal` and `authorize`** MUST apply only to an `ADMITTED` row (`409 not_admitted`
  otherwise). Neither changes the status; each stamps a field (`sealed_secret`,
  `hub_authorized_at`). Both MUST be authorized by a hub-admin signed claim (§8).
- **`revoke`** MUST be authorized by a hub-admin signed claim, MUST apply only to an `ADMITTED`
  row (`409 not_admitted` otherwise), MUST transition `ADMITTED → REVOKED`, and MUST clear both
  `sealed_secret` and `hub_authorized_at`. Re-revoking an already-`REVOKED` row MUST be
  idempotent (`200`).
- **`depart`** MUST be authorized by member proof-of-possession over the row's `peer_pubkey`
  (§9), MUST additionally enforce that the proven key equals the row's stored `peer_pubkey`
  (else `403`; a member MUST NOT depart another member's row), MUST transition
  `ADMITTED → DEPARTED`, and MUST clear `sealed_secret`. Re-departing an already-`DEPARTED` row
  MUST be idempotent (`200`); a non-`ADMITTED` row MUST return `409`.
- `REJECTED`, `REVOKED` and `DEPARTED` are terminal. A re-transition out of a decided state is
  forbidden.

---

## 5. The AdmissionRequest Record

The persisted record. It carries **no credentials and mints nothing**; the sole secret-bearing
field, `sealed_secret`, holds only opaque ciphertext (§8, §12).

| Field | Type | Rule |
|---|---|---|
| `request_id` | `request-id` (§6.1) | Primary key. 32 lowercase hex digits. |
| `principal_id` | `principal-id` (RFC-0001) | The principal requesting admission. |
| `peer_pubkey` | `ed25519-pubkey` (base64) | The peer stack's key. `(principal_id, peer_pubkey)` is unique — re-registration returns the existing row. This is the key that federated envelopes from this peer are verified against. |
| `requested_scope` | `requested-scope` (§6.2) | The NATS subtree requested, `federated.{principal}.>`. |
| `network_id` | network id, or `null` | The target network. `null` only for rows migrated from the pre-ADR-0015 issuance table; new rows always carry it. |
| `status` | `admission-status` (§4.1) | Lifecycle state. |
| `created_at` / `updated_at` | ISO-8601 UTC (RFC-0003) | Creation / last-decision timestamps. |
| `granted_by` | `ed25519-pubkey`, or `null` | The admin pubkey that admitted or rejected. `null` while `PENDING`. |
| `sealed_secret` | `sealed-secret` (base64), or `null` | The opaque sealed leaf-secret envelope (§8.1). `null` until a hub-admin delivers it; `null` again after revoke / depart. |
| `hub_authorized_at` | ISO-8601 UTC, or `null` | Stamped by the hub owner (§8.2). `null` until authorized; cleared to `null` on revoke / depart. |

An implementation MUST treat `sealed !== null` as a delivery *signal only* on any read seam
(§9) and MUST NOT serve the ciphertext in a metadata read. An implementation MUST NOT fabricate
a `null` `network_id` into a default network, nor a missing `sealed_secret` into an empty one.

---

## 6. Identifier Syntax

The complete grammar is Appendix A / [`specs/grammar/admission.abnf`](../grammar/admission.abnf).
This section is prose over it. Identifier terminals owned by RFC-0001 (`principal-id`) and the
subject structure of RFC-0002 are referenced, not redefined.

### 6.1. request-id

```abnf
lower-hex   = DIGIT / %x61-66        ; 0-9 / a-f (lowercase only)
request-id  = 32lower-hex
```

A `request-id` MUST be exactly 32 lowercase hexadecimal digits with no dashes — a 16-byte UUID
rendered dashless. A parser MUST reject the dashed 8-4-4-4-12 UUID form and MUST reject
uppercase digits; two casings or two renderings of one UUID MUST NOT address two rows. This
transcribes `REQUEST_ID_RE` (`/^[0-9a-f]{32}$/`) in the registry. The `request-id` is an opaque
key, not a capability — knowing it grants nothing; every mutation is separately authority-gated.

### 6.2. requested-scope

```abnf
requested-scope = "federated." principal-id ".>"
```

A `requested-scope` is the reserved case-sensitive `federated.` prefix, one `principal-id`
(RFC-0001), and the REQUIRED `.>` subtree-wildcard tail. It transcribes the registry's
`federated.${principalId}.>` construction. Because the segment delimiter is `.` (not `-`), a
hyphen-bearing principal is unambiguous here — this is *not* subject to the
`did:mf:{principal}-{stack}` hyphen-separator collision that RFC-0001 records; see §12. A parser
MUST NOT accept a scope missing the `.>` tail as a subtree grant (a bare prefix is a narrower,
different subject).

> The `AdmissionRequest.requested_scope` field documentation in the registry types names the
> pattern `federated.<peer_slug>.>`; the construction site builds `federated.${principal_id}.>`.
> The grammar pins the constructed form. The `peer_slug` phrasing is a documentation drift.

### 6.3. base64 tokens

`peer_pubkey`, `granted_by`, `admin_pubkey`, `hub_admin_pubkey`, `signature`, and
`sealed_secret` are STANDARD base64 (RFC 4648 §4). The deployed alphabet
(`/^[A-Za-z0-9+/]+=*$/`) is **non-canonical** — see §12 "Malleable base64". Byte lengths (32
for a pubkey, 64 for a signature) are a verify-time semantic constraint, not a syntactic one.

---

## 7. The Signed Admission Decision Claim

### 7.1. Claim shape

The registry-admin authorizes `admit` / `reject` with a signed claim:

```jsonc
// SignedAdmissionDecision
{
  "claim": {
    "request_id": "0123456789abcdef0123456789abcdef",  // MUST equal the target row's id
    "decision":   "admit",                              // "admit" / "reject"
    "admin_pubkey": "<ed25519-pubkey, base64>",         // the signing admin's key
    "issued_at":  "2026-07-12T00:00:00Z",               // ISO-8601 UTC, clock-skew bounded
    "nonce":      "<opaque replay nonce>"
  },
  "signature": "<ed25519-signature over canonicalJSON(claim), base64>"
}
```

The registry MUST verify the signature over `canonicalJSON(claim)` (§7.2) against
`claim.admin_pubkey`, MUST check that key against the admin allowlist (global, or the target
network's per-network allowlist — RFC-0020), MUST reject a replayed `nonce`, and MUST reject an
`issued_at` outside a bounded clock-skew window (the deployment uses ±5 minutes). The gate order
is fail-closed: an empty allowlist MUST short-circuit to `503` before any body parse; signature
failure is `401`; unauthorized key is `403`; replayed nonce is `409`.

### 7.2. Canonicalization

The signed bytes are `canonicalJSON(claim)`: a recursive sort-keys JSON canonicalization —
object keys emitted in lexicographic order, arrays in order, no whitespace, `undefined`-valued
keys skipped. Both signer and verifier MUST produce byte-identical output. Appendix B pins the
exact bytes for a worked claim.

This profile is a **subset** of RFC 8785 (JCS): the reference canonicalizer deliberately
implements only the cases the registry signs (strings and small integers) and explicitly does
not implement RFC 8785's full numeric handling. Pinning the profile normatively — adopt RFC
8785 in full, or ratify this restricted profile — is
**[OPEN DECISION — Andreas + JC — blocked on myelin#31 (shared-canonicaliser migration into myelin, R26 phase 3)]**
(OD-3).

The canonicalizer MUST bound its own work before the signature is proven: it runs on
unauthenticated, attacker-controlled input (verify happens before the signature is checked). It
MUST enforce a maximum nesting depth, a maximum per-object key count, a maximum per-array
length, and a maximum aggregate node count, and MUST fail closed (map the resulting throw to
`401 signature_invalid`, never `500`) when any bound is exceeded. The deployed bounds are depth
64, 4096 keys per object, 4096 elements per array, and 200 000 total nodes. These are runtime
DoS guards, not format properties (§12).

### 7.3. Binding scope — a finding

The signed bytes bind `request_id`, `decision`, `admin_pubkey`, `issued_at` and `nonce`. They
**do not bind the admitted identity**: not `peer_pubkey`, not `principal_id`, not
`requested_scope`, not `network_id`. The `request_id` is an opaque handle; the mapping from that
handle to the row that actually carries the peer's key and scope is resolved **server-side** and
is not part of the signed message. An admin's signature therefore attests "admit the request
with this id" but does not cryptographically commit to *who* or *what scope* is being admitted.

The invariant that the admitted identity is the intended one is today held by the integrity of
the server-side `request_id → row` lookup and the immutability of a `PENDING` row's identity
fields — a **runtime property, not a format property**. Widening the claim to bind the admitted
identity, or ratifying the request_id-only binding as sufficient, is
**[OPEN DECISION — Andreas + JC — blocked on an unfiled cortex network-registry tracking issue]**
(OD-2). See §12.

---

## 8. Sealed-Secret Delivery and Hub Authorization

### 8.1. The sealed-secret envelope

After admission, the hub-admin delivers the member's leaf transport credential by **sealing a
small UTF-8 JSON envelope to the member's registered pubkey** with libsodium `crypto_box_seal`
(Ed25519 → X25519), and writing the resulting opaque ciphertext onto the `ADMITTED` row's
`sealed_secret` field via a hub-admin-signed write (§8.3). The registry stores only the
ciphertext; it MUST NOT be able to read it. Proof-of-possession is intrinsic — only the holder
of the member's private key can open the seal.

The sealed *plaintext* has two versions, discriminated by an integer `v`. A decoder MUST select
the payload variant by `v` and MUST NOT accept a `v`-blind "either field" reading — that would
let a hostile courier silently downgrade the payload type.

**v1 — transport PSK** (the sovereign / conf-mode-hub model, ADR-0018):

```jsonc
{
  "v": 1,
  "leaf_psk":  "<base64url>",          // REQUIRED, non-empty. The per-member transport PSK.
  "leaf_user": "andreas",              // REQUIRED, non-empty. The hub authorization username.
  "payload_key":     "<base64>",       // OPTIONAL. The ADR-0019 per-network payload key K.
  "payload_key_kid": "metafactory/k1"  // OPTIONAL. K's rotation-epoch key id.
}
```

**v2 — scoped-user credential** (the operator-mode model, ADR-0023 / epic cortex#1595):

```jsonc
{
  "v": 2,
  "creds":     "<verbatim NSC user .creds text>",  // REQUIRED, non-empty.
  "leaf_user": "andreas/meta-factory",             // REQUIRED. The subject the creds were minted for.
  "minted_at": "2026-07-12T00:00:00Z",             // REQUIRED. Parseable ISO-8601 mint time.
  "payload_key":     "<base64>",                    // OPTIONAL. Rides v2 unchanged.
  "payload_key_kid": "metafactory/k1"               // OPTIONAL. Rides v2 unchanged.
}
```

Normative decoder rules:

- A decoder MUST reject a `v` present but not a JSON number.
- A decoder MUST reject an envelope whose `v` is greater than the highest it understands, with a
  distinct "unsupported version" error (the remedy is to upgrade the software, not to treat it as
  corrupt). It MUST NOT guess a higher-versioned payload.
- A v1 decoder MUST reject an envelope missing `leaf_psk` or `leaf_user` (non-empty strings). A
  v2 decoder MUST reject one missing `creds`, `leaf_user`, or a parseable `minted_at`.
- A decoder MUST tolerate `payload_key` / `payload_key_kid` being present or absent, and MUST
  reject either being present but not a string.
- On any malformed envelope a decoder MUST fail closed and MUST NOT echo the plaintext in the
  error.

The ADR-0023 supersession means both v1 and v2 are live wire today; a decoder MUST accept both.
Whether v1-emit is retired behind a dual-accept window (per [`specs/CONFORMANCE.md`](../CONFORMANCE.md)
"Changing the wire") is **[OPEN DECISION — Andreas + JC — blocked on cortex#1595 and its retirement release]**
(OD-4).

> **Deferred guard (finding).** The v2 `leaf_user` field exists so a member can refuse a
> credential minted for a *different* subject (a courier sealing another member's real creds to
> this member). The decoder specified here validates only that the field is **present**; the
> identity-binding *comparison* is a separate, later guard (cortex#1597) that is not yet
> deployed. Until it lands, a member does not reject a subject-mismatched creds blob at decode
> time. See §12.

### 8.2. hub_authorized_at

`hub_authorized_at` records that the hub owner has applied the member's leaf `authorization`
entry on their own hub server — the real signal a guided join reads in place of an
honor-system attestation. It MUST be stamped only on a positive hub-resolver probe (never
blind), MUST be set only on an `ADMITTED` row, and MUST be cleared to `null` on revoke or
depart. That "positive probe only" property is enforced by the admit tooling, a **runtime
guard, not a format property** (§12).

### 8.3. The delivery write claims

Sealing (`sealed-secret`), authorizing (`authorize`) and revoking (`revoke`) are each carried
by a hub-admin-signed claim with the same gate as §7 but gated on the **hub-admin** allowlist:

```jsonc
// SealedSecretWriteClaim (the seal delivery)
{ "request_id": "...", "sealed_secret": "<base64 ciphertext>",
  "hub_admin_pubkey": "<ed25519-pubkey>", "issued_at": "...", "nonce": "..." }

// HubAuthorizeClaim (the hub-authorize stamp; issued_at becomes hub_authorized_at)
{ "request_id": "...", "hub_admin_pubkey": "<ed25519-pubkey>", "issued_at": "...", "nonce": "..." }

// AdmissionRevokeClaim (the eviction)
{ "request_id": "...", "hub_admin_pubkey": "<ed25519-pubkey>", "issued_at": "...", "nonce": "..." }
```

Each MUST be verified over `canonicalJSON(claim)` against `claim.hub_admin_pubkey`, checked
against the hub-admin allowlist, replay-checked on `nonce`, and clock-skew bounded. The
`sealed_secret` claim binds `request_id` and the opaque ciphertext but — like §7.3 — does **not**
bind the ciphertext to the row's `peer_pubkey`; the hub-admin is trusted to have sealed to the
correct key (§12).

---

## 9. Member Proof-of-Possession Reads

A joiner learns they are admitted and fetches their sealed blob without any admin key, via a
**member proof-of-possession** read. The member signs a claim with their registered private
key; the signature over `canonicalJSON(claim)` against `peer_pubkey` **is** the authorization.

- **Own-rows read** (`/admission-requests/mine`): releases exactly the rows whose stored
  `peer_pubkey` equals the verified claimed key. An `principal_id` field is echoed for audit but
  MUST NOT be the authority — the route queries by the proven `peer_pubkey`. No nonce (reads are
  idempotent); clock-skew applies.
- **Network-roster member read** (`/networks/{id}/roster/member`): releases a network's
  `ADMITTED` peer roster, but only to a caller who is themselves `ADMITTED` on that network. The
  `network_id` MUST be bound into the signed claim (not just the path) so a token minted for one
  network cannot be replayed against another; a claim whose `network_id` disagrees with the path
  MUST be rejected.
- **Depart write** (§4.2): the member PoP promoted to a state-transitioning write. It binds a
  `nonce` (unlike the idempotent reads) and MUST enforce own-row-only (`403` on a
  `peer_pubkey` that does not equal the target row's).

A metadata read (admin list, member read) MUST expose `sealed` only as a boolean delivery
signal and MUST NOT return the ciphertext; the ciphertext is served only to the member on their
own-rows read.

---

## 10. The Control Channel (Reference Route Surface)

The deployed control channel is nine HTTPS routes on the network-registry Worker. They are a
**reference surface**: an implementation MAY host equivalent operations on another transport,
but MUST preserve the request/response bodies (§3.1) and the authority + gate-order semantics
(§4, §7, §8, §9). The routes are informative; the bodies and semantics are normative.

| Route | Authority | Effect |
|---|---|---|
| `POST /principals/{id}/register` | member registration signature | Upsert principal record; side-effect upsert `PENDING` row. |
| `POST /admission-requests/{id}/admit` | registry-admin | `PENDING → ADMITTED`. |
| `POST /admission-requests/{id}/reject` | registry-admin | `PENDING → REJECTED`. |
| `POST /admission-requests/{id}/sealed-secret` | hub-admin | Set `sealed_secret` on an `ADMITTED` row. |
| `POST /admission-requests/{id}/authorize` | hub-admin | Stamp `hub_authorized_at` on an `ADMITTED` row. |
| `POST /admission-requests/{id}/revoke` | hub-admin | `ADMITTED → REVOKED`; clear sealed + authorized. |
| `POST /admission-requests/{id}/depart` | member PoP (own row) | `ADMITTED → DEPARTED`; clear sealed. |
| `GET /admission-requests[?status=]`, `GET /admission-requests/{id}` | registry-admin (signed read header) | Admin-gated queue enumeration (per-network read-scoped, RFC-0020). |
| `GET /admission-requests/mine` | member PoP | The caller's own rows (+ sealed blob). |

The `request-id` path parameter MUST be grammar-validated (§6.1) before any body parse or crypto.

---

## 11. Registry Considerations

- **RFC number.** `0006` is allocated in [`specs/README.md`](../README.md). Numbers are never
  reused.
- **Reserved enum tokens.** `PENDING`, `ADMITTED`, `REJECTED`, `REVOKED`, `DEPARTED` are
  reserved as the `AdmissionStatus` values (§4.1) and MUST NOT be repurposed. The pre-ADR-0015
  token `GRANTED` MUST NOT be honoured on this enum.
- **Reserved subject prefix.** The `federated.` subject prefix and the `.>` subtree tail in
  `requested-scope` (§6.2) are consumed from RFC-0002's namespace; this document reserves the
  `federated.{principal}.>` shape as the admission scope grammar.
- **Reserved decision tokens.** `admit`, `reject` (§7.1).
- **Sealed-envelope versions.** `v: 1` and `v: 2` are allocated (§8.1). A new payload shape MUST
  take the next integer and MUST NOT relax the `v`-discriminated selection.
- **Relabel of `specs/admission.md`.** That document is the substrate rate-limit contract, not
  the membership flow; it MUST be relabelled and allocated its own RFC number (OD-1).
- **External registries.** This document defines no DID method and registers nothing in the
  [W3C DID Specification Registries][did-registries]; its identifiers come from RFC-0001.

---

## 12. Security Considerations

This section is REQUIRED and is not empty. The threat model is a federation of mutually
sovereign principals: a registry that must be assumed *honest-but-a-target* (a compromise MUST
leak no readable secret), admins whose keys authorize roster and transport changes, and
unauthenticated callers who may flood any route.

Where an invariant is held by a **runtime check rather than by the grammar or the signed
bytes**, it is called out — an invariant held shut by vigilance is a finding, not a design.

- **Decision-claim binding scope (finding, OD-2).** The registry-admin's signature binds
  `request_id` + `decision` only; it does **not** bind the admitted identity (`peer_pubkey`,
  `principal_id`, `requested_scope`, `network_id`) — see §7.3. The property "the admin admitted
  the identity they intended" rests on the server-side `request_id → row` lookup and the
  immutability of a `PENDING` row's identity fields, **not** on the signed message. Any path that
  can alter a row's identity fields between decision-time and use, or substitute the row a
  `request_id` resolves to, defeats the admin's intent without breaking a signature. Appendix B
  vector `decision-claim/canonical-bytes-admit` pins that the signed bytes contain no
  `peer_pubkey`.

- **Sealed-secret custody.** The registry holds only the opaque `crypto_box_seal` ciphertext; it
  cannot read it, and a registry compromise leaks only ciphertexts (useless without member
  seeds). PoP is intrinsic. **However**, the seal-delivery claim (§8.3) binds `request_id` +
  ciphertext but not the target `peer_pubkey`: nothing in the signed bytes forces the hub-admin
  to have sealed to the row's registered key. Correct targeting is a **hub-admin trust
  assumption**, not a wire-enforced property.

- **Deferred subject-binding guard (finding).** The v2 envelope's `leaf_user` exists to let a
  member reject a credential minted for a different subject, but the identity-binding comparison
  is a later, not-yet-deployed guard (cortex#1597). Until it lands, a subject-mismatched creds
  blob is not rejected at decode time — a runtime guard that is *specified to exist but not yet
  present* (§8.1).

- **Charset-coercion collisions (finding, OD-5).** The rate-limit half derives KV key/bucket
  segments from principal ids by mapping any character outside `[a-zA-Z0-9_-]` to `-`
  (`keySegment()` / `clean()`) rather than rejecting it. This is a **defensive pass-through, not
  validation**: two distinct out-of-grammar principals collide onto one key (`a.b` and `a-b` both
  → `a-b`), and `_` — forbidden by both `principal-id` (RFC-0001) and the key charset `[a-z0-9-]`
  — passes through. A collision aliases two principals onto one shared counter. Appendix B
  vectors `admission-key/collision-dot-coerced-to-hyphen` and `admission-key/reject-underscore`
  pin the required *rejection*; the deployed coercion **fails** them, and that failure is the
  finding. The membership half derives `requested_scope` from the same principal ids, so the
  grammar (§6.2) MUST be enforced, not coerced, at that boundary too.

- **Unsigned rate-limit KV entries (finding).** The rate-limit half stores its token-bucket and
  in-flight entries as **unsigned** JSON in a shared KV bucket: any process with bucket write
  access can zero a victim's tokens or reset its own counters. Signed-KV (myelin#31) is named
  only as a future migration destination. This is out of scope for the membership contract but
  in scope for the relabelled rate-limit RFC (OD-1).

- **Malleable base64 (finding).** The pubkey / signature / ciphertext alphabet
  (`/^[A-Za-z0-9+/]+=*$/`, Appendix A §5) is non-canonical: it admits unbounded `=` padding and
  unconstrained final-symbol bits, so one 64-byte signature has many valid encodings. A field
  that a downstream consumer treats as an identity key MUST canonicalize the bytes (decode →
  fixed-length re-encode) before comparison; string equality on the base64 is unsafe.

- **Pre-authentication DoS on canonicalization.** The verifier canonicalizes attacker-controlled
  input *before* the signature is proven. The depth / width / node caps (§7.2) are the guard;
  they MUST fail closed to `401`, never `500`. These are runtime guards, not format properties.

- **Replay and clock skew.** Every state-transitioning claim (admit, reject, seal, authorize,
  revoke, depart) MUST bind a `nonce` checked against a replay cache and MUST be clock-skew
  bounded. Reads are idempotent and omit the nonce but remain skew-bounded so a captured read
  token cannot linger. The nonce MUST be recorded only on the authentic-and-authorized path, so a
  bad-signature or wrong-owner probe cannot burn a legitimate nonce.

- **hub_authorized_at integrity.** `hub_authorized_at` MUST be stamped only on a positive
  hub-resolver probe (§8.2) — a runtime guard in the admit tooling, not a format property. A blind
  stamp would let a guided join proceed against a hub that has not actually authorized the member.

- **Authority separation.** The two-party gate (§3.2) is enforced by two allowlists checked in
  code; it is not expressible in the claim grammar. Collapsing them (letting the admit route mint
  the secret) would place secret-minting behind the registry-admin gate — rejected by ADR-0018 Q5.

- **request-id is not a capability.** The 32-hex `request-id` is a high-entropy opaque handle;
  guessing it grants nothing because every mutation is separately authority-gated. It MUST NOT be
  treated as a bearer token.

---

## 13. Privacy Considerations

This document specifies identifiers (`request-id`, `principal_id`, `peer_pubkey`) and therefore
states what they observe and correlate.

- **The onboarding queue is admin-only.** The `GET /admission-requests` enumeration (which
  reveals `principal_id`, `peer_pubkey`, `requested_scope`, `network_id`, status) MUST be gated
  behind an admin signed-read; unauthenticated enumeration of who is trying to join MUST be
  impossible. A per-network admin's read MUST be forced to that network's rows only (RFC-0020),
  so one network's admin cannot enumerate another's queue.

- **`peer_pubkey` is a cross-network correlator by construction.** The same stack key is used to
  request admission to multiple networks, so an observer with cross-network read access can link
  a principal's presence across networks by pubkey. This is inherent to a stable-key trust model
  and is not mitigated at this layer.

- **`request-id` carries no PII** but does correlate a register response to the eventual admit —
  a party who observes both learns the timing of a principal's onboarding.

- **The sealed blob leaks nothing.** `sealed_secret` is opaque ciphertext; a metadata read
  exposes only a boolean `sealed` signal (§9). The ciphertext is released only to the member on
  their own-rows PoP read.

- **`hub_authorized_at` leaks liveness/timing** — when a member's hub authorization was applied.
  It is metadata visible to admins and (for their own row) the member.

- **Member PoP reads are minimal-disclosure.** The own-rows read releases only the caller's rows;
  the network-roster member read releases the admitted-peer list only to a fellow admitted member
  and nothing to a non-member.

---

## 14. Conformance

An implementation conforms to this document **if and only if it passes every vector** under the
path named in `vectors` ([`specs/vectors/admission/`](../vectors/admission/)). Prose explains;
vectors bind. See [`specs/CONFORMANCE.md`](../CONFORMANCE.md).

A conforming implementation MUST implement, and MUST agree with the vectors on, at least these
operations:

- `parseRequestId` — the §6.1 grammar (reject dashed / uppercase / wrong-length forms).
- `parseRequestedScope` — the §6.2 grammar (require the `.>` tail).
- `parseAdmissionStatus` — the §4.1 enum, case-sensitive, rejecting unknown and legacy tokens.
- `canonicalizeDecisionClaim` — the §7.2 canonical byte profile, byte-for-byte.
- `decodeLeafSecretEnvelope` — the §8.1 v1/v2 decode + fail-closed rejections.
- `admissionKeyPrincipalSegment` — the §6 / §12 requirement to **reject**, not coerce, an
  out-of-grammar id segment.

Where the deployed cortex implementation currently disagrees with a vector (the charset-coercion
vectors, §12 / OD-5), the implementation is the defect, per the precedence chain in
[`specs/CONFORMANCE.md`](../CONFORMANCE.md): the ABNF governs, the vectors decide, and the
implementation conforms or it is wrong.

---

## 15. References

### 15.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC4648] Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. *(Referenced by OD-3; the deployed profile is a documented subset — see §7.2.)*
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Draft. *(Owns `principal-id`; §6.)*
- [RFC-0002] metafactory, "Subject Namespace", Draft. *(Owns the `federated.` prefix and subtree wildcard; §6.2.)*
- [RFC-0003] metafactory, "Envelope", Draft. *(Owns the signed-assertion envelope, date-time, and signature primitives; §3.1.)*

### 15.2. Informative References

- cortex `docs/adr/0015-two-tier-onboarding-and-admission-gate.md` — the two-tier onboarding model and the `register → PENDING → admit` gate (mints nothing). Design rationale; this RFC is the normative home.
- cortex `docs/adr/0018-admission-gate-and-leaf-secret-distribution.md` — sealed-to-pubkey per-member secret custody (Q1 b′), roster-from-ADMITTED (Q3), member PoP read (Q4), two separable authorities (Q5), revoke/rotate (Q6). Transport-auth mechanism superseded by ADR-0023.
- cortex `docs/adr/0019-federated-payload-encryption.md` — the payload key K that rides the sealed slot (§8.1).
- cortex `docs/adr/0020-per-network-admin-authority.md` — who may sign admission decisions per network (§7.1, §13).
- cortex `docs/adr/0023-federation-leaf-credential-model.md` — the operator-mode scoped-user `.creds` model that superseded the v1 PSK (§8.1, OD-4).
- compass `sops/federation-wire-protocol.md` — operational summary; "PSK is a transport PSK, not an identity credential"; the wrong-hub sealing trap.
- `specs/admission.md` — the **substrate rate-limit** contract (relabelled here; §2, OD-1). Not this protocol.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in
`grammar` ([`specs/grammar/admission.abnf`](../grammar/admission.abnf)) is the source of truth and
is what CI validates. Terminal alphabets owned by RFC-0001 (`principal-id`) and core rules
`ALPHA` / `DIGIT` (RFC 5234 Appendix B) are imported, not redefined.

```abnf
; 1. request-id — /^[0-9a-f]{32}$/ (cortex network-registry validate.ts)
lower-hex         = DIGIT / %x61-66              ; 0-9 / a-f  (lowercase only)
request-id        = 32lower-hex

; 2. requested-scope — federated.{principal}.>  (cortex principals.ts)
fed-prefix        = %x66.65.64.65.72.61.74.65.64.2E   ; "federated." (case-sensitive)
scope-tail        = %x2E.3E                            ; ".>"
requested-scope   = fed-prefix principal-id scope-tail ; principal-id from RFC-0001

; 3. admission-status — the lifecycle enum (case-sensitive, reserved)
st-pending        = %x50.45.4E.44.49.4E.47            ; "PENDING"
st-admitted       = %x41.44.4D.49.54.54.45.44         ; "ADMITTED"
st-rejected       = %x52.45.4A.45.43.54.45.44         ; "REJECTED"
st-revoked        = %x52.45.56.4F.4B.45.44            ; "REVOKED"
st-departed       = %x44.45.50.41.52.54.45.44         ; "DEPARTED"
admission-status  = st-pending / st-admitted / st-rejected
                  / st-revoked / st-departed

; 4. decision — the admit/reject token
decision          = %x61.64.6D.69.74 / %x72.65.6A.65.63.74   ; "admit" / "reject"

; 5. base64 tokens (STANDARD base64; NON-CANONICAL — see Security Considerations)
base64-char       = ALPHA / DIGIT / "+" / "/"
base64            = 1*base64-char *"="           ; NOTE unbounded padding (finding)
ed25519-pubkey    = base64                       ; 32 bytes -> 44 chars incl. one "="
ed25519-signature = base64                       ; 64 bytes -> 88 chars incl. one "="
sealed-secret     = base64                       ; libsodium crypto_box_seal, opaque

; 6. sealed-plaintext leaf terminals (inside sealed-secret, after seal open)
base64url-char    = ALPHA / DIGIT / "-" / "_"
leaf-psk          = 1*base64url-char
leaf-user         = 1*( ALPHA / DIGIT / "-" / "_" / "/" / "." )
```

## Appendix B. Test Vectors

Vectors live as JSON under [`specs/vectors/admission/`](../vectors/admission/) so
implementations in any language can consume them. This appendix reproduces a representative
subset; the vector files are the source of truth. See [`specs/vectors/README.md`](../vectors/README.md)
for the schema. Every vector carries a `why`.

The starter set (22 vectors) includes the mandatory adversarial cases:

- **Masking case** — `admission-key/masking-in-grammar-identity`: the in-grammar principal
  `a-b` where the coercion `keySegment()` is the identity and so produces the right key,
  masking that the function coerces rather than validates.
- **Collision pair** — `admission-key/collision-dot-coerced-to-hyphen`: `a.b` and `a-b` both
  coerce to `a-b`, so two distinct principals share one KV key. The vector requires *rejection*;
  the deployed coercion fails it (§12, OD-5).
- **Legal-in-one-rendering** — `requested-scope/valid-hyphenated-principal`: a hyphen-bearing
  principal is unambiguous under the `.`-delimited scope grammar though it is the source of the
  `-`-join collision in RFC-0001.
- **Decision-claim binding scope** — `decision-claim/canonical-bytes-admit`: the pinned canonical
  bytes contain no `peer_pubkey`, evidencing §7.3.
- **Version-discriminated envelope** — v1 PSK, v1-with-payload-key, v2 creds decode; and the
  fail-closed rejections for a newer version, a missing `leaf_psk`, and a non-numeric `v`.

Representative reproduction:

```json
{
  "id": "decision-claim/canonical-bytes-admit",
  "rfc": 6,
  "kind": "canonicalizeDecisionClaim",
  "input": { "request_id": "0123456789abcdef0123456789abcdef", "decision": "admit",
             "admin_pubkey": "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDA=",
             "issued_at": "2026-07-12T00:00:00Z", "nonce": "a1b2c3d4e5f6a7b80011223344556677" },
  "expect": { "ok": true,
    "value": "{\"admin_pubkey\":\"Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDA=\",\"decision\":\"admit\",\"issued_at\":\"2026-07-12T00:00:00Z\",\"nonce\":\"a1b2c3d4e5f6a7b80011223344556677\",\"request_id\":\"0123456789abcdef0123456789abcdef\"}" },
  "why": "Pins the canonical-JSON profile the admission gate signs; the bytes bind only request_id + decision, not the admitted identity (§7.3)."
}
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here.
A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes the cortex membership admission contract (ADR-0015/0018/0019/0020 + network-registry types) to a normative myelin RFC. Defines `admission.abnf` (request-id, requested-scope, admission-status, decision, base64 + sealed-plaintext terminals) and a 22-vector starter set. Records six open decisions (OD-1 rate-limit relabel/RFC number; OD-2 decision-claim binding scope; OD-3 canonicalization profile; OD-4 v1-PSK envelope retirement; OD-5 charset-coercion rejection; and the RFC-0001-inherited identifier grammar, cortex#1880). Relabels `specs/admission.md` as the substrate rate-limit contract. |

## Acknowledgments

This RFC codifies decisions grilled by Andreas and recorded in cortex ADR-0015, ADR-0018,
ADR-0019, ADR-0020 and ADR-0023, and the operational discipline in compass
`sops/federation-wire-protocol.md`.

## Authors' Addresses

Luna (metafactory) — assistant author, on behalf of the principal.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/