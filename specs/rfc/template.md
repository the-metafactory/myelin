---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: NNNN                       # assigned by specs/README.md index; never reused
title: Title Case Without Trailing Period
status: Draft                   # Draft | Proposed | Ratified | Obsoleted
category: Standards Track       # Standards Track | Informational | Best Current Practice
obsoletes: []                   # [NNNN, ...] RFCs this one replaces entirely
updates: []                     # [NNNN, ...] RFCs this one amends in place
authors:
  - name: <name>
    affiliation: metafactory
signatories: []                 # Single-principal ratification (v1) per docs/adr/0001-single-principal-ratification.md: the principal alone. Two-signature (adding the hub custodian) reinstates on a 2nd impl / live peer.
created: YYYY-MM-DD
ratified: null                  # ISO date once status becomes Ratified; null otherwise
grammar: null                   # e.g. specs/grammar/identifiers.abnf — the NORMATIVE syntax
vectors: null                   # e.g. specs/vectors/identifiers/ — conformance vectors
generated: []                   # artifacts DERIVED from `grammar`; never hand-edited — e.g. schemas/envelope.schema.json. Use `[]` (empty seq), NOT `- []` (which parses as [[]]).
openDecisions: []               # [{ id: <slug> }] — one entry per live [OPEN DECISION] marker in the body; `[]` when none remain. Agents ground on this list.
supersedes_prose: []            # informative docs this RFC makes normative, e.g. docs/identity.md
---

# RFC-NNNN: Title

## Abstract

One or two paragraphs. States what this document specifies and why. **No citations, no
references to other sections** — it MUST stand alone when extracted into the index.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `<status>`. Only a document with status `Ratified` is normative.
Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document.

Under single-principal ratification (v1), per
[`docs/adr/0001-single-principal-ratification.md`](../../docs/adr/0001-single-principal-ratification.md),
a `Ratified` RFC is a **living spec**: `Ratified` means the current best contract the
implementation tracks, revisable when a hole is found — not immutable-forever. Section numbering
stays stable so citations hold. The immutable-once-`Ratified` discipline (changes shipped only as
a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN`) is the reinstate-target that returns with
the two-signature rule.

Ratification (v1) requires the signature of **the principal** alone, recorded in `signatories`.
The full two-signature act (principal + hub custodian) is suspended, not deleted: it reinstates the
moment a second independent implementation exists or a live federated peer principal joins.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

---

## 1. Introduction

What problem this solves. What it does not solve. Which existing artifacts it makes normative
(list them in `supersedes_prose`) and which it merely references.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted
as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals,
as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in
> all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement.

### 1.2. Terminology

Define every term this document relies on, once. If a term is defined in another RFC, cite it
rather than redefining it — a term defined twice is a term that will drift.

---

## 2. …Body…

The technical content. Where syntax is specified it MUST be given as ABNF [RFC5234], and the
collected grammar MUST also exist as a standalone file at the path named in `grammar`.

**Precedence.** The ABNF is normative for syntax. Any regular expression, JSON Schema `pattern`,
or parser generated from it (listed in `generated`) is a derived artifact and MUST be produced
mechanically. Test vectors MUST be consistent with the ABNF. Where an artifact and the ABNF
disagree, **the ABNF governs and the artifact is a defect.**

---

## N. Registry Considerations

*(The internal analogue of an IETF "IANA Considerations" section. This section is REQUIRED and
MUST NOT be omitted, even to say there is nothing to do.)*

State what this document registers, and where:

- **RFC number** — allocated in [`specs/README.md`](../README.md); numbers are never reused.
- **External registries** — if the document defines a DID method, state whether the method name
  is to be registered in the [W3C DID Specification Registries][did-registries], and if not, why.
- **Reserved names** — any subject prefix, segment, or identifier this document reserves.

If there is nothing to register, write: *This document has no registry actions.*

## N+1. Security Considerations

REQUIRED. MUST NOT be empty and MUST NOT say "none".

State the threat model this document assumes, what it defends against, and what it does not.
Where a property is enforced by a **runtime check rather than by the grammar**, say so explicitly
— an invariant held shut by vigilance is a finding, not a design.

## N+2. Privacy Considerations

REQUIRED for any document that specifies an identifier. State what is observable to whom,
what correlates across contexts, and what an identifier leaks by construction.

## N+3. Conformance

State precisely what an implementation MUST do to claim conformance, and name the vector set that
decides it. See [`specs/CONFORMANCE.md`](../CONFORMANCE.md).

An implementation conforms to this document if and only if it passes every vector under the path
named in `vectors`. Prose explains; **vectors bind**.

## N+4. References

### N+4.1. Normative References

Documents an implementer MUST read to implement this one.

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.

### N+4.2. Informative References

Documents that inform but do not bind.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in
`grammar` is the source of truth and is what CI validates.

```abnf
; see specs/grammar/<name>.abnf
```

## Appendix B. Test Vectors

Vectors live as JSON under the path named in `vectors`, so that implementations in any language
can consume them. This appendix MAY reproduce a representative subset; it MUST NOT be the only
copy. See [`specs/vectors/README.md`](../vectors/README.md) for the vector schema.

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here.
A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| YYYY-MM-DD | Draft | Initial draft. |

## Acknowledgments

## Authors' Addresses

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
