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
| 0001 | Identifiers & the `did:mf` DID Method | Draft | Standards Track | `identifiers.abnf` | `identifiers/` |
| 0002 | Subject Namespace | Draft | Standards Track | `subject-namespace.abnf` | `subject-namespace/` |
| 0003 | Envelope Format | Draft | Standards Track | `envelope.abnf` | `envelope/` |
| 0004 | Envelope Signing & Canonicalization | Draft | Standards Track | `envelope-signing.abnf` | `envelope-signing/` |
| 0005 | Sovereignty & Boundary-Crossing | Draft | Standards Track | `sovereignty.abnf` | `sovereignty/` |
| 0006 | Membership & Admission | Draft | Standards Track | `admission.abnf` | `admission/` |
| 0007 | Transport & Reliability | Draft | Standards Track | `transport.abnf` | `transport/` |
| 0008 | Capability Discovery & Advertisement | Draft | Standards Track | `capability-discovery.abnf` | `capability-discovery/` |
| 0009 | Economics | Draft | Informational | `economics.abnf` | `economics/` |
| BCP-0001 | Wire Change Control & Versioning | Draft | Best Current Practice | — | — |

### Draft status

All ten are **Draft** (myelin PR: rfc-drafts). None is Ratified — grounding on any of them is forbidden until it carries the two signatures. Cross-reference refinements before `Proposed` are tracked in [`rfc/REVISIONS.md`](rfc/REVISIONS.md).

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
| `Draft` | Under active authoring. Sections may renumber. | **No** |
| `Proposed` | Complete, under review, awaiting signatures. | **No** |
| `Ratified` | Signed. Frozen. | **Yes** |
| `Obsoleted` | Replaced by a later RFC. Retained for citation. | No — follow `obsoletes` |

## Rules

1. **Numbers are permanent.** Never reused, never renumbered.
2. **A `Ratified` RFC is immutable.** It is never edited in place. Changes ship as a new RFC
   carrying `Updates: NNNN` (amends) or `Obsoletes: NNNN` (replaces). Section numbering in a
   ratified document is frozen, because citations point at it.
3. **Ratification requires two signatures** — the **principal** and the **hub custodian** —
   recorded in the document's `signatories`. A wire contract binds more than one party; one party
   cannot ratify it.
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
5. Collect both signatures. Move to `Ratified`, set `ratified:`, and freeze.

Process for cross-repo wire changes — including the mandatory dual-accept window — lives in
compass `sops/federation-wire-protocol.md`.

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
