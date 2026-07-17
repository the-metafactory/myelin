# Design: RFC Alignment — from ratified spec to conforming implementation

**Status:** Draft for principal sign-off · **Date:** 2026-07-17 · **Author:** Luna (planner session) + Andreas (decisions)
**Supersedes:** `docs/design-shared-wire-codec.md` (stale plan-of-record — its WP-4 keystone was resolved by RFC-0001 ratification 2026-07-13; its change-control premise predates ADR-0001; RFC-0010's surface postdates it)
**Provenance:** Synthesized from a six-agent verified read (2026-07-17): full 11-document RFC-pack read mapped against myelin `origin/main` (ddb0cc2) + cortex `origin/main` (8d9d0102), two machinery stocktakes, `SERIES-COMPLETION-AUDIT.md`, `CURRENT-STATE-VS-RFC-GAP.md`. Every claim in the underlying maps carries file:line.
**Feeds:** the `/plan-breakdown` epic (myelin#235 Tracks B/C + cortex#2034 + flag-day-R staging).

---

## 1. Goal and non-goals

**Goal.** A federated network between two principals (Andreas, JC) running on the *specified* wire: every wire rule implemented exactly once, generated or imported — never hand-copied — with all ~340 conformance vectors executing in CI so drift is a failing build, not a silent two-day presence outage.

**Non-goals (this epic):** firing flag-day R (staged only — the cut is a `[principal-hands]` two-party event); the legacy 5-segment subject retirement (separate BCP-0001 window, explicitly NOT part of R per RFC-0002 §8.2); chain-walk delegation sovereignty treatment (named deferral); economics semantics (successor charters myelin#241–#245).

## 2. Current state (verified 2026-07-17)

| Layer | State |
|---|---|
| Identity/subjects (0001/0002) | All pre-R. MISSING: `decodeDidSegment`, fail-closed `parseDid`, register-once, agent-prefix binding. 3 myelin regexes tighten at R; 7 cortex hand-rolls (first-hyphen decoder, 4 slug regexes, 2 DID mints) get DELETED, not tightened. Recipient gate already conforms structurally. |
| Envelope/signing (0003/0004) | MISSING and byte-changing: field-id indirection, CONTEXT_TAG domain separation, pinned Ed25519 equation (deployed = noble defaults), canonical-88 signatures. Live bug: `spec_version` required-signable but absent from `SIGNABLE_FIELDS`. cortex has NO verifier (Ajv-only; hub-stamps arrive unverified). Vendored cortex schema is byte-identical to myelin main — divergence is only vs the stale installed pin (v0.4.0). |
| Sovereignty (0005) | 10-item engine-debt list (myelin `src/sovereignty/`), each with file:line + fix: frontier/model_class unread, max_hop dead, residency fail-open, downward-superset classification, unconditional permissive-ALLOW, partner-unknown dead value, agent-DID `imported_principals` matching, hyphenated NAK tokens, off-spec unsigned nak envelope, chain-walk gated off. |
| Admission (0006, all in cortex) | Mostly CONFORMS. Gaps: M9/M17 identity-binding claims (`peer_pubkey`+`network_id` never row-compared; no `409 identity_mismatch`; dual-accept not started), M12 authority keyed off stored row not bound claim, M10 bare canonicalization (no CONTEXT_TAG — couples to the RFC-0004 build). |
| Transport/discovery/rate-limit (0007/0008/0010) | `resolveNakReason` + `Nats-Msg-Id` publish MISSING in both repos. cortex `keySegment` COERCES where §3.3 says reject. `policy_denied` rides transport position in 6 cortex sites (evicts at R). `TASKS_DEAD` filters legacy 5-seg. F-11 retirement: myelin-internal consumers exist (`agent-identity/helpers.ts:82` + public barrel) — #234's "zero consumers" is false. Rate-limit gate otherwise CONFORMS. |
| Machinery | No generator, no runner, no `./wire`, no `./vectors`/`./schemas` exports. cortex CI runs zero tests (cortex#376). cortex pins myelin by raw SHA coupled to `SCHEMA_SOURCE_COMMIT`. ~340 vectors across 22 files (3 dirs mixed-layout; `era` field live). |

## 3. Decisions (recorded 2026-07-17, Andreas)

| # | Decision | Ruling |
|---|---|---|
| **D0** | s[0] vs s[n-1] anchor (audit D1; live at `verify.ts:92`) | **Two-question split.** The LINK question ("who delivered this into my boundary" — partner check, `imported_principals`) keys on **s[n-1]**. The AUTHORITY question ("whose work is this" — actor scope, capability ceiling) keys on **s[0]** (truncation-safe per RFC-0004 D12). Spec edits to RFC-0004 §5.5/F-5 + RFC-0005 §6.1/§12 stating which gate keys on which anchor; ingress vectors annotated per question. Mirrors the ratified #255 link-vs-identity split. |
| **D1** | ABNF composition | **Formalize the existing convention**: declared import header (`;; imports <rule> FROM <file>`); abnf-gen resolves cross-file refs; grammar/README rule 5 single-owner enforced at resolve time. |
| **D2** | Side-condition channel | **Structured annotations** (`;@bound <rule> <min>..<max>`, `;@cond …`); annotation grammar specified in `specs/grammar/README.md`; one sweep converts the 8 comment-bound sites. |
| **D3** | Sequencing | **Runner-first.** #239 executes all vectors against TODAY'S hand-written impls with a known-defects manifest (built from §2's debt lists). Every gap = visible failing/expected-fail test from day one; cortex gets a net before any deletion. Then #237 (generator), then #238 (./wire), each behind a green runner. |
| **D4** | Packaging + pins | **Myelin-home.** `./wire`, `./vectors`, `./schemas` package exports (JSON import-attribute entries for vectors/schemas). cortex moves to **git TAG pins** (BCP-0001 §4.3 versioning); `SCHEMA_SOURCE_COMMIT` gate retires when the vendored copy is deleted. |
| **D5** | Codec home | **Built once in myelin `./wire`**, lifting the WP-2 branch (`feat/wp2-wire-identity-codec`) as the pattern. cortex#1878 (local-staging codec) superseded — close with credit; #1877 (E2E harness) stays. |
| **D6** | CONFORMANCE MUST-2 pre-R window (planner default, veto open) | The regenerate-and-diff gate is **era-parameterized**: pre-R committed artifacts diff against pre-R generation; post-R artifacts generate to a staged path (`generated/r/`) and gate-check there until the cut swaps them in. CONFORMANCE.md amended with the window rule (spec edit). |
| **D7** | Old plan-of-record (planner default, veto open) | `design-shared-wire-codec.md` marked **Superseded-by: this document** (header edit; body preserved as history). |

## 4. Target architecture

```
specs/grammar/*.abnf ──(D1 imports + D2 annotations)──▶ tools/abnf-gen ──▶ src/wire/generated/*
                                                                              (regexes · schema fragments · enums)
specs/vectors/**  ──▶ conformance runner (bun test, CI) ──▶ binds ./wire AND (transitionally) the legacy impls
src/wire/*  = generated/* + hand-written core (codec, canonicalizer, verifier, token enums, claim shapes)
package exports: ./wire  ./vectors/*  ./schemas/*   ──▶  consumers (cortex, pilot, …) import; copies DELETED
```

**./wire export surface** (consolidated from the per-RFC maps; each function names the copies it retires):
- **identity/subjects:** `parseDid` (class+arity, fail-closed), `renderDid`, `encodeDidSegment`/`decodeDidSegment`, `parseStackId` (no `default` fabrication), `SEGMENT_RE`/per-class validators, `CLASS_TAGS`/`RESERVED_NAMES`/`classOf`, `resolvePlane`, `checkAgentPrefixBinding`, generated schema DID pattern (single source for the 12 schema sites).
- **subjects:** `deriveSubject` (stackless-reject at the primitive), `parseSubject`, `validatePublishedSubject`/`validateSubPattern` (wildcards, 255-total, 63-per-seg with `@`-exemption), `validateCapabilityTag`+`isReservedTasksTag`, `validateTaskRecipient` (lifted from cortex), post-R verdict/dispatch builders.
- **envelope/signing:** canonicalizer v2 (field-id re-key, CONTEXT_TAG, dup-key + non-plain-object reject), field-id registry (14 fields incl. `spec_version`), signer/verifier (pinned Ed25519 equation, canonical-88, admit-vs-reverify freshness, D0 anchors, §7.1 originator binding), §11.3 result-token enum (18), stamp/chain helpers (cortex null→`[null]` bug fixed by adoption).
- **sovereignty:** block schema + validators (closed ISO-3166 registry, `false`+`frontier` reject), `NakReasonCode` snake registry, egress/ingress decision procedures (strict equality, TTL, default ceiling, link-partner, principal-class matcher).
- **admission:** `AdmissionStatus` + transition table, claim shapes (decision claim widened with `peer_pubkey`+`network_id`; seal claim with `peer_pubkey`) canonicalized under CONTEXT_TAG, `LeafSecretEnvelope` v1/v2 decoder, request-id/scope grammars.
- **transport/refusal:** NakReason enum + kebab receive-aliases, `resolveNakReason` (normalize-then-coerce), backoff constants + `backoffMsForDelivery`, `deriveDeadLetterSubject`, correlation validator, refusal-kind enum + object schema, `admission-key` codec (validate-not-coerce), `checkSeamConsistency`.
- **capability:** capability-id codec (converged grammar), segment-prefix matcher, sovereignty-mode equality matcher, presence fold-gate validator.

**Runner semantics** (#239, corrected): dispatch on TOP-LEVEL `kind` only (nested refusal-object kinds are data); honor `era` (pre-R vectors are regression pins for the deprecated path, never live-conformance against post-R ./wire); mixed-layout dirs partition on `expect.ok` per the vectors README table; ~340 vectors (the issue's "271+" is stale); **known-defects manifest** = the §2 debt lists, each entry `vector-id → tracking-issue`, burn-down to zero is the epic's progress meter; no silent skips — every skip names its manifest entry.

## 5. Phasing (feeds the breakdown waves)

- **W0 — spec-level fixes (before any machinery code):** D0 spec edits to RFC-0004/0005 + vector annotations; D6 CONFORMANCE window rule; D7 supersede header; correct stale issue premises (#234 two false premises, #239 count, #233 widened kebab sweep incl. `observability/types.ts` metric keys).
- **W1 — pack to main + safety nets:** merge #229; retarget #230 → main, rebase + reconcile the R2/R11 envelope story (main dropped `originator.principal` + broadcast; pack + `canonicalize.ts:27-45` must agree), merge. cortex: tests into CI (#376 — the de-dup rides on this net). myelin: `./vectors` + `./schemas` exports (kills the born-non-conformant meta-defect).
- **W2 — runner (D3):** #239 over existing impls + known-defects manifest; wire into myelin CI; cortex consumes exported vectors for its wire-adjacent tests (CONFORMANCE MUST-1 satisfied).
- **W3 — generator:** #237 with D1/D2 conventions; annotation sweep of the grammars; `generated/` committed + gen-check CI; era-parameterized per D6; fix the rfc-0004 `generated:` category error (grammar listed as its own output).
- **W4 — ./wire core (TRUST-PATH):** #238 per the export surface above; vectors green modulo manifest; serialized lanes + adversarial review on codec/canonicalizer/verifier slices. Includes the D0 two-anchor verifier.
- **W5 — consumers + engine debt:** cortex#2034 behavior-preserving de-dup (pin→tag bump, vendor-delete after byte-verify, regex/NAK/decoder replacement — the trust-path decoder slices serialized, #1881 discipline); myelin#11 decomposed per the 10-item list; cortex#2016 pre-R fixes (`resolveNakReason`, `Nats-Msg-Id`, `TASKS_DEAD`, keySegment reject-not-coerce); admission M9/M17/M12 + dual-accept window open (M13). Behavior-CHANGING tightens (#2020 capability regex, #1973 crypto-path) stay OUT of de-dup slices. |
- **W6 — flag-day-R staging (fire = HELD):** the atomic cut package — DID flip (12 schema sites + 3 regex tightenings + class widening + identity mapping), signature-format flip (field-ids + CONTEXT_TAG + canonical-88 + spec_version signable), NakReason emit flip (#233), capability converged-id + F-11 retirement (#234, corrected premises: matcher is NEW code in myelin; retirement breaks myelin's own barrel + agent-identity), subject retargets (verdict → `review.verdict.*`, `assigned`→`dispatched`). All staged behind era-parameterized gates + runbook cortex#2035; **go/no-go is a two-party `[principal-hands]` event (Andreas + JC).**

**Trust-path register (adversarial lane + serialized):** canonicalizer v2, signer/verifier (pinned equation, D0 anchors, originator binding), DID codec + cortex decoder replacement, admission claim binding, sealed-secret paths. **Holds:** firing R; live deploys (`arc upgrade`, plists, `~/.config`); #229/#230 merge is W1 but the merge COMMIT is Andreas's (single-principal ratification, JC co-sign as post-merge event); JC-coordination steps.

## 6. Definition of Done (the walkthrough)

1. `bun test` in myelin runs the conformance runner: **all ~340 vectors execute; failures = exactly the known-defects manifest; manifest burn-down visible per wave** (W2).
2. `bun tools/abnf-gen --check` passes in CI; hand-editing a generated regex fails the build (W3).
3. cortex imports `@the-metafactory/myelin/wire` at a tag pin; `git grep` finds **zero** local DID/NAK/capability/slug regex copies and no vendored schema (W5).
4. The known-defects manifest reaches **zero open entries** outside the staged-R set (W5).
5. Every R artifact exists on a staged path with green era-parameterized gates; runbook #2035 complete; the only remaining step is the two-principal cut (W6).
6. Andreas + JC federate on the current wire with conformance CI green on both repos — chasing-tail class of defect structurally impossible (silent drift = red build).
