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
signatories: []                 # Ratification REQUIRES: the principal (Andreas) AND the hub custodian (JC).
                                # The decisions recorded in this revision were ratified by Andreas on
                                # 2026-07-12 (grill log wf_b5c856a1-6d4, D1-D26); pending JC co-signature.
created: 2026-07-12
ratified: null
grammar: specs/grammar/identifiers.abnf
vectors: specs/vectors/identifiers/
generated:                      # DERIVED from `grammar`; regenerated at the flag-day cutover (§9),
                                # BLOCKED until this document is Ratified (two signatures)
  - schemas/envelope.schema.json          # the 6 did:mf pattern sites (wallet, target_assistant, originator.identity, stamp identity ×2, stamped_by)
  - src/identity/types.ts                 # DID_RE — replaced wholesale at the cut (§9)
supersedes_prose:
  - docs/identity.md                      # the identifier / DID model only; the agent-identity key-management subsystem stays undocumented (see §1)
---

# RFC-0001: Identifiers and Identity (the did:mf DID Method Specification)

## Abstract

This document specifies the identifiers of the myelin wire protocol: the single kebab-strict segment alphabet every metafactory identifier is built from, and the `did:mf` Decentralized Identifier (DID) method that names an identity on the wire. It is the foundational document of the RFC series — the terminal alphabets defined here are referenced by every other myelin RFC. It records the ratified identity model: **six identity classes on two planes** — four *keyed* classes (`principal`, `stack`, `agent`, `hub`) that hold an Ed25519 key and may appear in a verified `signed_by[]` chain, and two *self-asserted* classes (`surface`, `system`) that hold no key and appear in `originator` only — rendered in a **class-explicit dot-form** method-specific-id whose class tag always occupies position 0. The dot-form, together with the kebab-strict segment rule, makes the NATS subject-plane encoding injective by grammar, closing the collision findings the initial draft proved against the deployed flat namespace. The document also specifies a deliberately minimal, honest v1 DID method (plane-aware resolution to a minimal DID Document; register-once lifecycle with no wire-visible rotation and no revocation) and a **hard-cut migration** from the deployed flat form: one coordinated flag-day release, no dual-accept window. The decisions recorded here were ratified by the principal and are pending the hub custodian's co-signature; the document remains Draft until both signatures are recorded.

## Status of This Memo

This is a **metafactory** RFC. It is not an IETF document and carries no IETF status.

This document is `Draft`. Only a document with status `Ratified` is normative. Implementations MUST NOT ground behaviour on a `Draft` or `Proposed` document. The former TBD placeholder on the `method-specific-id` grammar (§6.2) is resolved in this revision — the class-explicit dot-form is recorded as the ratified grammar — but the resolution is **pending JC co-signature**: the decisions were ratified by the principal (Andreas) on 2026-07-12 and the document stays `Draft` until the hub custodian (JC) co-signs. No emitter flips to the new form before ratification and the flag-day cutover of §9.

A `Ratified` RFC is **immutable**. It is never edited in place. Corrections and changes are published as a new RFC carrying `Updates: NNNN` or `Obsoletes: NNNN` in its front matter.

Ratification requires the signature of **the principal** (Andreas) and **the hub custodian** (JC), recorded in `signatories`. A wire contract binds more than one party; it cannot be ratified by one.

The authoritative index of RFCs, their numbers and their statuses is [`specs/README.md`](../README.md).

## Copyright and License

Copyright the metafactory contributors. Licensed under the terms in [`LICENSE`](../../LICENSE).

## Table of Contents

<!-- Generated. Keep section numbering stable across revisions of a Draft;
     once Ratified, numbering is frozen forever (citations point at it).
     Revision 2 inserted §9 (Migration); Privacy/Conformance/References
     renumbered 9→10, 10→11, 11→12 — logged in Appendix C. -->

1. Introduction
2. The Identity Model
3. Identifier Terminals
4. Rendering Identities as DIDs
5. The Subject-Plane Encoding
6. The did:mf DID Method Specification
7. Registry Considerations
8. Security Considerations
9. Migration (the Hard Cut)
10. Privacy Considerations
11. Conformance
12. References
Appendix A. Collected ABNF
Appendix B. Test Vectors
Appendix C. Change Log

---

## 1. Introduction

Every signed message on the myelin bus carries identity. A `signed_by` stamp names who attested it; an `originator` names on whose behalf; `target_assistant` names the recipient; `economics.wallet` names who pays; a NATS subject may embed the recipient's identity as a routing segment; and the NATS user that connected the transport is itself a DID. All of these are the same kind of string: a `did:mf:<method-specific-id>`.

That string had, until this revision, exactly one definition in the entire codebase — a single regular expression, `DID_RE`, at `src/identity/types.ts:1`, hand-copied verbatim to six pattern sites in `schemas/envelope.schema.json` and six more in cortex's vendored copy of that schema — with no ABNF, no class model, no resolution contract, and no conformance vector. The initial draft of this document recorded that condition and proved the collisions it permits. This revision records the resolution: the grammar of record is [`specs/grammar/identifiers.abnf`](../grammar/identifiers.abnf), the class-explicit dot-form is the ratified method-specific-id, and `DID_RE` (with the twelve hand-copied pattern sites) is regenerated from the grammar at the flag-day cutover (§9, front-matter `generated`).

**What this document specifies.** The single `segment` terminal alphabet (kebab-strict) and the per-class terminals built on it (`principal-id`, `stack-slug`, `stack-id`, `assistant-id`, `network-id`/`hub-id`, `surface-id`, `system-id`); the two-plane, six-class identity model (§2); the `did:mf` DID method per W3C DID Core §8 [DID-CORE], including the resolved class-explicit method-specific-id grammar (§6.2), plane-aware resolution, and the minimal v1 lifecycle (§6.3); the identifier-level property of the subject-plane encoding (§5); and the hard-cut migration from the deployed flat form (§9).

**What this document does not solve.** It does not specify the bytes-to-sign, canonicalization, or chain-verification contract — those belong to RFC-0004 (signing) and are referenced here only where DID resolution touches them; in particular the byte-exact signing invariant is cited from RFC-0004, not duplicated here. It does not specify subject composition — that is RFC-0002; the federated-subject length blow-up (an agent DID repeating a `{principal}.{stack}` pair a subject may already carry) is likewise deferred to RFC-0002's short-form decision, with this document setting only the length caps (§6.2). It does not specify the agent-identity key-management subsystem (`src/agent-identity/`: Ed25519 generation, rotation, and encrypted-at-rest storage); that subsystem ships code today with no documentation home, and `docs/identity.md:238-240` erroneously declares it out of scope while the code exists. Documenting it is left to a future RFC; this document records, in §8.7, that rotation and revocation are explicit v1 limitations with no wire-visible semantics.

**Prose promoted to normative.** This document supersedes the identifier and DID content of the informative `docs/identity.md` (listed in `supersedes_prose`). It does not promote that document's "Out of Scope" section, which is contradicted by shipped code.

### 1.1. Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

> **For agents:** a sentence is normative **only** when it contains one of the above keywords in all capitals. Lowercase "must" is prose. Do not treat explanatory text as a requirement. This document deliberately describes several behaviours it does **not** endorse (the pre-cut flat namespace, its collisions, and the retired decoders); those descriptions are written in lowercase precisely so they are not read as requirements.

### 1.2. Terminology

This document defines the following terms. Terms defined in a sibling RFC are cited, not redefined.

- **Identity class** — one of the six kinds of entity a DID may name: *principal*, *stack*, *agent*, *hub* (the keyed plane), *surface*, *system* (the self-asserted plane). The class is carried by the **class tag** at method-specific-id position 0 and is recoverable from the DID string by construction (§2.1, §6.2).
- **Keyed class** — an identity class whose members hold an Ed25519 keypair, are registered in the keyed identity registry, resolve to a DID Document (§6.3), and may appear in a `signed_by[]` stamp.
- **Self-asserted class** — an identity class whose members hold **no** key, appear in `originator` only, and are explicitly non-resolvable (§6.3). A verifier MUST NOT resolve a self-asserted DID in the keyed registry (§2.1).
- **principal** — the owner of one or more stacks; the sovereignty boundary. Named as a DID by `did:mf:principal.{principal-id}`.
- **stack** — one deployment belonging to a principal. Named in config/registry positions by a `stack-id` (`{principal-id}/{stack-slug}`); named as a DID by `did:mf:stack.{principal-id}.{stack-slug}` (§4).
- **agent** — an assistant. Named as a DID by the fully-qualified `did:mf:agent.{principal-id}.{stack-slug}.{assistant-id}`: an agent DID names *which stack's* assistant it is, by construction (§2.2).
- **hub** — a network hub. Named as a DID by `did:mf:hub.{network-id}`; `hub-id` **is** `network-id` — one hub per network, unique by construction (§3.4).
- **surface** — an external trust-anchor (e.g. `github`, `discord`, `slack`). Self-asserted.
- **system** — an internal non-keyed originator (e.g. `reflex`, `signal-tap`). Self-asserted.
- **DID** — a Decentralized Identifier per [DID-CORE]. A `did:mf` DID is `did:mf:` followed by a `method-specific-id`.
- **method-specific-id** (msi) — the part of a DID after `did:mf:`. Its grammar is the class-explicit dot-form of §6.2 (Appendix A rule `method-specific-id`): a class tag, then `.`-separated segments at the tag's arity. `.` is the sole separator.
- **class tag** — the first `.`-delimited token of a method-specific-id, drawn from the closed registry of §7 (Appendix A rule `class-tag`). Validation is fail-closed: an unregistered tag is a reject.
- **DID subject segment** — the `@`-prefixed NATS subject token that encodes a DID for direct routing (§5, Appendix A rules `did-subject-segment` / `encoded-msi`). The encoding is co-owned with RFC-0002.
- **mint** — the act of rendering a non-DID identifier (a `stack-id`, a config name) into a DID.
- **flag-day release R** — the single coordinated release at which every emitter flips from the legacy flat form to the class-explicit dot-form (§9). There is exactly one; the migration is a hard cut.
- **runtime guard** — an identity invariant enforced by an executable check at a consumer, not by the grammar. The initial draft recorded several (per the scaffold's rule 6); this revision closes most of them by grammar, and §8 records each closure.

Terms defined elsewhere: **subject**, **classification prefix**, **`@`-assistant segment composition** (RFC-0002); **envelope**, **`signed_by` chain**, **canonical bytes**, **stamp** (RFC-0003 and RFC-0004).

---

## 2. The Identity Model

### 2.1. Two planes, six classes

The system names six classes of entity, split across two planes by one criterion: **whether the identity holds an Ed25519 key**.

| Class tag | Plane | DID form | Arity after tag | Example |
|---|---|---|---|---|
| `principal` | keyed | `did:mf:principal.{principal-id}` | 1 | `did:mf:principal.andreas` |
| `stack` | keyed | `did:mf:stack.{principal-id}.{stack-slug}` | 2 | `did:mf:stack.andreas.meta-factory` |
| `agent` | keyed | `did:mf:agent.{principal-id}.{stack-slug}.{assistant-id}` | 3 | `did:mf:agent.andreas.meta-factory.luna` |
| `hub` | keyed | `did:mf:hub.{network-id}` | 1 | `did:mf:hub.metafactory` |
| `surface` | self-asserted | `did:mf:surface.{surface-id}` | 1 | `did:mf:surface.github` |
| `system` | self-asserted | `did:mf:system.{system-id}` | 1 | `did:mf:system.reflex` |

**The keyed plane** (`principal`, `stack`, `agent`, `hub`): these identities hold an Ed25519 keypair, are registered in the keyed identity registry, resolve per §6.3 to a minimal DID Document, and are the only classes that MAY appear as a `signed_by[].identity`. A `signed_by[].identity` whose class tag is not a keyed-plane tag MUST be rejected.

**The self-asserted plane** (`surface`, `system`): these identities hold **no** key. `surface` names external trust-anchors (`github`, `discord`, `slack`) whose assertions are anchored outside the bus; `system` names internal non-keyed originators (`reflex`, `signal-tap`). A self-asserted DID MAY appear in `originator` and MUST NOT appear in `signed_by[]`. A verifier MUST NOT resolve a self-asserted DID in the keyed registry: there is no key to find, and a lookup that treats its absence as an anomaly manufactures exactly the `unknown_agent` fault class this rule exists to kill (§6.3; vector `inv/resolve-self-asserted`).

The class tag occupies method-specific-id position 0 in every DID, so the class **is** recoverable from the DID string, by construction. An implementation MUST derive an identity's class from its class tag and its arity (§6.2) and MUST NOT infer class from any other feature of the string. This inverts — and closes — the initial draft's flat-namespace finding, under which `did:mf:andreas-meta-factory` was simultaneously a valid principal, stack, and agent DID (§8.1).

Three corrections to the pre-decision folk taxonomy are recorded here:

- **`did:mf:public` is a principal, not a system identity.** It maps to `did:mf:principal.public` at the cut (§9): a *real, keyed* principal. The name `public` is reserved in §7 as a principal name, not as a tag.
- **`wallet` is a role, not a class.** RFC-0009's wallet is a role any DID can carry; there is no `wallet` tag, and the name is reserved in §7 precisely so it can never be minted as one (vector `inv/wallet-reserved-not-a-tag`).
- **`service` is not a class.** The pre-cut `IdentityType` value `"service"` covered internal taps; those are `system`-class. The `IdentityType` enum (`src/identity/types.ts:6`, previously `{agent, service, hub}`; enforced at `VALID_TYPES`, `src/identity/registry.ts:86`) is widened to the six-tag set. This also fixes a live bug: a resolved peer principal could only be stored as `type: "agent"` (cortex `identity-registry.ts:362`); it is stamped `type: "principal"` from the cut.

### 2.2. What is signed vs. what is asserted

Two envelope positions carry identity with different trust weight:

- `signed_by[].identity` — the **verified** attestor DID. Cryptographically bound, and keyed-plane only (§2.1).
- `source`, `originator.identity` — **self-asserted** routing/attribution DIDs. Covered by the signer's signature (the signer commits to the claim) but not themselves key-backed. Any class may appear here; the self-asserted classes may appear *only* here.

This revision adds one normative binding between the two positions, closing (for the agent class) the initial draft's finding that nothing tied a self-asserted originator to the verified chain:

**Agent prefix binding.** An `agent`-class originator's `{principal-id}.{stack-slug}` prefix MUST equal the method-specific-id tail of the innermost signing stack. `did:mf:agent.andreas.meta-factory.luna` is acceptable as an originator only in an envelope whose innermost signer is `did:mf:stack.andreas.meta-factory`; the same originator over a `did:mf:stack.jc.forge` signature is a cross-stack impersonation and MUST be rejected. The binding is checked against the signature chain, never against the originator's self-description. (Vectors `bind/agent-prefix-accept`, `bind/agent-prefix-reject`; the semantic constraint is recorded as a comment in the grammar, since arity-crossing equality is not expressible in ABNF.)

`surface`- and `system`-class originators remain purely self-asserted: the signer commits to the claim, and no key-backed check exists or is implied. The bytes-to-sign and chain-verification contract itself belongs to RFC-0003 / RFC-0004 and is not restated here.

---

## 3. Identifier Terminals

The terminals in this section are the normative subject of this RFC. Each is given once, as an ABNF rule, and is the single source of truth referenced by RFC-0002 and RFC-0003. The grammar of record is [`specs/grammar/identifiers.abnf`](../grammar/identifiers.abnf); Appendix A reproduces it.

There is now **one segment alphabet** — the kebab-strict `segment` rule — shared by every class. Class disambiguation is carried by the tag at method-specific-id position 0 (§6.2), never by per-class alphabet differences.

**The `segment` rule.** A segment MUST match `segment` of Appendix A (`segment = lower *seg-alnum *( "-" 1*seg-alnum )`):

- first character a lowercase letter;
- then lowercase letters, digits, and single *interior* hyphens;
- NO `_`, NO uppercase, NO trailing `-`, NO consecutive `--` (kebab-strict);
- 1–63 octets per segment. The octet bound is a separate normative constraint alongside the structural rule (ABNF cannot carry both in one rule without expansion); the generated regex is `/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,62}$/`.

Comparison is **byte-exact**: no case-folding, no Unicode normalization, no trimming. A non-conforming string is rejected, never repaired by normalization (vector `inv/uppercase`). This document cites RFC-0004 for the byte-exact signing invariant and does not duplicate it.

The kebab-strict edge rules are load-bearing: because no segment starts or ends with `-`, a `-` is never adjacent to a `.` in a valid DID, and that is the precondition under which the subject-plane encoding of §5 is injective. Dot-separation alone is necessary but NOT sufficient (§5).

### 3.1. `principal-id`

A `principal-id` MUST match the `principal-id` rule of Appendix A: `principal-id = segment`.

This supersedes `PRINCIPAL_RE` (`src/patterns.ts:35`, `/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/`), which is **tightened** at the cut: `PRINCIPAL_RE` permits interior `--` (its only edge rules are leading-letter and no-trailing-hyphen), which kebab-strict forbids; and its 2–64 octet window is replaced by the uniform 1–63 (maximum tightens 64 → 63; minimum widens 2 → 1). The initial draft's observation that a subject-legal `principal-id` was not necessarily DID-legal is thereby closed: every valid `principal-id` is now a valid DID segment by identity of the rules.

### 3.2. `stack-slug`

A `stack-slug` MUST match the `stack-slug` rule of Appendix A: `stack-slug = segment`.

This **retracts** the initial draft's "a stack-slug MAY end in a hyphen." `STACK_SEGMENT_REGEX` (`src/segment-validators.ts:27`, `/^[a-z][a-z0-9-]{0,62}$/`) permits a trailing `-` and consecutive `--`; both are forbidden under kebab-strict and the regex is tightened at the cut (vector `inv/trailing-hyphen`). Zero live slugs violate the tightened rule (verified in the decision log), so the tightening is deploy-safe. The `principal-id`/`stack-slug` grammar divergence recorded as finding §8.6 no longer exists: the two rules are the same rule.

### 3.3. `stack-id`

A `stack-id` MUST match `principal-id "/" stack-slug`. The `/` separator is REQUIRED.

A parser that is given a bare `principal-id` with no `/` MUST reject it as a fault. It MUST NOT fabricate a `default` (or any other) stack slug. This is the direct codification of cortex#1812, in which a missing stack segment was silently fabricated into `default`, and the defect was masked for two days because one deployment's stack was in fact named `default`. The round-trip and its masking companion are pinned by vectors (`stack-id/non-default-slug`, `stack-id/literal-default-slug-masking`).

A `stack-id` is a **config/registry form, never a wire DID**. The wire form of the same identity is the `stack-msi` of §6.2 (`did:mf:stack.{principal-id}.{stack-slug}`); the legacy `/`→`-` mint that used to bridge the two is retired (§4).

### 3.4. `assistant-id`, `network-id` / `hub-id`, `surface-id`, `system-id`

Each of the remaining per-class terminals is the `segment` rule:

- **`assistant-id`** — the `{assistant}` name of an agent-class identity, the third msi segment after the tag.
- **`network-id` / `hub-id`** — `hub-id` **is** `network-id`, by construction: one hub per network, and `network_id` is the registry primary key, so hub DIDs are unique without further machinery. Multi-hub is a future extension behind a real hub roster (none exists today).
- **`surface-id`**, **`system-id`** — the names of the two self-asserted classes.

The initial draft's `agent-id` and `service-id` rules are **removed**. `agent-id` (a bare, unqualified assistant name minted directly into the flat namespace) is replaced by the fully-qualified `agent-msi`; `service-id` is removed because *service is not a class* — internal non-keyed originators are `system`-class (§2.1). The draft's finding that the interactive classes had "no distinct terminal alphabet" is closed the other way round: every class now shares the one deliberate alphabet, and the class distinction lives in the tag, where it is recoverable.

---

## 4. Rendering Identities as DIDs

Rendering is now normative and uniform: every identity is rendered by prefixing `did:mf:`, writing its class tag, and appending its segments in tag-arity order, `.`-separated (§6.2). There is exactly one rendering per identity and it is injective across classes — two distinct identities of any classes never render to the same DID, because the tag disambiguates the class and the arity-bound dot-form disambiguates the structure.

- a principal `andreas` renders to `did:mf:principal.andreas` (vector `did/principal`);
- a stack `andreas/meta-factory` renders to `did:mf:stack.andreas.meta-factory` (vector `did/stack`);
- an assistant `luna` of that stack renders to `did:mf:agent.andreas.meta-factory.luna` (vector `did/agent-fq`);
- the hub of network `metafactory` renders to `did:mf:hub.metafactory` (vector `did/hub`);
- the GitHub surface renders to `did:mf:surface.github` (vector `did/surface`);
- the reflex tap renders to `did:mf:system.reflex` (vector `did/system-reflex`).

**The legacy mints are retired.** The initial draft documented, as findings, the pre-cut rendering: `peerDid()`'s bare `did:mf:{principal-id}`, and the stack mint at cortex `cortex.ts:1025-1027` (`stack.id.replace("/", "-").replace(/-+/g, "-")` — replace `/` with `-`, collapse hyphen runs). That mint produced three proven defects: the principal/stack collision (`did:mf:andreas-meta-factory` byte-identical across classes), the first-hyphen mis-decode (`did:mf:meta-factory-dev` attributed to principal `meta` by cortex `review-consumer.ts:1454`), and the lossy `-+`→`-` collapse (distinct stack ids `a-b/c` and `a/b-c` minting the same DID). Under the class-explicit dot-form none of these strings is well-formed — the flat form fails at position 0 (not a registered tag) and is rejected at decode (vector `inv/legacy-classless`) — and none of the colliding inputs is mintable, because `/` never becomes `-` and no hyphen ever plays separator. §8.1, §8.2 and §8.4 record the closures.

From flag-day release R (§9), an implementation MUST render each identity exactly as specified here and MUST NOT emit or accept the legacy flat form. Pre-cut identities are carried over by the §9 mapping (`reflex` → `system.reflex`, `signal-tap` → `system.signal-tap`, `public` → `principal.public`).

---

## 5. The Subject-Plane Encoding

A DID is embedded in a direct-routing NATS subject as an `@`-prefixed segment. The encoding function `encodeDidSegment` (`src/subjects.ts:124-129`) maps `:`→`-` and `.`→`--`, passes every other octet through verbatim, and prefixes `@` (Appendix A rules `did-subject-segment`, `encoded-msi`):

```
did:mf:agent.andreas.meta-factory.luna  ⟷  @did-mf-agent--andreas--meta-factory--luna
```

**Injectivity — with its precondition stated.** The initial draft proved that this encoding was *not* injective over the deployed grammar (`did:mf:a-.b` and `did:mf:a.-b` both encoded to `@did-mf-a---b`), falsifying the "reversible, injective" claim in `docs/identity.md` and `specs/namespace.md`. Under this revision the encoding **is** injective, but the property MUST be cited with its precondition: dot-separation is necessary but NOT sufficient. It is the kebab-strict segment rule — no segment starts or ends with `-` — that guarantees a `-` is never adjacent to a `.` in a valid DID, so every `--` in an encoded segment decodes to `.` and nothing else. The bare "`.` → injective" claim is exactly the false claim the draft caught; do not cite it. (The colliding pair above is unmintable under §3; the round-trip is pinned by vectors `encode/agent-roundtrip-out` and `decode/agent-roundtrip-back`, verified by execution.)

**`decodeDidSegment` is normative.** The inverse — split the encoded msi on `--`, rejoin with `.` — is total and injective on the language of §6.2, and is specified as the one decoder (the full `parse`/`render`/`encode`/`decode` codec is normative and vector-bound; consumers use the vendored myelin codec rather than hand-rolling splices). This retires the unsound first-hyphen decoder (cortex `review-consumer.ts:1454`), whose "the wire grammar forbids hyphenated principals" premise no grammar ever enforced.

**Atomic coupling.** The envelope-field DID and the subject `@`-segment derive from this ONE source (`src/subjects.ts:124`); they are never composed independently. Consequently they flip **together** at the hard cut: RFC-0001 and RFC-0002 cut over atomically, per emitter, and MUST NOT be sequenced independently (§9).

Composition of the `@`-segment into a full subject is specified by **RFC-0002**; this document specifies only the identifier-level property. The federated-subject length blow-up (an agent DID repeating a `{principal}.{stack}` pair the subject may already carry) is RFC-0002's short-form call; this document only sets the length caps (§6.2).

---

## 6. The did:mf DID Method Specification

This section follows the structure required of a DID method specification by W3C DID Core §8 [DID-CORE]: method name, method-specific identifier syntax, and the CRUD operations, plus method-level Security and Privacy Considerations (which are folded into the document-level §8 and §10 as the scaffold requires).

### 6.1. Method Name

The method name that identifies this DID method is `mf`.

A DID that uses this method MUST begin with the prefix `did:mf:`. The prefix MUST be lowercase (`did-prefix`, Appendix A).

### 6.2. Method-Specific Identifier

**[RESOLVED — 2026-07-12 — cortex#1880 → Candidate C, class-explicit `.`; pending JC co-signature]**

The normative grammar of `method-specific-id` is the **class-explicit dot-form** (Appendix A rule `method-specific-id`):

```abnf
method-specific-id = principal-msi / stack-msi / agent-msi
                   / hub-msi / surface-msi / system-msi

principal-msi   = %s"principal" "." principal-id
stack-msi       = %s"stack" "." principal-id "." stack-slug
agent-msi       = %s"agent" "." principal-id "." stack-slug "." assistant-id
hub-msi         = %s"hub" "." network-id
surface-msi     = %s"surface" "." surface-id
system-msi      = %s"system" "." system-id
```

- **`.` is the SOLE separator.** It is forbidden inside every segment (§3), so the field structure is unambiguous by construction.
- **The class tag is ALWAYS at position 0** and MUST be drawn from the closed registry of §7. Validation is **fail-closed**: an unregistered tag is a reject, never a pass-through (vectors `inv/unknown-tag`, `inv/legacy-classless`, `inv/wallet-reserved-not-a-tag`).
- **Arity is bound to the tag** by the alternation above (principal 1, stack 2, agent 3, hub 1, surface 1, system 1 segments after the tag). A parser MUST reject an arity mismatch and MUST NOT discard trailing structure it does not understand (vectors `inv/agent-arity-short`, `inv/principal-arity-long`).
- **Wire form is the bare DID.** A DID appears bare at every wire position — no DID-URL path, query, or fragment. Fragments occur ONLY as `verificationMethod` ids inside a *resolved* DID Document (§6.3), never on the wire (vectors `inv/did-url-fragment`, `inv/did-url-path`, `inv/did-url-query`).
- **Length.** Each segment is 1–63 octets (§3). The whole method-specific-id MUST NOT exceed 255 octets — a pre-parse bound on the DNS-name precedent. Under the per-class arities the structural maximum is 197 octets (agent class: the 5-octet tag + 3 dots + three 63-octet segments), so the ceiling never binds well-formed input; it exists so an implementation MAY reject oversize input before structural parsing. The whole-DID maximum is 262 octets (`did:mf:` + 255). (Vector `inv/segment-too-long` pins the per-segment bound at exactly 64 octets.)
- **Generated regex** (SEG = the segment regex of §3): `/^did:mf:(?:principal\.SEG|stack\.SEG\.SEG|agent\.SEG\.SEG\.SEG|hub\.SEG|surface\.SEG|system\.SEG)$/`.

This grammar supersedes `DID_RE` (`src/identity/types.ts:1`, `/^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/`) **wholesale**. `DID_RE` was classless and flat — it permitted `_`, interior/trailing `.` and `_`, degenerate forms (`did:mf:a-`), had no length bound, and could not recover the class. From flag-day release R (§9) the legacy classless form is rejected at decode.

For the record, of the four candidates the initial draft presented: **Candidate A** (forbid-hyphen) was shown insufficient before the decision — hyphenated names share the namespace and deployed principals already contain hyphens; **Candidate B** (new-separator) was subsumed by C, since `.` *is* a separator illegal in every base alphabet without requiring a new character; **Candidate C** was selected; **Candidate D** (keep-runtime-guard) was rejected as an invariant held by vigilance, not design. The degenerate-form and length questions the draft left open alongside the grammar (former §8.5) are settled by the same edit.

### 6.3. DID Operations

W3C DID Core requires a method to define Create, Read (Resolve), Update, and Deactivate. `did:mf` v1 defines a deliberately **minimal, honest** subset: creation is register-once, resolution is plane-aware, and rotation and revocation are explicitly not supported on the wire (§8.7). This document states the limitations rather than gesturing at machinery that does not exist.

- **Create.** A keyed-plane DID is created by registering the identity's Ed25519 public key in the keyed identity registry, exactly once. Registration MUST be controller-authorized (per the controller table below), and re-registration of an existing DID MUST be refused. This replaces the pre-cut last-write-wins `add()` (`src/identity/registry.ts:52-53`), whose displacement hazard was finding §8.1. A registry record whose `id` is not a syntactically valid DID MUST be rejected (enforced today at `registry.ts:95`). Self-asserted DIDs are not created in any registry: they are minted at the emitter and carry no key.
- **Read (Resolve).** Resolution is **plane-aware**:
  - A **keyed-plane** DID resolves to a minimal [DID-CORE]-conforming DID Document, derived at resolution time from the registry's `Identity` record (no schema or registry change): the document carries exactly one `verificationMethod` of type `Ed25519VerificationKey2020` (its fragment id is the only place a fragment ever appears, per §6.2), and a `controller` per class:

    | Class | Controller |
    |---|---|
    | `principal` | itself |
    | `stack` | its principal |
    | `agent` | its stack |
    | `hub` | itself |

    The verification key so resolved is the key consumed by the envelope-signing verification path (RFC-0004). Resolution is keyed by the exact DID string, byte-for-byte: a resolver MUST NOT canonicalize, case-fold, or otherwise rewrite the DID before lookup. Because the class tag is part of the string, cross-class displacement at the lookup key is no longer constructible (§8.1).
  - A **self-asserted** DID (`surface`, `system`) is explicitly **non-resolvable**. A verifier MUST NOT resolve it in the keyed registry; an attempted resolution is itself the fault (`self-asserted-class-non-resolvable`), not the absence of a result (vector `inv/resolve-self-asserted`).
- **Update (rotation).** There is **no wire-visible key rotation in v1**. A key swap is a local operation on disk (`src/agent-identity/rotate.ts` records `previous_public_key` + `rotated_at`); no verification path consults the previous key, no grace window exists for in-flight envelopes, and no propagation protocol carries the new key to resolvers. The former draft language allowing an update "unless authorized rotation" is dropped as unenforceable in v1. Rotation with wire semantics is deferred to a future RFC (§8.7).
- **Deactivate (revocation).** **Not supported.** There is no revocation and no specified lifecycle for a compromised key in v1 (§8.7).

---

## 7. Registry Considerations

- **RFC number.** This document is allocated number 0001 in [`specs/README.md`](../README.md). Numbers are never reused.
- **DID method name.** This document reserves the DID method name `mf` for the metafactory identity namespace. **Decision (2026-07-12): `mf` is NOT registered in the [W3C DID Specification Registries][did-registries] for v1.** The ecosystem is private, and a registry entry is permanent and public; the internal reservation here is sufficient. Revisiting the registration is a joint Andreas + JC call, triggered only by a genuine public-interoperability need.
- **The class-tag registry (CLOSED).** The complete set of class tags is: `principal`, `stack`, `agent`, `hub` (keyed plane); `surface`, `system` (self-asserted plane) — the `class-tag` rule of Appendix A. The grammar is closed and validation is **fail-closed**: a tag not in this registry MUST be rejected (vector `inv/unknown-tag`). A new tag enters only by registry amendment — a ratified RFC change carrying `Updates: 0001` — never by emitter fiat.
- **Reserved names** (names that MUST NOT be minted as class tags):
  - **`wallet`** — RFC-0009's wallet is a *role* over any DID, not an identity class. The name is reserved so it can never become a tag (vector `inv/wallet-reserved-not-a-tag`).
  - **`public`** — the name of a real, keyed principal (`did:mf:principal.public`), not a tag and not a system identity (vector `did/principal-public`).
- **Registered self-asserted names.** The synthetic originators already minted in production are carried into the class model at the cut (§9): `did:mf:system.reflex` (formerly `did:mf:reflex`, cortex `reflex-activation-listener.ts:68`) and `did:mf:system.signal-tap`. The initial draft's "sixth de-facto class with no reservation" flag is closed: `system` is a registered tag.
- **Reserved slug.** The stack slug `default` is **not** reserved as a sentinel and MUST NOT be treated as one. A stack may legitimately be named `default`; a missing stack segment is a distinct, rejected fault (§3.3). Conflating the two was the root cause of cortex#1812.
- **Terminal alphabets.** This document is the sole registrant of the identifier terminals `segment`, `principal-id`, `stack-slug`, `stack-id`, `assistant-id`, `network-id`, `hub-id`, `surface-id`, `system-id`. Other RFCs reference them from Appendix A and MUST NOT redefine them. The initial draft's `agent-id` and `service-id` registrations are withdrawn (§3.4). A capability-id is NOT a DID and is not registered here.

---

## 8. Security Considerations

REQUIRED. This document specifies identifiers that seed trust decisions (whose key verifies a stamp, whose scope a federated message routes to, which subscription a direct dispatch reaches). The initial draft recorded nine findings — invariants upheld by a runtime check, or by nothing, rather than by the grammar (the scaffold's rule 6). The decisions this revision records close most of them **by grammar or by method rule**; each subsection below restates the original hazard and how it is now resolved. One (§8.7) is not resolved but is converted from an undocumented gap into an explicit, stated v1 limitation; one (§8.8) is out of this document's scope and assigned.

### 8.1. Flat-namespace class collision → trust displacement — RESOLVED by the class tag + create-once

*The hazard:* six classes shared one flat namespace; `did:mf:andreas-meta-factory` was a valid principal, stack, and agent DID simultaneously; the registry's last-write-wins `add()` (`src/identity/registry.ts:52-53`) let a colliding peer-principal write displace a boot stack anchor in the exact registry the verifier consumes; the only defence was a per-consumer runtime guard.

*Resolved:* the class tag at msi position 0 makes class recoverable from the string, so a cross-class collision is no longer constructible — two DIDs of different classes differ at position 0 by construction (§2.1, §6.2). Independently, Create is now register-once with re-registration refused (§6.3), so even a same-class equal string cannot displace an existing anchor. The runtime guard is thereby demoted from load-bearing to defence-in-depth. The legacy colliding string itself is rejected at decode (vector `inv/legacy-classless`).

### 8.2. First-hyphen decode is unsound — RESOLVED by retiring the decoder and the mint

*The hazard:* the stack-DID mint used `-` as the `{principal}/{stack}` separator while `-` was legal inside a `principal-id`; the first-hyphen decoder (cortex `review-consumer.ts:1454`) mis-attributed `did:mf:meta-factory-dev` to principal `meta`, silently corrupting federated provenance.

*Resolved:* `.` is the sole separator and is illegal inside every segment (§3, §6.2), so field recovery never depends on a hyphen. The first-hyphen decoder and the `/`→`-` mint (cortex `cortex.ts:1025-1027`) are both retired at the cut (§4, §5); `decodeDidSegment` — splitting the encoded msi on `--` — is the one normative decoder and is total and injective on the language of §6.2 (vector `decode/agent-roundtrip-back`). An interior hyphen (as in `meta-factory` or `signal-tap`) passes through both planes verbatim and never plays separator (vector `did/system-signal-tap`).

### 8.3. Subject-encoding non-injectivity — RESOLVED by the kebab-strict precondition

*The hazard:* `encodeDidSegment` was not injective over the deployed grammar (`did:mf:a-.b` and `did:mf:a.-b` collided onto `@did-mf-a---b`), so two distinct assistants could share a direct-routing subscription; the injectivity claim in `docs/identity.md` / `specs/namespace.md` was false.

*Resolved:* under kebab-strict no segment starts or ends with `-`, so `-` is never adjacent to `.` in a valid DID; therefore every `--` in an encoded segment decodes unambiguously to `.` and the encoding is injective (§5). Both members of the old colliding pair are now unmintable (segment-edge hyphens are rejected — vector `inv/trailing-hyphen`). The precondition MUST accompany the claim: it is the kebab-strict rule, not dot-separation alone, that carries the property.

### 8.4. Lossy stack-DID mint — RESOLVED by structure-preserving rendering

*The hazard:* the `-+`→`-` collapse in the legacy mint mapped distinct stack ids (`a-b/c`, `a/b-c`) to the same signing DID.

*Resolved:* the mint is retired. A stack renders to `did:mf:stack.{principal-id}.{stack-slug}` with the `/` boundary preserved as a `.` (§4); no characters are rewritten or collapsed, so the rendering is trivially injective on stack ids.

### 8.5. Degenerate and unbounded method-specific-ids — RESOLVED by the segment alphabet + length ceilings

*The hazard:* the deployed grammar accepted trailing `-`/`.`/`_`, consecutive `..`/`._`, and unbounded length (a 507-character DID validated), while a DID is embedded in NATS subjects, KV keys, and file paths.

*Resolved:* the segment alphabet forbids `_` entirely and forbids trailing or consecutive separators (§3; vectors `inv/underscore`, `inv/trailing-hyphen`, `inv/double-hyphen`, `inv/empty-segment`); segments are bounded at 1–63 octets (vector `inv/segment-too-long`), the whole msi at 255 octets pre-parse (structural maximum 197), and the whole DID at 262 (§6.2). No degenerate form encodes to a subject token with edge `--`, and no unbounded token exists to embed.

### 8.6. Divergent segment grammars — RESOLVED by the single `segment` rule

*The hazard:* `principal-id`, `stack-slug`, and the first segment of an envelope `source` were governed by three regexes disagreeing on trailing hyphens, length, and minimum size.

*Resolved:* there is one segment alphabet; every per-class terminal is defined as `segment` (§3). The three live regexes are tightened onto it at the cut — `PRINCIPAL_RE` (`src/patterns.ts:35`: forbid `--`; 2–64 → 1–63), `STACK_SEGMENT_REGEX` (`src/segment-validators.ts:27`: lose the trailing hyphen and `--`), and `DID_RE` (`src/identity/types.ts:1`: replaced wholesale by the generated whole-DID regex). A string valid in one position is valid in every segment position, by identity of the rules.

### 8.7. Rotation and revocation have no wire-visible lifecycle — EXPLICIT v1 LIMITATION

*Not resolved — stated.* v1 of this method has **no wire-visible key rotation and no revocation** (§6.3): Create is register-once; a key swap is local-only (`previous_public_key` is consulted by no verifier); a rotated-out or compromised key is indistinguishable on the wire from a current one for as long as a resolver serves it. This revision converts the gap from an undocumented hazard into a stated limitation of the method — chosen deliberately over specifying rotation machinery that no verifier would enforce (the draft's "unless authorized rotation" exception is dropped as unenforceable). Rotation and revocation with wire semantics are deferred to a future RFC, which will also be the documentation home of the `src/agent-identity/` subsystem (§1). Until then, operators SHOULD treat key compromise as an out-of-band re-registration event under new identity, coordinated between the signatories.

### 8.8. Cross-protocol key reuse (no domain separation) — OUT OF SCOPE, ASSIGNED to RFC-0004

*Unchanged by this revision.* One Ed25519 key serves both NATS transport authentication (NKey nonce signing at CONNECT) and envelope stamping, with no domain-separation prefix. The signature-confusion analysis belongs to RFC-0004 (signing) and MUST be performed there before that key-reuse design is ratified. This document records the reuse because the DID is the identifier of that shared key; it neither resolves nor worsens the finding.

### 8.9. No version-negotiation for a grammar change — RESOLVED by the hard cut (§9)

*The hazard:* a grammar tightening had to synchronize `DID_RE`, twelve schema pattern sites in two repositories, and every persisted DID, with no version field and no transition mechanism; the draft assumed the eventual change would require a dual-accept window per compass `sops/federation-wire-protocol.md`.

*Resolved — by decision, and differently than the draft assumed:* the ratified migration is a **hard cut** (§9), which **supersedes** the dual-accept assumption for this change. The SOP's dual-accept default was considered and overridden by the principal as disproportionate for a two-principal coordinating ecosystem: one flag-day release R flips both emitters together, carries the envelope-schema `$id` bump that ties the grammar revision to the schema generation, and regenerates the twelve pattern sites from the grammar (front-matter `generated`). Legacy forms are not tolerated after the cut — they are rejected at decode (vector `inv/legacy-classless`) — so no mixed-generation machinery exists to get wrong. The destructive consequences are stated, scoped, and checklisted in §9, not discovered.

---

## 9. Migration (the Hard Cut)

**Decision (Andreas, 2026-07-12; pending JC co-signature): the migration from the deployed flat form to the class-explicit dot-form is a HARD CUT.** This supersedes any dual-accept-window language elsewhere in this document's history and in the pre-decision material: there is NO dual-registration, NO staged emitter window, and NO ongoing legacy verifier tolerance. A hard cut is proportionate for a two-principal coordinating ecosystem; the dual-accept default of compass `sops/federation-wire-protocol.md` was considered and deliberately overridden (§8.9).

### 9.1. Flag-day release R

There is exactly one coordinated release, **R**, at which both principals flip their emitters together. R carries:

1. the emitter flip to the §4 rendering (class-explicit dot-form at every wire position);
2. the verifier flip to the §6.2 grammar — the legacy classless form is **rejected at decode** from R onward (vector `inv/legacy-classless`);
3. the envelope-schema `$id` bump, tying the grammar generation to the schema generation;
4. the regeneration of the derived artifacts from the grammar (front-matter `generated`: the twelve `did:mf` pattern sites and `DID_RE`'s replacement);
5. the three regex tightenings of §8.6 (`PRINCIPAL_RE`, `STACK_SEGMENT_REGEX`, `DID_RE`);
6. the identity mapping for pre-cut names, applied at the cut: `did:mf:reflex` → `did:mf:system.reflex`, `did:mf:signal-tap` → `did:mf:system.signal-tap`, `did:mf:public` → `did:mf:principal.public`.

**Atomic coupling.** Because the envelope-field DID and the subject `@`-segment derive from one source (`src/subjects.ts:124`; §5), RFC-0001 and RFC-0002 cut over **atomically, per emitter**. The two RFCs MUST NOT be sequenced independently: there is no state in which an emitter writes new-form envelope fields and old-form subjects, or vice versa.

### 9.2. The destructive consequence, stated honestly

The cut is **destructive by design**: a DID is inside the signed bytes of every envelope, so pre-cut signed envelopes stop verifying at R and **cannot be rewritten** — rewriting the DID would break the signature it sits under. Pre-cut signed history is discarded, not migrated; replay and audit of old-form history breaks at the cut boundary. This consequence was accepted with the decision, not discovered after it.

### 9.3. Cutover checklist (the purge is scoped, not blind)

The purge of persisted old-form state is a **`[principal-hands]` cutover step with its own go/no-go**, executed by the principals, not by automation. Before R:

1. **Enumerate every persisted old-form-DID-string site.** Known classes of site, with their verified/expected disposition:
   - **JetStream signed history** — contains old-form DIDs inside signed bytes: **yes, discard** (§9.2).
   - **Registry rows** — likely keyed by id-strings rather than embedding DIDs in signed material: **verify**, then re-key or re-register under §6.3 Create as needed.
   - **Admission/seal artifacts** — **verify** whether any embed an old-form DID; treat any that do as discard-and-reissue.
   Any site class not on this list that the enumeration discovers is added to the checklist before the go/no-go, not handled ad hoc.
2. **Map carried-over identities** through the §9.1(6) mapping and pre-stage their new-form registrations (register-once: each new-form DID is created exactly once, §6.3).
3. **Go/no-go** on the purge scope with both principals.
4. **Execute R**: flip emitters + verifiers together (§9.1), purge the enumerated sites, confirm the reject-at-decode of a legacy probe (`inv/legacy-classless`) and the round-trip of a new-form probe (`encode/agent-roundtrip-out` / `decode/agent-roundtrip-back`) on the live bus.

No step of this checklist executes before this document is Ratified (both signatures); grounding a cutover on a Draft is an error (Status of This Memo).

---

## 10. Privacy Considerations

REQUIRED, because this document specifies an identifier.

A `did:mf` DID is a **stable, long-lived, fully correlatable** identifier. There is no pairwise or pseudonymous DID facility: the same DID names its subject across every network, subject, and context, so any two observations of a DID are trivially linkable.

The method-specific-id is **human-meaningful by construction — and, from this revision, class-explicit by construction**. An agent DID disclosed an assistant's name before; the fully-qualified form now discloses the `{principal, stack, assistant}` triple. A principal DID discloses the principal id; a stack DID discloses the `{principal, stack}` pair, i.e. a piece of deployment topology; a hub DID discloses the network's name (`did:mf:hub.metafactory` — the formerly informal dotted convention, now the normative form). An observer who collects DIDs therefore learns organizational structure — including which class of thing is speaking — without any payload access.

The `@did-mf-…` subject segment (§5) publishes the recipient's DID **in cleartext on the NATS subject**, by design, so that brokers and audit pipelines can route and recognize an assistant without inspecting the payload. Any party with visibility of subject names — including a federation relay — sees who is being addressed, and now also sees the class tag of the addressee.

Finally, the NKey dual-use design (§8.8) means the transport-authentication identity, the envelope-signing identity, and the DID are the same key. A network-level observer can therefore correlate a transport session to the authorship of the content signed within it.

Implementations that require unlinkability across contexts cannot obtain it from this method as specified; a future method revision would be required.

---

## 11. Conformance

An implementation conforms to this document if and only if it passes every vector under the path named in the `vectors` front-matter field (`specs/vectors/identifiers/`). See [`specs/CONFORMANCE.md`](../CONFORMANCE.md). Prose explains; vectors bind.

A conforming implementation MUST:

1. Accept exactly the language of `method-specific-id` (Appendix A) — the six registered class tags, at their bound arities, over kebab-strict segments, within the length ceilings of §6.2 — no wider, no narrower; and MUST validate the DID string against the grammar, not against a hand-copied regex it maintains independently.
2. Reject fail-closed: an unregistered class tag (`inv/unknown-tag`, `inv/wallet-reserved-not-a-tag`), the legacy classless form (`inv/legacy-classless`), an arity mismatch (`inv/agent-arity-short`, `inv/principal-arity-long`), any DID-URL path/query/fragment at a wire position (`inv/did-url-path`, `inv/did-url-query`, `inv/did-url-fragment`), and every lexical violation of §3 (`inv/uppercase`, `inv/underscore`, `inv/trailing-hyphen`, `inv/double-hyphen`, `inv/leading-digit`, `inv/empty-segment`, `inv/segment-too-long`).
3. Parse a `stack-id` per §3.3, rejecting a missing `/` as a fault and never fabricating a slug (`stack-id/non-default-slug`, `stack-id/literal-default-slug-masking`).
4. Reproduce `encodeDidSegment` and `decodeDidSegment` byte-for-byte per the round-trip vectors (`encode/agent-roundtrip-out`, `decode/agent-roundtrip-back`); `decodeDidSegment` is total and injective on the language of item 1.
5. Derive an identity's class from its class tag and arity, and from nothing else (§2.1).
6. Never resolve a self-asserted DID in the keyed registry (`inv/resolve-self-asserted`), and never accept a self-asserted class in `signed_by[]` (§2.1).
7. Enforce the agent prefix binding of §2.2 against the signature chain (`bind/agent-prefix-accept`, `bind/agent-prefix-reject`).

An implementation MUST NOT import the reference implementation to pass the vectors; it runs its own parser (`specs/CONFORMANCE.md`).

Because this document is `Draft` (pending JC co-signature), no implementation grounds live behaviour on it yet: emitters and verifiers flip only at flag-day release R, after ratification (§9). Once Ratified, this document is the sole conformance authority for the `did:mf` identifier layer.

---

## 12. References

### 12.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC5234] Crocker, D., Ed., and P. Overell, "Augmented BNF for Syntax Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
- [DID-CORE] Sporny, M., Longley, D., Sabadello, M., Reed, D., Steele, O., Allen, C., "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. Structure of §6 follows DID Core §8 (DID Method Specification requirements); the resolved DID Document of §6.3 conforms to its data model.
- [RFC7405] Kyzivat, P., "Case-Sensitive String Support in ABNF", RFC 7405, December 2014. (The grammar of record uses `%s` case-sensitive literals for the class tags.)

### 12.2. Informative References

- [RFC3986] Berners-Lee, T., Fielding, R., Masinter, L., "Uniform Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005. (A DID is a URI.)
- [RFC8785] Rundgren, A., Jordan, B., Erdtman, S., "JSON Canonicalization Scheme (JCS)", RFC 8785, June 2020. (Referenced by RFC-0004, which consumes the key resolved by §6.3.)
- [RFC-0002] metafactory RFC-0002, "Subject Namespace". Co-owns the `@`-segment subject composition of §5; cuts over atomically with this document (§9); owns the short-form decision for federated-subject length.
- [RFC-0003] metafactory RFC-0003, "Envelope". Consumes the DID terminals in `signed_by`, `originator`, `target_assistant`, `economics.wallet`.
- [RFC-0004] metafactory RFC-0004, "Signing". Owns the bytes-to-sign, canonicalization, and chain-verification contract; the byte-exact comparison invariant of §3; and the domain-separation analysis assigned by §8.8.
- [cortex-1880] the-metafactory/cortex#1880, "The did:mf encoding decision". Resolved 2026-07-12 by the decisions this revision records (Candidate C, class-explicit `.`); formerly the blocker on §6.2.
- [cortex-adr-0002] the-metafactory/cortex, ADR-0002, "Federated dispatch addressing and verdict-back". Origin of the legacy `did:mf:{principal}-{stack}` requester-DID convention, superseded at the cut (§9).
- [compass-fed-wire] the-metafactory/compass, `sops/federation-wire-protocol.md`. The ecosystem's dual-accept default, considered and overridden for this migration (§8.9, §9).
- `specs/namespace.md`, `docs/identity.md` — informative background; the DID content of `docs/identity.md` is superseded by this RFC, including its (falsified, now repaired-with-precondition) injectivity claim (§5).

---

## Appendix A. Collected ABNF

The complete grammar, reproduced for the reader. **This appendix is a copy.** The file named in `grammar` (`specs/grammar/identifiers.abnf`) is the source of truth and is what CI validates. `DIGIT` is a core rule of [RFC5234] Appendix B; `%s` case-sensitive literals are [RFC7405].

```abnf
; specs/grammar/identifiers.abnf
; RFC-0001 — Identifiers and Identity (the did:mf DID Method Specification)
; Status: Draft. Records the decisions ratified by Andreas 2026-07-12
; (grill log wf_b5c856a1-6d4, D1-D26), pending JC co-signature. This grammar
; is NOT normative until the RFC is Ratified (see specs/README.md).
; Grounding behaviour on a Draft is an error.
;
; This file is the SINGLE SOURCE OF TRUTH for the identifier terminals that
; RFC-0002 (Subject Namespace) and RFC-0003 (Envelope) reference. Terminal
; alphabets are defined ONCE here; sibling RFCs cite them, never redefine
; them (grammar/README.md rule 5).
;
; Core rule DIGIT is imported from RFC 5234 Appendix B (ALPHA unused: lowercase-only).
; Case-SENSITIVE string literals use the %s notation of RFC 7405. Every
; literal in this grammar is lowercase and case-sensitive.
;
; REVISION NOTE. The former OPEN DECISION placeholder on method-specific-id
; is RESOLVED: cortex#1880 selected Candidate C (class-explicit ".") and the
; ratified grammar below is the full class-explicit dot-form. The regexes
; cited in this file are the LIVE code this grammar supersedes; where a live
; regex is LOOSER than a rule here, the code must TIGHTEN to match at the
; flag-day cutover (RFC §9) — each such site is flagged "TIGHTEN".

; ─────────────────────────────────────────────────────────────────────────
; 1. Base identifier terminals.
;    These are BOTH NATS subject segments AND the substrings a DID is minted
;    from. There is now ONE segment alphabet — kebab-strict — shared by
;    every class; class disambiguation is carried by the tag at msi
;    position 0 (§2), never by the alphabet.
; ─────────────────────────────────────────────────────────────────────────

; lower — the lowercase-letter alphabet every metafactory identifier starts
; with.
lower           = %x61-7A                        ; a-z

; segment — THE metafactory identifier segment (kebab-strict, D1-D6):
;   * first char a lowercase letter;
;   * then lowercase letters, digits, and single interior "-";
;   * NO "_", NO uppercase, NO trailing "-", NO consecutive "--".
; LENGTH: 1-63 octets per segment. The structural rule below does not
; encode the octet bound (ABNF cannot carry both constraints in one rule
; without expansion); the bound is a separate normative constraint,
; enforced by the generated regex:
;   /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,62}$/
; Comparison is BYTE-EXACT: no case-folding, no Unicode normalization, no
; trimming (D2). RFC-0001 cites RFC-0004 for the signing invariant and does
; not duplicate it.
; INJECTIVITY PRECONDITION (load-bearing): dot-separation (§2) is NECESSARY
; but NOT SUFFICIENT for an injective subject encoding. It is THIS rule —
; no segment starts or ends with "-" — that guarantees a "-" is never
; adjacent to a "." in a valid DID, which is what makes the "." -> "--"
; encoding of §3 injective. Do not cite the bare "'.' -> injective" claim.
segment         = lower *seg-alnum *( "-" 1*seg-alnum )
seg-alnum       = lower / DIGIT

; principal-id — a principal slug (the owner of a stack; second token of a
; namespaced NATS subject). Supersedes PRINCIPAL_RE,
; myelin src/patterns.ts:35   /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/
; TIGHTEN: PRINCIPAL_RE permits consecutive "--" (its only edge rules are
; leading-letter and no-trailing-"-"); kebab-strict forbids "--". Its 2-64
; octet window is also replaced by the uniform 1-63 (max tightens 64 -> 63;
; min widens 2 -> 1).
principal-id    = segment

; stack-slug — the per-deployment stack segment. Supersedes
; STACK_SEGMENT_REGEX, myelin src/segment-validators.ts:27
;   /^[a-z][a-z0-9-]{0,62}$/
; TIGHTEN: the deployed regex PERMITS a trailing "-" and consecutive "--";
; kebab-strict forbids both. This RETRACTS the draft's "a stack-slug MAY
; end in a hyphen" (§3.2). Zero live slugs violate the tightened rule
; (verified in the decision log, D1-D6 consequence), so the tightening is
; deploy-safe.
stack-slug      = segment

; stack-id — the {principal}/{stack} pair rendered with a literal "/".
; The "/" is REQUIRED. A bare principal with no "/" is a FAULT and MUST NOT
; be fabricated into a "default" stack (root cause of cortex#1812).
; stack-id is a CONFIG/REGISTRY form, never a wire DID; the wire form of
; the same identity is stack-msi (§2).
stack-id        = principal-id "/" stack-slug

; assistant-id — the {assistant} name of an agent-class identity (the third
; msi segment after the tag). The old IdentityType enum
; (myelin src/identity/types.ts:6, {agent, service, hub}) is WIDENED to the
; closed six-tag set of §2 (D11); "service" is NOT a class — internal
; non-keyed originators are system-class (D7). D11 also fixes the live bug
; where a resolved peer principal is stamped type:'agent'
; (cortex identity-registry.ts:362) -> type:'principal'.
assistant-id    = segment

; network-id / hub-id — hub-id == network-id BY CONSTRUCTION (D9): one hub
; per network, and network_id is the registry primary key, so hub DIDs are
; unique without further machinery. Multi-hub is a future extension behind
; a real hub roster (none exists today).
network-id      = segment
hub-id          = network-id

; surface-id / system-id — the names of the two SELF-ASSERTED classes (D7):
; surface = external trust-anchors (github, discord, slack);
; system  = internal non-keyed originators (reflex, signal-tap).
surface-id      = segment
system-id       = segment

; ─────────────────────────────────────────────────────────────────────────
; 2. The did:mf Decentralized Identifier (class-explicit dot-form).
;
;    "." is the SOLE separator. The class tag is ALWAYS at msi position 0
;    and MUST be drawn from the closed §7 tag registry:
;      KEYED (hold an Ed25519 key; verified; appear in signed_by[]):
;        principal, stack, agent, hub
;      SELF-ASSERTED (no key; appear in `originator` only):
;        surface, system
;    A verifier MUST NOT resolve a self-asserted DID in the keyed registry
;    (the unknown_agent bug class, D7). Validation is FAIL-CLOSED: an
;    unregistered tag is a REJECT (D8; vector inv/unknown-tag).
;
;    Reserved names (§7 registry, D7 corrections):
;      * "public" is NOT a tag: did:mf:principal.public is a REAL keyed
;        principal.
;      * "wallet" (RFC-0009) is NOT a tag: it is a role over ANY DID; the
;        name is reserved so it can never be minted as a class.
;
;    WIRE FORM (D15): a DID appears BARE at every wire position — no path,
;    no query, no fragment. Fragments occur ONLY as verificationMethod ids
;    inside a RESOLVED DID Document. Reject vectors: inv/did-url-fragment,
;    inv/did-url-path, inv/did-url-query.
;
;    LENGTH CEILING: the whole method-specific-id MUST NOT exceed 255
;    octets (pre-parse bound; DNS-name precedent). Under the per-class
;    arities below the structural maximum is 197 octets (agent class: the
;    5-octet tag "agent" + 3 dots + three 63-octet segments =
;    5 + 3 + 189 = 197), so the ceiling never binds well-formed input; it
;    exists so an implementation MAY reject oversize input before
;    structural parsing. Whole-DID maximum: 7 ("did:mf:") + 255 = 262.
; ─────────────────────────────────────────────────────────────────────────

; did — a metafactory DID (W3C DID Core §3.1 conforming shape).
did             = did-prefix method-specific-id
did-prefix      = %x64.69.64.3A.6D.66.3A         ; "did:mf:" (case-sensitive)

; method-specific-id — RESOLVED (was the OPEN DECISION placeholder;
; cortex#1880 -> Candidate C, class-explicit "."). The alternation below is
; AUTHORITATIVE for tag -> arity binding: principal 1, stack 2, agent 3,
; hub 1, surface 1, system 1 (segments after the tag).
; Supersedes DID_RE, myelin src/identity/types.ts:1
;   /^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/
; TIGHTEN (replace wholesale): DID_RE is classless and flat — it permits
; "_", interior/trailing "." and "_", degenerate forms ("did:mf:a-"), has
; no length bound, and cannot recover the class. From flag-day release R
; (RFC §9 hard cut — no dual-accept, no staged windows) the legacy
; classless form is REJECTED AT DECODE (vector inv/legacy-classless).
; Generated whole-DID regex (SEG = the segment regex of §1):
;   /^did:mf:(?:principal\.SEG|stack\.SEG\.SEG|agent\.SEG\.SEG\.SEG|hub\.SEG|surface\.SEG|system\.SEG)$/
method-specific-id = principal-msi / stack-msi / agent-msi
                   / hub-msi / surface-msi / system-msi

principal-msi   = %s"principal" "." principal-id
stack-msi       = %s"stack" "." principal-id "." stack-slug
agent-msi       = %s"agent" "." principal-id "." stack-slug "." assistant-id
hub-msi         = %s"hub" "." network-id
surface-msi     = %s"surface" "." surface-id
system-msi      = %s"system" "." system-id

; class-tag — the closed §7 tag registry as a terminal, for citation by
; sibling RFCs and the registry section. The method-specific-id alternation
; above is authoritative for arity; this rule only names the closed set.
class-tag       = %s"principal" / %s"stack" / %s"agent"
                / %s"hub" / %s"surface" / %s"system"

; AGENT PREFIX BINDING (semantic constraint — NOT expressible in ABNF):
; an agent-class originator's {principal} "." {stack} prefix MUST equal the
; msi tail of the innermost signing stack (anti-impersonation). E.g.
; originator did:mf:agent.andreas.meta-factory.luna is only acceptable in
; an envelope whose innermost signer is did:mf:stack.andreas.meta-factory.
; Vectors: bind/agent-prefix-accept, bind/agent-prefix-reject.

; ─────────────────────────────────────────────────────────────────────────
; 3. The subject-plane encoding (RFC-0001 §5; embedded in full subjects by
;    RFC-0002).
;
;    encodeDidSegment maps a bare DID to an "@"-prefixed NATS subject
;    segment by rewriting ":" -> "-" and "." -> "--"; every other octet
;    passes through verbatim. The envelope-field DID and the subject
;    @-segment derive from this ONE source (cortex subjects.ts:124), so
;    they flip TOGETHER at the hard cut — RFC-0001 and RFC-0002 cut over
;    atomically, per emitter (D25).
;
;    INJECTIVITY: under §1 kebab-strict, no segment starts or ends with
;    "-", so "-" is never adjacent to "." in a valid DID; therefore every
;    "--" in an encoded segment decodes unambiguously to "." and
;    decodeDidSegment is total and injective on this language (D13). This
;    RETIRES the unsound first-hyphen decoder
;    (cortex review-consumer.ts:1454) and the legacy "/" -> "-" stack-DID
;    mint (cortex cortex.ts:1025-1027), both of which the pre-cut collision
;    vectors falsified. Round-trip vectors: encode/agent-roundtrip-out,
;    decode/agent-roundtrip-back.
; ─────────────────────────────────────────────────────────────────────────

; did-subject-segment — a DID embedded as a direct-routing NATS subject
; segment. "@" marks the segment; "did-mf-" is the encoded "did:mf:".
did-subject-segment = "@" %s"did-mf-" encoded-msi

; encoded-msi — the encoded method-specific-id. Arity per class mirrors
; the method-specific-id alternation of §2 exactly ("." -> "--").
encoded-msi     = %s"principal" "--" segment
                / %s"stack" "--" segment "--" segment
                / %s"agent" "--" segment "--" segment "--" segment
                / %s"hub" "--" segment
                / %s"surface" "--" segment
                / %s"system" "--" segment

; ─────────────────────────────────────────────────────────────────────────
; 4. HISTORICAL — the pre-cut deployed grammar (comment only; NOT a rule).
;
;    The formerly-transcribed did-msi-deployed rule (DID_RE,
;    myelin src/identity/types.ts:1) is REMOVED from the grammar: the
;    migration is a HARD CUT (single coordinated flag-day release R; both
;    principals flip emitters together; NO dual-registration, NO staged
;    windows, NO ongoing legacy verifier tolerance). Post-cut, a legacy
;    classless msi such as "andreas-meta-factory" fails at position 0
;    (not a registered tag) and is rejected fail-closed — vector
;    inv/legacy-classless. Pre-cut manifest mapping applied AT the cut
;    (D19): reflex -> system.reflex, signal-tap -> system.signal-tap,
;    public -> principal.public.
; ─────────────────────────────────────────────────────────────────────────
```

## Appendix B. Test Vectors

Vectors live as JSON under `specs/vectors/identifiers/`. This appendix is an index; the JSON files bind. See [`specs/vectors/README.md`](../vectors/README.md). Every vector is an object `{id, rfc, kind, input, expect, why}`; the kinds are `parseDid`, `encodeDidSegment`, `decodeDidSegment`, `parseStackId`, `resolveDid`, and `agentOriginatorBinding`. The full set (30 vectors) was verified by execution: the encode/decode round-trip holds, every positive `parseDid` matches — and every negative fails — the generated whole-DID regex of §6.2, and the too-long segment is exactly 64 octets.

**`valid.json`** (12 vectors):

- *One DID per class, parsed to `{class, parts}`:* `did/principal`, `did/principal-public` (the `public` → `principal.public` mapping), `did/stack`, `did/agent-fq` (the fully-qualified agent form), `did/hub`, `did/surface`, `did/system-reflex`, `did/system-signal-tap` (interior hyphen legal, never a separator).
- *The subject-plane round-trip pair:* `encode/agent-roundtrip-out` (`did:mf:agent.andreas.meta-factory.luna` → `@did-mf-agent--andreas--meta-factory--luna`) and `decode/agent-roundtrip-back` (the inverse, byte-for-byte).
- *The `stack-id` pair guarding cortex#1812:* `stack-id/non-default-slug` and `stack-id/literal-default-slug-masking` (a stack literally named `default` is legal and is not the fabricated sentinel).

**`invalid.json`** (18 vectors; every reject carries a stable `reason` token — the one `ok:true` entry is `bind/agent-prefix-accept`, the accept half of the anti-impersonation pair):

- *Lexical rejects (the kebab-strict alphabet, §3):* `inv/uppercase`, `inv/trailing-hyphen` (the injectivity precondition, pinned), `inv/double-hyphen`, `inv/underscore`, `inv/leading-digit`, `inv/empty-segment`, `inv/segment-too-long` (exactly 64 octets).
- *Wire-form rejects (bare DID only, §6.2):* `inv/did-url-fragment`, `inv/did-url-path`, `inv/did-url-query`.
- *Tag-governance rejects (fail-closed, §7):* `inv/legacy-classless` (the pre-cut flat form — the proven cross-class collision string, rejected at decode from R), `inv/unknown-tag`, `inv/wallet-reserved-not-a-tag`.
- *Arity rejects (§6.2):* `inv/agent-arity-short`, `inv/principal-arity-long`.
- *Plane reject (§2.1, §6.3):* `inv/resolve-self-asserted` (a well-formed surface DID whose *resolution* is refused).
- *The agent prefix-binding pair (§2.2):* `bind/agent-prefix-accept` (`expect.ok = true` — the accept half lives beside its reject twin so the pair is read together) and `bind/agent-prefix-reject` (cross-stack impersonation, rejected against the signature chain).

## Appendix C. Change Log

A `Draft` MAY be edited; every substantive edit is logged here. A `Ratified` RFC is frozen; changes ship as a new RFC.

| Date | Status | Change |
|---|---|---|
| 2026-07-12 | Draft | Initial draft. Defines the identifier terminals (`principal-id`, `stack-slug`, `stack-id`, `agent-id`, `service-id`, `hub-id`) from the live regexes; defines the `did:mf` method per DID Core §8 with `method-specific-id` as a TBD placeholder blocked on cortex#1880; records the flat-namespace class collision, the first-hyphen decode, the subject-encoding non-injectivity, the lossy mint, the degenerate forms, rotation/revocation and NKey-reuse gaps as findings; ships the starter vector set. |
| 2026-07-12 | Draft | Revision 2 — records the ratified decisions (Andreas, grill log wf_b5c856a1-6d4, D1–D26; **pending JC co-signature**). Resolves §6.2 (cortex#1880 → class-explicit dot-form, closed 6-tag registry, fail-closed); replaces the class model with the two-plane taxonomy (§2; `service` removed, `system`/`surface` added, `public` → `principal.public`, `wallet` reserved-not-a-tag); collapses all terminals onto the single kebab-strict `segment` (§3; retracts the §3.2 trailing-hyphen allowance); makes rendering normative and retires the legacy mints/decoders (§4–§5, injectivity restored with its precondition stated); specifies plane-aware resolution to a minimal DID Document and the minimal v1 lifecycle (§6.3); decides against W3C registration for v1 (§7); rewrites findings §8.1–8.9 as resolutions (8.7 an explicit v1 limitation; 8.8 assigned to RFC-0004); adds §9 Migration (hard cut, atomic RFC-0001+0002 coupling, scoped `[principal-hands]` cutover checklist), renumbering Privacy → §10, Conformance → §11, References → §12; syncs Appendix A to the resolved grammar; replaces the vector set (12 valid + 18 invalid, verified by execution). |

## Acknowledgments

This draft is grounded in a wire-protocol audit of `myelin@origin/main` and `cortex@origin/main`, and in the decision docket of grill log wf_b5c856a1-6d4 (26 decisions, stress-verified). The class-collision proof and the encoding counterexamples of the initial draft were verified by execution against the live regexes; the round-trip and rejection properties of this revision were verified by execution against the resolved grammar.

## Authors' Addresses

Luna (drafting agent), on behalf of Andreas — metafactory.
Ratification signatories: Andreas (principal — decisions ratified 2026-07-12); JC (hub custodian — co-signature pending).

<!-- links -->
[did-registries]: https://www.w3.org/TR/did-spec-registries/
