---
rfc: 0003
title: Envelope Format
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
ratified: 2026-07-14
grammar: specs/grammar/envelope.abnf
vectors: specs/vectors/envelope/
generated:
  - schemas/envelope.schema.json
crossRefs:                       # sibling RFCs this document cites (grill rfc-0003.md D26 citation sweep, 2026-07-14)
  - "0001"                       # did:mf terminals, two-plane taxonomy (§2.1), agent-originator prefix binding (§2.2), class-explicit dot-form (§6.2), hard-cut migration (§9)
  - "0002"                       # subject namespace — source→subject derivation (§8.1), prefix-classification alignment (§8.3), federation addressing (§8.4), subject-position capability tag + capability-id projection (§6.3, §8.5)
  - "0004"                       # signing — OWNS the field-id registry membership + ids (§4.1), the allocation rule (§4.1.1), the mutable carve-out (§4.2), canonicalization (§3), the two-plane verifier rule (§5.1), the origin/stack anchor (§5.5 D11/D16), the agent-prefix verify (§7.1), canonical signature (§6.2)
  - "0005"                       # sovereignty block enforcement (§2), data_residency registry (§2.3), sovereignty_required vocabulary (§2.6)
  - "0007"                       # transport — correlation_id (§8), request-reply reply_to (§7.1), redelivery, whole-envelope size transport alignment
  - "0008"                       # capability discovery — OWNS the capability-tag grammar (§4.1) this document transcribes for requirements[] enforcement (§3.12); sovereignty_required match semantics/ordering (§6.5)
  - "0009"                       # economics block (§2), wallet any-class role (§5.6), mutable-channel byte bounds (§5.5, shared with this document's D13)
  - "0010"                       # refusal taxonomy — the non-agent originator binding reject (§3.17/§10) wire-surfaces as `policy_denied` (RFC-0010 §2.2), Draft (myelin#251)
  - "bcp-0001"                    # change control — spec_version emission window + $id/version-channel reconciliation (§5); listed Normative in §13.1 (#236 item 6)
openDecisions: []                # the grill (grill-logs/rfc-0003.md, 26/26, Andreas 2026-07-14) resolved every open decision of this document; residual questions are cross-doc handoffs owned elsewhere (§8), not open decisions here.
supersedes_prose:
  - docs/envelope.md
  - docs/architecture.md (M3 envelope + spec_version paragraphs)
---

# RFC-0003: Envelope Format

## Abstract

This document specifies the myelin **envelope** — the single, universal JSON container that wraps
every signal crossing the metafactory agentic bus (M3 of the Myelin layer model). It defines the
envelope's required and optional fields, the per-field lexical grammar, the closed-contract rules
that reject unknown keys, and the boundary between the fields covered by a cryptographic signature
and the mutable fields that are not. It promotes the previously informative JSON Schema
(`$id https://myelin.metafactory.ai/schemas/envelope/v3`) to a normative, generated artifact, and
it additionally scopes in two contracts that a JSON Schema structurally cannot express: the wire's
carriage of the signable/mutable field boundary (whose *membership* RFC-0004 owns) and the
`spec_version` wire-grammar-versioning semantics. The signing and verification *algorithm* itself —
and the authoritative field-identifier registry it keys on — is RFC-0004's; this document CARRIES
that registry's id↔name mapping alongside each field. This revision resolves the twenty-six
decisions of the RFC-0003 grill ([`grill-logs/rfc-0003.md`](grill-logs/rfc-0003.md), ratified by
the principal 2026-07-14) and removes every open-decision marker they closed: the UUID grammar is
pinned version-agnostic, the datetime grammar to strict RFC 3339, a whole-envelope size bound and
structural caps are set, the mutable channels gain receive-side byte caps, `source` becomes a full
class-explicit `did:mf` agent DID, and the two-plane DID-placement law is enforced at both the
schema pattern and verify time. Field grammars are transcribed from the deployed reference
implementation and tightened onto their ratified targets at the flag-day-R hard cut (RFC-0001 §9).

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Ratified` (single-principal, 2026-07-14) under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md). Only a document with status
`Ratified` is normative; implementations MUST NOT ground behaviour on a `Draft` or `Proposed`
document. This document is normative and buildable-against; its decisions were resolved by the
RFC-0003 grill (26/26, 2026-07-14) and ratified single-principal per ADR-0001. As a living spec it
stays revisable if review or use finds a hole. Ratification has now happened; even so, the
flag-day-R tightenings this document ratifies (`source`→agent DID, `signed_by` array-only, strict
`datetime`/`uuid`) do not take effect before the coordinated flag-day cutover (RFC-0001 §9).

A `Ratified` RFC is, under ADR-0001, a **living spec**: `Ratified` means the current best contract
the implementation tracks; section numbering stays stable so citations hold, and a hole is resolved
by revising the RFC. The immutable-once-`Ratified` discipline (changes shipped only as a new RFC
carrying `Updates: NNNN` or `Obsoletes: NNNN`) is the reinstate-target that returns with the
two-signature rule.

Ratification (v1) requires the signature of **the principal** (Andreas) alone, recorded in
`signatories` (ADR-0001). The full two-signature act (principal + the hub custodian, JC) is
suspended, not deleted: it reinstates the moment the wire binds a party we do not control — a
second independent implementation, or a live federated peer principal.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
2. Envelope Model
3. Field Specifications
4. The Signable / Mutable Boundary
5. `spec_version` Semantics
6. Structural Rules
7. Actor Resolution
8. Decisions and Cross-Document Handoffs
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

Every signal that crosses the myelin bus — an alert, a task, a review request, a heartbeat, a bid
— is wrapped in exactly one envelope. One schema for all signals means any consumer can parse any
signal without per-domain glue; the `payload` is the only domain-specific part. The envelope is the
unit of **sovereignty travel**: it is self-contained and self-describing, so any layer above M3 can
decide policy compliance from the envelope alone, without an out-of-band lookup.

This document makes that container normative. It exists because the envelope contract was, at time
of writing, defined in **three mutually contradictory places** — a hand-written TypeScript
validator that `docs/envelope.md` declares "the source of truth", a JSON Schema that document calls
"a mirror", and the actual cross-repo enforcement in cortex, which compiles the *vendored JSON
Schema* with Ajv and thereby makes the schema the de facto contract. A wire contract with three
authorities is a wire contract that will drift. RFC-0003 ends that by naming one source of truth
(this document and its generated artifacts) and one conformance oracle (the vectors).

### 1.1. Scope and Charter

This document **widens** the RFC-0003 charter beyond the scaffold's one-line "promotes
`schemas/envelope.schema.json`". A JSON Schema can express field shapes and the closed contract; it
cannot express two contracts the wire depends on. RFC-0003 therefore normatively owns, in addition
to the schema:

- **The wire's carriage of the signable / mutable field boundary** (§4) — which fields a signature
  covers and which are a deliberate mutable carve-out. RFC-0003 **carries** this boundary and the
  id↔name mapping alongside each field's definition; it does **not** define the boundary's
  membership. **RFC-0004 §4.1 (the signable field set and its permanent field-ids), §4.1.1 (the
  permanent allocation rule), and §4.2 (the mutable carve-out) GOVERN** — ownership sits where the
  cryptographic consequences of a change are analysed. The two documents cite one another; neither
  duplicates the other's table (RFC-0004 §4.1 "Ownership (D3)").
- **`spec_version` semantics** (§5) — the wire-grammar version field and its warn-on-newer rule,
  which is inexpressible in JSON Schema and lives only in code.

**In scope:** the envelope field set and per-field syntax; the closed-contract and cross-field
structural rules; the whole-envelope size bound, the canonicalization structural caps, and the
mutable-channel byte caps; the carriage of the signable/mutable boundary and its field-ids;
`spec_version`; actor resolution.

**Out of scope (referenced, not defined here):** the `did:mf` grammar and identity classes, and the
two-plane placement taxonomy (RFC-0001); the NATS subject namespace and the composition of a subject
from envelope fields (RFC-0002); the field-id registry *membership* and *id assignments*, the
signing/verification/canonicalization algorithm, clock-skew freshness, and the origin/stack chain
anchor (RFC-0004); the sovereignty *enforcement* engine — who decrements `max_hop`, where
classification is enforced (RFC-0005); the request-reply and correlation transport mechanics
(RFC-0007); the economics semantics (RFC-0009); the wire change-control and emission-window
scheduling (BCP-0001).

### 1.2. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as
described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown
here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in all
> capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.3. Terminology

Terms are defined once. Where a term belongs to another RFC, it is cited, not redefined.

- **Envelope** — the JSON object specified by this document.
- **Field** — a top-level key of the envelope object.
- **Required field** — one of `id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`.
- **Optional field** — any of the remaining eleven fields defined in §3.
- **Closed contract** — the property that unknown keys are rejected (`additionalProperties: false`)
  at the top level, inside `sovereignty`, inside `originator`, and inside each stamp. This is
  **permanent**: a newer `spec_version` does **not** license unknown top-level keys (§5).
- **DID** — a `did:mf` decentralized identifier, defined by **RFC-0001** (Ratified single-principal,
  ADR-0001): the class-explicit dot-form `did:mf:{class-tag}.{segments}` (RFC-0001 §6.2). **Six**
  envelope fields are DID-valued: `source`, `target_assistant`, `originator.identity`,
  `economics.wallet`, `signed_by[].identity`, and `signed_by[].stamped_by`. RFC-0001's two-plane
  rule (§2.1) applies: only a **keyed**-class DID (`principal`, `stack`, `agent`, `hub`) may appear
  in `signed_by[]`; a **self-asserted**-class DID (`surface`, `system`) appears in `originator`
  only. The migration from the legacy flat form is a **hard cut** at flag-day release R (RFC-0001
  §9) — no dual-accept window; the envelope-field DID and the subject `@`-segment flip atomically.
  RFC-0003 does not define DID syntax.
- **Subject** — the NATS subject a message is delivered on, defined by **RFC-0002**. The subject is
  **not** an envelope field (§10).
- **Stamp** — one element of the `signed_by` identity chain: an `ed25519` or `hub-stamp`
  attestation. Its cryptographic meaning is RFC-0004's; RFC-0003 defines only its shape.
- **Chain** — the ordered array of stamps in `signed_by`.
- **Signable field** — a field included in the bytes a stamp signs; its membership and permanent
  field-id are RFC-0004 §4.1's, carried here (§4).
- **Mutable field** — a field deliberately excluded from the signature and carrying **no field-id**
  (`correlation_id`, `economics`, `extensions`; RFC-0004 §4.2).
- **Actor** — the identity whose capabilities an envelope asserts, resolved by §7.
- **Originator** — the `originator` block: the policy-level claim of the actor, distinct from the
  cryptographic signer.
- **`spec_version`** — the optional wire-grammar version integer (§5).
- **Reference implementation** — the myelin TypeScript in `src/` on `origin/main`. Where this
  document transcribes a deployed regex, that code is cited as informative provenance; the ABNF and
  vectors are normative, not the source line. Deployed loose regexes tighten onto their ratified
  targets at flag-day release R (RFC-0001 §9, hard cut).

---

## 2. Envelope Model

An envelope is a JSON object. Its wire form is UTF-8 JSON. The normative structure is the generated
JSON Schema listed in `generated` (`schemas/envelope.schema.json`, draft 2020-12); the normative
lexical syntax of its string fields is Appendix A. Where a generated artifact and the ABNF disagree,
**the ABNF governs and the artifact is a defect** (specs/README.md rule 4).

An envelope **MUST** contain exactly the six required fields and **MAY** contain any of the eleven
optional fields. An envelope **MUST NOT** contain any other top-level key: the contract is closed
(`additionalProperties: false`). New metadata **MUST** go in `extensions` (a mutable channel) or a
new, field-id-allocated signable field (RFC-0004 §4.1.1); it **MUST NOT** be added as an ad-hoc
top-level key. This closure is **permanent**: no `spec_version` value licenses an unknown key (§5).

The field set — with the **field-id** each signable member is addressed by in the signing bytes
(RFC-0004 §4.1). `—` marks a **mutable carve-out** field, which carries **no field-id** (RFC-0004
§4.2). The row order below is documentary only; RFC-0004 §4.1 is the authority for which ids exist
and what they mean:

| Field-id | Field | Req. | JSON type | Signable (§4) | Grammar |
|---|---|---|---|---|---|
| 1 | `id` | MUST | string | yes | `uuid` (§3.1) |
| 2 | `source` | MUST | string | yes | `did` — agent-class (§3.2) |
| 3 | `type` | MUST | string | yes | `type` (§3.3) |
| 4 | `timestamp` | MUST | string | yes | `datetime` (§3.4) |
| 5 | `sovereignty` | MUST | object | yes | §3.5 |
| 6 | `payload` | MUST | object | yes | §3.6 (opaque) |
| 14 | `spec_version` | MAY | integer | yes | §3.7 / §5 |
| — | `correlation_id` | MAY | string | **no (mutable)** | `uuid` (§3.8) |
| 7 | `signed_by` | MAY | array | yes (self, minus own sig) | §3.9 |
| — | `economics` | MAY | object | **no (mutable)** | §3.10 |
| — | `extensions` | MAY | object | **no (mutable)** | §3.11 (open) |
| 8 | `requirements` | MAY | array | yes | `capability-tag` (§3.12) |
| 9 | `sovereignty_required` | MAY | enum | yes | §3.13 |
| 10 | `deadline` | MAY | string | yes | `datetime` (§3.14) |
| 11 | `distribution_mode` | MAY | enum | yes | §3.15 |
| 12 | `target_assistant` | MAY | string | yes | `did` — agent-class (§3.16) |
| 13 | `originator` | MAY | object | yes | §3.17 |

**`signed_by` is array-only at flag-day R (D6).** The pre-#31 single-object shim is retired; on the
wire `signed_by`, when present, **MUST** be an array of 1 to 16 stamps (§3.9). RFC-0004 §4.3 still
normalizes any legacy single-object input to array form for *canonicalization*, but a single-object
`signed_by` **MUST** fail envelope validation at R.

**Versioning.** The schema `$id` carries the wire version: `.../schemas/envelope/vN`. A breaking
change to the container **MUST** mint a new `$id` and, per BCP-0001, keep prior versions published
for pinned consumers. On `origin/main` today only the single `v3` artifact exists; the schema's own
description string claims `v1`/`v2` "stay published" though no such files exist — a stale-description
defect the RFC directs to be corrected on regeneration (§9). Whether the flag-day-R tightenings this
document ratifies (`source`→agent DID, `signed_by` array-only, strict `datetime`/`uuid`) require a
`$id` bump is BCP-0001's version-channel decision (§5).

---

## 3. Field Specifications

Each field's normative lexical grammar is Appendix A. This section states the semantics and the
RFC 2119 requirements. Each `§3.x` header names the field's permanent **field-id** and the RFC-0004
section that governs its membership; a field-id is **absent** for the three mutable carve-out fields
(RFC-0004 §4.2).

### 3.1. `id` (field-id 1, RFC-0004 §4.1)

`id` **MUST** be present and **MUST** be a `uuid` (Appendix A). It identifies this envelope
instance.

**UUID grammar is version-agnostic (D7).** `uuid` accepts **any** RFC 9562 [RFC9562] `8-4-4-4-12`
hexadecimal string; the version and variant nibbles are **NOT** checked (a stable id shape buys no
security absent a de-duplication contract — §10 "Replay"). Emitters **SHOULD** emit v4 or v7 and
**MUST** emit lowercase; readers **MUST** accept mixed case (the reference `UUID_RE` carries `/i`).
A `urn:uuid:` **prefix** is **REJECTED** — the `uuid` rule has no prefix production, so
`urn:uuid:…` simply does not match. cortex's ajv-formats currently *accepts* the `urn:uuid:` prefix
(a value valid at cortex, rejected here); that acceptance is a divergence to be tightened onto this
rule at flag-day R. Vectors `envelope/id-not-uuid`, `envelope/id-urn-prefix` pin the shape and the
prefix rejection.

`id` uniqueness scope, any de-duplication obligation, and replay defence are **unspecified in the
format** — see §10 "Replay" (the transport-side anti-replay mechanism is RFC-0007's).

### 3.2. `source` (field-id 2, RFC-0004 §4.1)

`source` **MUST** be present and **MUST** be a full class-explicit **agent-class** `did:mf` DID
(Appendix A `source` = `did-prefix agent-msi`): `did:mf:agent.{principal}.{stack}.{assistant}`,
exactly three method-specific segments after the `agent` class tag.

**`source` is a DID, not a bare triple (D16).** This is the principal's flag-day-R override of the
pre-R fixed-3 dotted triple (`{principal}.{stack}.{assistant}`): "one address form everywhere, like
an IP address." `source` becomes the **sixth** DID-valued envelope field, aligned with RFC-0001
§2.2. The three method-specific segments are still RFC-0001's `principal-id`, `stack-slug`, and
`assistant-id` terminals — each the single kebab-strict `segment` rule (RFC-0001 §3) — now imported
via RFC-0001's `agent-msi`, so the arity is exactly three and this document defines **no segment
alphabet of its own**. The deployed `SOURCE_RE` emits the legacy bare triple and is replaced
**wholesale** by the `did:mf` agent form at flag-day release R (RFC-0001 §9, hard cut), which also
closes the "schema-valid `source` that cannot render into a `did:mf` DID or a NATS subject"
runtime-throw window (§10). Vector `envelope/source-masking-prod-01` accepts a legacy
`acme.monitor.prod-01` address mapped to the agent DID; `envelope/source-four-segments` and
`envelope/source-not-agent-class` reject an over-arity DID and a non-agent-class DID respectively.

**`source`'s stack segment is live at R (D9).** Subject derivation (RFC-0002 §8.1) now reads the
`{stack}` segment **from the signed `source` DID** and consumes it. The authority rule is
**signed-wins**: a consumer resolves the stack from the signed envelope; on a mismatch between the
`source` stack and a subject-derived stack it **warns, does not reject**, and it **MUST NOT**
fabricate a stack. This retires the pre-R "dead on the wire" gap (the cortex#1812 fabricated-stack
class); the subject-derivation side of the contract is owned by RFC-0002 §8.1.

**`source`↔chain provenance binding (D17).** Completing RFC-0002's signed-wins authority: the
`{principal}.{stack}` prefix of the `source` agent DID **MUST** reconcile, at verify time, with the
method-specific-id tail of the **innermost signing stack** of the verified `signed_by` chain
(RFC-0004 §5.5 D11 origin anchor, §7.1). A validly-signed envelope whose `source` prefix disagrees
with its chain anchor is rejected. `source` is thereby no longer purely self-asserted (contrast the
pre-R finding, §10).

### 3.3. `type` (field-id 3, RFC-0004 §4.1)

`type` **MUST** be present and **MUST** match `type` (Appendix A): `domain.entity.action`, 2–5
dot-separated segments. It classifies the signal for routing and consumers. **Each segment is
RFC-0001's kebab-strict `segment` terminal (D10)**, imported not redefined; the 2–5 segment **count**
is envelope-law (stricter than a subject token is safe). The former local `type-segment` production
— which permitted a trailing and consecutive `-` — is deleted (Appendix A). The total-length bound
is co-filed with RFC-0002. Vector `envelope/type-too-few-segments`.

### 3.4. `timestamp` (field-id 4, RFC-0004 §4.1)

`timestamp` **MUST** be present and **MUST** match `datetime` (Appendix A): a **strict RFC 3339**
[RFC3339] date-time.

**Strict RFC 3339 (D8).** Two constraints bind:

- **Lexical.** The `T` date/time separator and the `Z` zulu designator are **uppercase-only**,
  pinned in ABNF with `%s"T"` / `%s"Z"` (a bare ABNF literal is case-**insensitive** per RFC 5234,
  so `"T"`/`"Z"` would wrongly admit `t`/`z`; the reference regex has no `/i`). The seconds
  component is **mandatory**; a fractional part is optional.
- **Semantic.** The value **MUST** denote a **calendar-valid finite instant**:
  `2026-02-30T25:99:99Z` is shape-valid but **MUST** be rejected (month 02 has no day 30; hour 25
  and minute/second 99 are out of range). This is a side-condition ABNF cannot carry; it is
  verifier-enforced exactly as RFC-0004's stamp `at` (RFC-0004 §7.1), with which this rule is
  coherent and onto which it tightens at flag-day R.

Emitters **MUST** emit UTC `Z` with millisecond precision (`toISOString`). cortex's ajv-formats is
case-insensitive here and does the calendar check; the case divergence tightens onto this rule at R.
Vectors `envelope/timestamp-lowercase` (case reject) and `envelope/timestamp-out-of-range-accepted`
(calendar reject) pin both directions.

### 3.5. `sovereignty` (field-id 5, RFC-0004 §4.1)

`sovereignty` **MUST** be present, **MUST** be an object, and **MUST** contain exactly these five
sub-fields with `additionalProperties: false`:

| Sub-field | Rule |
|---|---|
| `classification` | MUST be one of `local`, `federated`, `public`. |
| `data_residency` | MUST match `residency-code` (two uppercase ASCII letters). |
| `max_hop` | MUST be a non-negative integer. |
| `frontier_ok` | MUST be a boolean. |
| `model_class` | MUST be one of `local-only`, `frontier`, `any`. |

This block is the envelope's "passport": it declares where the message may travel and what may
process it. It is entirely **signable**. Its *enforcement* — who reads `classification` at a
boundary, decrements `max_hop`, and honours `frontier_ok`/`model_class` — is owned by **RFC-0005**
(§2, §4–§6), not by this format. RFC-0003 validates shape; RFC-0005 enforces meaning.

Findings (recorded in §10 as invariants held by prose or by RFC-0005, not by the envelope format):

- `data_residency` is validated only as two uppercase letters; the **ISO 3166-1 registry is not
  enforced by the envelope format** (`XX`, `ZZ`, and the non-ISO regional `EU` all validate).
  Registry meaning is a sovereignty-engine concern owned by **RFC-0005 §2.3**; the format's silence
  is deliberate. Vector `envelope/residency-unassigned-code`.
- `max_hop` is signable and required, but decrementing a signable field would invalidate every prior
  stamp; the "each forwarding consumes one" semantic is therefore not implementable as an in-place
  decrement. Its enforcement contract is **RFC-0005's** (§2.4); the format only shape-validates it.
- `frontier_ok`/`model_class` — the "what may process it" promise — are shape-validated only; the
  format reads them for no enforcement (RFC-0005 §2.5).

### 3.6. `payload` (field-id 6, RFC-0004 §4.1)

`payload` **MUST** be present and **MUST** be a JSON object. The reference validator additionally
rejects arrays and `null`. The envelope **does not** otherwise constrain payload shape — it is
domain-specific and opaque to M3. `payload` is bounded only by the **whole-envelope 1 MiB receive
bound** (§6) and the canonicalization structural caps (§6); it carries no field-specific size limit.
Vector `envelope/payload-array`.

### 3.7. `spec_version` (field-id 14, RFC-0004 §4.1)

`spec_version` **MAY** be present. When present it **MUST** be an integer `>= 1`. The current wire
grammar is `3`. It is a **signable** field (signed so it cannot be downgraded in transit; RFC-0004
§4.1). Its accept/emit semantics are §5. Vectors `envelope/spec-version-current`,
`envelope/spec-version-newer-accepted`.

### 3.8. `correlation_id` (mutable — no field-id, RFC-0004 §4.2)

`correlation_id` **MAY** be present; when present it **MUST** be a `uuid`. It links related
envelopes across a workflow. It is a **mutable** field (§4) — a client **MUST NOT** make a security
or trust decision based on it. Its syntax, defaulting, and mutability are owned by **RFC-0007 §8**;
this document constrains only its lexical shape (a `uuid`, bounding it by grammar).

### 3.9. `signed_by` (field-id 7, RFC-0004 §4.1)

`signed_by` **MAY** be present. When present it **MUST** be an **array** of 1 to 16 stamps
(`MAX_CHAIN_LENGTH = 16`); an array **MUST NOT** exceed 16 stamps. **The pre-#31 single-object shim
is retired at flag-day R (D6):** a single stamp object as `signed_by` **MUST** fail validation
(vector `envelope/signed-by-shim-form`). (RFC-0004 §4.3 still normalizes a legacy single-object
input to array form for *canonicalization* so old signatures verify, but the envelope validator
rejects the shape.)

Each stamp **MUST** carry `identity` (a `did`) and **MUST** be one of two discriminated shapes, each
with `additionalProperties: false`:

- `method: "ed25519"` — MUST have `method`, `identity`, `signature` (a `base64-signature`,
  minLength 88), `at` (a `datetime`); MAY have `role`.
- `method: "hub-stamp"` — as above, and MUST additionally have `stamped_by` (a `did`).

`role`, when present, **MUST** be one of `origin`, `transit`, `accountability`, `sovereignty`,
`notary`.

**Two-plane placement (D15).** Per RFC-0001's two-plane rule (§2.1, owned there and cited by the
verifier in RFC-0004 §5.1), a stamp `identity` **MUST** be a **keyed**-class DID (`principal`,
`stack`, `agent`, `hub`); a self-asserted-class DID (`surface`, `system`) **MUST NOT** appear in
`signed_by[]` — self-asserted DIDs appear in `originator` only (§3.17). This is enforced at both the
schema pattern and verify time (a verifier MUST reject a self-asserted DID found in a stamp and MUST
NOT resolve one in the keyed registry). A hub-stamp's `stamped_by` **MUST** be a keyed hub-class or
stack-class DID (`stamped_by ∈ {hub, stack}`, D21). Vector `envelope/signed-by-surface-identity`
pins the reject.

A stamp **MUST NOT** carry the legacy key `principal` (dropped from the wire by the myelin#182 R2
breaking cut); the canonical DID key is `identity`. A stamp carrying `principal` is rejected as an
unknown field. Vector `envelope/stamp-principal-key`.

The **cryptographic meaning** of a stamp — the bytes it signs, chain-commit semantics, verification,
freshness, the origin/stack authority anchor — is **deferred to RFC-0004** (§5, §7). RFC-0003 defines
the stamp SHAPE only. The stamp `signature` accept-grammar here has minLength 88 but no maximum and
no canonical-padding check; the **canonical exactly-88 non-malleable** signature is RFC-0004 §6.2's
`signature`, onto which this loose accept-grammar tightens at flag-day R. Vector
`envelope/signature-too-short`.

### 3.10. `economics` (mutable — no field-id, RFC-0004 §4.2)

`economics` **MAY** be present. It is a **mutable** field (§4): outside the signature,
`additionalProperties: true` at every level. Its sub-fields, when present, **MUST** satisfy:
`budget.max_tokens` a positive integer; `budget.max_cost_usd` a non-negative number;
`actual.{input_tokens,output_tokens,total_tokens,duration_ms}` non-negative integers; `actual.cost_usd`
a non-negative number; `actual.model` a `model-id`; `wallet` a `did`; `billing_ref` a string of at
most 256 characters; `currency` a `currency-code`. The semantics of these sub-fields are owned by
**RFC-0009 §2**; this document carries only their envelope-level shape.

**`wallet` is a role over any-class DID (D21).** `economics.wallet` is a **role** a DID plays
(paying/receiving party), not an identity class: a DID of **any** class may fill it (RFC-0009 §5.6;
the name `wallet` is reserved against ever becoming a class tag by RFC-0001 §7). Vector
`envelope/economics-wallet-role-anyclass` pins a principal-class DID accepted in the wallet role.

A client **MUST NOT** make a security or trust decision based on any `economics` value. Because it is
mutable, unsigned, `additionalProperties: true`, and otherwise unbounded per-field, any intermediary
may inject or alter its content on a signed federated envelope without invalidating any stamp — the
adversarial-intermediary case §6's mutable-channel byte cap (D13) bounds at ingress. See §10
"Unauthenticated mutable channels" and §11; the per-channel byte bound is co-owned with RFC-0009
§5.5.

### 3.11. `extensions` (mutable — no field-id, RFC-0004 §4.2)

`extensions` **MAY** be present. It is the documented forward-compatibility escape hatch:
`additionalProperties: true`, **mutable**, and bounded only by §6's receive-side byte cap (D13). A
client **MUST NOT** make a security or trust decision based on any `extensions` value. Anything that
must be **attested or schema-validated** **MUST NOT** go in `extensions`; it belongs in a new
field-id-allocated signable top-level field (RFC-0004 §4.1.1). Vector
`envelope/mutable-channels-present`.

**`extensions` and `economics` are the only open islands (D14).** They are the sole
`additionalProperties: true` objects in the envelope; every other object (the top level,
`sovereignty`, `originator`, each stamp) is closed (§2, D2). **Resolving the `reply_to`
contradiction:** the request-reply reply mailbox rides at `extensions.reply_to` and is owned by
**RFC-0007 §7.1**. This does **not** violate the "must not be attested in `extensions`" rule above:
`reply_to` is a deliberately **unsigned transport hint**, not envelope-attested metadata, and
RFC-0007 records its integrity consequences as its own findings (RFC-0007 §10 S1/S7). A responder
**MUST** treat `extensions.reply_to` (and any other `extensions` content) as untrusted input.

### 3.12. `requirements` (field-id 8, RFC-0004 §4.1)

`requirements` **MAY** be present. When present it **MUST** be an array of at most 10 items, each
matching `capability-tag` (Appendix A): 2–64 chars, starting with a letter, ending with a
letter/digit, no leading, trailing, or consecutive hyphens. It is **signable**. The `capability-tag`
grammar is **normatively owned by RFC-0008 §4.1**; the production in this document's Appendix A is a
**transcribed copy carried for envelope `requirements[]` enforcement only** and MUST track the
RFC-0008 form (one owner per wire rule). RFC-0002 §6.3 owns the complementary subject-position
`capability` tag and the projection of a `capability-id` into the `tasks` slot (§8.5); it does not
co-own this grammar. Vector `envelope/requirements-bad-tag`.

### 3.13. `sovereignty_required` (field-id 9, RFC-0004 §4.1)

`sovereignty_required` **MAY** be present; when present it **MUST** be one of `open`, `selective`,
`strict`, `bidding`. It is **signable**. The field's placement and mode vocabulary are owned by
**RFC-0005 §2.6**; the **match semantics/ordering** against an advertisement's declared posture are
owned by **RFC-0008 §6.5** (which is the single normative owner of that comparison, and where the
ordering itself remains an open decision). This document defines neither; it carries the field's
value set only.

### 3.14. `deadline` (field-id 10, RFC-0004 §4.1)

`deadline` **MAY** be present; when present it **MUST** match `datetime` (§3.4, strict RFC 3339). It
is a **signable** soft deadline.

### 3.15. `distribution_mode` (field-id 11, RFC-0004 §4.1)

`distribution_mode` **MAY** be present; when present it **MUST** be one of `offer`, `direct`,
`delegate`. It is **signable**. The value `broadcast` was removed from the wire by the R11 (#180)
breaking cut and **MUST** be rejected.

> Two artifacts still contradict this: `docs/envelope.md` §Canonical fields calls `broadcast`
> "accepted, deprecated", and the schema's own **top-level `description` string** claims the schema
> "still accepts the deprecated form for … `distribution_mode` broadcast". Both are stale. The enum
> body and the reference validator govern and reject `broadcast`; the description is non-normative
> prose the RFC directs to be corrected on regeneration (§9). Vector `envelope/distribution-broadcast`.

### 3.16. `target_assistant` (field-id 12, RFC-0004 §4.1)

`target_assistant` **MAY** be present; when present it **MUST** be a full class-explicit
**agent-class** `did:mf` DID (Appendix A `target-assistant` = `did-prefix agent-msi`). **It is
agent-class only (D20)** — it names the receiving assistant (the `@`-target of a Tasks-Domain
subject names an assistant, not a principal), never a principal/hub/surface/system. It is
**signable**. It **MUST** be present when `distribution_mode` is `direct` or `delegate` (§6). A
self-asserted-class DID appears in `originator` only (RFC-0001 §2.2) and **MUST NOT** appear here;
a non-agent DID here is rejected even when well-formed. The legacy key `target_principal` was removed
by the R13 breaking cut and **MUST** be rejected as an unknown field. Vectors
`envelope/direct-with-target`, `envelope/target-assistant-wrong-class`,
`envelope/target-principal-top-level`.

### 3.17. `originator` (field-id 13, RFC-0004 §4.1)

`originator` **MAY** be present. When present it **MUST** be an object with exactly `identity` (a
`did`) and `attribution`, `additionalProperties: false`. `attribution` **MUST** be one of
`adapter-resolved`, `federated`, `delegated`. It is a **signable** policy-attribution claim
(myelin#160): the `signed_by` chain proves *who signed*; `originator` names *whose capabilities the
signer claims to act on behalf of*. The legacy key `principal` was removed by the R2 breaking cut and
**MUST** be rejected. Vectors `envelope/originator-adapter-resolved`, `envelope/originator-system-class`,
`envelope/originator-principal-key`.

**`originator.identity` is the one self-asserted-legal position (D15).** It is the **only** envelope
position where a self-asserted-class DID (`surface`, `system`) may appear (RFC-0001 §2.1/§2.2); a DID
of **any** class **MAY** appear here. The two accept vectors `envelope/originator-adapter-resolved`
(surface) and `envelope/originator-system-class` (system) pin the self-asserted half; their reject
counterpart is `envelope/signed-by-surface-identity` (§3.9).

**Agent-originator prefix binding and the anchor-projection (D18).** RFC-0001 §2.2 adds one normative
signer↔originator binding, enforced at **verify time** (owned by RFC-0001; the verify-time check is
RFC-0004 §7.1, vectors `bind/agent-prefix-accept`/`reject`): an `agent`-class `originator`'s
`{principal-id}.{stack-slug}` prefix **MUST** equal the method-specific-id tail of the **innermost
signing stack** of the verified chain. The projection is:

| Innermost signing identity (the verified chain anchor, RFC-0004 §5.5 D11) | Projects onto an `agent`-class `originator` | Verify disposition |
|---|---|---|
| `stack`-class `did:mf:stack.{p}.{s}` | its `{p}.{s}` = the originator's `{principal-id}.{stack-slug}` (segments 1–2) | ACCEPT iff the originator's `{p}.{s}` prefix equals the stack's; else REJECT |
| `principal`- or `hub`-class innermost signer (no stack to bind to) | — (nothing to project) | REJECT — `chain-stack-binding-unresolved` (RFC-0004 §5.5 D16, fail-closed) |

The anchor of an agent-class `originator` is always the innermost signing **stack**; there is
deliberately **no** "agent-class signer → segments 1–2" row — inventing one would contradict the
ratified RFC-0004 D16, under which a `principal`/`hub` innermost signer is rejected as an anchor and
a stackless chain fails closed. When `originator` is absent or non-agent-class, the binding is
vacuous and this rule does not fire.

**Adapter-resolved humans are attributed via the surface (D19).** When an adapter resolves a human
actor (e.g. a Discord user), `originator.identity` is the surface DID `did:mf:surface.{platform}`
and the human is identified by the **surface's opaque, stable user-id carried as surface-asserted
metadata** on a mutable channel (e.g. `extensions.surface_user`, as in
`envelope/originator-adapter-resolved`) — **never** an email or other PII, which the surface does not
verify, which is mutable, and which would place personal data on the wire. **There is no human
identity class in v1**; a `person`/`actor` class is a forward pointer for a future `Updates: 0001`,
not part of this document.

**Non-agent originator binding — the principal-bearing half (split-plane, myelin#251).** Beyond the
agent-prefix binding above, a **principal-bearing** non-agent `originator` — a `principal`- or
`stack`-class `originator.identity` — **MUST** be authorized by the verified chain: its **principal
component** (the `{principal-id}` at method-specific-id segment 1) **MUST** equal the principal
component of the **innermost signing identity** `s[0].identity` of the verified `signed_by` chain
(RFC-0004 §5.5 D11), checked at verify time (RFC-0004 §7.1) **against the chain, never against the
originator's self-description**. A mismatch is a signature-layer reject, result token
`originator-principal-binding-violation` (RFC-0004 §11.3). This is the exact sibling of the
`source`→chain binding (§3.2 D17) and closes the cross-principal actor-spoofing surface for the two
originator classes that carry a principal: a keyed signer can no longer name an arbitrary principal
(or another principal's stack) as the policy actor (§7). Because the anchor is the truncation-safe
origin `s[0]` (RFC-0004 §5.5 D11–D12), an appended (federated-forward) transit or hub stamp cannot
re-key the check off `s[n-1]`; under a `hub-stamp` origin the principal is read from `s[0].identity`
(the vouched entity), never from `stamped_by` (the hub), its strength then bounded by the open
hub-vouching scope (RFC-0004 §5.5 D14). A `hub`-class innermost signer exposes no principal
component and therefore cannot authorize a principal-bearing originator — fail-closed reject (result
token `originator-principal-binding-violation`, there being no principal on the signer side to
reconcile), the same fail-closed family as the D16 stackless case (accept/reject vector
`envelope-signing/verify/originator-hub-class-signer-fail-closed`).

**The self-asserted plane and `hub`-class originator stay self-asserted-legal (split-plane,
myelin#251).** A `surface`- or `system`-class `originator.identity` (the self-asserted plane, D15)
and a `hub`-class `originator.identity` carry **no principal component** and are therefore
**unconstrained by this reconciliation by construction** — they remain legal in `originator` exactly
as before (accept vectors `envelope/originator-adapter-resolved`, `envelope/originator-system-class`;
D19 attributes adapter-resolved humans via the surface DID). The compensating control for these
classes is the normative actor-authority cap of §7: **a policy engine MUST NOT grant principal-scoped
authority to a `surface`/`system`/`hub`-class actor.** The residual — that this reconciliation cannot
bind a class with no principal, and that hub vouching-authority scope is itself an open decision — is
recorded as a §10 finding. `attribution` remains validated only syntactically (it is not required to
be consistent with the chain — e.g. `federated` with no hub-stamp); that narrower residual is folded
into the same §10 finding.

---

## 4. The Signable / Mutable Boundary

This section **carries** the signable/mutable boundary onto the wire and states its consequences;
its *membership* is not defined here. **RFC-0004 §4.1 governs the signable field set and the
permanent field-id of each member; RFC-0004 §4.1.1 governs the allocation rule; RFC-0004 §4.2 governs
the mutable carve-out** (D1 demotion — ownership sits where the cryptographic consequences are
analysed). The *algorithm* that turns the signable set into signed bytes — the RFC 8785 JCS profile,
the field-id re-keying, "strip the current stamp's own signature", the chain-slice, the absent-key
rule, clock-skew — is RFC-0004 §3–§7 and **MUST NOT** be inferred from this section.

An implementation that signs or verifies an envelope **MUST** treat exactly the following fields as
**signable** (covered by each stamp), keyed by the field-id RFC-0004 §4.1 assigns:

`id` (1), `source` (2), `type` (3), `timestamp` (4), `sovereignty` (5), `payload` (6),
`signed_by` (7), `requirements` (8), `sovereignty_required` (9), `deadline` (10),
`distribution_mode` (11), `target_assistant` (12), `originator` (13), `spec_version` (14).

An implementation **MUST** treat exactly the following fields as **mutable**, **MUST** exclude them
from the signed bytes, and **MUST NOT** assign them a field-id:

`correlation_id`, `economics`, `extensions`.

Three consequences are normative:

- **Closed contract is permanent (D2).** Unknown top-level keys ALWAYS reject
  (`additionalProperties: false`). This is not softened by `spec_version`: a newer `spec_version`
  does **not** license unknown keys (§5). The distinguishing property is that an **absent optional
  signable field contributes nothing to the canonical bytes** (RFC-0004 §4.1) — so adding a new
  optional signable field (the mechanism by which `spec_version` was introduced) does **not** break
  existing signatures. This is the designed evolution mechanism; it is a property of the field-id
  projection (RFC-0004 §4.1/§4.4), not of any forward-compatibility in the closed contract itself.
- **Add-a-field procedure (D3/D4/D5).** A new signable field is added by allocating the **next unused
  field-id** (RFC-0004 §4.1.1: ids are consecutive from 1, never reused, never reassigned; a rename
  keeps its id and is not a wire-encoding change; a removal tombstones its id forever). A new field
  is **integrity-by-default**: signed unless explicitly placed in the §4.2 mutable carve-out. Any
  membership change follows BCP-0001 change control. RFC-0003 carries the resulting id↔name row; the
  cryptographic authority is RFC-0004.
- **Mutable-set membership (D5).** The mutable set is exactly the three fields above and is closed at
  flag-day R; growing it is a wire-encoding change (BCP-0001). A client **MUST NOT** make a security
  or trust decision based on any mutable field. The carve-out exists so hubs can annotate routing,
  accumulate economics, and thread correlation without invalidating attestations — a **behavioural**
  guard, recorded as a finding in §10, bounded at ingress by §6's byte cap (D13).

> Note: `docs/envelope.md`'s "attested fields" list omits `spec_version`; RFC-0004 §4.1 assigns it
> field-id 14 and it is signable. RFC-0004 §4.1 governs; this document carries id 14.

---

## 5. `spec_version` Semantics

This section is normative and in scope (§1.1); it captures a contract that JSON Schema cannot express
and that lives only in reference code today.

- `spec_version` **MAY** be absent. Absent **MUST** be interpreted as "the pre-`spec_version`
  grammar" and, because it is absent from the canonical bytes (RFC-0004 §4.1), an absent
  `spec_version` **MUST NOT** change the signed bytes relative to a legacy envelope.
- When present, `spec_version` **MUST** be an integer `>= 1`. The current wire grammar is `3`.
- **Warn-on-newer (D3).** A verifier that receives a `spec_version` **greater** than the version it
  understands **MUST NOT** reject the envelope solely on that basis, and **SHOULD** emit a warning.
  It **MUST** still reject genuinely unknown top-level fields via the closed-contract rule (§6): a
  newer `spec_version` is **not** blanket forward-compatibility — `additionalProperties: false` is
  permanent (D2).
- **Rollout doctrine: verifiers before emitters.** In the current phase, a conformant implementation
  **MUST** accept and sign `spec_version` when present but **MUST NOT** be required to emit it
  (`createEnvelope` does not). Emission is a later, separate release.

**Emission scheduling is BCP-0001's (D3/D5).** `spec_version` was added to a closed contract
(`additionalProperties: false`) without a `$id` bump. A consumer pinned to a pre-`spec_version` copy
of `v3` would hard-reject envelopes the moment emission begins. Naming the emission release, whether
it requires a `$id` bump, and the dual-accept window are owned by **BCP-0001** (§5 emitters-vs-
verifiers doctrine, §6 the dual-accept window). This document owns the wire *semantics*
(warn-on-newer, signable, closed-contract-permanent) and defers *scheduling* to BCP-0001 rather than
carrying a parallel decision. Vectors `envelope/spec-version-current`,
`envelope/spec-version-newer-accepted`.

---

## 6. Structural Rules

- **Required set.** An envelope **MUST** contain `id`, `source`, `type`, `timestamp`, `sovereignty`,
  `payload`. Vector `envelope/missing-source` (and the required-set family) pins absence.
- **Closed contract (permanent, D2).** An envelope **MUST NOT** contain any top-level key other than
  the seventeen in §2. The `sovereignty` object, the `originator` object, and each stamp object are
  likewise closed. Only `economics` and `extensions` are `additionalProperties: true` (§3.10, §3.11).
  Vectors `envelope/unknown-top-field`, `envelope/sovereignty-extra-field`,
  `envelope/originator-principal-key`, `envelope/stamp-principal-key`.
- **Cross-field rule.** If `distribution_mode` is `direct` or `delegate`, then `target_assistant`
  **MUST** be present (and be an agent-class DID, §3.16). Vectors `envelope/direct-with-target`,
  `envelope/direct-missing-target`.
- **No nulls on the wire.** An emitter **MUST** omit an optional field it is not setting rather than
  emit `null`.
- **Whole-envelope size bound (D11).** A receiver **MUST** reject an envelope whose serialized UTF-8
  form exceeds **1,048,576 octets (1 MiB)** (result token `envelope-too-large`). This is a
  receive-side bound (it matches the deployed default). The **transport-alignment** rationale — how
  this relates to the NATS `max_payload` — lives in **RFC-0007**; the numeric bound is envelope-law
  here (precedent: RFC-0002's 255-octet subject ceiling). Vector `envelope/over-max-size`.
- **Canonicalization structural caps (D12).** To bound canonicalization cost (RFC-0004 §3 is
  `O(nodes)` and the chain cap is 16, RFC-0004 §5.3), a receiver **MUST** reject an envelope whose
  JSON structure exceeds any of: nesting **depth** > 32; **width** > 4096 members or elements in any
  single object or array; total **node count** > 100,000. These caps are the structural ceiling this
  document sets; they sit comfortably above any legitimate envelope while denying pathological
  nesting within the 1 MiB byte bound, and compose with RFC-0004's 16-stamp chain cap. Tuning is a
  BCP-0001 change.
- **Mutable-channel byte caps (D13).** Because `economics` and `extensions` are the only fields an
  **adversarial intermediary** can grow on someone else's signed envelope without invalidating a
  stamp, a receiver **MUST** enforce a per-channel UTF-8 **byte cap** on each at trust-boundary
  ingress. The numeric caps are co-owned with the riders that produce their content: `economics` with
  **RFC-0009 §5.5**, `extensions` with **RFC-0007** (the `reply_to`/`dead_letter` carriers). This is
  the qualitatively-different defense from the whole-envelope bound: it is applied at ingress, on the
  unauthenticated channels specifically, per §10 "Unauthenticated mutable channels".

---

## 7. Actor Resolution

Policy engines need one answer to "whose capabilities does this envelope assert?" The **actor** is
resolved as follows and a conformant implementation **MUST** compute it thus:

1. If `originator` is present, the actor **MUST** be `originator.identity`.
2. Otherwise, if `signed_by` names at least one stamp, the actor **MUST** be the **first** stamp's
   `identity` (the chain origin). Because `signed_by` is **array-only** (D6, §3.9), "the first
   stamp" is unambiguous.
3. Otherwise the envelope has no actor.

Vectors `actor/originator-wins`, `actor/chain-fallback`, `actor/unsigned-none`.

**Actor-authority cap for self-asserted and `hub`-class actors (split-plane, myelin#251).** When the
resolved actor is a `surface`-, `system`-, or `hub`-class DID, a policy engine **MUST NOT** grant it
**principal-scoped authority** — the capabilities, sovereignty, or trust that belong to a principal.
These three classes carry no principal component and are, by construction, **not** bound to the
signing chain by the §3.17 non-agent originator reconciliation (which fires only for the
principal-bearing `principal`/`stack` classes). Treating such an actor as a principal would reopen
the exact cross-principal spoofing surface that reconciliation closes for the principal-bearing
classes: any keyed signer may assert an arbitrary `surface`/`system`/`hub` DID here (§3.17), so
authority read from one is authority any signer can mint. The self-asserted plane names a
**non-principal** actor — a surface integration, an internal system component — and a `hub` names a
network, not a principal; each **MUST** be authorized only within its own, non-principal scope. This
cap is the compensating control recorded in §10 for the classes reconciliation cannot bind, and is
applied at ingress by **RFC-0005 §6.2** (cross-referenced there).

The pre-R `getActorIdentity` shim-form defect — a non-array (single-object) `signed_by` treated as an
empty chain, silently losing attribution for a validly-signed envelope — is **retired at its root by
D6**: an object-form `signed_by` now fails validation (§3.9, vector `envelope/signed-by-shim-form`),
so a well-formed envelope never reaches step 2 with a non-array chain and the defect cannot arise.
The former defect-catcher vector `actor/shim-form-documented` is retired accordingly (Appendix C).

---

## 8. Decisions and Cross-Document Handoffs

The RFC-0003 grill ([`grill-logs/rfc-0003.md`](grill-logs/rfc-0003.md), 26/26, Andreas 2026-07-14)
**resolved every open decision of this document.** No item below is open here. Each former Open
Decision is recorded RESOLVED with the deciding decision, and any residual question is a **handoff**
to the document that owns it — not an open decision of RFC-0003.

| Former OD | Resolution | Owner of any residual |
|---|---|---|
| OD-1 `uuid` grammar | **RESOLVED (D7)** — version-agnostic 8-4-4-4-12 hex; `urn:uuid:` prefix rejected; lowercase emit (§3.1) | — |
| OD-2 datetime semantics | **RESOLVED (D8)** — strict RFC 3339: uppercase `T`/`Z`, calendar-valid finite instant, UTC `Z` ms emit (§3.4) | — |
| OD-3 size bounds | **RESOLVED (D11/D12/D13)** — 1 MiB whole-envelope bound + structural caps + mutable-channel byte caps (§6) | transport alignment → RFC-0007; economics cap → RFC-0009 §5.5 |
| OD-4 `source` stack authority | **RESOLVED (D9)** — the `source` DID's stack segment is live and consumed; signed-wins, warn-not-reject, never fabricate (§3.2) | subject-derivation side → RFC-0002 §8.1 |
| OD-5 segment-alphabet / DID class collision | **RESOLVED by RFC-0001** — class-explicit dot-form + kebab-strict `segment`; effective at flag-day R (RFC-0001 §9) | — |
| OD-6 `spec_version` field presence | **RESOLVED (D3/D5)** — warn-on-newer + permanent closed contract are envelope-law (§5) | emission window / `$id` bump → BCP-0001 §5/§6 |
| OD-7 `signed_by` shim retirement | **RESOLVED (D6)** — array-only at flag-day R; single-object shim rejects (§3.9) | — |
| OD-8 `getActorIdentity` shim actor | **RESOLVED (D6)** — retired at its root; the shape can no longer arise (§7) | cortex code follow-up: fix `getActorIdentity` at R |
| OD-9 stale schema `description` / `v1`/`v2` | **RESOLVED** — directed for correction on regeneration (a defect, not a policy choice) (§9) | prior-version publication → BCP-0001 |
| residency registry (§3.5) | **RESOLVED** — the format validates shape only; registry enforcement is a sovereignty-engine concern | RFC-0005 §2.3 |
| `sovereignty_required` matching (§3.13) | **RESOLVED here** — the field vocabulary is carried; comparison is not defined here | field vocabulary → RFC-0005 §2.6; match ordering → RFC-0008 §6.5 |
| DID two-plane placement (§3.9, §3.17) | **RESOLVED (D15)** — keyed in `signed_by[]`, self-asserted in `originator` only; schema-pattern + verify | owned by RFC-0001 §2.1, verified RFC-0004 §5.1 |
| `source` full DID (§3.2) | **RESOLVED (D16)** — `did:mf:agent.{p}.{s}.{a}`, 6th DID field; migrated at R | — |
| agent-originator anchor table (§3.17) | **RESOLVED (D18)** — anchor is the innermost signing stack; principal/hub anchor rejected | must not contradict RFC-0004 §5.5 D16 |

---

## 9. Registry Considerations

- **RFC number.** `0003` is allocated in [`specs/README.md`](../README.md); numbers are never reused.
- **Schema `$id` version namespace.** This document reserves and registers
  `https://myelin.metafactory.ai/schemas/envelope/v3` as the current envelope schema identifier. A
  future breaking version **MUST** mint the next `.../vN` and keep prior versions published for
  pinned consumers (BCP-0001). Only `v3` exists on `origin/main` today; the schema's claim that
  `v1`/`v2` remain published is a stale-description defect to be corrected on regeneration. The
  flag-day-R schema regeneration tightens the artifact: `source` and `target_assistant` patterns to
  the agent DID, `signed_by` to array-only, `uuid`/`datetime` to the strict forms, and the stamp
  `signature` toward RFC-0004 §6.2.
- **Reserved enumerations.** This document registers the closed value sets for
  `sovereignty.classification` (`local`, `federated`, `public`), `sovereignty.model_class`
  (`local-only`, `frontier`, `any`), `sovereignty_required` (`open`, `selective`, `strict`,
  `bidding`), `distribution_mode` (`offer`, `direct`, `delegate`), `originator.attribution`
  (`adapter-resolved`, `federated`, `delegated`), and stamp `role` (`origin`, `transit`,
  `accountability`, `sovereignty`, `notary`). Adding a value to any set is a wire change per
  BCP-0001.
- **Field-id registry.** The permanent id↔name mapping for the fourteen signable fields is carried in
  §2 and §3; its **authority is RFC-0004 §4.1** (membership) and §4.1.1 (the append-only allocation
  rule). This document registers no field-id of its own.
- **Reserved (removed) keys.** `signed_by[].principal`, `originator.principal`, `target_principal`,
  and `distribution_mode: "broadcast"` are reserved-as-removed: an envelope carrying any of them
  **MUST** be rejected.
- **External registries (not enforced by this format).** `data_residency` references ISO 3166-1
  alpha-2 (enforcement owned by **RFC-0005 §2.3**) and `economics.currency` references ISO 4217
  (semantics owned by **RFC-0009 §2.6**); this document validates only their lexical shape. No DID
  method is registered here — the `did:mf` method and any W3C DID registry action are RFC-0001's
  (§6/§7).

---

## 10. Security Considerations

This section is REQUIRED and non-empty. Per specs/README.md rule 6, every invariant held by a
**runtime check or by prose rather than by the format** is recorded here as a **finding**, not a
design.

**Threat model.** The envelope crosses trust boundaries between principals over a shared bus. An
adversary may be an intermediary that can read, replay, or re-address a message, or a peer that
constructs envelopes. Signatures (RFC-0004) defend the signable fields against tampering; this
document's job is to state precisely what the *format* does and does not defend, and where a promise
rests on something other than the grammar.

- **Unauthenticated mutable channels (finding, now bounded at ingress).** `economics` and
  `extensions` are outside the signable set, `additionalProperties: true`. Any intermediary can
  inject or alter their content on a signed federated envelope **without invalidating any stamp**.
  The countervailing controls are (a) the prose rule "clients MUST NOT make security or trust
  decisions based on mutable-field values" (§4) and (b) the receive-side per-channel **byte cap**
  (§6, D13) that denies unbounded adversarial growth. Integrity of their content is still not
  provided; a relay that needs to bind an annotation cryptographically MUST append a stamp
  (RFC-0004 §5), not write a mutable field.
- **Subject↔envelope binding is classification-prefix-only (finding).** The delivery subject is
  **not** an envelope field and is **not** signed (RFC-0004). The only specified receive-side
  subject↔envelope check is the classification prefix (RFC-0005 §4; RFC-0002 §8.3). A validly-signed
  envelope can be **replayed verbatim onto any subject with the same classification prefix** and
  still pass schema validation and alignment. Whatever prevents cross-principal replay (NATS account
  publish permissions) is a runtime guard the wire contract nowhere declares. (The `source`↔chain
  binding, below, now constrains the *claimed origin*, but not the *delivery subject*.)
- **`source` is now bound to the chain (D17, was a finding).** Pre-R, `source` was self-asserted and
  bound to nothing. Under D17 (§3.2) the `source` agent DID's `{principal}.{stack}` prefix **MUST**
  reconcile at verify time with the innermost signing stack (RFC-0004 §5.5/§7.1); a validly-signed
  envelope can no longer claim an arbitrary origin principal/stack. The residual is that an
  **unsigned** envelope's `source` remains unbound — an unsigned envelope carries no actor (§7) and
  MUST NOT be trusted.
- **`originator` non-agent binding — principal-bearing half now bound, self-asserted plane capped
  (split-plane, myelin#251; supersedes the residual §3.17 formerly pointed here).** `originator` is
  the policy actor (§7): an unconstrained `originator` is a cross-principal actor spoof — any keyed
  signer naming an arbitrary identity as the actor. Under the split-plane rule (§3.17), a
  **`principal`- or `stack`-class** `originator.identity` **MUST** reconcile its principal component
  with the innermost signer `s[0].identity` at verify time (RFC-0004 §7.1; result token
  `originator-principal-binding-violation`, §11.3; wire-surfaced as `policy_denied`, RFC-0010 §2.2),
  closing the constructible escalation for the two originator classes that carry a principal.
  **`surface`-, `system`-, and `hub`-class** originators carry **no principal component** and are
  **unconstrained by reconciliation by construction** — self-asserted-legal by the two-plane design
  (§3.17 D15, D19). The compensating control is the §7 actor-authority cap: a policy engine **MUST
  NOT** grant principal-scoped authority to a `surface`/`system`/`hub`-class actor, enforced at
  ingress by RFC-0005. Three residuals remain **by construction**: (a) a `surface`/`system`/`hub`
  originator names a non-principal actor governed by the §7 cap — prose, not a cryptographic binding;
  (b) under a `hub-stamp` origin the reconciliation anchors on `s[0].identity` and is only as strong
  as the **open** hub vouching-authority scope (RFC-0004 §5.5 D14); (c) `originator.attribution`
  (`adapter-resolved`/`federated`/`delegated`) is still validated only syntactically — it is not
  required to be consistent with the chain (e.g. `federated` with no hub-stamp). Vectors
  `envelope-signing/verify/originator-*`.
- **`source` stack segment is live (D9, was a finding).** Segment 2 is now consumed by subject
  derivation under signed-wins (§3.2, RFC-0002 §8.1); the pre-R cortex#1812 fabricated-stack class is
  closed by resolving from the signed envelope and warning (not fabricating) on mismatch.
- **Replay / uniqueness unwritten in the format (finding).** `id` is only "unique per instance";
  the **format** carries no de-duplication obligation and no replay defence, and archived envelopes
  replay by design. Anti-replay for task-dispatch admission is owned by **RFC-0004 §7.4 (replay
  vocabulary)** and **RFC-0007 (the `Nats-Msg-Id` / JetStream duplicate-window mechanism)**; the
  format gap is recorded here.
- **DID class collision — RESOLVED by RFC-0001.** The six DID-valued fields (`source`,
  `target_assistant`, `originator.identity`, `economics.wallet`, `signed_by[].identity`,
  `signed_by[].stamped_by`) carry the class-explicit dot-form (RFC-0001 §6.2): the class tag at
  method-specific-id position 0 makes a cross-class collision unconstructible, and the two-plane rule
  (RFC-0001 §2.1) confines self-asserted-class DIDs to `originator`. Effective at flag-day release R
  (RFC-0001 §9) — a hard cut, envelope-field DIDs and subject `@`-segments flipping atomically.
- **Segment-alphabet divergence — RESOLVED by RFC-0001 import.** `source`/`type` segments are
  RFC-0001's kebab-strict terminals, imported not locally defined (§3.2, §3.3, Appendix A), so the
  alphabets cannot drift. The deployed `SOURCE_RE`/`TYPE_RE` remain looser until they tighten onto
  the imported rules at flag-day release R (RFC-0001 §9); until R, a schema-valid pre-cut `source`
  can still throw at subject derivation rather than failing wire validation.
- **uuid/datetime divergence pinned, tightens at R (finding).** The same schema is enforced by
  myelin's regexes and by cortex's ajv-formats with divergent accept/reject sets (§3.1, §3.4). D7/D8
  select the strict rule (version-agnostic uuid rejecting `urn:uuid:`; uppercase-only strict RFC 3339
  datetime); cortex tightens onto these at R. Vectors `envelope/id-urn-prefix`,
  `envelope/timestamp-lowercase`, `envelope/timestamp-out-of-range-accepted`.
- **Signature malleability / unbounded signature — owned by RFC-0004 (finding).** The stamp
  `signature` accept-grammar here (minLength 88, no max, no canonical-padding check) admits
  non-canonical base64 and unbounded length. The canonical **exactly-88 non-malleable** signature and
  the malleability defence are RFC-0004 §6.2's; this loose accept-grammar tightens onto it at R.
  Vector `envelope/signature-too-short`.
- **Size is now bounded (D11/D12/D13, was a finding).** The whole-envelope 1 MiB bound, the
  canonicalization structural caps, and the mutable-channel byte caps (§6) replace the pre-R
  unbounded-payload/chain DoS surface; verification cost is bounded (chain ≤ 16, RFC-0004 §5.3).
- **`spec_version` closed-contract interaction (finding).** `spec_version` was added without a `$id`
  bump; emission before a dual-accept window would hard-reject at pre-field-pinned consumers. The
  field-presence rule is envelope-law (warn-on-newer, closed contract permanent, §5); the emission
  window and `$id`/version-channel reconciliation are **BCP-0001's**.
- **Sovereignty is a declaration; enforcement is RFC-0005's (finding).** `max_hop`, `frontier_ok`,
  `model_class`, and `data_residency` are shape-validated only (§3.5). The envelope's most
  security-relevant block declares policy that the **format** does not enforce; enforcement is owned
  by **RFC-0005** (§2, §4–§6).

## 11. Privacy Considerations

This document specifies identifiers and is therefore REQUIRED to state what they leak.

- **`source` is an identity/topology disclosure.** As `did:mf:agent.{principal}.{stack}.{assistant}`
  it names the originating principal, its deployment stack, and the assistant on every message —
  present even when `classification` is `public` (where the *subject* omits principal/stack, the
  *envelope* `source` still carries them). It correlates a principal across every message it emits.
- **DID-valued fields correlate actors across contexts.** `source`, `target_assistant`,
  `originator.identity`, `economics.wallet`, and each stamp `identity`/`stamped_by` are stable
  `did:mf` identifiers. A `did:mf` is a persistent pseudonym; observing it across envelopes links
  otherwise-unrelated activity.
- **Human attribution is surface-mediated, not PII-on-wire (D19).** When `originator` names a human
  actor, it does so via the **surface DID** `did:mf:surface.{platform}` plus the surface's **opaque,
  stable user-id** carried as surface-asserted metadata (e.g. `extensions.surface_user`). The wire
  carries **no email or other PII** and defines **no human identity class** in v1. The opaque id
  still correlates that human across envelopes from the same surface; a person/actor class with its
  own privacy treatment is a future `Updates: 0001`.
- **`correlation_id` links a workflow.** As a stable UUID across related envelopes it is a linkage
  identifier; it is mutable and unsigned (RFC-0007 §8), so an intermediary can also *re-link*
  messages.
- **`economics` may carry PII on an unsigned, mutable, cross-boundary channel.** `economics.billing_ref`
  is 256 chars of free text and `economics.wallet` is a DID; both cross principal boundaries mutable
  and unsigned. Implementations **SHOULD NOT** place PII in `economics` or `extensions`, and
  **MUST NOT** rely on their confidentiality or integrity across a boundary (RFC-0009 §8).
- **Replayable envelopes extend observability.** Because the format permits indefinite replay (§10),
  an identifier in a signed envelope remains linkable long after the interaction, with no
  format-level expiry.

## 12. Conformance

An implementation conforms to this document **if and only if it passes every vector** under the path
named in `vectors` (`specs/vectors/envelope/`). Reading the specification is not conformance;
passing the vectors is (specs/CONFORMANCE.md). The suite is now a **two-sided oracle** (D22): the
accept set (`valid.json`, 15 vectors) and the reject set (`invalid.json`, 22 vectors, including the
programmatically-built over-1-MiB vector).

The vector set exercises two operations:

- `kind: "validateEnvelope"` — given a candidate, decide validity. On success the implementation's
  own validator **MUST** accept it and expose the envelope's `sovereignty.classification` as the
  vector's `value.classification`; on failure it **MUST** reject with the vector's stable `reason`
  token.
- `kind: "getActorIdentity"` — given an envelope, resolve the actor per §7; the result **MUST** equal
  the vector's `value.actor` (a DID string or `null`).

An implementation **MUST** run these vectors against **its own** parser, not against the reference
implementation (otherwise it tests myelin, not itself). A consumer that renders or parses envelopes
and does not run the vectors is, by construction, an independent implementation of an unspecified
grammar — the condition this series exists to end.

Two classes of vector are called out:

- **Two-plane placement pair-set (D24).** The self-asserted-legal position is pinned by the accept
  pair `envelope/originator-adapter-resolved` (surface) and `envelope/originator-system-class`
  (system) against the reject `envelope/signed-by-surface-identity` (a surface DID in `signed_by[]`).
- **Divergence / collision vectors** (`envelope/id-urn-prefix`, `envelope/timestamp-lowercase`,
  `envelope/timestamp-out-of-range-accepted`) pin the strict rule chosen by D7/D8 where the deployed
  stacks diverge. Should a future decision change a rule, the affected vector moves between
  `valid.json` and `invalid.json` **keeping its id**, with a Change Log note — never a silent edit.
  Two vectors moved valid→invalid in this revision on exactly that basis
  (`envelope/timestamp-out-of-range-accepted` by D8; `envelope/signed-by-shim-form` by D6), and the
  former defect-catcher `actor/shim-form-documented` was retired by D6 (Appendix C).

---

## 13. References

### 13.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC3339] Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. Normative for `datetime` (§3.4) — strict profile.
- [RFC9562] Davis, K., Peabody, B., and P. Leach, "Universally Unique IDentifiers (UUIDs)", RFC 9562, May 2024. Normative for the `uuid` shape (§3.1); obsoletes RFC 4122.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Ratified (single-principal, ADR-0001). Owns the `did`, `did-prefix`, `agent-msi`, `segment`, `principal-id`, `stack-slug`, `assistant-id` terminals this document imports; the class-explicit dot-form (§6.2), the two-plane six-class identity model (§2.1), the agent-originator prefix binding (§2.2), reserved identifiers (§7), and the hard-cut migration (§9).
- [RFC-0002] metafactory, "Subject Namespace", Ratified (single-principal, ADR-0001). Owns the NATS subject grammar, the composition of a subject from envelope fields (§8.1) and prefix-classification alignment (§8.3); owns the subject-position `capability` tag (§6.3) and the `capability-id`→`tasks` projection (§8.5). The `capability-tag` grammar itself is owned by RFC-0008 §4.1.
- [RFC-0004] metafactory, "Envelope Signing and Canonicalization", Ratified (single-principal, ADR-0001). OWNS the field-id registry membership + id assignments (§4.1), the permanent allocation rule (§4.1.1), the mutable carve-out (§4.2), the JCS canonicalization profile (§3, §4.4), the two-plane verifier rule (§5.1), the origin/stack chain anchor (§5.5 D11/D16) and the agent-prefix verify (§7.1), the canonical exactly-88 signature (§6.2), and freshness/replay vocabulary (§7.4).
- [RFC-0005] metafactory, "Sovereignty and Boundary-Crossing", **Ratified**. Owns the sovereignty-block enforcement (§2), the `data_residency` registry treatment (§2.3), and the `sovereignty_required` field vocabulary (§2.6).
- [RFC-0007] metafactory, "Transport and Reliability", **Ratified**. Owns `correlation_id` (§8), the request-reply `reply_to` mailbox (§7.1), redelivery, the `Nats-Msg-Id`/duplicate-window anti-replay mechanism, and the transport alignment of the whole-envelope size bound (§6).
- [RFC-0008] metafactory, "Capability Discovery", **Ratified**. Single normative owner of the `capability-tag` grammar (§4.1) this document transcribes into Appendix A for `requirements[]` enforcement (§3.12), and of the `sovereignty_required` match semantics/ordering (§6.5).
- [RFC-0009] metafactory, "Economics", **Ratified**. Owns the economics block (§2), `wallet` as an any-class role (§5.6), and the mutable-channel byte bounds (§5.5, shared with this document's D13).
- [RFC-0010] metafactory, "Rate-limit and Refusal Taxonomy", **Draft**. Owns the refusal `kind` registry (§2.2), including `policy_denied` — the wire refusal that the non-agent originator binding reject of §3.17/§10 maps to when a refused envelope is surfaced on the task path (myelin#251). A normative dependency of that mapping; cited at its current `Draft` status pending ratification (implementations MUST NOT ground behaviour on a Draft document per ADR-0001 — the mapping is recorded here so it lands when RFC-0010 ratifies).

### 13.2. Informative References

- [RFC4122] Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005. Obsoleted by RFC 9562; cited for the `urn:uuid:` prefix this document rejects.
- [RFC4648] Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020.
- [ISO3166-1] ISO 3166-1, "Codes for the representation of names of countries and their subdivisions — Part 1: Country code".
- [ISO4217] ISO 4217, "Codes for the representation of currencies".
- [W3C-DID] W3C, "Decentralized Identifiers (DIDs) v1.0".
- `docs/envelope.md`, `docs/architecture.md` (the M3 envelope prose, §5.2), `specs/namespace.md` — the informative prose this document supersedes or draws context from.

---

## Appendix A. Collected ABNF

This appendix is a **copy**. The file named in `grammar` (`specs/grammar/envelope.abnf`) is the
source of truth and is what CI validates. This grammar defines the lexical syntax of the
string-valued fields only; the JSON object structure (required/forbidden keys, the closed contract,
the `direct`/`delegate` ⇒ `target_assistant` cross-field rule, the `signed_by` array-only shape, the
signable/mutable boundary, and the size/structural caps of §6) lives in the promoted schema and
§2/§4/§6, not here.

```abnf
; specs/grammar/envelope.abnf
; RFC-0003 — Envelope Format
; Status: Ratified (single-principal, 2026-07-14, ADR-0001). Normative;
; revisable as a living spec (see specs/README.md).
;
; ─── SCOPE ───────────────────────────────────────────────────────────────
; This file defines the LEXICAL syntax of the STRING-VALUED fields of a
; myelin envelope (schemas/envelope.schema.json, $id
; https://myelin.metafactory.ai/schemas/envelope/v3). The JSON OBJECT
; structure — which keys are required, which are forbidden
; (additionalProperties:false), the direct/delegate⇒target_assistant
; cross-field rule, the signed_by ARRAY-ONLY shape, and the signable/mutable
; boundary — is NOT expressible in ABNF; it is specified in the RFC body and
; in the promoted JSON Schema (the `generated` artifact). Integer- and
; boolean-valued fields (spec_version, sovereignty.max_hop,
; sovereignty.frontier_ok) are JSON scalars out of this grammar's lexical
; scope; their constraints live in the schema. The whole-envelope 1 MiB
; (1,048,576-octet) receive bound and the mutable-channel byte caps are
; likewise structural side-conditions, not lexical rules (RFC §6, §10;
; transport alignment RFC-0007).
;
; ─── REVISION NOTE (2026-07-14, ratified grill rfc-0003.md, 26/26) ────────
; This file is REVISED to the ratified flag-day-R target state. The former
; OPEN DECISION markers on `uuid` and `datetime` are RESOLVED and removed:
;   • D7  uuid = VERSION-AGNOSTIC (accept any RFC 9562 8-4-4-4-12 hex; the
;         version nibble is NOT checked); lowercase RECOMMENDED on emit; a
;         `urn:uuid:` prefix is REJECTED (no prefix production).
;   • D8  datetime = STRICT RFC 3339: uppercase %s"T"/%s"Z" (a bare literal
;         is case-INSENSITIVE per RFC 5234), and a calendar-valid finite
;         instant is REQUIRED (a normative side-condition ABNF cannot carry,
;         verifier-enforced exactly as RFC-0004's `at`).
;   • D16 source = a FULL class-explicit agent DID (did:mf:agent.{p}.{s}.{a}),
;         a 6th DID-valued field (aligns RFC-0001 §2.2) — NOT a bare 3-token
;         triple. The former `source = principal-id "." stack-slug "."
;         assistant-id` production is DELETED.
;   • D20 target_assistant = an agent-class DID (new lexical rule below).
;   • D6  signed_by is ARRAY-ONLY at flag-day R (the single-object shim is
;         retired; structural, enforced by the schema/RFC §3.9, not here).
; The migration is a HARD CUT at flag-day release R (RFC-0001 §9): the
; deployed loose regexes cited below are replaced WHOLESALE, no dual-accept.
;
; ─── TERMINAL-ALPHABET DISCIPLINE (grammar/README.md rule 5) ─────────────
; Terminal alphabets are defined ONCE by the RFC that owns the identifier and
; are REFERENCED here, never redefined:
;   • DID terminals (`did`, `did-prefix`, `agent-msi`, `method-specific-id`)
;     and the identifier `segment` are owned by RFC-0001
;     (specs/grammar/identifiers.abnf).
;   • The stamp `signature` grammar is owned by RFC-0004
;     (specs/grammar/envelope-signing.abnf, ratified) — see §9.
;   • The two-plane placement rule (which DID class may appear where) is owned
;     by RFC-0001 §2.1/§2.2 and cited (not redefined) by RFC-0004 §5.
;
; Core rules ALPHA, DIGIT imported from RFC 5234 Appendix B.
;
; Convention: where a rule mirrors a live regex in myelin src/, the source is
; cited. After generation the arrow reverses: the regex becomes the artifact
; and THIS becomes its source (grammar/README.md).

; ─────────────────────────────────────────────────────────────────────────
; 0. Imported / referenced rules (defined elsewhere; NOT redefined here).
; ─────────────────────────────────────────────────────────────────────────
; did          — a did:mf DID, RFC-0001 `did` (= `did-prefix method-specific-id`,
;                class-explicit dot-form, RFC-0001 §6.2; cortex#1880 RESOLVED
;                2026-07-12). SIX envelope fields are DID-valued:
;                  source              (agent-class; §1, D16)
;                  target_assistant    (agent-class; §1b, D20)
;                  originator.identity (ANY class; the ONE self-asserted-legal
;                                       position — surface/system live here)
;                  economics.wallet    (ANY class; a ROLE over a DID, D21)
;                  signed_by[].identity   (KEYED class only)
;                  signed_by[].stamped_by (KEYED class, hub or stack; D21)
;                RFC-0001 §2.1 two-plane rule (cited by RFC-0004 §5): KEYED
;                classes (principal/stack/agent/hub) may appear in signed_by[];
;                SELF-ASSERTED classes (surface/system) appear in `originator`
;                ONLY — a verifier MUST NOT resolve a self-asserted DID in the
;                keyed registry, and MUST reject a self-asserted DID found in a
;                stamp. This placement law is a verify-time / schema-pattern
;                side-condition, not a lexical one; ABNF cannot bind a class to
;                a JSON position. Deployed DID_RE (src/identity/types.ts:1,
;                  /^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/  flat/classless) is
;                replaced WHOLESALE at flag-day release R (RFC-0001 §9 — hard
;                cut). RFC-0003 adds no DID grammar of its own.
; did-prefix   — RFC-0001 `did-prefix` = %s"did:mf:" (case-sensitive). Used to
;                build the agent-class `source` and `target-assistant` rules.
; agent-msi    — RFC-0001 `agent-msi` = %s"agent" "." principal-id "."
;                stack-slug "." assistant-id (the agent arm of
;                method-specific-id; arity EXACTLY three segments after the
;                tag). Used by `source` (§1) and `target-assistant` (§1b).
; segment      — RFC-0001 kebab-strict `segment` (leading lowercase letter;
;                interior lowercase/digit/single "-"; no "_", no uppercase, no
;                trailing "-", no consecutive "--"; 1-63 octets, the octet
;                bound a separate side-condition). Imported for `type` (§2);
;                NOT redefined (grammar/README.md rule 5).
; principal-id, stack-slug, assistant-id
;              — RFC-0001 §3 terminals (each = `segment`). Referenced inside
;                agent-msi; named here for provenance.
; signature    — RFC-0004 `signature` (specs/grammar/envelope-signing.abnf):
;                the EXACTLY-88-character canonical base64 of a 64-byte Ed25519
;                signature. See §9.

lower           = %x61-7A                        ; a-z    (as RFC-0001)
UPPER           = %x41-5A                         ; A-Z
hexdig-ci       = DIGIT / %x41-46 / %x61-66       ; 0-9 A-F a-f (UUID_RE /i)

; ─────────────────────────────────────────────────────────────────────────
; 1. source — envelope origin address, a FULL agent-class DID (schema
;    required). D16 (Andreas override of the bare-triple form: "one address
;    form everywhere, like an IP address"): `source` is now the whole
;    class-explicit DID  did:mf:agent.{principal}.{stack}.{assistant}, a 6th
;    DID-valued envelope field aligned with RFC-0001 §2.2 — NOT the fixed-3
;    dotted triple of the pre-R draft. The former local production
;      source = principal-id "." stack-slug "." assistant-id
;    is DELETED; the agent DID's arity IS three segments after the tag, so the
;    identity terminals are still what bound each segment, now via agent-msi.
;    Deployed SOURCE_RE (src/envelope.ts:50,
;      /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$/ ) emits the LEGACY bare
;    triple and is replaced WHOLESALE by the did:mf agent form at flag-day
;    release R (RFC-0001 §9 hard cut), closing the "schema-valid source that
;    cannot render into a did:mf DID or a NATS subject" window (RFC §10).
;    D9 signed-wins: subject derivation extracts the {stack} segment FROM the
;    source DID (resolve from the signed envelope; warn-not-reject on subject
;    mismatch; never fabricate). D17 provenance binding (verify-time, not
;    lexical): the {principal}.{stack} of `source` MUST reconcile with the msi
;    tail of the innermost signing stack.
; ─────────────────────────────────────────────────────────────────────────
source          = did-prefix agent-msi

; ─────────────────────────────────────────────────────────────────────────
; 1b. target-assistant — the receiving assistant of a direct/delegate signal
;     (schema optional; REQUIRED when distribution_mode is direct|delegate,
;     RFC §6 cross-field rule). D20: target_assistant is an AGENT-class DID
;     ONLY — it names an assistant, never a principal/hub/surface/system. The
;     legacy key `target_principal` (R13 breaking cut) is rejected as an
;     unknown field (schema-side). Same shape as `source`; the two are the
;     only two agent-class-pinned DID fields.
; ─────────────────────────────────────────────────────────────────────────
target-assistant = did-prefix agent-msi

; ─────────────────────────────────────────────────────────────────────────
; 2. type — signal type domain.entity.action, 2–5 segments (schema required).
;    TYPE_RE, myelin src/envelope.ts:51
;      /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$/
;    D10: `type` imports RFC-0001's kebab-strict `segment`; the 2–5 segment
;    COUNT stays envelope-law (stricter than a subject token is safe). The
;    former local `type-segment` production — which permitted a trailing and
;    consecutive "-" — is DELETED; each segment is now kebab-strict. The
;    total-length bound is co-filed with RFC-0002.
; ─────────────────────────────────────────────────────────────────────────
type            = segment 1*4( "." segment )

; ─────────────────────────────────────────────────────────────────────────
; 3. uuid — id (required) and correlation_id (optional).
;    UUID_RE, myelin src/uuid.ts:4
;      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
;    D7 (RESOLVED — was OPEN): the canonical grammar is VERSION-AGNOSTIC —
;    accept ANY RFC 9562 8-4-4-4-12 hex string; the version/variant nibble is
;    NOT checked (a stable id shape buys no security absent a dedup contract).
;    v4/v7 are RECOMMENDED for emit; emit LOWERCASE; accept mixed case
;    (hexdig-ci). A `urn:uuid:` PREFIX is REJECTED — this rule has no prefix
;    production, so `urn:uuid:...` simply does not match (vector
;    envelope/id-urn-prefix). cortex's ajv-formats currently accepts that
;    prefix; that acceptance is a defect to be tightened onto this rule at R.
; ─────────────────────────────────────────────────────────────────────────
uuid            = 8hexdig-ci "-" 4hexdig-ci "-" 4hexdig-ci "-" 4hexdig-ci "-" 12hexdig-ci

; ─────────────────────────────────────────────────────────────────────────
; 4. datetime — timestamp, deadline, signed_by[].at (all schema format:date-time).
;    ISO8601_RE, myelin src/envelope.ts:53
;      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
;    D8 (RESOLVED — was OPEN): STRICT RFC 3339. Two constraints:
;      (a) LEXICAL — the "T" date/time separator and the "Z" zulu designator
;          are UPPERCASE-ONLY, pinned with %s (a bare ABNF literal is
;          case-INSENSITIVE, RFC 5234, so "T"/"Z" would WRONGLY admit "t"/"z";
;          the source regex has no /i). Seconds MANDATORY; fractional optional.
;      (b) SEMANTIC side-condition (NOT expressible in ABNF) — the value MUST
;          denote a calendar-valid finite instant: "2026-02-30T25:99:99Z" is
;          shape-valid here but MUST be REJECTED (month 02 has no day 30, hour
;          25 / minute-second 99 are out of range). This is verifier-enforced
;          exactly as RFC-0004's `at` (RFC-0004 §7.1), with which this rule is
;          coherent and onto which it TIGHTENS at flag-day R. EMIT is UTC "Z"
;          with millisecond precision (toISOString).
;    Vector envelope/timestamp-lowercase pins the case reject;
;    envelope/timestamp-out-of-range-accepted pins the calendar reject.
; ─────────────────────────────────────────────────────────────────────────
datetime        = full-date %s"T" full-time
full-date       = 4DIGIT "-" 2DIGIT "-" 2DIGIT
full-time       = 2DIGIT ":" 2DIGIT ":" 2DIGIT [ "." 1*DIGIT ] tz-offset
tz-offset       = %s"Z" / ( ("+" / "-") 2DIGIT ":" 2DIGIT )

; ─────────────────────────────────────────────────────────────────────────
; 5. residency-code — sovereignty.data_residency (schema required sub-field).
;    RESIDENCY_RE, myelin src/envelope.ts:52  /^[A-Z]{2}$/
;    Any two uppercase ASCII letters. The ISO 3166-1 REGISTRY is NOT enforced:
;    "XX", "ZZ" and the non-ISO regional "EU" all parse (residency registry owned by RFC-0005 §2.3,
;    §11 Privacy).
; ─────────────────────────────────────────────────────────────────────────
residency-code  = 2UPPER

; ─────────────────────────────────────────────────────────────────────────
; 6. currency-code — economics.currency.  CURRENCY_RE src/envelope.ts:28
;    /^[A-Z]{3}$/  (ISO 4217; registry NOT enforced).
; ─────────────────────────────────────────────────────────────────────────
currency-code   = 3UPPER

; ─────────────────────────────────────────────────────────────────────────
; 7. model-id — economics.actual.model.  MODEL_ID_RE src/envelope.ts:29
;    /^[a-z][a-z0-9-]*$/
; ─────────────────────────────────────────────────────────────────────────
model-id        = lower *( lower / DIGIT / "-" )

; ─────────────────────────────────────────────────────────────────────────
; 8. capability-tag — requirements[] items.
;    CAPABILITY_TAG_RE, myelin src/patterns.ts:22
;      /^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/
;    Structure: runs of alnum joined by SINGLE "-"; first char a letter; no
;    leading, trailing or consecutive "-". The two-alternative form below
;    expresses the 2-char structural FLOOR (single-char "a" is rejected, as in
;    capability-discovery.abnf); the 64-char CEILING stays a length side-
;    condition (the {0,62} quantifier the run structure does not itself bound).
;    Grammar OWNED by RFC-0008 §4.1 (capability discovery); transcribed here for
;    the envelope `requirements` field only. Vector envelope/requirements-bad-tag.
; ─────────────────────────────────────────────────────────────────────────
capability-tag  = lower 1*tag-sym *( "-" 1*tag-sym )
                / lower 1*( "-" 1*tag-sym )
tag-sym         = lower / DIGIT

; ─────────────────────────────────────────────────────────────────────────
; 9. base64-signature — signed_by[].signature (ed25519 and hub-stamp).
;    BASE64_RE, myelin src/identity/types.ts:2  /^[A-Za-z0-9+/]+=*$/
;    plus schema minLength 88 (a LENGTH SIDE-CONDITION).
;    This is the DEPLOYED accept-grammar (a value ≥88 base64 chars validates
;    at THIS layer). The canonical signature grammar is OWNED by RFC-0004
;    (specs/grammar/envelope-signing.abnf `signature`, ratified 2026-07-13,
;    D7): the EXACTLY-88-character canonical base64 of a 64-byte Ed25519
;    signature —  85base64-char final-quantum-2bit "==" — which additionally
;    rejects non-canonical (malleable) padding and unbounded length. RFC-0003
;    defines the stamp SHAPE only and DEFERS signature content, malleability,
;    and the signing/verification algorithm to RFC-0004 (§4). The loose
;    accept-grammar below TIGHTENS onto RFC-0004's `signature` at flag-day R.
; ─────────────────────────────────────────────────────────────────────────
base64-signature = 1*base64-char *"="
base64-char     = ALPHA / DIGIT / "+" / "/"
```

## Appendix B. Test Vectors

Vectors live as JSON under `vectors` (`specs/vectors/envelope/`), split into `valid.json` (inputs
that MUST parse / resolve — the accept oracle) and `invalid.json` (inputs that MUST be rejected — the
reject oracle added by D22). They are emitted by the committed, self-contained generator
`specs/vectors/envelope/generate.ts` (node-stdlib only; `specs/**` is eslint-ignored), which builds
the over-1-MiB reject vector programmatically rather than committing a megabyte literal. Every vector
carries a `why`. All identities are fake class-explicit dot-form fixtures; signatures are letter-only
`A`-sentinels; no value carries a 17–20-digit run.

The **accept oracle** (`valid.json`, 15 vectors) — under `envelope/`: `minimal-required`,
`federated-signed-ed25519`, `hub-stamp-variant`, `source-masking-prod-01`, `spec-version-current`,
`spec-version-newer-accepted`, `direct-with-target`, `mutable-channels-present`,
`economics-wallet-role-anyclass`, `residency-unassigned-code`, `originator-adapter-resolved`,
`originator-system-class`; under `actor/`: `originator-wins`, `chain-fallback`, `unsigned-none`.

The **reject oracle** (`invalid.json`, 22 vectors) is reproduced here in full (the programmatic
`envelope/over-max-size` vector is described, not inlined):

```json
[
  { "id": "envelope/unknown-top-field", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-4466ce440010", "source": "did:mf:agent.metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "payload": { "pr": 50 }, "foo": "bar" },
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "Closed contract (additionalProperties:false) is PERMANENT (D2): an unknown top-level key ALWAYS rejects." },
  { "id": "envelope/sovereignty-extra-field", "rfc": 3, "kind": "validateEnvelope",
    "input": { "…base…, sovereignty": "…+ region: 'eu'" },
    "expect": { "ok": false, "reason": "unknown-field-in-sovereignty" },
    "why": "The sovereignty object is CLOSED (D2). An unknown sub-field (region) rejects." },
  { "id": "envelope/missing-source", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with `source` deleted",
    "expect": { "ok": false, "reason": "missing-required-field" },
    "why": "source is one of the six REQUIRED fields (§6). Absence rejects; no default source (cortex#1812)." },
  { "id": "envelope/payload-array", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with payload:[1,2,3]",
    "expect": { "ok": false, "reason": "payload-not-object" },
    "why": "payload MUST be a JSON object (§3.6); arrays and null reject." },
  { "id": "envelope/id-not-uuid", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with id:'not-a-uuid'",
    "expect": { "ok": false, "reason": "id-not-uuid" },
    "why": "id MUST match the 8-4-4-4-12 hex uuid grammar (§3.1). D7 keeps it version-AGNOSTIC but still requires the canonical shape." },
  { "id": "envelope/id-urn-prefix", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with id:'urn:uuid:550e8400-e29b-41d4-a716-4466ce440011'",
    "expect": { "ok": false, "reason": "id-urn-prefix-forbidden" },
    "why": "D7: a urn:uuid: PREFIX is REJECTED — the uuid rule has no prefix production. cortex ajv-formats accepts it; the divergence tightens onto this rule at R." },
  { "id": "envelope/timestamp-lowercase", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with timestamp:'2026-05-11t14:33:00z'",
    "expect": { "ok": false, "reason": "datetime-lowercase-designator" },
    "why": "D8 STRICT RFC 3339: T/Z are UPPERCASE-ONLY (%s\"T\"/%s\"Z\"; the source regex has no /i). Lowercase rejects. cortex is case-insensitive here — pinned divergence." },
  { "id": "envelope/timestamp-out-of-range-accepted", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with timestamp:'2026-02-30T25:99:99Z'",
    "expect": { "ok": false, "reason": "datetime-not-calendar-valid" },
    "why": "MOVED valid→invalid by D8 (§12; id kept). Strict RFC 3339 REQUIRES a calendar-valid finite instant: month 02 has no day 30; hour 25 / min-sec 99 out of range. The reference once ACCEPTED this; retired." },
  { "id": "envelope/source-four-segments", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with source:'did:mf:agent.acme.monitor.prod.extra'",
    "expect": { "ok": false, "reason": "source-arity-mismatch" },
    "why": "D16: source is a FULL agent DID — agent-msi has EXACTLY three segments after the tag. A fourth segment rejects." },
  { "id": "envelope/source-not-agent-class", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with source:'did:mf:principal.andreas'",
    "expect": { "ok": false, "reason": "source-not-agent-class" },
    "why": "D16: source is pinned to the AGENT class. A well-formed principal-class DID is not a valid source." },
  { "id": "envelope/type-too-few-segments", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with type:'code'",
    "expect": { "ok": false, "reason": "type-segment-count" },
    "why": "D10: type is 2-5 kebab-strict segments. A single segment rejects — the 2-5 count is envelope-law." },
  { "id": "envelope/signed-by-shim-form", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with signed_by as a single stamp OBJECT (not an array)",
    "expect": { "ok": false, "reason": "signed-by-not-array" },
    "why": "MOVED valid→invalid by D6 (§12). At flag-day R signed_by is ARRAY-ONLY; the pre-#31 single-object shim rejects. Removes the getActorIdentity shim-form defect at its root." },
  { "id": "envelope/signed-by-surface-identity", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with signed_by:[ ed25519 stamp whose identity is 'did:mf:surface.discord' ]",
    "expect": { "ok": false, "reason": "self-asserted-in-signed-by" },
    "why": "TWO-PLANE REJECT (D15/D24): a SELF-ASSERTED-class DID (surface) holds no key and MUST NOT appear in signed_by[]. Schema-pattern + verify (RFC-0001 §2.1, RFC-0004 §5.1). Reject half of the originator accept pair." },
  { "id": "envelope/stamp-principal-key", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with signed_by:[ ed25519 stamp carrying legacy `principal` alongside `identity` ]",
    "expect": { "ok": false, "reason": "stamp-legacy-principal-key" },
    "why": "A stamp MUST NOT carry the legacy principal key (myelin#182 R2). The canonical DID key is identity; each stamp is closed." },
  { "id": "envelope/signature-too-short", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with signed_by:[ ed25519 stamp, signature = 'A'×40 ]",
    "expect": { "ok": false, "reason": "signature-too-short" },
    "why": "Stamp signature minLength 88 (base64-signature). A 40-char signature rejects here. Canonical exactly-88 / non-malleability is RFC-0004 §6.2, onto which this tightens at R." },
  { "id": "envelope/target-assistant-wrong-class", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() + distribution_mode:'direct', target_assistant:'did:mf:principal.andreas'",
    "expect": { "ok": false, "reason": "target-assistant-not-agent" },
    "why": "D20: target_assistant is AGENT-class only. A principal-class DID rejects even though well-formed and the cross-field rule is satisfied." },
  { "id": "envelope/target-principal-top-level", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with legacy top-level target_principal",
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "target_principal was removed by the R13 breaking cut; reserved-as-removed, rejects as an unknown field (closed contract, D2)." },
  { "id": "envelope/direct-missing-target", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() + distribution_mode:'direct' and NO target_assistant",
    "expect": { "ok": false, "reason": "target-assistant-required" },
    "why": "Cross-field rule (§6): direct/delegate ⇒ target_assistant REQUIRED. Accept half is envelope/direct-with-target." },
  { "id": "envelope/distribution-broadcast", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with distribution_mode:'broadcast'",
    "expect": { "ok": false, "reason": "distribution-mode-invalid" },
    "why": "broadcast was removed by the R11 (#180) breaking cut and MUST be rejected; the stale schema description/docs that bless it are defects (§9)." },
  { "id": "envelope/originator-principal-key", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with originator:{ identity, attribution, principal:… }",
    "expect": { "ok": false, "reason": "unknown-field-in-originator" },
    "why": "originator is exactly {identity, attribution}, closed. The legacy principal key (R2) rejects." },
  { "id": "envelope/requirements-bad-tag", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() with requirements:['a--b']",
    "expect": { "ok": false, "reason": "capability-tag-invalid" },
    "why": "requirements items MUST match capability-tag: alnum runs joined by a SINGLE '-', no '--'. (RFC-0002 §6.3 states a looser rule — a divergence RFC-0002 must reconcile.)" },
  { "id": "envelope/over-max-size", "rfc": 3, "kind": "validateEnvelope",
    "input": "base() whose payload.pad is machine-generated 'a' repetition sized to serialize > 1,048,576 octets",
    "expect": { "ok": false, "reason": "envelope-too-large" },
    "why": "D11: the whole-envelope receive bound is 1,048,576 octets (1 MiB); an over-bound envelope MUST be rejected receive-side. Built programmatically by generate.ts (confidentiality-gate-safe pad)." }
]
```

> The committed `specs/vectors/envelope/invalid.json` carries each `input` in full (and the true
> over-1-MiB `envelope/over-max-size` payload); the abbreviations above (`…base…`) are for the
> appendix's readability only. The `base()` template is the `envelope/minimal-required` accept
> vector.

## Appendix C. Change Log

Every substantive edit is logged here. Under single-principal ratification (ADR-0001) a `Ratified`
RFC is a living spec — it MAY be revised, with each revision logged — until the
immutable-once-`Ratified` + two-signature discipline reinstates on a second implementation or a
live federated peer.

| Date | Status | Change |
|---|---|---|
| 2026-07-17 | Ratified | **Non-agent `originator` binding — split-plane (myelin#251, STOP-AND-ASK resolved 2026-07-17; external review NorthwoodsSentinel, PR #230).** Closes the actor-spoofing residual §3.17 previously only pointed at. **§3.17:** a `principal`- or `stack`-class `originator.identity` MUST reconcile its principal component with the innermost signer `s[0].identity` at verify time (RFC-0004 §7.1), checked against the chain not the self-description — the sibling of the `source`→chain binding (D17); result token `originator-principal-binding-violation` (RFC-0004 §11.3). `surface`/`system`/`hub`-class originators carry no principal component and stay self-asserted-legal **by construction** (D15/D19 and their ACCEPT vectors untouched) — the split-plane scoping the STOP-AND-ASK chose over rejecting ratified accepts. **§7:** normative actor-authority **cap** — a policy engine MUST NOT grant principal-scoped authority to a `surface`/`system`/`hub`-class actor (compensating control; enforced at ingress by RFC-0005). **§10:** dedicated finding replaces the loose ":574 noted in §10" pointer, recording the bound half, the capped half, and three by-construction residuals (non-principal actor governed by prose cap; hub-stamp anchor bounded by the open D14 vouching scope; `attribution` still syntax-only). Edge cases enumerated as vectors before finalizing (hub-stamp anchors on `s[0].identity` not `stamped_by`; federated-forward D12 appended stamps do not re-key off `s[n-1]`). **Reject-token rationale:** the verify result token is `originator-principal-binding-violation` (§11.3 vocabulary, never on the wire); when a refused envelope is surfaced on the task path it maps to RFC-0010 §2.2 **`policy_denied`** — a pre-spawn authorization-gate refusal, permanent, `term`/no-redelivery — chosen because a cross-principal originator assertion is an authorization failure (not a capability `cant_do` or capacity `not_now` condition) that retrying cannot cure. Spec + vectors only; no grammar touched (the binding is a verify-time semantic, not an ABNF production — as with the agent-prefix binding). **Adversarial review (PR #255 FIX-FIRST):** recorded RFC-0010 as a normative `crossRef` + a Draft `[RFC-0010]` reference in §13.1 (the `policy_denied` mapping is a real normative dependency, cited at Draft status per ADR-0001); added the `envelope-signing/verify/originator-hub-class-signer-fail-closed` reject vector (a hub-class innermost signer exposes no principal to reconcile → fail-closed, previously asserted but unexercised); corrected the §7 reciprocal pointer to RFC-0005 **§6.2** (where the ingress cap note landed). |
| 2026-07-14 | Draft | **Grill resolution (grill-logs/rfc-0003.md, 26/26, Andreas 2026-07-14).** Every Open Decision resolved; all `[OPEN DECISION]` markers removed and §8 converted from "Open Decisions" to a resolution ledger + cross-document handoffs. **Inventory/registry (D1-D6):** §2's positional `#` column replaced with a **field-id** column (`—` for the mutable trio) carrying RFC-0004 §4.1's ids; each §3.x header stamped `(field-id N, RFC-0004 §4.1)`; §1.1/§4 DEMOTED from "defines membership" to "carries the boundary; RFC-0004 §4.1/§4.1.1/§4.2 governs"; `additionalProperties:false` stated PERMANENT (a newer `spec_version` licenses no unknown key); add-a-field procedure + warn-on-newer + mutable-set membership codified against RFC-0004 §4.1.1; `signed_by` ARRAY-ONLY at R (single-object shim retired). **Value grammars (D7-D10):** `uuid` version-agnostic (reject `urn:uuid:`); `datetime` strict RFC 3339 (uppercase `%s"T"`/`%s"Z"`, calendar-valid, UTC `Z` ms emit); `source.stack` live + signed-wins; `type` imports RFC-0001 kebab-strict `segment`, 2-5 count envelope-law. **Size (D11-D13):** 1 MiB whole-envelope receive bound + canonicalization structural caps + mutable-channel byte caps added to §6. **Extensions (D14):** `reply_to` contradiction resolved (RFC-0007 §7.1 transport hint; `extensions`/`economics` the only open islands). **DID fields (D15-D21):** two-plane placement (schema + verify); `source` = FULL class-explicit agent DID (6th DID field, D16); `source`↔chain provenance binding (D17); agent-originator anchor-projection table published (stack anchor only; principal/hub anchor REJECTED, not contradicting RFC-0004 §5.5 D16, D18); humans-via-surface with opaque stable user-id, no PII, no v1 human class (D19); `target_assistant` agent-class only (D20); `stamped_by ∈ {hub,stack}`, `economics.wallet` any-class role (D21). **Vectors (D22-D26):** Appendix B rewritten to the DID-epoch class-explicit set — 15 accept + 22 reject; two-plane pair-set + reject-completeness noted; `envelope/timestamp-out-of-range-accepted` (D8) and `envelope/signed-by-shim-form` (D6) MOVED valid→invalid keeping their ids; the former `actor/shim-form-documented` defect-catcher RETIRED by D6 (§7); cross-RFC citation sweep (no `§4.5` mis-cite — the two-plane verifier rule is RFC-0004 §5.1; the field-id registry is RFC-0004 §4.1). Fixed the stale RFC-0004 reference "Draft (planned)" → Ratified; RFC-0001/0002/0004 cited Ratified single-principal (ADR-0001). Added RFC-0005/0007/0008/0009 references and RFC 9562; added a `crossRefs` front-matter block; `openDecisions: []`. |
| 2026-07-13 | Draft | Cascade sweep (REVISIONS.md C2/C7/C9 + RFC-0001 ratification cascade; decision-free). **C2:** deleted the local `source-segment` production; `source`'s three segments import RFC-0001's `principal-id`/`stack-slug`/`assistant-id` terminals; the segment-alphabet/DID-class-collision item (OD-5) retargeted to RESOLVED by RFC-0001. **C7:** `spec_version` emission window + `$id` reconciliation retargeted to BCP-0001. **C9:** the `source` stack-segment authority OD (OD-4) co-filed with RFC-0002. Cascade: DID-valued vector examples rewritten to class-explicit form; two-plane rule noted; wallet-is-a-role note; agent-originator prefix binding cited from RFC-0001 §2.2; references updated. |
| 2026-07-12 | Draft | Initial draft. Promotes `schemas/envelope/v3` to a generated artifact; widens the charter to normatively own the signable/mutable boundary (§4) and `spec_version` semantics (§5). Records nine Open Decisions and ships a starter vector set with the source-masking case, the uuid/datetime collision pairs, and the shim-form actor defect-catcher. |
| 2026-07-14 | Ratified | Single-principal ratification by the principal (Andreas) under ADR-0001; two-signature reinstates on a 2nd implementation or live federated peer. |

## Acknowledgments

Grounded in the wire-protocol audit of the `envelope` dimension against myelin `origin/main`
(`schemas/envelope.schema.json`, `src/envelope.ts`, `src/uuid.ts`, `src/identity/canonicalize.ts`,
`src/patterns.ts`, `docs/envelope.md`) and cortex's consumer enforcement
(`src/bus/myelin/envelope-validator.ts`), and in the RFC-0003 grill
([`grill-logs/rfc-0003.md`](grill-logs/rfc-0003.md), 26 decisions, ratified 2026-07-14).

## Authors' Addresses

Luna, metafactory. The v1 ratification signatory is **the principal** (Andreas) alone, recorded in
`signatories` (the document moved to `Ratified` single-principal, 2026-07-14, ADR-0001); the
two-signature act (principal + hub custodian) is suspended and reinstates per §Status only when the
wire binds a party we do not control.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
