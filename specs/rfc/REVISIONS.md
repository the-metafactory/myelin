# RFC series — revision checklist (pre-Proposed)

> Cross-reference consistency critique of the initial Draft set (2026-07-12). These are refinements to apply before any RFC advances Draft → Proposed. The did:mf/#1880 encoding block was verified handled correctly across the series.

Findings grounded where possible: the drafts themselves aren't on disk yet (myelin `spec/rfc-scaffold` holds only `specs/rfc/template.md` + a vectors README), so this is a structural critique of the provided objects. I verified two things against myelin `main`: (a) the template mandates **Security**, **Privacy**, and **Registry** Considerations in every RFC; (b) `specs/namespace.md` Reserved Prefixes lists only `_metrics`, `dead-letter`, (`bid-request`) — `_INBOX` and `_nak` are absent, confirming the 0005/0007 claims.

---

# RFC series cross-reference critique — prioritized corrections

## P1 — Factually wrong / whole-dimension gaps

**C1. RFC-0005 OD-7 blockedOn is stale and wrong.** It says *"no discovery/economics RFC is yet planned."* Both exist: **RFC-0008** (Capability Discovery) and **RFC-0009** (Economics) are in this very series, and **RFC-0008 OD-5 already claims `sovereignty_required` matching semantics.** Fix: retarget RFC-0005 OD-7 to defer to RFC-0008 (single owner), delete the "not yet planned" clause, and add `0008` to RFC-0005 crossRefs.

**C2. Terminal duplication — RFC-0003 `source-segment`.** RFC-0003 defines its own `source-segment` alphabet (`[a-z][a-z0-9-]*`, unbounded) for the `source` field's principal/stack/agent segments instead of referencing RFC-0001 `principal-id`/`stack-slug`/`agent-id` — its own OD admits the divergence. This is the one clear case of an RFC≠0001 redefining an identity terminal. Fix: RFC-0003 grammar should import RFC-0001's three terminals for `source`'s segments and delete the local `source-segment` production (0003 already crossRefs 0001, so the reference path exists). This also auto-converges the alphabet once #1880 lands, rather than leaving 0003 with a permanently divergent copy. (Secondary: RFC-0009's wallet OD says *"identical regex to every other DID field"* — verify the wallet ABNF **references** RFC-0001 `did-mf` rather than re-inlining the regex; if inlined, same fix.)

**C3. Orphaned dimension — substrate rate-limit / admission-refusal taxonomy is owned by NO RFC.** RFC-0006 OD-1 says `specs/admission.md` is a mislabelled rate-limit contract that *"needs its OWN Standards-Track RFC number … no number assigned yet"*; RFC-0007 OD-2 independently confirms *"admission dimension is orphaned"* and depends on a refusal-taxonomy owner that doesn't exist. Fix: allocate a new Standards-Track RFC for the rate-limit contract (KV bucket/key grammar, token-bucket, CAS) **and** the terminal `reason:{kind,detail,retry_after_ms}` taxonomy (admission.md §7). Until then RFC-0007 OD-1/OD-2 resolve against nothing.

## P2 — Overlap: two RFCs claim one rule, no designated owner

**C4. `sovereignty_required` is dual-owned (RFC-0005 OD-7 ↔ RFC-0008 OD-5), field originates in RFC-0003.** Both leave ordering/matching open; neither is authoritative. Fix: designate **RFC-0008** as the normative owner of the match-semantics/ordering; RFC-0005 and RFC-0003 reference it. Add mutual crossRefs 0005↔0008 (see C10).

**C5. `capability-id` grammar is dual-claimed (RFC-0002 OD-3 "codifies the myelin grammar" ↔ RFC-0008 C-3 "ABNF rule is a placeholder").** RFC-0002 defers to 0008 in prose but does **not** list 0008 in crossRefs. Fix: **RFC-0008 owns `capability-id` normatively**; RFC-0002's subject grammar references it (don't transcribe a second copy); add `0008` to RFC-0002 crossRefs.

**C6. Legacy 5-segment (stack-less) subject retirement is triple-owned** — RFC-0002 OD-2, BCP-0001 OD-2, and RFC-0007 OD-4 (dead-letter variant) each independently promise to name the retirement release. Delineate: **RFC-0002** owns the subject grammar + accept/reject rule; **BCP-0001** owns the retirement window/release-naming + the mandatory deprecation-warning (which namespace.md line ~94 promises but doesn't implement); **RFC-0007** owns only the `TASKS_DEAD` stream-filter alignment. Cross-reference instead of three parallel open decisions.

**C7. `spec_version` emission-release naming is dual-owned (RFC-0003 spec_version OD ↔ BCP-0001 OD-3/OD-7).** Both defer the "name the B2 emission release" decision. Fix: **BCP-0001** (change control) owns the emission window + `$id`/version-channel reconciliation (its OD-1); RFC-0003 references BCP-0001 for scheduling and retains only the field-presence / `additionalProperties:false` concern.

**C8. Reserved-prefix registry (RFC-0002) has no OD to receive inbound reservations.** RFC-0005 OD-6 (`_nak.`) and RFC-0007 OD-5 (`_INBOX.`) both defer registration to RFC-0002, but RFC-0002 has no corresponding open decision — verified absent from namespace.md Reserved Prefixes. Fix: add an RFC-0002 open decision / Registry-Considerations entry to adjudicate `_nak.` and `_INBOX.`, giving 0005 and 0007 a real owner to resolve against.

## P3 — Silent-assumption + mechanical

**C9. RFC-0003 "authority of source's stack segment" defers to RFC-0002, which has no matching OD.** RFC-0003 says the subject-derivation rule *"lives there [RFC-0002]"*, but RFC-0002's ODs never address source-segment-2 vs subject-stack authority (OD-2 is legacy default-derivation, a different concern). Fix: add an RFC-0002 open decision for the fabricated-stack authority question (cortex#1812 class), or co-file it as a shared 0002/0003 decision.

**C10. Missing crossRefs (mechanical):** RFC-0002 → add `0008` (OD-3); RFC-0005 → add `0008` (OD-7); RFC-0008 → add `0005` (OD-5 semantics live in the sovereignty RFC); RFC-0009 → add `0004` (economics-unsigned depends on RFC-0004's SIGNABLE_FIELDS mutable carve-out, which 0004 supersedes from docs/envelope.md); optionally RFC-0004 → `0007` (freshness-vs-replay couples to the TASKS JetStream redelivery owned by transport).

**C11. Security/Privacy Considerations — not verifiable from the provided objects; flag for confirmation.** The template makes Security + Privacy + Registry Considerations REQUIRED in every RFC, but the draft objects don't expose section bodies. Confirm each draft carries *substantive* (non-stub) sections, specifically: **Privacy** must be load-bearing in the identifier-bearing RFCs where DIDs correlate to humans/principals — **0001** (rotation-linkability, revocation privacy), **0002** (DID→`@`-segment encoding leaks identity into every-subscriber-visible subjects), **0003** (five DID-valued wire fields), **0005** (`imported_principals` partner-DID maps), **0006** (member identities/pubkeys), **0009** (wallet DID → billing correlation). **Security** is load-bearing (not boilerplate) for **0004** (base64 malleability, verifier DoS — its own ODs are security findings), **0006** (OD-2 admission-signature binding scope), **0005** (boundary enforcement), **0007** (silent task loss).

## PASSES (state explicitly)

**The did:mf / cortex#1880 block is handled correctly across the series.** Every identifier-dependent RFC defers to RFC-0001's `method-specific-id` open decision rather than assuming a form: 0002 OD-1, 0003 (identifier-alphabet OD), 0005 OD-8, 0006 (final OD), and 0009 (wallet OD) all cite `cortex#1880`; 0008 C-3 correctly flags capability-id as *distinct from* #1880 (capability is not an identity terminal). No RFC silently assumes a resolved encoding. The only wrinkle is C2 (RFC-0003 sidesteps the block by defining its own `source-segment` alphabet instead of deferring to 0001's terminals) — a duplication issue, not a #1880 violation.

**No dangling crossRefs to non-existent RFCs** — every crossRef points to an RFC in the index. The dangling-*ownership* problems are C3 (deferral to a non-existent RFC), C8, and C9 (deferral to an owner that carries no matching decision).