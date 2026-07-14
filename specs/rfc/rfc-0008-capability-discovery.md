---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0008
title: Capability Discovery and Advertisement
status: Draft
category: Standards Track
obsoletes: []
updates: []
crossRefs: ["0001", "0002", "0003", "0004", "0005"]   # 0005 added 2026-07-13 cascade sweep (REVISIONS C4/C10 — sovereignty block is RFC-0005's; the sovereignty_required match ordering is owned HERE, §6.5)
authors:
  - name: Luna
    affiliation: metafactory
signatories: []
created: 2026-07-12
ratified: null
grammar: specs/grammar/capability-discovery.abnf
vectors: specs/vectors/capability-discovery/
generated:
  - []                            # future: schemas/capability-advertisement.schema.json; the capability-tag / capability-id regexes
supersedes_prose:
  - docs/discovery.md
---

# RFC-0008: Capability Discovery and Advertisement

## Abstract

This document specifies the myelin capability-discovery wire: the self-signed
`CapabilityAdvertisement` an agent publishes to declare what it can do, and the
`SignedCapabilityRegistration` that wraps it, so that a network can answer
"who is reachable and qualified for this work, right now?" as a query against a
signed registry rather than a static manifest. It specifies the advertisement's
canonical byte representation and Ed25519 verification chain, the
`AGENT_CAPABILITIES` key-value addressing that stores it, the TTL/renewal
contract that makes the registry a liveness signal, and the syntax of the
capability identifier the advertisement carries.

Two mutually incompatible capability-identifier grammars are deployed in the
ecosystem today — a single-segment tag on the myelin task-matching side and a
dotted-compound id on cortex's parallel presence wire — and cortex consumes
none of the myelin discovery API. This document records both wires faithfully,
marks their reconciliation as an unresolved decision rather than inventing one,
and pins the boundary cases (grammar collisions, the shared-tag masking case,
and the unvalidated-advertisement trust gap) as conformance vectors.

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

- 1. Introduction
  - 1.1. Requirements Language
  - 1.2. Terminology
- 2. The Capability Advertisement
- 3. Signing, Canonicalization, and Verification
- 4. Capability Identifier Grammar
- 5. `AGENT_CAPABILITIES` Key-Value Addressing
- 6. Open Decisions
- 7. Relationship to the cortex Presence Wire (Informative)
- 8. Registry Considerations
- 9. Security Considerations
- 10. Privacy Considerations
- 11. Conformance
- 12. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

Layer 5 (Discovery) of the myelin stack makes the answer to *"what capability is
reachable right now?"* an observation of a signed, live wire rather than a static
on-disk manifest. An agent announces its capability set on the **presence wire**
— `agent.online` carries the initial set at boot, `agent.capabilities-changed`
carries the full new set on every mid-life change — inside ordinary signed
envelopes (RFC-0004), and subscribers fold the announcements into a liveness-
tracked registry (the TTL FSM). This push-model wire is the **canonical
discovery wire** (grill D2, closes §6.2). The earlier pull-model design, **F-11**
(myelin#50, 2026-05-10 — a JCS-signed registration written to a KV store),
shipped in myelin but was consumed by nothing; it is recorded historically (§2,
§3, §5) and retires at flag-day R.

**What this document specifies.** The capability-identifier grammar and its
match rule (§4 — converged, grill D1); the normative presence discovery wire —
payloads, full-set semantics, liveness, and the trust-boundary validation gate
(§7, grill D2/D5); the `sovereignty_required` equality-match rule (§6.5, grill
D3, owning what RFC-0005 defers here); and, historically, the retired F-11
artifacts — the advertisement record (§2), its standalone signing (§3), and the
KV addressing (§5).

**The converge-or-retire keystone, resolved (grill 2026-07-15,
[`grill-logs/rfc-0008.md`](grill-logs/rfc-0008.md)).** The capability identifier
had shipped as two incompatible grammars (myelin single-segment tag vs cortex
dotted-compound) on two unreconciled wires (F-11 KV pull vs presence push).
Resolution: **converge the grammar, retire the dead wire** — the canonical
`capability-id` is dotted-compound with `capability-tag` segments (§4, D1); the
presence wire is canonical and F-11 retires (§7/§2, D2); matching is
segment-prefix (§4.2). Migrations (underscore ids; the myelin exact-membership
matcher) land at flag-day R as named conformance defects.

**What this document makes normative.** It promotes the informative
[`docs/discovery.md`](../../docs/discovery.md) (listed in `supersedes_prose`).
Where this document and that prose disagree, this document governs once
`Ratified`.

This document is Standards Track. It normatively references RFC-0001
(identifier terminals — `did`, `lower` — and the class-explicit `did:mf`
grammar, two-plane class taxonomy, and §7 reserved-identifiers registry,
Ratified), RFC-0002 (subject namespace — the
tasks-domain capability segment and the `dead-letter`/`@` reservations),
RFC-0003 (envelope — the `requirements[]`, `sovereignty_required`, `deadline`,
`distribution_mode`, `target_assistant`, and `economics` fields that consume or
mirror discovery), RFC-0004 (envelope signing and canonicalization — the
JCS profile, the clock-skew rule, and the SIGNABLE-field doctrine this
document's signed perimeter is measured against), and RFC-0005 (sovereignty —
the sovereignty block and mode vocabulary the advertisement's posture declares
against).

Two wire rules are normatively OWNED by this document and referenced, never
redefined, by its siblings (one owner per rule): the **capability-identifier
grammar** (§4 — RFC-0002's subject grammar and taxonomy cite it) and the
**`sovereignty_required` match semantics/ordering** (§6.5 — RFC-0003, which
carries the field, and RFC-0005, which owns the sovereignty block, defer here).
Ownership fixes where each rule lives; the substantive questions are now decided
(§6.1 → D1 converge-widen; §6.5 → D3 equality-match).

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.2. Terminology

- **CapabilityAdvertisement** — the self-asserted record of what an agent can do:
  its actor-DID, its capability set, its sovereignty posture, its current load,
  its concurrency ceiling, and a renewal timestamp (§2). Source:
  `src/discovery/types.ts:10`.
- **SignedCapabilityRegistration** — a `CapabilityAdvertisement` wrapped with an
  Ed25519 `signed_by` stamp; the object the registry actually stores. Source:
  `src/discovery/types.ts:27`.
- **advertisement actor-DID** — the `identity` field of the advertisement; a
  `did` (RFC-0001). During the R2 transition window a pre-migration
  advertisement MAY carry the deprecated `principal` key instead;
  RFC-0001 terms apply to the value.
- **capability-tag** — a single-segment capability identifier: `CAPABILITY_TAG_RE`
  (`src/patterns.ts:21`). The grammar the envelope `requirements[]` items enforce
  (RFC-0003). Defined in §4.
- **capability-id-compound** — cortex's dotted-compound capability identifier:
  `CAPABILITY_ID_REGEX` (cortex `src/common/types/capability.ts:172`). Defined in §4.
- **capability-id** — the abstract identifier carried in an advertisement's
  `capabilities[]`. Its concrete grammar is unresolved (§6.1); until then it is
  the union of the two above, and is unvalidated at the myelin trust boundary
  (§9.1). Normatively owned by this document (§4.1); NOT a DID (§4.4,
  RFC-0001 §7).
- **sovereignty mode** — one of `open | selective | strict | bidding`; the
  advertisement's declared posture and the envelope `sovereignty_required`
  minimum (field carried per RFC-0003; sovereignty block per RFC-0005; the
  match-semantics/ordering is owned by THIS document, §6.5). Source:
  `src/discovery/types.ts:7`.
- **load** — a self-reported `[0,1]` utilization figure, clamped at registration.
- **maxConcurrent** — a positive-integer hard ceiling on parallel tasks.
- **AGENT_CAPABILITIES KV** — the key-value bucket the registry is stored in
  (§5). Named only in an informative doc today; reserved by this document.
- **TTL / renewal** — the registration's time bound (60 s) and re-publish cadence
  (30 s) that turn presence-in-the-registry into a liveness signal (§5).
- **self-registration** — the property that discovery is signed only by the
  advertising agent; hub-stamping (RFC-0004) is deliberately not supported here.

Terms defined in a referenced RFC (`did`, `lower`, `DIGIT`, JCS, `signed_by`
stamp, hub-stamp, SIGNABLE fields, clock skew) are cited, not redefined.

---

## 2. The Capability Advertisement (Historical — the retired F-11 record)

*Per grill D2 the F-11 pull wire retires at flag-day R; this section records its
record shape for decode-compat and audit, and is NOT the normative discovery
content unit. The normative unit is the presence payload (§7). The
F-11-exclusive members (`sovereignty`, `load`, `maxConcurrent`, `updatedAt`) had
zero consumers and retire with the wire; a future `Updates:` reintroduces them
when a consumer exists.*

A `CapabilityAdvertisement` is a JSON object [RFC8259] with the following
members. §3 records how it was signed, §4 the (now-converged) capability-id
syntax, §5 the (retired) storage.

| Member | Type | Requirement |
|---|---|---|
| `identity` | string (`did`, RFC-0001) | REQUIRED. The advertising agent's actor-DID. MUST equal the signing stamp's DID (§3). |
| `capabilities` | array of capability-id (§4) | REQUIRED. The capability set the agent advertises. MAY be empty (an agent that is up but claims nothing). |
| `sovereignty` | sovereignty mode | REQUIRED. One of `open`, `selective`, `strict`, `bidding`. |
| `load` | number in `[0,1]` | REQUIRED. Self-reported utilization; clamped to `[0,1]` at registration (§3). |
| `maxConcurrent` | integer ≥ 1 | REQUIRED. Hard ceiling on parallel tasks. |
| `updatedAt` | string (ISO-8601) | REQUIRED. Renewal timestamp; drives liveness with the TTL (§5). |

The reference type is `src/discovery/types.ts:10-25`. A conforming producer
MUST emit the canonical `identity` key for the actor-DID; it MUST NOT emit the
deprecated `principal` key. A conforming consumer, during the R2 transition
window, MUST accept a pre-migration advertisement carrying `principal` in place
of `identity`, and MUST reject an advertisement carrying BOTH keys with the
stable reason `dual_field_conflict` (§3).

A `SignedCapabilityRegistration` is a JSON object with exactly two members:

| Member | Type | Requirement |
|---|---|---|
| `advertisement` | CapabilityAdvertisement | REQUIRED. |
| `signed_by` | Ed25519 stamp (RFC-0004) | REQUIRED. `method: "ed25519"`, `identity` (a `did`), `signature` (base64), `at` (ISO-8601). |

Reference: `src/discovery/types.ts:27-33`. The registration is
**self-registration only**: `signed_by` MUST be a single Ed25519 stamp signed by
the advertising agent's own key. A hub-stamp (RFC-0004) MUST NOT be used to
attest a capability claim — a hub attesting to a capability it cannot itself
perform would defeat the verification model (`docs/discovery.md`, "Self-registration
only"). Note that this document does NOT constrain the `advertisement.capabilities`
values against any grammar at the signing or verification boundary; that gap is
§9.1 and OPEN DECISION §6.4.

---

## 3. Signing, Canonicalization, and Verification (Historical — F-11)

*Per grill D2 the standalone JCS-signed registration retires with F-11. On the
canonical wire (§7) the trust perimeter is the ordinary RFC-0004 **envelope
signature** — the presence payload rides signed envelopes, so the §9.2
divergent-perimeter finding is resolved structurally: there is exactly one
signed perimeter, RFC-0004's. This section records the retired mechanism.*

### 3.1. Canonical bytes

The bytes an advertisement is signed over are the RFC 8785 JCS serialization of
the **`advertisement` object only**, encoded UTF-8. The reference is
`canonicalizeAdvertisement` (`src/discovery/canonicalize.ts:9`), which delegates
to the shared `canonicalStringify` (`src/jcs.ts`). The JCS profile — object-key
ordering, number formatting, string escaping, and the deviations recorded for
the envelope — is specified in **RFC-0004** and MUST be identical here; a JCS
change in RFC-0004 propagates to this document by construction (the primitive is
shared).

The `signed_by` stamp is **NOT** part of the signed bytes: only the
`advertisement` is canonicalized (`src/discovery/register.ts:82-84`). This is a
**divergent signed perimeter** from the envelope (RFC-0004), where each stamp
commits to the prior chain slice, and from the bidding `BidResponse`, where the
stamp's timestamp is inside the signed bytes. The divergence is a finding, not a
design endorsement — §9.2.

The advertisement MUST be canonicalized **bytes-as-received** — never re-keyed.
A pre-migration advertisement carrying `principal` was signed over bytes
containing the string `"principal"`; a verifier MUST canonicalize that same key
to reproduce the signed bytes. The reference reader
(`src/discovery/advertisement-identity.ts`) reads the actor-DID through either
key but never rewrites it before canonicalization.

### 3.2. Signing

`signCapabilityRegistration` (`src/discovery/register.ts:39`) validates, then
signs. A conforming signer:

- MUST resolve the advertisement actor-DID through the dual-field reader and MUST
  reject a both-keys advertisement with `dual_field_conflict` before signing.
- MUST reject an actor-DID that is not a valid `did` (RFC-0001).
- MUST reject when `advertisement.identity` does not equal the signing identity's
  DID (`register.ts:52`) — an agent MUST NOT sign a registration for another
  agent's identity.
- MUST reject `maxConcurrent` that is not an integer ≥ 1 (`register.ts:58`).
- MUST clamp `load` to `[0,1]` and MUST reject a non-finite `load`
  (`register.ts:11-18`).
- MUST sign the canonical bytes (§3.1) with a 32-byte Ed25519 private key
  [RFC8032] and emit the base64 signature in `signed_by.signature`.

The signer does **not** validate `advertisement.capabilities`, `sovereignty`, or
`updatedAt` format (`register.ts` performs none of these checks). That is the
trust-boundary gap of §9.1.

### 3.3. Verification

`verifyCapabilityRegistration` (`src/discovery/verify.ts:31`) is the receive-side
contract. A conforming verifier MUST, in order:

1. Resolve the advertisement actor-DID through the dual-field reader; if the
   advertisement carries both keys, REJECT with `dual_field_conflict`
   (`verify.ts:44-47`).
2. REJECT unless the signing stamp DID equals the advertisement actor-DID
   (anti-spoof; `verify.ts:56-62`), with reason `identity-mismatch`.
3. Resolve the public key from the L4 `IdentityRegistry` (RFC-0004); REJECT an
   unknown identity (`verify.ts:64-67`). Only a KEYED-plane DID (`principal`,
   `stack`, `agent`, `hub` — RFC-0001) can resolve here; a self-asserted DID
   (`surface`, `system`) carries no key and MUST NOT be resolved in the keyed
   registry (RFC-0001 §6.3), so a self-asserted identity cannot register a
   capability advertisement.
4. REJECT when `signed_by.at` is unparseable or drifts from the verifier's clock
   by more than the tolerance (`verify.ts:69-77`). The default tolerance is
   **5 minutes** (`DEFAULT_CLOCK_SKEW_MS`, `verify.ts:9`); the tolerance and its
   replay implications are RFC-0004's contract and MUST match it.
5. REJECT unless the Ed25519 signature verifies over the canonical bytes of the
   advertisement (`verify.ts:88-99`).

Rejection is final; there is no permissive path (`docs/discovery.md`, "Rejection
is final"). Verification checks WHO signed and that the bytes are intact; it does
**not** check that the advertised capabilities are well-formed, that
`sovereignty` is within the enum, that `load` is in range, or that `updatedAt`
parses (`verify.ts` performs none of these). Consequently a syntactically
malformed advertisement, correctly signed, VERIFIES today — §9.1, and the
`advertisement/ungrammatical-capabilities-verify-gap` vector (Appendix B).

---

## 4. Capability Identifier Grammar

### 4.1. The converged grammar (and the two it replaces)

**Resolved (grill D1, closes §6.1): converge-widen.** The canonical
`capability-id` is **dotted-compound with `capability-tag` segments**:

```abnf
capability-id = capability-tag *( "." capability-tag )
```

Each dot-separated segment is a `capability-tag` — the task-side kebab rule
(2–64 chars, leading letter, trailing alphanumeric, interior single hyphens; no
`_`, no `.` within a segment, no leading/trailing/consecutive hyphens) — so a
single-segment id is literally backward-compatible with every existing tag. The
id's dots project 1:1 onto NATS subject segment boundaries: `dev.implement`
projects into the RATIFIED tasks shape `tasks.{capability}.{subcapability}`
(RFC-0002) with no bridge artifact. Underscores are excluded by ratified
grammar, not style — segments project into subjects, and RFC-0001 kebab-strict
forbids `_` — so `federated.subject_dispatch` migrates (`subject-dispatch`) at
flag-day R; live `code-review.typescript`, `deploy.k8s`, `dev.implement`
already conform. The two deployed grammars this converges are transcribed below
for the record; each survives only as noted.

**Ownership.** This document is the single normative owner of the
capability-identifier grammar — `capability-tag`, `capability-id-compound`, and
the eventual converged `capability-id`. RFC-0002's subject grammar and
capability taxonomy reference the rules defined here and MUST NOT transcribe a
second copy (one owner per wire rule; REVISIONS C5). Ownership settles where
the rule lives; the converge-or-retire choice is decided (D1, above).

**capability-tag** — the single-segment tag, `CAPABILITY_TAG_RE`
(`src/patterns.ts:21`, `/^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/`). It is the
grammar the envelope `requirements[]` items enforce (RFC-0003, schema `line 154`)
and therefore the grammar every task-side match is written against. It admits
2–64 characters, a leading letter, a trailing alphanumeric, and interior single
hyphens; it forbids `.`, `_`, leading/trailing/consecutive hyphens, and
single-character tags.

**capability-id-compound** — cortex's dotted-compound id, `CAPABILITY_ID_REGEX`
(cortex `src/common/types/capability.ts:172`,
`/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/`). It admits `.`-separated segments,
each segment starting with a letter and then any of `[a-z0-9_-]` — permitting
`_`, consecutive hyphens, and trailing hyphens the converged grammar forbids.
Post-D1 it is a **superset alias**: conforming ids (each segment a valid
`capability-tag`) are already canonical; ids exercising the wider alphabet
(`federated.subject_dispatch`) are non-conformant and migrate at flag-day R.
The regex itself is a named conformance defect to tighten.

The full ABNF is in Appendix A / `specs/grammar/capability-discovery.abnf`. The
`did` and `lower` terminals it references are RFC-0001's and MUST NOT be
redefined here.

### 4.2. The match rule (C-3 resolved)

**Resolved (grill D1 sub-decision): matching is SEGMENT-PREFIX.** A requirement
matches an advertisement **iff the requirement's segments are a prefix of the
advertisement's segments**: `code-review` matches `code-review.typescript` and
`code-review`; `code-review.typescript` matches only itself (and deeper
specializations). Equal ids trivially match. Grounded twice: the live cortex
matcher is prefix-shaped, and the RATIFIED subject tree routes
`tasks.code-review.>` inclusively — the wire's routing has always been
prefix-shaped; this rule makes the identifier matcher agree with the subject
matcher by construction.

The pre-convergence hazards this closes, for the record: `code_review`
(underscore) and `dev.implement` (dot) advertised fine on the cortex wire and
failed the myelin tag grammar outright; myelin's exact-membership match
(`docs/discovery.md`: `caps.includes(tag)`) rejected `code-review` against
`code-review.typescript` while cortex's prefix match accepted it; and the
seed-tag `code-review` — valid under both grammars — made naive interop tests
pass while hiding all of the above (the `capability-id/masking-shared-tag`
vector, Appendix B). **myelin's exact-membership matcher is a named conformance
defect** against this rule, fixed at flag-day R.

A third, looser grammar appears in prose: `namespace.md:318` (RFC-0002's source)
states the validator "accepts any token matching `^[a-z][a-z0-9-]*$` (max 64
chars)", which admits 1-char tags and trailing hyphens the canonical
`CAPABILITY_TAG_RE` rejects. Where the two disagree, the ABNF governs and the
prose is a defect (per the grounding contract); RFC-0002's ratification is
expected to reconcile its prose to the capability-tag ABNF defined here.

### 4.3. Reserved capability tags

RFC-0002 (namespace) reserves two capability positions: a tag MUST NOT start with
`@` (the Direct/Delegate assistant-address form) and a tag MUST NOT equal
`dead-letter` (the unclaimable-task escalation path) — `namespace.md:165-174`.
Those reservations are owned by RFC-0002; this document references them and a
conforming discovery producer MUST NOT advertise a capability tag that violates
them. **Finding:** neither reservation is enforced in code today — `dead-letter`
satisfies `CAPABILITY_TAG_RE` and reaches the escalation subject builder
unblocked (`src/subjects.ts:304-306`). This is a runtime-guard gap recorded in
§9.4, and the `capability-tag/dead-letter-grammar-accepts` vector pins it.

---

## 5. `AGENT_CAPABILITIES` Key-Value Addressing (Historical — retires with F-11)

*Per grill D2/D4 the KV pull path retires at flag-day R with zero consumers.
Recorded: the shipped store was **DID-keyed** (D4 closes §6.3 for the record);
the TTL/renewal liveness contract is superseded by the presence FSM (§7).*

### 5.1. The bucket and key

The registry is a key-value bucket named **`AGENT_CAPABILITIES`**
(`docs/design-agent-task-routing.md:293`; referenced from the envelope
`requirements` description, RFC-0003 schema, as "Match against AGENT_CAPABILITIES
KV (myelin#9)"). This document reserves the bucket name (§8).

The shipped store keys each `SignedCapabilityRegistration` by the **advertisement
actor-DID** (`src/discovery/memory-store.ts:47-52`) — e.g.
`did:mf:agent.andreas.meta-factory.luna` (the class-explicit, KEYED-plane
agent form, RFC-0001 §6.2; the legacy classless `did:mf:luna` is rejected at
decode from flag-day release R, RFC-0001 §9). A
conforming store MUST key by the actor-DID resolved through the dual-field reader
and MUST reject a both-keys advertisement on write (`memory-store.ts:48-53`).

**[OPEN DECISION — Andreas — see §6.3]** The informative design doc addresses
the same record by agent **short-name** (`"luna"`) with a separate `principal`
field (`docs/design-agent-task-routing.md:293-297`), contradicting the shipped
DID-keyed store. The `advertisement-kv-key` ABNF rule binds to `did` (the shipped
form) pending this decision.

The abstract store interface — `put` / `get` / `delete` / `list` / `watch` /
`close` — is `src/discovery/store.ts`. `list()` is the primary query path;
capability and sovereignty filtering happen client-side over the listed set
(`docs/discovery.md`, "Querying"). A server-side filter API is deferred. The
canonical production store is NATS KV (`NATSCapabilityStore`, deferred to a
follow-up); the shipped `InMemoryCapabilityStore` is not TTL-aware (§5.2).

### 5.2. TTL and renewal liveness contract

Registrations are time-bounded. The deployed F-11 contract
(`docs/discovery.md`, "TTL & liveness"):

| Knob | Value | Meaning |
|---|---|---|
| TTL | 60 seconds | A registration expires 60 s after its last write. |
| Renewal | 30 seconds | The agent re-publishes at half-TTL. |

A conforming agent SHOULD renew its registration at an interval no greater than
half the TTL, so a single missed beat does not evict a live agent. `updateLoad`
(`src/discovery/register.ts:110`) re-signs and re-publishes with a fresh
`updatedAt`; it doubles as the renewal heartbeat when load is unchanged. TTL
expiry is the responsibility of the backing store, NOT of this format: the
in-memory store is explicitly not TTL-aware, and NATS KV per-key expiration
enforces it in the canonical implementation. A verifier therefore MUST NOT treat
presence-in-the-store as freshness on its own — the `signed_by.at` clock-skew
check (§3.3 step 4) is the format-level freshness bound; TTL is the
store-level liveness bound. An agent that crashes silently stops renewing; its
entry expires within one TTL window and consumers observe the absence.

---

## 6. Open Decisions (all RESOLVED — grill 2026-07-15)

All five were resolved by the grill ([`grill-logs/rfc-0008.md`](grill-logs/rfc-0008.md));
each subsection below retains the original question and records its resolution.

| OD | Resolution |
|---|---|
| §6.1 | **Converge-widen**: `capability-id = capability-tag *("." capability-tag)`; segment-prefix matching; underscores migrate at R (D1, §4) |
| §6.2 | **Presence wire canonical; F-11 retires at R** (D2, §7 normative) |
| §6.3 | **DID-keyed**, recorded historically — the KV retires with F-11 (D4, §5) |
| §6.4 | **Trust-boundary validation is a MUST** on the presence path (D5, §7) |
| §6.5 | **Equality-matched v1; ordering RESERVED** (D3, below) |

### 6.1. Capability-id grammar convergence (the C-3 incompatibility)

**RESOLVED → converge-widen (grill D1; §4.1-§4.2 are the normative text).**
Original question: myelin's task side enforces `capability-tag`
(single-segment); cortex's presence side enforces `capability-id-compound`
(dotted, underscore-bearing). Candidate resolutions, presented not chosen:

- **Converge-widen** — myelin adopts the compound grammar for `requirements[]`
  and `capabilities[]`; cost: `.` in a capability spans multiple NATS subject
  segments and must be reconciled with the tasks-domain subject grammar (RFC-0002).
- **Converge-narrow** — cortex retires `_` and `.` from its capability ids and
  migrates `dev.implement` / `federated.subject_dispatch`; cost: breaking change
  to live cortex traffic.
- **Bridge** — a specified, lossless mapping between the two at the M5/M7 seam;
  cost: a third artifact to keep in sync.

The chosen resolution is converge-widen with `capability-tag` segments and
segment-prefix matching (§4.1/§4.2); the ABNF `capability-id` rule is now the
converged grammar, not a placeholder.

### 6.2. Which discovery wire is canonical

**RESOLVED → presence wire canonical; F-11 retires (grill D2; §7 is the
normative wire).** Original finding: cortex consumes none of myelin's F-11 API
(zero references to `registerCapabilities` / `CapabilityAdvertisement` /
`SignedCapabilityRegistration` / `verifyCapabilityRegistration` on cortex
origin/main) and instead ships a parallel push-model wire
(`agent.capabilities-changed`, §7). Decide whether F-11 is the normative
discovery wire (cortex adopts it), the presence wire is (F-11 retires), or a
specified adapter bridges them.

### 6.3. `AGENT_CAPABILITIES` key grammar

**RESOLVED → DID-keyed, recorded historically (grill D4).** The shipped store
was DID-keyed; the KV contract retires with F-11 (§5), so this closes as a
record, not a live rule.

### 6.4. Advertisement shape validation at the trust boundary

**RESOLVED → MUST validate at the trust boundary (grill D5).** The presence-path
receiver MUST validate each `capabilities[]` entry against the §4.1 converged
grammar, the payload against its schema (identity/scope shapes, §7), and MUST
reject a reserved tag (§4.3) before folding into the registry. The §9.1
runtime-guard gap is the named conformance defect. (The F-11-scoped framing —
`verifyCapabilityRegistration`, `sovereignty` enum bounds, `load`/`maxConcurrent`
ranges — retires with F-11, whose exclusive fields it validated.)

### 6.5. `sovereignty_required` matching semantics

**RESOLVED → equality-matched v1; ordering RESERVED (grill D3).**
`match(required, declared) := required == declared` — a requirement matches only
an agent declaring the identical mode. The partial order the field name implies
is explicitly **RESERVED**: no source, doc, or usage defines one (the sole
reference is a dangling `matchesSovereigntyMode` helper in an informative
snippet, `docs/discovery.md:155`), and inventing a placement for `bidding` would
be design-by-spec. A future `Updates:` MAY define an ordering — widening
match-acceptance is compatible, narrowing is not. "Minimum" in the field name is
recorded as aspirational, not semantic. The rule applies wherever a declared
mode meets a required mode (dispatch admission), independent of discovery
carriage.

**Ownership (settled by the 2026-07-13 cascade sweep, REVISIONS C4):** this
document is the single normative owner of the `sovereignty_required`
match-semantics/ordering. RFC-0003 (which carries the field) and RFC-0005
(which owns the sovereignty block; its OD-7 formerly dual-claimed this rule)
defer here and MUST NOT define a competing ordering. Ownership fixes where the
rule will be written, not what it says — the ordering itself remains open,
above.

---

## 7. The Presence Discovery Wire (Normative)

**This is the canonical discovery wire (grill D2, closes §6.2).** It is the
`agent`-domain presence protocol (ADR-0007), promoted from informative to
normative by this revision:

- **Subjects.** `{scope}.{principal}.{stack}.agent.{action}` with `action` ∈
  `online | heartbeat | offline | capabilities-changed` (cortex
  `src/bus/agent-network/envelopes.ts:75`, `builders.ts:288`). The subject
  grammar itself is RFC-0002's; this document owns the payloads and semantics.
- **Trust.** Presence payloads ride ordinary **signed envelopes** — the
  RFC-0004 envelope signature is the one and only signed perimeter (no
  standalone registration signature; §3 records the retired F-11 mechanism).
- **Payloads.** `agent.online` carries `{ identity, scope, capabilities[],
  started_at }`; `agent.capabilities-changed` carries `{ identity, scope,
  capabilities[], sent_at }` (`AgentOnlinePayloadSchema` /
  `AgentCapabilitiesChangedPayloadSchema`,
  `src/bus/agent-network/envelopes.ts:182,232`). `identity` is the
  `{ nkey_public_key, agent_id, assistant_name }` block; `scope` is
  `{ principal, stack }` — identity provenance, never a network token
  (the network name is never on the wire). Each `capabilities[]` entry MUST be
  a §4.1 converged `capability-id`.
- **Full-set semantics (normative).** `capabilities-changed` carries the FULL
  new steady-state set, never a diff — a subscriber that missed a delta still
  converges; the subscriber computes the diff against its own record.
- **Liveness.** The subscriber's TTL FSM keeps a record `online` while
  heartbeats arrive within the TTL and transitions it `offline` on lapse
  (ADR-0007); `agent.offline` is the graceful form. Liveness is the FSM's —
  there is no KV TTL (§5 retired).
- **Privacy floor.** Presence payloads carry identity, liveness, and declared
  capabilities — NO session interiors, tool calls, or prompts (ADR-0005),
  restated here as a MUST NOT.
- **Trust-boundary validation (grill D5, closes §6.4).** Before folding an
  announcement into its registry a subscriber MUST: validate the payload
  against its schema; validate every `capabilities[]` entry against §4.1;
  reject reserved tags (§4.3) from unauthorized advertisers; and bound
  aggregate payload size (§9.7). The deployed fold-without-validation is the
  §9.1 named conformance defect.

The retired **pull** model (F-11: agents write JCS-signed registrations to KV;
consumers list) differed in transport, liveness, and grammar; §2/§3/§5 record
it. The grammar divergence is closed by D1 (§4); the wire divergence by this
section.

---

## 8. Registry Considerations

- **RFC number.** This document is allocated RFC-0008 in
  [`specs/README.md`](../README.md); numbers are never reused.
- **Reserved KV bucket name.** This document reserves **`AGENT_CAPABILITIES`** as
  the key-value bucket for signed capability registrations (§5).
- **Reserved capability positions.** The `@`-prefixed and `dead-letter`
  capability-tag reservations are owned by RFC-0002 (namespace); this document
  references them (§4.3) and reserves nothing new in the subject namespace.
- **Capability-identifier rules.** This document is the sole registrant of the
  `capability-id`, `capability-tag`, and `capability-id-compound` grammar rules
  (§4). Siblings (RFC-0002's taxonomy and subject grammar, RFC-0003's
  `requirements[]`) reference them and MUST NOT redefine them. Conversely,
  RFC-0001 §7 excludes the capability-id from its identity-terminal registry: a
  capability-id is NOT a DID (§4.4).
- **`sovereignty_required` match semantics.** Normatively owned by this
  document (§6.5); RFC-0003 (field carriage) and RFC-0005 (sovereignty block)
  reference it.
- **External registries.** This document defines no DID method and registers
  nothing in the W3C DID Specification Registries; the `did:mf` method is
  RFC-0001's concern.

---

## 9. Security Considerations

REQUIRED. This section states where a property is held by a runtime check rather
than by the format — an invariant held shut by vigilance is a finding, not a
design.

### 9.1. Advertisement shape is unvalidated at the trust boundary (runtime-guard gap)

`verifyCapabilityRegistration` (`src/discovery/verify.ts`) validates the signer,
the registry resolution, the clock skew, and the Ed25519 signature — and nothing
about the advertisement's content. `capabilities[]` entries are checked against no
grammar; `sovereignty` is a TypeScript-type-only constraint erased at runtime;
`load` and `maxConcurrent` are unchecked at verify time (they are only checked
and clamped by `signCapabilityRegistration` on the *signing* side,
`register.ts:11-18,58`, which an off-path forger bypasses); `updatedAt` format is
unchecked. Therefore a syntactically malformed but correctly signed advertisement
— ungrammatical tags, reserved `dead-letter`, out-of-range `load`, a
non-enum `sovereignty` — VERIFIES today (the
`advertisement/ungrammatical-capabilities-verify-gap` and
`advertisement/load-clamped-on-register` vectors). Consumers that embed a
capability tag into a NATS subject or KV key downstream inherit whatever the
advertiser wrote, including strings that are illegal or wildcard-adjacent in
those positions. This is a **format vs runtime-guard** gap: nothing in the wire
format constrains the content, and the only partial guard runs on the wrong side
of the trust boundary. **RESOLVED as a rule (grill D5, §7): the presence-path
receiver MUST validate before folding — this gap is the named conformance
defect** (the F-11-scoped instance retires with F-11; the live instance is the
presence registry's fold-without-validation). The grammar to validate against is
the §4.1 converged `capability-id` (D1).

### 9.2. Divergent, unwritten signed perimeter

The advertisement signs `JCS(advertisement)` with the `signed_by` stamp
**excluded** from the signed bytes (`register.ts:82-84`), whereas the envelope
(RFC-0004) commits each stamp to the prior chain slice, and the bidding
`BidResponse` folds the stamp timestamp into the signed bytes. Three signed
artifacts, three different perimeters, none of them previously written down. A
consumer that assumes envelope-style chain semantics for a discovery record — for
example, expecting the stamp `at` to be signed — is wrong. Because the stamp is
outside the signed bytes, the stamp's `at` is malleable by anyone who can rewrite
the unsigned wrapper; the clock-skew check (§3.3 step 4) is what bounds a
replayed advertisement's freshness, not a signature over `at`. **RESOLVED
STRUCTURALLY (grill D2): the standalone perimeter retires with F-11 — on the
canonical wire (§7) the only signed perimeter is RFC-0004's envelope signature,
so the three-perimeters divergence collapses to one.** The finding stays
recorded for the historical mechanism's decode-compat window.

### 9.3. Two parallel wires that do not reconcile

Because cortex advertises on `agent.capabilities-changed` (§7) and consumes none
of F-11, an agent visible on one wire is invisible on the other. A dispatcher
that queries only the F-11 KV sees no cortex-advertised agents, and vice versa. A
network that runs both silently partitions its capability view. **RESOLVED
(grill D2, §6.2): the presence wire is canonical and F-11 retires at flag-day R
— after R there is one wire and no partition.** Until R, running both remains a
security-relevant availability hazard: capability-based routing decisions made
against a partitioned registry are made against a false picture of the fleet.

### 9.4. Reserved-tag reservations are unenforced

`namespace.md:172-174` (RFC-0002) declares a capability tag equal to
`dead-letter`, or starting with `@`, a publish-time validation error. No code
enforces it: `dead-letter` satisfies `CAPABILITY_TAG_RE` and reaches the
dead-letter escalation subject builder (`src/subjects.ts:304-306`) unblocked. An
advertiser or task publisher can therefore inject work onto the escalation path
by naming a capability `dead-letter`. Enforcement now rides the D5 trust-boundary
gate (§7): a subscriber MUST reject a reserved tag before folding, and a
publisher MUST reject it at publish time — the absent runtime guard is the named
conformance defect. RFC-0002 owns the reservation; this document owns the gate
and pins the gap with a vector.

### 4.4. A capability-id is not a DID (reserved identifiers, RFC-0001 §7)

A capability identifier — under either §4.1 grammar — is **NOT a DID**.
RFC-0001 §7 ("Terminal alphabets") explicitly excludes the capability-id from
its identity-terminal registry. A conforming implementation MUST NOT mint a
capability-id into a DID position — an advertisement `identity`, a `signed_by`
stamp identity, the `AGENT_CAPABILITIES` actor-DID key (§5.1), or a subject
`@`-segment — and MUST NOT use a DID where a capability-id is expected.

Within the identifier plane, `.` is the structural separator (RFC-0001 §6.2),
and the six class tags — `principal`, `stack`, `agent`, `hub`, `surface`,
`system` — are recognized **only at DID position 0** (the first `.`-delimited
token of a `did:mf` method-specific-id, drawn from RFC-0001 §7's closed,
fail-closed registry). A dot inside a capability-id-compound is
capability-namespace (and NATS subject) structure, not identifier-plane class
structure: `dev.implement` carries no class tag, and a leading compound segment
that happens to spell a class tag (a hypothetical `agent.review`) is not a
class tag, because it does not sit at DID position 0. This plane separation
holds regardless of how the C-3 grammar reconciliation (§6.1) resolves.

### 9.5. Self-registration: capability claims are attested by no third party

Discovery is self-registration only (§2). The verification model proves *who
signed* the advertisement, not that the signer *can perform* the advertised
capabilities. A compromised or dishonest agent key can advertise arbitrary
capabilities and a verifier will accept them; nothing on the wire attests
competence. This is intentional (`docs/discovery.md`, "Self-registration only":
a hub attesting a capability it cannot perform would be worse), but it means
capability match is an availability/routing signal, not an authorization
decision. Authorization on top of capability match is explicitly out of scope and
belongs to per-network policy at M7 (`docs/discovery.md`, "Out of scope").

### 9.6. Economics is a mutable, unsigned annotation

The envelope `economics` block (RFC-0003 schema; the F-15 half of this audit
dimension) is outside the SIGNABLE fields (RFC-0004) and carries
`additionalProperties: true` with no size bound. It MUST NOT inform any security
or trust decision (`schemas/envelope.schema.json`, economics description:
"MUST NOT inform security or trust decisions"). A capability-routing or bidding
implementation MUST treat `economics.budget` / `economics.actual` as an unsigned
hint an intermediary may have altered, never as a signed constraint. This
document does not own the economics block (RFC-0003 does) but records the
constraint because discovery-adjacent bidding consumes it.

### 9.7. Unbounded advertisement content

`capabilities[]` has no maximum length or item-count bound expressed at the
discovery boundary (contrast the envelope `requirements[]` `maxItems: 10`,
RFC-0003), and JCS canonicalization has no depth/width cap (RFC-0004). A verifier
processing attacker-supplied registrations SHOULD bound the work it will do per
record; this document does not yet specify the bound (tracked with the §6.4
validation decision).

---

## 10. Privacy Considerations

REQUIRED for any document that specifies an identifier. This document specifies
the advertisement actor-DID (a `did`), the capability tags, and the
`AGENT_CAPABILITIES` KV key.

- **The registry is a capability disclosure surface.** Any party with read access
  to `AGENT_CAPABILITIES` (or to the `agent.capabilities-changed` stream, §7) can
  enumerate every agent's DID and full declared capability set. Capability tags
  can be organizationally revealing (`security-scan`, a niche domain tag).
- **The DID is a stable cross-context correlator.** The KV key is the actor-DID
  (§5.1), so an observer can correlate an agent's capability set, `load`
  trajectory, and renewal cadence across every registration under one stable
  identifier. The DID class-collision and injectivity concerns are RFC-0001's;
  they apply to the key here by reference.
- **`load` is an activity side channel.** A self-reported `[0,1]` utilization,
  re-published every ~30 s, discloses an agent's real-time busyness to anyone
  watching the registry — a timing/activity oracle independent of any task
  payload.
- **`updatedAt` / renewal cadence leaks liveness and uptime patterns.** The
  30 s renewal beat makes an agent's presence, restarts, and outages observable
  to any registry reader (the intended liveness signal is also an availability
  side channel).
- **Cross-network containment.** Each network owns its own registry; a capability
  set does not cross a network boundary except via an explicit federation
  handshake, never a registry merge (`docs/discovery.md`, "Out of scope";
  architecture §5.4). A conforming implementation MUST NOT replicate one
  network's `AGENT_CAPABILITIES` into another's without that handshake. This
  bounds the disclosure surface to a single network's readers.

---

## 11. Conformance

An implementation conforms to this document if and only if it passes every vector
under the path named in `vectors` (`specs/vectors/capability-discovery/`). Prose
explains; **vectors bind.**

A conforming implementation MUST, using its **own** parser and verifier (not an
import of the myelin reference):

1. Accept exactly the `capability-tag` language and reject everything else, per
   the `parseCapabilityTag` vectors — including rejecting single-char,
   uppercase, underscore, dot, digit-prefix, and consecutive/trailing-hyphen
   inputs.
2. Recognise the `capability-id-compound` language for the cortex-side ids, per
   the `parseCapabilityIdCompound` vectors.
3. Reproduce the cross-grammar masking result (`crossGrammarAgreement`) — i.e.
   demonstrate that a shared seed tag is accepted by both grammars and is
   therefore not a sufficient interop test on its own.
4. Enforce the verification chain (§3.3): reject `identity-mismatch` and
   `dual_field_conflict`; reject non-positive `maxConcurrent`; clamp `load`.

The `advertisement/ungrammatical-capabilities-verify-gap` and
`capability-tag/dead-letter-grammar-accepts` vectors pin **current** behaviour
(the §9.1 and §9.4 gaps). They carry an explicit `why` recording that they flip
to a rejection once OPEN DECISION §6.4 / RFC-0002 enforcement lands — a
change-log event, never a silent edit.

See [`specs/CONFORMANCE.md`](../CONFORMANCE.md).

---

## 12. References

### 12.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC8259] Bray, T., Ed., "The JavaScript Object Notation (JSON) Data Interchange Format", STD 90, RFC 8259, December 2017.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020.
- [RFC8032] Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital Signature Algorithm (EdDSA)", RFC 8032, January 2017.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)". *(Draft — the `did`, `lower`, `DIGIT` terminals; the class-explicit method-specific-id grammar and two-plane class taxonomy resolving cortex#1880, ratified 2026-07-12 (Andreas), pending JC co-signature; the §7 reserved-identifiers registry excluding capability-id.)*
- [RFC-0002] metafactory, "Subject Namespace". *(Draft — the tasks-domain capability segment, the `@`/`dead-letter` reservations, the capability taxonomy.)*
- [RFC-0003] metafactory, "Envelope". *(Draft — `requirements[]`, `sovereignty_required`, `deadline`, `distribution_mode`, `target_assistant`, `economics`.)*
- [RFC-0004] metafactory, "Envelope Signing and Canonicalization". *(Draft — the JCS profile, the clock-skew rule, the SIGNABLE-field doctrine, the base64 signature caveats.)*
- [RFC-0005] metafactory, "Sovereignty and Boundary-Crossing". *(Draft — the sovereignty block and mode vocabulary; its OD-7 defers the `sovereignty_required` match semantics to this document, §6.5.)*

### 12.2. Informative References

- [discovery.md] metafactory myelin, `docs/discovery.md` — L5 discovery design (promoted to normative by this RFC; `supersedes_prose`).
- [task-routing] metafactory myelin, `docs/design-agent-task-routing.md` — Pattern 4 and the `AGENT_CAPABILITIES` KV example.
- [ADR-0007] metafactory cortex, "agent-presence protocol" — the parallel `agent.capabilities-changed` wire (§7).
- [DID-CORE] W3C, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The
file named in `grammar` (`specs/grammar/capability-discovery.abnf`) is the source
of truth and is what CI validates. The `did` and `lower` terminals are RFC-0001's.

```abnf
; specs/grammar/capability-discovery.abnf
; RFC-0008 — Capability Discovery and Advertisement
; Status: Draft. NOT normative until Ratified.
; Terminals `lower`, `DIGIT`, `did` are imported from RFC-0001; %s"…" per RFC 7405.

; 1. Capability identifier.  *** OPEN DECISION — Andreas + JC — §6.1 ***
capability-id           = capability-tag / capability-id-compound

; capability-tag — single-segment tag. Transcribes CAPABILITY_TAG_RE,
; myelin src/patterns.ts:21  /^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/
; 2-64 chars; first char lower; last char alnum; interior single hyphens only;
; NO ".", NO "_", NO leading/trailing/consecutive "-"; single-char FORBIDDEN.
; The 2..64 length bound is a semantic constraint (regex {0,62}); the run
; decomposition expresses the character/hyphen rules exactly.
capability-tag          = lower 1*tag-sym *( "-" 1*tag-sym )
                        / lower 1*( "-" 1*tag-sym )
tag-sym                 = lower / DIGIT

; capability-id-compound — cortex dotted-compound id. Transcribes
; CAPABILITY_ID_REGEX, cortex src/common/types/capability.ts:172
;   /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/
; ADMITS "_", consecutive/trailing hyphens, and "." (multiple NATS segments);
; NO upper length bound. Its live ids ("dev.implement",
; "federated.subject_dispatch") are unexpressible as a capability-tag.
capability-id-compound  = compound-segment *( "." compound-segment )
compound-segment        = lower *( lower / DIGIT / "_" / "-" )

; 2. Advertisement leaf grammars.
; sovereignty-mode — case-sensitive lowercase enum. src/discovery/types.ts:7.
; The "minimum" ordering it implies is UNDEFINED — OPEN DECISION §6.5.
sovereignty-mode        = %s"open" / %s"selective" / %s"strict" / %s"bidding"

; advertisement-identity — actor-DID / registration stamp DID. A `did`
; (RFC-0001). R2 window also reads deprecated `principal`; both keys => reject
; dual_field_conflict. Constrains the VALUE, not the key.
advertisement-identity  = did

; advertisement-kv-key — AGENT_CAPABILITIES key. SHIPPED store keys by the
; actor-DID (memory-store.ts:47-52). *** OPEN DECISION §6.3 — design doc keys
; by short-name. ***
advertisement-kv-key    = did
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/capability-discovery/` so
implementations in any language can consume them; each carries a `why`. This
appendix reproduces a representative subset — it is not the only copy. See
[`specs/vectors/README.md`](../vectors/README.md) for the schema. The full set is
20 vectors covering the capability-tag accept/reject language, the cortex
compound ids, the shared-tag **masking** case, the underscore/dot **C-3
collision** pair, and the advertisement verification chain (identity-mismatch,
dual_field_conflict, maxConcurrent, load-clamp, and the §9.1 unvalidated-shape
gap).

```jsonc
// The C-3 incompatibility — an id valid under exactly one grammar:
{
  "id": "capability-tag/underscore-rejected-C3",
  "rfc": 8, "kind": "parseCapabilityTag", "input": "code_review",
  "expect": { "ok": false, "reason": "underscore-not-allowed" },
  "why": "cortex CAPABILITY_ID_REGEX ACCEPTS '_'; the myelin capability-tag REJECTS it. Blocked on OPEN DECISION §6.1."
}
// The masking case — a shared tag that hides the incompatibility:
{
  "id": "capability-id/masking-shared-tag",
  "rfc": 8, "kind": "crossGrammarAgreement", "input": "code-review",
  "expect": { "ok": true, "value": { "acceptedByTag": true, "acceptedByCompound": true } },
  "why": "Accepted by BOTH grammars, so an interop test drawn only from the shared seed taxonomy PASSES and HIDES the C-3 incompatibility."
}
// The trust-boundary gap — a malformed advertisement that verifies today:
{
  "id": "advertisement/ungrammatical-capabilities-verify-gap",
  "rfc": 8, "kind": "verifyCapabilityRegistration",
  "input": { "advertisement": { "identity": "did:mf:agent.andreas.meta-factory.luna", "capabilities": ["code_review","dead-letter","Bad--Tag"], "sovereignty": "selective", "load": 0.2, "maxConcurrent": 4, "updatedAt": "2026-07-12T00:00:00Z" }, "signed_by": { "method": "ed25519", "identity": "did:mf:agent.andreas.meta-factory.luna", "signature": "<valid-over-canonical-bytes>", "at": "2026-07-12T00:00:00Z" } },
  "expect": { "ok": true, "value": { "identity": "did:mf:agent.andreas.meta-factory.luna" } },
  "why": "SECURITY GAP §9.1 — capabilities[] is validated against no grammar; a malformed advertisement VERIFIES. Flips to ok:false once §6.4 lands."
}
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here.
A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Specifies the F-11 CapabilityAdvertisement / SignedCapabilityRegistration shape, JCS+Ed25519 verification chain (deferring the profile to RFC-0004), AGENT_CAPABILITIES KV addressing, and the 60s/30s TTL/renewal contract. Records the capability-tag vs cortex capability-id-compound C-3 incompatibility and the two-parallel-wires gap as OPEN DECISIONS. Promotes docs/discovery.md. 20 conformance vectors (masking + C-3 collision + verify chain + trust-boundary gap). |
| 2026-07-13 | Draft | Cascade sweep (decision-free; REVISIONS C4/C5/C10 + RFC-0001 D26 cascade). Declared this document the single normative owner of the `sovereignty_required` match semantics/ordering (§1, §6.5, §8 — RFC-0003/RFC-0005 defer here; the ordering itself stays OPEN) and of the capability-identifier grammar (§4.1, §8 — RFC-0002 cites, never transcribes; converge-or-retire §6.1 stays OPEN). Added §4.4 reserved-identifiers rule: a capability-id is NOT a DID and MUST NOT be minted into DID position; `.` is the identifier-plane structural separator; the six class tags are recognized only at DID position 0 (RFC-0001 §7). Identity examples flipped to class-explicit KEYED-plane form (`did:mf:agent.andreas.meta-factory.luna` — §5.1, Appendix B); §3.3 step 3 notes a self-asserted-plane DID cannot register. Added `0005` to crossRefs and RFC-0005 to normative references; refreshed the RFC-0001 reference (class-explicit encoding ratified 2026-07-12, pending JC co-signature). No open decision of this document was resolved, weakened, or removed. |

## Acknowledgments

This document is grounded in the recovered wire-protocol audit (discovery-econ
dimension) and the F-11 reference implementation (myelin#50). The C-3
incompatibility and the unvalidated-advertisement finding were surfaced by that
audit.

## Authors' Addresses

Luna (metafactory) — drafting agent, on behalf of the principal.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
