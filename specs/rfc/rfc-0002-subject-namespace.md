---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0002
title: Subject Namespace
status: Draft
category: Standards Track
obsoletes: []
updates: []
authors:
  - name: Luna (drafting agent, on behalf of the metafactory M3 working group)
    affiliation: metafactory
signatories: []
created: 2026-07-12
ratified: null
grammar: specs/grammar/subject-namespace.abnf
vectors: specs/vectors/subject-namespace/
generated:
  - src/segment-validators.ts        # STACK_SEGMENT_REGEX (segment / stack / principal)
  - src/patterns.ts                  # CAPABILITY_TAG_RE, PRINCIPAL_RE
  - src/subject-vocabulary.ts         # verdictSubject (review.verdict.*, D12), lifecycle enum (dispatched, D14)
  - schemas/envelope.schema.json      # source, type, target_assistant patterns (co-owned RFC-0003)
crossRefs:                           # sibling RFCs this document references (REVISIONS C10)
  - "0001"                           # identifier terminals; @-segment co-owner; atomic hard-cut coupling (§5, §8.2)
  - "0003"                           # envelope fields consumed by the §8 derivation; source authority (D6/D7) co-filed
  - "0004"                           # the subject is NOT signed — the signed representation governs (D6/D7, §8.1)
  - "0005"                           # sovereignty enforcement-NAKs fold under `_audit.sovereignty.*` (§9, D21)
  - "0007"                           # `_INBOX.` admitted by reference (§9, §10, D22); TASKS_DEAD filter alignment (D17)
  - "0008"                           # normative owner of the capability-id grammar; subject-safe charset constraint (§8.5, D15)
  - "bcp-0001"                       # legacy-form retirement window / release naming (§8.2, D17)
supersedes_prose:
  - specs/namespace.md
---

# RFC-0002: Subject Namespace

## Abstract

This document specifies the NATS subject namespace of the myelin wire protocol — the
dot-segmented address space over which every M3 envelope is routed. It defines the three
classification prefixes (`local.`, `federated.`, `public.`), the
`{principal}.{stack}.{domain}.{entity}.{action}` segment grammar, the per-segment character set
and length bounds, the restricted wildcard rules for subscription patterns, the reserved `_`-space
prefixes and segments, the full-DID-encoded `@`-assistant address used by the `tasks` domain, the
`tasks` offer / direct / delegate / dead-letter / bid-request shapes and their JetStream stream,
the canonical `review.verdict.*` / `dispatch.*` / `brain.*` domain shapes, and the deterministic
derivation of a subject from an envelope's fields. Syntax is given as ABNF; conformance is decided
by test vectors, not by reading. The document records — as findings, not as design — the points
where an invariant is held by a runtime check rather than by the format, and the several places
where the grammar is transcribed inconsistently across the source tree. The encoding ambiguities
the initial draft proved against the deployed flat identifier form are resolved at the identifier
layer by the class-explicit dot-form (RFC-0001, ratified single-principal per ADR-0001), which
takes effect at a single coordinated flag-day cut; the subject-level short-form question that
decision deferred is resolved here — the federated Direct/Delegate `@`-segment carries the **whole**
class-explicit agent DID (a blocking recipient-security gate), exempt from the per-segment length
cap. The authority of the unsigned subject stack segment is likewise resolved: the signed
representation governs (signed-wins), never the subject bytes.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations
MUST NOT ground behaviour on a `Draft` or `Proposed` document.

This document is **ratifiable single-principal** under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md): while myelin is the only
implementation and no federated peer is live, the principal (Andreas) alone ratifies. The principal
ratifies separately; this authoring pass leaves the status at `Draft`.

Ratification (v1) requires the signature of **the principal** (Andreas) alone, recorded in
`signatories` (ADR-0001). The full two-signature act (principal + hub custodian) is **suspended,
not deleted**: it reinstates the moment the wire binds a party we do not control — a second
independent implementation, or a live federated peer principal. Under ADR-0001 a `Ratified` RFC is
a **living spec**: the immutable-once-`Ratified` discipline (changes shipped only as a new RFC
carrying `Updates: NNNN` or `Obsoletes: NNNN`) is the reinstate-target that returns with the
two-signature rule.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
2. Subject Structure
3. Segment Grammar
4. Wildcards and Subscription Patterns
5. Assistant-Address Segments
6. The `tasks` Domain
7. Dispatch-Observability, Verdict, Brain, and Bid-Request Families
8. Composing a Subject from Envelope Fields
9. Reserved Prefixes and Segments
10. Registry Considerations
11. Security Considerations
12. Privacy Considerations
13. Conformance
14. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

The myelin NATS subject namespace **is** the routing architecture of the metafactory bus. A
signal's maximum scope, its owning principal, its stack, its functional domain, and — for the
`tasks` domain — its target assistant are all carried in the subject string itself, so that
brokers, JetStream consumers, audit pipelines, and federation routers can make every routing
decision from the wire address without inspecting the payload.

This document promotes the informative convention document
[`specs/namespace.md`](../namespace.md) (Version 1.0.0, Status: Draft, Feature MY-101) to a
normative RFC and supplies the ABNF grammar and conformance vectors that document has lacked. It
lists `specs/namespace.md` in `supersedes_prose`; on ratification that document becomes
informative background and this RFC governs.

### 1.1. What this document specifies

- The three classification prefixes (the closed set `{ local, federated, public }`) and their
  scope semantics (§2).
- The generic segment grammar, the principal / stack / type positions, the domain slot's
  open-with-reserved-roots rule, and the stack-mandating terminal grammar with its transitional
  legacy form (§3).
- Restricted wildcard semantics for subscription patterns (anchored under a literal classification;
  no cross-scope or reserved-space wildcard) and the fully-qualified rule for published subjects (§4).
- The `@`-prefixed assistant-address segment, which carries the **whole** class-explicit agent DID
  (co-owned with RFC-0001) and is exempt from the per-segment length cap (§5).
- The `tasks` domain — the position-4 closed tagged union (offer capability, direct/delegate
  `@`-address, `dead-letter`, `bid-request`); the capability tag; the `TASKS` JetStream stream
  shape (§6).
- The dispatch-observability, `review.verdict.*`, `brain.*`, and bid-request subject shapes (§7).
- The deterministic derivation of a subject from an envelope's fields, and signed-wins source
  authority over the unsigned subject stack segment (§8).
- The reserved `_`-space prefixes and segments (§9, §10).

### 1.2. What this document does not specify

- **Identifier terminals.** The alphabets `lower`, `principal-id`, `stack-slug`, `did`, and
  `method-specific-id` (the ratified class-explicit dot-form, which supersedes the former
  `did-msi-deployed`) are defined once in RFC-0001 [RFC-0001] and referenced here, never
  redefined (grammar/README.md rule 5).
- **The envelope.** Field shapes (`source`, `type`, `target_assistant`, `distribution_mode`,
  `sovereignty.classification`) that §8's derivation consumes are owned by RFC-0003 [RFC-0003].
  This document references them.
- **JetStream provisioning and consumer lifecycle.** §6.4 states the `TASKS` stream *shape* as a
  wire contract; the concrete provisioning and the consumer-creation/teardown lifecycle live in
  the M7 consumer (cortex) per `docs/design-agent-task-routing.md` Decision Q2, and are out of
  scope here.
- **The capability *taxonomy*.** This document specifies the subject-position capability *tag
  grammar* (§6.3) and owns the *projection* of a `capability-id` into the `tasks` slot (§8.5); the
  compound `capability-id` grammar, the set of registered capabilities, and their cross-repository
  reconciliation are normatively owned by RFC-0008 [RFC-0008]. Per D15, RFC-0008 MUST constrain the
  `capability-id` charset to be subject-safe (charset ∩ `segment`) so the projection is 1:1; this
  document references that constraint, it does not transcribe the `capability-id` grammar (§8.5).
- **The dispatch-observability enum vocabularies.** This document owns the *shapes* of the
  `dispatch.*` families (§7); the closed enum vocabularies (`LifecycleState`,
  `BidLifecycleEventType`, `WorkflowLifecycleEventType`) are homed in a future
  dispatch-observability RFC, referenced here, not enumerated normatively.

### 1.3. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as
described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown
here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text or a transcribed defect
> as a requirement.

### 1.4. Terminology

| Term | Definition |
|---|---|
| **subject** | A dot-separated NATS address. Every myelin subject begins with one of the three classification prefixes. |
| **segment** | One dot-delimited token of a subject. Its grammar is byte-identical to RFC-0001 `stack-slug` (§3.1). |
| **prefix / classification** | The first segment: `local`, `federated`, or `public`. Runtime set `CLASSIFICATION_VALUES` (`src/classifications.ts`). |
| **principal segment** | The owning-principal token (segment position 2 of `local.`/`federated.` subjects). Distinct from RFC-0001 `principal-id` — see §7.2. |
| **stack segment** | The per-deployment token identifying a stack under the principal. |
| **type tail** | The `{domain}.{entity}.{action}` remainder, equal to the envelope `type` field. |
| **published subject** | A fully-qualified subject a publisher emits. Carries no wildcard (§4). |
| **subscription pattern** | A subject that MAY carry `*` / `>` wildcards, used only to subscribe. Anchored under a literal classification; no cross-scope or reserved-space wildcard (§4). |
| **terminal / stack-aware form** | A 6-segment `local./federated.` subject with an explicit stack segment. The terminal grammar mandates it (§3.3). |
| **legacy form** | A 5-segment `local./federated.` subject with the stack segment omitted. A **transitional** migration form whose removal is the retirement (§3.3, §8.2; BCP-0001 owns the window). |
| **domain slot / reserved root** | The first `type` segment. Open, except the closed set of reserved roots (`tasks`, `dispatch`, `review`, `code`, `brain`, `_metrics`) that carry normative shapes and fail closed against application misuse (§3, §9). |
| **capability tag** | A `tasks`-domain position-4 token naming a routed capability (§6.3). |
| **assistant address** | The `@`-prefixed segment carrying the **whole** class-explicit agent DID, routing a Direct/Delegate task to one assistant; a blocking recipient-security gate, exempt from the per-segment cap (§5). |
| **dead-letter / bid-request** | Reserved `tasks` position-4 tags (escalation; bid-request); members of the position-4 tagged union that a capability tag MUST NOT match (§6.2, §6.3). |
| **reserved subject / `_`-space** | A first-class subject whose leading `_` marks it structural/infrastructure. An application publisher MUST NOT emit it; it is uppercase-exempt from the app segment rules (§9). |
| **receiver-addressed / source-addressed** | Federation addressing conventions, per the closed per-domain table (dispatch = receiver-addressed; presence/`agent.>` = source-addressed; verdict/bid = source-addressed default) (§8.4). |
| **signed-wins** | The unsigned subject stack segment is never authoritative; the signed representation (RFC-0003 `source` / receiver context, RFC-0004) governs (§8.1, §8.4). |
| **DID / method-specific-id** | Defined in RFC-0001. Referenced here for the `@`-segment encoding. |

---

## 2. Subject Structure

Every published myelin subject begins with exactly one classification prefix. The prefix
determines the signal's maximum scope.

| Prefix | Scope | Sovereignty rule |
|---|---|---|
| `local.` | MUST NOT leave the principal boundary — enforced at the NATS leaf node, which does not replicate `local.>` | Not applicable |
| `federated.` | MAY cross principal boundaries | Subject to the envelope `sovereignty` block (RFC-0003) |
| `public.` | Unrestricted | None applied |

The classification prefix set is exactly `{ local, federated, public }` — a **closed** set (D10);
adding a fourth prefix is a wire change requiring a new RFC. The prefix MUST match the envelope's
`sovereignty.classification` (§8.3). A subject whose first segment is none of these three (and is
not a reserved `_`-prefix, §9) is malformed and MUST be rejected (vector
`scope/reject-unknown-prefix`).

The three top-level shapes are:

```
local.{principal}.{stack}.{domain}.{entity}.{action}
federated.{principal}.{stack}.{domain}.{entity}.{action}
public.{domain}.{entity}.{action}
```

A `public.` subject carries **neither** a principal **nor** a stack segment: principals are the
unit of ownership and stacks are scoped to a principal, so a non-principal-scoped signal has no
place to put either. A `public.` subject is therefore `public.` followed directly by the type
tail.

Because a `public.` subject carries no principal segment, it is **unattributed on the wire** (D10).
The origin of a `public.` signal is established **only** by the verified `signed_by` chain
(RFC-0003 / RFC-0004), **never** by the subject — the subject cannot name an owner it has no
segment for. A receiver MUST NOT infer origin from a `public.` subject's bytes (§8.3, vector
`scope/accept-public-no-identity`).

---

## 3. Segment Grammar

### 3.1. The generic segment

Every positional segment of a subject — principal, stack, domain, entity, action — is validated
against a single grammar. Its character set is lowercase alphanumeric plus hyphen; it MUST start
with a letter; it is 1 to 63 characters long.

```abnf
segment = stack-slug   ; RFC-0001 (deployed transcription /^[a-z][a-z0-9-]{0,62}$/;
                       ; tightens to kebab-strict at flag-day R)
```

This is byte-identical to the deployed STACK_SEGMENT_REGEX (`src/segment-validators.ts:27`)
transcription of RFC-0001 `stack-slug` and is referenced, not redefined. A **trailing** hyphen is
permitted by the deployed regex but is **retracted** by RFC-0001's ratified kebab-strict
`segment` rule (no trailing `-`, no `--`, no `_`); STACK_SEGMENT_REGEX is tightened onto
kebab-strict at flag-day R (RFC-0001 §3.2, §9), which also collapses the trailing-hyphen
divergence with `principal-id` recorded in §7.2.

The total encoded length of a published subject MUST NOT exceed 255 octets. This ceiling is
**not** expressed in the ABNF and, as of this writing, is enforced by no runtime check anywhere in
the reference implementation (§7.6); conformance is decided by vector `length/reject-over-255`.

The 1-to-63-octet **per-segment** cap has exactly **one** exemption: the Direct/Delegate
assistant-address `@`-segment (§5). Because that segment carries the whole class-explicit agent DID
(D1) — a full encoded agent method-specific-id approaches ~208 octets — it is EXEMPT from the
per-segment 63 cap (D2) and is bound **only** by the 255-octet total-subject budget and by
RFC-0001's per-**inner**-msi-segment 63 cap. Every other positional segment is bound by the 63 cap
(vectors `segment/reject-over-63`, `atsegment/exempt-from-63-cap`,
`atsegment/inner-msi-segment-over-63`).

Case: subjects are always lowercase. A subject containing an uppercase letter is malformed. The
reference `_metrics` emitter violates this (§7.7).

### 3.2. Principal, stack, and type positions

```abnf
principal-body = principal "." [ stack "." ] type
principal      = segment
stack          = stack-slug
type           = tasks-type / dispatch-type / verdict-type / brain-type
               / metrics-type / generic-type       ; reserved-root shapes wired
                                                    ; in so the "@"-address and
                                                    ; "_metrics" are derivable
generic-type   = segment *( "." segment )
```

The `principal` position is validated as a generic `segment`, **not** as RFC-0001 `principal-id`,
at every derivation site in the reference implementation. This is a faithful transcription of the
deployed behaviour and a recorded finding (§7.2): the subject-plane principal and the
identity-plane `principal-id` do not enforce the same string set.

The generic `type` tail (`generic-type`) carries 1 or more segments in the pure-string derivation
helpers. The reference envelope `type` schema (RFC-0003) bounds it at 2 to 5 segments; a conformant
emitter SHOULD emit a `type` of 2 to 5 segments. The subject helpers do not enforce that bound
(§7.6).

**The domain slot is open-with-reserved-roots (D11).** The first `type` segment is the *domain*.
Any generic `segment` is a legal domain **except** the closed set of reserved roots — `tasks`,
`dispatch`, `review`, `code`, `brain`, `_metrics` — which carry normative subject shapes and/or
JetStream partitions (§6, §7, §9) and **fail closed against application misuse**: a subject whose
domain is a reserved root MUST conform to that root's shape, and an application publisher MUST NOT
emit an off-shape subject under it (vector `domain/reject-app-misuse-dispatch`). The slot **itself**
is not closeable across the M7 surface layer; new non-reserved domains do not require an RFC. The
reserved-root set is a closed table amended only by an `Updates:` RFC (§9, §10, D23). A `segment` is
byte-blind to this constraint (ABNF cannot express "any segment that is not one of these
literals"), so it is a **semantic** rule, vector-enforced (`domain/accept-open-root`,
`domain/accept-tasks-offer`, `domain/accept-review-verdict`, `domain/accept-brain-root`).

### 3.3. The terminal grammar mandates the stack segment; the legacy form is transitional

The **terminal** grammar of a `local.`/`federated.` subject MANDATES the stack segment (D17):

```
terminal / stack-aware (6-segment): {prefix}.{principal}.{stack}.{type…}
```

The `[ stack "." ]` optionality in the `principal-body` rule is **transitional only**. Its
**removal is the legacy-form retirement** — once removed, the wire form is a fixed 6+-segment shape
and is **self-decidable by construction**. BCP-0001 owns the retirement window (§8.2); this
document owns the terminal grammar and the accept/reject rule.

During the transitional window a second wire form exists:

- **legacy** (5-segment): `{prefix}.{principal}.{type…}` — the stack segment omitted.

Because `type` is itself multi-segment, **the two transitional forms are not distinguishable from
the subject bytes alone.** `local.acme.default.tasks.chat` parses equally as stack-aware
(`stack=default`, `type=tasks.chat`) or legacy (`type=default.tasks.chat`). The reference
classifier `detectSubjectForm` resolves the ambiguity only via an out-of-band hint (a
caller-supplied stack identity or the envelope `type`) and otherwise defaults to `legacy`. This
transitional undecidability is a **finding**, recorded in Security Considerations §7.5 — and it is
the reason the terminal grammar mandates the stack: the ambiguity is engineered out by construction
at retirement, not papered over with a wire marker.

**Reject is MUST-not-emit at every derivation entry point (D18).** An emitter MUST NOT emit a
stack-absent subject except under an explicit legacy opt-in (`legacy: true` / the equivalent
positional call); the legacy-vs-stack-aware choice is **never made silently**. The reference
front door `subjectFor` already throws on an absent-stack, non-opt-in call
(`src/subjects.ts:673`), but the lower-level primitive `deriveSubject` silently emits the legacy
form (`:622`) — a primitive gap that MUST be closed so the reject holds at **every** entry point,
not only the ergonomic one (vector `legacy/reject-silent-stackless-emit`; contrast
`subject/derive-legacy-stackless`, the explicit opt-in). Stack-bound receivers reject a
malformed-scope subject via NATS subject matching; wildcard and audit consumers, which match
positionally, cannot, which is why the emit-side reject is load-bearing.

---

## 4. Wildcards and Subscription Patterns

NATS wildcard semantics apply to **subscription patterns only**:

- `*` matches exactly one segment.
- `>` matches one or more trailing segments and MUST be the final token of the pattern.

Wildcard reach is **restricted** (D24), and the restriction is security-first — the grammar
**cannot express** a cross-scope or a reserved-space wildcard, rather than expressing one and
denying it at runtime. Every subscription pattern is **anchored under a literal classification**:

```abnf
sub-pattern    = classification "." scope-sub-body
scope-sub-body = ( sub-token *( "." sub-token ) [ "." ">" ] ) / ">"
sub-token      = segment / assistant-address / reserved-segment / "*"
```

Two consequences follow, and both are normative:

- **The classification position can be NEITHER `*` NOR `>`.** It MUST be a literal `local` /
  `federated` / `public`. A bare `>` (which would span all three scopes and the `_`-space) and a
  `*`-in-the-classification pattern are not expressible and MUST be rejected (vectors
  `sub/reject-bare-arrow`, `sub/reject-wildcard-classification`).
- **A `>` tail cannot cross the scope boundary, nor descend into the `_`-space.** A `>` lives under
  exactly one classification, so it can never reach a sibling scope; and the top-level `_`-space is
  a **sibling** of the classifications, reachable only via `reserved-subject` (§9), never from a
  `sub-pattern`. A pattern like `_audit.>` is therefore not an application subscription pattern at
  all and MUST be rejected (vector `sub/reject-reserved-space-wildcard`). A **within-scope**
  reserved *domain* segment (e.g. `local.{p}.{s}._metrics.>`) IS reachable — `_metrics` is a
  `sub-token`, distinct from the top-level `_`-prefix space.

The reference matcher (`src/subject-matching.ts:32-51`) compiles `>` to a one-or-more-trailing
match and `*` to a single-segment match, and escapes literal tokens.

A **published** subject (the `subject` rule, Appendix A) MUST be fully qualified and MUST NOT
contain a `*` or `>` token. The derivation helpers `taskSubject`, `offerTaskSubject`,
`verdictSubject`, and their siblings enforce this at the call site by validating each segment
(rejecting `*`, `>`, and embedded dots). The lower-level `deriveSubject` and the ergonomic front
door `subjectFor` do **not** — passing `principal = "*"` yields `local.*.{type}` with no error.
That is a finding (§7.3), not a permitted behaviour; vector
`published/reject-wildcard-principal` binds the requirement.

A note on offer reachability: because `>` matches one **or more** tokens, a 4-segment
`taskSubject(principal, capability)` (no sub-capability) is unreachable from an
`offerTaskSubject(principal, capability)` subscription `…tasks.{capability}.>`. The distinction
between a terminal direct subject and an offer-reachable subject is encoded purely in segment
count (vectors `sub/offer-reachability-positive` reaches a sub-capability;
`sub/offer-reachability-terminal-unreachable` shows the terminal subject is not matched; the
`TASKS` stream filter's positive half is `sub/accept-tasks-stream-filter`).

---

## 5. Assistant-Address Segments

The `tasks` domain routes a Direct/Delegate task to a single assistant by encoding the
assistant's DID into one subject segment. The segment begins with `@`, which the grammar permits
**only** as the first character of a segment.

**The `@`-segment carries the WHOLE class-explicit agent DID (D1).** It is
`@did-mf-agent--{principal}--{stack}--{assistant}` — the entire class-explicit agent DID of
RFC-0001, *repeating* the `{principal}.{stack}` pair the subject already carries. It is **not** a
prefix-relative projection of just the `{assistant}` under the subject's own `{principal}.{stack}`.
This is a deliberate decision with a security rationale, not a redundancy:

- **It is a blocking recipient-security gate, not a label.** The receiver byte-compares this whole
  segment against `encodeDidSegment(target_assistant)` and **hard-drops the task on mismatch**
  (`validateCanonicalTaskRecipient`, `dispatch-listener.ts:2399-2439`). The comparison is over the
  whole DID; a projection would compare a different string and could not serve the gate (vectors
  `recipient/full-did-match`, `recipient/full-did-mismatch`).
- **It is zero-code-delta.** The deployed publisher already builds the whole DID; full-DID matches
  what ships. A projection would require net-new encode/decode machinery (D4 — no
  `decodeAssistantProjection` is needed because there is no projection).
- **It stays coherent on the legacy-stackless intermediate and serves every DID class (D5, D3).**
  A projection is unsound where the subject has no stack segment (it would reintroduce a fabricated
  stack on an identity-bearing segment — the cortex#1812 class) and cannot address a non-agent
  class. The full DID carries its own `{principal}.{stack}` home and needs nothing fabricated.

**Home-binding invariant (D3).** An agent-class `@`-address is an agent DID whose
`{principal}.{stack}` home MUST equal the subject's own principal and stack segments. This codifies
the agent-class + home-binding invariant and aligns with RFC-0001's anti-impersonation agent-prefix
binding. It is a **semantic** constraint (ABNF cannot express the cross-segment equality); a
receiver enforcing the recipient gate above enforces it transitively.

The segment is **always** the output of `encodeDidSegment(did)` applied to a class-explicit agent
`did` (RFC-0001) — never a free-form display name. The encoding (`src/subjects.ts:124-129`;
`specs/namespace.md` §"Assistant encoding") is:

| DID source character | Encoded as |
|---|---|
| `:` (the `did:mf:` separators) | `-` |
| `.` (inside the method-specific-id) | `--` |
| `-` (inside the method-specific-id) | `-` (preserved) |
| `[a-z0-9]` | passthrough |

From flag-day release R the `did` so encoded is the **class-explicit dot-form** of RFC-0001 §6.2,
so the class tag and every segment ride into the subject with each `.` doubled to `--`:
`did:mf:agent.andreas.meta-factory.luna` → `@did-mf-agent--andreas--meta-factory--luna`
(vector `encode/agent-dotform-subject`); `did:mf:hub.metafactory` → `@did-mf-hub--metafactory`. The
legacy flat forms (`did:mf:forge` → `@did-mf-forge`; `did:mf:hub-metafactory` →
`@did-mf-hub-metafactory`) are rejected at parse from R (RFC-0001 vector `inv/legacy-classless`);
their pre-cut encode vectors are retained only to pin the pre-cut byte-behaviour (§Appendix B).

**OD-1 is RESOLVED by RFC-0001** (class-explicit dot-form + kebab-strict, ratified single-principal
2026-07-13 under ADR-0001; cortex#1880). The injective, charset-clean grammar this decision was
blocked on is recorded in RFC-0001 §6.2. Under it the encoding **is** injective — but the property
MUST be cited with its precondition: it is the **kebab-strict segment rule** (no segment starts or
ends with `-`, so `-` is never adjacent to `.` in a valid DID), NOT dot-separation alone, that
guarantees every `--` decodes to `.` and nothing else. The bare "`.` → injective" claim is the
false claim the initial draft caught; do not cite it. `decodeDidSegment` (split the encoded msi on
`--`, rejoin with `.`) is specified as the one normative decoder by RFC-0001 §5, and round-trips
the whole subject-plane DID (vector `decode/agent-dotform-subject`: the single `-` inside
`meta-factory` is not a separator).

The initial draft recorded three findings (§7.4) against the deployed flat grammar, transcribed
here for the record; their dispositions under the resolved grammar are:

1. `did:mf:a-.b` and `did:mf:a.-b` both encoded to `@did-mf-a---b` — non-injective. **Closed at
   R**: both inputs are unmintable under kebab-strict (segment-edge hyphens are rejected).
   (Vectors `encode/noninjective-dashdot`, `encode/noninjective-dotdash` pin the pre-cut defect.)
2. A `_`-bearing method-specific-id leaked `_` into a segment whose charset forbids it. **Closed
   at R**: kebab-strict forbids `_` entirely (RFC-0001 vector `inv/underscore`).
3. `encodeDidSegment` applied no length bound. **Closed at the identifier level** by RFC-0001
   §6.2 (inner segments 1–63 octets, msi ≤ 255, whole DID ≤ 262); the **subject-level** residue —
   an encoded `@`-segment that exceeds the 63-octet per-segment cap and inflates the 255-octet
   subject budget — is **resolved here (D2)**: the `@`-segment is EXEMPT from the per-segment 63
   cap (a full encoded agent msi approaches ~208 octets; worst-case federated Direct subjects reach
   ~208 octets, which NATS handles) and is bound only by the 255-octet total-subject budget and by
   RFC-0001's per-inner-msi-segment 63 cap. The per-**inner**-msi cap still binds
   (`atsegment/inner-msi-segment-over-63`); only the whole `@`-segment is exempt
   (`atsegment/exempt-from-63-cap`).

**Atomic coupling (hard cut).** The envelope-field DID and the subject `@`-segment derive from
this ONE source (`src/subjects.ts:124`); they are never composed independently, and they flip
**together** at flag-day release R (RFC-0001 §9): RFC-0001 and this document cut over atomically,
per emitter, and MUST NOT be sequenced independently. There is NO dual-accept window and NO
dual-registration for the DID migration; BCP-0001's dual-accept doctrine remains the default for
other wire changes only.

**The `@`-segment short-form question (inherited from RFC-0001 §5) is RESOLVED: full DID (D1),
exempt from the per-segment cap (D2).** A fully-qualified agent DID double-encoded into a federated
subject — `federated.{p}.{s}.tasks.@did-mf-agent--{p}--{s}--{assistant}.{capability}` — repeats the
`{principal}.{stack}` pair the subject already carries and, at the structural maximum, approaches
~208 octets. The alternative considered — a prefix-relative projection encoding only `{assistant}`
under the subject's own `{principal}.{stack}` — is **rejected**: the `@`-segment is a blocking
recipient-security gate byte-compared against the whole `encodeDidSegment(target_assistant)`, so a
projection would break the gate; it is unsound on the legacy-stackless intermediate; and it cannot
serve non-agent classes (see the rationale at the head of this section, D1/D3/D4/D5). The length
cost is accepted and handled by exempting the `@`-segment from the 63-octet per-segment cap and
binding it to the 255-octet total-subject budget (D2, §3.1).

```abnf
assistant-address = did-subject-segment      ; RFC-0001 (from flag-day R); referenced, not redefined.
                  ; Carries the WHOLE class-explicit agent DID (D1); EXEMPT from the 63-octet
                  ; per-segment cap (D2), bound only by 255-total / per-inner-msi 63.
                  ; pre-cut transcription, retired at R (its "_" alt was the transcribed leak, §7.4):
                  ; "@" %s"did-mf-" 1*( lower / DIGIT / "-" / "_" )
```

The `_` alternative in the retired pre-cut rule was the faithful transcription of the leak in
finding §7.4, never an endorsement of `_` in a subject segment; from R it is unproducible.

---

## 6. The `tasks` Domain

The `tasks` domain carries capability-routed work. Tasks are competing-consumer envelopes claimed
by qualified agents from the `TASKS` JetStream stream.

### 6.1. Position-4 is a closed tagged union

The segment immediately after `tasks.` (position 4) is a **closed tagged union (D16)**: exactly one
of an Offer `capability`, a Direct/Delegate `@`-address, the reserved `dead-letter` tag, or the
reserved `bid-request` tag. No fifth alternant is admissible without an `Updates:` RFC.

```
local.{principal}.{stack}.tasks.{capability}[.{subcapability}]   ; Offer
local.{principal}.{stack}.tasks.@{did}.{capability}             ; Direct / Delegate (full DID, §5)
local.{principal}.{stack}.tasks.dead-letter.{capability}        ; dead-letter (reserved)
local.{principal}.{stack}.tasks.bid-request.{capability}        ; bid-request (reserved, §7)
```

The `federated.` prefix mirrors all four shapes with identical grammar. A federated `tasks`
subject is subject to the envelope sovereignty rules (RFC-0003): an agent originating from
principal A MUST NOT inherit principal B's identity scope when claiming work on B's
`federated.…tasks.>` tree.

```abnf
tasks-type       = offer-type / direct-type / dead-letter-type / bid-request-type
offer-type       = %s"tasks." capability *( "." segment )
direct-type      = %s"tasks." assistant-address "." capability
dead-letter-type = %s"tasks.dead-letter." capability
bid-request-type = %s"tasks.bid-request." capability   ; REGISTERED (D16; closes the former OD-5)
```

- **Offer** — competing consumers. Any qualified agent in the matching consumer group MAY claim.
  The position-4 tag is a `capability` (§6.3); the canonical free-form conversational capability is
  `chat` (`local.{principal}.{stack}.tasks.chat`).
- **Direct / Delegate** — named recipient. The `@{did}` segment is the whole-DID address of §5.
  Direct and Delegate share the wire shape; the difference (Delegate's recipient internally
  orchestrates a multi-step outcome and emits the dispatch lifecycle stream of §7) is
  principal-facing, not wire-visible.
- **dead-letter** — escalation for tasks that exhaust `max_deliver` or hit a compliance-block NAK
  (§6.2). A **reserved** position-4 tag: a capability MUST NOT equal it (§6.2).
- **bid-request** — the bidding-lifecycle request (§7). A **reserved** position-4 tag, now
  registered (D16): a capability MUST NOT equal it (§6.2).

### 6.2. Reserved `tasks` segments

Three segment classes at position 4 of a `tasks` subject are reserved, and a capability tag MUST
NOT match any of them (they are the non-capability alternants of the position-4 tagged union, §6.1):

| Pattern | Meaning |
|---|---|
| any segment starting with `@` | a Direct/Delegate assistant address (§5) |
| the literal `dead-letter` | the escalation path |
| the literal `bid-request` | the bidding-lifecycle request (§7) — **registered (D16)** |

The `@` reservation is enforced structurally (a capability tag starts with `[a-z]`, never `@`).
The `dead-letter` and `bid-request` reservations are **not** enforced in code: both match the
capability grammar, and no publish-time validator rejects them, so an ordinary publisher can
fabricate a subject indistinguishable from a genuine escalation or bid-request. That is a finding
(§7.3); vectors `capability/reject-dead-letter` and `tasks/reject-capability-equals-bid-request`
bind the intended fail-closed rejection. `bid-request` was formerly a de-facto reserved segment the
table omitted (the old OD-5); D16 **registers** it, closing that gap.

### 6.3. The capability tag

The strict capability grammar is CAPABILITY_TAG_RE (`src/patterns.ts:21`): 2 to 64 characters,
first a letter, last alphanumeric, no consecutive and no trailing hyphen.

```abnf
capability = lower ( 1*alnum *( "-" alnum-run ) / 1*( "-" alnum-run ) )
alnum-run  = 1*alnum
alnum      = lower / DIGIT
```

This grammar is enforced by the bidding builders (`bidRequestSubject`, `bidAssignmentSubject`) and
by the envelope `requirements` schema (RFC-0003). It is **not** the only capability grammar in
force: the offer/task builders validate the capability position as a generic `segment` or
segment-path (looser — 1-character and trailing-hyphen tags pass), and `specs/namespace.md:318`
states a third, still-looser grammar (`^[a-z][a-z0-9-]*$`, max 64, admitting 1-character,
trailing-hyphen, and `--` tags). Three grammars validate one wire position depending on which
builder runs. This is a finding (§7.1); the ABNF above states the strict form, and vectors
`capability/reject-single-char` and `capability/reject-trailing-hyphen` bind it.

**Capability-id projection (D15).** A `capability-id` — normatively owned by RFC-0008 — **projects**
into this `tasks` position-4 slot, and RFC-0002 owns that projection. For the projection to be 1:1,
RFC-0008 MUST constrain the `capability-id` charset to be **subject-safe** — its charset ∩
`segment` — so that a projected id is a valid `capability` here. This is the deliberate resolution
of the `_` incompatibility: rather than inventing a subject-side encoder for dotted/underscore-bearing
ids, the id itself is constrained at its owning layer (§8.5, vectors `seam/capability-id-not-subject-tag`,
`seam/capability-id-subject-safe-projects`). A dotted or underscore-bearing id is **not** expressible
here.

The seed taxonomy (`code-review`, `security-scan`, `deploy`, `release`, `chat`) is informative;
principals MAY extend it. The registered capability set and its cross-repository reconciliation are
owned by RFC-0008 (§8.5).

### 6.4. The `TASKS` JetStream stream shape

The `TASKS` stream carries every task envelope across local and federated `tasks` subjects. Its
wire-relevant shape is a contract:

```
name       = "TASKS"
subjects   = [ "local.*.*.tasks.>", "federated.*.*.tasks.>" ]
retention  = Limits
max_age    = 7 days
storage    = File
replicas   = 3 (production); 1 permitted for single-principal / dev
discard    = Old
```

The `subjects` filter `local.*.*.tasks.>` binds the **stack-aware** 6-segment shape
(`{principal}.{stack}.tasks.>`), which is exactly why the terminal grammar mandates the stack (§3.3,
D17): a **legacy** 5-segment `tasks` publish (`local.{principal}.tasks.>`) does not match this filter
positionally and would silently miss the stream. Emitters targeting the stream MUST publish the
stack-aware shape (the non-opt-in reject of §8.2/D18 enforces this on the emit side; the `brain.>`
stream is disjoint per §7/D13). Stream provisioning and consumer lifecycle are M7-owned and out of
scope (§1.2).

### 6.5. The Direct/Delegate derivation gap

`specs/namespace.md` §"Tasks-domain derivation extension" declares an authoritative extended
derivation: `target_assistant` supplies the `@{assistant}` segment (DID-encoded) and
`distribution_mode` selects Offer vs Direct/Delegate. **No reference derivation function consumes
`target_assistant` or `distribution_mode`** — `deriveNatsSubject` implements only the standard
composition, and Direct subjects are built via the separate `directTaskSubject` /
`bidAssignmentSubject` helpers, which validate a single capability tag and so cannot construct the
compound-capability Direct subject the extension permits. The extension has no single canonical
implementation. This is a finding (§7.1); §8.4 states the derivation normatively.

---

## 7. Dispatch-Observability, Verdict, Brain, and Bid-Request Families

These subject families live only in `src/subjects.ts` + `src/subject-vocabulary.ts` and the
informative `docs/design-agent-task-routing.md`. This document **absorbs their subject shapes**:

```abnf
dispatch-type    = %s"dispatch.task." lifecycle-state
                 / %s"dispatch.bid." bid-event
                 / %s"dispatch." workflow-event
verdict-type     = %s"review.verdict." verdict-kind "." verdict-status   ; CANONICAL (D12)
brain-type       = %s"brain." segment *( "." segment )                    ; (D13)
bid-request-type = %s"tasks.bid-request." capability                      ; REGISTERED (D16)
lifecycle-state  = %s"received" / %s"dispatched" / %s"started"
                 / %s"completed" / %s"aborted" / %s"failed"
                 / %s"progress" / %s"rejected"
```

- `local.{principal}.{stack}.dispatch.task.{state}` — task lifecycle. The **canonical lifecycle is
  received → dispatched → started → completed → aborted/failed (D14)**; `progress` and `rejected`
  are additional deployed tokens absorbed as shape.
- `local.{principal}.{stack}.dispatch.bid.{event}` — bidding lifecycle,
  `event` ∈ {bid-opened, bid-received, bid-closed, bid-retry, bid-assigned}.
- `local.{principal}.{stack}.dispatch.workflow.*` — workflow lifecycle, 9 events.
- `local.{principal}.{stack}.review.verdict.{kind}.{status}` — **PR verdicts, canonical (D12)**.
- `local.{principal}.{stack}.brain.{…}` — the **memory plane (D13)**.
- `local.{principal}.{stack}.tasks.bid-request.{capability}` — bid request.

**`review.verdict.*` is the CANONICAL verdict shape (D12).** It reserves the `review` domain root
and is what the deployed reviewer emits and what the `request_id` binds against. It **retargets**
the pre-cut `code.pr.{kind}.{status}` — a code follow-up that lands at flag-day R (retarget myelin's
`verdictSubject`). The `code` root stays a reserved domain root (it may not be reused by an
application), but the verdict shape moves off it onto `review.verdict.*`
(vector `domain/accept-review-verdict`).

**`brain` is a reserved domain root with a normative stream-disjointness invariant (D13).** `brain.>`
and `tasks.>` are **stream-disjoint** — a wire contract every dual-stream peer respects, so a brain
signal never lands in the `TASKS` stream and vice versa. Stream **provisioning** stays M7-owned
(§6.4, §1.2), but the disjointness itself is a wire invariant, not a provisioning detail
(vector `domain/accept-brain-root`).

**`dispatched` is the canonical dispatch-lifecycle token (D14)**, replacing the pre-cut `assigned`
(retarget the myelin enum + this ABNF; vector `dispatch/accept-dispatched-lifecycle`).

The subject **shapes** are absorbed here; RFC-0002 owns the shape. The **closed enum vocabularies**
(`LifecycleState`, `BidLifecycleEventType`, `WorkflowLifecycleEventType`) are homed in a future
**dispatch-observability RFC**, not enumerated normatively here (this resolves the former OD-4). The
`bid-request` segment is now a **registered** reserved `tasks` position-4 tag (§6.2, D16; this
resolves the former OD-5).

---

## 8. Composing a Subject from Envelope Fields

### 8.1. The derivation

Given an envelope `E` and an optional stack `S`, the NATS subject is derived deterministically.

1. **prefix** — Map `E.sovereignty.classification`: `local` → `local`, `federated` → `federated`,
   `public` → `public`. The prefix MUST equal the mapped classification.
2. **public short-circuit** — If the classification is `public`, the subject is
   `public.{E.type}`. It MUST NOT contain a principal or stack segment.
3. **principal** — Otherwise the principal segment is the first dot-segment of `E.source`.
4. **stack** — The terminal grammar MANDATES the stack (§3.3, D17): with `S` supplied the subject
   is `{prefix}.{principal}.{S}.{E.type}` (stack-aware/terminal). An emitter MAY omit `S` **only**
   under an explicit legacy opt-in during the transitional window, producing
   `{prefix}.{principal}.{E.type}` (legacy). An omitted-stack derivation with **no** explicit
   opt-in MUST be rejected at every derivation entry point (D18, §3.3); the legacy/stack-aware
   choice is never made silently (vector `legacy/reject-silent-stackless-emit`).
5. **Direct/Delegate** — If `E.distribution_mode` selects Direct or Delegate and
   `E.target_assistant` is present, the `tasks` tail is
   `tasks.{encodeDidSegment(E.target_assistant)}.{capability}`, where the `@`-segment is the
   **whole** class-explicit agent DID (§5, D1) — never a projection — and `capability` is the
   segment(s) of `E.type` after the `tasks.` prefix. (No reference derivation function performs
   this compound today — §6.5.)

This transcribes `deriveSubject` (`src/subjects.ts:612-627`) and `deriveNatsSubject`
(`src/envelope.ts:646-653`) exactly, including the `public.{type}` short-circuit and the fact that
`deriveNatsSubject` does **not** re-validate the derived principal segment against any grammar
(§7.2).

**Source authority — SIGNED-WINS (D6/D7; co-filed with RFC-0003).** The subject is **not signed**
(RFC-0004), so the unsigned subject stack segment is **NEVER authoritative**. The **signed**
representation governs: `source.stack` for source-addressed traffic, receiver context for
receiver-addressed dispatch (RFC-0003). When the subject's stack segment and the signed
representation disagree, the signed representation wins; a receiver MUST NOT treat the subject's
stack segment as authoritative over the envelope's, and MUST NOT fabricate a stack from an absent
segment (§8.2). This closes the *conflicting*-stack case as well as the *absent*-stack case.

The two historical fabricated-`default` defects are **distinct points, not one root cause (D8)**:
**#1723** fabricated a `default` at **seal time** (an emitter stamped a `default` stack it should
have carried explicitly), while **#1812** fabricated a `default` at **subscribe time** (a receiver
laundered an absent subject stack into a `default` identity). Signed-wins closes the receiver side;
the emit-side reject of §3.3/§8.2 closes the emitter side. Conflating them as "the same root cause"
misses that each needs its own guard.

The self-asserted `E.source` seeds the subject's principal segment and is **not** cryptographically
bound to the verified `signed_by` chain by this document either. Binding it is an RFC-0003
provenance concern; the exposure is recorded in Security §7.10 and Privacy §12.

### 8.2. Legacy-form compatibility and its hard boundary

**There is no `default`-for-matching carve-out (D19).** A subscriber on `{prefix}.{principal}.>`
already matches **both** the legacy 5-segment and the stack-aware 6-segment shapes, because NATS
`>` is multi-segment — `>` bridges both forms with no substitution and no dual subscription. A
receiver therefore MUST NOT fabricate a `default` stack from an absent segment **for any purpose**,
matching included. The former "treat an absent stack as `default` for subject matching only" rule is
**dropped**: it bought nothing (`>` already covers the matching case) and it is itself the #1723
fabricated-`default` silent-deafness class — a receiver that stamps a `default` and then subscribes
to `{principal}.default.>` goes **deaf** to the genuine stack-aware traffic it meant to catch.

The **hard boundary** stands and is reinforced by signed-wins (§8.1): an absent stack segment is a
**fault** in identity resolution, roster membership, and `stack-id` parsing, never a `default`.
Fabricating `did:mf:{principal}-default` or a `{principal}/default` stack-id from a stack-less
subject is the root cause of **cortex#1812** (the subscribe-time fabrication of D8). `stack-id`
parsing is owned by RFC-0001 (`stack-id = principal-id "/" stack-slug`, where the `/` is required);
this document reinforces that a subject-plane absent-stack MUST NOT be laundered into an
identity-plane `default`. Vector `identity/legacy-stack-not-default` binds the boundary; vector
`form/masking-default-stack` is the masking case that hid the defect (a stack literally named
`default` made the fabricated value coincidentally correct for one party).

Ownership of the legacy form's retirement is split. This document owns the legacy 5-segment subject
**grammar and its accept/reject rule** — the terminal grammar mandates the stack, its removal is the
retirement, and stack-absent emits are rejected at every derivation entry point unless explicitly
opted in (§3.3, D17/D18). The retirement **release naming**, the migration window, and the mandatory
deprecation warning belong to **BCP-0001**; the `TASKS_DEAD` stream-filter alignment belongs to
RFC-0007. A migration window without a named end is a migration that never ends — the end is named
by BCP-0001, not here. The deprecation warning promised at `specs/namespace.md` line ~94 ("a later
release will promote that warning to an error") was **never implemented**; that gap is recorded as a
finding (§11, finding 7.11), not designed around here. Note that the DID hard cut (RFC-0001 §9) does
**not** retire this form: the stack-segment migration is a separate wire change and stays under
BCP-0001's default dual-accept doctrine — the no-dual-accept rule of §5 applies to the DID migration
only.

### 8.3. Prefix–classification alignment

A subject's prefix and its envelope's `sovereignty.classification` MUST align (`local.*` ⇄
`local`, `federated.*` ⇄ `federated`, `public.*` ⇄ `public`). A mismatch is a protocol violation.

This alignment is enforced by a **runtime transport guard** (`subjectPrefixAligns` +
`validateSubjectEnvelopeAlignment`), not by the subject grammar, and it compares **only** the
first token — the principal, stack, and type positions are not checked against the envelope. This
is a finding (§7.9). Vectors `prefix/aligns-local` and `prefix/mismatch-rejected` bind the guard.

**Public attribution (D10, security note).** A `public.` subject carries no principal or stack
segment (§2), so a `public.` signal's origin is established **only** by the verified `signed_by`
chain (RFC-0003 / RFC-0004), never by the subject. A receiver MUST NOT attribute a `public.` signal
to any principal on the strength of the subject bytes. Consistent with signed-wins (§8.1), the
subject is a routing address, not an attestation of origin; the trust anchor is the signature chain.

### 8.4. Federation addressing: receiver-addressed dispatch, source-addressed presence

On the `federated.{principal}.{stack}.>` tree two addressing conventions coexist, and they use the
principal segment differently. This document records the mapping as a **closed normative record**
(D6/D7) — the principal segment's meaning is fixed per domain, not left to each implementation:

| Domain family | Addressing | Principal segment is the… | Authority (signed-wins) |
|---|---|---|---|
| `tasks.*` dispatch (offer / direct / delegate / dead-letter / bid-request) | **receiver-addressed** | receiver's | receiver context (RFC-0003), not the subject |
| `agent.*` / presence | **source-addressed** | sender's | `source.stack` (RFC-0003), not the subject |
| `review.verdict.*`, `dispatch.bid.*` (verdict / bid) | **source-addressed (default)** | sender's | `source.stack` (RFC-0003); matches the deployed builders |

Because the subject is unsigned (RFC-0004), the addressing convention tells a router **where** to
route; the **authority** for the principal/stack identity is always the signed representation, never
the subject bytes (§8.1). The §8.1 rule ("principal ← first segment of `source`") describes only the
source-addressed case; the receiver-addressed dispatch convention was documented previously only in
the M7 consumer (cortex ADR-0007 / `accept-subjects.ts`), so a peer implementing from
`specs/namespace.md` alone would mis-address dispatch or reject inbound presence. This document lifts
the convention into the normative record: a federation accept-list MUST admit both the principal's
own subtree (`federated.{ME}.>`, for inbound receiver-addressed dispatch) and each admitted peer's
subtree (`federated.{PEER}.>`, for inbound source-addressed presence). Any code deriving or
validating a `federated.*` subject MUST run the federation-wire-protocol SOP (compass
`sops/federation-wire-protocol.md`).

### 8.5. Capability-id projection into the `tasks` slot (resolved)

The M7 consumer (cortex) validates its runtime capability ids against a `capability-id` grammar
that is **normatively owned by RFC-0008** [RFC-0008] and is referenced here, never transcribed (one
owner per wire rule; grammar/README.md rule 5). Historically that grammar admitted dotted,
underscore-bearing compounds such as `federated.subject_dispatch` and `dev.implement`, which are
**not** expressible as a myelin single-segment, hyphen-only capability tag (§6.3): both the `.` and
the `_` are rejected by CAPABILITY_TAG_RE.

**Resolution (D15): constrain the id, not invent a subject encoder.** RFC-0002 owns the *projection*
of a `capability-id` into the `tasks` position-4 slot (§6.1, §6.3). For that projection to be 1:1,
**RFC-0008 MUST constrain the `capability-id` charset to be subject-safe** — its charset ∩ `segment`
— so that every registered `capability-id` is a valid `capability` here. The alternative (a
subject-side encoder that rewrites `.`/`_` into subject-legal bytes) is rejected: it would reintroduce
a second encode/decode seam of exactly the kind this RFC series exists to end. A dotted or
underscore-bearing id therefore does NOT project and MUST be rejected as not-subject-safe (vector
`seam/capability-id-not-subject-tag`); a subject-safe id projects verbatim
(`seam/capability-id-subject-safe-projects`). The `capability-id` grammar itself stays normatively
owned by RFC-0008; this document owns only the subject-position tag and the projection rule.

---

## 9. Reserved Prefixes and Segments

**A leading `_` is the universal structural reservation marker (D20).** A subject or segment whose
name begins with `_` is a **first-class reserved subject** — infrastructure, not application. This
is the carve-out the underscore names always needed: the `_`-space is **exempt** from the
application segment rules (the lowercase / start-with-a-letter rules of §3.1), so `_system`,
`_metrics`, and NATS's own `_INBOX` are all admissible names even though a `segment` cannot produce
them. This supersedes the initial draft's "the underscore names have no carve-out" finding for the
**reachability** question (the `_`-space IS the carve-out); the residual defect — an app-derived
`_metrics` *token tail* leaking uppercase — remains a finding (§7.7, D26). An **application**
publisher MUST NOT emit a reserved-prefix subject (vector `reserved/reject-app-audit-prefix`);
enforcement of that ban against application publishers is a runtime concern, not a format property.

The reserved top-level prefixes (a **closed** table, amended only by an `Updates:` RFC — D23):

| Prefix | Purpose | Notes |
|---|---|---|
| `_system.` | NATS cluster management | |
| `_internal.` | myelin protocol control (health, schema negotiation) | |
| `_audit.` | compliance / audit-trail signals | **Sovereignty enforcement-NAKs fold here** as `_audit.sovereignty.*` (RFC-0005) — there is NO separate top-level `_nak.` prefix (D21). |
| `_test.` | test-harness signals, stripped in production | |
| `_INBOX.` | NATS request-reply inbox | **Admitted by reference to RFC-0007 (D22).** Uppercase-exempt (NATS's own byte-for-byte string); RFC-0007 owns the tail grammar (`inbox-prefix`, `inbox-id`), referenced here, not redefined. |

The reserved segments:

| Segment | Where | Purpose |
|---|---|---|
| `_metrics` | domain slot under `local.{principal}.{stack}._metrics.*` | observability streams (in the `_`-space, D20) |
| `dead-letter` | `tasks` position 4 | escalation path (§6.2) |
| `bid-request` | `tasks` position 4 | bidding request — **registered (D16)** (§6.2, §7) |
| any `@…` | `tasks` position 4 | assistant address (§5) |

The reserved **domain roots** (§3.2, §6, §7) are also a closed table: `tasks`, `dispatch`, `review`,
`code` (legacy verdict root, retired at R but reserved), `brain`, and the `_`-space `_metrics`. Each
carries a normative shape and fails closed against application misuse.

Reserved-space subscriptions are infrastructure-only and are deliberately **not expressible** in the
application subscription grammar (§4, D24): the `_`-space is a sibling of the classifications,
reachable only via `reserved-subject`, never from an anchored `sub-pattern`.

---

## 10. Registry Considerations

- **RFC number.** `0002`, allocated in [`specs/README.md`](../README.md); numbers are never reused.
- **Registry discipline (D23).** The reserved-prefix, reserved-segment, reserved-domain-root, and
  classification tables are **closed** and are amended **only** by an `Updates:` RFC — the ADR-0001
  living-spec model keeps them small and auditable. An implementation MUST NOT admit an unlisted
  reserved name on its own authority.
- **Classification prefixes.** This document reserves exactly three: `local`, `federated`,
  `public` (§2, D10). Adding a fourth is a wire change requiring a new RFC.
- **Reserved prefixes.** `_system`, `_internal`, `_audit`, `_test`, and `_INBOX.` (§9).
- **Inbound reserved-prefix registrations — RESOLVED (D21/D22).** Two sibling RFCs requested
  registration of infrastructure prefixes absent from the initial §9 table; both are now
  adjudicated. **`_nak.` (RFC-0005) is FOLDED under `_audit`** as `_audit.sovereignty.*` — there is
  no separate top-level `_nak.` prefix (D21), which minimises the reserved-infra wall (RFC-0005's
  grill designs the NAK detail within `_audit`). **`_INBOX.` (RFC-0007) is ADMITTED by reference**
  (D22), uppercase-exempt, with RFC-0007 owning its tail grammar. This resolves the former OD-8 and
  gives RFC-0005 and RFC-0007 a settled answer.
- **Reserved segments.** `_metrics`, `dead-letter`, `bid-request`, and the `@`-address class (§9).
  `bid-request` is now **registered** as a `tasks` position-4 tag (§6.2, D16) — the former OD-5 is
  closed.
- **Domain names.** `tasks`, `dispatch`, `review`, `code` (legacy verdict root), and `brain` carry
  normative subject shapes (§6, §7) and are reserved domain roots (D11/D12/D13); `_metrics` is the
  `_`-space reserved domain root. The domain slot itself is open-with-reserved-roots (§3.2) and is
  not closeable across M7.
- **DID method registration.** This document defines no DID method; the `did:mf` method and its
  potential registration in the W3C DID Specification Registries are RFC-0001's concern. This
  document only *encodes* a `did:mf` value into a subject segment (§5).
- **Generated artifacts.** The regexes STACK_SEGMENT_REGEX, CAPABILITY_TAG_RE, PRINCIPAL_RE and
  the envelope schema `source`/`type`/`target_assistant` patterns are listed in `generated` and,
  on ratification, MUST be produced from the ABNF, not hand-authored. Today the arrow points the
  other way (the regexes are the source and the grammar is transcribed from them); ratification
  inverts it.

---

## 11. Security Considerations

The subject namespace is a **cleartext control surface**. It carries principal identity, stack
topology, capability metadata, and assistant DIDs in the subject string of every message, visible
to any transport observer even when payloads are encrypted (see Privacy §12). Several grammar
invariants are held by runtime checks rather than by the format; per the RFC series' governance
(specs/README.md rule 6) each such case is disclosed here as a finding, not a design.

### Findings

| # | Finding | Held by | Severity | Gap id |
|---|---|---|---|---|
| 7.1 | The capability position is validated by **three** disagreeing grammars (CAPABILITY_TAG_RE vs `segment` vs the spec's looser regex). A tag like `x` or `scan-` is emitter-dependently valid. | runtime, inconsistent | high | subjects/capability-grammar-three-way-drift |
| 7.2 | The **principal segment** is validated as `segment` (1–63, trailing-hyphen OK) at every subject site, but as `principal-id` (2–64, no trailing hyphen) in sovereignty/observability, and as an unbounded first `source` segment in the envelope schema. A schema-valid envelope can derive a subject whose principal violates the 63-char cap; `deriveNatsSubject` re-validates nothing. | runtime, inconsistent | high | subjects/principal-grammar-drift |
| 7.3 | `deriveSubject`/`subjectFor` skip segment validation on the principal and type positions, so a wildcard (`*`/`>`) or dotted principal produces a malformed published subject — defeating the wildcard-rejection invariant the other helpers enforce. The `dead-letter` reservation is likewise unenforced: an ordinary publisher can fabricate a genuine-looking escalation subject. | runtime guard, missing | high | subjects/derive-helpers-skip-grammar-validation; subjects/dead-letter-reservation-unenforced |
| 7.4 | The `@`-assistant encoding was **not injective** over the deployed flat grammar (`did:mf:a-.b` and `did:mf:a.-b` → `@did-mf-a---b`), **leaked `_`** into a segment whose charset forbids it, and imposed **no length bound**. A prior collision between `did:mf:hub.metafactory` and `did:mf:hub-metafactory` was "a real security boundary violation". **RESOLVED by RFC-0001** (class-explicit dot-form + kebab-strict, ratified single-principal 2026-07-13 under ADR-0001); closes at flag-day R (§5). Subject-level length residue resolved by the D2 63-cap exemption (§3.1, §5). | format, defective (pre-cut) | high → closed at R | subjects/did-underscore-leaks-into-at-segment; provenance/assistant-segment-encoding-collision — OD-1 RESOLVED |
| 7.5 | The **legacy vs stack-aware** wire form is undecidable from the subject bytes alone during the transitional window; the classifier defaults to `legacy`. The terminal grammar mandates the stack (§3.3, D17) and its removal engineers the ambiguity out; until retirement (BCP-0001) the emit-side reject (D18) and signed-wins (D6/D7) contain it. The two fabricated-`default` defects are **distinct (D8)**: **#1723** at seal time (emitter stamped `default`), **#1812** at subscribe time (receiver laundered absent-stack into `default`). | out-of-band hint (transitional) | critical | subjects/legacy-vs-stack-aware-wire-ambiguity |
| 7.6 | The `≤255`-octet total-subject cap and the `type` 2–5-segment bound are enforced **nowhere** in code; over-long subjects surface as opaque NATS server errors. | nothing | low/med | subjects/total-255-cap-unenforced |
| 7.7 | The **reachability** half is resolved: the `_`-space is the structural carve-out (D20), so `_metrics` is an admissible reserved domain name, not a grammar violation. The **residual** defect stands: `sanitizeSubjectToken` preserves uppercase (`%x41-5A`), so the app-derived `_metrics` *token tail* can emit an uppercase wire subject that violates the lowercase-only rule (D26) and a strict subscriber-side parser would reject. Accept/reject bound by `metrics/accept-lowercase-token` / `metrics/reject-uppercase`. | trusted-tail bypass | medium | subjects/metrics-subject-uppercase-leak |
| 7.8 | A stack literally named `tasks` (or `dispatch`/`code`) is misparsed by `taskDeadLetterSubject`'s legacy-priority index check, dropping the stack and mislabelling the capability. No stack name is forbidden. | runtime, order-dependent | medium | subjects/stack-named-tasks-misparse |
| 7.9 | Subject↔envelope consistency is checked **only** on the classification prefix (the first token). Principal, stack, and type are never bound to the envelope by this document, and the alignment itself is a runtime transport guard, not a format property. | runtime guard | high | (cross-ref provenance/source-unbound-to-chain) |
| 7.10 | The subject's principal segment derives from the **self-asserted** `E.source`, which is not bound to the verified `signed_by` chain by this document. A validly-signed envelope can claim another principal's subject principal. Binding is an RFC-0003 concern. | not held here | high | provenance/source-unbound-to-chain |
| 7.11 | The legacy-form **deprecation warning** promised at `specs/namespace.md` line ~94 ("a later release will promote that warning to an error once the ecosystem has cut over") was **never implemented** — no validator warns on the legacy 5-segment form. A migration whose warn-then-error ramp is unbuilt has no operational signal that it is time to cut over. Recorded here per D19; the retirement ramp and its warning are BCP-0001's to build (§8.2). | nothing (unbuilt) | low/med | subjects/legacy-deprecation-warning-unimplemented |

### Threat model

This document assumes an active on-path adversary who can observe every subject and can publish
arbitrary well-formed subjects to any NATS server it can reach, but cannot forge Ed25519
signatures (RFC-0003 / RFC-0004) and cannot bypass the leaf-node rule that `local.>` is not
replicated across principal boundaries. Under that model the namespace defends the
`local`/`federated`/`public` scope boundary (leaf-node non-replication of `local.>`), the
reserved-prefix `_`-space at the infrastructure layer (D20), and — newly — the wildcard reach:
the restricted subscription grammar (D24) makes a cross-scope or reserved-space wildcard
**unexpressible**, so a subscriber cannot draft a pattern that spans scopes or descends into the
`_`-space (§4). It does **not**, by the format alone, defend: capability-grammar uniformity (7.1),
principal-segment authenticity (7.9, 7.10), assistant-address injectivity before the flag-day cut
(7.4 — closed at R by RFC-0001's kebab-strict grammar), the dead-letter / bid-request escalation
plane's integrity (7.3), or the legacy/stack-aware form's transitional decidability (7.5).

The **authority** for identity is the signed representation, never the subject bytes (signed-wins,
D6/D7, §8.1). Consumers MUST NOT treat a subject's principal or stack segment as an authenticated
identity, MUST NOT fabricate a stack from an absent segment, and MUST NOT attribute a `public.`
signal from its (owner-less) subject (D10, §8.3); the `signed_by` chain (RFC-0003 / RFC-0004) is the
trust anchor.

---

## 12. Privacy Considerations

The subject is metadata that travels in cleartext regardless of payload encryption. Every
`local.`/`federated.` subject discloses, to any party that can observe the transport:

- the **owning principal** (segment 2) — a stable, correlatable identifier across every message
  that principal emits;
- the **stack topology** (segment 3) — how a principal partitions its deployments
  (`research`, `security`, `devops`, …), leaking organisational structure;
- the **capability and domain** vocabulary — what work a principal solicits and performs; and
- for Direct/Delegate tasks, the **assistant DID** — and, because the `@`-segment carries the
  *whole* class-explicit agent DID (§5, D1), the assistant's `{principal}.{stack}` home rides in
  the segment too. This repeats the principal/stack the subject already carries, so it discloses no
  *new* correlatable field beyond the stable per-assistant identifier itself; the assistant DID
  correlates every task routed to that assistant.

`local.>` subjects do not cross the principal boundary (a privacy boundary enforced at the leaf
node), so the disclosure above is confined to a principal's own infrastructure for `local.`
traffic. `federated.` subjects cross principal boundaries by construction and disclose the above
to every peer on the federation. `public.` subjects disclose their domain/entity/action to all
network participants but carry no principal or stack segment.

Because the principal, stack, and assistant-DID segments are stable and non-random, they are
**linkable** across contexts and over time by any observer — this is inherent to a
human-readable routing namespace and is not mitigated by this document. Deployments that require
unlinkability MUST NOT encode a sensitive identity into a `federated.` or `public.` subject
segment. The self-asserted origin of the principal segment (§7.10) additionally means an observer
cannot rely on the segment being the true originator without checking the signature chain.

---

## 13. Conformance

An implementation conforms to this document if and only if it passes every vector under the path
named in `vectors` (`specs/vectors/subject-namespace/`). Reading this specification is not
conformance; passing the vectors is. Prose explains; vectors bind.

A conforming implementation MUST:

1. Accept and reject subjects, segments, capability tags, and `@`-addresses exactly as the
   `valid` / `invalid` vectors require, using its **own** parser (it MUST NOT import the reference
   implementation — otherwise it tests myelin, not itself; specs/CONFORMANCE.md).
2. Derive subjects from envelope fields (§8.1) byte-for-byte as the `render` vectors require.
3. Never fabricate a `default` stack from an absent segment — for matching or for anything else
   (§8.2, D19). Reject a silent (non-opt-in) stackless emit at every derivation entry point as
   `invalid` vector `legacy/reject-silent-stackless-emit` requires, and reject the
   identity/roster/stack-id substitution as `invalid` vector `identity/legacy-stack-not-default`
   requires. Treat the unsigned subject stack as non-authoritative (signed-wins, §8.1).
4. Treat every finding in §11 that a vector encodes as a **requirement stated by the vector**,
   even where the reference implementation currently fails that vector — a failing reference is a
   defect to fix, not a licence to diverge (specs/CONFORMANCE.md precedence chain: ABNF governs;
   where a generated artifact disagrees, the artifact is the defect).

Where a vector and the ABNF disagree, the ABNF governs and the vector is a defect. **All of this
document's former open decisions are now resolved** — the subject grammar is fully decided (the 29
grill decisions, ratified single-principal 2026-07-13 under ADR-0001). Two caveats bound
conformance nonetheless. First, this document is still `Draft`: no implementation grounds behaviour
on it until it is `Ratified` (the principal ratifies separately). Second, the `@`-address
behaviour resolved from RFC-0001 (class-explicit dot-form) takes effect only at **flag-day release
R**, atomically with the envelope-field flip (§5); before R the pre-cut `@`-encode vectors pin the
retired byte-behaviour and are not a conformance target for post-R emitters. The
legacy-form **retirement** boundary (release naming, the deprecation-warning ramp) is owned by
BCP-0001; an implementation MUST NOT claim conformance for a retirement step BCP-0001 has not yet
named.

---

## 14. References

### 14.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", **Ratified** (single-principal, 2026-07-13, ADR-0001). Owns the identifier terminals (`segment`, `principal-id`, `stack-slug`, `stack-id`, `did`, `did-subject-segment`/`encoded-msi`) this document references. Resolved OD-1 (class-explicit dot-form) and owns the hard-cut migration (its §9), with which this document's `@`-segment cutover is atomic (§5). The `@`-segment short-form question it deferred here is resolved: full DID, exempt from the per-segment cap (D1/D2, §5).
- [RFC-0003] metafactory, "Envelope", Draft. Owns the envelope fields (`source`, `type`, `target_assistant`, `distribution_mode`, `sovereignty.classification`, `requirements`) that §8's derivation consumes. Co-files source authority (signed-wins, D6/D7) with this document; the signed `source` representation governs the stack (§8.1).
- [RFC-0004] metafactory, "Envelope Signing", **Ratified** (single-principal, ADR-0001). Establishes that the **subject is not signed**; the signed representation is the trust anchor for the signed-wins rule (D6/D7, §8.1) and for `public.` attribution (D10, §8.3).
- [RFC-0008] metafactory, "Capability Discovery and Advertisement", Draft. Normative owner of the `capability-id` grammar and the capability-set reconciliation referenced in §8.5. Per D15 it MUST constrain the `capability-id` charset to be subject-safe (charset ∩ `segment`) so the projection into the `tasks` slot is 1:1.

### 14.2. Informative References

- [NAMESPACE] metafactory, `specs/namespace.md` — "Myelin NATS Namespace Convention", Version 1.0.0. The prose this RFC promotes (`supersedes_prose`).
- [TASK-ROUTING] metafactory, `docs/design-agent-task-routing.md` — the `tasks` domain design record (Pattern 4, chosen 2026-05-09). Informative; its pre-namespace `subjects: ["tasks.>"]` sketch is superseded by §6.4.
- [ADR-0007] cortex, "Federation accept-list addressing" (`src/bus/agent-network/accept-subjects.ts`) — the receiver-addressed-dispatch / source-addressed-presence convention lifted into §8.4.
- [ADR-0002] cortex, "Federated dispatch addressing and verdict-back" — the `did:mf:{principal}-{stack}` requester-DID convention that intersects the `@`-encoding.
- [BCP-0001] metafactory, "Wire Change Control and Versioning", Best Current Practice, Draft. Owns the legacy-form retirement window, release naming, and the deprecation-warning ramp (§8.2, D17; the unbuilt warning is finding 7.11), and the dual-accept default that the DID migration's hard cut deliberately overrides (§5).
- [RFC-0005] metafactory, "Sovereignty and Boundary Crossing", Draft. Its sovereignty enforcement-NAKs **fold under `_audit.sovereignty.*`** — no separate `_nak.` prefix (§9, §10, D21).
- [RFC-0007] metafactory, "Transport and Reliability", Draft. Owns the `_INBOX.` grammar, **admitted by reference** into the reserved-prefix table (§9, §10, D22); owns the `TASKS_DEAD` stream-filter alignment side of the legacy-form retirement (§8.2).
- [DISPATCH-OBS] metafactory, a future **dispatch-observability RFC** (unallocated). Normative home of the closed dispatch enum vocabularies (`LifecycleState`, `BidLifecycleEventType`, `WorkflowLifecycleEventType`); this document owns only their subject *shapes* (§7, D14).
- [FED-WIRE] compass, `sops/federation-wire-protocol.md` — the mandatory procedure for any `federated.*` subject work.
- [DID-CORE] W3C, "Decentralized Identifiers (DIDs) v1.0" — the shape the `did:mf` value encoded in §5 conforms to.
- [NATS] Synadia, "NATS Subject-Based Messaging" — the wildcard semantics (`*`, `>`) §4 transcribes.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in
`grammar` (`specs/grammar/subject-namespace.abnf`) is the source of truth and is what CI validates.
Terminal alphabets (`lower`, `stack-slug`, and the `did`/`did-subject-segment`/`encoded-msi`
referenced in comments) are defined in RFC-0001 and are not redefined here.

```abnf
; specs/grammar/subject-namespace.abnf
; RFC-0002 — Subject Namespace (the myelin NATS subject grammar)
; Terminal alphabets defined ONCE in RFC-0001; DIGIT from RFC 5234 App. B.
; Imports: RFC-0001 (lower, principal-id, stack-slug, did, did-subject-segment,
; encoded-msi); RFC-0007 (inbox-prefix, inbox-id).

wire-subject       = subject / reserved-subject
subject            = local-subject / federated-subject / public-subject
local-subject      = %s"local." principal-body
federated-subject  = %s"federated." principal-body
public-subject     = %s"public." type

; classification — CLOSED 3-prefix set (D10). Consumed by sub-pattern (§5).
classification     = %s"local" / %s"federated" / %s"public"

; principal-body — terminal grammar MANDATES the stack (D17); `[ stack "." ]`
; is TRANSITIONAL (its removal is the legacy-form retirement, BCP-0001).
; SIGNED-WINS (D6/D7): the unsigned subject stack is NEVER authoritative.
principal-body     = principal "." [ stack "." ] type
principal          = segment                 ; validated as `segment`, NOT
                                             ; RFC-0001 principal-id (§7.2)
stack              = stack-slug              ; RFC-0001
segment            = stack-slug              ; /^[a-z][a-z0-9-]{0,62}$/;
                                             ; tightens to kebab-strict at R (§3.1)
; type — {domain}.{entity}.{action}. `type` is the UNION of the reserved-root
; shapes and the generic tail (D11). The reserved-root shapes are WIRED IN so
; the "@"-address (direct-type) and the "_metrics" domain (metrics-type) — which
; a letter-leading `segment` cannot produce — are DERIVABLE in a published
; subject; metrics-type is the ONLY production for `_metrics`. The LETTER roots
; are ALSO producible by generic-type; that overlap is deliberate, so the
; reserved-root fail-closed stays a SEMANTIC, vector-enforced constraint.
type               = tasks-type / dispatch-type / verdict-type / brain-type
                   / metrics-type / generic-type
generic-type       = segment *( "." segment )
alnum              = lower / DIGIT

; tasks domain (§6) — position-4 is a CLOSED TAGGED UNION (D16).
tasks-type         = offer-type / direct-type / dead-letter-type / bid-request-type
offer-type         = %s"tasks." capability *( "." segment )
direct-type        = %s"tasks." assistant-address "." capability
dead-letter-type   = %s"tasks.dead-letter." capability
bid-request-type   = %s"tasks.bid-request." capability   ; REGISTERED (D16)
capability         = lower ( 1*alnum *( "-" alnum-run ) / 1*( "-" alnum-run ) )
alnum-run          = 1*alnum
; assistant-address — carries the WHOLE class-explicit agent DID (D1); a
; BLOCKING recipient-security gate; EXEMPT from the 63-octet per-segment cap
; (D2), bound only by 255-total / per-inner-msi 63. Referenced, not redefined.
; Pre-cut (retired at R; its "_" alt = the transcribed leak §7.4):
;   "@" %s"did-mf-" 1*( lower / DIGIT / "-" / "_" )
assistant-address  = did-subject-segment

; dispatch / verdict / brain / bid-request (§7) — SHAPES owned here; the closed
; dispatch enums are homed in a dispatch-observability RFC.
dispatch-type      = %s"dispatch.task." lifecycle-state
                   / %s"dispatch.bid." bid-event
                   / %s"dispatch." workflow-event
verdict-type       = %s"review.verdict." verdict-kind "." verdict-status  ; CANONICAL (D12)
verdict-kind       = segment                 ; {kind}, e.g. pr
verdict-status     = segment                 ; {status}, e.g. approved / changes-requested
                                             ; pre-cut, retired at R: %s"code.pr." segment "." segment
brain-type         = %s"brain." segment *( "." segment )  ; brain.>/tasks.> stream-disjoint (D13)
lifecycle-state    = %s"received" / %s"dispatched" / %s"started"   ; `dispatched` (D14)
                   / %s"completed" / %s"aborted" / %s"failed"
                   / %s"progress" / %s"rejected"
bid-event          = %s"bid-opened" / %s"bid-received" / %s"bid-closed"
                   / %s"bid-retry" / %s"bid-assigned"
workflow-event     = %s"workflow.started" / %s"workflow.resumed"
                   / %s"workflow.recovered" / %s"workflow.step.started"
                   / %s"workflow.step.completed" / %s"workflow.step.failed"
                   / %s"workflow.step.skipped" / %s"workflow.completed"
                   / %s"workflow.failed"

; reserved / structural "_"-space (§9, §10) — leading "_" = universal
; structural reservation (D20); registry CLOSED, amended by Updates: (D23).
reserved-subject   = infra-reserved / inbox-reserved
infra-reserved     = infra-prefix "." type
infra-prefix       = %s"_system" / %s"_internal" / %s"_audit" / %s"_test"
                                             ; _nak. folds under _audit (D21) — no separate prefix
inbox-reserved     = inbox-prefix inbox-id   ; RFC-0007, by reference (D22); uppercase-exempt
reserved-segment   = %s"_metrics" / %s"dead-letter" / %s"bid-request"
                                             ; plus any assistant-address (leading "@") in `tasks`
metrics-type       = %s"_metrics.transport." metrics-token
metrics-token      = ( lower / DIGIT ) *( lower / DIGIT / "-" )   ; LOWERCASE-ONLY (D26)

; subscription patterns (§4) — MAY carry wildcards; `subject` MUST NOT.
; RESTRICTED REACH (D24): ANCHORED under a literal classification; the
; classification position can be NEITHER "*" NOR ">"; a ">" tail cannot cross
; scope nor descend into the "_"-space (security-first "can't-express").
sub-pattern        = classification "." scope-sub-body
scope-sub-body     = ( sub-token *( "." sub-token ) [ "." ">" ] ) / ">"
sub-token          = segment / assistant-address / reserved-segment / "*"
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/subject-namespace/`, consumable by an implementation in
any language. This appendix reproduces a representative subset; it is not the only copy. At publish
the starter file `vectors.json` is split into `valid.json` / `invalid.json` / `render.json` by
`expect.ok` and `kind`, per [`specs/vectors/README.md`](../vectors/README.md). Every vector carries
a `why`. The mandatory adversarial cases for this dimension are present:

- **Masking case** — `form/masking-default-stack`: a subject with a stack literally named
  `default`, where the buggy default-fabrication is coincidentally correct (the cortex#1812 mask).
- **Collision pairs** — `encode/did-dot-doubles` vs `encode/did-hyphen-preserved` (the resolved
  `.`/`-` pair; the `.`-form survives the cut as a hub-class DID, the `-`-form is pre-cut classless);
  `encode/noninjective-dashdot` vs `encode/noninjective-dotdash` (the pre-cut `-.`/`.-` → `---`
  collision — closed by RFC-0001's kebab-strict rule from flag-day R, both inputs unmintable);
  `deadletter/stack-named-tasks-misparse` (the stack-named-`tasks` collision).
- **Full-DID recipient gate (D1)** — `encode/agent-dotform-subject` / `decode/agent-dotform-subject`
  (the class-explicit dot-form round-trip); `direct/full-did-subject` (the whole DID rides the
  subject, repeating principal/stack); `recipient/full-did-match` vs `recipient/full-did-mismatch`
  (the blocking byte-compare gate); `atsegment/exempt-from-63-cap` vs
  `atsegment/inner-msi-segment-over-63` (D2 — the whole `@`-segment is exempt, its inner msi
  segments are not).
- **Restricted wildcard reach (D24)** — `sub/reject-bare-arrow`, `sub/reject-wildcard-classification`
  (the classification position is neither `*` nor `>`); `sub/reject-reserved-space-wildcard` (a `>`
  cannot descend into the `_`-space); `sub/accept-tasks-stream-filter`,
  `sub/offer-reachability-positive` vs `sub/offer-reachability-terminal-unreachable` (the positive
  half).
- **Reserved `_`-space (D20-D23)** — `reserved/reject-app-audit-prefix` (an app MUST NOT emit a
  reserved prefix); `reserved/inbox-by-reference` (`_INBOX.` uppercase-exempt, D22);
  `reserved/nak-folds-under-audit` (D21).
- **Canonical shapes (D12/D14/D16)** — `domain/accept-review-verdict`,
  `dispatch/accept-dispatched-lifecycle`, `tasks/accept-bid-request-shape`,
  `domain/reject-app-misuse-dispatch` (reserved-root fail-closed).
- **Legal-in-one-illegal-in-another** — `capability/reject-single-char`,
  `capability/reject-trailing-hyphen` (valid to the offer builder, invalid to the bid builder);
  `atsegment/underscore-rejected` (produced by the pre-cut encoder, rejected by the `@`-grammar);
  `identity/legacy-stack-not-default` (legal to match, illegal to resolve to identity);
  `legacy/reject-silent-stackless-emit` (D18 — a non-opt-in stackless emit is rejected);
  `seam/capability-id-not-subject-tag` vs `seam/capability-id-subject-safe-projects` (D15).

```json
[
  {
    "id": "identity/legacy-stack-not-default",
    "rfc": 2,
    "kind": "resolveStackForIdentity",
    "input": { "subject": "local.acme.tasks.chat" },
    "expect": { "ok": false, "reason": "stack-absent-not-default" },
    "why": "ROOT CAUSE cortex#1812. The unsigned subject stack is NEVER authoritative (D6/D7 signed-wins); an absent stack MUST NOT be fabricated into `default` for identity resolution / roster / stack-id (§8). Fault, never a default."
  },
  {
    "id": "direct/full-did-subject",
    "rfc": 2,
    "kind": "validatePublishedSubject",
    "input": "federated.andreas.meta-factory.tasks.@did-mf-agent--andreas--meta-factory--luna.code-review",
    "expect": { "ok": true, "value": { "shape": "direct", "assistant": "did:mf:agent.andreas.meta-factory.luna", "capability": "code-review" } },
    "why": "D1: the Direct/Delegate @-address encodes the WHOLE class-explicit agent DID, REPEATING the subject's own {principal}.{stack} (andreas/meta-factory) — a full DID, NOT a prefix-relative projection."
  },
  {
    "id": "recipient/full-did-mismatch",
    "rfc": 2,
    "kind": "validateTaskRecipient",
    "input": { "subject": "federated.andreas.meta-factory.tasks.@did-mf-agent--andreas--meta-factory--luna.code-review", "target_assistant": "did:mf:agent.andreas.meta-factory.echo" },
    "expect": { "ok": false, "reason": "recipient-address-mismatch" },
    "why": "D1: the gate byte-compares the @-segment against encodeDidSegment(target_assistant) and HARD-DROPS on mismatch (…luna != …echo). This is the security property the full-DID @-segment exists to enforce — a projection could not serve it."
  },
  {
    "id": "sub/reject-reserved-space-wildcard",
    "rfc": 2,
    "kind": "validateSubPattern",
    "input": "_audit.>",
    "expect": { "ok": false, "reason": "reserved-space-not-app-subscribable" },
    "why": "D24: a `>` MUST NOT descend into the top-level `_`-space; reserved-space subscriptions are infra-only and are NOT expressible in the application sub-pattern grammar (the `_`-space is a SIBLING of the classifications, unreachable from an anchored sub-pattern)."
  },
  {
    "id": "dispatch/accept-dispatched-lifecycle",
    "rfc": 2,
    "kind": "validatePublishedSubject",
    "input": "local.metafactory.default.dispatch.task.dispatched",
    "expect": { "ok": true, "value": { "domain": "dispatch", "state": "dispatched" } },
    "why": "D14: `dispatched` is the CANONICAL lifecycle token (received -> dispatched -> started -> completed -> aborted/failed); it RETARGETS the pre-cut `assigned`. RFC-0002 owns the shape; the closed enum is homed in a dispatch-observability RFC."
  }
]
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes
ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes `specs/namespace.md`. Adds the collected ABNF (`subject-namespace.abnf`), the starter vector set, and the Registry / Security / Privacy / Conformance sections. Records 10 findings (§11) and 5 open decisions (OD-1..OD-5). |
| 2026-07-14 | Draft | **Grill resolution** — resolves ALL of RFC-0002's open decisions from the ratified grill log (29 decisions, Andreas 2026-07-13, single-principal per ADR-0001) and removes every OPEN DECISION marker. **@-segment (D1-D5):** the federated Direct/Delegate `@`-segment carries the WHOLE class-explicit agent DID (a blocking recipient-security gate, zero-code-delta), EXEMPT from the 63-octet per-segment cap (bound to 255-total / per-inner-msi 63); home-binding invariant codified; projection moot. **Source authority (D6-D10):** signed-wins — the unsigned subject stack is never authoritative; per-domain addressing table enumerated (§8.4); #1723 (seal-time) / #1812 (subscribe-time) recorded as DISTINCT; `public.` unattributed on-wire (origin only via `signed_by`). **Domains (D11-D16):** domain slot open-with-reserved-roots (fail-closed); `review.verdict.*` canonical (reserve `review`); `brain` reserved + `brain.>`/`tasks.>` stream-disjoint; lifecycle token `dispatched`; capability-id subject-safe projection (RFC-0008 constrains charset); tasks position-4 closed tagged union; `bid-request` registered (closes OD-5). **Legacy/migration (D17-D19):** terminal grammar mandates the stack ( `[stack.]` transitional ); reject = MUST-not-emit at every derivation entry point; dropped the §8.2 default-for-matching carve-out (namespace.md:94 unbuilt warning → finding 7.11). **Reserved/wildcards (D20-D24):** leading `_` = universal structural reservation (uppercase-exempt); `_nak.` folds under `_audit`; `_INBOX.` by reference; registry CLOSED; wildcard reach restricted (no cross-scope / reserved-space wildcard). **Vectors (D25-D29):** 58-vector set (grammar + vectors written separately). D9: RFC-0001/RFC-0004 are Ratified single-principal (ADR-0001) — retired the "pending JC" qualifier throughout and updated the §Status two-signature clause. crossRefs +0004; references updated (§14). Status stays Draft (ratifiable single-principal; the principal ratifies separately). |
| 2026-07-13 | Draft | **Cascade sweep** (propagates the ratified RFC-0001 decisions, Andreas 2026-07-12 pending JC co-signature; applies REVISIONS C5/C6/C8/C9/C10). OD-1 retargeted **RESOLVED by RFC-0001** (class-explicit dot-form): §5 records the class-explicit `@`-encoding (`.` doubled to `--`), injectivity-with-kebab-strict-precondition, the normative `decodeDidSegment`, and the closure of the three §7.4 findings at flag-day R; §5/§8.2 record the **atomic** `@`-segment ⟷ envelope-field hard-cut coupling (one source, no dual-accept window for the DID migration only). OD-2 narrowed per C6: this document keeps the legacy 5-segment grammar + accept/reject rule; retirement release naming → BCP-0001; `TASKS_DEAD` filter alignment → RFC-0007. OD-3 retargeted per C5: `capability-id` normatively owned by RFC-0008; inline regex transcription removed (§8.5, §1.2). New open decisions: **OD-6** `@`-segment short-form (inherited from RFC-0001 §5 — full-DID vs prefix-relative projection under the 255-octet budget); **OD-7** source stack-segment authority (C9, cortex#1812 class, co-filed with RFC-0003); **OD-8** `_nak.` / `_INBOX.` reserved-prefix adjudication (C8, §10). Stale RFC-0001 cross-refs repaired (`did-msi-deployed` → `method-specific-id`; §3.1 trailing-hyphen note now records the kebab-strict retraction). crossRefs added to front matter (C10: +0008; also 0001/0003/0005/0007/bcp-0001). References updated (§14). |

## Acknowledgments

This draft is grounded in the wire-protocol gap analysis and audit of `specs/namespace.md`,
`src/subjects.ts`, `src/segment-validators.ts`, `src/subject-vocabulary.ts`,
`src/subject-matching.ts`, and `src/patterns.ts` on `origin/main`, and in the cortex consumer
evidence (`accept-subjects.ts`, `capability.ts`, ADR-0002, ADR-0007). The RFC series exists because
three federated-addressing defects — a hand-written accept-list crash-loop, a fabricated `default`
stack, and a DID-class mismatch — shipped in one week from the same root cause: an identity rendered
into a wire representation in one place and parsed differently in another.

## Authors' Addresses

metafactory M3 working group. The v1 ratification signatory is **the principal** (Andreas) alone,
recorded in `signatories` on move to `Ratified` (ADR-0001); the two-signature act (principal + hub
custodian) is suspended and reinstates per §Status only when the wire binds a party we do not
control.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/