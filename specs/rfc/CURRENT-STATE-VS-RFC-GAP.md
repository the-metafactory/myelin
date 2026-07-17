# Current state vs. the RFC pack — the honest gap

**Date:** 2026-07-15 · **Purpose:** measure the real distance between what runs today ("we were close to federated, signed, encrypted envelopes flowing") and what the 11-RFC pack proposes — so we don't mistake *rigor we added* for *a prerequisite we're missing*.

**Grounding:** cortex `[[federation-e2e-state]]` (roster auto-wiring #1084 deployed v5.24.0; metafactory flipped operator-mode/nats-resolver 2026-07-08 v6.3.0; payload-swap sealed scoped creds epic #1595); cortex#1876/1877/1878 (the DID codec — all **OPEN**, WP-2 labelled "additive, no migration"); the ratified RFCs on PR #230.

---

## The one-line answer

**The RFC pack does not stand between us and federated signed encrypted envelopes.** That path is *built and deployed*; the only things blocking `jc↔andreas` live are **operational** (jc re-seals his operator-mode cred + runs `network join`; the federated leaf transport actually carries `federated.>` both ways — today `link:established` but `in=0 out=0`). Neither is an RFC.

What the RFC pack adds sits in three buckets, and only one of them is a change to the working wire.

---

## Bucket 1 — Already have it (deployed; the RFC *codifies* it, doesn't invent it)

These are running today, and the relevant RFC was written as "codify the wire as it is":

| Capability | Deployed reality | RFC that describes it |
|---|---|---|
| **Signed envelopes** | Ed25519 `signed_by` chain, JCS canonicalization — live | RFC-0004 (codifies the deployed crypto core; its vectors are self-contained/clean-room-grade) |
| **Encrypted credential delivery** | operator-mode payload-swap: admit mints a subject-scoped user `.creds` under the hub FED account and `crypto_box_seal`s it to the member's key (#1595, v6.3.0) | RFC-0006 §8 (the R7 subject-binding guard is already **deployed** + fail-closed, PR #1609) |
| **Membership admission** | register → admit → seal → authorize → revoke, CAS'd registry | RFC-0006 |
| **One-command join** | `cortex network join` (#753), operator-mode leaf remotes | RFC-0006 / SOPs |
| **Roster-driven auto-wiring** | continuous reconciler derives accept-lists from the registry roster (#1084) | (surface behavior; not an RFC contract) |

**Implication:** the federation *mechanism* — signed, sealed, scoped, roster-wired — is not a proposal. It exists. The RFCs mostly gave it a written contract + conformance vectors.

---

## Bucket 2 — The RFC pack **changes the working wire** (migrations)

### 2a. THE ONE genuinely breaking change: the DID encoding hard-cut (flag-day R)

Every emitted `did:mf` string changes from the legacy flat form to the class-explicit dot-form (`did:mf:agent.{principal}.{stack}.{assistant}`), and the subject `@`-segment flips **atomically** with it (RFC-0001 §9). This is the single coordinated, destructive migration in the whole pack.

- **Status:** the codec is being built (cortex#1876/1877/1878, all **OPEN**; WP-2 is *additive* — it exists alongside, the cut is a separate scheduled event). **Not deployed. The cut has not happened.** Today's wire still speaks the legacy DID form.
- **Why it matters to federation:** the tail-chasing bugs (a DID-class mismatch dropping presence for two days; the first-hyphen decoder inventing a `default` stack) were *exactly* the flat-form's ambiguity. The dot-form removes that ambiguity by construction. So this migration is the one that most directly *pays down* the federation pain — but it is a migration of a working system, schedulable when we choose, not a blocker to federation running.

### 2b. Non-blocking conformance catch-ups (spec-leads-deployment, behind dual-accept windows)

Each is a *named conformance defect* with a tracked issue; **none blocks federation** because the dual-accept windows keep current behavior working until the flip:

| Change | Tracked | Blocks federation? |
|---|---|---|
| Snake NAK reason tokens (`not_now`…) | cortex#2016 / myelin#233 | No — receive-window aliases |
| Decision-claim binds `peer_pubkey`+`network_id` | cortex#1996 | No — dual-accept, enforce-when-present |
| Capability-id underscore → hyphen migration | cortex#2020 / myelin#234 | No — flag-day R |
| `source` → full agent-DID | (rides the DID cut) | No |
| Sovereignty **ENFORCE** (residency fail-closed, permissive ceiling, `max_hop` TTL) | myelin#11 | No — today's gaps are the named defects; enforcement is the hardening |

---

## Bucket 3 — RFC-proposed **net-new that does not exist yet** (the reuse/rigor layer)

This is what the completion audit flagged as "the series is ratified against machinery that doesn't exist":

- **The shared wire library + generator + CI gates.** The RFCs' `generated:` manifests and CONFORMANCE MUST-gates reference `tools/abnf-gen` and CI jobs **that were never built**. The DID grammar is still hand-copied (5× in cortex's vendored schema; segment alphabet in 6+ variants; NAK vocab mirrored 3×).
- **What it buys:** it ends the *silent-drift class of bug* — the actual disease behind the tail-chasing. Generate the codec/validators/canonicalizer from the one grammar; every repo imports instead of re-inlining.
- **What it costs / blocks:** nothing on the federation critical path. Federation runs on the current hand-written code. The library is the *cleanup that stops the next drift bug*, not a prerequisite for this one to work.

---

## The reframe

The federation goal and the RFC pack were **coupled in effort but not in dependency**. Re-read against reality:

- **To get `jc↔andreas` envelopes flowing:** finish the operational bring-up (jc re-seal + join; transport `in/out > 0`). **Zero RFCs required.**
- **To stop federation breaking again the way it kept breaking:** land the DID hard-cut (2a) — the one migration that removes the ambiguity that caused the outages.
- **To never hand-reimplement the wire again:** build the shared library (Bucket 3).

The RFC pack didn't block federation — it wrote down the federation we already have, fixed the ambiguity that made it fragile, and specified the library that ends the drift. The "chasing our tail" feeling came from doing (2a)+(3) *implicitly and by hand* across four repos. The pack makes them explicit and one-source. That is the whole of the gap.

---

## What to decide (the two grill clusters, now sharpened by this framing)

1. **Sequence.** Federation-live first on current code (operational bring-up), *then* schedule the DID cut, *then* the library as cleanup? Or gate the cut/library ahead of wider federation? (The gap analysis argues: federation-live does not wait on either.)
2. **Library home + build.** In-myelin imported vs generated-from-ABNF per repo; who builds `tools/abnf-gen`; is a tester's clean-room read the independent-implementation trigger that reinstates heavier discipline.
