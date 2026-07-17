# The RFC series plan — detailed treatment for every document

> Status: active. Owner: Andreas (principal) + JC (hub custodian). Updated 2026-07-13.
>
> **The mandate:** every RFC in this series is the foundation of the Internet of
> Agentic Work, and none of them ratifies by having been *drafted*. Each one goes
> through the full detailed treatment that RFC-0001 established — every open
> question surfaced, adversarially stress-verified, and **deliberately decided by
> the principals** — before it may advance Draft → Proposed. A document that has
> not been grilled is a well-structured hypothesis, not a contract.

## 1. The pipeline (proven on RFC-0001, 2026-07-12)

Each RFC advances through five stages:

| Stage | What happens | What it catches (RFC-0001 evidence) |
|---|---|---|
| **1. Docket** | Parallel facet agents surface every open decision, grounded in source (`file:line`); a synthesizer dedups + dependency-orders; adversarial agents stress-test every recommendation. | 26 decisions surfaced; 14/26 recommendations refined — incl. the insufficient "'.'→injective" claim, a mis-filed live principal (`did:mf:public`), a subject-length blowup, and an inverted cutover sequencing. |
| **2. Grill** | The docket is worked through with Andreas in dependency layers; each genuine fork is put as an explicit choice; every answer is logged. | 4 layers, 5 explicit forks; 2 docket recommendations overridden by the principal (class model, hard-cut migration). |
| **3. Author** | The RFC prose + ABNF + conformance vectors are (re)written from the ratified decision log — recording decisions, never inventing beyond them. | 885-line package; the author independently used the *correct tighter* kebab-strict ABNF where the decision log's shorthand was loose. |
| **4. Verify** | Two independent adversarial passes check every ratified decision is reflected, prose ↔ ABNF ↔ vectors are consistent, and every vector's verdict is confirmed against the grammar. | 2× PASS; Appendix-A byte-identity machine-checked; 30/30 vector verdicts confirmed; 2 editorial nits caught. |
| **5. Commit** | Verified package lands on this branch (PR #230), explicitly `Draft — pending JC co-signature`. | `6b64471` + `b632afe`. |

**Ratification is out-of-band and two-party:** principal (Andreas) + hub custodian
(JC) co-sign. No executor advances a status; no emitter flips to a new wire form
before ratification.

## 2. State

| RFC | Docket | Grill | Author | Verify | Open markers (pre-sweep) |
|---|---|---|---|---|---|
| 0001 Identifiers | ✅ 26 | ✅ 26/26 | ✅ | ✅ 2× PASS | 0 (pending JC co-sign) |
| 0002 Subject namespace | — | — | — | — | 8 (+2 inherited: @-segment form, source-stack authority) |
| 0003 Envelope | — | — | — | — | 16 |
| 0004 Envelope signing | — | — | — | — | 23 |
| 0005 Sovereignty | — | — | — | — | 16 |
| 0006 Membership & admission | — | — | — | — | 7 |
| 0007 Transport & reliability | — | — | — | — | 14 |
| 0008 Capability discovery | — | — | — | — | 19 |
| 0009 Economics | — | — | — | — | 15 (−1: wallet closed by RFC-0001 D12) |
| 0010 Rate-limit & refusal taxonomy | — | — | — | — | chartered by the sweep (REVISIONS C3); not yet drafted |
| BCP-0001 Change control | — | — | — | — | 17 |

## 3. Order of treatment

Ordered by interop risk and dependency; one RFC per working session; the docket
for the next RFC is produced just-in-time (dockets are token-expensive and go
stale against a moving branch).

1. **RFC-0004 Signing** — the crypto core; highest interop risk; largest docket (23 ODs: canonicalization stance, signature encoding, freshness/replay, verifier DoS bounds).
2. **RFC-0002 Namespace** — inherits two decisions RFC-0001 deferred to it: the `@`-segment short-form (the fully-qualified agent DID double-encodes past the NATS subject budget) and the `source` stack-segment authority (cortex#1812 class). Plus the reserved-prefix registry (`_nak.`, `_INBOX.`).
3. **RFC-0003 Envelope** — uuid grammar, datetime profile, size bounds, extensions carve-out.
4. **BCP-0001 Change control** — owns retirement windows, `$id` reconciliation, the emitters-vs-verifiers doctrine; must scope the hard-cut precedent (see §5).
5. **RFC-0006 Admission** + **RFC-0010 charter** — decision-claim binding scope; the refusal taxonomy gets its own standards-track treatment.
6. **RFC-0007 Transport** — keystone: the canonical NakReason vocabulary (Andreas + JC).
7. **RFC-0005 Sovereignty** — keystone: `frontier_ok`/`model_class` enforce-vs-advise (Andreas + JC).
8. **RFC-0008 Capability discovery** — keystone: converge-or-retire the parallel cortex wire (Andreas + JC).
9. **RFC-0009 Economics** — thinnest; stays Informational until its unit/carriage questions are answered.

## 4. The cascade sweep (this PR, decision-free)

Before any sibling's deep pass, one consistency sweep applies what is already
ratified plus the cross-reference critique (`REVISIONS.md` C1–C11):

- **RFC-0001 ratifications propagated:** class-explicit dot-form in every DID example; the two-plane / 6-tag taxonomy referenced, never redefined; wallet closed as a role (0009); `capability-id ≠ DID` (0008); `#1880`-blocked ODs across the series retargeted to "resolved by RFC-0001, pending JC co-signature".
- **Hard cut supersedes dual-accept for the DID migration** wherever siblings assumed a window; BCP-0001 records the scoping rule (§5).
- **C1–C11 applied:** stale deferrals retargeted, duplicated terminals deleted in favour of RFC-0001 imports, dual-owned rules given a single normative owner, missing crossRefs added, RFC-0010 chartered.

## 5. Standing rules

- **Grill-before-Proposed.** No RFC advances past Draft without stages 1–4 complete and both signatures. The grill log is committed alongside the RFC.
- **One owner per rule.** A wire rule is normative in exactly one RFC; siblings cite it (grammar/README rule 5). The sweep enforces the C4–C8 ownership assignments.
- **Terminals live in RFC-0001.** No sibling redefines an identifier alphabet.
- **Hard cut is a precedent with a scope, not a doctrine.** The DID-encoding migration is a ratified coordinated hard cut, justified by the 2-principal ecosystem and gated by a `[principal-hands]` purge checklist. BCP-0001's dual-accept doctrine remains the default for future wire changes; any future hard cut requires the same explicit proportionality ruling.
- **Decisions are logged, not implied.** Each grill produces a per-RFC decision log; the author records decisions and marks what remains genuinely open.

## 6. Series-completion audit (the gate before the series moves as a set toward Ratified)

The per-RFC pipeline (§1) verifies each document in isolation. It **structurally cannot**
catch the defects that live *between* RFCs. So once all 11 are authored + individually
verified, one whole-series adversarial audit runs before any co-signature push — the
book-end to the `wire-protocol-gap-analysis.md` audit that opened the series. It is
multi-agent + adversarial (per-seam, per-composition-path, refute-to-kill), not a re-read.

It checks the seven things per-RFC treatment misses:

1. **Seam integrity.** Every "owned by X, cited by Y" boundary (REVISIONS C4–C8) actually holds in the authored text: no rule dual-owned, no dangling cross-ref, every deferral resolves against a real owner that carries the matching text.
2. **Clean-room build of the *whole* wire.** The independent-implementation bar, applied to the entire stack: a second implementation (or a tester) builds and verifies end-to-end from the series + vectors **alone** — no reading the TS. This is the ultimate conformance proof; attempt it, don't just assert it.
3. **Security composition.** The individual RFC security models compose into a sound whole — the dangerous holes live in the seams (e.g. an envelope that is signing-valid per 0004 yet sovereignty-illegal per 0005 yet admitted per 0006). Trace every cross-layer path; a per-RFC Security Considerations section cannot see these.
4. **Vector cross-binding.** One canonical fixture set threaded consistently through every RFC — a DID in an 0004 vector satisfies 0001's grammar; an 0003 envelope signs per 0004; no fixture contradicts a sibling.
5. **Gap closure vs. the opening audit.** Every finding in `wire-protocol-gap-analysis.md` (6 orphaned dimensions, 209 gaps) is closed by a ratified decision; the coverage matrix (every ABNF + Vectors cell) is now green.
6. **Retained-open inventory.** Every `[OPEN DECISION — Andreas+JC]` deliberately left across the series is enumerated and consciously resolved OR accepted as a stated v1 limitation. Nothing ships silently open.
7. **Ratification readiness.** All 11 through docket→grill→author→verify; REVISIONS C1–C11 applied; the two-signature gate ready. Deltas become issues, never silent scope creep — exactly like the RFC-0001 close-out.

Output: an audit report (the deliverable that gates ratification) + a delta issue list. Only after it is clean does the series move, as a coordinated set, from Draft toward Proposed/Ratified.
