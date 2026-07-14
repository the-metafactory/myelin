# RFC-BCP-0001 (Wire Change Control & Versioning) — grill log

Grilled 2026-07-14. Docket: wf_f0c71419-221 (22 decisions, stress-verified).
Fixed: RFC-0001/0002/0003/0004 RATIFIED (single-principal, ADR-0001). PRIMARY job = reconcile BCP-0001 with ADR-0001 living-spec. GRILL COMPLETE — 22/22.

## Reconciliation + doctrine (RATIFIED Andreas 2026-07-14)
- **D1 = ABSORB-AS-NORMATIVE.** BCP states the v1 living-spec/single-principal model as its OWN normative section (not just a pointer); heavy discipline (immutable-once-Ratified, two-signature, mandatory dual-accept) RETAINED as the documented reinstate-target. CORRECTED per stress: mirror the DOCTRINE of CONFORMANCE.md §"Changing the wire", NOT verbatim (verbatim reintroduces the compass-FWP deferral the BCP §9/§15.2 kills — drop that tail); cite ADR-0001 INLINE (Status + front-matter signatories comment) like the four siblings, NOT via supersedes_prose (that inverts supersession). Flip line-12 signatories + Status to "principal alone in v1; principal + hub custodian on reinstate."
- **D2 = 'independent implementation' (reinstate trigger) = EXTERNAL / not-under-our-control.** In-ecosystem consumers (cortex/pilot/signal) that hand-roll parsers or vendor the schema DO NOT trip reversal trigger (a) — they are CONSUMERS with RFC-0004 layered-conformance obligations (own shim runs vectors; pure primitives may be inherited), NOT independent implementations. Define in §1.2 WITHOUT contradicting ratified RFC-0004 D32's conformance-unit language. (Keeps ADR-0001 operative — the only non-self-nullifying reading.)
- **D3** v1 line: SUSPENDED = immutability + two-signature + mandatory dual-accept window; RETAINED = grill log + conformance vectors + adversarial verify (ADR-0001 "keep the rigor").

## Versioning (D4-D7) — RATIFIED (codify)
- **D4** frozen schema $id history: document the existing v3/prior $ids (don't retro-mint); **D5** reconcile spec_version with the $id version counter (relationship stated); **D6** name the spec_version B2 emission release (bundle at the next release); **D7** prior-$id publication/retrievability for pinned consumers.

## Retirement (D8-D11) — RATIFIED (codify)
- **D8** v1 legacy 5-segment retirement mechanism = coordinated cut / revise-and-reimplement (NO formal dual-accept window required under single-impl v1). **D9** the unbuilt legacy-form deprecation warning (namespace.md:94) = a §finding + a normative requirement here. **D10** retirement-release naming + a v1 forcing function. **D11** dispose of the 3 open windows under v1 (dual-accept not mandatory).

## Hard cut + emitters/verifiers (D12-D15) — RATIFIED
- **D12** persisted-state/self-replay safety (JetStream history) — the one place a coordinated cut still needs care. **D13 = RECAST §6.4** — retain the [principal-hands] destructive-purge + proportionality + go/no-go checklist as LIVE v1 discipline for ANY irreversible/destructive cut (protects against history loss at any scale); DROP the "scoped exception to a mandatory dual-accept default" framing (no mandatory default in v1); fix stale "pending JC" at bcp:391→Ratified single-principal. **D14** consumer pin/vendoring/roster discipline. **D15** promote the machine-checkable invariants to v1-MUSTs.

## Process + ladder (D16-D19) — RATIFIED
- **D16 = keep 'Proposed' DORMANT** (suspended-not-deleted; v1 pipeline goes grill→author→verify→Ratified directly; the rung stays defined + reinstates with two-signature). Decide in README/template; BCP aligns.
- **D17 = v1 change-record = Appendix-C changelog entry + committed grill log + regenerated vectors** (the two artifacts ADR-0001 retains). CORRECTED per stress: locate at the RIGHT altitude — do NOT over-own in BCP §9 (BCP §2 disclaims doc-versioning; two other owners hold it); the BCP references the mechanism, template/PLAN owns the boilerplate.
- **D18** reconcile residual stale two-party language. **D19** advance BCP-0001 Draft→Ratified single-principal (after author+verify).

## Cross-RFC hygiene (D20-D22) — RATIFIED (codify)
- **D20** cite ADR-0001 + full scoping/retag sweep (crossRefs). **D21** correct stale post-grill cross-RFC decision-ID citations. **D22** add RFC-0004 as the cited owner of canonicalization.

---
## ✅ GRILL COMPLETE — 22/22. NEXT: author BCP-0001 (from this log) → 2× verify → PR #230 → ratify single-principal (D19).
