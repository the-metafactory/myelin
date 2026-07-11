---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0007
title: Transport and Reliability
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
grammar: specs/grammar/transport.abnf
vectors: specs/vectors/transport/
generated:
  - []
supersedes_prose:
  - docs/nak-reasons.md
---

# RFC-0007: Transport and Reliability

## Abstract

This document specifies the delivery and reliability layer of the myelin wire protocol: the vocabulary and carriage of negative acknowledgements (NAKs), redelivery backoff, dead-letter escalation, the request-reply correlation protocol, and the `correlation_id` that joins related envelopes across a workflow. It defines the closed four-value NAK reason set and its two carriage channels, the dead-letter subject and its reserved segment, the `_INBOX` reply-mailbox convention, and the syntax and defaulting of `correlation_id`. Today these behaviours exist only as reference code and informative documentation, spelled three inconsistent ways across two repositories with no conformance vectors; this document makes them a single normative contract and records, rather than silently encodes, the defects that condition has produced.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** and **the hub custodian**, recorded in `signatories`. A wire contract binds more than one party; it cannot be ratified by one.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
2. Protocol Overview
3. The NAK Reason Vocabulary
4. Redelivery and Backoff
5. Dead-Letter Routing
6. The Rejection Lifecycle Event
7. Request-Reply
8. Correlation Identifier
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

The myelin transport (layer M2) provides an abstract bus with pub/sub and request/reply semantics over NATS and JetStream. Above raw delivery it provides a **reliability layer**: a structured way for a consumer to refuse a task (a NAK), a deterministic redelivery backoff, an escalation path for tasks that can never be claimed (dead-letter), a request/reply round-trip, and an identifier (`correlation_id`) that stitches an envelope's excursions — rejection, dead-letter, reply — back into one joinable chain.

This layer is, at time of writing, **code-only**. Its vocabulary — the four NAK reasons that drive retry-versus-dead-letter routing — lives as a TypeScript union and informative prose, and is already spelled three different ways: myelin's canonical kebab-case set, cortex's snake_case five-value discriminated-object set (with an extra value, `policy_denied`), and cortex's own documentation stating the snake_case set with an RFC 2119 `MUST`. The request-reply protocol appears in no document, schema, or specification at all. There are no conformance vectors. This is exactly the "fourth independent implementation of an unspecified grammar" condition that [`specs/CONFORMANCE.md`](../CONFORMANCE.md) exists to end.

This document specifies that layer as one normative contract.

**What this document does not solve.** It does not specify the envelope shape, signing, or the signable/mutable field boundary (RFC-0003 and the envelope-signing RFC); the subject namespace grammar beyond the dead-letter and `_INBOX` segments it reserves (RFC-0002); identifier terminals (RFC-0001); or the sovereignty/compliance engine that produces `compliance-block` refusals. It references those documents; it does not restate them.

**Promoted prose.** This document promotes [`docs/nak-reasons.md`](../../docs/nak-reasons.md) — the de-facto protocol document for the NAK vocabulary — from informative to normative (listed in `supersedes_prose`). The request-reply protocol has no prose to promote; it is specified here for the first time.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.2. Terminology

- **NAK** (verb *to nak*): a consumer's negative acknowledgement of a delivered JetStream message, requesting redelivery. Carried on the wire by the NATS `nak(delayNs)` protocol operation.
- **NAK reason**: a member of the closed set defined in §3.1 that classifies *why* a task was refused, driving retry-versus-dead-letter routing.
- **In-process header channel**: the NATS message headers `Myelin-Nak-Reason` / `Myelin-Nak-Description`, appended by the consumer before it naks. Visible only to in-process observers; does **not** survive nak-redelivery (§3.2).
- **Durable channel**: the `dispatch.task.rejected` lifecycle envelope (§6) — the only cross-process record of a rejection.
- **Dead-letter**: the escalation of a task that can never be claimed — either because retries are exhausted or because it was refused with `compliance-block` — onto a reserved subject for principal review (§5).
- **Exhaustion**: the dead-letter trigger where the accumulated NAK chain (excluding `not-now`) reaches the exhaustion threshold.
- **Fast path**: the dead-letter trigger where a single `compliance-block` NAK routes immediately, skipping remaining retries.
- **`delivery_count`**: JetStream's per-message redelivery counter (`msg.info.deliveryCount`), incremented on every delivery regardless of NAK reason.
- **`max_deliver`**: the JetStream consumer's server-side redelivery cap.
- **`correlation_id`**: a UUID (§8) that links related envelopes across a workflow. A **mutable** envelope field, excluded from every signature.
- **Reply mailbox / `_INBOX`**: an ephemeral core-NATS subject (`_INBOX.{uuid}`) to which a request's reply is addressed (§7). Bypasses JetStream; not persisted.
- **`reply_to`**: the `extensions.reply_to` field carrying the reply mailbox subject.
- **JetStream / core NATS**: the persistent (at-least-once, acked, stored) and the ephemeral (fire-and-forget, unpersisted) delivery modes of the underlying bus, respectively.

Identifier terminals (`principal-id`, `stack-slug`, `did`, the `@`-assistant encoding) are defined in RFC-0001; subject-namespace terminals (`capability-tag`, subject prefixes, reserved segments) in RFC-0002. This document cites them by name.

---

## 2. Protocol Overview

The reliability layer is four sub-protocols that share one identifier (`correlation_id`):

1. **NAK** (§3, §4). A consumer refuses a delivered task with one of four reasons on two channels: an in-process header hint and a durable lifecycle event. `not-now` triggers deterministic exponential backoff; the other three are immediate-redeliver, with consumer-side routing deciding retry versus escalation.
2. **Dead-letter** (§5). Tasks that exhaust their retry budget (`cant-do`/`wont-do`) or hit a `compliance-block` are wrapped under `extensions.dead_letter` and republished to a reserved `dead-letter` subject, followed by a terminal `dispatch.task.failed` lifecycle event.
3. **Rejection lifecycle event** (§6). `dispatch.task.rejected` — the durable, cross-process record of a NAK, consumed by threshold-review, audit, and the dead-letter handler.
4. **Request-reply** (§7). A caller stamps `extensions.reply_to` with a concrete `_INBOX.{uuid}` mailbox, subscribes it, publishes the request, and settles on the first reply whose `correlation_id` matches. `_INBOX` traffic bypasses JetStream.

All four preserve `correlation_id` (§8) so an observer can join a task across every excursion.

The normative wire STRINGS of this layer (the NAK reason tokens, header names, `correlation_id`, the dead-letter subject, the `_INBOX` mailbox) are given as ABNF in Appendix A and the standalone `specs/grammar/transport.abnf`. The JSON payload SHAPES (§5.3, §5.4, §6.1) are specified as normative field tables; the envelope treats `payload` and `extensions` as opaque, so these shapes have no JSON-Schema home and are normative here.

---

## 3. The NAK Reason Vocabulary

### 3.1. The canonical reason set

The NAK reason set is **closed** and consists of exactly four values. Its canonical spelling is kebab-case:

```abnf
nak-reason = "cant-do" / "wont-do" / "not-now" / "compliance-block"
```

An emitter of a NAK reason — in a header value, a `RejectedPayload.reason`, a `FailedPayload.nak_reason`/`final_reason`, or a `DeadLetterExtension.final_nak_reason`/`nak_chain` element — MUST render exactly one of these four tokens, in the canonical kebab-case spelling. An implementation MUST NOT emit any other spelling of these values, and MUST NOT emit any value outside this set, as a conformant NAK reason.

| Reason | Meaning | Consumer routing (normative, §5.1) |
|---|---|---|
| `cant-do` | Static capability mismatch — the agent lacks the tool, environment, or reach. | Retry until the exhaustion threshold, then dead-letter. |
| `wont-do` | Sovereignty / policy refusal — the agent is capable but declines. | Retry until the exhaustion threshold, then dead-letter. |
| `not-now` | Transient load / at-capacity. | Redeliver with exponential backoff (§4.1); MUST NOT count toward exhaustion. |
| `compliance-block` | M7 attestation refusal (trifecta gate, expired credential, unapproved tool). | Immediate dead-letter, fast path (§5.1); MUST NOT be retried against the same policy. |

> Provenance (informative): `NakReason`, myelin `src/lifecycle/types.ts:6`; routing table, `docs/nak-reasons.md`.

**Unknown or missing reason.** A receiver that reads a NAK reason value outside this set, or finds none where one is expected, SHOULD treat it as `cant-do`. This is the least-surprising disposition (it neither escalates immediately as `compliance-block` nor exempts from exhaustion as `not-now`). The rule originates in the F-022 design intent but is currently implemented nowhere in myelin or cortex (each consumer improvises — cortex maps unknown kinds to `null`); it is promoted to normative here. See §3.4 and OPEN DECISION OD-1.

### 3.2. Two-channel carriage

A NAK reason is carried on **two channels with different scopes**. An implementation MUST NOT conflate them.

**Channel 1 — in-process headers (a local hint).** Before it naks, a consumer MAY append the NATS message headers:

```
Myelin-Nak-Reason: cant-do | wont-do | not-now | compliance-block
Myelin-Nak-Description: <free-form, optional>
```

The `Myelin-Nak-Reason` value MUST be a canonical `nak-reason` (§3.1). These headers are visible only to **in-process** observers (the consumer's own logging/metrics middleware). NATS does **not** republish consumer-appended headers when JetStream redelivers a nak'd message; therefore these headers do **not** survive redelivery, and a cross-process consumer (the dead-letter handler, threshold-review) MUST NOT rely on them.

> Provenance (informative): `NAK_REASON_HEADER`/`NAK_DESCRIPTION_HEADER`, myelin `src/transport/nak.ts:63-64`; scope rule, `docs/nak-reasons.md`.

**Channel 2 — the durable lifecycle event (cross-process truth).** The async NAK path (`nakWithReason`) publishes a `dispatch.task.rejected` lifecycle envelope (§6). This is the **only** durable, cross-process record of *why* a task was rejected, and it is the channel a cross-process consumer MUST use.

The two channels are not equivalent. The synchronous NAK path (`nakWithReasonSync`), including the transport's default handler-error path (§4), writes the header hint and naks but emits **no** lifecycle event. NAKs issued on the synchronous path are therefore invisible to every cross-process consumer. See §6.2 and Security Considerations §10 ("S5").

### 3.3. Emission and NAK-fires-regardless

The reliability of redelivery MUST NOT be coupled to the observability of the reason. Concretely: the NAK (the `nak(delayNs)` operation) MUST fire even when durable lifecycle emission fails, stalls, or is skipped. The reference async path enforces this by racing the best-effort lifecycle publish against a 2-second timeout and then naking unconditionally.

### 3.4. Non-canonical spellings (aliases) — OPEN DECISION

Three non-canonical renderings of this vocabulary ship on the live wire today. They are **aliases**, recorded here for interoperability, and are **not** part of the canonical grammar:

- **cortex snake_case, object carrier, extra value.** `cortex src/bus/dispatch-events.ts` defines `DispatchTaskFailedReason` as a five-member snake_case discriminated union — `policy_denied | cant_do | wont_do | not_now | compliance_block` — carried on `dispatch.task.failed` `payload.reason.kind` (an object with `detail`/`deny`/`retry_after_ms`), not on the kebab string field myelin emits.
- **cortex documentation.** `cortex docs/architecture.md` states "the reason MUST be one of: `cant_do`, `wont_do`, `not_now`, `compliance_block`" — an RFC 2119 `MUST` on the snake_case spelling, contradicting the canonical wire spelling.
- **myelin's own admission spec.** `specs/admission.md` §7 mandates `reason: { kind: "not_now", detail, retry_after_ms }` — snake_case, matching cortex's shape, not myelin's.

> **[OPEN DECISION — Andreas + JC (hub custodian) — blocked on the cross-repo nak-vocabulary reconciliation; no issue filed yet (see audit finding `transport/nak-vocab-cross-repo-drift`).]**
>
> This RFC fixes the **canonical** spelling as kebab-case (§3.1) but does **not** resolve: (a) whether `policy_denied` is a genuine fifth canonical value (requiring addition everywhere) or an alias of `wont-do`/`compliance-block`; (b) which carrier shape wins — the kebab string `nak_reason` field or the snake object `reason: { kind, detail, retry_after_ms }` (OD-2); and (c) the dual-accept window and named retirement release for the snake_case alias, per [`specs/CONFORMANCE.md`](../CONFORMANCE.md) "Changing the wire".
>
> The drift is live, not cosmetic: cortex's failed-dispatch projection recognises only snake_case `payload.reason.kind`, while myelin's dead-letter handler emits a kebab-case `nak_reason` string and no `reason` object — so a myelin-emitted `compliance-block` dead-letter failure falls through to `null` and is classified **high** instead of **critical**. Until this decision lands, the two repositories do not interoperate on the failed-dispatch severity path.

### 3.5. A second, distinct vocabulary (disambiguation)

Myelin carries a second closed NAK vocabulary that MUST NOT be confused with `nak-reason`: the sovereignty engine's `NakReasonCode`, a six-value set of `compliance-block:` sub-codes (`classification-mismatch`, `residency-violation`, `unknown-principal`, `scope-exceeded`, `chain-invalid`, `partner-unknown`; `src/sovereignty/types.ts`). These sub-codes refine a `compliance-block` reason; they are **not** members of `nak-reason`. The repository glossary (`CONTEXT.md`) currently conflates the two — it cites `not-now` as an example `NakReasonCode`, which it is not. This document defines only `nak-reason`; the relationship by which a `NakReasonCode` sub-code rides the wire alongside a `nak-reason` on a rejection is specified in neither repository and is out of scope here.

---

## 4. Redelivery and Backoff

### 4.1. `not-now` backoff

A `not-now` NAK MUST redeliver with an exponential backoff delay that is a **pure deterministic function of `delivery_count`** — no process-local state, so it survives consumer restarts. The delay is:

```
delay_ms(delivery_count) = min( 1000 * 2^(clamp(delivery_count, 1, 31) - 1), 60000 )
```

yielding:

| `delivery_count` | Delay |
|---|---|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6 | 32s |
| 7+ | 60s (cap) |

`delivery_count` MUST be clamped to a minimum of 1 (a caller passing 0 sees the 1s initial delay). The delay is applied via `nak(delayNs)` with `delayNs = delay_ms * 1_000_000`.

> Provenance (informative): `NAK_BACKOFF` and `backoffMsForDelivery`, myelin `src/transport/nak.ts:66-94`; table, `docs/nak-reasons.md`.

The other three reasons (`cant-do`, `wont-do`, `compliance-block`) redeliver immediately (`nak()` with no delay); consumer-side routing (§5) decides retry versus escalation.

### 4.2. `not-now` and `max_deliver` — OPEN DECISION

A `not-now` NAK MUST NOT count toward the dead-letter exhaustion threshold (§5.1): transient overload is not a failure signal, and dead-lettering on it surfaces the wrong incident class.

This requirement is honoured by the dead-letter handler (which excludes `not-now` from its chain) but is **unenforceable at the JetStream layer beneath it**: `max_deliver` is a server-side consumer knob that counts *every* delivery regardless of NAK reason. Under the reference consumer configuration (`max_deliver: 3`, `specs/namespace.md`), a task nak'd `not-now` three times exhausts JetStream's redelivery; because the handler excludes `not-now` from exhaustion, it never routes the task to dead-letter — the task terminates with **no dead-letter envelope and no terminal `dispatch.task.failed`**. This is silent task loss, and it makes backoff-curve rows 4–7 (§4.1) unreachable under the reference config.

> **[OPEN DECISION — Andreas + JC (hub custodian) — blocked on the consumer-configuration contract; no issue filed (see audit finding `transport/not-now-exclusion-unenforceable-at-jetstream`).]**
>
> To honour §4.2 without silent loss, a JetStream consumer serving tasks MUST NOT be configured such that `max_deliver` can be reached by `not-now` NAKs before the dead-letter handler's exhaustion threshold is reached for `cant-do`/`wont-do`. The concrete rule — a high or unbounded `max_deliver` with dead-letter routing owning termination, versus a distinct delivery mechanism for `not-now` that JetStream does not count — is undecided. This RFC records the defect; it does **not** ratify the status quo as correct.

---

## 5. Dead-Letter Routing

### 5.1. Routing triggers

A dead-letter route is triggered by exactly one of two conditions, evaluated per `(correlation_id, consumer)` NAK chain:

1. **Fast path.** A `compliance-block` NAK MUST route to dead-letter immediately, at any chain length, skipping remaining retries. (Different agents share the M7 policy that refused, so redelivery would only burn budget.)
2. **Exhaustion.** A `cant-do` or `wont-do` NAK is appended to the chain; when the chain length reaches the **exhaustion threshold** the task MUST route to dead-letter. A `not-now` NAK MUST NOT be appended to the chain and MUST NOT trigger a route (§4.2).

The exhaustion threshold defaults to **3** and MUST be kept aligned with the serving JetStream consumer's `max_deliver` (subject to OD-3, §4.2). The dead-letter route emits, in order: (a) the dead-letter envelope (§5.3) on the dead-letter subject (§5.2), then (b) a terminal `dispatch.task.failed` lifecycle event (§5.4).

> Provenance (informative): `DeadLetterHandler.shouldRoute`/`onRejection`, myelin `src/transport/dead-letter.ts:277-380`.

### 5.2. The dead-letter subject and the reserved segment

The dead-letter subject preserves the original task's prefix, principal, optional stack, and capability, inserts the reserved `dead-letter` segment, and **drops the subcapability**:

```abnf
subject-prefix      = "local" / "federated"
dead-letter-segment = "dead-letter"
dead-letter-subject = subject-prefix "." principal-id
                      [ "." stack-slug ]
                      ".tasks." dead-letter-segment "." capability-tag
```

`principal-id` and `stack-slug` are RFC-0001 terminals; `capability-tag` is an RFC-0002 terminal. The full task-subject grammar is co-owned with RFC-0002; this document owns the reserved `dead-letter` segment and the escalation shape.

Derivation from an original task subject MUST:

- preserve `subject-prefix`, `principal-id`, and (if present) `stack-slug`;
- drop the subcapability segment (`code-review.typescript` → `code-review`);
- insert `dead-letter` before the capability;
- be **idempotent** — re-deriving an already-dead-letter subject is a no-op;
- reject (throw, never fabricate) a subject with no `tasks` segment.

Examples: `local.acme.tasks.code-review.typescript` → `local.acme.tasks.dead-letter.code-review`; `local.acme.default.tasks.code-review.typescript` → `local.acme.default.tasks.dead-letter.code-review`.

**Reserved segment.** `dead-letter` is a reserved segment inside the `tasks` domain: a `capability-tag` MUST NOT equal `dead-letter`, and an emitter MUST reject such a tag at publish time. This reservation guarantees the escalation tree can never collide with real work. **It is currently held by no runtime guard** — `dead-letter` matches `CAPABILITY_TAG_RE`, and `taskSubject('acme','dead-letter')` mints a work subject inside the escalation tree. This is a finding, recorded in Security Considerations §10 ("S4"); the enforcement belongs with RFC-0002, which owns `capability-tag`.

**Legacy vs stack-aware form and the stream-filter defect.** The deriver accepts both the legacy 5-segment form (no stack) and the stack-aware 6-segment form; the `TASKS_DEAD` JetStream stream (30-day audit retention) is provisioned with the legacy filters `local.*.tasks.dead-letter.>` / `federated.*.tasks.dead-letter.>`. A stack-aware dead-letter subject does **not** match those filters (the `*` binds the principal, then the literal `tasks` fails against the stack segment), so dead-letter envelopes from any stack-aware deployment never land in `TASKS_DEAD`, and the audit retention silently does not apply to the spec's primary form. See OPEN DECISION OD-4.

> **[OPEN DECISION — Andreas + JC (hub custodian) — blocked on RFC-0002 dead-letter grammar + migration window (audit finding `transport/dead-letter-stream-misses-stack-aware-subjects`).]** Retire the legacy no-stack acceptance and align the `TASKS_DEAD` filters to the stack-aware grammar, under a dual-accept window.

### 5.3. The `extensions.dead_letter` wrapper

A dead-letter envelope wraps the original under `extensions.dead_letter` (a `DeadLetterExtension`) with a **fresh `id` and `timestamp`** (it is its own message) and the **`correlation_id` preserved** (`original.correlation_id ?? original.id` — §8.2; it is still the same logical task). The wrapper fields:

| Field | Type | Requirement |
|---|---|---|
| `original_subject` | string | REQUIRED. The task subject the envelope was refused on. |
| `originating_consumer` | string | REQUIRED. The consumer whose chain exhausted (or `"unknown"`). |
| `delivery_count` | integer | REQUIRED. JetStream `delivery_count` at the routing decision. |
| `nak_chain` | array of `nak-reason` | REQUIRED. The accumulated reasons. |
| `final_nak_reason` | `nak-reason` | REQUIRED. The reason that triggered the route. |
| `dead_lettered_at` | ISO-8601 string | REQUIRED. |
| `route_trigger` | `"exhaustion"` / `"compliance-block"` | OPTIONAL. Distinguishes fast path from exhaustion. |

`extensions` is an **unsigned, mutable, unbounded** channel (excluded from every signature; `additionalProperties: true`, no size cap — see the envelope-signing RFC and RFC-0003). An intermediary can therefore alter a `dead_letter` wrapper without invalidating any stamp; see Security Considerations §10 ("S7").

> Provenance (informative): `DeadLetterExtension`/`createDeadLetterEnvelope`, myelin `src/transport/dead-letter.ts:30-127`.

### 5.4. The terminal `dispatch.task.failed` event

After publishing the dead-letter envelope, the handler MUST emit a terminal `dispatch.task.failed` lifecycle event (subject per §6) carrying a `DeadLetterFailedPayload`:

| Field | Type | Requirement |
|---|---|---|
| `task_id` | string | REQUIRED. |
| `correlation_id` | `correlation-id` | REQUIRED (§8). |
| `distribution_mode` | string | REQUIRED. |
| `final_reason` | `nak-reason` | REQUIRED. |
| `nak_chain` | array of `nak-reason` | REQUIRED. |
| `delivery_count` | integer | REQUIRED. |
| `dead_letter_subject` | string | REQUIRED. |
| `originating_consumer` | string | REQUIRED. |
| `route_trigger` | `"exhaustion"` / `"compliance-block"` | REQUIRED. |
| `nak_reason` | `nak-reason` | OPTIONAL (kebab string; the canonical carrier — see OD-2). |

The reason is carried here as the kebab-case string field `final_reason` (and `nak_reason`). It is **not** carried as the snake_case `reason: { kind, detail, retry_after_ms }` object that `specs/admission.md` §7 mandates and that only cortex defines; that carrier-shape conflict is OPEN DECISION OD-2 (§3.4).

> Provenance (informative): `DeadLetterFailedPayload`, myelin `src/lifecycle/types.ts:89-97`; emission, `src/transport/dead-letter.ts:338-356`.

---

## 6. The Rejection Lifecycle Event

### 6.1. `dispatch.task.rejected` payload

The durable channel (§3.2) is a `dispatch.task.rejected` lifecycle envelope, published on the subject:

```
local.{principal}[.{stack}].dispatch.task.rejected
```

(the stack segment optional; the subject family is owned by the dispatch-lifecycle grammar and co-referenced by RFC-0002). Its payload is a `RejectedPayload`:

| Field | Type | Requirement |
|---|---|---|
| `task_id` | string | REQUIRED. `envelope.id` of the refused task. |
| `correlation_id` | `correlation-id` | REQUIRED. `envelope.correlation_id ?? envelope.id` (§8.2). |
| `distribution_mode` | string | REQUIRED. |
| `identity` | `did` | REQUIRED. DID of the rejecting agent (RFC-0001). |
| `reason` | `nak-reason` | REQUIRED (§3.1). |
| `description` | string | OPTIONAL. Free-form (§3.2). A leakage surface — §11. |
| `delivery_count` | integer | REQUIRED. |
| `originating_consumer` | string | OPTIONAL. |
| `original_subject` | string | OPTIONAL. |
| `original_envelope` | envelope | OPTIONAL. The **entire** original envelope, payload included (§11). |

> Provenance (informative): `RejectedPayload`, myelin `src/lifecycle/types.ts:105-113`; construction, `src/transport/nak.ts:128-176`.

Consumers of this event include threshold-review (per-agent/per-task rejection velocity, for velocity-class harm detection), audit / chain-of-stamps, and the M7 surface-router (which may route `compliance-block` rejections to a paging surface). The dead-letter handler (§5) is itself a consumer of this channel.

### 6.2. Delivery guarantee (finding)

`dispatch.task.rejected` is emitted **best-effort**: the reference async path races the publish against a 2-second timeout and, on failure or stall, logs to `console.error` and naks anyway. The synchronous path (including the transport's default handler-error NAK) emits **nothing**. No stronger delivery guarantee (at-least-once, durable-queue-before-nak) is specified.

The audit trail for rejections is therefore structurally lossy, and the loss is invisible on the wire (the NAK still fires). This document does **not** specify a delivery guarantee for this channel; it records the gap. An implementation that relies on `dispatch.task.rejected` for a security or safety control (e.g. threshold-review as a harm brake) MUST account for its best-effort nature. See Security Considerations §10 ("S5").

---

## 7. Request-Reply

### 7.1. The reply mailbox and `reply_to`

A requester MUST:

1. determine the correlation id (§8.2): `envelope.correlation_id` if present, else a fresh value;
2. stamp `extensions.reply_to` with a **concrete, wildcard-free** reply mailbox subject;
3. **subscribe the mailbox before publishing** the request;
4. publish the request on the request subject;
5. settle on the first reply whose `correlation_id` equals the request's (§7.2).

The reply mailbox this layer mints is `_INBOX.{uuid}` (`reply-inbox` in Appendix A). A caller MAY supply its own `reply_to`; if supplied, it MUST satisfy the injection guard — it MUST start with `_INBOX.`, MUST NOT contain `*` or `>`, and MUST NOT equal bare `_INBOX.`. A `reply_to` that fails the guard MUST be rejected synchronously, before any subscribe. (`accepted-reply-to` in Appendix A.)

> Provenance (informative): `executeRequestReply`, myelin `src/transport/request-reply.ts:79-176`; guard, lines 94-106.

### 7.2. Correlation matching, timeout

The requester's inbox handler MUST filter incoming envelopes by exact `correlation_id` equality; a reply whose `correlation_id` does not match MUST be silently dropped. The request MUST settle (resolve) on the first matching reply, or reject after a timeout. The default timeout is **5000 ms** (`DEFAULT_REQUEST_TIMEOUT_MS`); a caller MAY override it. On timeout the requester MUST reject with an error naming the request subject and MUST tear down the inbox subscription. The subscription MUST also be torn down on settle and on publish failure.

### 7.3. Responder obligations

A responder that receives an envelope carrying `extensions.reply_to` and elects to reply MUST publish its reply to that `reply_to` subject with a `correlation_id` equal to the request's `correlation_id`. **This obligation is specified here for the first time**: no myelin source reads `extensions.reply_to`, so the responder half of the protocol has, to date, been purely implicit. A conformant responder implementation MUST implement it.

### 7.4. `_INBOX` routing and namespace reservation

A subject beginning `_INBOX.` MUST be published via **core NATS**, bypassing JetStream: reply mailboxes are short-lived, point-to-point, and MUST NOT be persisted. This makes the delivery guarantee of a publish depend on a string prefix of its subject — the same `publish` API yields at-least-once persistence for a normal subject and fire-and-forget for an `_INBOX.` subject.

The `_INBOX.` prefix is **not** reserved in the subject namespace: `specs/namespace.md` reserves `_metrics` but not `_INBOX`. An application subject colliding with the prefix would be silently un-persisted. This document REQUIRES the reservation and defers its home to RFC-0002. See OPEN DECISION OD-5 and Security Considerations §10 ("S3").

> **[OPEN DECISION — Andreas + JC (hub custodian) — blocked on RFC-0002 (Subject Namespace) (audit finding `transport/inbox-prefix-not-reserved-in-namespace`).]** Add `_INBOX.` to the namespace's reserved prefixes.

---

## 8. Correlation Identifier

### 8.1. Syntax

`correlation_id` is a canonical UUID string:

```abnf
correlation-id = uuid
uuid           = 8hexlc "-" 4hexlc "-" 4hexlc "-" 4hexlc "-" 12hexlc
hexlc          = DIGIT / "a" / "b" / "c" / "d" / "e" / "f"
```

An emitter MUST emit `correlation_id` in **lowercase**. The deployed validator (`UUID_RE`) carries the case-insensitive flag, so a receiver MUST accept an upper- or mixed-case UUID (`8-4-4-4-12` hex), and two case-variant spellings of one id both validate — a masking hazard for any code that compares `correlation_id` values as raw strings. The grammar constrains neither the RFC 4122 version nor the variant bits; a non-v4 or the nil UUID (`00000000-0000-0000-0000-000000000000`) passes. See Registry Considerations §9.

> Provenance (informative): `UUID_RE`, myelin `src/uuid.ts`; `generateCorrelationId`/`isValidCorrelationId`, `src/correlation.ts`. Emitters mint via `crypto.randomUUID()` (lowercase v4).

`correlation_id` is not an identifier terminal of RFC-0001 and is defined here.

### 8.2. Defaulting — OPEN DECISION

An emitter SHOULD populate `correlation_id` explicitly. When an envelope lacks one, the default depends on the path:

- On the **rejection** (§6) and **dead-letter** (§5) paths, `correlation_id` MUST default to the **envelope `id`** (`correlation_id ?? id`). This keeps the task chain joinable across every excursion — the load-bearing invariant of this identifier.
- On the **request-reply** (§7) path, the reference implementation defaults to a **fresh UUID** (`correlation_id ?? crypto.randomUUID()`), joinable to nothing.

The request-reply divergence breaks the "`correlation_id` survives every excursion" invariant. See OPEN DECISION OD-6.

> **[OPEN DECISION — Andreas + JC (hub custodian) — blocked on reconciliation of the three defaulting sites (audit finding `transport/correlation-id-defaulting-divergent`).]** Decide whether a request legitimately roots a new correlation (fresh UUID acceptable) or MUST inherit the envelope `id`, and reconcile `src/transport/nak.ts:132`, `dead-letter.ts:120`, and `request-reply.ts:85`.

### 8.3. Mutability

`correlation_id` is a **mutable** envelope field: it is excluded from every signature (the mutable carve-out, alongside `economics` and `extensions`; see RFC-0003 and the envelope-signing RFC). Per the hard contract of `docs/envelope.md`, a client MUST NOT make a security or trust decision based on `correlation_id` (or any mutable-field value). Correlation is a routing and observability convenience, never an authorisation input. See §10 ("S1").

---

## 9. Registry Considerations

This document makes the following registrations, all internal (no IANA or W3C registry is involved; this document defines no DID method).

- **RFC number.** RFC-0007, allocated in [`specs/README.md`](../README.md). Numbers are never reused.
- **Reserved NATS header field names.** `Myelin-Nak-Reason` and `Myelin-Nak-Description` (§3.2) are reserved for the NAK reason hint. Other producers MUST NOT repurpose these header names.
- **Reserved subject segment.** `dead-letter`, as the first segment of a `tasks`-domain capability position (§5.2). A `capability-tag` MUST NOT equal it. The reservation is co-owned with, and its enforcement deferred to, RFC-0002. (Currently unenforced — §10 "S4".)
- **Reserved subject prefix.** `_INBOX.` (§7.4) — REQUIRED to be reserved in the subject namespace; the reservation's home is RFC-0002 (OD-5).
- **The NAK reason value set** (§3.1) is a **closed registry** of four values. Adding, renaming, or removing a value — including resolving whether `policy_denied` is a fifth value (OD-1) — is an encoding change and MUST proceed through a new RFC (`Updates:` this one), two signatures, and a dual-accept window, per [`specs/CONFORMANCE.md`](../CONFORMANCE.md). The envelope's `spec_version` covers envelope grammar only and does **not** version these payload vocabularies; there is no payload-level version field today (a change-control gap — a consumer has already added `policy_denied` unilaterally).
- **`correlation_id` UUID profile.** This document does not register a UUID version or variant constraint; the accepted form is any `8-4-4-4-12` hex string (§8.1). Tightening it to RFC 4122 v4 is a candidate future `Updates:`.

---

## 10. Security Considerations

This document specifies a delivery/reliability layer whose several invariants are held — where they are held at all — by **runtime checks, not by the grammar or by cryptography**. Per [`specs/README.md`](../README.md) rule 6, each such case is a finding, recorded here.

**S1 — Unauthenticated reply correlation (held by nothing).** A request settles on the first inbox envelope whose `correlation_id` matches (§7.2); the inbox path performs **no signature verification**. Both `correlation_id` and `extensions.reply_to` are unsigned, mutable fields (§8.3), which §8.3 and `docs/envelope.md` forbid using for trust decisions — yet accepting an envelope *as the reply* and choosing *where to send a reply* are both trust decisions keyed entirely on those forgeable values. `_INBOX` traffic is core NATS, unpersisted, and publishable by anyone with pub rights on the subject; a mid-path hub may legally rewrite `reply_to`. An attacker who can guess or observe the `_INBOX.{uuid}` mailbox and the `correlation_id` can inject a forged reply that the requester will accept. Mitigations (a responder-signed reply whose stamp the requester verifies; an unguessable mailbox; a per-request nonce inside signed bytes) are not specified and MUST be considered before request-reply is used for any security-relevant exchange.

**S2 — Unsigned NAK frames and headers.** The NAK operation itself carries no authentication, and the `Myelin-Nak-Reason`/`-Description` headers are consumer-appended, unsigned, and in-process only (§3.2). The durable `dispatch.task.rejected` event carries the reason in its payload, but nothing binds that event's reason to a verified refusal — a flaky or hostile intermediary can suppress a rejection record (§S5) or, on the header channel, mislabel a refusal to an in-process observer. Consumers MUST treat a NAK reason as an advisory classification, not an attested fact.

**S3 — `_INBOX` not reserved in the namespace.** A subject's delivery guarantee flips between persisted (JetStream) and un-persisted (core NATS) on a `startsWith("_INBOX.")` check (§7.4), yet `_INBOX` is reserved nowhere in the subject namespace (`_metrics` is; `_INBOX` is not). An application subject that collides with the prefix is silently un-persisted — a durability cliff decided by a runtime string test with no grammar behind it. OD-5 moves the reservation into RFC-0002.

**S4 — Reserved `dead-letter` segment unenforced (held by nothing).** §5.2 REQUIRES that a `capability-tag` never equal `dead-letter`, so the escalation tree cannot collide with real work. No code enforces it: `dead-letter` matches `CAPABILITY_TAG_RE`, and `taskSubject('acme','dead-letter')` mints a work subject inside the reserved tree. (The sibling `@`-prefix reservation is enforced only by the accident that `@` fails the segment charset; `dead-letter` has no such accidental protection.) The guard belongs with RFC-0002, which owns `capability-tag`. Vector `capability/reserved-dead-letter-rejected` pins the REQUIRED behaviour and currently **fails** against the reference implementation.

**S5 — Best-effort rejection audit (evadable brake).** `dispatch.task.rejected` is documented as the only durable record of *why* a task was rejected, and threshold-review depends on it to detect velocity-class harm — yet its emission is best-effort behind a 2-second timeout, and the synchronous handler-error path emits nothing (§6.2). An attacker (or merely a flaky publisher) that suppresses rejection records can stay under a threshold-review brake while its rejections still nak on the wire. No delivery guarantee is specified. A control that relies on this channel MUST NOT assume completeness.

**S6 — `not-now` silent task loss (reliability).** Under the reference consumer config, a task nak'd `not-now` past `max_deliver` is dropped with no dead-letter and no terminal event (§4.2). A sender that can keep a target agent at capacity can cause targeted, unaudited task loss. OD-3 records the required fix.

**S7 — Mutable, unbounded carrier for `dead_letter` and `reply_to`.** `extensions` is unsigned, `additionalProperties: true`, and size-unbounded (RFC-0003 / envelope-signing RFC). Both the `dead_letter` wrapper (§5.3) and `reply_to` (§7.1) ride there. An intermediary can rewrite `reply_to` (redirecting a reply — see S1) or tamper the `nak_chain`/`route_trigger` of a `dead_letter` wrapper without invalidating any stamp, and can inflate `extensions` without bound. Consumers MUST treat these fields as untrusted input and SHOULD bound their size on receipt.

**S8 — Free-form description leakage.** The `Myelin-Nak-Description` header and `RejectedPayload.description` carry free-form text; the default handler-error path copies raw `err.message` into them (§3.2, §6.1). Error text can carry sensitive internal detail; see §11.

The threat model this document assumes: an authenticated but potentially misbehaving participant on the bus (over-broad pub rights, a compromised intermediary/hub), and a passive observer of subjects. It does **not** assume the transport itself provides confidentiality or per-frame authentication of NAKs and replies; those properties, where needed, MUST be supplied by the envelope signing layer, which does not currently cover the mutable fields this layer relies on.

---

## 11. Privacy Considerations

This document specifies an identifier (`correlation_id`) and re-publishes envelopes; a Privacy Considerations section is therefore REQUIRED.

**`correlation_id` is a cross-context linker.** By construction it joins every envelope of a workflow — request, reply, rejection, dead-letter — into one chain. Any party that can observe a subject carrying it can correlate otherwise-unlinked messages across the dispatch, rejected, and dead-letter subject trees, whose subscriber sets (threshold-review, audit, surface-router, dashboards) are broader than the capability consumers the original task was addressed to. Because `correlation_id` is minted from `crypto.randomUUID()` (§8.1), the value itself leaks nothing by construction — no embedded principal, timestamp, or sequence — which is the desirable property. But because it is mutable and unsigned (§8.3), it can be reused or forged to force spurious joins; a value MUST NOT be treated as evidence that two envelopes are genuinely related.

**Payload re-scoping via `original_envelope`.** The rejection event (§6.1) and the dead-letter wrapper (§5.3) re-publish the **entire original envelope, payload included**, onto the dispatch and dead-letter subject trees — a different, typically broader subscriber set than the capability consumers the payload was addressed to. The envelope's classification is copied onto the wrapper, but nothing in this layer states that dispatch-tree or dead-letter-tree subscribers acquire read access to tasks-tree payloads *by design*, and no mechanism restricts the re-publication to same-classification subscribers. An implementation that carries confidential payloads MUST consider that a NAK or a dead-letter route widens the payload's audience, and SHOULD strip or redact payloads that must not reach the broader audience before emitting the rejection/dead-letter record.

**Free-form text.** `description` / `Myelin-Nak-Description` carry operator-authored or raw-error text (§S8). This text is not classified and rides the broader-audience channels above. Emitters SHOULD NOT place sensitive content there.

**Reply mailbox.** `_INBOX.{uuid}` embeds a random UUID; it correlates only the single round-trip and is unpersisted core NATS. Its privacy exposure is limited to parties with subject visibility during the request's lifetime.

---

## 12. Conformance

An implementation conforms to this document if and only if it passes every vector under the path named in `vectors` ([`specs/vectors/transport/`](../vectors/transport/)). Prose explains; **vectors bind.** See [`specs/CONFORMANCE.md`](../CONFORMANCE.md).

An implementation adds exactly one conformance test that loads the vectors, runs **its own** NAK-reason parser, dead-letter-subject deriver, `reply_to` guard, `correlation_id` validator, backoff function, and dead-letter route selector, and asserts. It MUST NOT import the reference implementation.

Because this dimension's canonical vocabulary already ships in three divergent spellings across two repositories with no shared vectors, conformance to §3.1 (the canonical kebab-case set) is the single most load-bearing requirement: a consumer that emits or parses only the snake_case alias is, by these vectors, non-conformant, and the divergence it causes (§3.4) is a defect to be fixed, not tolerated.

The starter vector set (Appendix B) is a **Draft** convenience carried as one combined array; at ratification it MUST be split into `valid.json` / `invalid.json` / `render.json` per [`specs/vectors/README.md`](../vectors/README.md), and the positive/negative/render adversarial coverage completed. The set already includes the mandated adversarial cases: the masking case (upper-case `correlation_id`; the currently-passing reserved `dead-letter` capability), the collision/drift cases (snake_case and `policy_denied` NAK reasons), and the cross-form cases (legacy vs stack-aware dead-letter subjects).

---

## 13. References

### 13.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC4122] Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005. *(The `correlation_id` UUID string form, §8. Version/variant constraints are not imposed — §9.)*
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", Draft. *(Identifier terminals: `principal-id`, `stack-slug`, `did`, `@`-assistant encoding.)*
- [RFC-0002] metafactory, "Subject Namespace", Draft. *(Task-subject grammar and reserved segments co-owning the dead-letter subject and the `_INBOX.`/`dead-letter` reservations — OD-4, OD-5.)*
- [RFC-0003] metafactory, "Envelope", Draft. *(Envelope fields `correlation_id`, `extensions`, `sovereignty`, `distribution_mode`; the mutable/signable field boundary.)*

### 13.2. Informative References

- [`docs/nak-reasons.md`](../../docs/nak-reasons.md) — the de-facto NAK protocol document, promoted by this RFC (`supersedes_prose`).
- [`docs/design-agent-task-routing.md`](../../docs/design-agent-task-routing.md) — origin design (Pattern 4; structured NAK; dead-letter routing).
- [`specs/namespace.md`](../namespace.md) — dead-letter subject grammar, reserved segments, TASKS stream/consumer reference shape (→ RFC-0002).
- [`specs/admission.md`](../admission.md) — admission refusals reusing the dispatch refusal taxonomy (snake_case `reason` object — OD-2).
- [`specs/CONFORMANCE.md`](../CONFORMANCE.md), [`specs/vectors/README.md`](../vectors/README.md) — conformance and vector schema.
- Reference implementation (myelin `origin/main`): `src/transport/nak.ts`, `src/transport/dead-letter.ts`, `src/transport/request-reply.ts`, `src/transport/types.ts`, `src/transport/jetstream-base.ts`, `src/lifecycle/types.ts`, `src/subjects.ts`, `src/correlation.ts`, `src/uuid.ts`, `src/sovereignty/types.ts`.
- Consumer divergence (cortex `origin/main`): `src/bus/dispatch-events.ts`, `src/surface/mc/projection/failed-dispatch.ts`, `docs/architecture.md`.
- Wire-protocol gap analysis, [`docs/wire-protocol-gap-analysis.md`](../../docs/wire-protocol-gap-analysis.md).

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in `grammar` (`specs/grammar/transport.abnf`) is the source of truth and is what CI validates.

```abnf
; specs/grammar/transport.abnf
; RFC-0007 — Transport and Reliability
; Terminal alphabets for identifiers are defined ONCE elsewhere and cited
; by name, never redefined (grammar/README rule 5):
;   principal-id, stack-slug — RFC-0001 specs/grammar/identifiers.abnf
;   capability-tag           — RFC-0002 (provisional; not yet drafted — OD-4)
; Core rules DIGIT, HEXDIG imported from RFC 5234 Appendix B.

; 1. NAK reason vocabulary (closed set; canonical kebab-case).
;    Non-canonical snake_case / policy_denied are ALIASES (RFC §3.4), not
;    part of this grammar.
nak-reason = "cant-do" / "wont-do" / "not-now" / "compliance-block"

; 2. Two-channel carriage — in-process NATS header field NAMES.
nak-reason-header-name       = "Myelin-Nak-Reason"
nak-description-header-name   = "Myelin-Nak-Description"
nak-reason-header-value      = nak-reason
; nak-description-header-value = *%x00-10FFFF   ; opaque; free-form (§11)

; 3. correlation_id — canonical UUID string (not an RFC-0001 terminal).
;    Emit lowercase; accept case-insensitive; version/variant unconstrained.
correlation-id = uuid
uuid           = 8hexlc "-" 4hexlc "-" 4hexlc "-" 4hexlc "-" 12hexlc
hexlc          = DIGIT / "a" / "b" / "c" / "d" / "e" / "f"

; 4. Dead-letter subject. Reserved segment "dead-letter" (unenforced —
;    §10 S4). Stack segment OPTIONAL only for the transitional legacy form
;    (OD-4). Subject grammar co-owned with RFC-0002.
dead-letter-segment = "dead-letter"
subject-prefix      = "local" / "federated"
dead-letter-subject = subject-prefix "." principal-id
                      [ "." stack-slug ]
                      ".tasks." dead-letter-segment "." capability-tag

; 5. Request-reply mailbox. "_INBOX." routes via core NATS (JetStream
;    bypass, unpersisted); prefix NOT yet reserved in the namespace (OD-5).
;    reply-inbox = the minted form; accepted-reply-to = the guard's form.
inbox-prefix      = "_INBOX."
reply-inbox       = inbox-prefix uuid
accepted-reply-to = inbox-prefix inbox-id
inbox-id          = 1*inbox-char
inbox-char        = %x21-29 / %x2B-3D / %x3F-7E   ; VCHAR except "*" and ">"
```

---

## Appendix B. Test Vectors

Vectors live as JSON under the path named in `vectors`, so that implementations in any language can consume them. This appendix reproduces a representative subset; it is **not** the only copy. Every vector carries a `why`. See [`specs/vectors/README.md`](../vectors/README.md).

The starter set is carried in Draft as one combined array (`specs/vectors/transport/vectors.json`); each element is self-describing via `expect.ok` and `kind`. At ratification it splits into `valid.json` / `invalid.json` / `render.json` (see §12, Appendix C).

Representative vectors:

```jsonc
// The canonical NAK set — the single most load-bearing contract of this RFC.
{ "id": "nak-reason/compliance-block", "rfc": 7, "kind": "parseNakReason",
  "input": "compliance-block", "expect": { "ok": true, "value": { "reason": "compliance-block" } },
  "why": "Canonical: M7 attestation refusal — immediate dead-letter fast path, never retried." }

// DRIFT/COLLISION — the finding this RFC exists to end.
{ "id": "nak-reason/snake-case-not-now-rejected", "rfc": 7, "kind": "parseNakReason",
  "input": "not_now", "expect": { "ok": false, "reason": "non-canonical-spelling" },
  "why": "cortex + specs/admission.md emit snake_case; a parser keyed on the canonical kebab set drops it. Guards transport/nak-vocab-cross-repo-drift — a myelin kebab failure is misclassified 'high' not 'critical' by cortex. OPEN DECISION OD-1." }

{ "id": "nak-reason/policy-denied-rejected", "rfc": 7, "kind": "parseNakReason",
  "input": "policy_denied", "expect": { "ok": false, "reason": "unknown-reason" },
  "why": "cortex's unilaterally-added fifth value is not in the closed canonical set — OD-1." }

// MASKING — a currently-passing input the spec REQUIRES rejected.
{ "id": "capability/reserved-dead-letter-rejected", "rfc": 7, "kind": "parseCapabilityTag",
  "input": "dead-letter", "expect": { "ok": false, "reason": "reserved-segment" },
  "why": "'dead-letter' passes CAPABILITY_TAG_RE and is minted today; the spec REQUIRES rejection. This vector currently FAILS against myelin — the reservation is held by no guard (§10 S4)." }

// MASKING — case-insensitive correlation_id.
{ "id": "correlation-id/uppercase-accepted", "rfc": 7, "kind": "parseCorrelationId",
  "input": "550E8400-E29B-41D4-A716-446655440000", "expect": { "ok": true, "value": { "uuid": "550E8400-E29B-41D4-A716-446655440000" } },
  "why": "Emit is lowercase but UUID_RE carries /i, so uppercase validates — two spellings of one id both pass (§8.1)." }

// CROSS-FORM — the dead-letter subject render + the stream-filter gap.
{ "id": "dead-letter/stack-aware-6seg", "rfc": 7, "kind": "renderDeadLetterSubject",
  "input": "local.acme.default.tasks.code-review.typescript",
  "expect": { "ok": true, "value": "local.acme.default.tasks.dead-letter.code-review" },
  "why": "Stack-aware form preserves the stack, drops the subcapability — but does NOT match TASKS_DEAD's legacy filter, so audit retention silently misses it (OD-4)." }

// reply_to injection guard.
{ "id": "reply-to/wildcard-gt-rejected", "rfc": 7, "kind": "validateReplyTo",
  "input": "_INBOX.>", "expect": { "ok": false, "reason": "wildcard-in-reply-to" },
  "why": "A '>' would subscribe the reply onto a wildcard — subject-injection guard (§7.1, §10 S1)." }

// not-now backoff cap + the silent-loss context.
{ "id": "backoff/not-now-delivery-7-cap", "rfc": 7, "kind": "notNowBackoffMs",
  "input": 7, "expect": { "ok": true, "value": 60000 },
  "why": "Backoff caps at 60s; rows 4-7 unreachable under reference max_deliver:3 (OD-3 silent loss)." }

// Dead-letter routing — not-now never routes.
{ "id": "route/not-now-excluded", "rfc": 7, "kind": "deadLetterRouteTrigger",
  "input": { "reason": "not-now", "chainLength": 9 }, "expect": { "ok": true, "value": null },
  "why": "not-now is excluded from the exhaustion budget at any chain length (§5.1) — the very reason OD-3's JetStream-layer loss can occur." }
```

The full starter array (30 vectors: the four canonical reasons + three rejections; five `correlation_id` cases; five `reply_to` cases; six dead-letter renders/rejections + the reserved-segment case; four backoff cases; four routing cases) is at `specs/vectors/transport/vectors.json`.

---

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Codifies the code-only reliability layer: closed 4-value `nak-reason` set (§3), two-channel carriage (§3.2), `not-now` backoff (§4), dead-letter routing + reserved segment + `extensions.dead_letter` (§5), `dispatch.task.rejected` (§6), request-reply / `_INBOX` (§7), `correlation_id` (§8). Records OD-1..OD-6 and Security findings S1–S8. Promotes `docs/nak-reasons.md`. |

### Open items before `Proposed`

- Resolve OD-1..OD-6.
- Split the combined starter vectors into `valid.json` / `invalid.json` / `render.json`; complete adversarial coverage (every `reply_to` and dead-letter collision pair; the `correlation_id` nil/version cases).
- Coordinate with RFC-0002 on the `dead-letter` capability-tag rejection guard (S4), the `_INBOX.` reservation (OD-5), and the stack-aware dead-letter subject grammar + `TASKS_DEAD` filter alignment (OD-4).
- Coordinate with RFC-0003 / the envelope-signing RFC on the mutable-field carve-out that leaves `correlation_id`, `reply_to`, and `extensions.dead_letter` unauthenticated (S1, S7).

## Acknowledgments

This draft is grounded in the wire-protocol audit of the `transport` dimension and the reference implementation on myelin `origin/main`. The NAK vocabulary and two-channel model are the work recorded in `docs/nak-reasons.md` and the F-022 / F-4 / F-020 design line.

## Authors' Addresses

Luna (drafting agent), metafactory.
Ratification signatories (required, not yet collected): the principal (Andreas) and the hub custodian (JC).

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/