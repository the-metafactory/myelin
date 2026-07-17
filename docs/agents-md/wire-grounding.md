### Wire-contract grounding (`wire_grounding`)

myelin owns the wire contracts — the RFC pack in [`specs/rfc/`](../../specs/rfc/) is the normative
grammar for the M2–M6 protocol layers of the Myelin layer model. The pack is too large to
always-load, so wire-touching work is **routed** to the governing RFC on demand: match what you are
about to touch below, Read that RFC, then proceed grounded. (This is the wire-contract analogue of
the SOP activation table — trigger → Read the governing document → proceed.)

| Trigger — you are touching… | Governing RFC (`specs/rfc/`) |
|---|---|
| `did:mf` identifiers, agent/actor identity, `signed_by` chain construction | `specs/rfc/rfc-0001-identifiers.md` |
| subjects, subject namespace/grammar, `subject-matching`, `nats.subjects` | `specs/rfc/rfc-0002-subject-namespace.md` |
| envelope format, headers, payload, the envelope validator | `specs/rfc/rfc-0003-envelope.md` |
| envelope signing, signature verification, canonicalization (JCS), key material | `specs/rfc/rfc-0004-envelope-signing.md` |
| sovereignty, boundary crossing, `federated.*`, `source`/`originator`, cross-principal routing | `specs/rfc/rfc-0005-sovereignty-and-boundary-crossing.md` |
| membership, admission, join/leave, admit request | `specs/rfc/rfc-0006-membership-and-admission.md` |
| transport, delivery modes, backoff, request-reply, reliability, `correlation_id` | `specs/rfc/rfc-0007-transport-and-reliability.md` |
| capability discovery, signed capability advertisements | `specs/rfc/rfc-0008-capability-discovery.md` |
| economics, bidding, the mutable economics field | `specs/rfc/rfc-0009-economics.md` |
| rate-limit, refusal taxonomy, `compliance_block` sub-codes | `specs/rfc/rfc-0010-rate-limit-and-refusal-taxonomy.md` |
| any change to the wire itself — versioning, spec change control | `specs/rfc/rfc-bcp-0001-wire-change-control-and-versioning.md` |

The RFC grammar is **normative**: code and vectors conform to the spec; a divergence is a bug, and a
spec change is a wire change (governed by `rfc-bcp-0001`). Every RFC path above is drift-checked
against the live pack by `scripts/check-wire-grounding.ts` (§2.2 of the domain-grounding standard).
