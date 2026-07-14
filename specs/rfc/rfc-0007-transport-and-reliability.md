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
signatories: []                 # Single-principal ratification (v1) per docs/adr/0001-single-principal-ratification.md; the ratify commit is the principal's.
created: 2026-07-12
ratified: null
grammar: specs/grammar/transport.abnf
vectors: specs/vectors/transport/
generated: []
crossRefs:                      # sibling RFCs this document references
  - "0001"                      # identifier terminals (principal-id, stack-slug, did); flag-day R hard cut
  - "0002"                      # subject plane (kebab); reserved dead-letter segment + _INBOX. (D21/D22); lifecycle-token canon (D14)
  - "0003"                      # envelope fields (correlation_id, extensions); mutable/signable boundary
  - "0004"                      # mutable carve-out (§4.2); replay/redelivery + idempotency obligation (§7.4 D18)
  - "0006"                      # membership-boundary rejects (the third layer of the §3 carve)
  - "0010"                      # refusal OBJECT {kind, detail, retry_after_ms}: grammar, kind registry, carriage, seam-consistency rule
  - "bcp-0001"                  # wire change control; dual-accept doctrine; NO payload version field here
supersedes_prose:
  - docs/nak-reasons.md
---

# RFC-0007: Transport and Reliability

## Abstract

This document specifies the delivery and reliability layer of the myelin wire protocol: the vocabulary and carriage of negative acknowledgements (NAKs), redelivery backoff, dead-letter escalation, the request-reply correlation protocol, and the `correlation_id` that joins related envelopes across a workflow. It defines the closed four-value NAK reason set — canonical spelling **snake_case** (`cant_do | wont_do | not_now | compliance_block`), with the kebab-case renderings surviving only as receive-window aliases until flag-day R — its two carriage channels, the two delivery modes and their guarantees (at-least-once on the JetStream task path, at-most-once on core NATS), the consumer-configuration contract (`max_deliver`, `ack_wait`, `duplicate_window`), the dead-letter subject, the `_INBOX` reply-mailbox convention, and the syntax and context-specific defaulting of `correlation_id`. It pins the **layered carve** between this document (the token value set and its delivery dispositions), RFC-0010 (the refusal object and its carriage), and RFC-0006 (membership rejects). Formerly these behaviours existed only as reference code and informative documentation, spelled three inconsistent ways across two repositories; the 2026-07-15 grill resolved every open decision, and this revision codifies the wire as it is — recording, rather than silently encoding, the defects that condition produced.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document.

Ratification is single-principal per [ADR-0001](../../docs/adr/0001-single-principal-ratification.md): while myelin is the only implementation and no federated peer is live, the principal (Andreas) alone ratifies, recorded in `signatories`. The full two-signature act (principal + hub custodian) is **suspended, not deleted**: it reinstates the moment the wire binds a party we do not control — a second independent implementation, or a live federated peer principal. Under ADR-0001 a `Ratified` RFC is a **living spec**: it stays revisable if review or use finds a hole; the immutable-once-`Ratified` discipline (changes shipped only as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN`) is the reinstate-target that returns with the two-signature rule.

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

This layer was, until this revision, **code-only**. Its vocabulary — the four NAK reasons that drive retry-versus-dead-letter routing — lived as a TypeScript union and informative prose, and shipped in three different spellings: myelin's kebab-case set, cortex's snake_case five-value discriminated-object set (with an extra value, `policy_denied`), and cortex's own documentation stating the snake_case set with an RFC 2119 `MUST`. The request-reply protocol appeared in no document, schema, or specification at all. There were no conformance vectors. This was exactly the "fourth independent implementation of an unspecified grammar" condition that [`specs/CONFORMANCE.md`](../CONFORMANCE.md) exists to end.

This revision codifies the outcome of the 2026-07-15 grill ([`grill-logs/rfc-0007.md`](grill-logs/rfc-0007.md), 28 decisions, all final): the canonical spelling is **snake_case** (§3.1), the receive window dual-accepts the kebab aliases until flag-day R (§3.4), `policy_denied` is out of the transport set (§3.4), the exhaustion threshold's equality invariant and per-consumer value are pinned (§4.2), both live dead-letter models are conformant (§5.1), the delivery guarantees are stated (§2, §6.3), request-reply is OPTIONAL (§7), and the correlation defaulting is ratified as context-specific (§8.2). Where the grill said *codify as-is*, this document records deployed behaviour and invents no mechanism.

This document specifies that layer as one normative contract.

**What this document does not solve.** It does not specify the envelope shape or the signable/mutable field boundary (RFC-0003, RFC-0004); replay, redelivery vocabulary, or the receiver's idempotency obligation (RFC-0004 §7.4 — cited in §6.3, never re-owned); the subject namespace grammar, its reserved segments and prefixes, or the lifecycle-token canon (RFC-0002); identifier terminals (RFC-0001); membership-boundary rejects (RFC-0006); wire versioning and change windows (BCP-0001 — this document introduces **no** payload version field); or the refusal **object** `{ kind, detail, retry_after_ms }` — its grammar, kind registry, carriage, and the object↔token seam-consistency rule (RFC-0010; §3). It references those documents; it does not restate them.

**Promoted prose.** This document promotes [`docs/nak-reasons.md`](../../docs/nak-reasons.md) — the de-facto protocol document for the NAK vocabulary — from informative to normative (listed in `supersedes_prose`). The request-reply protocol has no prose to promote; it is specified here for the first time.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.2. Terminology

- **NAK** (verb *to nak*): a consumer's negative acknowledgement of a delivered JetStream message, requesting redelivery. Carried on the wire by the NATS `nak(delayNs)` protocol operation.
- **NAK reason**: a member of the closed set defined in §3.1 that classifies *why* a task was refused, driving retry-versus-dead-letter routing. A **payload-plane token**: snake_case, like every ratified payload vocabulary.
- **Refusal object**: the `reason: { kind, detail, retry_after_ms }` structure owned by RFC-0010. A NAK reason token can *wear* a refusal object (§3); the two are layers, not competitors.
- **In-process header channel**: the NATS message headers `Myelin-Nak-Reason` / `Myelin-Nak-Description`, appended by the consumer before it naks. Visible only to in-process observers; does **not** survive nak-redelivery (§3.2).
- **Durable channel**: the `dispatch.task.rejected` lifecycle envelope (§6) — the only cross-process record of a rejection.
- **Dead-letter**: the escalation of a task that can never be claimed — either because retries are exhausted or because it was refused with `compliance_block` — recorded by the terminal `dispatch.task.failed` event (§5.4) and OPTIONALLY amplified by a republish onto a reserved subject (§5.3).
- **Exhaustion**: the dead-letter trigger where the accumulated NAK chain (excluding `not_now`) reaches the exhaustion threshold.
- **Fast path**: the dead-letter trigger where a single `compliance_block` NAK routes immediately, skipping remaining retries.
- **`delivery_count`**: JetStream's per-message redelivery counter (`msg.info.deliveryCount`), incremented on every delivery regardless of NAK reason.
- **`max_deliver`**: the JetStream consumer's server-side redelivery cap. Per-consumer configurable; MUST equal the consumer's exhaustion threshold (§4.2).
- **`correlation_id`**: a UUID (§8) that links related envelopes across a workflow. A **mutable** envelope field, excluded from every signature (RFC-0004 §4.2).
- **Reply mailbox / `_INBOX`**: an ephemeral core-NATS subject (`_INBOX.{uuid}`) to which a request's reply is addressed (§7). Bypasses JetStream; not persisted. The `_INBOX.` prefix is reserved by RFC-0002 §9 (D22), which admits this document's tail grammar by reference.
- **`reply_to`**: the `extensions.reply_to` field carrying the reply mailbox subject.
- **JetStream / core NATS**: the persistent (at-least-once, acked, stored) and the ephemeral (at-most-once, fire-and-forget, unpersisted) delivery modes of the underlying bus, respectively (§2).
- **Flag-day R**: the single coordinated cutover release (RFC-0001 §9) at which dual-accept windows opened by the ratified series close and legacy emitters flip.

Identifier terminals (`principal-id`, `stack-slug`, `did`, the `@`-assistant encoding) are defined in RFC-0001; subject-namespace terminals (`capability-tag`, subject prefixes, reserved segments) in RFC-0002. This document cites them by name.

---

## 2. Protocol Overview

The reliability layer is four sub-protocols that share one identifier (`correlation_id`):

1. **NAK** (§3, §4). A consumer refuses a delivered task with one of four reasons on two channels: an in-process header hint and a durable lifecycle event. `not_now` triggers deterministic exponential backoff; the other three are immediate-redeliver, with consumer-side routing deciding retry versus escalation.
2. **Dead-letter** (§5). Tasks that exhaust their retry budget (`cant_do`/`wont_do`) or hit a `compliance_block` terminate with a mandatory `dispatch.task.failed` lifecycle event, optionally amplified by a republish under `extensions.dead_letter` onto a reserved `dead-letter` subject.
3. **Rejection lifecycle event** (§6). `dispatch.task.rejected` — the durable, cross-process record of a NAK, consumed by threshold-review, audit, and the dead-letter handler.
4. **Request-reply** (§7, OPTIONAL). A caller stamps `extensions.reply_to` with a concrete `_INBOX.{uuid}` mailbox, subscribes it, publishes the request, and settles on the first reply whose `correlation_id` matches. `_INBOX` traffic bypasses JetStream.

All four preserve `correlation_id` (§8) so an observer can join a task across every excursion.

**Two delivery modes, two guarantees.** The bus offers exactly two delivery modes, and the guarantee follows the mode, normatively (§6.3): the **JetStream task path is at-least-once** (acked, stored, redelivered); the **core-NATS path — chat traffic and `_INBOX.` reply mailboxes — is at-most-once** (fire-and-forget, unpersisted). An implementation MUST NOT present one mode's guarantee as the other's. **Ordering: NONE.** This layer specifies no ordering guarantee — not per-subject, not per-`correlation_id`, not across redeliveries. A consumer MUST NOT assume envelopes arrive in emission order; causal reconstruction is by `timestamp` ordering within a `correlation_id` chain (and by chain-of-stamps where signed delegation history is present, RFC-0004), never by arrival order.

The normative wire STRINGS of this layer (the NAK reason tokens, header names, `correlation_id`, the dead-letter subject, the `_INBOX` mailbox) are given as ABNF in Appendix A and the standalone `specs/grammar/transport.abnf`. The JSON payload SHAPES (§5.3, §5.4, §6.1) are specified as normative field tables; the envelope treats `payload` and `extensions` as opaque, so these shapes have no JSON-Schema home and are normative here.

---

## 3. The NAK Reason Vocabulary

**The layered carve (normative).** Three documents partition refusal semantics — by layer, not by topic:

- **This document owns the closed NAK reason VALUE SET** (§3.1) **and the delivery dispositions those values drive** — backoff (§4), dead-letter routing (§5), and the terminal record (§5.4).
- **RFC-0010 owns the refusal OBJECT** `{ kind, detail, retry_after_ms }`: its field grammar, its `kind` registry, the transient-vs-permanent rule, its **carriage** — on dispatch failure events and on `nak(retry_after_ms)` — and the **object↔token seam-consistency rule** (what it means for a failure event to carry both, consistently).
- **RFC-0006 owns membership-boundary rejects** (admission refusals at the membership lifecycle).

These are layers, not a trichotomy: **one reason can be a 0007 token *wearing* a 0010 object.** `not_now` is the worked example — simultaneously a transport token driving the §4.1 backoff exemption and a refusal `kind` carrying `retry_after_ms`, with no contradiction. Accordingly this document states **no requirement on co-carriage** of token and object: whether, when, and how a token is accompanied by a refusal object is RFC-0010's ceded ground.

### 3.1. The canonical reason set

The NAK reason set is **closed** and consists of exactly four values. Its canonical spelling is **snake_case**:

```abnf
nak-reason = %s"cant_do" / %s"wont_do" / %s"not_now" / %s"compliance_block"
```

Reason tokens are **payload-plane** values, and the entire ratified payload plane is snake_case (`identity_mismatch`, RFC-0006; `signed_by`, `correlation_id`, RFC-0003; `not_now`, `specs/admission.md` §7). Kebab-case remains canonical **only for subject segments** (RFC-0002 and RFC-0001 are kebab-strict on the subject plane — the reserved `dead-letter` subject segment of §5.2 stays kebab); it is not a payload spelling.

An emitter of a NAK reason — in a header value, a `RejectedPayload.reason`, a `FailedPayload.nak_reason`/`final_reason`, or a `DeadLetterExtension.final_nak_reason`/`nak_chain` element — MUST render exactly one of these four tokens, in the canonical snake_case spelling. An implementation MUST NOT emit any other spelling of these values, and MUST NOT emit any value outside this set, as a conformant NAK reason (§3.4).

| Reason | Meaning | Consumer routing (normative, §5.1) |
|---|---|---|
| `cant_do` | Static capability mismatch — the agent lacks the tool, environment, or reach. | Retry until the exhaustion threshold, then dead-letter. |
| `wont_do` | Sovereignty / policy refusal — the agent is capable but declines. | Retry until the exhaustion threshold, then dead-letter. |
| `not_now` | Transient load / at-capacity. | Redeliver with exponential backoff (§4.1); MUST NOT count toward exhaustion. |
| `compliance_block` | M7 attestation refusal (trifecta gate, expired credential, unapproved tool). | Immediate dead-letter, fast path (§5.1); MUST NOT be retried against the same policy. |

**Migration.** The one emitter of the kebab spelling is myelin's `NakReason` union (`src/lifecycle/types.ts:6`) — the cheapest possible migration surface, under our control; it flips to snake_case at flag-day R. cortex's live read path (`src/surface/mc/projection/failed-dispatch.ts`), its emitter (`src/bus/dispatch-events.ts`), its architecture document's RFC 2119 `MUST`, and `specs/admission.md` §7 are already snake_case. During the window, receivers dual-accept: the kebab renderings are **aliases**, normalized on receive (§3.4). Per BCP-0001 — which owns wire versioning — this document introduces **no payload version field**; the spelling change is governed by the dual-accept window and the flag-day cut, not by a version stamp.

> Provenance (informative): `NakReason`, myelin `src/lifecycle/types.ts:6` (kebab, flips at R); routing table, `docs/nak-reasons.md`; snake precedent, cortex `docs/architecture.md` + `specs/admission.md` §7.

**Unknown or missing reason.** Handled by the §3.4 receive algorithm: normalize known aliases first, **then** coerce a genuinely-unknown or missing value to `cant_do`.

### 3.2. Two-channel carriage

A NAK reason is carried on **two channels with different scopes**. An implementation MUST NOT conflate them.

**Channel 1 — in-process headers (a local hint).** Before it naks, a consumer MAY append the NATS message headers:

```
Myelin-Nak-Reason: cant_do | wont_do | not_now | compliance_block
Myelin-Nak-Description: <free-form, optional>
```

The `Myelin-Nak-Reason` value MUST be a canonical `nak-reason` (§3.1; the kebab aliases are accepted on read during the window, §3.4). These headers are visible only to **in-process** observers (the consumer's own logging/metrics middleware). NATS does **not** republish consumer-appended headers when JetStream redelivers a nak'd message; therefore these headers do **not** survive redelivery, and a cross-process consumer (the dead-letter handler, threshold-review) MUST NOT rely on them.

> Provenance (informative): `NAK_REASON_HEADER`/`NAK_DESCRIPTION_HEADER`, myelin `src/transport/nak.ts:63-64`; scope rule, `docs/nak-reasons.md`.

**Channel 2 — the durable lifecycle event (cross-process truth).** The async NAK path (`nakWithReason`) publishes a `dispatch.task.rejected` lifecycle envelope (§6). This is the **only** durable, cross-process record of *why* a task was rejected, and it is the channel a cross-process consumer MUST use.

The two channels are not equivalent. The synchronous NAK path (`nakWithReasonSync`), including the transport's default handler-error path (§4), writes the header hint and naks but emits **no** lifecycle event. NAKs issued on the synchronous path are therefore invisible to every cross-process consumer. See §6.2 and Security Considerations §10 ("S5").

### 3.3. Emission and NAK-fires-regardless

The reliability of redelivery MUST NOT be coupled to the observability of the reason. Concretely: the NAK (the `nak(delayNs)` operation) MUST fire even when durable lifecycle emission fails, stalls, or is skipped. The reference async path enforces this by racing the best-effort lifecycle publish against a 2-second timeout and then naking unconditionally.

### 3.4. Aliases, the dual-accept receive window, and the closed-for-emit rule

*(Closes the former OPEN DECISION OD-1/OD-2 — grill D4, D5; carrier-shape ownership resolved by the §3 layered carve.)*

**Receive algorithm (normative).** A receiver of a NAK reason value MUST apply, in order:

1. **Normalize known aliases.** During the dual-accept window (now → flag-day R), the four kebab-case renderings — `cant-do`, `wont-do`, `not-now`, `compliance-block` — are aliases of their snake_case canonicals and MUST be normalized to the canonical token before any routing or classification decision.
2. **Then coerce.** A value that is *still* outside the canonical set after normalization, or a missing value where one is expected, MUST be treated as `cant_do` — the least-surprising disposition (it neither escalates immediately as `compliance_block` nor exempts from exhaustion as `not_now`).

The order is load-bearing: a blanket coerce applied *before* normalization would misroute every live kebab-spelled token mid-window. The `resolveNakReason` conformance vectors (§12, Appendix B) test **post-normalization** behaviour. At flag-day R the aliases retire: step 1 becomes a no-op and a kebab token coerces like any unknown value.

**Closed for emit (normative).** An emitter MUST emit only the four snake_case tokens of §3.1. Adding a value to the set — under *any* spelling — is an encoding change and MUST proceed through a new RFC (`Updates:` this one) and a dual-accept window per [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and BCP-0001. The unilateral addition of `policy_denied` by a consumer (next paragraph) is the incident this rule exists to prevent.

**`policy_denied` is not a transport NAK reason.** It is a **pre-spawn authorization-gate refusal**: in every deployed emission site the executor is never invoked (cortex `src/runner/dispatch-listener.ts`, `src/bus/admit-offered-dispatch.ts`) — the task is refused *before* it becomes transport work, so no retry semantics apply and the transport set stays closed at four. Its taxonomy home is **RFC-0010** (an authorization `kind` in the refusal-object registry). Its deployed disposition is recorded **as-is** as v-current: cortex routes it `{ kind: "term" }` — permanent, no redelivery — in every consumer (`src/runner/release-consumer.ts`, `src/runner/dev-consumer.ts`); this document does not respec it as a `wont_do`-redeliver. cortex's emission of `policy_denied` in the transport reason position (the fifth member of its `NakReasonKind` union, `src/surface/mc/projection/failed-dispatch.ts`) is a **conformance defect, fixed at flag-day R**: the token leaves the transport field; the deny detail rides the RFC-0010 refusal object.

### 3.5. A second, distinct vocabulary (disambiguation)

Myelin carries a second closed NAK vocabulary that MUST NOT be confused with `nak-reason`: the sovereignty engine's `NakReasonCode`, a six-value set of `compliance_block` sub-codes (`classification-mismatch`, `residency-violation`, `unknown-principal`, `scope-exceeded`, `chain-invalid`, `partner-unknown`; `src/sovereignty/types.ts`). These sub-codes refine a `compliance_block` reason; they are **not** members of `nak-reason`. The seam by which a sub-code rides the wire is **assigned, not designed, here**: ratified RFC-0002 §9 (D21) folds sovereignty enforcement-NAKs under the reserved `_audit.` prefix as `_audit.sovereignty.*` — there is no separate top-level `_nak.` prefix — and RFC-0005's grill designs the NAK detail within `_audit`. This document defines only `nak-reason` and cites that seam.

---

## 4. Redelivery and Backoff

### 4.1. `not_now` backoff

A `not_now` NAK MUST redeliver with an exponential backoff delay that is a **pure deterministic function of `delivery_count`** — no process-local state, so it survives consumer restarts. The delay is:

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

**`retry_after_ms` precedence (codified as-is).** When the refusal object (RFC-0010) accompanying a `not_now` carries `retry_after_ms`, that value **overrides the `delivery_count` curve for that redelivery**: the consumer naks with the responder-supplied delay instead of the curve delay. This is deployed behaviour recorded as deployed: cortex applies the value **raw** (`src/runner/release-consumer.ts:900`, `src/runner/dev-consumer.ts:955`). The 60 000 ms cap in the formula above exists only *inside* the curve function (`nak.ts:88-94`) and never sees `retry_after_ms` — **no clamp on the override is specified**. **Finding: the override is unbounded** — a responder (or an intermediary able to write the mutable refusal object) can park a redelivery arbitrarily far in the future, an unaudited delay lever. A receiver SHOULD cap the `retry_after_ms` it will honour (the curve's 60 s ceiling is a reasonable bound); this is guidance, not wire law. The field's grammar and carriage are RFC-0010's (§3).

The other three reasons (`cant_do`, `wont_do`, `compliance_block`) redeliver immediately (`nak()` with no delay); consumer-side routing (§5) decides retry versus escalation.

### 4.2. `not_now` and `max_deliver` — the equality invariant

*(Closes the former OPEN DECISION OD-3 — grill D14.)*

A `not_now` NAK MUST NOT count toward the dead-letter exhaustion threshold (§5.1): transient overload is not a failure signal, and dead-lettering on it surfaces the wrong incident class.

This requirement is honoured by the dead-letter handler (which excludes `not_now` from its chain) but is **unenforceable at the JetStream layer beneath it**: `max_deliver` is a server-side consumer knob that counts *every* delivery regardless of NAK reason.

The consumer-configuration question this opened is resolved as follows:

- **The equality invariant holds (normative).** A consumer's `max_deliver` MUST equal its dead-letter exhaustion threshold (§5.1). The equality is load-bearing because the handler is a **decoupled observer** of the rejection stream, not an interceptor in the delivery path: if `max_deliver` were merely a floor above the threshold, JetStream would keep redelivering a task the handler has already dead-lettered and terminally failed — post-termination reprocessing of a task the wire has pronounced dead.
- **The VALUE is per-consumer configurable.** This resolves the deployed 3-vs-5 conflict honestly: myelin's reference configuration provisions `max_deliver: 3` (`specs/namespace.md`); cortex provisions 5 (`DEFAULT_MAX_DELIVER`, `src/bus/jetstream/provision.ts`). Both conform, because each consumer's threshold equals its own `max_deliver`.
- **The `not_now` budget, restated against the configured value.** A task nak'd `not_now` `max_deliver` times — whatever the configured value — exhausts JetStream's redelivery; because the handler excludes `not_now` from exhaustion, it never routes the task to dead-letter, and the task terminates with **no dead-letter record and no terminal `dispatch.task.failed`**. This silent-loss hazard stands as a finding (§10 "S6"), and it makes the backoff-curve rows beyond the configured `max_deliver` (§4.1) unreachable in practice.

### 4.3. The consumer-configuration contract

*(Grill D13/D14: the three wire-relevant JetStream consumer knobs, consolidated.)*

| Knob | Contract |
|---|---|
| `max_deliver` | Per-consumer configurable; MUST equal that consumer's dead-letter exhaustion threshold (§4.2 equality invariant, §5.1). Reference values: myelin 3, cortex 5. |
| `ack_wait` | Codified as-is. Default **20 minutes** (cortex `DEFAULT_ACK_WAIT_NS`, `src/bus/jetstream/provision.ts:169`) — sized well above handler wall-time so a healthy in-flight task never redelivers (the JetStream 30 s default sat far below a ~100 s review and caused the duplicate-review/duplicate-post bug, cortex#422). Where handler wall-time is configuration-known, an implementation SHOULD size `ack_wait` dynamically to the handler budget plus headroom; the deployed rule is `asyncTimeoutMs + 60 s` (cortex `src/cortex.ts`, cortex#1203). An in-progress `working()` heartbeat that extends the deadline during execution is named as a **future improvement only** — not specified here. |
| `duplicate_window` | Governs the horizon of the §6.3 `Nats-Msg-Id` deduplication. Its **sizing is a named follow-up** (grill D12): this document mandates the publish-side id now (§6.3) and defers the window value. |

---

## 5. Dead-Letter Routing

### 5.1. Routing triggers and the two conformant models

A dead-letter route is triggered by exactly one of two conditions, evaluated per `(correlation_id, consumer)` NAK chain:

1. **Fast path.** A `compliance_block` NAK MUST route to dead-letter immediately, at any chain length, skipping remaining retries. (Different agents share the M7 policy that refused, so redelivery would only burn budget.)
2. **Exhaustion.** A `cant_do` or `wont_do` NAK is appended to the chain; when the chain length reaches the **exhaustion threshold** the task MUST route to dead-letter. A `not_now` NAK MUST NOT be appended to the chain and MUST NOT trigger a route (§4.2).

The exhaustion threshold is the per-consumer configured value and MUST equal the serving JetStream consumer's `max_deliver` (§4.2, the equality invariant).

**Two conformant dispositions (normative — grill D9/D10).** The JetStream verb set available to a consumer is **`{ack, nak, term}`**, and `term` is **PERMITTED — not required —** as the disposition of a permanent failure. Both live models conform:

- **Terminating-consumer model (cortex).** The consumer maps permanent failures to `term` directly — `wont_do`/`cant_do` preconditions and `compliance_block` terminate with no redelivery (`src/runner/release-consumer.ts:50-58`, the ack/nak/term table) — and emits the terminal `dispatch.task.failed` envelope itself.
- **Reference model (myelin).** The consumer only ever naks; the decoupled `DeadLetterHandler` — an observer of the rejection stream, never in the delivery path — accumulates the chain, republishes the dead-letter envelope, and emits the terminal event. It **never calls `.term()`** (verified against `src/transport/dead-letter.ts`); termination is achieved by `max_deliver` exhaustion at the server.

In both models, **the terminal `dispatch.task.failed` lifecycle event (§5.4) is the single MANDATORY durable record** of a task's death. The `extensions.dead_letter` republish (§5.2, §5.3) is an **OPTIONAL audit amplifier**: an implementation that emits it MUST emit it before the terminal event, but an implementation that emits only the terminal event conforms.

> Provenance (informative): `DeadLetterHandler.shouldRoute`/`onRejection`, myelin `src/transport/dead-letter.ts:277-380`; ack/nak/term table, cortex `src/runner/release-consumer.ts:50-58`.

### 5.2. The dead-letter subject and the reserved segment

The dead-letter subject preserves the original task's prefix, principal, optional stack, and capability, inserts the reserved `dead-letter` segment, and **drops the subcapability**. (Subject segments are the kebab plane, RFC-0002; the segment spelling is unaffected by §3.1.)

```abnf
subject-prefix      = "local" / "federated"
dead-letter-segment = "dead-letter"
dead-letter-subject = subject-prefix "." principal-id
                      [ "." stack-slug ]
                      ".tasks." dead-letter-segment "." capability-tag
```

`principal-id` and `stack-slug` are RFC-0001 terminals; `capability-tag` is an RFC-0002 terminal. The full task-subject grammar is owned by ratified RFC-0002; this document owns the escalation shape (the derivation below).

Derivation from an original task subject MUST:

- preserve `subject-prefix`, `principal-id`, and (if present) `stack-slug`;
- drop the subcapability segment (`code-review.typescript` → `code-review`);
- insert `dead-letter` before the capability;
- be **idempotent** — re-deriving an already-dead-letter subject is a no-op;
- reject (throw, never fabricate) a subject with no `tasks` segment.

Examples: `local.acme.tasks.code-review.typescript` → `local.acme.tasks.dead-letter.code-review`; `local.acme.default.tasks.code-review.typescript` → `local.acme.default.tasks.dead-letter.code-review`.

**Reserved segment (cited, not owned).** `dead-letter` is a reserved `tasks` position-4 segment: a `capability-tag` MUST NOT equal it, so the escalation tree can never collide with real work. That reservation, its publish-time enforcement, and its rejection vectors (`capability/reject-dead-letter`) are owned by **ratified RFC-0002 §9** — this document cites the reservation and carries **no duplicate vector** for it (grill D25; the guard is currently held by no runtime code, which is RFC-0002's recorded finding).

**`TASKS_DEAD` stream-filter alignment (normative — grill D19).** The `TASKS_DEAD` JetStream stream (30-day audit retention) MUST be provisioned with subject filters that match **every** subject the deriver above can emit — the stack-aware 6-segment form as well as the legacy 5-segment form for as long as RFC-0002 accepts it. A stack-aware dead-letter subject MUST NOT silently escape the retention filter. As deployed, the filters are the legacy pair `local.*.tasks.dead-letter.>` / `federated.*.tasks.dead-letter.>`, which the stack-aware form does **not** match (the `*` binds the principal, then the literal `tasks` fails against the stack segment) — so dead-letter envelopes from any stack-aware deployment never land in `TASKS_DEAD` and the audit retention silently does not apply to the grammar's primary form. This is a conformance defect against this rule. Retiring the legacy no-stack acceptance is RFC-0002's decision (its §8.2 legacy-form window); the retirement window and release naming are BCP-0001's; this document owns only the filter-alignment rule stated here.

### 5.3. The `extensions.dead_letter` wrapper (OPTIONAL amplifier)

A dead-letter envelope wraps the original under `extensions.dead_letter` (a `DeadLetterExtension`) with a **fresh `id` and `timestamp`** (it is its own message) and the **`correlation_id` preserved** (`original.correlation_id ?? original.id` — §8.2; it is still the same logical task). Emitting it is OPTIONAL (§5.1); when emitted, the wrapper fields are:

| Field | Type | Requirement |
|---|---|---|
| `original_subject` | string | REQUIRED. The task subject the envelope was refused on. |
| `originating_consumer` | string | REQUIRED. The consumer whose chain exhausted (or `"unknown"`). |
| `delivery_count` | integer | REQUIRED. JetStream `delivery_count` at the routing decision. |
| `nak_chain` | array of `nak-reason` | REQUIRED. The accumulated reasons (§3.1 tokens). |
| `final_nak_reason` | `nak-reason` | REQUIRED. The reason that triggered the route. |
| `dead_lettered_at` | ISO-8601 string | REQUIRED. |
| `route_trigger` | `"exhaustion"` / `"compliance_block"` | OPTIONAL. Distinguishes fast path from exhaustion. (The kebab `"compliance-block"` is a receive-window alias, §3.4.) |

`extensions` is an **unsigned, mutable, unbounded** channel (excluded from every signature; `additionalProperties: true`, no size cap — RFC-0003, RFC-0004 §4.2). An intermediary can therefore alter a `dead_letter` wrapper without invalidating any stamp; see Security Considerations §10 ("S7").

> Provenance (informative): `DeadLetterExtension`/`createDeadLetterEnvelope`, myelin `src/transport/dead-letter.ts:30-127`.

### 5.4. The terminal `dispatch.task.failed` event (MANDATORY record)

The terminal `dispatch.task.failed` lifecycle event (subject per §6) is the **single MANDATORY durable record** of a task's death (§5.1). An implementation MUST emit it on every dead-letter route, whichever disposition model it runs; when the OPTIONAL §5.3 republish is also emitted, the republish precedes the terminal event. The payload is a `DeadLetterFailedPayload`:

| Field | Type | Requirement |
|---|---|---|
| `task_id` | string | REQUIRED. |
| `correlation_id` | `correlation-id` | REQUIRED (§8). |
| `distribution_mode` | string | REQUIRED. |
| `final_reason` | `nak-reason` | REQUIRED (§3.1 token). |
| `nak_chain` | array of `nak-reason` | REQUIRED. |
| `delivery_count` | integer | REQUIRED. |
| `dead_letter_subject` | string | REQUIRED. |
| `originating_consumer` | string | REQUIRED. |
| `route_trigger` | `"exhaustion"` / `"compliance_block"` | REQUIRED. |
| `nak_reason` | `nak-reason` | OPTIONAL (token duplicate of `final_reason`). |

**The token and the object (the carve, applied).** `final_reason` / `nak_chain` / `nak_reason` carry the transport **token** (§3.1). The refusal **object** `reason: { kind, detail, retry_after_ms }` — which cortex emits on this event and `specs/admission.md` §7 mandates for admission refusals — is **RFC-0010's**: its grammar, its carriage on this event, and the token↔object **seam-consistency rule** live there (§3). A failure event MAY carry both; when it does, this document requires only that the token be canonical — cross-field consistency is adjudicated by RFC-0010.

> Provenance (informative): `DeadLetterFailedPayload`, myelin `src/lifecycle/types.ts:89-97`; emission, `src/transport/dead-letter.ts:338-356`; object-carrying emitter, cortex `src/bus/dispatch-events.ts`.

---

## 6. The Rejection Lifecycle Event

### 6.1. `dispatch.task.rejected` payload

The durable channel (§3.2) is a `dispatch.task.rejected` lifecycle envelope, published on the subject:

```
local.{principal}[.{stack}].dispatch.task.rejected
```

The subject family is the `dispatch.task.*` lifecycle shape owned by **ratified RFC-0002 §7**; `rejected` is a member of its absorbed `lifecycle-state` set under the D14 canon (canonical lifecycle `received → dispatched → started → completed → aborted/failed`, with `progress` and `rejected` absorbed as deployed shape). This document mints no lifecycle token of its own (grill D26). Its payload is a `RejectedPayload`:

| Field | Type | Requirement |
|---|---|---|
| `task_id` | string | REQUIRED. `envelope.id` of the refused task. |
| `correlation_id` | `correlation-id` | REQUIRED. `envelope.correlation_id ?? envelope.id` (§8.2). |
| `distribution_mode` | string | REQUIRED. |
| `identity` | `did` | REQUIRED. DID of the rejecting agent (RFC-0001). |
| `reason` | `nak-reason` | REQUIRED (§3.1 token). |
| `description` | string | OPTIONAL. Free-form (§3.2). A leakage surface — §11. |
| `delivery_count` | integer | REQUIRED. |
| `originating_consumer` | string | OPTIONAL. |
| `original_subject` | string | OPTIONAL. |
| `original_envelope` | envelope | OPTIONAL. The **entire** original envelope, payload included (§11). |

> Provenance (informative): `RejectedPayload`, myelin `src/lifecycle/types.ts:105-113`; construction, `src/transport/nak.ts:128-176`.

Consumers of this event include threshold-review (per-agent/per-task rejection velocity, for velocity-class harm detection), audit / chain-of-stamps, and the M7 surface-router (which may route `compliance_block` rejections to a paging surface). The dead-letter handler (§5) is itself a consumer of this channel.

### 6.2. Delivery guarantee of the rejection channel (finding)

`dispatch.task.rejected` is emitted **best-effort**: the reference async path races the publish against a 2-second timeout and, on failure or stall, logs to `console.error` and naks anyway. The synchronous path (including the transport's default handler-error NAK) emits **nothing**. No stronger delivery guarantee (at-least-once, durable-queue-before-nak) is specified.

The audit trail for rejections is therefore structurally lossy, and the loss is invisible on the wire (the NAK still fires). This document does **not** specify a delivery guarantee for this channel; it records the gap. An implementation that relies on `dispatch.task.rejected` for a security or safety control (e.g. threshold-review as a harm brake) MUST account for its best-effort nature. See Security Considerations §10 ("S5").

### 6.3. Task-path delivery guarantees, idempotency, and deduplication

*(Grill D11/D12/D16 — normative.)*

**The guarantees, pinned.** The **JetStream task path is at-least-once**: delivered messages are stored, acked, and redelivered on nak or `ack_wait` expiry. The **core-NATS path — chat traffic and `_INBOX.` reply mailboxes (§7.4) — is at-most-once**: unpersisted, fire-and-forget, lost on any subscriber absence. An implementation MUST NOT claim, assume, or document either path as carrying the other's guarantee.

**Idempotency (cited, not re-owned).** A consumer on the at-least-once path WILL observe redeliveries of a message it has already begun or completed processing. The resulting **idempotency / double-execution obligation** — the receiver's duty under replay and redelivery — is owned by **ratified RFC-0004 §7.4 (D18)**, which defines the replay/redelivery vocabulary; this document cites that obligation and does not restate it. **Finding:** cortex's review consumer is not idempotent under redelivery — its redelivery guard (`src/bus/review-consumer.ts:685`, `deliveryCount > 1`) emits `dispatch.task.aborted` rather than deduplicating against already-completed work — and duplicate delivery has occurred in production from a doubled subject binding (cortex#491, the `nats.subjects` double-bind).

**Publish-side deduplication (normative).** A JetStream publish of an envelope MUST set the NATS `Nats-Msg-Id` header to the envelope's `id`, enabling server-side duplicate suppression within the stream's `duplicate_window`. No deployed publisher sets it today — a conformance defect against this rule, to be fixed alongside the flag-day R follow-ups. The **sizing of `duplicate_window` is a named follow-up** (§4.3, grill D12); this document mandates the id, not the window value.

---

## 7. Request-Reply

**Request-reply is OPTIONAL** (grill D21). The sub-protocol is half-built in the reference implementation — the responder half is specified here for the first time (§7.3) — and has **zero production consumers**; an implementation MAY omit it entirely. The requirements of §§7.1–7.4 bind an implementation only if it offers request-reply; an implementation that offers it MUST satisfy them in full.

### 7.1. The reply mailbox and `reply_to`

A requester MUST:

1. determine the correlation id (§8.2): `envelope.correlation_id` if present, else a fresh value (a request with no inbound correlation roots a new chain);
2. stamp `extensions.reply_to` with a **concrete, wildcard-free** reply mailbox subject;
3. **subscribe the mailbox before publishing** the request;
4. publish the request on the request subject;
5. settle on the first reply whose `correlation_id` equals the request's (§7.2).

The reply mailbox this layer mints is `_INBOX.{uuid}` (`reply-inbox` in Appendix A). A caller MAY supply its own `reply_to`; if supplied, it MUST satisfy the injection guard — it MUST start with `_INBOX.`, MUST NOT contain `*` or `>`, and MUST NOT equal bare `_INBOX.`. A `reply_to` that fails the guard MUST be rejected synchronously, before any subscribe. (`accepted-reply-to` in Appendix A.)

> Provenance (informative): `executeRequestReply`, myelin `src/transport/request-reply.ts:79-176`; guard, lines 94-106.

### 7.2. Correlation matching, timeout

The requester's inbox handler MUST filter incoming envelopes by exact `correlation_id` equality; a reply whose `correlation_id` does not match MUST be silently dropped. The request MUST settle (resolve) on the first matching reply, or reject after a timeout. The default timeout is **5000 ms** (`DEFAULT_REQUEST_TIMEOUT_MS`); a caller MAY override it. On timeout the requester MUST reject with an error naming the request subject and MUST tear down the inbox subscription. The subscription MUST also be torn down on settle and on publish failure.

**Timeout expiry is escalation-free by design** (grill D22). An expired request rejects locally to its caller and emits **no** lifecycle event, **no** dead-letter record, and **no** durable trace. This is intended fire-and-forget expiry, not a specification gap: the round-trip rides core NATS (§7.4, at-most-once — §6.3), and its reliability model belongs to the caller, not to the escalation machinery of §5.

### 7.3. Responder obligations

A responder that receives an envelope carrying `extensions.reply_to` and elects to reply MUST publish its reply to that `reply_to` subject with a `correlation_id` equal to the request's `correlation_id`. **This obligation is specified here for the first time**: no myelin source reads `extensions.reply_to`, so the responder half of the protocol has, to date, been purely implicit. A conformant responder implementation MUST implement it.

### 7.4. `_INBOX` routing and the namespace reservation

A subject beginning `_INBOX.` MUST be published via **core NATS**, bypassing JetStream: reply mailboxes are short-lived, point-to-point, and MUST NOT be persisted. This makes the delivery guarantee of a publish depend on a string prefix of its subject — the same `publish` API yields at-least-once persistence for a normal subject and at-most-once for an `_INBOX.` subject (§6.3).

**The reservation is resolved** (grill D23; the former OD-5 was stale). The `_INBOX.` prefix is reserved in the subject namespace by **ratified RFC-0002 §9 (D22)**: admitted by reference, uppercase-exempt (it is NATS's own byte-for-byte string), with this document owning the tail grammar (`inbox-prefix`, `inbox-id` — Appendix A), referenced there, not redefined. An application subject can no longer legitimately collide with the prefix; the residual durability-cliff observation is retained as context in §10 ("S3").

---

## 8. Correlation Identifier

### 8.1. Syntax

`correlation_id` is **UUID-only** (grill D17) — a canonical UUID string, and no other identifier form is admitted:

```abnf
correlation-id = uuid
uuid           = 8hexlc "-" 4hexlc "-" 4hexlc "-" 4hexlc "-" 12hexlc
hexlc          = DIGIT / "a" / "b" / "c" / "d" / "e" / "f"
```

An emitter MUST emit `correlation_id` in **lowercase**. The deployed validator (`UUID_RE`) carries the case-insensitive flag, so a receiver MUST accept an upper- or mixed-case UUID (`8-4-4-4-12` hex), and two case-variant spellings of one id both validate — a masking hazard for any code that compares `correlation_id` values as raw strings. The grammar constrains neither the RFC 4122 version nor the variant bits; a non-v4 or the nil UUID (`00000000-0000-0000-0000-000000000000`) passes. See Registry Considerations §9.

> Provenance (informative): `UUID_RE`, myelin `src/uuid.ts`; `generateCorrelationId`/`isValidCorrelationId`, `src/correlation.ts`. Emitters mint via `crypto.randomUUID()` (lowercase v4).

`correlation_id` is not an identifier terminal of RFC-0001 and is defined here.

### 8.2. Context-specific defaulting

*(Closes the former OPEN DECISION OD-6 — grill D18. The former OD was a wording problem, not a code defect.)*

An emitter SHOULD populate `correlation_id` explicitly. When an envelope lacks one, the default is **context-specific**, and the deployed contexts — four sites, not three — are ratified as correct:

| Site | Context | Default |
|---|---|---|
| myelin `src/transport/nak.ts:132` | rejection (§6) — an excursion of an existing task | inherit: `correlation_id ?? id` |
| myelin `src/transport/dead-letter.ts:120` | dead-letter (§5) — an excursion | inherit: `correlation_id ?? id` |
| myelin `src/transport/request-reply.ts:85` | request (§7) — a new root when the caller carries no correlation | mint fresh (`?? crypto.randomUUID()`) |
| myelin `src/dispatch/correlation.ts:51` (`deriveChildEnvelope`) / `:63` (`createReplyEnvelope`) | child / reply derivation | inherit when the parent has one; mint fresh when it has none (root of a new chain) |

**The invariant (normative):** an **EXCURSION** of an existing task — rejection, dead-letter, any derived child — MUST inherit (`correlation_id ?? id`); a **new ROOT** mints fresh; and a **REPLY MUST preserve an inbound `correlation_id` when one is present**. The request-reply fresh default is not a divergence: a request carrying no inbound correlation legitimately roots a new chain. What is non-conformant is discarding an inbound `correlation_id` — on the reply path that breaks §7.2's matching by construction.

### 8.3. Mutability

`correlation_id` is a **mutable** envelope field: it is excluded from every signature (the mutable carve-out, alongside `economics` and `extensions` — ratified RFC-0004 §4.2; envelope shape, RFC-0003). Per the hard contract of `docs/envelope.md`, a client MUST NOT make a security or trust decision based on `correlation_id` (or any mutable-field value). Correlation is a routing and observability convenience, never an authorisation input. See §10 ("S1").

---

## 9. Registry Considerations

This document makes the following registrations, all internal (no IANA or W3C registry is involved; this document defines no DID method).

- **RFC number.** RFC-0007, allocated in [`specs/README.md`](../README.md). Numbers are never reused.
- **Reserved NATS header field names.** `Myelin-Nak-Reason` and `Myelin-Nak-Description` (§3.2) are reserved for the NAK reason hint. Other producers MUST NOT repurpose these header names. This document also mandates the standard NATS `Nats-Msg-Id` header on JetStream publishes (§6.3); that name is NATS's, not this registry's.
- **Reserved subject segment.** `dead-letter`, as a `tasks` position-4 segment (§5.2) — **owned by ratified RFC-0002 §9**, cited here, not duplicated (grill D25).
- **Reserved subject prefix.** `_INBOX.` — **reserved by ratified RFC-0002 §9 (D22)**, admitted by reference with this document owning the tail grammar (§7.4). The former inbound-registration request is closed.
- **The NAK reason value set** (§3.1) is a **closed registry** of four snake_case values. The kebab-case renderings are **deprecated aliases**, accepted on receive during the dual-accept window and retired at flag-day R (§3.4). `policy_denied` is **resolved OUT** of this registry — its taxonomy home is RFC-0010's refusal-object `kind` registry (§3.4). Adding, renaming, or removing a value is an encoding change and MUST proceed through a new RFC (`Updates:` this one) and a dual-accept window, per [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and BCP-0001. There is deliberately **no payload-level version field** for this vocabulary: wire versioning is BCP-0001's, and the window + flag-day mechanism governs the migration (§3.1).
- **`correlation_id` UUID profile.** This document does not register a UUID version or variant constraint; the accepted form is any `8-4-4-4-12` hex string (§8.1). Tightening it to RFC 4122 v4 is a candidate future `Updates:`.

---

## 10. Security Considerations

This document specifies a delivery/reliability layer whose several invariants are held — where they are held at all — by **runtime checks, not by the grammar or by cryptography**. Per [`specs/README.md`](../README.md) rule 6, each such case is a finding, recorded here.

**S1 — Unauthenticated reply correlation (held by nothing; prohibition kept).** A request settles on the first inbox envelope whose `correlation_id` matches (§7.2); the inbox path performs **no signature verification**. Both `correlation_id` and `extensions.reply_to` are unsigned, mutable fields (§8.3, RFC-0004 §4.2), which §8.3 and `docs/envelope.md` forbid using for trust decisions — yet accepting an envelope *as the reply* and choosing *where to send a reply* are both trust decisions keyed entirely on those forgeable values. `_INBOX` traffic is core NATS, unpersisted, and publishable by anyone with pub rights on the subject; a mid-path hub may legally rewrite `reply_to`. Accordingly, **request-reply MUST NOT carry any security-relevant exchange in v1** (grill D20). This prohibition cannot be engineered away within v1: the mitigation pair sometimes proposed — mailbox scoping plus responder-signed replies — **cannot close S1**, because `correlation_id` sits inside RFC-0004's mutable carve-out (§4.2) and v1 signatures bind no nonce and no reply/subject (RFC-0004 §7.4), so a re-stamped replay of a legitimately-signed envelope settles as a forged reply. The real fix is a future **RFC-0004 `Updates:`** placing a per-request nonce or reply-binding inside the signed bytes — deferred, recorded here. Narrowing `_INBOX` pub/sub grants per requester remains **hygiene guidance** (a deployment SHOULD scope them) without lifting the prohibition.

**S2 — Unsigned NAK frames and headers.** The NAK operation itself carries no authentication, and the `Myelin-Nak-Reason`/`-Description` headers are consumer-appended, unsigned, and in-process only (§3.2). The durable `dispatch.task.rejected` event carries the reason in its payload, but nothing binds that event's reason to a verified refusal — a flaky or hostile intermediary can suppress a rejection record (§S5) or, on the header channel, mislabel a refusal to an in-process observer. Consumers MUST treat a NAK reason as an advisory classification, not an attested fact.

**S3 — `_INBOX` durability cliff (reservation resolved).** A subject's delivery guarantee flips between persisted (JetStream) and un-persisted (core NATS) on a `startsWith("_INBOX.")` check (§7.4). The reservation gap this once implied is **closed**: ratified RFC-0002 §9 reserves `_INBOX.` (D22), so an application subject can no longer legitimately occupy the prefix. What remains is the structural observation that a delivery guarantee is decided by a string prefix at runtime; implementations adding publish paths MUST preserve the §7.4 routing rule.

**S4 — Reserved `dead-letter` segment unenforced (RFC-0002's finding, cited).** §5.2's reservation — a `capability-tag` never equals `dead-letter` — is owned by ratified RFC-0002 §9, whose vectors (`capability/reject-dead-letter`) pin the REQUIRED rejection and which records that no runtime guard currently holds it (`dead-letter` matches `CAPABILITY_TAG_RE`; `taskSubject('acme','dead-letter')` mints a work subject inside the escalation tree). This document cites that finding rather than duplicating its vector (grill D25).

**S5 — Best-effort rejection audit (evadable brake).** `dispatch.task.rejected` is documented as the only durable record of *why* a task was rejected, and threshold-review depends on it to detect velocity-class harm — yet its emission is best-effort behind a 2-second timeout, and the synchronous handler-error path emits nothing (§6.2). An attacker (or merely a flaky publisher) that suppresses rejection records can stay under a threshold-review brake while its rejections still nak on the wire. No delivery guarantee is specified. A control that relies on this channel MUST NOT assume completeness.

**S6 — `not_now` silent task loss (reliability).** A task nak'd `not_now` `max_deliver` times — whatever the per-consumer configured value (§4.2) — is dropped with no dead-letter and no terminal event. A sender that can keep a target agent at capacity can cause targeted, unaudited task loss. The equality invariant (§4.2) governs the `cant_do`/`wont_do` path but does not close this hazard; it stands as a recorded finding.

**S7 — Mutable, unbounded carrier for `dead_letter` and `reply_to`.** `extensions` is unsigned, `additionalProperties: true`, and size-unbounded (RFC-0003 / RFC-0004 §4.2). Both the `dead_letter` wrapper (§5.3) and `reply_to` (§7.1) ride there. An intermediary can rewrite `reply_to` (redirecting a reply — see S1) or tamper the `nak_chain`/`route_trigger` of a `dead_letter` wrapper without invalidating any stamp, and can inflate `extensions` without bound. Consumers MUST treat these fields as untrusted input and SHOULD bound their size on receipt.

**S8 — Free-form description leakage.** The `Myelin-Nak-Description` header and `RejectedPayload.description` carry free-form text; the default handler-error path copies raw `err.message` into them (§3.2, §6.1). Error text can carry sensitive internal detail; see §11.

**S9 — Unbounded `retry_after_ms` override.** A present `retry_after_ms` overrides the backoff curve raw, with no clamp anywhere on its path (§4.1). Because the refusal object rides mutable, unsigned carriage (RFC-0010 / S7), a responder or intermediary can park a redelivery arbitrarily far in the future — an unaudited delay lever against a specific task. Receivers SHOULD cap the value they honour (§4.1); the cap is guidance, not wire law.

The threat model this document assumes: an authenticated but potentially misbehaving participant on the bus (over-broad pub rights, a compromised intermediary/hub), and a passive observer of subjects. It does **not** assume the transport itself provides confidentiality or per-frame authentication of NAKs and replies; those properties, where needed, MUST be supplied by the envelope signing layer (RFC-0004), which does not cover the mutable fields this layer relies on.

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

An implementation adds exactly one conformance test that loads the vectors, runs **its own** implementations of the conformance operations, and asserts. It MUST NOT import the reference implementation. The operations:

- **`resolveNakReason`** — the §3.4 receive algorithm, tested **post-normalization**: known kebab aliases normalize to their snake canonicals FIRST; only a value still unknown after normalization (or missing) coerces to `cant_do`. A resolver that coerces before normalizing misroutes every live alias mid-window and fails these vectors.
- the dead-letter-subject deriver (§5.2), the `reply_to` guard (§7.1), the `correlation_id` validator (§8.1), the backoff function (§4.1), and the dead-letter route selector (§5.1);
- **the carve-line resolver** (grill D24 — the keystone's teeth): given a failure event carrying both a §3.1 **token** and an RFC-0010 refusal **object**, the implementation routes disposition off the token and leaves object-grammar and token↔object consistency adjudication to RFC-0010 — asserting the §3 layered ownership on the wire.

Because this dimension's canonical vocabulary shipped in three divergent spellings across two repositories with no shared vectors, conformance to §3.1 + §3.4 (the canonical snake_case set behind the normalize-then-coerce window) is the single most load-bearing requirement: an emitter that renders a kebab token, or any fifth value, is non-conformant on emit today; a receiver that fails to normalize the kebab aliases during the window, or that still accepts them after flag-day R, is non-conformant on receive.

**Vector manifest.** The vector set is split per [`specs/vectors/README.md`](../vectors/README.md) into `specs/vectors/transport/valid.json`, `specs/vectors/transport/invalid.json`, and `specs/vectors/transport/render.json` (grill D28; the Author-Vectors stage writes them, retiring the combined Draft `vectors.json`), adding the operations introduced by this revision — post-normalization `resolveNakReason`, the carve-line resolver, and the `TASKS_DEAD` filter-alignment render — and completing the positive/negative/render adversarial coverage: the masking cases (upper-case `correlation_id`), the collision/drift cases (kebab aliases mid-window and post-window; `policy_denied` coercion), and the cross-form cases (legacy vs stack-aware dead-letter subjects). The reserved-segment rejection vector is **not** carried here — it is RFC-0002's (`capability/reject-dead-letter`, grill D25). All vectors are public-safe: no live platform identifiers and no 17–20-digit consecutive runs anywhere.

---

## 13. References

### 13.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [RFC4122] Leach, P., Mealling, M., and R. Salz, "A Universally Unique IDentifier (UUID) URN Namespace", RFC 4122, July 2005. *(The `correlation_id` UUID string form, §8. Version/variant constraints are not imposed — §9.)*
- [RFC-0001] metafactory, "Identifiers and Identity (the `did:mf` DID Method Specification)", **Ratified**. *(Identifier terminals: `principal-id`, `stack-slug`, `did`, `@`-assistant encoding; the flag-day R hard cut, §9.)*
- [RFC-0002] metafactory, "Subject Namespace", **Ratified**. *(Owner of the task-subject grammar, the reserved `dead-letter` segment and `_INBOX.` prefix (D21/D22), and the dispatch lifecycle-token canon (D14) — §3.5, §5.2, §6.1, §7.4.)*
- [RFC-0003] metafactory, "Envelope", **Ratified**. *(Envelope fields `correlation_id`, `extensions`, `sovereignty`, `distribution_mode`.)*
- [RFC-0004] metafactory, "Envelope Signing", **Ratified**. *(The mutable carve-out, §4.2; the replay/redelivery vocabulary and the receiver's idempotency obligation, §7.4 D18 — cited by §6.3, §8.3, §10 S1.)*
- [RFC-0006] metafactory, "Membership and Admission", **Ratified**. *(Owner of membership-boundary rejects — the third layer of the §3 carve; snake_case payload-token precedent, `identity_mismatch`.)*
- [BCP-0001] metafactory, "Wire Change Control and Versioning", **Ratified**. *(Dual-accept doctrine and release naming for the §3.4 window; owner of wire versioning — the reason this document carries no payload version field.)*

### 13.2. Informative References

- [`grill-logs/rfc-0007.md`](grill-logs/rfc-0007.md) — the authoritative grill decision log for this revision (28 decisions, Andreas 2026-07-15).
- [`docs/nak-reasons.md`](../../docs/nak-reasons.md) — the de-facto NAK protocol document, promoted by this RFC (`supersedes_prose`).
- [`docs/design-agent-task-routing.md`](../../docs/design-agent-task-routing.md) — origin design (Pattern 4; structured NAK; dead-letter routing).
- [`specs/admission.md`](../admission.md) — admission refusals reusing the refusal object (snake_case `reason` — taxonomy owner: RFC-0010).
- [RFC-0010] metafactory, "Rate-limit and Refusal Taxonomy", Chartered (not yet drafted). *(Owner of the refusal OBJECT `{ kind, detail, retry_after_ms }` — grammar, `kind` registry, transient-vs-permanent rule, carriage incl. `nak(retry_after_ms)` — and the object↔token seam-consistency rule. The 0007⇄0010 boundary is ratified at §3 of this document; 0010 designs its far side.)*
- [`specs/CONFORMANCE.md`](../CONFORMANCE.md), [`specs/vectors/README.md`](../vectors/README.md) — conformance and vector schema.
- Reference implementation (myelin `origin/main`): `src/transport/nak.ts`, `src/transport/dead-letter.ts`, `src/transport/request-reply.ts`, `src/transport/types.ts`, `src/transport/jetstream-base.ts`, `src/lifecycle/types.ts`, `src/dispatch/correlation.ts`, `src/subjects.ts`, `src/correlation.ts`, `src/uuid.ts`, `src/sovereignty/types.ts`.
- Consumer implementation (cortex `origin/main`): `src/bus/dispatch-events.ts`, `src/surface/mc/projection/failed-dispatch.ts`, `src/bus/jetstream/provision.ts`, `src/runner/release-consumer.ts`, `src/runner/dev-consumer.ts`, `src/bus/review-consumer.ts`, `docs/architecture.md`.
- Wire-protocol gap analysis, [`docs/wire-protocol-gap-analysis.md`](../../docs/wire-protocol-gap-analysis.md).

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in `grammar` (`specs/grammar/transport.abnf`) is the source of truth and is what CI validates.

```abnf
; specs/grammar/transport.abnf
; RFC-0007 — Transport and Reliability
; Status: Draft. This grammar is NOT normative until the RFC is Ratified
; (see specs/README.md). Grounding behaviour on a Draft is an error.
; Terminal alphabets for identifiers are defined ONCE elsewhere and cited
; by name, never redefined (grammar/README rule 5):
;   principal-id, stack-slug — RFC-0001 (Ratified) specs/grammar/identifiers.abnf
;   capability-tag           — RFC-0002 (Ratified); capability-id grammar
;                              normatively owned by RFC-0008 (REVISIONS C5)
; Core rules DIGIT, HEXDIG imported from RFC 5234 Appendix B.

; 1. NAK reason vocabulary (closed set; canonical snake_case — payload plane).
;    The kebab renderings are dual-accept receive-window ALIASES (RFC §3.4),
;    normalized on receive and retired at flag-day R. policy_denied is NOT a
;    member (RFC-0010 taxonomy home; RFC §3.4).
nak-reason       = %s"cant_do" / %s"wont_do" / %s"not_now" / %s"compliance_block"
nak-reason-alias = %s"cant-do" / %s"wont-do" / %s"not-now" / %s"compliance-block"
                 ; receive-window only; never emitted; retired at flag-day R

; 2. Two-channel carriage — in-process NATS header field NAMES.
nak-reason-header-name       = "Myelin-Nak-Reason"
nak-description-header-name   = "Myelin-Nak-Description"
nak-reason-header-value      = nak-reason
; nak-description-header-value = *%x00-10FFFF   ; opaque; free-form (§11)

; 3. correlation_id — canonical UUID string (not an RFC-0001 terminal).
;    UUID-only (D17). Emit lowercase; accept case-insensitive;
;    version/variant unconstrained.
correlation-id = uuid
uuid           = 8hexlc "-" 4hexlc "-" 4hexlc "-" 4hexlc "-" 12hexlc
hexlc          = DIGIT / "a" / "b" / "c" / "d" / "e" / "f"

; 4. Dead-letter subject — the SUBJECT plane stays kebab (RFC-0002).
;    The reserved segment "dead-letter" is owned + enforced by RFC-0002 §9;
;    cited here (D25). Stack segment OPTIONAL only for the transitional
;    legacy form (retirement: RFC-0002 §8.2 / BCP-0001). The TASKS_DEAD
;    stream filters MUST match both forms (RFC §5.2, D19).
dead-letter-segment = "dead-letter"
subject-prefix      = "local" / "federated"
dead-letter-subject = subject-prefix "." principal-id
                      [ "." stack-slug ]
                      ".tasks." dead-letter-segment "." capability-tag

; 5. Request-reply mailbox. "_INBOX." routes via core NATS (JetStream
;    bypass, at-most-once). The prefix is RESERVED by RFC-0002 §9 (D22),
;    admitted by reference; this file owns the tail grammar.
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

The set is split per §12 into `valid.json` / `invalid.json` / `render.json` under `specs/vectors/transport/` (the Author-Vectors stage writes them; the combined Draft `vectors.json` retires when they land). All vectors are public-safe.

Representative vectors:

```jsonc
// The canonical NAK set — the single most load-bearing contract of this RFC.
{ "id": "nak-reason/compliance-block-canonical", "rfc": 7, "kind": "resolveNakReason",
  "input": "compliance_block", "expect": { "ok": true, "value": { "reason": "compliance_block" } },
  "why": "Canonical snake_case (D2): M7 attestation refusal — immediate dead-letter fast path, never retried." }

// DUAL-ACCEPT WINDOW — normalize FIRST (D4/D5). Post-window this becomes a coercion.
{ "id": "nak-reason/kebab-alias-normalized", "rfc": 7, "kind": "resolveNakReason",
  "input": "not-now", "expect": { "ok": true, "value": { "reason": "not_now" } },
  "why": "Kebab is a receive-window alias of the snake canonical; normalization runs BEFORE the unknown-coerce, or every live alias misroutes mid-window (§3.4). Retires at flag-day R." }

// COERCION — genuinely unknown AFTER normalization → cant_do (D5).
{ "id": "nak-reason/policy-denied-coerced", "rfc": 7, "kind": "resolveNakReason",
  "input": "policy_denied", "expect": { "ok": true, "value": { "reason": "cant_do" } },
  "why": "Not a transport token — a pre-spawn authorization refusal homed in RFC-0010 (§3.4). Unknown after normalization, so the transport reads it as cant_do; the cortex fifth-value emission is a conformance defect fixed at R." }

// CARVE-LINE KEYSTONE (D24) — a 0007 token WEARING a 0010 object.
{ "id": "carve/token-wearing-object", "rfc": 7, "kind": "resolveFailureReason",
  "input": { "final_reason": "not_now",
             "reason": { "kind": "not_now", "detail": "at capacity", "retry_after_ms": 30000 } },
  "expect": { "ok": true, "value": { "reason": "not_now", "delay_ms": 30000 } },
  "why": "The layered carve (§3): disposition routes off the 0007 token; retry_after_ms from the 0010 object overrides the backoff curve raw (§4.1, no clamp); object grammar + token↔object consistency are RFC-0010's to adjudicate." }

// MASKING — case-insensitive correlation_id.
{ "id": "correlation-id/uppercase-accepted", "rfc": 7, "kind": "parseCorrelationId",
  "input": "550E8400-E29B-41D4-A716-446655440000", "expect": { "ok": true, "value": { "uuid": "550E8400-E29B-41D4-A716-446655440000" } },
  "why": "Emit is lowercase but UUID_RE carries /i, so uppercase validates — two spellings of one id both pass (§8.1)." }

// CROSS-FORM — the dead-letter subject render + the filter-alignment rule (D19).
{ "id": "dead-letter/stack-aware-6seg", "rfc": 7, "kind": "renderDeadLetterSubject",
  "input": "local.acme.default.tasks.code-review.typescript",
  "expect": { "ok": true, "value": "local.acme.default.tasks.dead-letter.code-review" },
  "why": "Stack-aware form preserves the stack, drops the subcapability. §5.2 REQUIRES the TASKS_DEAD filters to match this form; the deployed legacy filters do not — a conformance defect against D19." }

// reply_to injection guard.
{ "id": "reply-to/wildcard-gt-rejected", "rfc": 7, "kind": "validateReplyTo",
  "input": "_INBOX.>", "expect": { "ok": false, "reason": "wildcard-in-reply-to" },
  "why": "A '>' would subscribe the reply onto a wildcard — subject-injection guard (§7.1, §10 S1)." }

// not_now backoff cap + the silent-loss context.
{ "id": "backoff/not-now-delivery-7-cap", "rfc": 7, "kind": "notNowBackoffMs",
  "input": 7, "expect": { "ok": true, "value": 60000 },
  "why": "Backoff caps at 60s; rows beyond the consumer's configured max_deliver are unreachable (§4.2, S6 silent loss)." }

// Dead-letter routing — not_now never routes.
{ "id": "route/not-now-excluded", "rfc": 7, "kind": "deadLetterRouteTrigger",
  "input": { "reason": "not_now", "chainLength": 9 }, "expect": { "ok": true, "value": null },
  "why": "not_now is excluded from the exhaustion budget at any chain length (§5.1) — the very exclusion behind the S6 JetStream-layer loss." }
```

The reserved-segment rejection case (`capability/reject-dead-letter`) lives with **RFC-0002's** vectors, which own the reservation (grill D25) — it is deliberately absent here.

---

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Codifies the code-only reliability layer: closed 4-value `nak-reason` set (§3), two-channel carriage (§3.2), `not-now` backoff (§4), dead-letter routing + reserved segment + `extensions.dead_letter` (§5), `dispatch.task.rejected` (§6), request-reply / `_INBOX` (§7), `correlation_id` (§8). Records OD-1..OD-6 and Security findings S1–S8. Promotes `docs/nak-reasons.md`. |
| 2026-07-13 | Draft | Cascade sweep (REVISIONS.md pass). C3: OD-1/OD-2 retargeted to resolve against the newly chartered RFC-0010 (Rate-limit and Refusal Taxonomy; not yet drafted) — §3.4, §5.4, §9, references, open items. C6: OD-4 rescoped to this RFC's `TASKS_DEAD` stream-filter-alignment slice only; subject grammar + legacy accept/reject → RFC-0002, retirement window + release naming → BCP-0001 (§5.2). C8: OD-5 pointed at RFC-0002's reserved-prefix registry, which adjudicates `_INBOX.` alongside RFC-0005's `_nak.` (§7.4, §9). DID cascade verified no-op. No open decision was resolved, weakened, or deleted. |
| 2026-07-15 | Draft | **Grill outcome woven** ([`grill-logs/rfc-0007.md`](grill-logs/rfc-0007.md), 28 decisions, all final, Andreas 2026-07-15). Keystones: canonical spelling flips to **snake_case** (`cant_do \| wont_do \| not_now \| compliance_block`, D2 — kebab is subject-plane only; myelin `NakReason` flips at flag-day R; no payload version field, BCP-0001 owns versioning); the **layered carve** pinned in §3 (0007 owns token set + dispositions; 0010 owns the refusal object, its carriage, and the seam-consistency rule; 0006 owns membership rejects — D8/D3/D1; the RFC-0010 charter amended in the same commit). All six former open decisions CLOSED: OD-1/OD-2 → dual-accept normalize-then-coerce window + closed-for-emit, `policy_denied` OUT with its `{kind:'term'}` disposition recorded as-is (D4/D5); OD-3 → `max_deliver` equality invariant with a per-consumer value, `not_now` budget restated (D14); OD-4 → normative `TASKS_DEAD` filter-alignment rule (D19); OD-5 → resolved by ratified RFC-0002 D22, cited (D23); OD-6 → context-specific correlation defaulting ratified with the corrected FOUR-site enumeration and the excursion/root/reply invariant (D17/D18). Also: both dead-letter models conformant, `term` permitted-not-required, `dispatch.task.failed` the single mandatory record (D9/D10); at-least-once/at-most-once pinned with idempotency cited to RFC-0004 §7.4, `Nats-Msg-Id = envelope.id` mandated, `duplicate_window` sizing a named follow-up (D11/D12); consumer-configuration contract consolidated, `ack_wait` as-is (D13); ordering = NONE (D15); two modes/two guarantees (D16); `retry_after_ms` precedence codified as-is with **no clamp**, unbounded-delay finding S9 + SHOULD-cap guidance (D6); `compliance_block` sub-code seam cited to RFC-0002 D21 (D7); request-reply OPTIONAL (D21) with escalation-free expiry by design (D22); S1 prohibition KEPT with the mitigation-pair impossibility recorded and the RFC-0004 `Updates:` fix deferred (D20); `dispatch.task.rejected` aligned to the RFC-0002 D14 lifecycle canon (D26); stale seam citations cascade-swept — 0001/0002/0003/0004/0006/BCP-0001 now Ratified (D27); duplicate reserved-segment vector removed, cited to RFC-0002 (D25); carve-line keystone conformance op + vector added (D24); vector manifest split `valid.json`/`invalid.json`/`render.json` with the new kinds, Author-Vectors writes them (D28). Status stays Draft pending the principal's ratify commit (ADR-0001). |

### Open items before ratification

- Author-Vectors: write `specs/vectors/transport/valid.json` / `invalid.json` / `render.json` (D28), including the post-normalization `resolveNakReason` set, the carve-line keystone (D24), and the filter-alignment render (D19); retire the combined `vectors.json`.
- Flag-day R code follow-ups (file in the myelin/cortex trackers): flip myelin `NakReason` (`src/lifecycle/types.ts:6`) to snake_case; remove `policy_denied` from cortex's transport reason position (§3.4); set `Nats-Msg-Id = envelope.id` on JetStream publishes (§6.3); align the `TASKS_DEAD` stream filters (§5.2).
- Named follow-up: `duplicate_window` sizing (§4.3, D12).
- Deferred: the RFC-0004 `Updates:` placing a nonce / reply-binding inside the signed bytes — the only real closure of S1 (§10, D20).
- RFC-0010 draft: the refusal-object grammar, `kind` registry (including `policy_denied`'s home), carriage, and the object↔token seam-consistency rule (§3; charter amended 2026-07-15).

## Acknowledgments

This draft is grounded in the wire-protocol audit of the `transport` dimension, the reference implementation on myelin `origin/main`, and the 2026-07-15 grill (35-agent docket, 6 facets, 28 decisions — [`grill-logs/rfc-0007.md`](grill-logs/rfc-0007.md)). The NAK vocabulary and two-channel model are the work recorded in `docs/nak-reasons.md` and the F-022 / F-4 / F-020 design line.

## Authors' Addresses

Luna (drafting agent), metafactory.
Ratification (v1, ADR-0001): the principal (Andreas) alone; the hub-custodian signature is suspended, not deleted, and reinstates with a second implementation or a live federated peer.

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
