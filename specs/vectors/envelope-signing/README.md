# RFC-0004 vectors — Envelope Signing & Canonicalization

**Prose explains. Vectors bind.** These are the ratification vectors for the crypto core
(grill log `../../rfc/grill-logs/rfc-0004.md`, 32/32, Andreas 2026-07-13; RFC `Ratified`
single-principal per ADR-0001). They pin the **post-cut** scheme byte-for-byte so a second
implementation (Go/Python/Rust) verifies from spec + vectors alone (independent-impl grade, L0b).

## Files

| File | Operation kinds | What it pins |
|---|---|---|
| `canonicalize.json` | `canonicalizeForSigning`, `canonicalizeForChainStamp`, `bytesToSign`, `normalizeSignedBy`, `parseAndCanonicalize` | D1 field-ID-indirection canonical form; D2 parse/I-JSON (non-finite MUST-fail, duplicate-key); §4.2 carve-out masking; §4.3 single-object→array; §5.4 chain-slice + chain-commit; D9 domain-separation prefix at the byte level; D32 shim divergence |
| `sign-verify.json` | `verifyEnvelopeIdentity` | Full sign→verify round trips (ed25519 chain + hub-stamp); tamper rejection; D17 admission-vs-reverify freshness; D9 cross-protocol rejection |
| `reject.json` | `validateStampSyntax`, `verifyEnvelopeIdentity` | The §11 rejection-token matrix (D27); D8 verification-equation edge cases; D6 chain-length cap; D16 stackless fail-closed |
| `generate.ts` | — | The committed vector **generator** (D28). Self-contained (imports only `node:crypto`), deterministic, recomputes every byte + signature. |

Each vector is `{ id, rfc: 4, kind, input, expect: { ok, value?, reason? }, why }` per
[`../README.md`](../README.md). `input` is normally a parsed JSON value; for the two D2
`parseAndCanonicalize` vectors it is **raw JSON text** (a string) so the harness can exercise
the parse step (duplicate-key detection, non-finite tokens) that a permissive `JSON.parse`
would erase.

## Regenerating

```bash
bun specs/vectors/envelope-signing/generate.ts
```

The generator asserts the derived TEST public keys and re-verifies every positive signature
before writing; a drift throws rather than emitting a wrong vector. Ed25519 is deterministic
(RFC 8032), so the output is byte-stable across any conforming signer.

## Test keys (DESIGNATED TEST VECTORS — D30)

Seeds are fixed byte fills; **never** production keys. The hub test identity is
`did:mf:hub.testnet`, deliberately **OFF** the reserved real `did:mf:hub.metafactory` (D30).

| Identity | Class | Seed | Public key (base64-raw) |
|---|---|---|---|
| `did:mf:agent.andreas.meta-factory.echo` | agent | `0x01 × 32` | `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=` |
| `did:mf:stack.andreas.meta-factory` | stack | `0x03 × 32` | `7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=` |
| `did:mf:hub.testnet` | hub | `0x02 × 32` | `gTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5Q=` |

DIDs are the ratified **class-explicit dot-form** (RFC-0001 §6.2). The pre-cut **flat** form
(`did:mf:echo`, …) is **illustrative only** (D29) — it appears in the RFC prose appendix, never
as a binding vector. Both the DID strings and (because a DID is inside the canonical bytes)
every signature regenerate atomically at the RFC-0001 §9 hard cut.

## Conformance is LAYERED (D32)

A consumer MUST run these vectors against its **own** shim (`normalizeSignedBy`), its own
canonicalizer (`canonicalizeForSigning` / `…ChainStamp` / `bytesToSign` / `parseAndCanonicalize`),
and its own chain walker (`verifyEnvelopeIdentity` / `validateStampSyntax`). It MAY satisfy the
pure Ed25519 sign/verify primitive via a version-pinned reference import declared in its
per-consumer conformance manifest — it MUST NOT import the reference for the shim/canonicalizer/
walker layers. `canon/shim-null-signed-by-is-empty` is expected to FAIL against cortex's current
re-implemented shim; that is the point (it surfaces the drift recorded in RFC-0004 §9).

## Vector-set versioning

This set binds the v1 signing profile (`CONTEXT_TAG = metafactory-envelope-signature-v1`).
Any change to the canonicalization scheme, the field-ID registry, the method/role enums, or the
signature/key encoding is a wire-encoding change governed by BCP-0001 and RFC-0004 §11: a new
RFC, both signatures, and — by default — a dual-accept window + named retirement release. The
one ratified exception is the RFC-0001 §9 DID-encoding hard cut (no dual-accept). Vectors are
additive: added, never renamed or repurposed; a superseded vector is deleted with a note in the
RFC change log, never silently edited.
