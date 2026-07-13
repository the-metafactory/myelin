# ADR-0001 — Single-principal ratification + living spec for the wire-protocol RFC series (v1)

- **Status:** Accepted (2026-07-13, Andreas). Reversible — see _Reversal trigger_.
- **Scope:** the myelin wire-protocol RFC series (`specs/rfc/`).
- **Supersedes (for v1):** the two-signature ratification rule in `specs/README.md`,
  `specs/CONFORMANCE.md`, `specs/rfc/template.md`; and the "Ratified is immutable" +
  mandatory dual-accept change-control language in RFC-BCP-0001. Those documents cite this ADR.

## Context

The series originally defined **ratification as a two-signature act** — the **principal** plus
the **hub custodian** (JC). The purpose of that gate is specific: to stop **one party
unilaterally defining a wire contract that binds other parties** (the cross-principal trust the
wire governs).

As of 2026-07-13, three facts hold simultaneously:

1. The **only implementation** of the myelin wire is under our control.
2. There are **no live federated multi-principal networks** — no second party is bound by the contract.
3. The designated **hub custodian (JC) has declined to co-sign** for now ("I'll pass for now").

So the two-signature gate is currently **guarding an empty room**: there is no second principal
the contract binds, and no independent implementation that has built against a frozen version.
Holding the whole series hostage to a signature that isn't coming — to protect parties who don't
yet exist — blocks the actual goal (a foundation the one implementation can build against).

## Decision

1. **Single-principal ratification (v1).** While myelin is the only implementation and no
   federated peer is live, **the principal alone may ratify** an RFC. The two-signature
   requirement is **suspended, not deleted.**

2. **Living spec, not stone tablet.** `Ratified` means **"the current best contract the
   implementation tracks,"** not "immutable forever." When review or use finds a hole:
   **change the RFC → reimplement what's required.** We **drop the ceremony** — immutable-once-
   Ratified, a mandatory `Updates:`/`Obsoletes:` RFC per change, and the dual-accept change-control
   window are **not required in v1.**

3. **Keep the rigor.** We **keep** the machinery that actually catches holes and proves the
   implementation matches the spec: the **ABNF grammar**, the **conformance vectors**, the
   **adversarial verify** passes, and the **logged grill decisions**. That rigor is the value;
   the immutability ceremony was overhead for external consumers who do not yet exist.

## Consequences

- An authored + verified RFC reaches `Ratified` (normative, buildable-against) on the
  **principal's signature alone**, recorded in its `signatories`.
- **Change control (BCP-0001) is lightened for v1:** a hole → revise the RFC + reimplement; no
  dual-accept window is required while there is a single implementation.
- The **conformance vectors become the load-bearing artifact** — they are how a revised RFC and
  its reimplementation are proven to match. (This is why the rigor is retained, not the ceremony.)
- A reader who sees an RFC's Status must read it against this ADR: single-principal ratification
  is valid, and a `Ratified` document may still change (with a matching implementation change).

## Reversal trigger (non-negotiable)

The **full discipline** — two-signature ratification, immutable-once-Ratified, and dual-accept
change control — **reinstates the moment either:**

- **(a)** a **second independent implementation** of the wire exists, **or**
- **(b)** a **live federated peer principal** joins a network.

At that point the wire binds a party we do not control, an implementation has built against a
version it expects to be stable, and the safeguard's purpose is no longer dormant. This reversal
is a **prerequisite**, not a discretionary review item.

## Related

- The RFC series plan and its stages: `specs/rfc/PLAN.md` (the series-completion audit, §6, still runs).
- `cortex#1880` — the `did:mf` encoding decision the series keystones on.
