# Myelin Wire Protocol — Gap Analysis Against the Planned RFC Series

**Status:** Analysis · **Date:** 2026-07-12 · **Scope:** the myelin wire protocol (M3 of the seven-layer Internet-of-Agentic-Work stack) as implemented on `origin/main`, measured against the RFC scaffold on `spec/rfc-scaffold` (myelin PR #229) and against its consumers (cortex, pilot, signal).

**Method:** a 10-dimension map → gap-find → adversarial-verify → synthesize audit. 10 dimension maps and 209 candidate gaps were produced with `file:line` evidence; 18 (the envelope dimension) were adversarially refute-tested to completion before a rate limit halted the verify phase; three additional load-bearing criticals (signing, admission, capability grammar) were spot-verified by hand for this report. **Verification status is marked per finding.** Unverified findings carry cited evidence but have not been through the refutation pass — treat them as high-confidence-but-unconfirmed.

---

## 1. Executive summary

The wire protocol is the foundation of the whole Internet-of-Agentic-Work vision: it is the contract by which sovereign agents on independent machines exchange signed, routable, boundary-respecting messages. Like the internet it is modelled on, that contract is not one document — it is a layered set of them. TCP/IP is not "an RFC"; it is IP (RFC 791), TCP (RFC 793), DNS (1034/1035), TLS (8446), each specifying one concern to interoperable precision.

**The central finding: the planned three-RFC series (Identifiers, Subject Namespace, Envelope) is scoped to roughly half of the wire protocol.** Six of the ten dimensions that actually travel on the wire have **no home** in the planned series:

- **The cryptographic core** — the JCS canonicalization profile, the `SIGNABLE_FIELDS` boundary, the `signed_by[]` chain semantics, the two signing methods (`ed25519`, `hub-stamp`), and the clock-skew rule — is specified **only in code** (`src/identity/canonicalize.ts`). Two implementations can both conform to the envelope *schema* and still fail to verify each other's signatures. This is the gap that most directly breaks interop, and it is entirely orphaned.
- **Membership & admission** (register → admit → seal → authorize → revoke) exists as a **Draft rate-limit spec plus cortex implementation types and ADRs** — no myelin normative document, no schema. It is the exact "fourth independent implementation of an unspecified grammar" condition the RFC series was created to end.
- **Transport & reliability** — the `NakReason` vocabulary, dead-letter routing, and the request-reply / `_INBOX` correlation protocol — is code-only, with the NAK vocabulary already spelled three different ways across repos.
- **Capability discovery** — `SignedCapabilityRegistration`, its canonicalization, TTL/liveness, and KV addressing — has no normative home; and cortex has already shipped a **parallel, incompatible** capability wire rather than consuming myelin's.
- **Sovereignty enforcement semantics** — the block's *shape* rides RFC-0003, but the meaning of `classification`, `data_residency`, `frontier_ok`, `model_class`, `max_hop`, and the egress/ingress rules that decide *who may cross a principal boundary* live only in `docs/sovereignty.md`. Two of those fields (`frontier_ok`, `model_class`) are validated for shape and **read by no enforcement path at all**.
- **Wire versioning & change-control policy** — dual-accept windows, retirement schedules, the emitters-vs-verifiers doctrine — is claimed by the scaffold to live in a compass SOP that does not contain it.

Underneath the structural gap sit **209 candidate gaps** (16 critical, 76 high, 94 medium, 23 low). The recurring shapes: **no ABNF anywhere** (every grammar is a regex or prose), **no conformance vectors anywhere** (nothing binds the four implementations), **the same rule hand-written in three-to-four places** (the DID grammar; the segment alphabet; the NAK vocabulary; the envelope schema, vendored into cortex and **already drifting**), and **security invariants enforced by runtime guards rather than by the format**.

**None of this is a criticism of the scaffold — the scaffold is correct and necessary. The finding is that it is incomplete: it needs to grow from three planned RFCs to roughly nine, plus a change-control BCP.** §8 proposes the full set.

---

## 2. What "the wire protocol" is — the ten dimensions

For a reader to judge coverage, here is the surface being measured. Each is a distinct interoperability concern; each is a candidate RFC.

| # | Dimension | On the wire | Owner today |
|---|---|---|---|
| 1 | **Envelope** | the message container: `id, source, type, timestamp, sovereignty, payload` (required) + 9 optional fields; schema `$id .../envelope/v3`, `additionalProperties:false` | `schemas/envelope.schema.json` + `src/envelope.ts` |
| 2 | **Subject namespace** | `{local\|federated\|public}.{principal}.{stack}.{domain}.{entity}.{action}`; wildcards; reserved segments; the tasks domain + JetStream | `specs/namespace.md` + `src/subjects.ts` |
| 3 | **Identity & `did:mf`** | `did:mf:…` for agent / service / hub / principal / stack — five classes, one flat namespace | `src/identity/types.ts` (regex only) |
| 4 | **Signing & canonicalization** | JCS (RFC 8785) bytes-to-sign, `SIGNABLE_FIELDS`, `signed_by[]` ed25519/hub-stamp chain | `src/identity/canonicalize.ts` (code only) |
| 5 | **Sovereignty** | `sovereignty` (required) + `sovereignty_required`: classification, residency, crossing rules | schema shape only; semantics in `docs/` |
| 6 | **Provenance** | `source` (routing) vs `originator` (attribution) vs `signed_by[]` (crypto) vs `target_assistant` | schema + `src/dual-field.ts` |
| 7 | **Admission / membership** | register → PENDING → admit → seal → authorize → revoke; sealed-secret; signed decision claim | `specs/admission.md` (Draft, rate-limit only) + cortex |
| 8 | **Transport & reliability** | `NakReason` vocabulary, dead-letter, request-reply, `correlation_id` | `src/transport/**` (code only) |
| 9 | **Discovery, capabilities & economics** | `SignedCapabilityRegistration`, capability taxonomy, the `economics` block | `docs/discovery.md`; schema shape; **no spec** |
| 10 | **Versioning & migration** | `$id` versions, `spec_version`, the default-derivation window, dual-accept | scattered; policy claimed-but-absent |

---

## 3. Coverage matrix

Legend: ✅ present / ⚠️ partial or prose-only / ❌ absent.

| Dimension | Normative spec | ABNF | Conformance vectors | Schema↔code↔docs consistent | Planned-RFC home |
|---|---|---|---|---|---|
| 1 Envelope | ⚠️ schema only; signable-field boundary & `spec_version` semantics code-only | ❌ | ❌ | ❌ (schema description contradicts its own body; `uuid` defined 4 ways; datetime 2 ways) | ⚠️ RFC-0003 (schema only — must widen) |
| 2 Subjects | ⚠️ `namespace.md` (prose) | ❌ ("needs ABNF") | ❌ | ⚠️ (`dispatch.*`, `_metrics`, bid-request families code-only) | ✅ RFC-0002 |
| 3 Identity/DID | ⚠️ regex only; no DID Method Spec | ❌ | ❌ | ⚠️ (grammar drift `_` vs charset) | ✅ RFC-0001 (blocked on #1880) |
| 4 **Signing/canon** | ❌ **code only** | ❌ | ❌ (one `canonicalize.test.ts`) | ⚠️ (cortex chain shim) | ❌ **NONE** |
| 5 Sovereignty | ⚠️ shape in schema; **semantics prose-only** | ❌ | ❌ | ⚠️ | ⚠️ shape→0003; **semantics NONE** |
| 6 Provenance | ⚠️ schema + prose | ❌ | ❌ | ❌ (`source` regex docs stale; first-hyphen decode is a consumer invention) | ⚠️ split 0001/0002/0003 |
| 7 **Admission** | ❌ Draft (rate-limit only); membership protocol **absent** | ❌ | ❌ | ⚠️ (status lifecycle doc drift) | ❌ **NONE** |
| 8 **Transport/NAK** | ❌ **code only** | ❌ | ❌ | ❌ (NAK vocabulary spelled 3 ways) | ❌ **NONE** |
| 9 **Discovery/econ** | ❌ (advert unspecified; economics zero-semantics) | ❌ | ❌ | ❌ (cortex ships a parallel capability wire) | ❌ **NONE** (core) |
| 10 **Versioning** | ❌ policy claimed in compass SOP, absent there | ❌ | ❌ | ⚠️ (`$id` frozen across breaking cuts) | ❌ **NONE** |

**Every cell in the ABNF and Vectors columns is ❌.** That is the single most consequential row-reading: the protocol has no machine-checkable grammar and no conformance suite, anywhere, for any dimension.

---

## 4. Critical findings

Each carries `file:line` evidence and verification status. "Verified" = passed the adversarial refutation pass or a hand spot-check for this report.

### C-1 · The signing/canonicalization layer is code-only — signatures are not interoperable by specification · **[spot-verified]**
The bytes an implementation signs are defined by `SIGNABLE_FIELDS` (`src/identity/canonicalize.ts:27`) and a JCS profile (`src/jcs.ts`), neither of which appears in any `specs/*.md` or in the schema. The schema carries the stamp *shape* (`signed_by[]`) but not *what is signed or how it is serialized*. **Consequence:** an independent implementation that reproduces the envelope schema exactly can still compute different canonical bytes and fail every cross-implementation verification — the failure is silent (`unknown_agent` / bad-signature), and it is unspecified which side is wrong. This is the gap that most directly threatens the IoAW premise of sovereign, independent agents. **Remedy:** a dedicated *Envelope Signing & Canonicalization* RFC (proposed RFC-0004) pinning the JCS profile, the exact `SIGNABLE_FIELDS` set, chain slice/commit semantics, both signing methods, and the clock-skew rule; plus a signing vector set (input envelope → canonical bytes → signature).

### C-2 · The membership/admission protocol has no myelin specification · **[spot-verified]**
`register → PENDING → admit/reject → seal → authorize → revoke/depart`, the `AdmissionStatus` enum, the signed decision claim, the `sealed_secret`, and `hub_authorized_at` semantics exist **only** as cortex implementation types + ADRs. A repo-wide grep of myelin `src/` and `schemas/` for `ADMITTED | sealed_secret | hub_authorized` returns **nothing**; the terms appear only in `specs/admission.md` prose — which is itself a Draft that cortex already grounds on normatively, violating the scaffold's own "ground only on Ratified" rule. **Remedy:** proposed RFC-0006 (Membership & Admission), with the sealed-secret envelope and the decision claim as schemas + vectors. (Note: `specs/admission.md` is additionally **mislabelled** — it specifies the *rate-limit* contract, not the membership flow.)

### C-3 · cortex ships a capability-id grammar that myelin's grammar cannot express · **[spot-verified]**
myelin's capability/requirements terminal is `^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$` (schema) — a **single segment, hyphens only**. cortex's live production capability ids include `federated.subject_dispatch` and `dev.implement` — **dotted compounds with underscores**, unexpressible in myelin's grammar and duplicated across three cortex sites. The two capability wires are structurally incompatible. **Remedy:** RFC-0002 (or the discovery RFC) must define the capability-id grammar as ABNF and the consumers must converge; a conformance vector set makes the divergence fail CI instead of at a federation boundary.

### C-4 · Capability discovery has no normative spec, and cortex has shipped a parallel wire · **[unverified — cited]**
The F-11 discovery artifact (`SignedCapabilityRegistration` + `CapabilityAdvertisement`) has no schema and no `specs/*.md` section. cortex does not consume it at all (zero references to `registerCapabilities`/`verifyCapabilityRegistration` on `origin/main`); it ships its own `agent.capabilities-changed` wire (`src/bus/agent-network/envelopes.ts:75`). Two divergent discovery mechanisms, neither specified. **Remedy:** proposed RFC-0008 (Capability Discovery), or a decision to retire one wire.

### C-5 · Sovereignty's decision fields are enforced by nothing · **[unverified — cited]**
`frontier_ok` and `model_class` — the block's "what may process this" promise — are shape-validated only. `src/sovereignty/validators/egress.ts:19-97` reads only `classification` and `data_residency`; a grep of `src/sovereignty/**` finds no allow/block path consulting `frontier_ok` or `model_class`. A field that travels on every envelope and gates nothing is either a security gap (operators believe it protects them) or dead weight. **Remedy:** proposed RFC-0005 (Sovereignty Semantics) must either specify enforcement or mark the fields advisory-with-a-retirement-date.

*(The remaining criticals — mutable/unsigned `extensions` & `economics` channels carrying prose-only trust; the three-way principal grammar; the `source` third segment that is required-but-never-consumed — appear in §5/§6.)*

---

## 5. High-severity findings (selected, grouped)

**Consistency — the same rule, rendered differently in ≥2 places:**
- **`uuid` defined four conflicting ways** across schema and code · *[verified]* (`envelope/uuid-four-conflicting-definitions`).
- **The segment alphabet defined thrice and collides** · *[verified]* — the identity/segment terminal is written in the schema, in code, and in `namespace.md`, and they do not agree on `_`.
- **The DID grammar in three hand-written copies** (myelin `src/identity/types.ts` `DID_RE`, myelin `schemas/envelope.schema.json`, and cortex's *vendored* copy which has **already drifted** in its description) · *[verified for cortex drift]*.
- **The NAK vocabulary spelled three ways** — myelin kebab-case, `specs/admission.md` snake_case, cortex snake_case + a `policy_denied` code with no myelin equivalent · *[unverified — cited]*.
- **Schema `description` contradicts the schema body** on the accepted `distribution_mode`/`source` grammar · *[verified]* (`envelope/schema-description-contradicts-own-body`, `docs-broadcast-accepted-stale`, `docs-source-grammar-stale-2-4`).

**Security — invariants held by prose or a runtime guard, not by the format:**
- **`extensions` and `economics` are mutable, unsigned channels** outside `SIGNABLE_FIELDS`, "bounded" only by prose · *[verified]* (`envelope/mutable-channels-unbounded-prose-only-trust`). Anything a verifier trusts there is trusting unauthenticated bytes.
- **No size bounds anywhere** on the envelope, payload, or any field · *[verified]* — an unbounded-work / DoS surface with no specified limit.
- **`spec_version` semantics are code-only** (warn-on-newer) · *[verified]* — forward-compat behaviour a second implementation cannot reproduce from the spec.
- **Reply correlation is unauthenticated**; **NAK frames are unsigned and self-exempt** from the sovereignty rules they enforce · *[unverified — cited]*.

**Structure — orphaned dimensions (no-RFC-home):** signing, admission, transport, versioning, discovery core, sovereignty semantics — each a `high`/`critical` `no-rfc-home` finding, consolidated in §7–§8.

**Provenance / decode ambiguity:**
- **The `source` third (stack) segment is required but consumed by nothing** · *[verified]* (`envelope/source-stack-segment-never-consumed`) — a required wire field with no reader is either a latent contract or dead weight; unspecified which.
- **The `did:mf:{principal}-{stack}` decode splits on the first hyphen** — a consumer-invented rule (`review-consumer.ts`) with no myelin contract, unsound because `-` is legal inside `principal` · *[unverified — cited]*; this is the archetype the encoding decision (#1880) must close.

---

## 6. Medium/low findings — the long tail

94 medium + 23 low, dominated by: **undefined edge cases** (33 total across all severities — empty segments, trailing separators, multi-segment stack ids, degenerate DID forms, unbounded `@`-segment length, the 255-char cap unenforced); **migration windows without a retirement release** (18 — the default-derivation `SHOULD` has been open since it was written and is what leaked into cortex#1812); **privacy** (4 — chain metadata, human-DID `originator`, correlation across contexts, all with no Privacy Considerations). These are catalogued in the recovered digest (`scratchpad/audit-digest.md`) with per-item evidence; they are the vector-test backlog once the RFCs exist.

---

## 7. Cross-cutting patterns

Five failure modes recur across every dimension and are the real disease:

1. **No executable grammar.** Every syntax is a regex or prose; there is no ABNF anywhere. Prose lets you write down an ambiguity a grammar would reject (the `did:mf` hyphen problem is the proof).
2. **No conformance vectors.** Nothing binds the four implementations to one another. Conformance today means "reads plausibly like the docs," not "passes the suite."
3. **N hand-written copies of one rule.** The DID grammar (×3), the segment alphabet (×3), the NAK vocabulary (×3), the envelope schema (vendored into cortex, drifting). Each copy is an independent chance to disagree.
4. **Security by vigilance.** Trust-displacement (DID collisions) is held by a runtime `refuse`; sovereignty promises are held by fields nothing reads; mutable channels are "bounded" by prose. Each is a finding, not a design.
5. **Migration windows without an end.** Every dual-accept/deprecation path lacks a named retirement release, so the transition state is permanent.

The RFC series exists precisely to convert each of these from a human discipline into a machine check: (1)→ABNF, (2)→vectors, (3)→generate-don't-copy, (4)→spec the property, (5)→BCP change-control with retirement dates.

---

## 8. Recommended complete RFC series

The internet's foundation is a numbered series, one concern per document. The wire protocol needs the same. The planned three grow to nine plus a change-control BCP:

| RFC | Title | Must normatively pin | Status / blocked on |
|---|---|---|---|
| **0001** | Identifiers & the `did:mf` DID Method | the identifier ABNF; the `did:mf` method-specific-id grammar (W3C DID-Core §8); the five identity classes made injective | **planned; blocked on the encoding decision — cortex#1880** |
| **0002** | Subject Namespace | the subject ABNF; reserved segments/prefixes; the tasks-domain + capability-id grammar; wildcard rules | **planned;** absorb or scope-out the `dispatch.*`/`_metrics`/bid families |
| **0003** | Envelope Format | the field set; per-field grammar (citing 0001/0002); **must widen** to scope the signable-field boundary + `spec_version` semantics or they stay orphaned | **planned; widen the charter** |
| **0004** | **Envelope Signing & Canonicalization** | the JCS profile; the exact `SIGNABLE_FIELDS`; `signed_by[]` chain slice/commit; `ed25519` + `hub-stamp` methods; clock-skew; **signing vectors** | **NEW — highest priority; the interop-breaking gap** |
| **0005** | **Sovereignty & Boundary-Crossing** | `classification`, `data_residency`, `frontier_ok`, `model_class`, `max_hop`; egress/ingress rules; who may cross a principal boundary | **NEW;** resolve the enforced-nowhere fields (C-5) |
| **0006** | **Membership & Admission** | register→admit→seal→authorize→revoke; the sealed-secret envelope; the signed decision claim; the `AdmissionStatus` lifecycle | **NEW;** supersede/relabel `admission.md` |
| **0007** | **Transport & Reliability** | the `NakReason` vocabulary (enumerated, one spelling); dead-letter routing; request-reply / `_INBOX` correlation; `correlation_id` | **NEW** |
| **0008** | **Capability Discovery** | `SignedCapabilityRegistration`; canonicalization; TTL/liveness; KV addressing; reconcile the cortex parallel wire | **NEW;** decision: converge or retire one wire |
| **0009** | Economics *(may be Informational until used)* | the `economics` block semantics, units, aggregation; **or** mark reserved | **NEW or defer;** zero emitters today |
| **BCP-0001** | Wire Change Control & Versioning | `$id` version semantics; dual-accept window mechanics; **retirement schedules**; emitters-vs-verifiers doctrine; consumer pin discipline | **NEW;** the policy the scaffold mislocates in a compass SOP |

**Splitting matters:** only RFC-0001 is blocked on the encoding decision. Bundling (as the current single myelin#228 issue does) holds the settled dimensions hostage to the contested one. Each proposed RFC above is independently draftable except where a "blocked on" is named.

---

## 9. Prioritized action plan

Ordered by interop risk and unblocked-ness. Each item names the artifact and any decision it waits on.

1. **Land the RFC scaffold** (myelin PR #229). Nothing below has a home until the index, template, conformance and vector conventions exist. *No blocker.*
2. **Split myelin#228 into per-RFC issues** matching the §8 table; keep only RFC-0001 blocked on cortex#1880. *No blocker.*
3. **Draft RFC-0004 (Signing & Canonicalization) first.** It is the highest interop risk (C-1), it is **not** blocked on the encoding decision, and its vectors (`canonicalize.test.ts` expanded into an input→bytes→signature vector set) are the first thing that makes cross-implementation verification checkable. *No blocker.*
4. **Resolve cortex#1880** (the DID encoding). Verified prior finding: forbid-hyphen is insufficient (agent DIDs share the namespace; all live agent ids are hyphenated); the `.`-separated class-explicit form (`did:mf:stack.andreas.metafactory`) is permitted by the existing DID pattern, needs no schema change, and is W3C-conformant. Unblocks RFC-0001, then RFC-0002's `@`-segment and the provenance decode. *Decision: Andreas + JC.*
5. **Extract the ABNF** for subjects (RFC-0002) and identifiers (RFC-0001) as `specs/grammar/*.abnf`; wire the CI job that validates they parse. *Blocked on #4 for 0001; 0002's non-identifier grammar is unblocked.*
6. **Generate, don't copy.** Make the ABNF the source; generate the schema `pattern`s and `DID_RE` from it; add the cortex vendored-schema freshness gate (already filed, cortex#1889). Kills failure-mode §7.3. *No blocker.*
7. **Draft RFC-0005 (Sovereignty semantics)** and decide C-5: are `frontier_ok`/`model_class` enforced or advisory? *Decision: Andreas + JC.*
8. **Draft RFC-0006 (Admission)** and relabel `admission.md` as the rate-limit contract it actually is. *No blocker.*
9. **Draft RFC-0007 (Transport/NAK)** — unify the three NAK spellings into one enumerated vocabulary + vectors. *No blocker.*
10. **Draft RFC-0008 (Discovery)** with the converge-or-retire decision on the two capability wires (C-3, C-4). *Decision: Andreas + JC.*
11. **Write BCP-0001 (Change Control)** — every open migration window gets a named retirement release; this is what stops failure-mode §7.5 recurring. *No blocker.*
12. **Backfill vectors** from the 94 medium + 23 low edge-case findings (this document's long tail) as each RFC lands. *Per-RFC.*

---

## 10. Method, confidence & limitations

- **Coverage:** all 10 dimensions were mapped; 209 candidate gaps were produced with cited evidence.
- **Verification tiers:** the 18 envelope-dimension gaps completed the adversarial refutation pass. C-1/C-2/C-3 were hand spot-verified for this report. The remaining ~190 findings (including C-4/C-5 and most of §5/§6) carry cited `file:line` evidence but did **not** complete the refutation pass (the verify phase hit a session rate limit). They are high-confidence but unconfirmed; the refutation pass historically refutes a meaningful minority, so treat individual medium/low items as candidates until re-run.
- **Provenance correction (myelin#236 item 12, audit D12).** The raw-data and replay artifacts this section originally pointed at were **not preserved**: `scratchpad/audit-raw.json` (the 10 maps + 209 gaps), `scratchpad/audit-digest.md` (the deduplicated per-dimension digest referenced here and in §6), and the `wire-protocol-gap-audit-wf_0c8ffa1f-31a` workflow-resume script exist in no committed path or working tree — the replay path is dead and the raw inventory is gone. **Consequence:** per-gap traceability *below dimension/critical granularity* is unavailable from this document; the 209-item long tail cannot be individually re-walked. What survives and is auditable is **dimension-level and critical-level closure**, recorded against the ratified RFC series in [`specs/rfc/SERIES-COMPLETION-AUDIT.md`](https://github.com/the-metafactory/myelin/blob/spec/rfc-drafts/specs/rfc/SERIES-COMPLETION-AUDIT.md) §3 (branch `spec/rfc-drafts`): all six orphaned dimensions have Ratified RFC homes and criticals C-1..C-5 close against quoted ratified text. The structural finding (next bullet) does not depend on the lost tail.
- **The structural finding (§1, §8) does not depend on the unverified tail.** It rests on the 10 dimension maps' RFC-home analysis, which is corroborated by the three spot-verified criticals: the crypto core, admission, and the capability grammar are, verifiably, without a normative home.
