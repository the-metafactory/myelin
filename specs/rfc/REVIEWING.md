# Reviewing the metafactory RFC series

> Version 1.0 — 2026-07-13. Lives on the `spec/rfc-drafts` branch (PR #230). Maintained alongside
> [`PLAN.md`](PLAN.md) and [`REVISIONS.md`](REVISIONS.md); updated as deep passes land.

Welcome — and thank you for reviewing. This guide tells you what you are looking at, where to
ground yourself first, and where your input lands with the most force.

## What you are reviewing

This is the **wire contract of an internet of agentic work**: the identifiers, subjects,
envelopes, signatures, and boundary rules that let sovereign principals' agent stacks
interoperate without silently disagreeing about what a byte on the wire means. Eleven documents:

| Doc | One line | Status |
|---|---|---|
| RFC-0001 | Identifiers and the `did:mf` DID method — the terminal alphabets every other document imports. | Draft (decisions ratified by the principal 2026-07-12, pending co-signature) |
| RFC-0002 | Subject namespace — how identities and intents render into NATS subjects. | Draft |
| RFC-0003 | Envelope format — the JSON message body: fields, uuid/datetime profiles, size bounds. | Draft |
| RFC-0004 | Envelope signing and canonicalization — what bytes are signed and how. | Draft |
| RFC-0005 | Sovereignty and boundary-crossing — what may leave a principal's stack, and who decides. | Draft |
| RFC-0006 | Membership and admission — how a member joins a federation and what binds the claim. | Draft |
| RFC-0007 | Transport and reliability — delivery semantics, NAKs, dead-lettering. | Draft |
| RFC-0008 | Capability discovery and advertisement — how agents announce and find what they can do. | Draft |
| RFC-0009 | Economics — cost/usage fields riding the envelope (Informational). | Draft |
| RFC-0010 | Rate-limit and refusal taxonomy — chartered only; number + scope allocated, no text yet. | Chartered |
| BCP-0001 | Wire change control and versioning — how any of the above is allowed to change later. | Draft |

## Architectural grounding — START HERE

1. **[cortex `CONTEXT.md`](https://github.com/the-metafactory/cortex/blob/main/CONTEXT.md)** — the
   canonical glossary for the ecosystem's domain language. Read it before the RFCs.
2. **[cortex `docs/architecture.md`](https://github.com/the-metafactory/cortex/blob/main/docs/architecture.md)** —
   the seven-layer M1–M7 stack. **myelin is M3** (envelope + namespace); cortex, pilot, and signal
   are implementations that consume this contract from above.
3. **myelin's own [`README`](../../README.md) and [`specs/README.md`](../README.md)** — the series
   index, the status ladder, and the grounding contract.

How to use `CONTEXT.md`: it holds **one canonical term per concept**, with the aliases to avoid.
The RFCs are written against that vocabulary — if a term in an RFC reads oddly, check the glossary
before filing; if your instinct and the glossary disagree, **the glossary wins** (and if the RFC
disagrees with the glossary, that is a finding — file it).

## Status rules — why your review matters *now*

The ladder is `Chartered → Draft → Proposed → Ratified` (see
[`specs/README.md`](../README.md#status-ladder)). **Only `Ratified` is normative.** An
implementation MUST NOT ground on a Draft. Ratification takes **two signatures** — the principal
and the hub custodian — because a wire contract binds more than one party.

- **Every document here is pre-ratification.** Nothing is frozen. This is exactly the window in
  which a review can change the contract instead of merely annotating it.
- **RFC-0001 is the special case:** its decisions were ratified by the principal on 2026-07-12 and
  await the co-signature. Its content is settled-unless-challenged. Challenges are still welcome —
  they are triaged as challenges to a ratified decision (higher bar, explicitly on the table until
  the second signature lands), not as ordinary open questions.

## How to review

**Suggested reading order.** Read **RFC-0001 first** regardless of your target — every other
document imports its terminal alphabets and its two-plane identity taxonomy, and nothing else
parses cleanly without it. Then jump to whichever RFC matches your expertise (crypto → 0004,
messaging/queueing → 0007, naming/routing → 0002, distributed authz → 0005/0006). RFC-0009 and
BCP-0001 read fine standalone.

**Prose explains, vectors bind.** The conformance artifacts are the grammars
([`specs/grammar/*.abnf`](../grammar/)) and the vectors ([`specs/vectors/**`](../vectors/) —
plain JSON, one directory per RFC; see [`specs/vectors/README.md`](../vectors/README.md) for the
vector schema. File naming currently varies per RFC — `valid.json`/`invalid.json` for identifiers,
`vectors.json` for subject-namespace and transport, `canonicalize.json` for envelope-signing,
`crossing.json` for sovereignty — the `valid`/`invalid`/`render` split in the vectors README is
the target layout, and a directory that deviates from it is itself fair review comment). To test
a claim the prose makes, find the matching vector file and check the vectors agree; to test a
string, run it against the ABNF. How implementations consume the vectors (and how to check one
yourself) is described in [`specs/CONFORMANCE.md`](../CONFORMANCE.md) and
[`specs/vectors/README.md`](../vectors/README.md).
The precedence is fixed: **ABNF governs generated artifacts; vectors decide conformance.**
A reviewer who finds a **grammar ↔ vector ↔ prose mismatch has found the most valuable class of
defect this series exists to prevent** — the whole series was started because three federated
addressing defects shipped in one week from exactly that failure mode.

**Where your input enters the pipeline.** Per [`PLAN.md`](PLAN.md), every RFC (0001 is through
already) gets the full treatment: **docket → grill → author → 2× adversarial verify**. Reviewer
input feeds **directly into the decision docket** at each RFC's deep pass — a concern you raise on
this PR becomes a docketed open decision that the principals must explicitly decide, not a comment
that scrolls away. The treatment order is in PLAN.md §3 (0004 first). [`REVISIONS.md`](REVISIONS.md)
tracks cross-reference corrections already applied.

## Where input is most valuable — the open keystones

These are the decisions still genuinely open, where a sharp outside eye moves the contract most:

- **RFC-0004 — canonicalization stance, signature encoding, freshness/replay.** The crypto core
  and highest interop risk; 23 open decisions, none yet grilled.
- **RFC-0002 — OD-6 `@`-segment short-form.** A fully-qualified agent DID double-encodes past the
  NATS subject budget; the short-form projection is unresolved.
- **RFC-0002 — OD-7 `source` stack-segment authority.** Who is authoritative when the envelope's
  source segment and the subject's stack segment disagree — the class of bug that fabricated a
  `default` stack in production.
- **RFC-0007 — the canonical NakReason vocabulary.** The terminal refusal taxonomy is undecided;
  it shapes every error path on the wire.
- **RFC-0005 — sovereignty enforce-vs-advise.** Whether `frontier_ok`/`model_class` constraints
  are enforced at the boundary or advisory to the receiver.
- **RFC-0008 — capability wire converge-or-retire.** Whether the parallel cortex capability wire
  converges onto this contract or retires.
- **RFC-0003 — uuid grammar, datetime profile, size bounds.** The envelope's value profiles are
  drafted but not stress-decided.

If your expertise touches none of these, mismatch-hunting across prose/grammar/vectors is equally
prized — see above.

## Mechanics

- Review as **line comments / review threads on PR #230**. One concern per thread, so each can be
  triaged, docketed, and resolved independently.
- **Label severity in the first line** of each thread: `[blocker]` (contract is wrong or unsafe),
  `[question]` (needs a decision or clarification), `[nit]` (editorial).
- Grammar-vs-vector (or vector-vs-prose) mismatches are gold — say which vector file and which
  ABNF rule disagree.
- Reviews are **triaged continuously**: deep passes land on this same branch, and each pass folds
  the open threads for its RFC into that RFC's decision docket. You don't need to wait for a
  "review window" — there isn't one; there's a pipeline.

## Credit

Substantive input is credited in the **Acknowledgments** section of the RFC it improves, in the
document itself, permanently — RFC numbers are never reused and ratified documents are never
edited, so the credit is as durable as the contract.
