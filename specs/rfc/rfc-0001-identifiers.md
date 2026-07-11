---
# ─── Machine-readable front matter. Agents ground on THIS, not on prose. ───
rfc: 0001
title: Identifiers and Identity (the did:mf DID Method Specification)
status: Draft                   # Draft | Proposed | Ratified | Obsoleted
category: Standards Track       # Standards Track | Informational | Best Current Practice
obsoletes: []
updates: []
authors:
  - name: Luna (drafting agent, on behalf of Andreas)
    affiliation: metafactory
signatories: []                 # Ratification REQUIRES: the principal (Andreas) AND the hub custodian (JC)
created: 2026-07-12
ratified: null
grammar: specs/grammar/identifiers.abnf
vectors: specs/vectors/identifiers/
generated:                      # DERIVED from `grammar`; regeneration BLOCKED until §6.2 resolves
  - schemas/envelope.schema.json          # the 6 did:mf pattern sites (wallet, target_assistant, originator.identity, stamp identity ×2, stamped_by)
  - src/identity/types.ts                 # DID_RE
supersedes_prose:
  - docs/identity.md                      # the identifier / DID model only; the agent-identity key-management subsystem stays undocumented (see §1)
---

# RFC-0001: Identifiers and Identity (the did:mf DID Method Specification)

## Abstract

This document specifies the identifiers of the myelin wire protocol: the terminal alphabets for a principal, a stack, an agent, a service, and a hub, and the `did:mf` Decentralized Identifier (DID) method that names any of them on the wire. It is the foundational document of the RFC series — the terminal alphabets defined here are referenced by every other myelin RFC. It records the identity model as it is implemented today: five identity classes packed into a single flat `did:mf` namespace with nothing in the syntax distinguishing them. It proves the class collisions that this flatness permits, and it marks — but does not resolve — the choice of a class-unambiguous method-specific-id grammar, which is an open decision blocked on an external issue. Where an identity invariant is upheld by a runtime check rather than by the grammar, this document records it as a finding.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document. In particular, the `method-specific-id` grammar in this draft is a TBD placeholder (§6.2); no implementation may treat it as settled.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** (Andreas) and **the hub custodian** (JC), recorded in `signatories`. A wire contract binds more than one party; it cannot be ratified by one.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it). -->

1. Introduction
2. The Identity Model
3. Identifier Terminals
4. Rendering Principals and Stacks as DIDs
5. The Subject-Plane Encoding
6. The did:mf DID Method Specification
7. Registry Considerations
8. Security Considerations
9. Privacy Considerations
10. Conformance
11. References
Appendix A. Collected ABNF
Appendix B. Test Vectors
Appendix C. Change Log

---

## 1. Introduction

Every signed message on the myelin bus carries identity. A `signed_by` stamp names who attested it; an `originator` names on whose behalf; `target_assistant` names the recipient; `economics.wallet` names who pays; a NATS subject may embed the recipient's identity as a routing segment; and the NATS user that connected the transport is itself a DID. All of these are the same kind of string: a `did:mf:<method-specific-id>`.

That string has, today, exactly one definition in the entire codebase — a single regular expression, `DID_RE`, at `src/identity/types.ts:1`, hand-copied verbatim to six pattern sites in `schemas/envelope.schema.json` and six more in cortex's vendored copy of that schema. There is no ABNF, no class model, no resolution contract, and no conformance vector. This document is the normative home the scaffold's index reserves for that contract (RFC-0001).

**What this document specifies.** The terminal alphabets for the five identity classes (`principal-id`, `stack-slug`, `agent-id`, `service-id`, `hub-id`) and the composite `stack-id`; the `did:mf` DID method per W3C DID Core §8 [DID-CORE]; and the relationship between DID resolution and the (separately specified) envelope-signing verification path.

**What this document does not solve.** It does not choose the class-unambiguous `method-specific-id` grammar — that is an open decision blocked on `the-metafactory/cortex#1880` (§6.2). It does not specify the bytes-to-sign, canonicalization, or chain-verification contract — those belong to the (not-yet-allocated) signing RFC and are referenced here only where DID resolution touches them. It does not specify subject composition — that is RFC-0002. It does not specify the agent-identity key-management subsystem (`src/agent-identity/`: Ed25519 generation, rotation, and encrypted-at-rest storage); that subsystem ships code today with no documentation home, and `docs/identity.md:238-240` erroneously declares it out of scope while the code exists. Documenting it is left to a future RFC; this document only records, in §8, that rotation and revocation have no wire-visible semantics.

**Prose promoted to normative.** This document supersedes the identifier and DID content of the informative `docs/identity.md` (listed in `supersedes_prose`). It does not promote that document's "Out of Scope" section, which is contradicted by shipped code.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement. This document deliberately describes several behaviours it does **not** endorse (the current collisions and degenerate forms); those descriptions are written in lowercase precisely so they are not read as requirements.

### 1.2. Terminology

This document defines the following terms. Terms defined in a sibling RFC are cited, not redefined.

- **Identity class** — one of the five kinds of entity a DID may name: *agent*, *service*, *hub*, *principal*, *stack*. The first three are the values of `IdentityType` (`src/identity/types.ts:6`); the last two are minted by consumers and have no `IdentityType` value.
- **principal** — the owner of one or more stacks; the sovereignty boundary. Named on a subject by a `principal-id`; named as a DID by `did:mf:{principal-id}`.
- **stack** — one deployment belonging to a principal. Named by a `stack-id` (`{principal-id}/{stack-slug}`); named as a DID by the mint in §4.
- **agent / service / hub** — an assistant, a non-interactive service, or a network hub. Each is named on the wire only as a DID; none has a distinct terminal alphabet (§3.4).
- **DID** — a Decentralized Identifier per [DID-CORE]. A `did:mf` DID is `did:mf:` followed by a `method-specific-id`.
- **method-specific-id** (msi) — the part of a DID after `did:mf:`. Its canonical grammar is an **open decision** (§6.2); the grammar deployed today is `did-msi-deployed` (Appendix A).
- **DID subject segment** — the `@`-prefixed NATS subject token that encodes a DID for direct routing (§5). The encoding is co-owned with RFC-0002.
- **mint** — the act of rendering a non-DID identifier (a principal-id, or a stack-id) into a DID.
- **runtime guard** — an identity invariant enforced by an executable check at a consumer, not by the grammar. Per the scaffold's rule 6, every runtime guard that upholds a wire invariant is recorded here as a finding (§8).

Terms defined elsewhere: **subject**, **classification prefix**, **`@`-assistant segment composition** (RFC-0002); **envelope**, **`signed_by` chain**, **canonical bytes**, **stamp** (RFC-0003 and the signing RFC).

---

## 2. The Identity Model

### 2.1. Five classes, one flat namespace

The system names five classes of entity, and all five are rendered into the single flat `did:mf` namespace:

| Class | Named as | Minted by | `IdentityType`? |
|---|---|---|---|
| agent | `did:mf:{agent-id}` | consumer config; e.g. `did:mf:echo` | `"agent"` |
| service | `did:mf:{service-id}` | consumer config; e.g. `did:mf:signal-tap` | `"service"` |
| hub | `did:mf:{hub-id}` | consumer config; e.g. `did:mf:hub.metafactory` | `"hub"` |
| principal | `did:mf:{principal-id}` | `peerDid()`, cortex `identity-registry.ts` | *(none)* |
| stack | mint of `{principal-id}/{stack-slug}` (§4) | cortex `cortex.ts:1025-1027` | *(none)* |

A sixth, synthetic *system* form is minted in practice (`did:mf:reflex`, cortex `reflex-activation-listener.ts:68`), and a seventh *platform-user* form (`did:mf:{platform}-{authorId}`) has been retired from the same namespace. The registry's type enum admits only the first three: `VALID_TYPES = new Set(["agent","service","hub"])` (`src/identity/registry.ts:86`). The principal and stack classes therefore **cannot be typed** in the registry, and a consumer that must store a resolved peer principal is forced to store it as `type: "agent"` (cortex `identity-registry.ts`, materialised peer entry). This is recorded as a finding in §8.

An implementation MUST accept every class as a syntactically valid DID (they are indistinguishable by syntax today). An implementation MUST NOT infer an identity's class from its DID string alone; the class is not recoverable from the syntax (§8.1).

### 2.2. What is signed vs. what is asserted

Two envelope positions carry identity with different trust weight, and this document does not change that boundary (it belongs to RFC-0003 / the signing RFC):

- `signed_by[].identity` — the **verified** attestor DID. Cryptographically bound.
- `source`, `originator.identity` — **self-asserted** routing/attribution DIDs. Covered by the signer's signature (the signer commits to the claim) but not otherwise constrained to the verified chain.

This document specifies only the *syntax* of the DIDs in these positions. The absence of a normative rule binding a self-asserted `source`/`originator` to the verified chain is a finding recorded in §8 and cross-referenced to RFC-0003.

---

## 3. Identifier Terminals

The terminals in this section are the normative subject of this RFC. Each is given once, as an ABNF rule, and is the single source of truth referenced by RFC-0002 and RFC-0003. The grammar of record is [`specs/grammar/identifiers.abnf`](../grammar/identifiers.abnf); Appendix A reproduces it.

### 3.1. `principal-id`

A `principal-id` MUST match the `principal-id` rule of Appendix A, transcribed from `PRINCIPAL_RE` (`src/patterns.ts:35`, `/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/`): 2–64 characters, a leading lowercase letter, a final alphanumeric, and interior characters drawn from `[a-z0-9-]`.

An interior hyphen — including two or more consecutive hyphens — is permitted. A trailing hyphen is forbidden. This is materially looser than a DID method-specific-id (which forbids `--`), and that mismatch is load-bearing: a `principal-id` that is legal on a subject is not necessarily legal after being minted into a DID (§4, §8).

### 3.2. `stack-slug`

A `stack-slug` MUST match the `stack-slug` rule of Appendix A, transcribed from `STACK_SEGMENT_REGEX` (`src/segment-validators.ts:27`, `/^[a-z][a-z0-9-]{0,62}$/`): 1–63 characters, a leading lowercase letter, remaining characters from `[a-z0-9-]`.

A `stack-slug` MAY end in a hyphen. This diverges from `principal-id` (which MUST NOT) and from a capability tag (which MUST NOT). Implementations MUST NOT assume the two segment grammars are the same. The divergence is a finding (§8.6).

### 3.3. `stack-id`

A `stack-id` MUST match `principal-id "/" stack-slug`. The `/` separator is REQUIRED.

A parser that is given a bare `principal-id` with no `/` MUST reject it as a fault. It MUST NOT fabricate a `default` (or any other) stack slug. This is the direct codification of cortex#1812, in which a missing stack segment was silently fabricated into `default`, and the defect was masked for two days because one deployment's stack was in fact named `default`. Both the rejection and its masking companion are pinned by vectors (Appendix B).

### 3.4. `agent-id`, `service-id`, `hub-id`

There is no distinct terminal alphabet for an agent, a service, or a hub. In the source, the name of any of these is constrained only by the DID method-specific-id grammar. Appendix A therefore defines `agent-id`, `service-id`, and `hub-id` as aliases of `did-msi-deployed`.

This is a deliberate, explicit statement of an absence: it is **not** a design that the three interactive classes and the two structural classes (principal, stack) share one undifferentiated alphabet — it is the condition this RFC exists to surface. A ratified resolution of §6.2 is expected to give at least some of these classes a narrower or structurally-marked form.

---

## 4. Rendering Principals and Stacks as DIDs

This section is **descriptive of current behaviour**, not an endorsement. It uses lowercase deliberately; the collisions it documents are findings (§8), not requirements.

A principal is minted to a DID by prefixing `did:mf:` to its `principal-id` (`peerDid`, cortex `identity-registry.ts`): `did:mf:{principal-id}`.

A stack is minted to a DID from its `stack-id` by replacing `/` with `-` and then collapsing runs of `-` to a single `-` (cortex `cortex.ts:1025-1027`):

```
did:mf:${stack.id.replace("/", "-").replace(/-+/g, "-")}
```

The hyphen-run collapse exists only to survive `DID_RE`'s `--` prohibition; the source comment records that without it, a stack id such as `my-op-/foo` would mint the invalid `did:mf:my-op--foo` and silently downgrade every outbound envelope to unsigned.

Three consequences follow, all proven and all pinned by vectors:

1. **Principal/stack collision.** `did:mf:andreas-meta-factory` is byte-identical whether minted from the principal `andreas-meta-factory` or from the stack `andreas/meta-factory`. (Vectors `render/stack-did-andreas-meta-factory`, `render/principal-did-andreas-meta-factory`.)
2. **Hyphen-inside-principal collision.** Because `principal-id` permits interior hyphens, the stack DIDs of `{principal: meta-factory, stack: dev}` and `{principal: meta, stack: factory-dev}` are both `did:mf:meta-factory-dev`. A decoder that splits on the first hyphen (cortex `review-consumer.ts:1454`) attributes the DID to principal `meta`, mis-routing the federated verdict. The decoder's own comment asserts "the wire grammar forbids" hyphenated principals; no grammar anywhere enforces that. (Vectors `render/stack-did-hyphenated-principal`, `render/stack-did-first-hyphen-victim`.)
3. **Lossy mint.** The `-+`→`-` collapse maps distinct stack ids (`a-b/c` and `a/b-c`) to the same DID.

No normative encoding of a `{principal}/{stack}` pair into a DID exists in myelin today; the three mint sites across cortex and pilot are kept in agreement by comment. Specifying that encoding is exactly the open decision of §6.2 — this document deliberately does not pick a rendering.

---

## 5. The Subject-Plane Encoding

A DID is embedded in a direct-routing NATS subject as an `@`-prefixed segment. The encoding function `encodeDidSegment` (`src/subjects.ts:124-129`) maps `:`→`-` and `.`→`--`, preserving `-`, and prefixes `@`. Its composition into a full subject is specified by **RFC-0002**; this document specifies only the identifier-level property.

`docs/identity.md` and `specs/namespace.md` §"Assistant encoding" claim the encoding is "reversible, injective", resting the claim solely on `DID_RE`'s rejection of `--`. That claim is **false**, and this document does not adopt it. `did:mf:a-.b` and `did:mf:a.-b` are both valid method-specific-ids and both encode to `@did-mf-a---b`: the encoded run `---` is ambiguous between `-`+`--` and `--`+`-`. Two distinct assistants therefore share one direct-routing subscription. (Vectors `encode/segment-dash-dot`, `encode/segment-dot-dash`; verified by execution.)

No decoder for the `@`-segment exists in myelin source; each consumer hand-rolls the inverse of a prose-only mapping whose ambiguity the prose cannot resolve. A resolution of §6.2 that forbids `-`/`.` adjacency in the method-specific-id would restore injectivity; this document records the defect and defers the fix.

---

## 6. The did:mf DID Method Specification

This section follows the structure required of a DID method specification by W3C DID Core §8 [DID-CORE]: method name, method-specific identifier syntax, and the CRUD operations, plus method-level Security and Privacy Considerations (which are folded into the document-level §8 and §9 as the scaffold requires).

### 6.1. Method Name

The method name that identifies this DID method is `mf`.

A DID that uses this method MUST begin with the prefix `did:mf:`. The prefix MUST be lowercase (`did-prefix`, Appendix A).

### 6.2. Method-Specific Identifier

**[OPEN DECISION — Andreas + JC — blocked on the-metafactory/cortex#1880]**

The normative grammar of `method-specific-id` is **not settled**. It cannot be written as ABNF until cortex#1880 selects an encoding, because the choice determines whether — and how — the five identity classes are distinguished within the string. Appendix A therefore gives `method-specific-id` as a TBD placeholder bound, for descriptive fidelity only, to `did-msi-deployed` (the current `DID_RE`). An implementation MUST NOT treat `did-msi-deployed` as the ratified grammar.

The candidate encodings under consideration, presented and **not** chosen:

- **Candidate A — forbid-hyphen.** Forbid `-` inside a `principal-id` so the `{principal}-{stack}` join becomes unambiguous. **Shown insufficient.** Agent- and service-class ids are themselves hyphenated and share the same flat namespace (e.g. `did:mf:signal-tap`), and deployed principals already contain hyphens; forbidding hyphens in principals resolves neither the agent/service hyphens nor the deployed data. Vector `did/service-hyphenated` pins the counterexample.
- **Candidate B — new-separator.** Introduce a delimiter between the class/structure fields that is illegal inside every base id alphabet, so the join is unambiguous by construction. Requires a grammar change and a migration of all persisted DIDs.
- **Candidate C — class-explicit with `.`.** Carry class and structure using `.` as a field separator. Note: `.` is already accepted by the deployed method-specific-id grammar and is forbidden in every base id alphabet (`[a-z0-9-]` only), so a `.`-separated encoding is unambiguous against the base alphabets, needs no envelope-schema change, and remains W3C-conformant. This document records that property; it does not select the candidate.
- **Candidate D — keep-runtime-guard.** Leave the grammar unchanged and continue to rely on the consumer-side runtime guard (§8.1) to refuse a colliding DID. The collision then remains an invariant held by vigilance, which the scaffold's rule 6 classifies as a finding, not a design.

Until this decision is ratified, the degenerate-form and length questions in §8.5 also remain open, since they would be settled by the same grammar edit.

### 6.3. DID Operations

W3C DID Core requires a method to define Create, Read (Resolve), Update, and Deactivate. myelin's identity layer implements a deliberately minimal subset; this document specifies the subset as it is and marks the rest.

- **Create.** A DID is created out-of-band by minting it (agent/service/hub from config; principal/stack per §4) and registering the identity's Ed25519 public key. Registration is an append to the DID-keyed registry (`add(identity)`, `src/identity/registry.ts:52-53`), which is **last-write-wins** by DID. There is no on-chain or hub-mediated creation ceremony. An implementation MUST reject a registry record whose `id` is not a syntactically valid DID (enforced today at `registry.ts:95`).
- **Read (Resolve).** To resolve a `did:mf` DID is to look up its Ed25519 public key in the identity registry (a JSON file at `~/.config/metafactory/principals.json`, or an in-memory registry). There is no DID Document in the W3C sense; the resolved artifact is an `Identity` record (`{id, network, public_key, type, created_at, ...}`). The public key so resolved is the verification key consumed by the envelope-signing verification path (specified in the signing RFC, not here). This document specifies only that resolution is keyed by the exact DID string and that a resolver MUST NOT canonicalize, case-fold, or otherwise rewrite the DID before lookup (the strings are compared byte-for-byte). Because resolution is last-write-wins and keyed by a string that does not encode class, a collision between classes (§8.1) is a resolution hazard.
- **Update (rotation).** Key rotation is implemented on disk only (`src/agent-identity/rotate.ts`: same DID, fresh keypair, `previous_public_key` + `rotated_at` recorded). No verification path in myelin consults `previous_public_key`. The wire-visible semantics of rotation — a grace window for in-flight envelopes signed with the prior key, and propagation of the new key to resolvers — are therefore **undefined**. This is a finding (§8.7) and an open decision.
- **Deactivate (revocation).** There is no revocation. `docs/identity.md` declares revocation lists out of scope, and no counterpart exists anywhere on the wire. A compromised key has no specified lifecycle. This is a finding (§8.7).

---

## 7. Registry Considerations

- **RFC number.** This document is allocated number 0001 in [`specs/README.md`](../README.md). Numbers are never reused.
- **DID method name.** This document reserves the DID method name `mf` for the metafactory identity namespace. Whether to register `mf` in the [W3C DID Specification Registries][did-registries] is an **open decision** (owner: Andreas + JC), deferred until the `method-specific-id` grammar is ratified — registering a method whose identifier syntax is still a TBD placeholder would publish an incomplete method.
- **Reserved identifiers.** This document notes, for the registry's awareness, the system-class DID `did:mf:reflex` as an identifier already minted in production (cortex `reflex-activation-listener.ts:68`). A ratified class model (§6.2) MUST account for such synthetic system DIDs. This document does not, in Draft, reserve a system-class prefix; it flags the need.
- **Reserved slug.** The stack slug `default` is **not** reserved as a sentinel and MUST NOT be treated as one. A stack may legitimately be named `default`; a missing stack segment is a distinct, rejected fault (§3.3). Conflating the two was the root cause of cortex#1812.
- **Terminal alphabets.** This document is the sole registrant of the identifier terminals `principal-id`, `stack-slug`, `stack-id`, `agent-id`, `service-id`, `hub-id`. Other RFCs reference them from Appendix A and MUST NOT redefine them.

---

## 8. Security Considerations

REQUIRED. This document specifies identifiers that seed trust decisions (whose key verifies a stamp, whose scope a federated message routes to, which subscription a direct dispatch reaches). Several of the properties an identifier ought to guarantee are, today, upheld by a runtime check rather than by the grammar. Per the scaffold's rule 6, each such case is recorded here as a finding.

### 8.1. Flat-namespace class collision → trust displacement (runtime-guarded)

The five identity classes share one flat namespace with nothing in the syntax distinguishing them (§2.1). Cross-class collision is proven: `did:mf:andreas-meta-factory` is a valid principal DID, stack DID, and agent DID simultaneously.

The identity registry is keyed by DID and its `add()` is **last-write-wins** (`src/identity/registry.ts:52-53`). A registry write for a peer principal whose id collides with a boot stack DID would therefore **displace the out-of-band boot anchor** in the exact registry the verifier consumes — a trust-displacement primitive. The only defense is a **runtime guard** in cortex (`identity-registry.ts`), which refuses to store a resolved peer whose DID equals the boot anchor DID. This invariant is held by vigilance, not by the grammar: it is precisely the condition the scaffold's rule 6 requires this document to flag, and it is the security core of the open decision in §6.2. An implementation that does not carry an equivalent guard is vulnerable; MUST-level closure requires the grammar fix, not a per-consumer check.

### 8.2. First-hyphen decode is unsound

The stack-DID mint uses `-` as the `{principal}/{stack}` separator, but `-` is legal inside a `principal-id`. A decoder that splits on the first hyphen mis-attributes any hyphenated principal (`did:mf:meta-factory-dev` → principal `meta`), silently, with no error, corrupting federated provenance and verdict routing (§4, vectors `render/stack-did-hyphenated-principal` / `render/stack-did-first-hyphen-victim`). The premise stated in the decoder ("the wire grammar forbids hyphenated principals") has no enforcing grammar. Consumers MUST NOT decode a stack DID by splitting on the first hyphen while the mint remains ambiguous.

### 8.3. Subject-encoding non-injectivity

`encodeDidSegment` is not injective (§5): `did:mf:a-.b` and `did:mf:a.-b` collide onto `@did-mf-a---b`. Two distinct assistants can share a direct-routing subscription, so a dispatch intended for one can be delivered to the other. The injectivity claim in `docs/identity.md` / `specs/namespace.md` is false and is not adopted here.

### 8.4. Lossy stack-DID mint

The `-+`→`-` collapse in the stack mint (§4) makes distinct stack ids resolve to the same signing DID. Combined with §8.2, both aliases then decode to the same wrong `{principal, stack}`.

### 8.5. Degenerate and unbounded method-specific-ids

`did-msi-deployed` (the live grammar) accepts a trailing `-`, `.`, or `_`, consecutive `..` and `._`, and a method-specific-id of unbounded length (a 507-character DID validates — verified by execution). Sibling grammars (`PRINCIPAL_RE`, `CAPABILITY_TAG_RE`) cap length at 64 and forbid trailing/consecutive separators precisely to stay safe to embed in NATS subjects, KV keys, and file paths — and a DID *is* embedded in a subject via §5. A trailing-dot DID encodes to a segment ending in `--`; an unbounded DID yields an unbounded subject token. Whether these forms are conformant is an open decision (§6.2). Until it resolves, a defensive consumer SHOULD bound the length of a DID it accepts from an untrusted source.

### 8.6. Divergent segment grammars

`principal-id`, `stack-slug`, and the first segment of an envelope `source` are governed by three different regexes that disagree on trailing hyphens, length, and minimum size (§3.1–3.2). A string valid in one position may be rejected in another. Implementations MUST validate against the specific terminal for the position and MUST NOT assume the segment grammars are interchangeable.

### 8.7. Rotation and revocation have no wire-visible lifecycle

`previous_public_key` is written on disk and consulted by no verifier (§6.3). There is no grace window for a rotated key and no revocation at all. A rotated-out or compromised key is indistinguishable on the wire from a current one for as long as a resolver serves it. This is an open decision.

### 8.8. Cross-protocol key reuse (no domain separation)

`docs/identity.md` specifies one Ed25519 key for both NATS transport authentication (NKey nonce signing at CONNECT) and envelope stamping ("One key serves both"). No domain-separation prefix distinguishes a transport-auth signature from an envelope-stamp signature, and no analysis rules out a crafted CONNECT nonce colliding with canonicalized envelope bytes (or the reverse). This document records the reuse; the signature-confusion analysis belongs to the signing RFC and MUST be performed there before that key-reuse design is ratified.

### 8.9. No version-negotiation for a grammar change

A resolution of §6.2 that tightens the grammar (Candidates A–C) must be synchronized across `DID_RE`, twelve schema pattern sites in two repositories, and every persisted DID (NATS user names, registry files, on-disk agent-identity files, and deployed stack DIDs such as `did:mf:andreas-meta-factory`). No version field ties DID-grammar revisions to the envelope `spec_version`, and no dual-accept mechanism exists. A tightening would break deployed hyphenated DIDs silently. Any ratified change MUST follow the dual-accept window in compass `sops/federation-wire-protocol.md`.

---

## 9. Privacy Considerations

REQUIRED, because this document specifies an identifier.

A `did:mf` DID is a **stable, long-lived, fully correlatable** identifier. There is no pairwise or pseudonymous DID facility: the same DID names its subject across every network, subject, and context, so any two observations of a DID are trivially linkable.

The method-specific-id is **human-meaningful by construction**. An agent DID discloses the assistant's name; a principal DID discloses the principal id; a stack DID discloses the `{principal, stack}` pair, i.e. a piece of deployment topology. The dotted hub convention (`did:mf:hub.metafactory`) discloses the network operator. An observer who collects DIDs therefore learns organizational structure without any payload access.

The `@did-mf-…` subject segment (§5) publishes the recipient's DID **in cleartext on the NATS subject**, by design, so that brokers and audit pipelines can route and recognize an assistant without inspecting the payload. Any party with visibility of subject names — including a federation relay — sees who is being addressed.

Finally, the NKey dual-use design (§8.8) means the transport-authentication identity, the envelope-signing identity, and the DID are the same key. A network-level observer can therefore correlate a transport session to the authorship of the content signed within it.

Implementations that require unlinkability across contexts cannot obtain it from this method as specified; a future method revision would be required.

---

## 10. Conformance

An implementation conforms to this document if and only if it passes every vector under the path named in the `vectors` front-matter field (`specs/vectors/identifiers/`). See [`specs/CONFORMANCE.md`](../CONFORMANCE.md). Prose explains; vectors bind.

A conforming implementation MUST:

1. Accept exactly the DIDs accepted by `did-msi-deployed` (Appendix A) — no wider, no narrower — for as long as §6.2 remains open, and MUST validate the DID string against the grammar, not against a hand-copied regex it maintains independently.
2. Parse a `stack-id` per §3.3, rejecting a missing `/` as a fault and never fabricating a slug.
3. Reproduce the render and encode outputs pinned by the `render/*` and `encode/*` vectors byte-for-byte, including the collision pairs (an implementation that "fixes" a collision by producing a different string for one member of a pair does not conform to the *current* wire and MUST NOT do so unilaterally; the fix is a ratified grammar change).
4. Not infer an identity's class from its DID syntax.

An implementation MUST NOT import the reference implementation to pass the vectors; it runs its own parser (`specs/CONFORMANCE.md`).

Because the `method-specific-id` grammar is a placeholder, this document cannot yet be the sole conformance authority for the class-structured form; that authority arrives with the ratified resolution of §6.2.

---

## 11. References

### 11.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [DID-CORE] Sporny, M., Longley, D., Sabadello, M., Reed, D., Steele, O., Allen, C., "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. Structure of §6 follows DID Core §8 (DID Method Specification requirements).

### 11.2. Informative References

- [RFC3986] Berners-Lee, T., Fielding, R., Masinter, L., "Uniform Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005. (A DID is a URI.)
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014. (This document uses `%x` hex terminals for case-sensitivity rather than the `%s` extension.)
- [RFC8785] Rundgren, A., Jordan, B., Erdtman, S., "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. (Referenced by the signing RFC, which consumes the key resolved by §6.3.)
- [RFC-0002] metafactory RFC-0002, "Subject Namespace". Co-owns the `@`-segment subject composition of §5.
- [RFC-0003] metafactory RFC-0003, "Envelope". Consumes the DID terminals in `signed_by`, `originator`, `target_assistant`, `economics.wallet`.
- [cortex-1880] the-metafactory/cortex#1880, "The did:mf encoding decision". The issue this document's §6.2 is blocked on.
- [cortex-adr-0002] the-metafactory/cortex, ADR-0002, "Federated dispatch addressing and verdict-back". Origin of the `did:mf:{principal}-{stack}` requester-DID convention.
- `specs/namespace.md`, `docs/identity.md` — informative background; the DID content of `docs/identity.md` is superseded by this RFC.

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in `grammar` (`specs/grammar/identifiers.abnf`) is the source of truth and is what CI validates. `ALPHA` and `DIGIT` are the core rules of [RFC5234] Appendix B.

```abnf
; ── Base identifier terminals (subject segments AND DID mint inputs) ──

lower           = %x61-7A                        ; a-z

; principal-id — PRINCIPAL_RE, src/patterns.ts:35
;   /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/  (2–64; interior "-" ok incl. "--"; no trailing "-")
principal-id    = lower *62( lower / DIGIT / "-" ) ( lower / DIGIT )

; stack-slug — STACK_SEGMENT_REGEX, src/segment-validators.ts:27
;   /^[a-z][a-z0-9-]{0,62}$/          (1–63; TRAILING "-" permitted — diverges from principal-id)
stack-slug      = lower *62( lower / DIGIT / "-" )

; stack-id — the "/" is REQUIRED; a bare principal is a fault, never a "default" stack (cortex#1812)
stack-id        = principal-id "/" stack-slug

; agent-id / service-id / hub-id — NO per-class alphabet exists; only the DID msi constrains them.
; Aliased to make the absence explicit (a finding — see Security Considerations).
agent-id        = did-msi-deployed
service-id      = did-msi-deployed
hub-id          = did-msi-deployed

; ── The did:mf DID ──

did             = did-prefix method-specific-id
did-prefix      = %x64.69.64.3A.6D.66.3A         ; "did:mf:" (case-sensitive)

; method-specific-id — *** OPEN DECISION — Andreas + JC — blocked on cortex#1880 ***
; TBD PLACEHOLDER. Candidates (RFC §6.2): A forbid-hyphen (INSUFFICIENT — hyphenated
; agent/service ids share the namespace); B new-separator; C class-explicit "." ("." is
; accepted by the deployed grammar and illegal in every base id alphabet — unambiguous,
; no schema change, W3C-conformant); D keep-runtime-guard (a finding, not a fix).
method-specific-id = did-msi-deployed
                ; ^ placeholder: what deployed implementations accept TODAY, transcribed for
                ;   fidelity, NOT endorsed — it admits the class collisions of §8.

; did-msi-deployed — DID_RE, src/identity/types.ts:1
;   /^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/
; leading letter; length >= 2; "." and "_" ok anywhere after char 1 (incl. consecutively);
; a single "-" ok where NOT immediately followed by "-"; NO length cap; trailing "-"/"."/"_" ok;
; the only forbidden sequence is "--".
did-msi-deployed = lower ( 1*msi-run [ "-" ] / "-" )
msi-run          = 1*msi-symbol / "-" 1*msi-symbol
msi-symbol       = lower / DIGIT / "." / "_"
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/identifiers/`. The positive and render/collision set (`valid.json`) is carried in this document's `vectors` payload; it is reproduced representatively here, and the rejection set (`invalid.json`) is given below so it is not lost. This appendix is a copy; the JSON files bind. See [`specs/vectors/README.md`](../vectors/README.md).

**Representative `valid.json` entries** (all `ok: true`): a DID per class (`did/agent-plain`, `did/service-hyphenated`, `did/hub-dotted`, `did/principal-plain`, `did/system-reflex`); the cross-class collision (`did/stack-collides-with-principal`); a `stack-id` round-trip and its masking companion (`stack-id/non-default-slug`, `stack-id/literal-default-slug-masking`); the render collision pairs (`render/stack-did-andreas-meta-factory` ≡ `render/principal-did-andreas-meta-factory`; `render/stack-did-hyphenated-principal` ≡ `render/stack-did-first-hyphen-victim`); the subject-encoding collision pair (`encode/segment-dash-dot` ≡ `encode/segment-dot-dash`); and the accepted-but-undecided degenerate form (`did/degenerate-trailing-hyphen-accepted`).

**`invalid.json`** (rejection set; each carries a stable `reason` token):

```json
[
  {
    "id": "stack-id/no-separator",
    "rfc": 1,
    "kind": "parseStackId",
    "input": "andreas",
    "expect": { "ok": false, "reason": "missing-separator" },
    "why": "A missing stack segment is a FAULT, never a `default`. THE '/default' FABRICATION REJECTED. Root cause of cortex#1812."
  },
  {
    "id": "stack-id/too-many-segments",
    "rfc": 1,
    "kind": "parseStackId",
    "input": "andreas/meta/factory",
    "expect": { "ok": false, "reason": "too-many-segments" },
    "why": "A stack-id is exactly principal-id '/' stack-slug — one separator, two segments."
  },
  {
    "id": "did/consecutive-hyphen",
    "rfc": 1,
    "kind": "validateDid",
    "input": "did:mf:a--b",
    "expect": { "ok": false, "reason": "consecutive-hyphen" },
    "why": "DID_RE's -(?!-) lookahead forbids `--` in the method-specific-id — the precondition the (false) injectivity claim rests on."
  },
  {
    "id": "did/uppercase",
    "rfc": 1,
    "kind": "validateDid",
    "input": "did:mf:Echo",
    "expect": { "ok": false, "reason": "non-lowercase-charset" },
    "why": "The method-specific-id alphabet is lowercase; an uppercase leading letter is rejected."
  },
  {
    "id": "did/wrong-method",
    "rfc": 1,
    "kind": "validateDid",
    "input": "did:web:example",
    "expect": { "ok": false, "reason": "wrong-method" },
    "why": "The method name MUST be `mf`. A did:web DID is not a did:mf DID."
  },
  {
    "id": "did/empty-msi",
    "rfc": 1,
    "kind": "validateDid",
    "input": "did:mf:",
    "expect": { "ok": false, "reason": "empty-msi" },
    "why": "The deployed grammar requires a method-specific-id of length >= 2 (DID_RE's leading char plus at least one `+` char)."
  }
]
```

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Defines the identifier terminals (`principal-id`, `stack-slug`, `stack-id`, `agent-id`, `service-id`, `hub-id`) from the live regexes; defines the `did:mf` method per DID Core §8 with `method-specific-id` as a TBD placeholder blocked on cortex#1880; records the flat-namespace class collision, the first-hyphen decode, the subject-encoding non-injectivity, the lossy mint, the degenerate forms, rotation/revocation and NKey-reuse gaps as findings; ships the starter vector set. |

## Acknowledgments

This draft is grounded in a wire-protocol audit of `myelin@origin/main` and `cortex@origin/main`. The class-collision proof and the encoding counterexamples were verified by execution against the live regexes.

## Authors' Addresses

Luna (drafting agent), on behalf of Andreas — metafactory.
Ratification signatories (required, not yet collected): Andreas (principal); JC (hub custodian).

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
