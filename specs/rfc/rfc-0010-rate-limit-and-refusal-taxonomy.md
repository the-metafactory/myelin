---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0010
title: Rate-limit and Refusal Taxonomy
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
created: 2026-07-13
ratified: 2026-07-15
grammar: specs/grammar/rate-limit.abnf
vectors: specs/vectors/rate-limit/
generated: []
supersedes_prose:
  - specs/admission.md          # retitled by this RFC to the substrate rate-limit contract (RFC-0006 OD-1)
crossRefs: ["0001", "0004", "0005", "0006", "0007", "bcp-0001"]   # reconciled to §9.1 Normative References (#236 item 6): 0001 terminals, 0004 chain, 0005 NakReasonCode registry, 0006 OD-1 relabel, 0007 §3 boundary, bcp-0001 change control
---

# RFC-0010: Rate-limit and Refusal Taxonomy

## Abstract

Two contracts share this document because they meet in one object. First, the **terminal
refusal taxonomy**: the `reason: { kind, detail, retry_after_ms }` object that explains *why*
work was refused and *when* to retry — its field grammar, its closed `kind` registry, the
transient-vs-permanent rule per kind, its carriage on dispatch failure events and on JetStream
`nak(retry_after_ms)`, and the seam-consistency rule binding it to RFC-0007's transport tokens.
Second, the **substrate rate-limit contract**: the NATS-KV bucket and key grammar, token-bucket
window and in-flight lease semantics, the CAS arbitration that makes counters exact under N
nodes, and the failure posture — promoted to normative form from the prose contract formerly
mislabelled `specs/admission.md` (retitled by this document, closing RFC-0006 OD-1). The
0007⇄0010 boundary was ratified at RFC-0007 §3: RFC-0007 owns the transport token value set and
its dispositions; this document owns the refusal object and everything about it.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Ratified` (single-principal, 2026-07-15) under
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md). Only a document with status
`Ratified` is normative; implementations MUST NOT ground behaviour on a `Draft` or `Proposed`
document. This document is normative and buildable-against; as a living spec it stays revisable
if review or use finds a hole.

Ratification is single-principal per
[ADR-0001](../../docs/adr/0001-single-principal-ratification.md): while myelin is the only
implementation and no federated peer is live, the principal alone ratifies, recorded in
`signatories`. Under ADR-0001 a `Ratified` RFC is a **living spec** — revisable if review or use
finds a hole; the two-signature act and immutable-once-`Ratified` discipline reinstate on a
second independent implementation or a live federated peer.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

1. Introduction
2. The Refusal Object
3. The Substrate Rate-Limit Contract
4. Failure Posture
5. Registry Considerations
6. Security Considerations
7. Privacy Considerations
8. Conformance
9. References
- Appendix A. Collected ABNF
- Appendix B. Test Vectors
- Appendix C. Change Log

---

## 1. Introduction

When the fabric refuses work, two different questions need answers on the wire: *what does
delivery do next* (redeliver? back off? dead-letter?) and *why was this refused, and when should
the producer try again*. Ratified RFC-0007 §3 settled the ownership as a **layering**: the first
question is RFC-0007's — the closed transport NAK token value set and the dispositions those
tokens drive. The second is this document's — the structured refusal **object** and its
registry. One refusal can be an RFC-0007 token *wearing* an RFC-0010 object; the two travel
together and this document defines the rule that keeps them coherent (§2.4).

The refusal object's most important producer is the **substrate rate limiter** — the admission
gate that decides whether a dispatch may spawn work at all. Its contract (KV state, token
buckets, CAS arbitration, failure posture) shipped as informative prose in a file misleadingly
named `specs/admission.md` (RFC-0006 established that *membership admission* is a different
protocol entirely). This document promotes that contract to normative form (§3–§4) and retitles
the prose file, closing RFC-0006 OD-1.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as
shown here.

### 1.2. Terminology

| Term | Meaning |
|---|---|
| **refusal object** | The `reason: { kind, detail, retry_after_ms }` structure this document owns (§2). |
| **kind** | A token from the closed registry of §2.2 naming the refusal's cause class. |
| **transport token** | An RFC-0007 §3.1 NAK reason value (`cant_do`, `wont_do`, `not_now`, `compliance_block`) — NOT this document's; cited. |
| **mirror kind** | A `kind` whose token spelling equals a transport token value. |
| **substrate rate limiter / admission gate** | The pre-spawn gate of §3 deciding whether a dispatch may consume executor capacity. Distinct from *membership admission* (RFC-0006). |
| **requester principal** | The principal a rate decision is attributed to (the verified last-stamp principal, or the anonymous/public principal for zero-authority traffic). |

---

## 2. The Refusal Object

### 2.1. Shape

```jsonc
"reason": {
  "kind": "not_now",              // REQUIRED — closed registry, §2.2
  "detail": "admission: rate limit (principal=…, window=…)",  // OPTIONAL free text
  "retry_after_ms": 30000         // OPTIONAL — REQUIRED when kind is transient (§2.3)
}
```

- `kind` MUST be a member of the §2.2 registry (snake_case, per the **default** ratified
  payload-plane convention — RFC-0007 D2, RFC-0006 precedent; RFC-0005's kebab-case `NakReasonCode`
  sub-codes that refine `compliance_block` are the one ratified exception, RFC-0007 §3.5).
- `detail` is OPTIONAL free-form operator text. It is a leakage surface (§7) and MUST NOT be
  required for machine handling — a consumer MUST NOT parse `detail` to make a routing or trust
  decision.
- `retry_after_ms` is a non-negative integer producer capacity hint. Its consumption precedence
  is RFC-0007 §4.1's (a present `retry_after_ms` overrides the delivery-count backoff curve for
  that redelivery, applied raw — the unbounded-delay hazard is RFC-0007's recorded finding).

The object rides (a) `dispatch.task.failed` / `dispatch.task.rejected` lifecycle payloads
(`payload.reason`), and (b) JetStream `nak(retry_after_ms)` on queued consumers. Both carriages
are this document's (ratified boundary, RFC-0007 §3).

### 2.2. The `kind` registry (closed)

| kind | class | disposition context |
|---|---|---|
| `cant_do` | permanent-ish | mirror of the transport token: static capability mismatch — retry to exhaustion, then dead-letter (disposition is the token's, RFC-0007 §5). |
| `wont_do` | permanent-ish | mirror: sovereignty/policy refusal — capable but declines. |
| `not_now` | **transient** | mirror: capacity/backpressure — `retry_after_ms` REQUIRED; never terminates work (§2.3). |
| `compliance_block` | permanent | mirror: attestation/sovereignty enforcement refusal — immediate dead-letter fast path; sub-codes are RFC-0005's `NakReasonCode` registry. |
| `policy_denied` | **permanent** | NOT a transport token (RFC-0007 D4 evicted it from the transport set): a pre-spawn authorization-gate refusal. Its deployed disposition is `term` (no redelivery), ratified as-is. |

The registry is **closed**: adding, renaming, or removing a kind is a wire change requiring a
new RFC (`Updates:` this one) and a dual-accept window per BCP-0001 — the `policy_denied`
incident (a fifth value added consumer-side with no negotiation, RFC-0007 §3.4) is the cautionary
precedent. A receiver encountering an unknown `kind` MUST treat the object as carrying no
machine-readable cause (fall back to the co-carried transport token's disposition) and SHOULD
surface `detail` verbatim.

### 2.3. Transient vs permanent

- `not_now` is **transient by definition**: it MUST carry `retry_after_ms`, and it MUST NOT be
  paired with a terminating disposition — **`term` is FORBIDDEN for admission refusals**. Rate
  exhaustion always defers (`nak(retry_after_ms)`); a rate limit that killed work would convert
  backpressure into data loss.
- `policy_denied` and `compliance_block` are **permanent**: retrying cannot change the outcome
  (the same policy refuses on every attempt). `policy_denied`'s deployed `{kind:'term'}`
  disposition is ratified as-is (RFC-0007 D4).
- `cant_do` / `wont_do` follow their transport token's retry-to-exhaustion disposition
  (RFC-0007 §5.1); they are permanent *in outcome* but not terminated early — the exhaustion
  budget applies.
- **Ordering (normative):** permanent refusals are evaluated BEFORE transient ones. The
  authorization/policy gate runs first; the rate limiter is consulted only for requests that
  would otherwise spawn. This keeps limiter I/O off the path of requests that were going to be
  denied anyway, and never converts a permanent deny into an endless retry loop.

### 2.4. The seam-consistency rule (chartered at RFC-0007 §3; owned here)

When a refusal object is co-carried with an RFC-0007 transport token:

- If `kind` is a **mirror kind**, it MUST equal the co-carried token. A mismatched pair
  (`final_reason: "not_now"` with `reason.kind: "cant_do"`) is **malformed** — a producer MUST
  NOT emit it, and a receiver MUST route on the transport token and treat the object as carrying
  no machine-readable cause.
- If `kind` is `policy_denied` (non-mirror), the pair is well-formed with any token whose
  disposition matches its permanence (the deployed pairing routes `term`).
- Disposition ALWAYS routes off the transport token (RFC-0007 §3): the object explains and
  hints; it never overrides delivery.

---

## 3. The Substrate Rate-Limit Contract

*Promoted from the prose contract formerly at `specs/admission.md` (retitled by this document;
listed in `supersedes_prose`). The prose file remains the extended reference for worked
examples; where the two disagree, this document governs.*

### 3.1. Identity — what a decision keys on

A rate decision is attributed to the **requester principal**: the verified last-stamp principal
of the triggering envelope (RFC-0004 chain; RFC-0005 §6.1), or the anonymous/public principal
for zero-authority traffic. Capability and agent coordinates extend the key at reserved tiers
(§3.3).

### 3.2. Bucket

One KV bucket per (principal, stack) — the same granularity as the stack's JetStream domain, so
the limiter's availability equals the dispatch fabric's:

```
admission_{principal}_{stack}
```

Provisioning is the consuming stack's responsibility and MUST be idempotent — assert-or-create
at boot, never drop on shutdown (KV state outlives the process; a restarted node inherits live
counters). RECOMMENDED configuration: `history: 1`, file storage, replicas following the
stack's JetStream replication.

### 3.3. Key grammar

Keys are dot-separated segments; each segment MUST match `key-segment` (Appendix A) — lowercase
`[a-z0-9-]`, a strict subset of the NATS KV key alphabet. The first segment is the **counter
kind** (`rate` | `inflight`), the second the **tier**, the remainder the tier's identity
coordinates:

```
{kind}.{tier}[.{coordinates}]
```

| Tier | Key | Protects against |
|---|---|---|
| 1 — stack | `rate.stack` / `inflight.stack` | total substrate overload |
| 2 — principal | `rate.principal.{principal}` / `inflight.principal.{principal}` | one requester starving others |
| 3 — principal × agent (RESERVED) | `rate.principal-agent.{principal}.{agent}` | — |
| 4 — capability (RESERVED) | `rate.capability.{capability}` | — |

Reserved tier keys MUST NOT be repurposed.

**Charset is validated, never coerced (the RFC-0006 D15 carve, landed here).** A principal
segment that does not match `key-segment` MUST be **rejected**, not normalized: silent coercion
(uppercasing, `_`→`-`, truncation) maps distinct principals onto one KV key, merging their
counters — a correctness and isolation failure. The `admissionKeyPrincipalSegment` conformance
operation and its collision vectors (Appendix B) bind this.

### 3.4. Entries and windows

`rate.*` entries hold token-bucket window state (`per_minute` | `per_hour` | `per_day` tiers);
`inflight.*` entries hold concurrency leases (an opaque `AdmissionLease` acquired before spawn,
released on completion — release MUST be idempotent). Entry field detail is carried in the
retitled prose contract §4; the normative properties are: windows refill deterministically from
timestamps (no background sweeper), leases carry an owner and an expiry (an expired lease is
prunable by any writer), and an entry unparseable as its declared version is a store error
(§4 failure posture), never silently reset.

### 3.5. CAS arbitration

All writes are compare-and-swap on the KV entry revision — concurrent admits on the same key
serialise through the JetStream leader, which is what makes counters exact under N nodes. Two
properties are **normative**:

1. **Refusal is read-only.** A refused request MUST NOT write — refusal under contention costs
   no CAS retries and cannot livelock the limiter.
2. **Admit writes are revision-guarded.** An admit MUST CAS on the read revision
   (create-if-absent for fresh keys) and MUST bound its retries (RECOMMENDED 3); exhausted
   retries are store contention → the §4 failure posture, never an unguarded write.

**Multi-tier evaluation is two-phase:** phase 1 reads and evaluates every applicable tier
(refuse on the FIRST tier that refuses — the most-protective outcome); phase 2 consumes from
all tiers only after every tier admitted. A partial consume (some tiers debited, then refusal)
MUST NOT occur.

### 3.6. Refusal mapping

A rate refusal maps onto §2 with `kind: "not_now"`, `retry_after_ms` derived from the refusing
window's next-refill time, and the taxonomy detail (`admission: rate limit (principal=…,
window=…)`) in `detail`. Queued consumers additionally `nak(retry_after_ms)` so throttled work
defers instead of dying. Surfaces SHOULD render the human summary friendly ("busy — try again in
~Ns"); the machine detail stays in the object.

---

## 4. Failure Posture

When the KV store errors (unreachable, timeout, CAS retries exhausted, unknown entry version)
while dispatch still flows:

- **Named principals: degrade, loudly.** The implementation falls back to node-local
  approximate token buckets (same refill/decision rules, process memory instead of KV) and MUST
  emit a `system.*` event on the *transition* into and out of degraded mode — never silently,
  and not per-request. Decisions taken in degraded mode MUST carry `degraded: true`.
- **The anonymous principal: fail closed.** Requests resolving to the public/anonymous
  principal MUST be refused (`kind: "not_now"`, `detail: "store_error"`, standard retry hint)
  while the store is unavailable. Zero-authority traffic never rides the approximate path.

Rationale: the limiter's availability equals the fabric's (NATS-down usually means no dispatch
at all), so the degraded window is small — but it must be visible, bounded, and closed for the
one principal with no accountability behind it.

---

## 5. Registry Considerations

- **RFC number** `0010`, allocated in [`specs/README.md`](../README.md); never reused.
- **The `kind` registry** (§2.2) is registered by this document: closed five-member set;
  changes per BCP-0001.
- **The KV key grammar** (§3.3) including the reserved tier keys is registered by this
  document.
- No external registrations.

## 6. Security Considerations

- **The refusal object is not trust-bearing.** It rides payload/nak channels without its own
  signature; a consumer MUST NOT make an authorization decision on `kind` (the authorization
  outcome is the gate's, carried by the gate's own signed context). `retry_after_ms` from an
  unauthenticated path is a DoS lever — RFC-0007's unbounded-delay finding applies; a consumer
  SHOULD bound the applied delay.
- **Key-charset coercion is an isolation failure** (§3.3): coercing instead of rejecting merges
  distinct principals' counters — one principal can exhaust another's budget or ride its
  headroom. The reject rule is the defense; the collision vectors bind it.
- **Read-only refusal** (§3.5) prevents refusal-storm livelock: an attacker driving refusals
  cannot make the limiter write-contend itself.
- **Anonymous fail-closed** (§4) prevents the zero-authority principal from converting a store
  outage into unmetered dispatch.
- **Permanent-before-transient ordering** (§2.3) prevents a policy denial from being disguised
  as backpressure and retried forever.

## 7. Privacy Considerations

`detail` is free-form operator text and a leakage surface: producers SHOULD NOT place secrets,
tokens, or personal data in it; surfaces render it to humans. KV keys carry principal ids —
identity-bearing but not secret (they are subject-visible already). Rate counters reveal
activity volume per principal to anyone with bucket read access; bucket ACLs SHOULD follow the
stack's JetStream domain ACLs.

## 8. Conformance

An implementation conforms iff it passes every vector under `specs/vectors/rate-limit/`.
**Prose explains; vectors bind.** Operations (own implementations, not reference imports):

- `parseRefusalObject` — §2.1/§2.2 shape + closed-registry enforcement (unknown kind → no
  machine-readable cause, not a parse crash).
- `classifyRefusalKind` — §2.3 transient/permanent table, incl. `not_now` ⇒ `retry_after_ms`
  REQUIRED and `term`-forbidden-for-admission.
- `checkSeamConsistency` — §2.4: mirror-kind/token agreement; mismatch = malformed; route on
  the token.
- `admissionKeyPrincipalSegment` — §3.3 reject-not-coerce + the collision cases (the RFC-0006
  D15 carve).
- `evaluateMultiTier` — §3.5 two-phase: first-refusing-tier wins; no partial consume; refusal
  is read-only.

See [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and [`specs/vectors/README.md`](../vectors/README.md).

## 9. References

### 9.1. Normative References

- [RFC2119] / [RFC8174] — BCP 14 requirement levels.
- [RFC5234] — ABNF.
- [RFC-0001] metafactory, **Ratified** — identifier terminals; kebab-strict segment alphabets.
- [RFC-0004] metafactory, **Ratified** — the signature chain from which the requester principal
  is derived (§3.1).
- [RFC-0005] metafactory, **Ratified** — the `NakReasonCode` sub-code registry `compliance_block`
  refusals refine.
- [RFC-0006] metafactory, **Ratified** — membership admission (the OTHER admission); OD-1
  relabel closed by this document.
- [RFC-0007] metafactory, **Ratified** — the transport token value set, dispositions, and the
  §3 boundary this document's ownership derives from; `retry_after_ms` precedence (§4.1).
- [BCP-0001] metafactory, **Ratified** — change control for the closed registries.

### 9.2. Informative References

- [`grill-logs/rfc-0010.md`](grill-logs/rfc-0010.md) — the decision log for this draft.
- The retitled substrate rate-limit prose contract (formerly `specs/admission.md`) — worked
  examples, entry field detail, observability guidance.
- cortex `src/bus/dispatch-events.ts` — the live refusal-object producer.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in
`grammar` (`specs/grammar/rate-limit.abnf`) is the source of truth and is what CI validates.

```abnf
; specs/grammar/rate-limit.abnf
; RFC-0010 — Rate-limit and Refusal Taxonomy
; Status: Ratified (single-principal, 2026-07-15, ADR-0001). This grammar is
; normative. See specs/README.md.
;
; Terminals `lower` and DIGIT are RFC-0001's / RFC 5234's; never redefined.

; 1. The refusal kind registry (closed — RFC §2.2). snake_case payload plane.
refusal-kind    = %s"cant_do" / %s"wont_do" / %s"not_now"
                / %s"compliance_block" / %s"policy_denied"

; 2. retry_after_ms — non-negative integer milliseconds (JSON number, no
;    fraction/sign/leading zero). Consumption precedence is RFC-0007 §4.1's.
retry-after-ms  = "0" / ( %x31-39 *DIGIT )

; 3. Admission KV key grammar (RFC §3.3). Dot-separated; each segment from
;    the restricted charset — VALIDATED, NEVER COERCED (RFC-0006 D15 carve).
admission-key   = counter-kind "." tier-key
counter-kind    = %s"rate" / %s"inflight"
tier-key        = %s"stack"
                / %s"principal" "." key-segment
                / %s"principal-agent" "." key-segment "." key-segment
                / %s"capability" "." key-segment
key-segment     = 1*( lower / DIGIT / "-" )

; 4. Bucket name (RFC §3.2).
bucket-name     = %s"admission_" key-segment "_" key-segment
```

## Appendix B. Test Vectors

Vectors live as JSON under [`specs/vectors/rate-limit/`](../vectors/rate-limit/)
(`valid.json` / `invalid.json`). Every vector carries a `why`. All public-safe.

The set covers: the closed kind registry (accept ×5, unknown-kind fallback); the
transient/permanent classification (`not_now` requires `retry_after_ms`; `term`-forbidden for
admission; `policy_denied` permanent); the seam-consistency rule (mirror agreement, mismatch
malformed); the `admissionKeyPrincipalSegment` reject-not-coerce family including the
counter-merging collision case (RFC-0006 D15); and the two-phase multi-tier evaluation
(first-refusing-tier, no partial consume, read-only refusal).

## Appendix C. Change Log

| Date | Status | Change |
|---|---|---|
| 2026-07-15 | Ratified | **Full draft replacing the charter stub; ratified same-day** (grill log [`grill-logs/rfc-0010.md`](grill-logs/rfc-0010.md), plan approved by Andreas 2026-07-15). §2 refusal object: closed five-kind registry (four transport mirrors + `policy_denied` per RFC-0007 D4), transient/permanent rule (`not_now` transient w/ REQUIRED `retry_after_ms`; `term` FORBIDDEN for admission; permanent-before-transient ordering), the chartered seam-consistency rule (mirror kinds MUST agree with the co-carried token; disposition routes off the token). §3–§4 substrate rate-limit contract promoted from `specs/admission.md` (retitled — closes RFC-0006 OD-1): bucket/key grammar with the D15 reject-not-coerce charset rule, two-phase CAS multi-tier with read-only refusal, degrade-loudly + anonymous-fail-closed posture. New `rate-limit.abnf` + vector set. |
| 2026-07-15 | Chartered | Boundary amendment (RFC-0007 grill D8) — see git history. |
| 2026-07-13 | Chartered | Charter stub created by the cascade sweep (REVISIONS.md C3). |

## Acknowledgments

The substrate rate-limit contract was designed in the R26 admission work; this document promotes
it. The refusal-taxonomy boundary was adversarially settled at RFC-0007's grill.

## Authors' Addresses

metafactory — via the myelin repository issue tracker.
