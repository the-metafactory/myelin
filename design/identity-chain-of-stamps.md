# Design: Identity — Chain of Stamps

> **Status:** Proposal — design review, no implementation yet.
> **Tracks:** myelin#31
> **Builds on:** MY-400 (`src/identity/`), Groups 1–4 merged.
> **Related:** myelin#7 (seven-layer model), myelin#11 (cross-layer sovereignty), arc#113 (`--with-identity` provisioning).
> **Author:** drafted with Claude Code, May 2026.

---

## 1. Context

Myelin's L4 (Trust/Identity) shipped in MY-400 with a **single-signer envelope**:

- `signed_by: SignedBy` (one object, not an array) — `src/identity/types.ts:33`.
- Two methods: `ed25519` (agent's own key) and `hub-stamp` (a trusted hub signs on behalf of an agent).
- The signature covers JCS-canonical bytes of `{id, source, type, timestamp, sovereignty, payload, signed_by}` minus `signed_by.signature` — `src/identity/canonicalize.ts:12`.
- Mutable fields (`correlation_id`, `economics`, `extensions`) are intentionally outside the signature so intermediaries can annotate without breaking it.
- `verifyEnvelopeIdentity` checks **the outermost stamp only** — `src/identity/verify.ts:14`.

That foundation is rigorous at one layer. It attests to **origin**. It does not attest to **path**.

Myelin envelopes accumulate context as they cross handlers — gateway, transit, accountability, sovereignty enforcement. Each hop is a place where trust decisions could be made, but today none of them are cryptographically meaningful. If JC's accountability/sovereignty axis is going to be enforceable at every hop — not just at L1 of trust — each handler needs to be able to **append its own attestation**, and the verifier needs to be able to **walk the chain**.

This is closer to a **notary stack** or **delegation chain** than a single signature.

## 2. Goals

1. Promote `signed_by` from a single object to an **ordered chain** of stamps.
2. Make the chain **tamper-evident**: stripping, reordering, or mutating any earlier stamp invalidates verification of every later one.
3. Give each stamp an explicit **role** (origin, transit, accountability, sovereignty-assertion, …) so handler policy can address them by meaning, not position.
4. Keep the existing **mutable-field carve-out** (`correlation_id`, `economics`, `extensions`), but make the rule for what's inside vs outside the chain explicit and documented.
5. Provide a **verifier policy** strong enough to express things like *"chain must include role=accountability stamped by an operator-type principal"* — myelin#11's pre-condition.
6. **Back-compat**: existing single-stamp envelopes continue to verify under the new code path. No flag day.

### Non-goals

- Multi-party co-signing / threshold sigs at a single hop. (Future issue.)
- Hardware-backed keys. (Future issue.)
- Revocation lists for compromised principals. (Future issue.)
- Replacing the JCS-canonicalization model with COSE/CBOR. (See §6 alternatives — explicitly rejected for now.)

## 3. Prior art (research summary)

Surveyed nine cryptographic chain-or-multi-sig patterns. Detailed notes in [§Appendix A](#appendix-a-prior-art-detail). The relevant findings:

| Pattern | Chain or multi-sig? | Bytes signed at hop N |
|---|---|---|
| **COSE Counter-sig (RFC 9338)** | True chain (sequential) | Includes prior signature in `Sig_structure` |
| **COSE Counter-sig v1 (RFC 8152)** | Broken — strip-attack possible | Did **not** cover prior sig |
| **JWS multi-sig (RFC 7515 §A.6)** | Multi-sig | Same payload, independent |
| **DSSE (in-toto)** | Multi-sig (deliberate) | PAE — same bytes for all signers |
| **Notary v2 / OCI signatures** | Multi-sig | Artifact descriptor only |
| **X.509 cert chain (RFC 5280)** | Identity-binding chain | Each cert signs own TBS, not prior sig bytes |
| **SCITT Receipts + sigstore Rekor** | Hash-binding (Merkle) | Inclusion proof, not direct sig-over-sig |
| **Git commit graph** | Hash DAG with optional sigs | Signs content incl. parent hashes |
| **Macaroons / Biscuit v3** | True append-only chain | Each block commits to prior key/sig |

**Two findings drive the recommendation:**

1. **COSE 8152 → 9338 is the cautionary tale.** The original COSE counter-sign did *not* cover the prior signature bytes. RFC 9338 fixed it explicitly because strip/swap attacks were possible. *Always include prior-sig bytes in the to-be-signed input.*
2. **Macaroons/Biscuit are the closest social model match.** Their roles (root-issuer → attenuator → final holder) parallel myelin's (origin → transit → accountability). Both treat the chain as **append-only with semantic ordering**. DSSE/Notary explicitly reject ordering because their attestations are *parallel* (build provenance, scanner attestations) — the wrong precedent for hop-by-hop message stamps.

The DSSE rationale doc is worth reading specifically because it argues *against* chains for parallel attestations. Reading it confirms myelin's case is *not* parallel — it's sequential and additive, so chain semantics are correct.

## 4. Design recommendation

### 4.1 Shape

```typescript
// types.ts
export type StampRole =
  | "origin"                  // first signer — author of the envelope
  | "transit"                 // forwarding hop, no semantic claim
  | "accountability"          // attests "I will be on the hook for this"
  | "sovereignty-assertion"   // attests "I claim sovereignty over this scope"
  | "notary";                 // generic timestamp/witness

export interface SignedByEd25519 {
  method: "ed25519";
  principal: string;          // did:mf:<name>
  role: StampRole;
  signature: string;          // base64
  at: string;                 // ISO-8601
  prev_sig_hash?: string;     // base64(sha256(prior_stamp.signature)) — REQUIRED on stamps with index > 0
}

export interface SignedByHubStamp {
  method: "hub-stamp";
  principal: string;
  stamped_by: string;
  role: StampRole;
  signature: string;
  at: string;
  prev_sig_hash?: string;
}

export type SignedBy = SignedByEd25519 | SignedByHubStamp;

// envelope changes:
// signed_by?: SignedBy | SignedBy[]
// On read, normalize to SignedBy[]. A single object is a one-element chain (back-compat).
```

### 4.2 Canonicalization rule (the crux)

When stamp `N` signs, it computes its signature over the JCS-canonical bytes of:

```
{
  ...all currently-signable envelope fields (id, source, type, timestamp, sovereignty, payload),
  signed_by: [stamp_0, stamp_1, ..., stamp_{N-1}, stamp_N_minus_signature]
}
```

Where `stamp_N_minus_signature` is stamp N's metadata (method, principal, role, at, prev_sig_hash) **without** the `signature` field — same trick as today.

**Concretely:**
- Stamp 0 (`origin`) signs the same bytes as today (one-element chain ≡ current single-stamp behavior).
- Stamp 1 onwards: sets `prev_sig_hash = base64(sha256(stamps[N-1].signature))` AND the canonical bytes include the full prior chain.

This gives **double tamper-evidence**:
- Mutating any prior stamp's signature changes the canonical input → stamp N's sig fails.
- Stripping a prior stamp changes both the canonical input AND the `prev_sig_hash` chain → stamp N's sig fails.

The redundancy is intentional. RFC 9338 only includes prior bytes in the structure; we include them *and* a prev-sig hash because the hash makes chain integrity easy to check before doing the (expensive) full canonicalization+verify, and matches the Macaroons mental model people will recognize.

### 4.3 Mutable-field rule

Keep the current carve-out: `correlation_id`, `economics`, `extensions` are **outside the chain**. Document this explicitly:

> **Inside the chain:** `id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`, `signed_by[*]` (minus per-stamp signature).
>
> **Outside the chain (mutable by intermediaries):** `correlation_id`, `economics`, `extensions`.
>
> *Intent:* Intermediaries may annotate observability and economics state without invalidating attestations. Anything an attestation needs to bind cryptographically MUST live inside the chain. If a future field needs to be both mutable AND attested, that's a signal to add a dedicated nested stamp role rather than expanding the carve-out.

### 4.4 Verifier policy

```typescript
// verify.ts
export interface ChainVerificationResult {
  status: "verified" | "unverified" | "rejected";
  chain: PerStampVerdict[];                       // ordered, one per stamp
  reason?: string;
}

export interface PerStampVerdict {
  index: number;
  principal: string;
  role: StampRole;
  status: "verified" | "rejected";
  reason?: string;
}

export interface ChainPolicy {
  minLength?: number;
  // require at least one stamp matching each predicate
  require?: Array<{
    role?: StampRole;
    principalType?: PrincipalType;        // "agent" | "service" | "operator"
    principal?: string;                    // exact DID match
  }>;
  // optional: forbid roles, e.g. "no transit-only chains for sovereignty-asserted envelopes"
  forbid?: Array<{ role?: StampRole; principalType?: PrincipalType }>;
}

export function verifyEnvelopeIdentityChain(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
  options?: VerifyOptions & { policy?: ChainPolicy },
): Promise<ChainVerificationResult>;
```

Each stamp in the chain is verified independently (against the canonical bytes that include its prefix). A chain is `verified` iff:

1. Every stamp verifies.
2. `prev_sig_hash` is correct on every non-zero stamp.
3. The policy predicates are satisfied.

`requireVerifiedIdentity` keeps its current signature (returns the `Principal` of the **outermost** stamp) for back-compat. New call sites that need chain-aware policy use `verifyEnvelopeIdentityChain` directly.

### 4.5 Append API

```typescript
// sign.ts
// Existing function unchanged — produces a one-element chain.
export function signEnvelope(envelope, privateKey, principal): MyelinEnvelope;

// New: append a stamp to an already-signed envelope.
export function appendStamp(
  envelope: MyelinEnvelope,
  privateKey: string,
  principal: string,
  role: StampRole,
): Promise<MyelinEnvelope>;
```

`appendStamp` enforces: there must already be ≥1 stamp, the new stamp's `prev_sig_hash` is computed automatically, and the resulting envelope is canonicalized + signed correctly.

A `hub-stamp` variant `appendHubStamp(envelope, hubPrivateKey, agentPrincipal, hubPrincipal, role)` mirrors the existing hub-stamp shape.

## 5. Migration & back-compat

| Phase | Reader behavior | Writer behavior |
|---|---|---|
| **Today (post-MY-400)** | `signed_by: SignedBy` (object) | Single ed25519 or hub-stamp |
| **Phase 1 — schema-permissive, single-stamp writers** | Accept `SignedBy` OR `SignedBy[]`. Normalize to array of length 1. Verify as today. | Still write single object — no behavioral change. |
| **Phase 2 — chain-aware verifiers, opt-in append** | New `verifyEnvelopeIdentityChain` available. Old `verifyEnvelopeIdentity` still works (verifies outermost). | Handlers that want to append use `appendStamp`. Most don't yet. |
| **Phase 3 — handler policy migration** | Specific handlers (sovereignty enforcement, accountability gateway) require chain policies. | Those code paths begin appending stamps as envelopes pass through. |
| **Phase 4 — array-only writers** *(optional, far future)* | — | All emitters write `SignedBy[]`, even single-element. Drop the object form from the schema. |

**No flag day.** Phase 1 is purely additive — old envelopes verify, old code keeps working. Phase 2 introduces new APIs without retiring old ones. Phase 4 only happens if/when there's a reason.

JSON Schema (`schemas/envelope.schema.json`) accepts either shape via `oneOf`.

## 6. Alternatives considered

### 6.1 Pure multi-sig (DSSE-style)

Make `signed_by: SignedBy[]` where each entry signs the *same* bytes independently.

**Why rejected:** Doesn't model "this envelope was attested at hop N *given* hops 1..N-1." Strip/reorder is undetectable by signature alone — you'd have to add an out-of-band convention for ordering. DSSE deliberately chose this for *parallel* attestations; myelin's hops are sequential.

### 6.2 Nested envelopes (JWT-in-JWT)

Each handler wraps the envelope in a new envelope.

**Why rejected:** Schema explosion, every handler has to understand the wrapping, observability tooling can't introspect inner envelopes without recursion. JWS designers explicitly didn't do this for the same reasons (RFC 7515 §A.6 chose array form).

### 6.3 SCITT-style transparency log

Store envelopes in an append-only log; each stamp references log inclusion.

**Why rejected:** Forces a centralized service into L4. Myelin's NFR-1 (no external dependencies) and operator sovereignty (NFR-5) explicitly preclude this for the core path. SCITT might still be a *consumer* of myelin envelopes (an operator could run a transparency log subscriber) but not a *requirement* for chain integrity.

### 6.4 Migrate to COSE/CBOR

Adopt RFC 9338 directly instead of inventing a JCS-shaped chain.

**Why rejected:** Whole stack is JSON today (envelope, NATS subjects, schemas). Migrating canonicalization + signing to CBOR is a huge surface change for marginal benefit. We can adopt RFC 9338's *lesson* (cover prior sig bytes) without adopting its *encoding*.

### 6.5 `prev_sig_hash` only, no chain bytes inclusion

Each stamp carries only `prev_sig_hash`; the canonical input does not include the full prior chain.

**Why rejected:** This is the COSE 8152 mistake in disguise. If the canonical input doesn't bind the prior chain content, an attacker can substitute a different prior chain whose final-stamp hash matches (e.g. via length-extension or by colliding via mutable fields). Belt and braces.

## 7. Cross-layer fit (where this lives in myelin)

| Layer | Concern | This proposal's role |
|---|---|---|
| L4 — Trust/identity | Who sent this; did they have authority | Mechanism for hop-by-hop attestation |
| L5 — Routing/transit | Hops the envelope took | Each hop *can* (not must) leave a `transit` stamp |
| L6 — Sovereignty | Who can act on this within whose boundary | `sovereignty-assertion` role makes claims explicit and verifiable |
| L7 — Accountability | Who's on the hook if this is wrong | `accountability` role provides cryptographic non-repudiation |

myelin#11 (cross-layer sovereignty enforcement) is the headline consumer: a sovereignty handler at L6 can require *"chain must include role=accountability by principal of type=operator within my boundary"* before allowing an action.

## 8. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1 | `signed_by` accepts `SignedBy[]`; single-object form back-compat normalized to array of length 1 on read. |
| AC-2 | Each stamp's signature covers JCS-canonical bytes of `{signable_envelope_fields, signed_by: chain_so_far + this_stamp_minus_signature}`. |
| AC-3 | Each non-zero stamp carries `prev_sig_hash = base64(sha256(prior_signature))`; verifier rejects on mismatch. |
| AC-4 | `verifyEnvelopeIdentityChain` returns ordered per-stamp verdicts plus an aggregate status. |
| AC-5 | `ChainPolicy` can express min-length, required role, required principal type, exact principal, and forbidden roles. |
| AC-6 | `appendStamp` and `appendHubStamp` produce envelopes that round-trip through verification. |
| AC-7 | All MY-400 single-signer tests still pass under the new code path (back-compat). |
| AC-8 | JSON Schema accepts both `SignedBy` and `SignedBy[]` shapes. |
| AC-9 | Documented contract (this spec or a successor) lists fields inside vs. outside the chain. |
| AC-10 | Stripping any stamp from a 2+ stamp envelope causes `verifyEnvelopeIdentityChain` to reject with a chain-integrity reason. |
| AC-11 | Mutating any stamp's `principal`, `role`, `at`, or `prev_sig_hash` causes that stamp's verdict to fail. |

## 9. Open questions

1. **Role taxonomy.** Is `{origin, transit, accountability, sovereignty-assertion, notary}` the right starter set, or do we want it open-ended (string)? Recommendation: closed enum for v1, with `extensions.custom_role` if anyone wants experimentation. Worth a colleague check.
2. **`hub-stamp` semantics inside a chain.** When a hub stamps on behalf of an agent mid-chain, does the chain index it under the agent's principal (the *attested* identity) or the hub's (the *signing* key)? Proposal: `principal` is the attested identity, `stamped_by` is the signing hub — same as today. Document this.
3. **Mutable-field hashing.** Should we add an optional `mutable_fields_hash` *outside* the chain so observers can detect when intermediaries have annotated, even if they can't prove what was changed? (Cheap, additive, observability win — but maybe out of scope.)
4. **Per-stamp `extensions`.** Do we want each stamp to carry its own opaque `extensions` field for hop-specific metadata (timing, evidence references)? Probably yes; cheap.
5. **Verifier ergonomics.** Most call sites today only care about "is this verified at all" — the `requireVerifiedIdentity` shape. Should chain policy be **opt-in via a new function** (proposed) or **default with a relaxed policy** (`minLength: 1`)? Recommendation: opt-in. Less risk of subtle behavior shift.
6. **Chain length cap.** Should we set a hard max chain length to avoid pathological envelopes? Probably 16; pick a number.
7. **Hub-on-hub.** Can a hub-stamp stamp another hub-stamp? Yes mechanically — but is there a use case? Document as supported, no special handling.

## 10. Out of scope (separate issues if desired)

- Multi-party co-signing / threshold sigs at a single hop.
- Hardware-backed keys (HSM, TPM, secure enclave).
- Revocation lists for compromised principals.
- Cross-operator trust roots / federation handshake.
- Migrating canonicalization to COSE/CBOR.

---

## Appendix A: Prior art detail

### A.1 COSE Counter-signatures (RFC 9338, Dec 2022)
Supersedes RFC 8152 §4.5. Counter-sig is computed over `Sig_structure` that includes the *original signature value*. RFC 9338 §3.3 supports sequential countersignatures of countersignatures — true chain. The 8152→9338 fix is the canonical lesson: cover prior sig bytes or strip-swap is possible.

### A.2 IETF SCITT + COSE Receipts (active draft)
Issuer produces Signed Statement (COSE_Sign1). Transparency Service produces a Receipt that binds the statement via Merkle inclusion proof. Two-layer commitment by hash, not direct sig-over-sig. Scales for N≥3, requires log service.

### A.3 JWS Multi-sig vs Nested JWT (RFC 7515)
§3.2 + Appendix A.6 multi-sig: `signatures[]` array; each independently covers same `protected || payload`. Order non-binding. RFC 7519 §11.2 Nested JWT genuinely chains because each level fully wraps inner. JWS array form is **multi-sig, not chain** — order is not cryptographically meaningful.

### A.4 X.509 Path Validation (RFC 5280 §6.1)
Each cert is signed by issuer over its own TBSCertificate (subject pubkey, name, extensions). Chain by *subject/issuer name + sig verification*, not by signing prior sig bytes. Models *identity binding at rest*, not runtime message attestation.

### A.5 Sigstore / Rekor
Fulcio short-lived cert + Rekor log; Signed Entry Timestamp signs `{logID, logIndex, integratedTime, body_hash}`. Hash-binding (like SCITT), not sig-over-sig.

### A.6 Notary v2 / OCI
Multiple independent COSE_Sign1 or JWS sigs on artifact descriptor via referrers API. Pure multi-sig — designed for parallel attestation by independent parties (publisher, scanner, org).

### A.7 DSSE (in-toto)
PAE: `"DSSEv1" || len(type) || type || len(payload) || payload`. `signatures[]`; each signer signs same PAE. Designers explicitly reject chain semantics in their rationale doc — chain forces false ordering for parallel attestations.

### A.8 Git commit signatures
Signs commit object bytes including `parent` hashes. Hash-DAG with optional independent sigs. Sig N transitively commits to ancestor *content* via hash but not to ancestor *signatures*.

### A.9 Macaroons / Biscuit v3
Macaroons (Birgisson et al., 2014): `k_{n+1} = HMAC(k_n, caveat)` — HMAC chain. Biscuit v3: each block carries `(payload, next_pubkey, sig)`, sig over `payload || next_pubkey` with prior block's ephemeral key. Append-only attenuation; closest social-model match for myelin. Worth reading both papers when finalizing the wire shape.

---

## Deliverables for this design review

1. **This document.** Single source of truth for the proposed design.
2. **No code changes.** Implementation deferred until design is reviewed.
3. **Open questions in §9** are explicitly flagged for colleague input — not assumed.
4. **Implementation plan** (if approved) would follow MY-400's group pattern: types → canonicalize/sign → verify+policy → append API → migration → handler integration. Each group lands as its own PR.

## Review checklist

- [ ] Is the chain-vs-multi-sig argument convincing for myelin's hop model?
- [ ] Are the role enums (`origin`, `transit`, `accountability`, `sovereignty-assertion`, `notary`) the right starter set?
- [ ] Is the mutable-field carve-out rule (`correlation_id`, `economics`, `extensions` outside the chain) the right call?
- [ ] Is the back-compat path (Phases 1–4) acceptable, or is there appetite to break the wire format sooner?
- [ ] Open questions in §9 — any that should be decided before implementation starts?
- [ ] Is `design/identity-chain-of-stamps.md` the right home for this, or should it be a `.specify/specs/my-410-...` spec?
