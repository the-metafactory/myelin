# metafactory RFCs

Normative specifications for the myelin wire protocol.

myelin is **M3** of the seven-layer stack — envelope and namespace. The protocol specified here is
implemented by **cortex**, **pilot**, **signal** and any future consumer. Those repositories are
implementations; this directory is the contract.

## Why an RFC series and not more documentation

Three federated addressing defects shipped in one week — a crash-loop on a hand-written
accept-list, a fabricated `default` stack segment, and a DID-class mismatch that silently dropped
presence for two days. All three are the same failure: **an identity was rendered into a wire
representation in one place, parsed differently in another, and the two disagreed silently.**

Prose cannot prevent that. A grammar can. The rule is simple and it is the reason this directory
exists:

> **Prose explains. Vectors bind.**

An RFC here is a machine-readable contract with a human-readable wrapper.

## The index

Numbers are allocated here and are **never reused**.

| RFC | Title | Status | Category | Grammar | Vectors |
|---|---|---|---|---|---|
| 0001 | Identifiers & the `did:mf` DID Method | Ratified | Standards Track | `identifiers.abnf` | `identifiers/` |
| 0002 | Subject Namespace | Ratified | Standards Track | `subject-namespace.abnf` | `subject-namespace/` |
| 0003 | Envelope Format | Draft | Standards Track | `envelope.abnf` | `envelope/` |
| 0004 | Envelope Signing & Canonicalization | Ratified | Standards Track | `envelope-signing.abnf` | `envelope-signing/` |
| 0005 | Sovereignty & Boundary-Crossing | Draft | Standards Track | `sovereignty.abnf` | `sovereignty/` |
| 0006 | Membership & Admission | Draft | Standards Track | `admission.abnf` | `admission/` |
| 0007 | Transport & Reliability | Draft | Standards Track | `transport.abnf` | `transport/` |
| 0008 | Capability Discovery & Advertisement | Draft | Standards Track | `capability-discovery.abnf` | `capability-discovery/` |
| 0009 | Economics | Draft | Informational | `economics.abnf` | `economics/` |
| 0010 | Rate-limit and Refusal Taxonomy | Chartered | Standards Track | — | — |
| BCP-0001 | Wire Change Control & Versioning | Draft | Best Current Practice | — | — |

### Ratification status

Ratification is **single-principal (v1)** per [`docs/adr/0001-single-principal-ratification.md`](../docs/adr/0001-single-principal-ratification.md): while myelin is the only implementation and no federated peer is live, the principal alone ratifies, and `Ratified` means the current best contract the implementation tracks — a **living spec**, revisable when review or use finds a hole, **not** immutable-forever. **RFC-0001, RFC-0002, and RFC-0004 are Ratified** (single-principal; RFC-0001 and RFC-0004 2026-07-13, RFC-0002 2026-07-14); the remaining drafted documents stay **Draft** (myelin PR: rfc-drafts) — grounding on a Draft is forbidden. The full two-signature + immutability + dual-accept discipline reinstates the moment a second independent implementation exists or a live federated peer principal joins. Cross-reference refinements before `Proposed` are tracked in [`rfc/REVISIONS.md`](rfc/REVISIONS.md); the 2026-07-13 cascade sweep applied C1–C10 (C11 remains open for the per-RFC deep passes).

- **RFC-0001** is **Ratified (single-principal, 2026-07-13)** per [ADR-0001](../docs/adr/0001-single-principal-ratification.md). The class-explicit dot-form `did:mf` grammar, two-plane taxonomy, and hard-cut migration are normative and buildable-against; as a living spec the document stays revisable if a hole is found.
- **RFC-0002** (Subject Namespace) is **Ratified (single-principal, 2026-07-14)** per [ADR-0001](../docs/adr/0001-single-principal-ratification.md). The classification prefixes, segment grammar, the `@`-assistant address (the whole class-explicit agent DID), the `tasks` shapes, and the envelope→subject derivation (signed-wins) are normative and buildable-against; as a living spec the document stays revisable if a hole is found. Its `@`-segment cutover is atomic with RFC-0001's flag-day (§5).
- **RFC-0004** (Envelope Signing & Canonicalization) is **Ratified (single-principal, 2026-07-13)** per [ADR-0001](../docs/adr/0001-single-principal-ratification.md). Its decided content is normative; it carries three explicitly-flagged open sub-decisions (D14, D23, D25) that are not-yet-decided and resolve by revision.
- **RFC-0010** is **Chartered** only — number and scope allocated ([`rfc/REVISIONS.md`](rfc/REVISIONS.md) C3); no draft text exists. It receives the full docket→grill→author→verify treatment per [`rfc/PLAN.md`](rfc/PLAN.md) before drafting.

<details><summary>Original planned set</summary>

| RFC | Title | Blocked on |
|---|---|---|
| 0001 | Identifiers and Identity (`did:mf` DID Method Specification) | the DID encoding decision — the-metafactory/cortex#1880 |
| 0002 | Subject Namespace | promotes [`namespace.md`](namespace.md); needs ABNF |
| 0003 | Envelope | promotes [`schemas/envelope.schema.json`](../schemas/envelope.schema.json) |

</details>

### Prose that is not (yet) normative

These are informative. An RFC that supersedes one MUST list it in `supersedes_prose`.

- [`namespace.md`](namespace.md) — NATS namespace convention *(→ RFC-0002)*
- [`admission.md`](admission.md) — admission flow
- [`../docs/identity.md`](../docs/identity.md), [`../docs/envelope.md`](../docs/envelope.md),
  [`../docs/sovereignty.md`](../docs/sovereignty.md) — background

## Status ladder

| Status | Meaning | May an implementation ground on it? |
|---|---|---|
| `Chartered` | Number + scope allocated; no draft text exists yet. | **No** |
| `Draft` | Under active authoring. Sections may renumber. | **No** |
| `Proposed` | Complete, under review, awaiting signatures. | **No** |
| `Ratified` | The current best contract the implementation tracks (living spec, single-principal v1 — ADR-0001). | **Yes** |
| `Obsoleted` | Replaced by a later RFC. Retained for citation. | No — follow `obsoletes` |

## Rules

1. **Numbers are permanent.** Never reused, never renumbered.
2. **A `Ratified` RFC is a living spec (v1).** Per [`docs/adr/0001-single-principal-ratification.md`](../docs/adr/0001-single-principal-ratification.md),
   `Ratified` means the current best contract the implementation tracks; a hole is resolved by
   revising the RFC and reimplementing what is required. Section numbering stays stable because
   citations point at it. The immutable-once-`Ratified` discipline — changes shipped only as a new
   RFC carrying `Updates: NNNN` (amends) or `Obsoletes: NNNN` (replaces) — is the reinstate-target
   that returns with the two-signature rule (rule 3).
3. **Ratification is single-principal (v1).** Per [`docs/adr/0001-single-principal-ratification.md`](../docs/adr/0001-single-principal-ratification.md),
   while myelin is the only implementation and no federated peer is live, the **principal** alone
   ratifies, recorded in the document's `signatories`; the full two-signature act (adding the **hub
   custodian**) is suspended, not deleted, and reinstates the moment a second independent
   implementation exists **or** a live federated peer principal joins.
4. **The ABNF is the source.** Regexes, JSON Schema `pattern`s and parsers are *generated* from it
   and listed in `generated`. Where a generated artifact and the ABNF disagree, **the ABNF governs
   and the artifact is a defect.**
5. **Every syntactic RFC ships vectors.** Conformance is decided by the vectors, not by reading.
6. **Security and Privacy Considerations are mandatory** and may not be empty. If an invariant is
   held by a runtime check rather than by the grammar, the document MUST say so — that is a
   finding, not a design.
7. **Registry Considerations are mandatory**, even to state there are none.

## Proposing an RFC

1. Copy [`rfc/template.md`](rfc/template.md) to `rfc/rfc-NNNN-short-name.md`, taking the next
   free number from the index above and adding the row immediately (status `Draft`).
2. Write the grammar as a standalone file under [`grammar/`](grammar/). CI validates that it parses
   as ABNF [RFC5234].
3. Write vectors under [`vectors/`](vectors/). See [`vectors/README.md`](vectors/README.md).
4. Open a PR. Move to `Proposed` when complete.
5. Under single-principal ratification (v1, [ADR-0001](../docs/adr/0001-single-principal-ratification.md)):
   collect the principal's signature. Move to `Ratified`, set `ratified:`. The document remains a
   living spec (revisable on a hole); once the two-signature rule reinstates, `Ratified` also
   freezes.

Process for cross-repo wire changes lives in compass `sops/federation-wire-protocol.md`; its
dual-accept window is the reinstate-target discipline ([ADR-0001](../docs/adr/0001-single-principal-ratification.md)),
not required under single-principal v1.

## Grounding contract — for agents and humans alike

An RFC in this directory is a machine-readable artifact. Read it as one.

- **Resolve the front matter first.** `status`, `grammar`, `vectors`, `generated`, `obsoletes`.
- **Ground only on `Ratified`.** A `Draft` is a proposal. Citing it as binding is an error.
- **A sentence is normative only if it contains an RFC 2119 keyword in ALL CAPITALS.**
  Lowercase "must" is prose. Explanatory text is not a requirement.
- **Prefer the grammar to the prose.** If you need to know whether a string is valid, read the
  `.abnf` — or better, run the vectors. Do not infer syntax from an example.
- **Prefer the vectors to the grammar** when checking an *implementation*. The grammar says what is
  true; the vectors say whether your code agrees.
- **Never cite a line number from a source file as normative.** Source drifts. The RFC does not.
- **Follow `obsoletes` / `updates`** before quoting an older document.

If an RFC and the code disagree, the RFC is right and the code has a bug — that is the entire point
of writing one.
