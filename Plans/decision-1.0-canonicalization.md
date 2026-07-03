# Decision memo — 1.0 signature / vocabulary strategy (H4)

**Status:** DECISION NEEDED (human). Draft per remediation task H4. The deepest of the four.

## The root issue

myelin signs the **canonical JSON of the envelope over its literal field keys**
(JCS / RFC 8785, `src/identity/canonicalize.ts` over `SIGNABLE_FIELDS`). The
signed bytes therefore include the field *names*. That means:

> **Every rename of a signable field is a cryptographically breaking change,
> forever.**

The entire 2026-05 vocabulary migration (`{org}`→`{principal}`,
`Principal`→`Identity`, `signed_by[].principal`→`.identity`,
`target_principal`→`target_assistant`) was expensive precisely because each rename
re-shaped the signed bytes, forcing verifiers-before-emitters rollouts and
JetStream replay-window drains. Pre-1.0 we absorb that cost. After 1.0 we cannot —
a signed envelope must verify for the lifetime of the key material.

So 1.0 must pick a stance on how names relate to signed bytes.

## Option A — Vocabulary freeze

Declare the vocabulary frozen at 1.0. After 1.0, field renames are **forbidden**;
only **additive** fields are allowed (new optional keys, never renamed keys).

- **+** Zero new machinery. The current JCS-over-literal-keys scheme stays.
- **+** Simple mental model: "the names are the wire; they never change."
- **−** Locks in every current name, including any we still dislike. A future
  clarity win (a better term) is permanently unavailable without a v2 wire format.
- **−** Puts all the pressure on getting the glossary exactly right before 1.0.

## Option B — Canonicalize over stable field IDs

Decouple wire/display names from signed bytes: assign each signable field a
**stable integer/string ID** (protobuf-tag style) and canonicalize over the IDs,
not the human names. Renaming a field then changes only its display name, not the
signed bytes.

- **+** Renames become non-breaking forever — the exact pain this migration hit.
- **+** The binary-encoding groundwork is **already in-tree**: `src/serialization/`
  ships a msgpack codec (`msgpack.ts`) alongside JSON (`json.ts`), with
  `detect.ts` + `registry.ts` — the project already encodes to a
  tag-addressable binary form.
- **−** New canonicalization scheme = a genuine crypto-surface change; must be
  designed, reviewed, and migrated to once. Every consumer's verifier changes.
- **−** A field-ID registry becomes a permanent maintenance artifact (IDs are
  forever; you can deprecate but never reuse).

## Blast-radius comparison

| | A. Freeze | B. Field IDs |
|---|---|---|
| Machinery to build | none | new canonicalization + ID registry |
| One-time migration | none | yes — every verifier, once |
| Future rename cost | impossible (v2-only) | free |
| Risk of getting names "stuck wrong" | high | low |
| Complexity carried forever | low | medium (ID registry) |

## Recommendation (for discussion, not a decision)

If the vocabulary is believed **settled** after this migration → **A** is the
cheap, honest choice; spend the remaining pre-1.0 window hardening the glossary.
If renames are expected to keep happening (the migration suggests the domain
language is still moving) → **B** pays for itself, and the msgpack layer means the
binary-tag encoding is not a greenfield build.

A defensible middle path: **freeze for 1.0 (A) but design the field-ID scheme (B)
as the planned 2.0 wire format**, so the door stays open without paying B's cost now.

## What this memo does NOT do

Change canonicalization, `SIGNABLE_FIELDS`, or the schema. Human picks the 1.0
stance; if B or the middle path, that spawns its own design spec + issue.
