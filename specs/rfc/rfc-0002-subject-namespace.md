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
  - schemas/envelope.schema.json      # source, type, target_assistant patterns (co-owned RFC-0003)
crossRefs:                           # sibling RFCs this document references (REVISIONS C10)
  - "0001"                           # identifier terminals; @-segment co-owner; atomic hard-cut coupling (§5, §8.2)
  - "0003"                           # envelope fields consumed by the §8 derivation; OD-7 co-filed
  - "0005"                           # inbound `_nak.` reserved-prefix registration (§10, OD-8)
  - "0007"                           # inbound `_INBOX.` registration (§10, OD-8); TASKS_DEAD filter alignment (OD-2 split)
  - "0008"                           # normative owner of the capability-id grammar (§8.5, OD-3)
  - "bcp-0001"                       # legacy-form retirement window / release naming (§8.2, OD-2 split)
supersedes_prose:
  - specs/namespace.md
---

# RFC-0002: Subject Namespace

## Abstract

This document specifies the NATS subject namespace of the myelin wire protocol — the
dot-segmented address space over which every M3 envelope is routed. It defines the three
classification prefixes (`local.`, `federated.`, `public.`), the
`{principal}.{stack}.{domain}.{entity}.{action}` segment grammar, the per-segment character set
and length bounds, the wildcard rules for subscription patterns, the reserved prefixes and
segments, the DID-encoded `@`-assistant address used by the `tasks` domain, the `tasks` offer /
direct / delegate / dead-letter shapes and their JetStream stream, and the deterministic
derivation of a subject from an envelope's fields. Syntax is given as ABNF; conformance is decided
by test vectors, not by reading. The document records — as findings, not as design — the points
where an invariant is held by a runtime check rather than by the format, the several places where
the grammar is transcribed inconsistently across the source tree, and the encoding ambiguities
the initial draft proved against the deployed flat identifier form — since resolved at the
identifier layer by the class-explicit dot-form decision (pending co-signature), which takes
effect at a single coordinated flag-day cut; the subject-level short-form question that decision
defers remains open here.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations
MUST NOT ground behaviour on a `Draft` or `Proposed` document.

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
2. Subject Structure
3. Segment Grammar
4. Wildcards and Subscription Patterns
5. Assistant-Address Segments
6. The `tasks` Domain
7. Dispatch-Observability, Verdict, and Bid-Request Families
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

- The three classification prefixes and their scope semantics (§2).
- The generic segment grammar, the principal / stack / type positions, and the
  legacy vs stack-aware wire forms (§3).
- Wildcard semantics for subscription patterns and the fully-qualified rule for published
  subjects (§4).
- The `@`-prefixed assistant-address segment and its DID encoding, which is **co-owned with
  RFC-0001** (§5).
- The `tasks` domain — offer, direct/delegate, and dead-letter shapes; the capability tag; the
  `TASKS` JetStream stream shape (§6).
- The dispatch-observability, PR-verdict, and bid-request subject shapes (§7).
- The deterministic derivation of a subject from an envelope's fields, and the default-derivation
  backward-compatibility rule and its hard boundary (§8).
- The reserved prefixes and segments (§9, §10).

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
  grammar* (§6.3); the compound `capability-id` grammar, the set of registered capabilities, and
  their cross-repository reconciliation are normatively owned by RFC-0008 [RFC-0008] and
  referenced here (§8.5, OD-3).

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
| **subscription pattern** | A subject that MAY carry `*` / `>` wildcards, used only to subscribe (§4). |
| **legacy form** | A 5-segment `local./federated.` subject with the stack segment omitted (§3.3). |
| **stack-aware form** | A 6-segment `local./federated.` subject with an explicit stack segment (§3.3). |
| **capability tag** | A `tasks`-domain token naming a routed capability (§6.3). |
| **assistant address** | The `@`-prefixed, DID-encoded segment routing a Direct/Delegate task to one assistant (§5). |
| **dead-letter** | The reserved `tasks`-domain escalation segment for unclaimable tasks (§6.2.3). |
| **receiver-addressed / source-addressed** | Federation addressing conventions for dispatch vs presence traffic (§8.4). |
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

The classification prefix set is exactly `{ local, federated, public }` and MUST match the
envelope's `sovereignty.classification` (§8.3). A subject whose first segment is none of these
three is malformed and MUST be rejected.

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

Case: subjects are always lowercase. A subject containing an uppercase letter is malformed. The
reference `_metrics` emitter violates this (§7.7).

### 3.2. Principal, stack, and type positions

```abnf
principal-body = principal "." [ stack "." ] type
principal      = segment
stack          = stack-slug
type           = segment *( "." segment )
```

The `principal` position is validated as a generic `segment`, **not** as RFC-0001 `principal-id`,
at every derivation site in the reference implementation. This is a faithful transcription of the
deployed behaviour and a recorded finding (§7.2): the subject-plane principal and the
identity-plane `principal-id` do not enforce the same string set.

The `type` tail carries 1 or more segments in the pure-string derivation helpers. The reference
envelope `type` schema (RFC-0003) bounds it at 2 to 5 segments; a conformant emitter SHOULD emit a
`type` of 2 to 5 segments. The subject helpers do not enforce that bound (§7.6).

### 3.3. Legacy and stack-aware forms — an ambiguity, not a design

A `local.`/`federated.` subject has two wire forms:

- **stack-aware** (6-segment): `{prefix}.{principal}.{stack}.{type…}`
- **legacy** (5-segment): `{prefix}.{principal}.{type…}` — the stack segment omitted.

Because `type` is itself multi-segment, **these two forms are not distinguishable from the subject
bytes alone.** `local.acme.default.tasks.chat` parses equally as stack-aware
(`stack=default`, `type=tasks.chat`) or legacy (`type=default.tasks.chat`). The reference
classifier `detectSubjectForm` resolves the ambiguity only via an out-of-band hint (a
caller-supplied stack identity or the envelope `type`) and otherwise **defaults to `legacy`**.

This undecidability is a **finding**, recorded in Security Considerations §7.5. It is the class of
defect the RFC series exists to end: the scaffold's own motivation names "a fabricated `default`
stack segment" as one of three federated-addressing defects that shipped in one week. A receiver
that fabricates a `default` stack from an absent segment and then uses it for anything other than
subject matching reproduces cortex#1812 (§8.2). No wire marker (a version tag, a fixed segment
count, or a reserved separator) makes the form self-describing; supplying one is deferred to
OD-2.

---

## 4. Wildcards and Subscription Patterns

NATS wildcard semantics apply to **subscription patterns only**:

- `*` matches exactly one segment.
- `>` matches one or more trailing segments and MUST be the final token of the pattern.

```abnf
sub-pattern = ( sub-token *( "." sub-token ) [ "." ">" ] ) / ">"
sub-token   = segment / assistant-address / reserved-segment / "*"
```

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
count.

---

## 5. Assistant-Address Segments

The `tasks` domain routes a Direct/Delegate task to a single assistant by encoding the
assistant's DID into one subject segment. The segment begins with `@`, which the grammar permits
**only** as the first character of a segment.

The stated grammar is:

```
@[a-z][a-z0-9-]*
```

The segment is **always** the output of `encodeDidSegment(did)` applied to a `did` (RFC-0001) —
never a free-form display name. The encoding (`src/subjects.ts:124-129`;
`specs/namespace.md` §"Assistant encoding") is:

| DID source character | Encoded as |
|---|---|
| `:` (the `did:mf:` separators) | `-` |
| `.` (inside the method-specific-id) | `--` |
| `-` (inside the method-specific-id) | `-` (preserved) |
| `[a-z0-9]` | passthrough |

From flag-day release R the `did` so encoded is the **class-explicit dot-form** of RFC-0001 §6.2,
so the class tag and every segment ride into the subject with each `.` doubled to `--`:
`did:mf:agent.andreas.meta-factory.luna` → `@did-mf-agent--andreas--meta-factory--luna`;
`did:mf:hub.metafactory` → `@did-mf-hub--metafactory`. The legacy flat forms
(`did:mf:forge` → `@did-mf-forge`; `did:mf:hub-metafactory` → `@did-mf-hub-metafactory`) are
rejected at decode from R (RFC-0001 vector `inv/legacy-classless`).

**[RESOLVED — OD-1 — by RFC-0001 (class-explicit dot-form), 2026-07-12; pending JC
co-signature.]** The injective, charset-clean grammar this decision was blocked on
(the-metafactory/cortex#1880) is now recorded in RFC-0001 §6.2. Under it, the encoding **is**
injective — but the property MUST be cited with its precondition: it is the **kebab-strict
segment rule** (no segment starts or ends with `-`, so `-` is never adjacent to `.` in a valid
DID), NOT dot-separation alone, that guarantees every `--` decodes to `.` and nothing else. The
bare "`.` → injective" claim is the false claim the initial draft caught; do not cite it.
`decodeDidSegment` (split the encoded msi on `--`, rejoin with `.`) is specified as the one
normative decoder by RFC-0001 §5.

The initial draft recorded three findings (§7.4) against the deployed flat grammar, transcribed
here for the record; their dispositions under the resolved grammar are:

1. `did:mf:a-.b` and `did:mf:a.-b` both encoded to `@did-mf-a---b` — non-injective. **Closed at
   R**: both inputs are unmintable under kebab-strict (segment-edge hyphens are rejected).
   (Vectors `encode/noninjective-dashdot`, `encode/noninjective-dotdash` pin the pre-cut defect.)
2. A `_`-bearing method-specific-id leaked `_` into a segment whose charset forbids it. **Closed
   at R**: kebab-strict forbids `_` entirely (RFC-0001 vector `inv/underscore`).
3. `encodeDidSegment` applied no length bound. **Closed at the identifier level** by RFC-0001
   §6.2 (segments 1–63 octets, msi ≤ 255, whole DID ≤ 262); the **subject-level** residue — an
   encoded `@`-segment that exceeds the 63-octet segment cap and inflates the 255-octet subject
   budget — is this document's short-form question, OD-6 below.

**Atomic coupling (hard cut).** The envelope-field DID and the subject `@`-segment derive from
this ONE source (`src/subjects.ts:124`); they are never composed independently, and they flip
**together** at flag-day release R (RFC-0001 §9): RFC-0001 and this document cut over atomically,
per emitter, and MUST NOT be sequenced independently. There is NO dual-accept window and NO
dual-registration for the DID migration; BCP-0001's dual-accept doctrine remains the default for
other wire changes only.

**[OPEN DECISION OD-6 — Andreas + JC — inherited from RFC-0001 §5: the `@`-segment
short-form.]** A fully-qualified agent DID double-encoded into a federated subject repeats the
`{principal}.{stack}` pair the subject already carries —
`federated.{p}.{s}.tasks.@did-mf-agent--{p}--{s}--{assistant}.{capability}` — and, at the
structural maximum (an encoded agent msi alone approaches 200 octets), threatens both the
63-octet segment cap and the 255-octet total-subject budget (§3.1). Decide: full-DID `@`-segment
vs a prefix-relative projection (e.g. encoding only the `{assistant}` under the subject's own
`{principal}.{stack}`). RFC-0001 sets only the identifier-level length caps; the projection is
this document's call.

```abnf
assistant-address = did-subject-segment      ; RFC-0001 (from flag-day R); referenced, not redefined
                  ; pre-cut transcription, retired at R:
                  ; "@" %s"did-mf-" 1*( lower / DIGIT / "-" / "_" )
```

The `_` alternative in the retired pre-cut rule was the faithful transcription of the leak in
finding §7.4, never an endorsement of `_` in a subject segment; from R it is unproducible.

---

## 6. The `tasks` Domain

The `tasks` domain carries capability-routed work. Tasks are competing-consumer envelopes claimed
by qualified agents from the `TASKS` JetStream stream.

### 6.1. The three distribution shapes

```
local.{principal}.{stack}.tasks.{capability}.{subcapability}   ; Offer
local.{principal}.{stack}.tasks.@{assistant}.{capability}      ; Direct / Delegate
local.{principal}.{stack}.tasks.dead-letter.{capability}       ; dead-letter
```

The `federated.` prefix mirrors all three shapes with identical grammar. A federated `tasks`
subject is subject to the envelope sovereignty rules (RFC-0003): an agent originating from
principal A MUST NOT inherit principal B's identity scope when claiming work on B's
`federated.…tasks.>` tree.

```abnf
tasks-type       = offer-type / direct-type / dead-letter-type
offer-type       = %s"tasks." segment *( "." segment )
direct-type      = %s"tasks." assistant-address "." capability
dead-letter-type = %s"tasks.dead-letter." segment
```

- **Offer** — competing consumers. Any qualified agent in the matching consumer group MAY claim.
  The canonical free-form conversational capability is `chat`
  (`local.{principal}.{stack}.tasks.chat`).
- **Direct / Delegate** — named recipient. The `@{assistant}` segment is the DID-encoded address
  of §5. Direct and Delegate share the wire shape; the difference (Delegate's recipient internally
  orchestrates a multi-step outcome and emits the dispatch lifecycle stream of §7) is
  principal-facing, not wire-visible.
- **dead-letter** — escalation for tasks that exhaust `max_deliver` or hit a compliance-block NAK
  (§6.2.3).

### 6.2. Reserved `tasks` segments

Two segment classes inside a `tasks` subject are reserved and a capability tag MUST NOT match
either:

| Pattern | Meaning |
|---|---|
| any segment starting with `@` | a Direct/Delegate assistant address (§5) |
| the literal `dead-letter` | the escalation path |

The `@` reservation is enforced structurally (a capability tag starts with `[a-z]`, never `@`).
The `dead-letter` reservation is **not** enforced: `dead-letter` matches the capability grammar,
and no publish-time validator rejects it, so an ordinary publisher can fabricate a subject
indistinguishable from a genuine dead-letter escalation. That is a finding (§7.3); vector
`capability/reject-dead-letter` binds the intended rejection.

`bid-request` (§7) is a de-facto third reserved `tasks` segment that the reserved table omits —
**[OPEN DECISION OD-5]**.

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

The seed taxonomy (`code-review`, `security-scan`, `deploy`, `release`, `chat`) is informative;
principals MAY extend it. The registered set and its cross-repository reconciliation are deferred
to OD-3 (see §8.5).

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
(`{principal}.{stack}.tasks.>`). A **legacy** 5-segment `tasks` publish (`local.{principal}.tasks.>`)
does not match this filter positionally; emitters targeting the stream MUST publish the
stack-aware shape. This is the concrete wire consequence of the §3.3 ambiguity and of OD-2.
Stream provisioning and consumer lifecycle are M7-owned and out of scope (§1.2).

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

## 7. Dispatch-Observability, Verdict, and Bid-Request Families

Four subject families live only in `src/subjects.ts` + `src/subject-vocabulary.ts` and the
informative `docs/design-agent-task-routing.md`. This document **absorbs their subject shapes**:

```abnf
dispatch-type    = %s"dispatch.task." lifecycle-state
                 / %s"dispatch.bid." bid-event
                 / %s"dispatch." workflow-event
verdict-type     = %s"code.pr." segment "." segment      ; {kind}.{status}
bid-request-type = %s"tasks.bid-request." capability
```

- `local.{principal}[.{stack}].dispatch.task.{state}` — task lifecycle,
  `state` ∈ {received, assigned, started, progress, completed, failed, aborted, rejected}.
- `local.{principal}[.{stack}].dispatch.bid.{event}` — bidding lifecycle,
  `event` ∈ {bid-opened, bid-received, bid-closed, bid-retry, bid-assigned}.
- `local.{principal}[.{stack}].dispatch.workflow.*` — workflow lifecycle, 9 events.
- `local.{principal}[.{stack}].code.pr.{kind}.{status}` — PR verdicts.
- `local.{principal}[.{stack}].tasks.bid-request.{capability}` — bid request.

The subject **shapes** are absorbed here; the **closed enum vocabularies** (`LifecycleState`,
`BidLifecycleEventType`, `WorkflowLifecycleEventType`) currently have no normative home. Whether
RFC-0002 owns them or a future dispatch-observability RFC does is **[OPEN DECISION OD-4]**. The
`bid-request` segment's reservation status is **[OPEN DECISION OD-5]**.

---

## 8. Composing a Subject from Envelope Fields

### 8.1. The derivation

Given an envelope `E` and an optional stack `S`, the NATS subject is derived deterministically.

1. **prefix** — Map `E.sovereignty.classification`: `local` → `local`, `federated` → `federated`,
   `public` → `public`. The prefix MUST equal the mapped classification.
2. **public short-circuit** — If the classification is `public`, the subject is
   `public.{E.type}`. It MUST NOT contain a principal or stack segment.
3. **principal** — Otherwise the principal segment is the first dot-segment of `E.source`.
4. **stack** — If `S` is supplied, the subject is
   `{prefix}.{principal}.{S}.{E.type}` (stack-aware). If `S` is omitted, the subject is
   `{prefix}.{principal}.{E.type}` (legacy). An emitter MAY omit `S` in a first migration step but
   SHOULD emit the stack-aware form (§8.2, OD-2).
5. **Direct/Delegate** — If `E.distribution_mode` selects Direct or Delegate and
   `E.target_assistant` is present, the `tasks` tail is
   `tasks.{encodeDidSegment(E.target_assistant)}.{capability}`, where `capability` is the segment(s)
   of `E.type` after the `tasks.` prefix. (No reference function performs this today — §6.5.)

This transcribes `deriveSubject` (`src/subjects.ts:612-627`) and `deriveNatsSubject`
(`src/envelope.ts:646-653`) exactly, including the `public.{type}` short-circuit and the fact that
`deriveNatsSubject` does **not** re-validate the derived principal segment against any grammar
(§7.2).

The self-asserted `E.source` seeds the subject's principal segment and is **not** cryptographically
bound to the verified `signed_by` chain by this document. Binding it is an RFC-0003 provenance
concern; the exposure is recorded in Security §7.10 and Privacy §12.

**[OPEN DECISION OD-7 — Andreas + JC — co-filed with RFC-0003 (REVISIONS C9; the cortex#1812
class).]** The **authority of the stack segment** is undecided. §8.1 step 4 takes the stack from
a caller-supplied `S`, while the envelope `source` (RFC-0003) may itself carry a stack segment,
and neither document states which is authoritative when the two disagree — or what, if anything,
a receiver may derive a stack identity from. OD-2's default-derivation rule (§8.2) covers only
the *absent*-stack case; this decision covers the *conflicting*-stack case. RFC-0003 defers the
subject-derivation authority question here; the decision is shared 0002/0003. Until it resolves,
a receiver MUST NOT treat the subject's stack segment as authoritative over the envelope's, and
MUST NOT fabricate a stack from either (§8.2).

### 8.2. Default-derivation backward compatibility — scope and hard boundary

A receiver encountering a legacy 5-segment `local.`/`federated.` subject (stack segment absent)
SHOULD, **for subject matching only**, treat it as though the stack segment were `default` — i.e.
match it under `{principal}.default.>`. A subscriber on `{prefix}.{principal}.>` matches both the
legacy and the stack-aware shapes because `>` is multi-segment, so no dual subscription is
required.

This `default` substitution **MUST NOT** be applied to identity resolution, roster membership, or
`stack-id` parsing. An absent stack segment is a **fault** in those contexts, never a `default`:
fabricating `did:mf:{principal}-default` or a `{principal}/default` stack-id from a stack-less
subject is the root cause of **cortex#1812**. `stack-id` parsing is owned by RFC-0001 (`stack-id
= principal-id "/" stack-slug`, where the `/` is required); this document reinforces that a
subject-plane absent-stack MUST NOT be laundered into an identity-plane `default`. Vector
`identity/legacy-stack-not-default` binds the boundary; vector `form/masking-default-stack` is the
masking case that hid the defect (a stack literally named `default` made the fabricated value
coincidentally correct for one party).

Ownership of the legacy form's retirement is split (REVISIONS C6). This document owns the legacy
5-segment subject **grammar and its accept/reject rule** — under what wire rule validators reject
the 5-segment form and the `default`-to-legacy classifier baseline is removed, plus the §3.3
self-describing-marker question — which remains **[OPEN DECISION OD-2 — Andreas + JC]**. The
retirement **release naming**, the migration window, and the mandatory deprecation warning
(promised at `specs/namespace.md` line ~94 but never implemented) belong to **BCP-0001**
(its OD-2); the `TASKS_DEAD` stream-filter alignment belongs to RFC-0007 (its OD-4). A migration
window without a named end is a migration that never ends — the end is named by BCP-0001, not
here. Note that the DID hard cut (RFC-0001 §9) does **not** retire this form: the stack-segment
migration is a separate wire change, and it stays under BCP-0001's default dual-accept doctrine —
the no-dual-accept rule of §5 applies to the DID migration only.

### 8.3. Prefix–classification alignment

A subject's prefix and its envelope's `sovereignty.classification` MUST align (`local.*` ⇄
`local`, `federated.*` ⇄ `federated`, `public.*` ⇄ `public`). A mismatch is a protocol violation.

This alignment is enforced by a **runtime transport guard** (`subjectPrefixAligns` +
`validateSubjectEnvelopeAlignment`), not by the subject grammar, and it compares **only** the
first token — the principal, stack, and type positions are not checked against the envelope. This
is a finding (§7.9). Vectors `prefix/aligns-local` and `prefix/mismatch-rejected` bind the guard.

### 8.4. Federation addressing: receiver-addressed dispatch, source-addressed presence

On the `federated.{principal}.{stack}.>` tree two addressing conventions coexist, and they use the
principal segment differently:

- **Dispatch is receiver-addressed.** A peer dispatching work TO a principal targets
  `federated.{RECEIVER}.{receiver-stack}.…` — the principal segment is the **receiver's**.
- **Presence is source-addressed.** A peer announcing ITS OWN presence publishes
  `federated.{PEER}.{peer-stack}.agent.…` — the principal segment is the **sender's**.

The §8.1 rule ("principal ← first segment of `source`") describes only the source-addressed case.
The receiver-addressed dispatch convention is documented today only in the M7 consumer
(cortex ADR-0007 / `accept-subjects.ts`); a peer implementing from `specs/namespace.md` alone would
mis-address dispatch or reject inbound presence. This document lifts the convention into the
normative record: a federation accept-list MUST admit both the principal's own subtree
(`federated.{ME}.>`, for inbound dispatch) and each admitted peer's subtree
(`federated.{PEER}.>`, for inbound presence). Any code deriving or validating a `federated.*`
subject MUST run the federation-wire-protocol SOP (compass `sops/federation-wire-protocol.md`).

### 8.5. Capability-id grammar divergence with the M7 consumer

The M7 consumer (cortex) validates its runtime capability ids against a `capability-id` grammar —
dotted, underscore-bearing compounds such as `federated.subject_dispatch` and `dev.implement` —
that is **normatively owned by RFC-0008** [RFC-0008] and is referenced here, never transcribed
(one owner per wire rule; grammar/README.md rule 5). Those compounds are **not** expressible as a
myelin single-segment, hyphen-only capability tag (§6.3) nor as an envelope `requirements` entry:
both the `.` and the `_` are rejected by CAPABILITY_TAG_RE. The consumer's capability vocabulary
and the subject-position tag grammar are mutually incompatible on the wire. This document
codifies only the subject-position **tag** grammar (§6.3); the `capability-id` grammar and the
convergence between the two are **[OPEN DECISION OD-3 — Andreas + JC — deferred to RFC-0008, the
normative owner]**. It is not resolved here.

---

## 9. Reserved Prefixes and Segments

The following top-level prefixes are reserved for infrastructure and MUST NOT carry application
signals:

| Prefix | Purpose |
|---|---|
| `_system.` | NATS cluster management |
| `_internal.` | myelin protocol control (health, schema negotiation) |
| `_audit.` | compliance / audit-trail signals |
| `_test.` | test-harness signals, stripped in production |

The following segments are reserved:

| Segment | Where | Purpose |
|---|---|---|
| `_metrics` | first domain segment under `local.{principal}[.{stack}]._metrics.*` | observability streams |
| `dead-letter` | `tasks` capability position | escalation path (§6.2) |
| any `@…` | `tasks` capability position | assistant address (§5) |

Every reserved **underscore** name (`_system`, `_internal`, `_audit`, `_test`, `_metrics`) begins
with `_`, which the `segment` grammar cannot produce (a segment starts with `[a-z]`). Unlike the
`@`-address, which the spec introduces with an explicit grammar-extension clause, the underscore
names have **no** carve-out; they are reserved names that violate the document's own segment
grammar, and the reference `_metrics` emitter reaches them through a validation-bypassing
"trusted-tail" path. This is a finding (§7.7). Enforcement of the reserved-prefix bans against
application publishers is likewise absent.

---

## 10. Registry Considerations

- **RFC number.** `0002`, allocated in [`specs/README.md`](../README.md); numbers are never reused.
- **Classification prefixes.** This document reserves exactly three: `local`, `federated`,
  `public`. Adding a fourth is a wire change requiring a new RFC.
- **Reserved prefixes.** `_system`, `_internal`, `_audit`, `_test` (§9).
- **Inbound reserved-prefix registrations — [OPEN DECISION OD-8 — Andreas + JC].** Two sibling
  RFCs request registration of infrastructure prefixes absent from the §9 table: `_nak.`
  (RFC-0005 — the sovereignty enforcement-NAK subjects, `_nak.sovereignty.>`) and `_INBOX.`
  (RFC-0007 — the NATS request-reply inbox prefix). This document is the reserved-prefix
  registry; adjudicating each registration (admit into the §9 table, rename, or reject) is an
  open decision of this document, giving RFC-0005 OD-6 and RFC-0007 OD-5 a real owner to resolve
  against (REVISIONS C8).
- **Reserved segments.** `_metrics`, `dead-letter`, and the `@`-address class (§9). The
  `bid-request` `tasks` segment is used by the reference implementation but is **not** registered
  here — its reservation is OD-5.
- **Domain names.** `tasks` and `dispatch` carry normative subject shapes (§6, §7) and are
  reserved domain roots.
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
| 7.4 | The `@`-assistant encoding was **not injective** over the deployed flat grammar (`did:mf:a-.b` and `did:mf:a.-b` → `@did-mf-a---b`), **leaked `_`** into a segment whose charset forbids it, and imposed **no length bound**. A prior collision between `did:mf:hub.metafactory` and `did:mf:hub-metafactory` was "a real security boundary violation". **RESOLVED by RFC-0001** (class-explicit dot-form + kebab-strict, pending JC co-signature); closes at flag-day R (§5). Subject-level length residue → OD-6. | format, defective (pre-cut) | high → closed at R | subjects/did-underscore-leaks-into-at-segment; provenance/assistant-segment-encoding-collision — OD-1 RESOLVED |
| 7.5 | The **legacy vs stack-aware** wire form is undecidable from the subject bytes alone; the classifier defaults to `legacy`. Combined with a fabricated `default` stack this produced cortex#1812. | out-of-band hint | critical | subjects/legacy-vs-stack-aware-wire-ambiguity |
| 7.6 | The `≤255`-octet total-subject cap and the `type` 2–5-segment bound are enforced **nowhere** in code; over-long subjects surface as opaque NATS server errors. | nothing | low/med | subjects/total-255-cap-unenforced |
| 7.7 | Reserved underscore names violate the document's own segment grammar with no carve-out, and `sanitizeSubjectToken` preserves uppercase, so `_metrics` subjects can be emitted with uppercase tokens that a strict subscriber-side parser would reject. | trusted-tail bypass | medium | subjects/underscore-reserved-names-outside-grammar; subjects/metrics-subject-uppercase-leak |
| 7.8 | A stack literally named `tasks` (or `dispatch`/`code`) is misparsed by `taskDeadLetterSubject`'s legacy-priority index check, dropping the stack and mislabelling the capability. No stack name is forbidden. | runtime, order-dependent | medium | subjects/stack-named-tasks-misparse |
| 7.9 | Subject↔envelope consistency is checked **only** on the classification prefix (the first token). Principal, stack, and type are never bound to the envelope by this document, and the alignment itself is a runtime transport guard, not a format property. | runtime guard | high | (cross-ref provenance/source-unbound-to-chain) |
| 7.10 | The subject's principal segment derives from the **self-asserted** `E.source`, which is not bound to the verified `signed_by` chain by this document. A validly-signed envelope can claim another principal's subject principal. Binding is an RFC-0003 concern. | not held here | high | provenance/source-unbound-to-chain |

### Threat model

This document assumes an active on-path adversary who can observe every subject and can publish
arbitrary well-formed subjects to any NATS server it can reach, but cannot forge Ed25519
signatures (RFC-0003) and cannot bypass the leaf-node rule that `local.>` is not replicated across
principal boundaries. Under that model the namespace defends the `local`/`federated`/`public`
scope boundary (leaf-node non-replication of `local.>`) and the reserved-prefix space at the
infrastructure layer. It does **not**, by the format alone, defend: capability-grammar uniformity
(7.1), principal-segment authenticity (7.9, 7.10), assistant-address injectivity before the
flag-day cut (7.4 — closed at R by RFC-0001's kebab-strict grammar), the dead-letter escalation
plane's integrity (7.3), or the legacy/stack-aware form's decidability (7.5). Consumers MUST NOT treat a subject's principal segment as an authenticated identity; the
`signed_by` chain (RFC-0003) is the trust anchor.

---

## 12. Privacy Considerations

The subject is metadata that travels in cleartext regardless of payload encryption. Every
`local.`/`federated.` subject discloses, to any party that can observe the transport:

- the **owning principal** (segment 2) — a stable, correlatable identifier across every message
  that principal emits;
- the **stack topology** (segment 3) — how a principal partitions its deployments
  (`research`, `security`, `devops`, …), leaking organisational structure;
- the **capability and domain** vocabulary — what work a principal solicits and performs; and
- for Direct/Delegate tasks, the **assistant DID**, a stable per-assistant identifier that
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
3. Apply the default-derivation `default` substitution (§8.2) **only** to subject matching, and
   reject the identity/roster/stack-id substitution as `invalid` vector
   `identity/legacy-stack-not-default` requires.
4. Treat every finding in §11 that a vector encodes as a **requirement stated by the vector**,
   even where the reference implementation currently fails that vector — a failing reference is a
   defect to fix, not a licence to diverge (specs/CONFORMANCE.md precedence chain: ABNF governs;
   where a generated artifact disagrees, the artifact is the defect).

Where a vector and the ABNF disagree, the ABNF governs and the vector is a defect. Where the ABNF
and this document cannot be made precise (the OPEN DECISIONS), conformance is **undefined** for
those inputs until the blocking decision resolves. OD-1 is resolved by RFC-0001 (class-explicit
dot-form, pending JC co-signature), and the resolved `@`-address behaviour takes effect only at
flag-day release R after ratification — no implementation grounds it on a Draft. An
implementation MUST NOT claim conformance for the `@`-segment short-form projection (OD-6), the
legacy-form retirement boundary (OD-2 — release naming owned by BCP-0001), or stack-segment
authority (OD-7) behaviour on the strength of this Draft.

---

## 14. References

### 14.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Draft. Owns the identifier terminals (`segment`, `principal-id`, `stack-slug`, `stack-id`, `did`, `did-subject-segment`/`encoded-msi`) this document references. Resolves OD-1 (class-explicit dot-form, ratified by the principal 2026-07-12, pending JC co-signature) and owns the hard-cut migration (its §9), with which this document's `@`-segment cutover is atomic (§5). Defers the `@`-segment short-form question here (OD-6).
- [RFC-0003] metafactory, "Envelope", Draft. Owns the envelope fields (`source`, `type`, `target_assistant`, `distribution_mode`, `sovereignty.classification`, `requirements`) that §8's derivation consumes. Co-files OD-7 (stack-segment authority) with this document.
- [RFC-0008] metafactory, "Capability Discovery and Advertisement", Draft. Normative owner of the `capability-id` grammar and the capability-set reconciliation referenced in §8.5 (OD-3).

### 14.2. Informative References

- [NAMESPACE] metafactory, `specs/namespace.md` — "Myelin NATS Namespace Convention", Version 1.0.0. The prose this RFC promotes (`supersedes_prose`).
- [TASK-ROUTING] metafactory, `docs/design-agent-task-routing.md` — the `tasks` domain design record (Pattern 4, chosen 2026-05-09). Informative; its pre-namespace `subjects: ["tasks.>"]` sketch is superseded by §6.4.
- [ADR-0007] cortex, "Federation accept-list addressing" (`src/bus/agent-network/accept-subjects.ts`) — the receiver-addressed-dispatch / source-addressed-presence convention lifted into §8.4.
- [ADR-0002] cortex, "Federated dispatch addressing and verdict-back" — the `did:mf:{principal}-{stack}` requester-DID convention that intersects the `@`-encoding.
- [BCP-0001] metafactory, "Wire Change Control and Versioning", Best Current Practice, Draft. Owns the legacy-form retirement window, release naming, and deprecation-warning mandate (§8.2, OD-2 split), and the dual-accept default that the DID migration's hard cut deliberately overrides (§5).
- [RFC-0005] metafactory, "Sovereignty and Boundary Crossing", Draft. Requests registration of the `_nak.` reserved prefix (§10, OD-8).
- [RFC-0007] metafactory, "Transport and Reliability", Draft. Requests registration of the `_INBOX.` prefix (§10, OD-8); owns the `TASKS_DEAD` stream-filter alignment side of the legacy-form retirement (§8.2).
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

subject            = local-subject / federated-subject / public-subject
local-subject      = %s"local." principal-body
federated-subject  = %s"federated." principal-body
public-subject     = %s"public." type

principal-body     = principal "." [ stack "." ] type
principal          = segment                 ; validated as `segment`, NOT
                                             ; RFC-0001 principal-id (§7.2)
stack              = stack-slug              ; RFC-0001
segment            = stack-slug              ; deployed transcription
                                             ; /^[a-z][a-z0-9-]{0,62}$/;
                                             ; tightens to kebab-strict at R (§3.1)
type               = segment *( "." segment )
alnum              = lower / DIGIT

; tasks domain (§6)
tasks-type         = offer-type / direct-type / dead-letter-type
offer-type         = %s"tasks." segment *( "." segment )
direct-type        = %s"tasks." assistant-address "." capability
dead-letter-type   = %s"tasks.dead-letter." segment
capability         = lower ( 1*alnum *( "-" alnum-run ) / 1*( "-" alnum-run ) )
alnum-run          = 1*alnum
assistant-address  = did-subject-segment     ; RFC-0001 (from flag-day R); referenced,
                                             ; not redefined. Pre-cut transcription,
                                             ; retired at R (its "_" alt was the
                                             ; transcribed leak of §7.4):
                                             ; "@" %s"did-mf-" 1*( lower / DIGIT / "-" / "_" )

; dispatch / verdict / bid-request (§7) — SHAPES absorbed; enums = OD-4
dispatch-type      = %s"dispatch.task." lifecycle-state
                   / %s"dispatch.bid." bid-event
                   / %s"dispatch." workflow-event
verdict-type       = %s"code.pr." segment "." segment
bid-request-type   = %s"tasks.bid-request." capability
lifecycle-state    = %s"received" / %s"assigned" / %s"started" / %s"progress"
                   / %s"completed" / %s"failed" / %s"aborted" / %s"rejected"
bid-event          = %s"bid-opened" / %s"bid-received" / %s"bid-closed"
                   / %s"bid-retry" / %s"bid-assigned"
workflow-event     = %s"workflow.started" / %s"workflow.resumed"
                   / %s"workflow.recovered" / %s"workflow.step.started"
                   / %s"workflow.step.completed" / %s"workflow.step.failed"
                   / %s"workflow.step.skipped" / %s"workflow.completed"
                   / %s"workflow.failed"

; reserved (§9)
reserved-subject   = reserved-prefix "." type
reserved-prefix    = %s"_system" / %s"_internal" / %s"_audit" / %s"_test"
reserved-segment   = %s"_metrics" / %s"dead-letter"
metrics-type       = %s"_metrics.transport." metrics-token
metrics-token      = ( lower / DIGIT ) *( lower / DIGIT / "-" / %x41-5A )
                                             ; %x41-5A = A-Z, an uppercase leak (§7.7)

; subscription patterns (§4) — MAY carry wildcards; `subject` MUST NOT
sub-pattern        = ( sub-token *( "." sub-token ) [ "." ">" ] ) / ">"
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
  `.`/`-` pair); `encode/noninjective-dashdot` vs `encode/noninjective-dotdash` (the pre-cut
  `-.`/`.-` → `---` collision — formerly gated on OD-1, now closed by RFC-0001's kebab-strict
  rule from flag-day R, both inputs unmintable); `deadletter/stack-named-tasks-misparse` (the
  stack-named-`tasks` collision).
- **Legal-in-one-illegal-in-another** — `capability/reject-single-char`,
  `capability/reject-trailing-hyphen` (valid to the offer builder, invalid to the bid builder);
  `atsegment/underscore-rejected` (produced by the encoder, rejected by the `@`-grammar);
  `identity/legacy-stack-not-default` (legal to match, illegal to resolve to identity).

```json
[
  {
    "id": "identity/legacy-stack-not-default",
    "rfc": 2,
    "kind": "resolveStackForIdentity",
    "input": { "subject": "local.acme.tasks.chat" },
    "expect": { "ok": false, "reason": "stack-absent-not-default" },
    "why": "ROOT CAUSE cortex#1812. The default-derivation SHOULD is subject-matching-only; an absent stack MUST NOT be fabricated into `default` for identity resolution / roster / stack-id (§8.2)."
  },
  {
    "id": "form/masking-default-stack",
    "rfc": 2,
    "kind": "detectSubjectForm",
    "input": { "subject": "local.acme.default.tasks.chat" },
    "expect": { "ok": true, "value": { "form": "legacy" } },
    "why": "MASKING CASE. Undecidable without a hint; defaults to legacy and the fabricated `default` coincidentally matches — the silent failure behind cortex#1812."
  },
  {
    "id": "encode/noninjective-dashdot",
    "rfc": 2,
    "kind": "encodeDidSegment",
    "input": "did:mf:a-.b",
    "expect": { "ok": true, "value": "@did-mf-a---b" },
    "why": "NON-INJECTIVITY COLLISION (half 1, pre-cut). Encodes identically to did:mf:a.-b — the bare injectivity claim was false over the deployed flat grammar. OD-1 RESOLVED by RFC-0001 (class-explicit dot-form + kebab-strict, cortex#1880): from flag-day R both inputs are unmintable and the vector pins the pre-cut defect."
  }
]
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes
ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Promotes `specs/namespace.md`. Adds the collected ABNF (`subject-namespace.abnf`), the starter vector set, and the Registry / Security / Privacy / Conformance sections. Records 10 findings (§11) and 5 open decisions (OD-1..OD-5). |
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

metafactory M3 working group. Ratification signatories (principal + hub custodian) to be recorded
in `signatories` on move to `Ratified`.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/