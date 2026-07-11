---
rfc: 0003
title: Envelope Format
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
grammar: specs/grammar/envelope.abnf
vectors: specs/vectors/envelope/
generated:
  - schemas/envelope.schema.json
supersedes_prose:
  - docs/envelope.md
  - docs/architecture.md (L3 envelope + spec_version paragraphs)
---

# RFC-0003: Envelope Format

## Abstract

This document specifies the myelin **envelope** — the single, universal JSON container that wraps
every signal crossing the metafactory agentic bus (M3 of the seven-layer stack). It defines the
envelope's required and optional fields, the per-field lexical grammar, the closed-contract rules
that reject unknown keys, and the boundary between the fields covered by a cryptographic signature
and the mutable fields that are not. It promotes the previously informative JSON Schema
(`$id https://myelin.metafactory.ai/schemas/envelope/v3`) to a normative, generated artifact, and
it additionally scopes in two contracts that a JSON Schema structurally cannot express: the
signable/mutable field boundary and the `spec_version` wire-grammar-versioning semantics. The
signing and verification *algorithm* itself is deferred to RFC-0004. Several field grammars are
transcribed faithfully from the deployed reference implementation while their unresolved questions
— a UUID grammar defined four ways, two divergent datetime enforcement semantics, absent size
bounds, unauthenticated mutable channels, and a source segment that is required but never consumed
— are recorded as Open Decisions and Security Considerations rather than silently ratified.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations
MUST NOT ground behaviour on a `Draft` or `Proposed` document.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are
published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** (Andreas) and **the hub custodian** (JC),
recorded in `signatories`. This draft is unsigned by construction. A wire contract binds more than
one party; it cannot be ratified by one.

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
8. Open Decisions
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

This document makes that container normative. It exists because the envelope contract is, at time
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

- **The signable / mutable field boundary** (§4) — which fields a signature covers and which are a
  deliberate mutable carve-out. This lives only in reference code (`SIGNABLE_FIELDS`,
  `src/identity/canonicalize.ts`) and would otherwise be unowned. The signing *algorithm* that
  consumes this boundary (the RFC 8785 JCS profile, chain-slice bytes, verification, clock-skew) is
  **deferred to RFC-0004**; RFC-0003 defines only the membership of the two sets.
- **`spec_version` semantics** (§5) — the wire-grammar version field and its warn-on-newer rule,
  which is inexpressible in JSON Schema and lives only in code.

**In scope:** the envelope field set and per-field syntax; the closed-contract and cross-field
structural rules; the signable/mutable boundary; `spec_version`; actor resolution.

**Out of scope (referenced, not defined here):** the `did:mf` grammar and identity classes
(RFC-0001); the NATS subject namespace and the composition of a subject from envelope fields
(RFC-0002); the signing/verification/canonicalization algorithm and clock-skew freshness
(RFC-0004); the sovereignty *enforcement* engine — who decrements `max_hop`, where classification
is enforced (a sovereignty-dimension concern this document only bounds and flags).

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
  at the top level, inside `sovereignty`, inside `originator`, and inside each stamp.
- **DID** — a `did:mf` decentralized identifier, defined by **RFC-0001**. Five envelope fields are
  DID-valued. RFC-0003 does not define DID syntax.
- **Subject** — the NATS subject a message is delivered on, defined by **RFC-0002**. The subject is
  **not** an envelope field (§10).
- **Stamp** — one element of the `signed_by` identity chain: an `ed25519` or `hub-stamp`
  attestation. Its cryptographic meaning is RFC-0004's; RFC-0003 defines only its shape.
- **Chain** — the ordered array of stamps in `signed_by`.
- **Signable field** — a field included in the bytes a stamp signs (§4).
- **Mutable field** — a field deliberately excluded from the signature (`correlation_id`,
  `economics`, `extensions`).
- **Actor** — the identity whose capabilities an envelope asserts, resolved by §7.
- **Originator** — the `originator` block: the policy-level claim of the actor, distinct from the
  cryptographic signer.
- **`spec_version`** — the optional wire-grammar version integer (§5).
- **Reference implementation** — the myelin TypeScript in `src/` on `origin/main`. Where this
  document transcribes a deployed regex, that code is cited as informative provenance; the ABNF and
  vectors are normative, not the source line.

---

## 2. Envelope Model

An envelope is a JSON object. Its wire form is UTF-8 JSON. The normative structure is the generated
JSON Schema listed in `generated` (`schemas/envelope.schema.json`, draft 2020-12); the normative
lexical syntax of its string fields is Appendix A. Where a generated artifact and the ABNF disagree,
**the ABNF governs and the artifact is a defect** (specs/README.md rule 4).

An envelope **MUST** contain exactly the six required fields and **MAY** contain any of the eleven
optional fields. An envelope **MUST NOT** contain any other top-level key: the contract is closed
(`additionalProperties: false`). New metadata **MUST** go in `extensions` (a mutable channel) or a
new, schema-versioned field; it **MUST NOT** be added as an ad-hoc top-level key.

The field set:

| # | Field | Req. | JSON type | Signable (§4) | Grammar |
|---|---|---|---|---|---|
| 1 | `id` | MUST | string | yes | `uuid` (§3.1) |
| 2 | `source` | MUST | string | yes | `source` (§3.2) |
| 3 | `type` | MUST | string | yes | `type` (§3.3) |
| 4 | `timestamp` | MUST | string | yes | `datetime` (§3.4) |
| 5 | `sovereignty` | MUST | object | yes | §3.5 |
| 6 | `payload` | MUST | object | yes | §3.6 (opaque) |
| 7 | `spec_version` | MAY | integer | yes | §3.7 / §5 |
| 8 | `correlation_id` | MAY | string | **no (mutable)** | `uuid` (§3.8) |
| 9 | `signed_by` | MAY | object \| array | yes (self, minus own sig) | §3.9 |
| 10 | `economics` | MAY | object | **no (mutable)** | §3.10 |
| 11 | `extensions` | MAY | object | **no (mutable)** | §3.11 (open) |
| 12 | `requirements` | MAY | array | yes | `capability-tag` (§3.12) |
| 13 | `sovereignty_required` | MAY | enum | yes | §3.13 |
| 14 | `deadline` | MAY | string | yes | `datetime` (§3.14) |
| 15 | `distribution_mode` | MAY | enum | yes | §3.15 |
| 16 | `target_assistant` | MAY | string | yes | `did` (§3.16) |
| 17 | `originator` | MAY | object | yes | §3.17 |

**Versioning.** The schema `$id` carries the wire version: `.../schemas/envelope/vN`. A breaking
change to the container **MUST** mint a new `$id` and, per specs/CONFORMANCE.md "Changing the wire",
keep prior versions published for pinned consumers. On `origin/main` today only the single `v3`
artifact exists; the schema's own description string claims `v1`/`v2` "stay published" though no such
files exist — a defect recorded as **[OPEN DECISION — Andreas + JC — schema regeneration]** (§8).

---

## 3. Field Specifications

Each field's normative lexical grammar is Appendix A. This section states the semantics and the
RFC 2119 requirements, and records the audit-verified defects in place.

### 3.1. `id`

`id` **MUST** be present and **MUST** be a `uuid` (Appendix A). It identifies this envelope
instance.

**[OPEN DECISION — Andreas + JC — uuid grammar reconciliation]** The `uuid` grammar is defined
**four** ways across the stack and the definitions disagree on a live accept/reject boundary:

1. `docs/envelope.md` says "UUID v4/v7".
2. The reference `UUID_RE` (`src/uuid.ts`) is **version-agnostic** (no version/variant nibble
   check) and **case-insensitive** — its own comment says "v4" but the regex checks no version.
3. The schema says `format: uuid`.
4. cortex enforces `format: uuid` via ajv-formats, whose regex additionally accepts a **`urn:uuid:`
   prefix**.

An `id` of `urn:uuid:550e8400-e29b-41d4-a716-446655440000` **validates at cortex and is rejected by
myelin** today. Appendix A transcribes the myelin reference (`UUID_RE`) as the deployed grammar;
this is what myelin accepts, not an endorsement. The decision (version nibble? `urn:uuid:` prefix?)
is unresolved. Vector `envelope/id-urn-prefix` (Appendix B) pins the divergence.

`id` uniqueness scope, any de-duplication obligation, and replay defence are **unspecified** — see
§10 "Replay".

### 3.2. `source`

`source` **MUST** be present and **MUST** match `source` (Appendix A): the fixed-3 form
`{principal}.{stack}.{assistant}`, exactly three dot-separated segments. This is the myelin#183
breaking cut from the historical loose 3–5 segment `org.agent.instance` shape.

> `docs/envelope.md` §Validation rules **still prints** the stale pattern
> `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$` ("3–5 lowercase segments"). A consumer implementing
> from that prose emits 4–5 segment sources that every schema-conformant peer rejects — the exact
> defect class (the pilot review-loop bug) the breaking cut was made to kill. This document
> supersedes that prose (`supersedes_prose`). Vectors `envelope/source-four-segments` and
> `envelope/source-masking-prod-01` pin both the rejection and its masking case.

**source-segment alphabet is a finding.** `source-segment` (`[a-z][a-z0-9-]*`) is unbounded and
permits both a trailing `-` and consecutive `--`. It therefore **diverges** from RFC-0001
`principal-id` (forbids trailing `-`), RFC-0001 `stack-slug` (63-char cap) and RFC-0002's subject
segment. A schema-valid `source` whose principal segment contains `--` or exceeds 63 characters is
accepted here but **cannot render** into a `did:mf` DID or a NATS subject — a downstream runtime
throw, not a wire rejection. See §10 "Segment-alphabet divergence" and the §8 convergence decision.

**source-segment 2 (`stack`) is dead on the wire.** The grammar names segment 2 `{stack}`, but
subject derivation (RFC-0002) reads the stack from an out-of-band caller argument and consumes only
`source`'s **first** segment. The envelope's stack segment is never consumed and never cross-checked
against the subject's stack; namespace.md's own worked example derives subject stack `default` while
`source` carries stack `monitor`, silently different. No rule decides which is authoritative — the
same fabricated-stack defect class as cortex#1812. **[OPEN DECISION — Andreas + JC — coordinate with
RFC-0002]** (§8).

### 3.3. `type`

`type` **MUST** be present and **MUST** match `type` (Appendix A): `domain.entity.action`, 2–5
dot-separated segments. It classifies the signal for routing and consumers.

### 3.4. `timestamp`

`timestamp` **MUST** be present and **MUST** match `datetime` (Appendix A): the shape of an ISO-8601
/ RFC 3339 date-time as enforced by the reference `ISO8601_RE`.

**[OPEN DECISION — Andreas + JC — datetime enforcement semantics]** Two enforcement stacks disagree
on the same `format: date-time`, in both directions, on a **signable** field:

- The reference `ISO8601_RE` does **no calendar-range check** — `2026-02-30T25:99:99Z` (month/day
  out of range, hour 25, minute/second 99) is **accepted** — but requires **uppercase** `T`/`Z`
  (no `/i` flag) and mandates a seconds component.
- cortex's ajv-formats "full" `date-time` performs real calendar range validation (**rejecting**
  `2026-02-30`) but is **case-insensitive**, accepting lowercase `t`/`z` that myelin rejects.

Appendix A's `datetime` transcribes the reference **shape** only; calendar validity is a semantic
side-condition ABNF cannot carry. Whether RFC 3339 calendar validity is REQUIRED and whether
lowercase `t`/`z` MUST be accepted is unresolved. Vectors `envelope/timestamp-out-of-range-accepted`
(valid, myelin) and `envelope/timestamp-lowercase` (invalid, myelin) pin the collision pair.

### 3.5. `sovereignty`

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
process it. It is entirely **signable**.

Findings (all recorded in §10 as invariants held by prose or by nothing, not by the format):

- `data_residency` is validated only as two uppercase letters; the **ISO 3166-1 registry is not
  enforced** (`XX`, `ZZ` validate), and `docs/envelope.md` blesses the non-ISO regional code `EU`
  that the normative description ("ISO 3166-1 alpha-2 country code") excludes. **[OPEN DECISION —
  Andreas + JC — residency registry]** (§8). Vector `envelope/residency-unassigned-code`.
- `max_hop` is signable and required, but **no myelin or cortex code decrements it or reads it for
  an allow/block decision**; its documented semantic ("each forwarding consumes one") is
  cryptographically unimplementable because decrementing a signable field invalidates every prior
  stamp. Its enforcement contract is **unwritten** (a sovereignty-dimension gap this document only
  admits and bounds).
- `frontier_ok`/`model_class` — the "what may process it" promise — are shape-validated only; no
  myelin path reads them for enforcement.

### 3.6. `payload`

`payload` **MUST** be present and **MUST** be a JSON object. The reference validator additionally
rejects arrays and `null`. The envelope **does not** otherwise constrain payload shape — it is
domain-specific and opaque to M3. It carries **no size bound** (§10 "No size bounds"). Vector
`envelope/payload-array`.

### 3.7. `spec_version`

`spec_version` **MAY** be present. When present it **MUST** be an integer `>= 1`. The current wire
grammar is `3`. It is a **signable** field. Its accept/emit semantics are §5.

### 3.8. `correlation_id`

`correlation_id` **MAY** be present; when present it **MUST** be a `uuid`. It links related
envelopes across a workflow. It is a **mutable** field (§4) — a client **MUST NOT** make a security
or trust decision based on it.

### 3.9. `signed_by`

`signed_by` **MAY** be present. When present it **MUST** be either a single stamp object (the pre-#31
back-compat shim) **or** an array of 1 to 16 stamps (`MAX_CHAIN_LENGTH = 16`); an array **MUST NOT**
exceed 16 stamps. The canonical wire form is the array; the single-object form is a read-side shim.

Each stamp **MUST** carry `identity` (a `did`) and **MUST** be one of two discriminated shapes, each
with `additionalProperties: false`:

- `method: "ed25519"` — MUST have `method`, `identity`, `signature` (a `base64-signature`,
  minLength 88), `at` (a `datetime`); MAY have `role`.
- `method: "hub-stamp"` — as above, and MUST additionally have `stamped_by` (a `did`).

`role`, when present, **MUST** be one of `origin`, `transit`, `accountability`, `sovereignty`,
`notary`.

A stamp **MUST NOT** carry the legacy key `principal` (dropped from the wire by the myelin#182 R2
breaking cut); the canonical DID key is `identity`. A stamp carrying `principal` is rejected as an
unknown field. Vector `envelope/stamp-principal-key`.

The **cryptographic meaning** of a stamp — the bytes it signs, chain-commit semantics, verification,
freshness — is **deferred to RFC-0004**. RFC-0003 defines the stamp SHAPE only. The stamp
`signature` grammar has minLength 88 but **no maximum and no length-mod-4 / canonical-padding
check** (§10, RFC-0004). Vector `envelope/signature-too-short`.

**[OPEN DECISION — Andreas + JC — shim retirement]** The single-object shim form is accepted with no
named retirement release — an open migration window. It also triggers the actor-resolution defect in
§7. Vector `envelope/signed-by-shim-form`.

### 3.10. `economics`

`economics` **MAY** be present. It is a **mutable** field (§4): outside the signature,
`additionalProperties: true` at every level. Its sub-fields, when present, **MUST** satisfy:
`budget.max_tokens` a positive integer; `budget.max_cost_usd` a non-negative number;
`actual.{input_tokens,output_tokens,total_tokens,duration_ms}` non-negative integers; `actual.cost_usd`
a non-negative number; `actual.model` a `model-id`; `wallet` a `did`; `billing_ref` a string of at
most 256 characters; `currency` a `currency-code`.

A client **MUST NOT** make a security or trust decision based on any `economics` value. Because it is
mutable, unsigned, `additionalProperties: true`, and otherwise unbounded, any intermediary may
inject or alter its content on a signed federated envelope without invalidating any stamp — see §10
"Unauthenticated mutable channels" and §11.

### 3.11. `extensions`

`extensions` **MAY** be present. It is the documented forward-compatibility escape hatch:
`additionalProperties: true`, **mutable**, unbounded. A client **MUST NOT** make a security or trust
decision based on any `extensions` value. Anything that must be attested or schema-validated
**MUST NOT** go in `extensions`; it belongs in a new signable top-level field. Vector
`envelope/mutable-channels-present`.

### 3.12. `requirements`

`requirements` **MAY** be present. When present it **MUST** be an array of at most 10 items, each
matching `capability-tag` (Appendix A): 2–64 chars, starting with a letter, ending with a
letter/digit, no trailing or consecutive hyphens. It is **signable**. The `capability-tag` alphabet
is co-owned with RFC-0002 (the tasks-domain capability taxonomy), whose namespace.md states a looser
grammar — a cross-doc divergence RFC-0002 must reconcile.

### 3.13. `sovereignty_required`

`sovereignty_required` **MAY** be present; when present it **MUST** be one of `open`, `selective`,
`strict`, `bidding`. It is **signable**. The comparison semantics against an advertisement's mode
are a discovery-dimension concern, not defined here.

### 3.14. `deadline`

`deadline` **MAY** be present; when present it **MUST** match `datetime` (§3.4, inheriting that
field's OPEN DECISION). It is a **signable** soft deadline.

### 3.15. `distribution_mode`

`distribution_mode` **MAY** be present; when present it **MUST** be one of `offer`, `direct`,
`delegate`. It is **signable**. The value `broadcast` was removed from the wire by the R11 (#180)
breaking cut and **MUST** be rejected.

> Two artifacts still contradict this: `docs/envelope.md` §Canonical fields calls `broadcast`
> "accepted, deprecated", and the schema's own **top-level `description` string** claims the schema
> "still accepts the deprecated form for … `distribution_mode` broadcast". Both are stale. The enum
> body and the reference validator govern and reject `broadcast`; the description is non-normative
> prose the RFC directs to be corrected on regeneration (§8). Vector `envelope/distribution-broadcast`.

### 3.16. `target_assistant`

`target_assistant` **MAY** be present; when present it **MUST** be a `did` (RFC-0001). It is
**signable**. It **MUST** be present when `distribution_mode` is `direct` or `delegate` (§6). It
names the receiving assistant (the `@`-target of a Tasks-Domain subject names an assistant, not a
principal). The legacy key `target_principal` was removed by the R13 breaking cut and **MUST** be
rejected as an unknown field. Vectors `envelope/target-principal-top-level`, `envelope/direct-with-target`.

### 3.17. `originator`

`originator` **MAY** be present. When present it **MUST** be an object with exactly `identity` (a
`did`) and `attribution`, `additionalProperties: false`. `attribution` **MUST** be one of
`adapter-resolved`, `federated`, `delegated`. It is a **signable** policy-attribution claim
(myelin#160): the `signed_by` chain proves *who signed*; `originator` names *whose capabilities the
signer claims to act on behalf of*. The legacy key `principal` was removed by the R2 breaking cut and
**MUST** be rejected. Vectors `envelope/originator-adapter-resolved`, `envelope/originator-principal-key`.

`originator` is validated only syntactically. **No rule constrains which signer may assert which
originator identity, or requires `attribution` to be consistent with the chain** (e.g. `federated`
with no hub-stamp) — a provenance-dimension gap noted in §10.

---

## 4. The Signable / Mutable Boundary

This section is normative and in scope (§1.1). It defines the *membership* of the signable and
mutable sets. The *algorithm* that turns the signable set into signed bytes — the RFC 8785 JCS
profile, the "strip the current stamp's own signature", the chain-slice for verifying stamp `i`, the
absent-key rule, clock-skew — is **deferred to RFC-0004** and **MUST NOT** be inferred from this
section.

An implementation that signs or verifies an envelope **MUST** treat exactly the following fields as
**signable** (covered by each stamp):

`id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`, `signed_by`, `requirements`,
`sovereignty_required`, `deadline`, `distribution_mode`, `target_assistant`, `originator`,
`spec_version`.

An implementation **MUST** treat exactly the following fields as **mutable** and **MUST** exclude
them from the signed bytes:

`correlation_id`, `economics`, `extensions`.

Two consequences are normative:

- Because absent optional fields are never included in the canonical bytes, adding a new **optional**
  signable field (the mechanism by which `spec_version` was introduced) does **not** break existing
  signatures. This is the designed evolution mechanism.
- A client **MUST NOT** make a security or trust decision based on any mutable field. The carve-out
  exists so hubs can annotate routing, accumulate economics, and trace correlation without
  invalidating attestations. This is a **behavioural** guard, not a format property — recorded as a
  finding in §10.

> Note: `docs/envelope.md`'s "attested fields" list omits `spec_version`; the reference
> `SIGNABLE_FIELDS` includes it. This document's list governs.

---

## 5. `spec_version` Semantics

This section is normative and in scope (§1.1); it captures a contract that JSON Schema cannot express
and that lives only in reference code today.

- `spec_version` **MAY** be absent. Absent **MUST** be interpreted as "the pre-`spec_version`
  grammar" and, because it is absent from the canonical bytes, an absent `spec_version` **MUST NOT**
  change the signed bytes relative to a legacy envelope.
- When present, `spec_version` **MUST** be an integer `>= 1`. The current wire grammar is `3`.
- **Warn-on-newer.** A verifier that receives a `spec_version` **greater** than the version it
  understands **MUST NOT** reject the envelope solely on that basis, and **SHOULD** emit a warning.
  It **MUST** still reject genuinely unknown top-level fields via the closed-contract rule (§6): a
  newer `spec_version` is not blanket forward-compatibility.
- **Rollout doctrine: verifiers before emitters.** In the current phase (4a), a conformant
  implementation **MUST** accept and sign `spec_version` when present but **MUST NOT** be required to
  emit it (`createEnvelope` does not). Emission is a later, separate release.

**[OPEN DECISION — Andreas + JC — emission phasing / dual-accept]** `spec_version` was added to a
closed contract (`additionalProperties: false`) **without** a `$id` bump, and the emission release
(Phase 4b) is unnamed with no documented dual-accept window. A consumer pinned to a
pre-`spec_version` copy of `v3` will hard-reject envelopes the moment emission begins. The named
emission release, whether it requires a `$id` bump, and the dual-accept window per
specs/CONFORMANCE.md are unresolved (§8). The warn-on-newer rule is code-only; cortex's Ajv stack has
no such semantics, so the two stacks already disagree on what accepting a newer `spec_version` means.
Vectors `envelope/spec-version-current`, `envelope/spec-version-newer-accepted`.

---

## 6. Structural Rules

- **Required set.** An envelope **MUST** contain `id`, `source`, `type`, `timestamp`, `sovereignty`,
  `payload`.
- **Closed contract.** An envelope **MUST NOT** contain any top-level key other than the seventeen in
  §2. The `sovereignty` object, the `originator` object, and each stamp object are likewise closed:
  each **MUST NOT** contain unknown keys. Vectors `envelope/unknown-top-field`,
  `envelope/sovereignty-extra-field`.
- **Cross-field rule.** If `distribution_mode` is `direct` or `delegate`, then `target_assistant`
  **MUST** be present. Vectors `envelope/direct-with-target`, `envelope/direct-missing-target`.
- **No nulls on the wire.** An emitter **MUST** omit an optional field it is not setting rather than
  emit `null`.

---

## 7. Actor Resolution

Policy engines need one answer to "whose capabilities does this envelope assert?" The **actor** is
resolved as follows and a conformant implementation **MUST** compute it thus:

1. If `originator` is present, the actor **MUST** be `originator.identity`.
2. Otherwise, if `signed_by` names at least one stamp, the actor **MUST** be the **first** stamp's
   `identity` (the chain origin).
3. Otherwise the envelope has no actor.

Vectors `actor/originator-wins`, `actor/chain-fallback`, `actor/unsigned-none`.

**[OPEN DECISION — Andreas + JC — shim-form actor, CONFIRMED defect]** `docs/envelope.md` and
namespace.md document rule 2 as "fall back to `signed_by[0].identity`", but the reference
`getActorIdentity` treats a **non-array (single-object shim) `signed_by`** as an empty chain and
returns `undefined` — silently losing policy attribution for a validly-signed envelope. Vector
`actor/shim-form-documented` pins the **documented** behaviour and, by design, **MUST fail** an
implementation that reproduces this bug. The resolution (fix the helper, or retire the shim form so
the case cannot arise) is coupled to the §3.9 shim-retirement decision (§8).

---

## 8. Open Decisions

Each item below is unresolved. An implementation **MUST NOT** treat any resolution as decided. These
are also carried in the document's `openDecisions` front-matter block.

| # | Decision | Owner | Blocked on |
|---|---|---|---|
| OD-1 | Canonical `uuid` grammar (version nibble? `urn:uuid:` prefix?) — §3.1 | Andreas + JC | reconcile `UUID_RE` vs cortex ajv-formats; no issue filed |
| OD-2 | Datetime semantics: RFC 3339 calendar validity + case — §3.4 | Andreas + JC | select RFC 3339 profile; reconcile two stacks; no issue filed |
| OD-3 | Envelope size bounds (per-field + total; NATS `max_payload`) — §10 | Andreas + JC | align with transport (M2); no issue filed |
| OD-4 | Authority of `source` segment 2 (`stack`), dead on the wire — §3.2 | Andreas + JC | coordinate with RFC-0002 subject derivation |
| OD-5 | Segment-alphabet convergence + DID class collision — §3.2, §10 | Andreas + JC | the-metafactory/cortex#1880 (RFC-0001 method-specific-id) |
| OD-6 | `spec_version` emission (Phase 4b), `$id` bump, dual-accept — §5 | Andreas + JC | myelin B2 release; CONFORMANCE dual-accept procedure |
| OD-7 | `signed_by` single-object shim retirement — §3.9 | Andreas + JC | no issue filed |
| OD-8 | `getActorIdentity` shim-form actor (CONFIRMED defect) — §7 | Andreas + JC | coupled to OD-7 |
| OD-9 | Correct stale schema `description`; (re)publish `v1`/`v2` — §2, §3.15 | Andreas + JC | schema regeneration; prior-version publication decision |

---

## 9. Registry Considerations

- **RFC number.** `0003` is allocated in [`specs/README.md`](../README.md); numbers are never reused.
- **Schema `$id` version namespace.** This document reserves and registers
  `https://myelin.metafactory.ai/schemas/envelope/v3` as the current envelope schema identifier. A
  future breaking version **MUST** mint the next `.../vN` and keep prior versions published for
  pinned consumers. Only `v3` exists on `origin/main` today; the schema's claim that `v1`/`v2` remain
  published is a defect (OD-9).
- **Reserved enumerations.** This document registers the closed value sets for
  `sovereignty.classification` (`local`, `federated`, `public`), `sovereignty.model_class`
  (`local-only`, `frontier`, `any`), `sovereignty_required` (`open`, `selective`, `strict`,
  `bidding`), `distribution_mode` (`offer`, `direct`, `delegate`), `originator.attribution`
  (`adapter-resolved`, `federated`, `delegated`), and stamp `role` (`origin`, `transit`,
  `accountability`, `sovereignty`, `notary`). Adding a value to any set is a wire change per
  specs/CONFORMANCE.md.
- **Reserved (removed) keys.** `signed_by[].principal`, `originator.principal`, `target_principal`,
  and `distribution_mode: "broadcast"` are reserved-as-removed: an envelope carrying any of them
  **MUST** be rejected.
- **External registries (not enforced here).** `data_residency` references ISO 3166-1 alpha-2 and
  `economics.currency` references ISO 4217; this document does **not** enforce either registry (OD-2/
  OD-... residency). No DID method is registered here — the `did:mf` method and any W3C DID
  registry action are RFC-0001's.

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

- **Unauthenticated mutable channels (finding).** `economics` and `extensions` are outside
  `SIGNABLE_FIELDS`, `additionalProperties: true`, and have **no size bound**. Any intermediary can
  inject or alter arbitrary content on a signed federated envelope **without invalidating any
  stamp**. The sole countervailing control is the prose rule "clients MUST NOT make security or
  trust decisions based on mutable-field values" (§4) — a behavioural guard, not a format property.

- **Subject↔envelope binding is classification-prefix-only (finding).** The delivery subject is
  **not** an envelope field and is **not** in `SIGNABLE_FIELDS`. The only specified receive-side
  subject↔envelope check is the classification prefix (`subjectPrefixAligns` compares the first
  token). The subject's principal and stack segments are never bound to the signed `source`, so a
  validly-signed envelope can be **replayed verbatim onto any subject with the same classification
  prefix** — e.g. under another principal's `federated.{principal}.>` tree — and still pass schema
  validation and alignment. Whatever actually prevents cross-principal replay (NATS account publish
  permissions) is a runtime guard the wire contract nowhere declares.

- **`source` not bound to the chain (finding).** `source`'s first segment seeds the subject principal
  and is used by consumers for cross-principal attribution, yet no rule binds it to the verified
  `signed_by` chain; `source` is self-asserted. A validly-signed envelope may claim any `source`
  first segment. (Overlaps the provenance dimension.)

- **`source` stack segment dead-on-wire (finding).** §3.2 / OD-4: segment 2 is never consumed and can
  silently disagree with the subject's stack — the cortex#1812 fabricated-stack class.

- **Replay / uniqueness unwritten (finding).** `id` is only "unique per instance"; there is **no**
  de-duplication obligation and **no** replay defence in the format. The docs affirmatively celebrate
  six-month replay. A validly-signed `direct`/`delegate` task envelope is replayable indefinitely and
  the wire contract says nothing about it. (Signature freshness / clock-skew is RFC-0004's; the format
  gap is recorded here.)

- **Flat-namespace DID class collision (inherited finding).** The five DID-valued fields
  (`target_assistant`, `originator.identity`, `economics.wallet`, `signed_by[].identity`,
  `signed_by[].stamped_by`) cannot distinguish agent/service/hub/principal/stack classes; the collision
  is held shut by a runtime guard, not the grammar. Blocked on RFC-0001 / cortex#1880 (OD-5).

- **Segment-alphabet divergence (finding).** §3.2: a schema-valid `source` with a `--` or >63-char
  segment cannot render into a DID or a NATS subject; `deriveNatsSubject`/`assertSegment` throw at
  emit — a downstream runtime guard, not a wire rejection. OD-5.

- **Two enforcement stacks for `uuid`/`datetime` (finding).** OD-1/OD-2: the same schema is enforced
  by myelin's hand-rolled regexes and by cortex's ajv-formats with **divergent** accept/reject sets,
  so an envelope valid at one hop is invalid at the adjacent hop, in both directions, on
  signable fields. Vectors `envelope/id-urn-prefix`, `envelope/timestamp-lowercase`,
  `envelope/timestamp-out-of-range-accepted`.

- **Signature malleability / unbounded signature (finding, detail deferred).** The stamp `signature`
  grammar accepts non-canonical base64 (no length-mod-4 or canonical-padding check) and has **no
  maximum length**. The malleability consequences (a 64-byte Ed25519 signature has multiple 88-char
  encodings) are RFC-0004's; the format's silence is recorded here. Vector `envelope/signature-too-short`.

- **No size bounds (finding).** OD-3: only `requirements` (10), `signed_by` (16) and `billing_ref`
  (256) are bounded. `payload`, `extensions`, `economics`, every string segment, and the stamp
  signature are unbounded. Total envelope size is undecided at M3; the de facto limit is the NATS
  `max_payload` transport property the contract never declares. Unbounded chain and payload are DoS
  surfaces (verification cost is O(n) canonicalizations — RFC-0004).

- **`spec_version` added to a closed contract without a `$id` bump (finding).** OD-6: Phase 4b
  emission without a dual-accept window will hard-reject at consumers pinned to a pre-field copy of
  `v3`.

- **Sovereignty is a declaration with an unwritten enforcement contract (finding).** §3.5: `max_hop`,
  `frontier_ok`, `model_class` and `data_residency` are shape-validated only; no myelin path reads
  them for an allow/block decision. The envelope's most security-relevant block declares policy that
  the format does not enforce (a sovereignty-dimension gap this document admits and bounds).

## 11. Privacy Considerations

This document specifies identifiers and is therefore REQUIRED to state what they leak.

- **`source` is an identity/topology disclosure.** `{principal}.{stack}.{assistant}` names the
  originating principal, its deployment stack, and the assistant on every message — self-asserted and
  present even when `classification` is `public` (where the *subject* omits principal/stack, the
  *envelope* `source` still carries them). It correlates a principal across every message it emits.

- **DID-valued fields correlate actors across contexts.** `target_assistant`, `originator.identity`,
  `economics.wallet`, and each stamp `identity`/`stamped_by` are stable `did:mf` identifiers. A
  `did:mf` is a persistent pseudonym; observing it across envelopes links otherwise-unrelated
  activity. `originator.identity` may name a **human** actor (adapter-resolved), attaching a person to
  a workflow.

- **`correlation_id` links a workflow.** As a stable UUID across related envelopes it is a linkage
  identifier; it is mutable and unsigned, so an intermediary can also *re-link* messages.

- **`economics` carries PII on an unsigned, mutable, cross-boundary channel.** `economics.billing_ref`
  is 256 chars of free text and `economics.wallet` is a DID; both cross principal boundaries mutable
  and unsigned, with **no guidance** on what may be placed there, who may read or aggregate it, or
  whether it may carry personal or billing data. Implementations **SHOULD NOT** place PII in
  `economics` or `extensions`, and **MUST NOT** rely on their confidentiality or integrity across a
  boundary.

- **Replayable envelopes extend observability.** Because the format permits indefinite replay (§10),
  an identifier in a signed envelope remains linkable long after the interaction, with no
  format-level expiry.

## 12. Conformance

An implementation conforms to this document **if and only if it passes every vector** under the path
named in `vectors` (`specs/vectors/envelope/`). Reading the specification is not conformance;
passing the vectors is (specs/CONFORMANCE.md).

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

- **Divergence / collision vectors** (`envelope/id-urn-prefix`, `envelope/timestamp-lowercase`,
  `envelope/timestamp-out-of-range-accepted`) pin the **myelin reference** behaviour while an Open
  Decision (OD-1/OD-2) is unresolved. Should a decision change the rule, the affected vector moves
  between `valid.json` and `invalid.json` with a note in the change log — never a silent edit.
- **Defect-catcher vectors** (`actor/shim-form-documented`) pin **documented** behaviour that the
  current reference implementation fails (OD-8); a conformant implementation **MUST NOT** reproduce
  the documented defect.

## 13. References

### 13.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Draft. Owns the `did`, `principal-id`, `stack-slug` terminals this document references.
- [RFC-0002] metafactory, "Subject Namespace", Draft. Owns the NATS subject grammar and the composition of a subject from envelope fields; co-owns the `source`/subject segment alphabet and `capability-tag`.
- [RFC-0004] metafactory, "Envelope Signing and Canonicalization", Draft (planned). Owns the bytes-to-sign algorithm (RFC 8785 JCS profile), chain-slice semantics, verification, clock-skew, and signature malleability that consume this document's §4 boundary.

### 13.2. Informative References

- [RFC3339] Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002.
- [RFC4122] Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005.
- [RFC4648] Josefsson, S., "The Base16, Base32, and Base64 Data Encodings", RFC 4648, October 2006.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020.
- [ISO3166-1] ISO 3166-1, "Codes for the representation of names of countries and their subdivisions — Part 1: Country code".
- [ISO4217] ISO 4217, "Codes for the representation of currencies".
- [W3C-DID] W3C, "Decentralized Identifiers (DIDs) v1.0".
- `docs/envelope.md`, `docs/architecture.md` (§L3, §5.2), `specs/namespace.md` — the informative prose this document supersedes or draws context from.

---

## Appendix A. Collected ABNF

This appendix is a **copy**. The file named in `grammar` (`specs/grammar/envelope.abnf`) is the
source of truth and is what CI validates. This grammar defines the lexical syntax of the
string-valued fields only; the JSON object structure lives in the promoted schema and §2/§6.

```abnf
; specs/grammar/envelope.abnf — RFC-0003 Envelope Format (Draft; not normative until Ratified)
; String-field lexical syntax only. Object structure is in the JSON Schema (generated) + RFC body.
; Terminal alphabets defined ONCE by the owning RFC and REFERENCED here (grammar/README.md rule 5).
; Core rules ALPHA, DIGIT imported from RFC 5234 Appendix B.

; --- Imported / referenced (defined elsewhere; NOT redefined) ---
; did  — RFC-0001 `did`. Used by target_assistant, originator.identity, economics.wallet,
;        signed_by[].identity, signed_by[].stamped_by. Each matches myelin DID_RE
;        /^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/ (src/identity/types.ts:1). Every DID-valued
;        field INHERITS RFC-0001's OPEN DECISION on method-specific-id (cortex#1880) and the
;        flat-namespace class collision. RFC-0003 adds no DID grammar of its own.

lower           = %x61-7A                 ; a-z  (as RFC-0001)
UPPER           = %x41-5A                 ; A-Z
hexdig-ci       = DIGIT / %x41-46 / %x61-66   ; 0-9 A-F a-f (UUID_RE carries /i)

; 1. source — SOURCE_RE src/envelope.ts:50  /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$/
;    Fixed-3 {principal}.{stack}.{assistant} (myelin#183). FINDING: source-segment is unbounded
;    and permits trailing AND consecutive "-", diverging from RFC-0001 principal-id/stack-slug
;    and RFC-0002 subject segments (RFC Security Considerations).
source          = source-segment "." source-segment "." source-segment
source-segment  = lower *( lower / DIGIT / "-" )

; 2. type — TYPE_RE src/envelope.ts:51  /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$/
type            = type-segment 1*4( "." type-segment )
type-segment    = lower *( lower / DIGIT / "-" )

; 3. uuid — UUID_RE src/uuid.ts:4  /^[0-9a-f]{8}-...-[0-9a-f]{12}$/i  (version-agnostic, /i)
;    OPEN DECISION (cortex ajv-formats also accepts a "urn:uuid:" prefix; docs say v4/v7).
uuid            = 8hexdig-ci "-" 4hexdig-ci "-" 4hexdig-ci "-" 4hexdig-ci "-" 12hexdig-ci

; 4. datetime — ISO8601_RE src/envelope.ts:53
;    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
;    Uppercase T/Z only; seconds mandatory; NO calendar-range check. OPEN DECISION (RFC 3339 + case).
datetime        = full-date "T" full-time
full-date       = 4DIGIT "-" 2DIGIT "-" 2DIGIT
full-time       = 2DIGIT ":" 2DIGIT ":" 2DIGIT [ "." 1*DIGIT ] tz-offset
tz-offset       = "Z" / ( ("+" / "-") 2DIGIT ":" 2DIGIT )

; 5. residency-code — RESIDENCY_RE src/envelope.ts:52  /^[A-Z]{2}$/ (ISO 3166-1 NOT enforced)
residency-code  = 2UPPER

; 6. currency-code — CURRENCY_RE src/envelope.ts:28  /^[A-Z]{3}$/ (ISO 4217 NOT enforced)
currency-code   = 3UPPER

; 7. model-id — MODEL_ID_RE src/envelope.ts:29  /^[a-z][a-z0-9-]*$/
model-id        = lower *( lower / DIGIT / "-" )

; 8. capability-tag — CAPABILITY_TAG_RE src/patterns.ts:22
;    /^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/  runs of alnum joined by single "-";
;    LENGTH SIDE-CONDITION 2..64 chars. Co-owned with RFC-0002 (namespace.md states a looser rule).
capability-tag  = cap-head *( "-" cap-run )
cap-head        = lower *( lower / DIGIT )
cap-run         = 1*( lower / DIGIT )

; 9. base64-signature — BASE64_RE src/identity/types.ts:2  /^[A-Za-z0-9+/]+=*$/  + minLength 88.
;    FINDING: no max length, no length-mod-4 / canonical-padding check. Signature CONTENT and the
;    signing algorithm are DEFERRED to RFC-0004.
base64-signature = 1*base64-char *"="
base64-char     = ALPHA / DIGIT / "+" / "/"
```

## Appendix B. Test Vectors

Vectors live as JSON under `vectors` (`specs/vectors/envelope/`), split by the vector README's layout
into `valid.json` (inputs that MUST parse / resolve) and `invalid.json` (inputs that MUST be
rejected). Every vector carries a `why`. The delivered `valid.json` (reproduced in the RFC deliverable
alongside this document) holds the accept and actor-resolution vectors including the masking case
(`envelope/source-masking-prod-01`) and the divergence valids (`envelope/timestamp-out-of-range-accepted`,
`envelope/residency-unassigned-code`). The rejection, collision, and adversarial vectors are the
`invalid.json` set, reproduced here in full so nothing is lost:

```json
[
  { "id": "envelope/missing-sovereignty", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440100", "source": "metafactory.security.luna", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "missing-required-field" },
    "why": "Sovereignty travels with the message — its absence is a FAULT, not a default." },
  { "id": "envelope/source-four-segments", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440101", "source": "acme.monitor.prod.01", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "US", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "source-invalid" },
    "why": "BREAKING CUT myelin#183 — the loose 3-5 segment shape is rejected; source is fixed-3. docs/envelope.md:123 still prints {2,4}; the pilot review-loop bug class." },
  { "id": "envelope/source-two-segments", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440102", "source": "metafactory.pilot", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "source-invalid" },
    "why": "Fewer than 3 segments; the fixed-3 form requires principal.stack.assistant." },
  { "id": "envelope/distribution-broadcast", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440103", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "distribution_mode": "broadcast", "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "distribution-mode-invalid" },
    "why": "R11/#180 removed 'broadcast'. docs/envelope.md:30 AND the schema's own description (line 5) still claim it is accepted; the enum body governs and rejects it." },
  { "id": "envelope/stamp-principal-key", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440104", "source": "metafactory.security.luna", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "signed_by": [ { "method": "ed25519", "principal": "did:mf:andreas-meta-factory", "signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "at": "2026-05-11T14:33:00Z" } ], "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "myelin#182 R2 dropped signed_by[].principal; the canonical key is identity." },
  { "id": "envelope/originator-principal-key", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440105", "source": "metafactory.cortex.dispatch", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "originator": { "principal": "did:mf:mike", "attribution": "adapter-resolved" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "R2 dropped originator.principal; the actor-DID field is identity; originator is additionalProperties:false." },
  { "id": "envelope/target-principal-top-level", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440106", "source": "metafactory.cortex.dispatch", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "distribution_mode": "direct", "target_principal": "did:mf:luna", "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "R13 renamed target_principal -> target_assistant and removed the old key; top-level additionalProperties:false rejects it." },
  { "id": "envelope/direct-missing-target", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440107", "source": "metafactory.cortex.dispatch", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "distribution_mode": "direct", "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "target-assistant-required" },
    "why": "Cross-field rule: direct/delegate REQUIRE target_assistant." },
  { "id": "envelope/chain-too-long", "rfc": 3, "kind": "validateEnvelope",
    "input": "<17 ed25519 stamps; abbreviated — see specs/vectors/envelope/invalid.json for the full array>",
    "expect": { "ok": false, "reason": "chain-too-long" },
    "why": "MAX_CHAIN_LENGTH = 16 (schema maxItems:16 = identity/chain.ts:22); a 17-stamp chain is rejected. An unbounded chain is a DoS surface (RFC-0004)." },
  { "id": "envelope/unknown-top-field", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-446655440109", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "priority": "high", "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "Top-level additionalProperties:false — a closed contract. New metadata belongs in extensions or a new versioned field." },
  { "id": "envelope/sovereignty-extra-field", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-44665544010a", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only", "region": "emea" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "unknown-field" },
    "why": "The sovereignty block is additionalProperties:false with exactly five sub-fields." },
  { "id": "envelope/id-urn-prefix", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "id-invalid" },
    "why": "DIVERGENCE. myelin UUID_RE rejects the urn:uuid: prefix; cortex ajv-formats accepts it — valid at one hop, invalid at the next. OD-1. Pins the myelin reference." },
  { "id": "envelope/timestamp-lowercase", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-44665544010b", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11t14:33:00z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "timestamp-invalid" },
    "why": "DIVERGENCE / collision pair with valid envelope/timestamp-out-of-range-accepted. myelin (no /i) rejects lowercase t/z that RFC 3339 and cortex accept; the two stacks disagree in BOTH directions on a signable field. OD-2." },
  { "id": "envelope/max-hop-negative", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-44665544010c", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "federated", "data_residency": "CH", "max_hop": -1, "frontier_ok": false, "model_class": "local-only" }, "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "max-hop-invalid" },
    "why": "max_hop is a non-negative integer. It is a signable field with NO enforcement contract in myelin — a declaration whose enforcement is unwritten (§10)." },
  { "id": "envelope/payload-array", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-44665544010d", "source": "metafactory.pilot.local", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "payload": [1, 2, 3] },
    "expect": { "ok": false, "reason": "payload-invalid" },
    "why": "payload MUST be an object; the reference rejects arrays and null. It carries no size bound (§10)." },
  { "id": "envelope/signature-too-short", "rfc": 3, "kind": "validateEnvelope",
    "input": { "id": "550e8400-e29b-41d4-a716-44665544010e", "source": "metafactory.security.luna", "type": "code.pr.review", "timestamp": "2026-05-11T14:33:00Z", "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" }, "signed_by": [ { "method": "ed25519", "identity": "did:mf:andreas-meta-factory", "signature": "AAAA", "at": "2026-05-11T14:33:00Z" } ], "payload": { "pr": 50 } },
    "expect": { "ok": false, "reason": "signature-invalid" },
    "why": "Signature minLength 88. Counterpart finding (RFC-0004): no max length, no length%4 / canonical-padding check — malleability deferred." }
]
```

> The `envelope/chain-too-long` input is abbreviated above for readability; the committed
> `specs/vectors/envelope/invalid.json` carries the full 17-stamp array.

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes
ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes `schemas/envelope/v3` to a generated artifact; widens the charter to normatively own the signable/mutable boundary (§4) and `spec_version` semantics (§5). Records nine Open Decisions (uuid four-definitions, datetime two-semantics, size bounds, dead source stack segment, segment-alphabet/DID class collision, spec_version emission, shim retirement, shim-form actor defect, stale schema description). Ships a starter vector set with the source-masking case, the uuid/datetime collision pairs, and the shim-form actor defect-catcher. Directs correction of the schema's stale top-level `description` (broadcast/originator transition-form claims; the v1/v2 publication claim) on regeneration. |

## Acknowledgments

Grounded in the wire-protocol audit of the `envelope` dimension against myelin `origin/main`
(`schemas/envelope.schema.json`, `src/envelope.ts`, `src/uuid.ts`, `src/identity/canonicalize.ts`,
`src/patterns.ts`, `docs/envelope.md`) and cortex's consumer enforcement
(`src/bus/myelin/envelope-validator.ts`).

## Authors' Addresses

Luna, metafactory.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
