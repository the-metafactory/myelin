---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0010
title: Rate-limit and Refusal Taxonomy
status: Chartered               # pre-Draft: number + scope allocated (REVISIONS.md C3); NO draft text exists
category: Standards Track
obsoletes: []
updates: []
authors: []                     # assigned when drafting begins (PLAN.md pipeline, stage 3)
signatories: []                 # Ratification REQUIRES: the principal (Andreas) AND the hub custodian (JC)
created: 2026-07-13
ratified: null
grammar: null                   # expected specs/grammar/rate-limit.abnf once drafted
vectors: null                   # expected specs/vectors/rate-limit/ once drafted
generated: []
supersedes_prose: []            # will list specs/admission.md when the draft lands (see Charter §2)
crossRefs: ["0006", "0007"]     # RFC-0006 OD-1 and RFC-0007 OD-1/OD-2 resolve against this document
---

# RFC-0010: Rate-limit and Refusal Taxonomy — Charter

> **This is a CHARTER STUB, not a draft.** It allocates the RFC number and records the agreed
> scope so that sibling open decisions have a real owner to resolve against. It contains no
> normative content, no grammar, and no vectors. Implementations MUST NOT ground behaviour on
> this document. Before any draft text is written, this RFC receives the full
> **docket → grill → author → verify** treatment per [`PLAN.md`](PLAN.md) (§1 pipeline,
> §3 order-of-treatment item 5) — every open question surfaced, adversarially stress-verified,
> and deliberately decided by the principals.

## 1. Why this RFC exists

Chartered by the 2026-07-13 cascade sweep applying [`REVISIONS.md`](REVISIONS.md) **C3**: the
substrate rate-limit / admission-refusal dimension was owned by **no** RFC. RFC-0006 OD-1
established that [`specs/admission.md`](../admission.md) is a **mislabelled rate-limit
contract** — it specifies substrate throttling, not the membership flow — and needs its own
Standards-Track number; RFC-0007 OD-2 independently confirmed the dimension was orphaned and
depends on a refusal-taxonomy owner that did not exist. This charter closes the ownership gap.

## 2. Scope

1. **The substrate rate-limit contract** currently specified (as informative prose) in
   [`specs/admission.md`](../admission.md):
   - the NATS-KV **bucket and key grammar** for shared rate/concurrency state;
   - the **token-bucket** window semantics (`per_minute` | `per_hour` | `per_day`) and
     concurrency (in-flight lease) tiers;
   - the **CAS** acquire/release discipline, the opaque `AdmissionLease`, and the degraded
     node-local fallback.
   When the draft lands, `specs/admission.md` is retitled to name it unambiguously the
   substrate rate-limit contract and listed in this document's `supersedes_prose`
   (the relabel is RFC-0006 OD-1 and lands with the draft, not with this charter).
2. **The terminal refusal taxonomy** — the `reason: { kind, detail, retry_after_ms }` object
   (admission.md §7): its field grammar, the `kind` value registry, the transient-vs-permanent
   rule (`term` FORBIDDEN for admission refusals), and its carriage on dispatch failure events
   and JetStream `nak(retry_after_ms)`.

**Out of scope:** the membership/admission lifecycle (`PENDING → ADMITTED → REVOKED/DEPARTED`)
— that is RFC-0006; the canonical NAK reason value set — that is RFC-0007 §3.1 (this document
owns the *refusal-object shape*, RFC-0007 owns the NAK vocabulary; the boundary is settled at
this RFC's grill).

## 3. Sibling decisions that resolve against this document

- **RFC-0006 OD-1** — the relabel and Standards-Track re-homing of `specs/admission.md`.
- **RFC-0007 OD-1** — canonical-vs-alias spellings of the refusal reason carrier.
- **RFC-0007 OD-2** — the snake_case `reason` object carrier-shape conflict (cortex +
  `specs/admission.md` emit snake_case; the canonical kebab spelling is fixed in RFC-0007 §3.1).

None of these is resolved by this charter; they are resolved by this RFC's draft after its
docket and grill.

## 4. Process

Per [`PLAN.md`](PLAN.md): docket produced just-in-time, grilled with the principals in
dependency layers, authored strictly from the decision log, twice adversarially verified, then
committed as `Draft` pending two signatures. Ratification requires the principal (Andreas) and
the hub custodian (JC).

## Appendix C. Change Log

| Date | Status | Change |
|---|---|---|
| 2026-07-13 | Chartered | Charter stub created by the cascade sweep (REVISIONS.md C3). Number 0010 allocated in `specs/README.md`; scope recorded; RFC-0006 OD-1 and RFC-0007 OD-1/OD-2 retargeted to resolve against this document. No draft text. |
