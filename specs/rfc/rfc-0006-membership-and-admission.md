---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0006
title: Membership and Admission
status: Ratified                # Draft | Proposed | Ratified | Obsoleted
category: Standards Track       # Standards Track | Informational | Best Current Practice
obsoletes: []                   # RFC numbers only; the specs/admission.md relabel is prose (§11 + OD-1)
updates: []
authors:
  - name: Luna
    affiliation: metafactory
signatories:                    # Single-principal ratification (v1) per docs/adr/0001-single-principal-ratification.md.
  - name: Andreas               # Two-signature (adding the hub custodian) reinstates on a 2nd implementation or a live federated peer.
    affiliation: metafactory
created: 2026-07-12
ratified: 2026-07-14
grammar: specs/grammar/admission.abnf
vectors: specs/vectors/admission/
generated: []                   # artifacts DERIVED from `grammar`; none regenerated into myelin yet
openDecisions:                  # 1 live open decision after the grill — a scheduling item, not a wire question (§6 / BCP-0001 living-spec forcing function)
  - id: v1-psk-emit-retirement-date      # OD-4 — the release at which v1-PSK envelope-emit retires (§4.x marker; §"OD-4 scheduling"); tracked against BCP-0001
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

This document is `Ratified` (single-principal, 2026-07-14) under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md). Only a document with status
`Ratified` is normative; implementations MUST NOT ground behaviour on a `Draft` or `Proposed`
document. This document is normative and buildable-against; as a living spec it stays revisable if
review or use finds a hole — a correction is a new revision that the implementation re-tracks, not
an immutable freeze. The heavier discipline (two-signature ratification, `Updates: NNNN` for every
change) reinstates on a second independent implementation or a live federated peer.

This RFC ratifies **single-principal** under ADR-0001: the sole signatory is **the principal**
(recorded in `signatories`), mirroring how RFC-0001..RFC-0004 and BCP-0001 already ratified. The
front-matter line that formerly required "the principal AND the hub custodian" is **superseded by
ADR-0001**. The hub-custodian dimension survives only as a documented **REINSTATE trigger**: a
second, externally-held hub custodian, or a live federated peer, reinstates the two-party co-sign
requirement for the *next* RFC that touches this contract. Until then, one principal ratifies.

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

**This document codifies the wire, and resolves the bindings the audit flagged.** It does not
redesign the protocol; it codifies the wire as it is, and where the audit that motivated this RFC
found a binding defect the grill of 2026-07-14 closed it normatively rather than leaving it open.
Two former open decisions are now **resolved** in this revision: the **decision-claim binding
scope** — the registry-admin's signed claim now binds `peer_pubkey` AND `network_id` (§7.1/§7.3,
closing OD-2), and the hub-admin's seal claim binds the target `peer_pubkey` (§8.3, closing the
transport half) — and the **canonicalization profile**, which now cites RFC-0004 §3/§4.4 as the
canonicalization owner (§7.2, closing OD-3). One decision remains deferred and is marked
**[OPEN DECISION]** in place: the **v1-PSK envelope-emit retirement** date (OD-4), which a future
`Updates:` RFC schedules — both v1 and v2 stay decode-live now. Any residual defect is called out
as a Security Consideration (§12), never silently encoded as intended behaviour. The identifier
terminal grammar this RFC inherits is no longer
open: **resolved by RFC-0001** (the class-explicit dot-form `did:mf` grammar, decided
2026-07-12, pending JC co-signature — formerly the cortex#1880 block). The migration onto that
grammar is a coordinated **hard cut** per RFC-0001 §9 — one flag-day, no dual-accept window —
not a dual-accept transition; this RFC consumes RFC-0001's terminals as resolved.

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
  (global `REGISTRY_ADMIN_PUBKEYS` or a per-network allowlist — the authorization rule is §7.4).
  Signs the admit / reject decision. **Mints nothing.**
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
| Home today | cortex network-registry code + ADR-0015/18/19/20 | `specs/admission.md` (v1.0.0, Status Draft) → chartered home RFC-0010 |
| Lifecycle | `PENDING → ADMITTED → REVOKED/DEPARTED` | `rate.*` / `inflight.*` counters, refusal → `not_now` |

The scaffold index ([`specs/README.md`](../README.md), "Prose that is not (yet) normative")
lists `admission.md` as "admission flow" — a **mislabel**: that document is the rate-limit
contract, not the membership flow. (The merged repository `README.md` indexes it correctly as
"Substrate admission contract — KV-arbitrated rate limiting".)

This document therefore **relabels** `specs/admission.md`. The relabel is an **interim, decoupled
correction applied now** (D16): that document MUST be retitled to name it unambiguously the
*substrate rate-limit* contract, without waiting on RFC-0010 drafting — the mislabel is a live
hazard (cortex `src/bus/admission/state.ts` cites its §4–§5 normatively, a violation of the
"ground only on Ratified" rule) and is fixed independently. What remains pending is the
**re-homing**: the document's Standards-Track home is chartered as **RFC-0010 (Rate-limit &
refusal taxonomy)** (see `specs/rfc/PLAN.md`, REVISIONS C3) but not yet drafted, and the "cortex
grounds on a Draft" violation resolved as an **informative handoff** to RFC-0010 (D17).
**OD-1 is now CLOSED (2026-07-15):** RFC-0010 is Ratified and retitled `admission.md` to the
substrate rate-limit contract, listing it in its `supersedes_prose`; the re-homing is complete. This RFC does not `obsoletes:` `admission.md`, because
it does not replace its technical content; the two protocols are siblings, not successor and
predecessor.

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
  `ADMITTED → DEPARTED`, and MUST clear **both** `sealed_secret` **and** `hub_authorized_at` —
  symmetric with `revoke` and with the field rules of §5 and §8.2 (a departed member is no longer
  hub-authorized, so the liveness stamp MUST NOT survive the departure). Re-departing an
  already-`DEPARTED` row MUST be idempotent (`200`); a non-`ADMITTED` row MUST return `409`. The
  reference implementation already satisfies this (cortex `network-registry/src/store.ts` clears
  both fields on both the depart and revoke transitions); this clause aligns the spec up to that
  behaviour and to §5.
- `REJECTED`, `REVOKED` and `DEPARTED` are terminal **per key**. A re-transition out of a decided
  state is forbidden: there is **no** terminal→`PENDING` wire path in this protocol. Re-admission
  after a terminal decision is **key rotation**, not a state reset — the peer generates a fresh
  `peer_pubkey`, which mints a new `(principal_id, peer_pubkey, network_id)` triple and therefore a
  new `PENDING` row (§4.2 `register`); the old terminal row stays immutable and its audit trail is
  preserved. Any "admin reset" of a terminal row is out-of-band DB surgery, **not** a transition
  this contract defines, and a conforming implementation MUST NOT expose a route that performs one.

**The `ADMITTED` sub-lifecycle is DERIVED, not enumerated.** The `AdmissionStatus` enum stays
exactly five tokens (§4.1); it MUST NOT grow tokens for the stages *within* `ADMITTED`. The
progression an admitted member passes through — **unsealed** (`sealed_secret == null`) →
**sealed** (`sealed_secret != null`) → **hub-authorized** (`hub_authorized_at != null`) — is a
projection READ OFF field presence on the row, never a distinct enum value. A conforming
implementation that needs to display or gate on that sub-lifecycle MUST compute it from
`(sealed_secret, hub_authorized_at)` presence and MUST NOT introduce a sixth status token. This
keeps the status monotonic and keeps `seal`/`authorize` as field stamps that do not change
`status` (per the `seal`/`authorize` rule above).

**Covered-by-principal is a DERIVED READOUT state, scoped to the register read path.** When a
caller reads on the register path with the principal seed in hand (`--principal-seed`), an
implementation MAY surface a derived "covered by the principal's admission" readout — a
principal-level projection over the principal's admission rows — to fix the phantom-`PENDING`
readout (#1748 register half). This readout is a **display projection only**. It MUST NOT become a
join-gate input: there is no §9-safe read by which a second stack holding only its own key can
learn that its principal is covered, and the member-PoP own-rows read (`/mine`, §9) MUST keep its
`peer_pubkey`-only authority — it MUST NOT be widened to key on `principal_id`. The covered-by
readout is derived at read time on the seed-holding path and is never persisted as a status token
nor consulted to admit transport.

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
| `sealed_secret` | `sealed-secret` (base64), or `null` | The opaque sealed leaf-secret envelope for this row's stack (§8.1). `null` until a hub-admin delivers it; `null` again after revoke / depart. The delivery channel generalizes to a per-key `sealed_secrets[]` array (§8.1) so one per-principal admission can seal each covered stack; the single slot is this row's (per-`peer_pubkey`) projection of that array. |
| `hub_authorized_at` | ISO-8601 UTC, or `null` | Stamped by the hub owner (§8.2). `null` until authorized; cleared to `null` on revoke / depart. |

An implementation MUST treat `sealed !== null` as a delivery *signal only* on any read seam
(§9) and MUST NOT serve the ciphertext in a metadata read. An implementation MUST NOT fabricate
a `null` `network_id` into a default network, nor a missing `sealed_secret` into an empty one.

---

## 6. Identifier Syntax

The complete grammar is Appendix A / [`specs/grammar/admission.abnf`](../grammar/admission.abnf).
This section is prose over it. Identifier terminals owned by RFC-0001 (`principal-id`) and the
subject structure of RFC-0002 are referenced, not redefined.

Member identities are **KEYED-plane** identifiers under RFC-0001 §2.1: a member's
`principal_id` renders as `did:mf:principal.{p}`, and the stack it federates as
`did:mf:stack.{p}.{s}` — classes that carry an Ed25519 key and are resolvable in the keyed
registry. A self-asserted-plane DID (`did:mf:surface.{name}`, `did:mf:system.{name}`) carries
no key and MUST NOT appear as a member identity anywhere in this protocol.

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
`federated.${principalId}.>` construction. A hyphen-bearing principal is unambiguous here
because `principal-id` is kebab-strict (RFC-0001: `.` is illegal inside a segment) — the
property is carried by the kebab-strict rule, not by dot-separation alone. The legacy
`did:mf:{principal}-{stack}` hyphen-join collision is resolved by RFC-0001's class-explicit
dot-form (`did:mf:stack.{p}.{s}`); see §12. A parser
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
    "peer_pubkey": "<ed25519-pubkey, base64>",          // MUST equal the target row's peer_pubkey (§7.3)
    "network_id":  "<network id>",                      // MUST equal the target row's network_id (§7.3)
    "admin_pubkey": "<ed25519-pubkey, base64>",         // the signing admin's key
    "issued_at":  "2026-07-12T00:00:00Z",               // ISO-8601 UTC, clock-skew bounded
    "nonce":      "<opaque replay nonce>"
  },
  "signature": "<ed25519 over the §7.2 bytes-to-sign, base64>"
}
```

The claim binds the admitted identity: `peer_pubkey` and `network_id` are inside the signed
bytes, so the admin's signature cryptographically commits to *which* key on *which* network is
admitted (§7.3 states the enforcement rule). Both bound fields are **encoding-stable**:
`peer_pubkey` is a raw base64 Ed25519 key and `network_id` is a raw string — verified NOT
DID-encoded (cortex `src/common/registry/types.ts` types `network_id` as a plain `string`, never a
`did:mf` terminal) — so neither field's canonical bytes flip at the RFC-0001 §9 DID flag-day. The
widening therefore runs its **own** dual-accept window, decoupled from that flag-day (§7.3).

The registry MUST verify the signature over the §7.2 bytes-to-sign against
`claim.admin_pubkey`, MUST check that key against the admin allowlist authorized **for the claim's
bound `network_id`** (§7.4), MUST reject a replayed `nonce`, and MUST reject an `issued_at` outside
a bounded clock-skew window (the deployment uses ±5 minutes). The gate order is fail-closed: an
empty allowlist MUST short-circuit to `503` before any body parse; signature failure is `401`;
unauthorized key is `403`; replayed nonce is `409`; and an identity mismatch on the bound fields is
`409 identity_mismatch` (§7.3).

### 7.2. Canonicalization

The signed bytes are the RFC-0004 **bytes-to-sign** — `CONTEXT_TAG || UTF-8(canonicalJSON(claim))`
(RFC-0004 §3/§4.4) — where `canonicalJSON(claim)` is a recursive sort-keys JSON canonicalization:
object keys emitted in lexicographic order, arrays in order, no whitespace, `undefined`-valued
keys skipped. The `CONTEXT_TAG` domain-separation prefix is REQUIRED — a signature computed over
the bare `canonicalJSON(claim)` without it is NOT a valid admission signature (it defeats the
cross-protocol domain separation RFC-0004 mandates). Both signer and verifier MUST produce
byte-identical output. Everywhere this document says a signature is taken or verified "over the
§7.2 bytes-to-sign," it means exactly this prefixed form. Appendix B pins the exact bytes for a
worked claim.

**Canonicalization is owned by RFC-0004 (Ratified).** The decision claim and the seal/authorize
claims (§8) are RFC-0004-canonicalized signed claims: the canonical byte profile and the
signature-domain separator are RFC-0004's, not this document's. An implementation MUST canonicalize
per RFC-0004 §3/§4.4 and MUST bind the RFC-0004 `CONTEXT_TAG`
(`UTF-8("metafactory-envelope-signature-v1") || 0x00`, RFC-0004 §3/§4.4) as the signing-domain
separator. This closes the former canonicalization-profile open decision (OD-3): the profile is no
longer chosen here — RFC-0004 pins it, and this RFC consumes it. The reference canonicalizer's
historical restriction (it implemented only the string / small-integer cases the registry signs,
not RFC 8785's full numeric handling) is subsumed by RFC-0004's profile; where the two differ,
RFC-0004 governs, and the deployed canonicalizer converges onto it via the myelin#31 shared-
canonicaliser migration. Because the verifier re-derives the signed bytes from
`canonicalJSON(signed.claim)` **as received** (the #1414 pattern), the two added bound fields of
§7.1 (`peer_pubkey`, `network_id`) are transparently verified by an unchanged verifier — an added
signed field participates in the canonical bytes without a verifier code change.

The canonicalizer MUST bound its own work before the signature is proven: it runs on
unauthenticated, attacker-controlled input (verify happens before the signature is checked). It
MUST enforce a maximum nesting depth, a maximum per-object key count, a maximum per-array
length, and a maximum aggregate node count, and MUST fail closed (map the resulting throw to
`401 signature_invalid`, never `500`) when any bound is exceeded. The deployed bounds are depth
64, 4096 keys per object, 4096 elements per array, and 200 000 total nodes. These are runtime
DoS guards, not format properties (§12).

### 7.3. Identity binding rule (normative)

The signed bytes bind `request_id`, `decision`, `peer_pubkey`, `network_id`, `admin_pubkey`,
`issued_at` and `nonce`. The admin's signature therefore cryptographically commits to *which* key
(`peer_pubkey`) is admitted onto *which* network (`network_id`) — not merely to an opaque
`request_id` handle. This closes OD-2: identity binding is now a **format property carried in the
signed message**, not a runtime property held by the integrity of a server-side lookup.

The registry MUST enforce the binding:

- The registry MUST reject an `admit` / `reject` with **`409 identity_mismatch`** if
  `claim.peer_pubkey != row.peer_pubkey` **OR** `claim.network_id != row.network_id`.
- The same `peer_pubkey` legitimately holds distinct `PENDING` rows across different networks (the
  `(principal_id, peer_pubkey, network_id)` triple of §4.2). Binding `peer_pubkey` alone does NOT
  catch a `request_id → wrong-network-row` substitution — the peer key still matches. Binding
  `network_id` is what closes that cross-network confused-deputy. Both fields are therefore
  REQUIRED in the signed bytes.
- Because a global `REGISTRY_ADMIN_PUBKEYS` admin can, in the deployed posture, admit onto any
  network, `network_id` is read off the same untrusted row this binding distrusts; committing it
  into the signed claim is what makes the per-network authorization rule (§7.4) cryptographically
  load-bearing rather than advisory.

**Dual-accept migration window (decoupled from the RFC-0001 §9 flag-day).** Both bound fields are
encoding-stable (§7.1), so this widening does NOT fold onto the DID flag-day; it runs its own
window:

1. A verifier MUST accept a claim with the bound fields present OR absent (narrow-or-wide), and
   MUST enforce the `409 identity_mismatch` match **when the fields are present** (enforce-when-
   present).
2. The verifier flips to **require-present** — rejecting a narrow claim that omits the bound fields
   — only after every signer has upgraded. That flip MUST be an explicit, dated step tracked on the
   OD-2 tracking issue, gated on a **monitored narrow-claim counter reading zero** before the flip;
   a "never enforce" drift is thereby charged as a live counter, not an unbounded compatibility
   shim.

**Legacy null-`network_id` rows.** A row with `network_id = null` — a row migrated from the
pre-ADR-0015 issuance table (§5) — has no bound network to match against. Such a row MUST be
admitted only via the **narrow** claim limb (a claim that omits `network_id`) for as long as the
window's narrow limb is open; a **wide** claim carrying a real `network_id` against a null-network
row MUST be rejected `409 identity_mismatch` rather than silently coerced to match (this is the
same no-coercion rule §5 states for `null` `network_id`). Backfilling `network_id` on those legacy
rows is therefore the precondition for the require-present flip: the monitored narrow-claim counter
cannot reach zero while null-network rows remain, which correctly keeps the window open until the
migration completes.

The window is nearly free to implement: the #1414 verify-over-`canonicalJSON(signed.claim)`-as-
received pattern means an unchanged verifier already covers the wide claim (§7.2). See §12 for the
threat model this binding closes.

### 7.4. Per-Network Admission Authority (normative)

Because §7.1/§7.3 bind `network_id` into the signed decision claim, the authorization of the
signing admin is **wire-load-bearing**: a second implementation validating a claim MUST reproduce
the authority rule, so the rule lives here, normatively, not only in a deployment's local
configuration.

- The registry MUST reject an `admit` (and a `reject`) whose signing `admin_pubkey` is **not
  authorized for the claim's bound `network_id`**. An admin is authorized for a network if its key
  is on the **global** admin allowlist (`REGISTRY_ADMIN_PUBKEYS`) **OR** on that **network's
  per-network allowlist**. A key on neither MUST yield `403`.
- The check is against the *bound* `network_id` (the field inside the signed bytes, §7.1), not
  against a path parameter or an untrusted row field alone — this is what makes the binding of §7.3
  close the cross-network confused-deputy end to end.
- The empty-allowlist fail-closed rule of §7.1 applies here too: absent any authorizing allowlist
  for the bound network, minting authority is DENIED (`503` before body parse), never defaulted
  open. (The hub-side analogue of this fail-closed default is §12.)

The **mechanism** by which per-network allowlists are stored and admin keys are managed
(allowlist storage, rotation) is a deployment concern, documented informatively in cortex ADR-0020
(§15.2); this section owns only the authorization **rule**. Should per-network authority later grow
a real surface (key rotation, delegation, quorum), that surface is chartered to a future
`Updates:` RFC under BCP-0001's living-spec rule; §7.4 is the current, minimal normative home.

---

## 8. Sealed-Secret Delivery and Hub Authorization

### 8.1. The sealed-secret envelope

After admission, the hub-admin delivers a member's leaf transport credential by **sealing a
small UTF-8 JSON envelope to a covered stack's registered pubkey** with libsodium `crypto_box_seal`
(Ed25519 → X25519), and writing the resulting opaque ciphertext via a hub-admin-signed write
(§8.3). The registry stores only the ciphertext; it MUST NOT be able to read it. Proof-of-
possession is intrinsic — only the holder of the target stack's private key can open the seal.

**Per-stack seal delivery under a per-principal admission.** The `admit` decision is
**per-principal** (one signed decision, §7), but the SEAL is a **per-stack write**. A principal may
federate more than one stack under one admission; each covered stack holds its own key and its own
subject isolation (ADR-0023: "the 2nd stack joins with the stack's OWN sealed `.creds`"). The
registry sealed-secret channel therefore carries **`sealed_secrets[]`** — an array of per-key
entries, NOT a single nullable slot (§5). Each entry is addressed to one covered stack's
`target_stack_pubkey` and its `sealed_secret` ciphertext is `crypto_box_seal`'d to exactly that
key. A shared, principal-wide seal is forbidden: it would collapse per-stack subject isolation
(the v2 `leaf_user` guard below exists to reject exactly that cross-stack install). This delivery
path is hub-mode-agnostic — it serves both operator-mode (metafactory) and sovereign/PSK hubs
(the community / halden zero-trust model), where a hub-side side channel would otherwise be the
only multi-stack transport. Each entry's per-key binding is enforced by the §8.3 write claim.

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

The ADR-0023 supersession means both v1 and v2 are live wire today. A decoder **MUST** accept both
v1 and v2 (v1-decode is ratified, not deprecated-out). A hub-admin **SHOULD** emit v2 (the
operator-mode scoped-user credential) for new seals. The **retirement date for v1-emit** is not set
here: it defers to a future `Updates:` RFC (per [`specs/CONFORMANCE.md`](../CONFORMANCE.md)
"Changing the wire" and BCP-0001's living-spec rule), so OD-4 is a scheduling item on that future
RFC, not a design gap open in this one. A conforming implementation MUST NOT drop v1-decode until
that `Updates:` RFC ratifies the retirement.

> **Subject-binding guard (R7) — MUST, already satisfied.** The v2 `leaf_user` field exists so a
> member can refuse a credential minted for a *different* subject (a courier sealing another
> member's real creds to this member). A v2 decoder MUST compare the decoded `leaf_user` against the
> caller's expected member identity/identities and MUST reject a mismatch, **failing closed** when
> the caller supplies no expected identity (a v2 credential with nothing to bind it to is refused,
> not installed). This is not a deferred guard: the reference implementation deploys it fail-closed
> (cortex `src/common/registry/fetch-sealed-secret.ts` R7 comparison, shipped PR #1609 / C-1597
> closed). §14 binds it with a fetch-seam conformance vector. See §12.

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
// SealedSecretWriteClaim (the seal delivery — one per covered stack, §8.1)
{ "request_id": "...", "peer_pubkey": "<ed25519-pubkey>",   // the target stack key the ciphertext is sealed to
  "sealed_secret": "<base64 ciphertext>",
  "hub_admin_pubkey": "<ed25519-pubkey>", "issued_at": "...", "nonce": "..." }

// HubAuthorizeClaim (the hub-authorize stamp; issued_at becomes hub_authorized_at)
{ "request_id": "...", "hub_admin_pubkey": "<ed25519-pubkey>", "issued_at": "...", "nonce": "..." }

// AdmissionRevokeClaim (the eviction)
{ "request_id": "...", "hub_admin_pubkey": "<ed25519-pubkey>", "issued_at": "...", "nonce": "..." }
```

Each MUST be verified over the §7.2 bytes-to-sign against `claim.hub_admin_pubkey`, checked
against the hub-admin allowlist, replay-checked on `nonce`, and clock-skew bounded. The
`SealedSecretWriteClaim` binds `peer_pubkey` — the target stack key the ciphertext is sealed to —
into the signed bytes, and the registry MUST reject the write with `409 identity_mismatch` if
`claim.peer_pubkey` does not equal the addressed `sealed_secrets[]` entry's `target_stack_pubkey`
(§8.1) / the row's `peer_pubkey`. This binding is symmetric with the registry-admin decision claim
(§7.3): the two-party gate cannot have one side bind identity and the other not — an asymmetric
binding is itself a seam.

This binding is **defense-in-depth plus an audit / intent signal, not the fix for identity
substitution.** The PRIMARY guarantee remains `crypto_box_seal`: a blob sealed to the wrong key
simply cannot be opened by anyone else, regardless of what the claim says. What the binding buys is
narrow and real — it rejects a claim whose bound key ≠ the target row/entry key (catching a
hub-admin fumbling the target row at write time) and it gives the member a signed intended-recipient
assertion. Like §7.3, the added field runs behind the §7.3 dual-accept window (a pre-widening
claim omitting `peer_pubkey` is accepted until every hub-admin signer upgrades). This resolves the
transport half of the #1748 identity-coherence finding and unblocks the per-stack `sealed_secrets[]`
delivery of §8.1.

---

## 9. Member Proof-of-Possession Reads

A joiner learns they are admitted and fetches their sealed blob without any admin key, via a
**member proof-of-possession** read. The member signs a claim with their registered private
key; the signature over the §7.2 bytes-to-sign against `peer_pubkey` **is** the authorization.

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
| `POST /admission-requests/{id}/depart` | member PoP (own row) | `ADMITTED → DEPARTED`; clear sealed + authorized (§4.2). |
| `GET /admission-requests[?status=]`, `GET /admission-requests/{id}` | registry-admin (signed read header) | Admin-gated queue enumeration (per-network read-scoped, §7.4). |
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
  the membership flow; it MUST be relabelled. The relabel is an **interim, decoupled correction
  applied now** (the mislabel is fixed without waiting on RFC-0010 drafting — OD-1); its chartered
  Standards-Track home remains **RFC-0010 (Rate-limit & refusal taxonomy)**, chartered but not yet
  drafted. The "cortex grounds on a Draft" violation (a consumer citing `admission.md` §4–§5
  normatively) resolves as an **informative handoff** to RFC-0010 once that RFC exists; interim,
  this document notes it and does not itself normatively re-home that consumer.
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

- **Decision-claim binding scope (RESOLVED, OD-2 closed).** The registry-admin's signature now
  binds the admitted identity: `peer_pubkey` AND `network_id` are inside the signed bytes, and the
  registry rejects `409 identity_mismatch` on any disagreement with the target row (§7.3). This is
  a **cryptographic** binding, chosen over the earlier request_id-only + row-immutability
  compensating control because the threat model puts a dishonest-or-buggy registry in scope — a
  registry can violate any immutability rule it alone enforces, so identity coherence must ride the
  signed message. Binding `network_id` (not `peer_pubkey` alone) is what closes the cross-network
  confused-deputy: a global `REGISTRY_ADMIN_PUBKEYS` admin can admit onto any network, and the same
  `peer_pubkey` legitimately holds distinct rows per network, so only committing the network id
  catches a `request_id → wrong-network-row` substitution. The §7.4 per-network authorization rule
  is the authority half of the same closure. Appendix B pins the widened-bytes vector and the
  `409 identity_mismatch` reject.

- **Sealed-secret custody.** The registry holds only the opaque `crypto_box_seal` ciphertext; it
  cannot read it, and a registry compromise leaks only ciphertexts (useless without member
  seeds). PoP is intrinsic — a blob sealed to the wrong key cannot be opened, which carries the
  PRIMARY targeting guarantee. As **defense-in-depth**, the seal-delivery claim (§8.3) now also
  binds the target `peer_pubkey` into its signed bytes, and the registry rejects
  `409 identity_mismatch` when the bound key ≠ the addressed entry's key — catching a hub-admin
  fumbling the target row at write time and giving the member a signed intended-recipient
  assertion. This is an audit / intent signal layered on the seal, not a replacement for it.

- **Subject-binding guard (R7) — satisfied.** The v2 envelope's `leaf_user` lets a member reject a
  credential minted for a different subject. The identity-binding comparison is a MUST (§8.1) and
  is **deployed fail-closed** in the reference implementation (cortex
  `src/common/registry/fetch-sealed-secret.ts`, PR #1609 / C-1597 closed): a v2 credential whose
  `leaf_user` is not among the caller's expected identities is refused, and a caller supplying no
  expected identity is refused rather than defaulted-open. §14 binds it with a fetch-seam vector.
  This is no longer a deferred guard.

- **Charset-coercion collisions (carved to RFC-0010; this document's OD-5, see grill-logs/rfc-0006.md:88 D15).** The rate-limit half derives KV
  key/bucket segments from principal ids by mapping any character outside `[a-zA-Z0-9_-]` to `-`
  rather than rejecting it — a defensive pass-through, not validation, that aliases two distinct
  out-of-grammar principals onto one shared counter (`a.b` and `a-b` both → `a-b`). That is a
  **rate-limit-plane (substrate) concern**, not a membership-plane one: the KV-collision test
  vectors and the `admissionKeyPrincipalSegment` conformance op **carve out to RFC-0010**
  (Rate-limit & refusal taxonomy), coherent with the §7.4 authority-stays / rate-limit-carves line.
  What stays normative here is only the membership boundary: the membership half derives
  `requested_scope` from the same principal ids, so the §6.2 grammar MUST be **enforced, not
  coerced**, at that boundary. RFC-0006 keeps a single `requested_scope` reject vector for the
  out-of-grammar id (Appendix B); the KV-key collision family moves to RFC-0010.

- **Unsigned rate-limit KV entries (finding).** The rate-limit half stores its token-bucket and
  in-flight entries as **unsigned** JSON in a shared KV bucket: any process with bucket write
  access can zero a victim's tokens or reset its own counters. Signed-KV (myelin#31) is named
  only as a future migration destination. This is out of scope for the membership contract but
  in scope for RFC-0010, the chartered rate-limit RFC (OD-1).

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

- **Hub→registry-admin authority fallback MUST fail closed.** The hub-admin allowlist
  (`REGISTRY_HUB_ADMIN_PUBKEYS`) falls back to the registry-admin allowlist only for the
  *operational collapse* case where one principal legitimately holds both authorities (§1.2, §3.2).
  When the two authorities are separated — a network whose hub host is not its registry admin — an
  **absent** hub allowlist MUST NOT silently hand the registry-admin the hub's minting power.
  Absent a hub allowlist for the network in question, leaf-secret minting authority is **DENIED**,
  never defaulted to the registry-admin. Defaulting-open would collapse the two-party gate exactly
  when separation is what protects the network; the fail-closed default is the security-first one.

- **Revoke completeness — the registry mark is necessary, not sufficient.** Setting a row to
  `REVOKED` (and clearing `sealed_secret` + `hub_authorized_at`, §4.2) removes the member from the
  roster and from future seal reads, but it does NOT by itself sever an already-established leaf
  link. A complete revocation MUST also cut transport, in this ordering: (1) the registry marks the
  row `REVOKED`; (2) the hub invalidates the member's leaf credential (the NSC user / PSK the
  sealed envelope delivered) so the leaf link cannot re-establish; and (3) the per-network payload
  key K (ADR-0019, §8.1) is rotated so the evicted member cannot decrypt post-revocation federated
  payloads it may still observe in flight. Until the transport cut and key rotation complete, a
  revoked member retains transport reachability despite the roster mark. This ties to cortex
  C-1350 (payload-key rotation); a conforming deployment MUST NOT treat the registry mark as the
  whole of a revocation.

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
  impossible. A per-network admin's read MUST be forced to that network's rows only (§7.4),
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
- `parseRequestedScope` — the §6.2 grammar (require the `.>` tail; reject an out-of-grammar
  principal id rather than coerce it — the membership boundary that stays in RFC-0006, §12).
- `parseAdmissionStatus` — the §4.1 enum, case-sensitive, rejecting unknown and legacy tokens.
- `canonicalizeDecisionClaim` — the §7.2 canonical byte profile per RFC-0004 §3/§4.4 (the
  `CONTEXT_TAG` signing-domain separator included), byte-for-byte, over the §7.1 claim **including**
  the bound `peer_pubkey` and `network_id`. RFC-0004 owns a **single** canonicalization profile, so
  this same op validates the canonical bytes of every signed claim shape in this document — the
  seal / authorize / revoke claims (§8.3) and the member-PoP read claims (§9); a vector tagged
  `canonicalizeDecisionClaim` over a seal claim exercises that shared profile, not a decision-only
  variant.
- `enforceDecisionIdentityBinding` — the §7.3 rule: accept a match, reject `409 identity_mismatch`
  when `claim.peer_pubkey != row.peer_pubkey` OR `claim.network_id != row.network_id`, under the
  dual-accept window (narrow claim accepted until require-present flips).
- `enforceSealWriteBinding` — the §8.3 rule: reject `409 identity_mismatch` when the seal claim's
  bound `peer_pubkey` ≠ the addressed `sealed_secrets[]` entry / row key.
- `decodeLeafSecretEnvelope` — the §8.1 v1/v2 decode + fail-closed rejections.
- `bindLeafUserToMember` — the §8.1 R7 fetch-seam: a v2 credential whose `leaf_user` is not among
  the caller's expected identities is refused, and a caller with no expected identity is refused
  (fail-closed), not defaulted-open.
- The §4.2 **lifecycle vector family** — the state machine's transitions and its two derived
  projections: the `ADMITTED` sub-lifecycle (unsealed→sealed→hub-authorized read off field
  presence, not enum tokens) and the register-path covered-by-principal readout (display-only,
  never a join-gate). §4.2 is the richest normative surface and MUST carry binding vectors.

The `admissionKeyPrincipalSegment` op (reject, not coerce, an out-of-grammar KV **key** segment)
and its charset-coercion collision vectors are a rate-limit-plane concern and **carve out to
RFC-0010** (§12, D15); RFC-0006 retains only the `requested_scope` reject at the membership
boundary. Subject terminals used by §6.2 (the `federated.` prefix and the `.>` subtree tail) are
**imported from RFC-0002**, not redefined here — a conforming implementation MUST source those
terminals from RFC-0002's namespace. Where the deployed cortex implementation disagrees with a
membership vector, the implementation is the defect, per the precedence chain in
[`specs/CONFORMANCE.md`](../CONFORMANCE.md): the ABNF governs, the vectors decide, and the
implementation conforms or it is wrong.

---

## 15. References

### 15.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC4648] Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. *(Historical context for §7.2; canonicalization is now owned by RFC-0004, which subsumes the formerly-documented subset. OD-3 closed.)*
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", **Ratified**. *(Owns `principal-id` and the two-plane class taxonomy; §6. Its class-explicit dot-form grammar is decided.)*
- [RFC-0002] metafactory, "Subject Namespace", **Ratified**. *(Owns the `federated.` prefix and subtree wildcard; §6.2.)*
- [RFC-0003] metafactory, "Envelope", **Ratified**. *(Owns the signed-assertion envelope, date-time, and signature primitives; §3.1.)*
- [RFC-0004] metafactory, "Envelope Signing", Ratified. *(Owns canonicalization and the signing-domain separator: `canonicalizeForSigning` / bytes-to-sign (§3, §4.4) and `CONTEXT_TAG = UTF-8("metafactory-envelope-signature-v1") || 0x00`. The admission decision claim (§7.2) and the seal / authorize claims (§8.3) are RFC-0004-canonicalized signed claims. Closes OD-3.)*

### 15.2. Informative References

- cortex `docs/adr/0015-two-tier-onboarding-and-admission-gate.md` — the two-tier onboarding model and the `register → PENDING → admit` gate (mints nothing). Design rationale; this RFC is the normative home.
- cortex `docs/adr/0018-admission-gate-and-leaf-secret-distribution.md` — sealed-to-pubkey per-member secret custody (Q1 b′), roster-from-ADMITTED (Q3), member PoP read (Q4), two separable authorities (Q5), revoke/rotate (Q6). Transport-auth mechanism superseded by ADR-0023.
- cortex `docs/adr/0019-federated-payload-encryption.md` — the payload key K that rides the sealed slot (§8.1).
- cortex `docs/adr/0020-per-network-admin-authority.md` — the deployment **mechanism** for the §7.4 per-network authorization rule (allowlist storage, admin-key management). The authorization *rule* is now normative in §7.4; this ADR is the informative mechanism pointer only.
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
; specs/grammar/admission.abnf
; RFC-0006 — Membership and Admission
; Status: Ratified (single-principal, 2026-07-14, ADR-0001). This grammar is
; normative. See specs/README.md.
;
; This file defines ONLY the identifier terminals RFC-0006 OWNS: the admission
; request-id, the requested NATS subject scope, the AdmissionStatus enum, the
; admit/reject decision token, the base64 token shapes for pubkeys / signatures
; / sealed ciphertext, and the string-typed leaf fields of the sealed-plaintext
; envelope.
;
; Terminals it does NOT own are IMPORTED, never redefined (grammar/README.md
; rule 5):
;   principal-id  RFC-0001 §1 (specs/grammar/identifiers.abnf) — the owner slug
;                 that seeds requested-scope's middle segment and the v1
;                 leaf-user default.
;   Core rules ALPHA, DIGIT are imported from RFC 5234 Appendix B.
;
; Where a rule mirrors a live regex/constant in source, the source is cited so
; that after generation the arrow reverses: the regex becomes the artifact and
; THIS becomes its source.

; ─────────────────────────────────────────────────────────────────────────
; 1. request-id — the AdmissionRequest primary key.
;    Faithful transcription of REQUEST_ID_RE,
;    cortex src/services/network-registry/src/validate.ts  /^[0-9a-f]{32}$/
;    A 16-byte UUID rendered as EXACTLY 32 LOWERCASE hex digits, NO dashes. The
;    dashed 8-4-4-4-12 UUID form is REJECTED. Case matters: an uppercase digit
;    is not admitted, so one id can never address two rows.
; ─────────────────────────────────────────────────────────────────────────
lower-hex         = DIGIT / %x61-66              ; 0-9 / a-f  (lowercase only)
request-id        = 32lower-hex

; ─────────────────────────────────────────────────────────────────────────
; 2. requested-scope — the NATS subject subtree a joiner requests admission to.
;    Transcribes `federated.${principalId}.>`,
;    cortex src/services/network-registry/src/routes/principals.ts.
;    The subject STRUCTURE is owned by RFC-0002 (Subject Namespace); this rule
;    fixes the admission-specific shape only: the reserved case-sensitive
;    `federated.` prefix, one principal segment (RFC-0001 principal-id), and the
;    REQUIRED `.>` subtree wildcard tail. The '.' delimiters (not '-') make a
;    hyphen-bearing principal unambiguous here (contrast RFC-0001's '-' join).
; ─────────────────────────────────────────────────────────────────────────
fed-prefix        = %x66.65.64.65.72.61.74.65.64.2E   ; "federated." (case-sensitive)
scope-tail        = %x2E.3E                            ; ".>"  subtree wildcard
requested-scope   = fed-prefix principal-id scope-tail

; ─────────────────────────────────────────────────────────────────────────
; 3. admission-status — the lifecycle enum.
;    cortex src/services/network-registry/src/types.ts.
;    All five tokens are RESERVED (Registry Considerations); case-sensitive; an
;    unknown token is a FAULT, never coerced to the nearest state.
; ─────────────────────────────────────────────────────────────────────────
st-pending        = %x50.45.4E.44.49.4E.47            ; "PENDING"
st-admitted       = %x41.44.4D.49.54.54.45.44         ; "ADMITTED"
st-rejected       = %x52.45.4A.45.43.54.45.44         ; "REJECTED"
st-revoked        = %x52.45.56.4F.4B.45.44            ; "REVOKED"
st-departed       = %x44.45.50.41.52.54.45.44         ; "DEPARTED"
admission-status  = st-pending / st-admitted / st-rejected
                  / st-revoked / st-departed

; ─────────────────────────────────────────────────────────────────────────
; 4. decision — the admit/reject token inside the SignedAdmissionDecision claim.
;    cortex types.ts (AdmissionDecisionClaim.decision). Case-sensitive.
; ─────────────────────────────────────────────────────────────────────────
decision          = %x61.64.6D.69.74 / %x72.65.6A.65.63.74   ; "admit" / "reject"

; ─────────────────────────────────────────────────────────────────────────
; 5. base64 tokens — pubkeys, signatures, sealed ciphertext (control-plane
;    claim fields). STANDARD base64 (RFC 4648 §4), a FAITHFUL transcription of
;    BASE64_RE, myelin src/identity/types.ts  /^[A-Za-z0-9+/]+=*$/.
;
;    FINDING (Security Considerations §"Malleable base64"): this alphabet is
;    NON-CANONICAL. `*"="` admits UNBOUNDED padding and the final symbol's
;    unused bits are unconstrained, so a 64-byte Ed25519 signature has many
;    distinct 88-char encodings. The byte LENGTHS below are a verify-time
;    SEMANTIC constraint, not syntax, and are recorded as aliases for the reader.
; ─────────────────────────────────────────────────────────────────────────
base64-char       = ALPHA / DIGIT / "+" / "/"
base64            = 1*base64-char *"="           ; NOTE unbounded padding (finding)
ed25519-pubkey    = base64                       ; 32 bytes -> 44 chars incl. one "="
ed25519-signature = base64                       ; 64 bytes -> 88 chars incl. one "="
sealed-secret     = base64                       ; libsodium crypto_box_seal, opaque

; ─────────────────────────────────────────────────────────────────────────
; 6. Sealed-plaintext leaf terminals — the string fields INSIDE `sealed-secret`
;    after crypto_box_seal open. cortex src/common/registry/sealed-leaf-secret.ts.
;    The envelope is a UTF-8 JSON object discriminated by `v` (§8); these rules
;    cover its string-typed leaf fields.
;
;    leaf-psk is base64URL (RFC 4648 §5) — the '-'/'_' alphabet, no padding.
;    leaf-user is the hub `authorization` username: a principal-id in v1
;    (default), a stack-id in v2; the decoder only checks non-empty, so this
;    rule is deliberately permissive and is NOT a validation gate.
; ─────────────────────────────────────────────────────────────────────────
base64url-char    = ALPHA / DIGIT / "-" / "_"
leaf-psk          = 1*base64url-char
leaf-user         = 1*( ALPHA / DIGIT / "-" / "_" / "/" / "." )
```

## Appendix B. Test Vectors

Vectors live as JSON under [`specs/vectors/admission/`](../vectors/admission/) so
implementations in any language can consume them. This appendix reproduces a representative
subset; the vector files are the source of truth. See [`specs/vectors/README.md`](../vectors/README.md)
for the schema. Every vector carries a `why`.

The starter set includes the mandatory adversarial cases. The grill of 2026-07-14 adds the
binding-enforcement and lifecycle families (the Author-Vectors stage writes these files):

- **Decision-claim widened bytes** — `decision-claim/canonical-bytes-admit-widened`: the pinned
  canonical bytes now include `peer_pubkey` AND `network_id`, evidencing the §7.1/§7.3 binding.
- **Decision-claim identity mismatch** — `decision-claim/reject-identity-mismatch-peer-pubkey` and
  `decision-claim/reject-identity-mismatch-network-id`: a claim whose bound `peer_pubkey` **or**
  `network_id` disagrees with the target row MUST be rejected `409 identity_mismatch` (§7.3) — the
  network-id case is the cross-network confused-deputy `peer_pubkey`-alone cannot catch. The accept
  limb (`decision-claim/binding-match-accept`) and the decoupled dual-accept window
  (`decision-claim/binding-narrow-accepted-dual-accept`, a narrow pre-widening claim still accepted)
  complete the `enforceDecisionIdentityBinding` op.
- **Seal-claim peer binding** — `seal-claim/bind-peer-pubkey` + `seal-claim/reject-identity-mismatch`:
  the `SealedSecretWriteClaim` binds the target `peer_pubkey`; a bound key ≠ addressed entry key is
  rejected `409 identity_mismatch` (§8.3).
- **Fetch-seam R7** — `fetch-seam/reject-subject-mismatch` + `fetch-seam/reject-no-expected-identity`:
  a v2 credential whose `leaf_user` is not among the caller's expected identities is refused, and a
  caller supplying no expected identity is refused fail-closed (§8.1, §14).
- **§4.2 lifecycle family** — `lifecycle/depart-clears-both-fields` (both `sealed_secret` and
  `hub_authorized_at` cleared, D5) with its `lifecycle/revoke-clears-both-fields` symmetric companion;
  `lifecycle/terminal-is-terminal-per-key` (no terminal→`PENDING` path — an `admit` on a terminal row
  is `409 already_decided`, D3) with `lifecycle/terminal-reregister-idempotent` (re-registering a
  terminal triple returns it unchanged; re-admission is a fresh `peer_pubkey` triple, not a reset);
  `lifecycle/admitted-sublifecycle-derived` (the unsealed→sealed→hub-authorized projection read off
  field presence, not an enum token, D4) with its `-unsealed` and `-hub-authorized` siblings covering
  the other two derived stages; and `lifecycle/covered-by-principal-readout` (register-path display
  projection, never a join-gate, D1) with `lifecycle/covered-by-principal-mine-path-not-widened`
  (the `/mine` PoP read keeps its `peer_pubkey`-only authority, never widened to `principal_id`).
- **Legal-in-one-rendering** — `requested-scope/valid-hyphenated-principal`: a hyphen-bearing
  principal is unambiguous under the scope grammar because `principal-id` is kebab-strict
  (RFC-0001), importing the RFC-0002 `federated.` prefix and `.>` tail rather than redefining them.
- **Requested-scope reject** — `requested-scope/reject-out-of-grammar-principal`: the membership
  boundary MUST reject, not coerce, an out-of-grammar principal id (§12). The charset-coercion
  KV-**key** collision vectors and the `admissionKeyPrincipalSegment` op **carve to RFC-0010** and
  no longer live here (§12, §14, D15).
- **Version-discriminated envelope** — v1 PSK, v1-with-payload-key, v2 creds decode; and the
  fail-closed rejections for a newer version, a missing `leaf_psk`, and a non-numeric `v`.

Representative reproduction (widened decision-claim bytes; keys are fixed byte-fills, not live):

```json
{
  "id": "decision-claim/canonical-bytes-admit-widened",
  "rfc": 6,
  "kind": "canonicalizeDecisionClaim",
  "input": { "request_id": "0123456789abcdef0123456789abcdef", "decision": "admit",
             "peer_pubkey": "cGVlcnBlZXJwZWVycGVlcnBlZXJwZWVycGVlcnBlMDE=",
             "network_id": "metafactory",
             "admin_pubkey": "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDA=",
             "issued_at": "2026-07-12T00:00:00Z", "nonce": "deadbeefcafef00ddeadbeefcafef00d" },
  "expect": { "ok": true,
    "value": "{\"admin_pubkey\":\"Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDA=\",\"decision\":\"admit\",\"issued_at\":\"2026-07-12T00:00:00Z\",\"network_id\":\"metafactory\",\"nonce\":\"deadbeefcafef00ddeadbeefcafef00d\",\"peer_pubkey\":\"cGVlcnBlZXJwZWVycGVlcnBlZXJwZWVycGVlcnBlMDE=\",\"request_id\":\"0123456789abcdef0123456789abcdef\"}" },
  "why": "Pins the widened canonical-JSON profile the admission gate signs; the bytes now bind the admitted identity — peer_pubkey AND network_id — closing OD-2 (§7.1/§7.3). Canonicalization is RFC-0004-owned (§7.2)."
}
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here.
A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes the cortex membership admission contract (ADR-0015/0018/0019/0020 + network-registry types) to a normative myelin RFC. Defines `admission.abnf` (request-id, requested-scope, admission-status, decision, base64 + sealed-plaintext terminals) and a 22-vector starter set. Records six open decisions (OD-1 rate-limit relabel/RFC number; OD-2 decision-claim binding scope; OD-3 canonicalization profile; OD-4 v1-PSK envelope retirement; OD-5 charset-coercion rejection; and the RFC-0001-inherited identifier grammar, cortex#1880). Relabels `specs/admission.md` as the substrate rate-limit contract. |
| 2026-07-13 | Draft | Cascade sweep (REVISIONS C3 + RFC-0001 ratification propagation). OD-1 retargeted: the rate-limit contract's chartered home is RFC-0010 (Rate-limit & refusal taxonomy), chartered but not yet drafted — "no number assigned yet" removed (§2, §11, §12, lifecycle table). Final OD (cortex#1880 identifier-grammar block) retargeted to "resolved by RFC-0001, pending JC co-signature"; DID migration noted as a hard cut per RFC-0001 §9, no dual-accept (§1). Member-identity DID examples moved to class-explicit form and member identities stated as KEYED-plane per RFC-0001 §2.1 (§6). §6.2 and Appendix B injectivity prose corrected to cite the kebab-strict rule (not dot-separation alone) and the legacy hyphen-join collision as resolved by the dot-form. §15.1 RFC-0001 annotation updated. OD-2/OD-3/OD-4/OD-5 untouched (deep-pass decisions). |
| 2026-07-14 | Draft | Vector package authored to the woven prose (`specs/vectors/admission/valid.json`, 38 vectors). **Superseded vectors deleted with this note (BCP-0001 additive rule):** `decision-claim/canonical-bytes-admit` → replaced by `decision-claim/canonical-bytes-admit-widened` (the canonical bytes now bind `peer_pubkey` + `network_id`, D6); `sealed-secret-claim/canonical-bytes` → replaced by `seal-claim/bind-peer-pubkey` (the seal claim's canonical bytes now bind `peer_pubkey`, D8). **Carved to RFC-0010 (D15):** `admission-key/masking-in-grammar-identity`, `admission-key/collision-dot-coerced-to-hyphen`, `admission-key/reject-underscore` and the `admissionKeyPrincipalSegment` op leave RFC-0006 (rate-limit-plane); RFC-0006 retains only `requested-scope/reject-out-of-grammar-principal` at the membership boundary. **Added:** the decision-binding family (`enforceDecisionIdentityBinding`: match-accept, `409 identity_mismatch` on peer-pubkey and on network-id, dual-accept narrow-accept); the seal-binding family (`enforceSealWriteBinding`: match-accept + `409 identity_mismatch`); the R7 fetch-seam family (`bindLeafUserToMember`: subject match-accept, subject-mismatch reject, no-expected-identity fail-closed reject, D9); and the §4.2 lifecycle family (`applyLifecycleTransition` depart/revoke both-fields-cleared + terminal-per-key + terminal-reregister-idempotent; `projectAdmittedSublifecycle` unsealed/sealed/hub-authorized; `projectCoveredByPrincipal` register-path readout + `/mine` not-widened, D18/D5/D3/D4/D1). All bytes recomputed deterministically; canonical-JSON pins cross-checked against Appendix B; keys are fixed byte-fills; hub `did:mf:hub.testnet`; no 17–20-digit runs. |
| 2026-07-14 | Draft | Grill decision log (D1–D20, Andreas 2026-07-14) woven in. **OD-2 closed** — the admission decision claim now binds `peer_pubkey` AND `network_id` in the signed bytes with a `409 identity_mismatch` reject and an own dual-accept window decoupled from the RFC-0001 §9 flag-day (both bound fields encoding-stable); §7.3 turned from a finding into the normative binding rule; new normative **§7.4** per-network admission authority; all four phantom "RFC-0020" refs retargeted to §7.4, ADR-0020 kept as informative mechanism pointer (D6/D7/D13). **OD-3 closed** — §7.2 cites RFC-0004 §3/§4.4 + `CONTEXT_TAG` as canonicalization owner; RFC-0004 added to §15.1 (D19). §8 changed the single `sealed_secret` slot to a per-key `sealed_secrets[]` shape and bound `peer_pubkey` into `SealedSecretWriteClaim` (framed defense-in-depth, `crypto_box_seal` primary), resolving the transport half of #1748 (D2/D8). §4.2 depart now clears BOTH fields; terminal-per-key (no terminal→PENDING path); ADMITTED sub-lifecycle + covered-by-principal readout as DERIVED (readout-scoped, `/mine` PoP authority preserved) (D5/D3/D4/D1). §8.1 R7 leaf_user↔member comparison stated as a MUST, already-satisfied fail-closed by the reference impl; v1-decode ratified + v2 SHOULD-emit, retirement date deferred to a future Updates: RFC (D9/D10). §12 added fail-closed hub→registry-admin authority fallback and revoke-completeness (transport cut ordering + payload-key rotation) (D12/D14). §12/§14 charset-coercion KV-collision vectors + `admissionKeyPrincipalSegment` op carved to RFC-0010; RFC-0006 keeps a `requested_scope` reject; §6.2 terminals imported from RFC-0002 (D15/D20). §2/§11 admission.md relabel noted as an interim decoupled correction (OD-1); "cortex grounds on a Draft" noted as an informative RFC-0010 handoff (D16/D17). Appendix B manifest names the new binding + lifecycle vector families; representative vector updated to the widened bytes (D18). Front matter: ratification model updated to single-principal (ADR-0001) with a documented hub-custodian REINSTATE trigger; `signatories` stays `[]`, `status` stays Draft, `ratified` null (human runs the ratify commit). |

## Acknowledgments

This RFC codifies decisions grilled by Andreas and recorded in cortex ADR-0015, ADR-0018,
ADR-0019, ADR-0020 and ADR-0023, and the operational discipline in compass
`sops/federation-wire-protocol.md`.

## Authors' Addresses

Luna (metafactory) — assistant author, on behalf of the principal.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/