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
- **Hash agility for `prev_sig_hash`.** v1 chains use SHA-256, full stop. Future hash agility requires a new explicit chain version (e.g. by versioning the envelope schema or by encoding the algorithm in the value as `"sha256:<base64>"` — both are forward-compatible additive changes). Silent hash-algo polymorphism is the JWS `alg=none` lesson and is explicitly rejected.
- **Forward security under principal key compromise.** Chain stamps are valid as long as the principal's key is. Key rotation and revocation are deferred to a later issue; this design widens the existing exposure surface but does not change the threat model.

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

The chain-position invariant (origin stamp has no `prev_sig_hash`; every other stamp must have one) is a wire-format invariant. Encode it in the type system, not just in prose, so constructors that produce ill-formed chains fail to type-check.

```typescript
// types.ts
export type StampRole =
  | "origin"                  // first signer — author of the envelope
  | "transit"                 // forwarding hop, no semantic claim
  | "accountability"          // attests "I will be on the hook for this"
  | "sovereignty-assertion"   // attests "I claim sovereignty over this scope"
  | "notary";                 // generic timestamp/witness

// Common fields for every stamp.
interface StampBase {
  principal: string;          // did:mf:<name>
  role: StampRole;
  signature: string;          // base64
  at: string;                 // ISO-8601
}

// ed25519 — agent's own key.
export type OriginEd25519Stamp = StampBase & {
  method: "ed25519";
  // No prev_sig_hash — must be absent on origin (chain index 0).
};
export type LinkedEd25519Stamp = StampBase & {
  method: "ed25519";
  prev_sig_hash: string;      // base64(sha256(prior_stamp.signature)) — REQUIRED.
};
export type SignedByEd25519 = OriginEd25519Stamp | LinkedEd25519Stamp;

// hub-stamp — trusted hub signs on behalf of agent.
export type OriginHubStamp = StampBase & {
  method: "hub-stamp";
  stamped_by: string;
};
export type LinkedHubStamp = StampBase & {
  method: "hub-stamp";
  stamped_by: string;
  prev_sig_hash: string;
};
export type SignedByHubStamp = OriginHubStamp | LinkedHubStamp;

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

Where `stamp_N_minus_signature` is stamp N's metadata — every field except `signature` — i.e. `method`, `principal`, `role`, `at`, `prev_sig_hash` (when present), plus `stamped_by` for hub-stamps. **Only the `signature` field is excluded from canonical input; nothing else.**

**Concretely:**
- Stamp 0 (`origin`) signs the same bytes as today (one-element chain ≡ current single-stamp behavior).
- Stamp 1 onwards: sets `prev_sig_hash = base64(sha256(stamps[N-1].signature))` AND the canonical bytes include the full prior chain.

**`signed_by[]` array order is cryptographically load-bearing.** Reordering any pair of stamps changes the prefix every later stamp signed and invalidates their signatures. Implementations MUST NOT sort, deduplicate, or otherwise reorder the array for canonicalization. Verifiers MUST process stamps in the order they appear.

This gives **triple tamper-evidence**:
- Mutating any prior stamp's signature changes the canonical input → stamp N's sig fails.
- Stripping a prior stamp changes both the canonical input AND the `prev_sig_hash` chain → stamp N's sig fails.
- Reordering any pair of stamps swaps prefixes → both affected stamps' sigs fail.

The redundancy is intentional. RFC 9338 only includes prior bytes in the structure; we include them *and* a prev-sig hash because the hash makes chain integrity easy to check before doing the (expensive) full canonicalization+verify, and matches the Macaroons mental model people will recognize.

### 4.3 Mutable-field rule

Keep the current carve-out: `correlation_id`, `economics`, `extensions` are **outside the chain**. Document this explicitly:

> **Inside the chain:** `id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`, `signed_by[*]` (minus per-stamp signature).
>
> **Outside the chain (mutable by intermediaries):** `correlation_id`, `economics`, `extensions`.
>
> *Hard contract:* **Clients MUST NOT make security or trust decisions based on mutable-field values.** Any value used in authorization, sovereignty enforcement, or accountability gating MUST be inside the chain.
>
> *Intent:* Intermediaries may annotate observability and economics state without invalidating attestations. Anything an attestation needs to bind cryptographically MUST live inside the chain. If a future field needs to be both mutable AND attested, that's a signal to add a dedicated nested stamp role rather than expanding the carve-out.

### 4.3.1 Replay protection and per-stamp freshness

Replay protection is governed by `envelope.timestamp` and the existing `DEFAULT_CLOCK_SKEW_MS = 5min` (`src/identity/verify.ts:7`). Per-stamp `at` fields are **informational**, not enforced for replay, in the default verifier path.

If a handler needs per-stamp freshness (e.g. *"the accountability stamp must be fresh, even if the origin envelope is older"*), it expresses this through `ChainPolicy.maxStampAgeSeconds` (see §4.4). Without that predicate, an envelope whose origin timestamp is fresh but whose later stamps were applied hours later still verifies — by design.

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
  // optional: per-stamp freshness — reject any stamp whose `at` is older than this
  maxStampAgeSeconds?: number;
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

**Single source of truth.** In Phase 2, `verifyEnvelopeIdentity` is reimplemented as a thin wrapper around `verifyEnvelopeIdentityChain` with an empty/permissive policy that returns the outermost stamp's principal. Two ergonomic call sites, one verification implementation. This avoids the long-term drift trap where a fix lands in one verifier but not the other.

### 4.5 Append API

```typescript
// sign.ts
// Existing function unchanged — produces a one-element chain.
export function signEnvelope(envelope, privateKey, principal): MyelinEnvelope;

// New: append a stamp to an already-signed envelope.
// Returns a new envelope; does NOT mutate the input.
export function appendStamp(
  envelope: MyelinEnvelope,
  privateKey: string,
  principal: string,
  role: StampRole,
): Promise<MyelinEnvelope>;
```

`appendStamp` enforces: there must already be ≥1 stamp, the new stamp's `prev_sig_hash` is computed automatically, the resulting envelope is canonicalized + signed correctly, and the input envelope is not mutated.

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

**Why rejected:** This is the COSE 8152 mistake in disguise. SHA-256 is collision-resistant for fresh random inputs but the chain hash isn't computed over fresh random input — it's over a structured signature whose preimage an attacker may partially control (via choice of message or stamp metadata). Binding the prior chain *content* into the canonical input means stamp N's signature commits to the entire prior chain semantically, not just to a 32-byte hash that an attacker might find a way to reuse. Belt and braces — the inclusion of full prior chain bytes is the primary defense; `prev_sig_hash` is a fast-path integrity check and an explicit chain-position marker.

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
| AC-2 | Each stamp's signature covers JCS-canonical bytes of `{signable_envelope_fields, signed_by: chain_so_far + this_stamp_minus_signature}`. Only the `signature` field of the current stamp is excluded from canonical input — every other per-stamp field (`method`, `principal`, `role`, `at`, `prev_sig_hash`, and `stamped_by` for hub-stamps) is included. |
| AC-3 | Chain-position invariants: (a) `signed_by[0]` MUST NOT carry `prev_sig_hash`; (b) `signed_by[i]` for `i > 0` MUST carry `prev_sig_hash = base64(sha256(signed_by[i-1].signature))`; (c) verifier rejects when either invariant is violated. |
| AC-4 | `verifyEnvelopeIdentityChain` returns ordered per-stamp verdicts plus an aggregate status. |
| AC-5 | `ChainPolicy` can express min-length, required role, required principal type, exact principal, forbidden roles, and `maxStampAgeSeconds` per-stamp freshness. |
| AC-6 | `appendStamp` and `appendHubStamp` produce envelopes that round-trip through verification, and never mutate the input envelope. |
| AC-7 | All MY-400 single-signer tests still pass under the new code path (back-compat). |
| AC-8 | JSON Schema accepts both `SignedBy` and `SignedBy[]` shapes. |
| AC-9 | Documented contract (this spec or a successor) lists fields inside vs. outside the chain, including the hard contract that mutable fields MUST NOT drive trust decisions. |
| AC-10 | Stripping any stamp from a 2+ stamp envelope causes `verifyEnvelopeIdentityChain` to reject with a chain-integrity reason. |
| AC-11 | Mutating any stamp's `principal`, `role`, `at`, `prev_sig_hash`, or `stamped_by` causes that stamp's verdict to fail. |
| AC-12 | Reordering any pair of stamps in a 2+ stamp envelope causes verification to fail. Implementations MUST NOT sort, deduplicate, or reorder `signed_by[]` for canonicalization. |
| AC-13 | `prev_sig_hash` is fixed to SHA-256 in v1; rejecting envelopes whose `prev_sig_hash` length is not the SHA-256 base64 length is acceptable. Future hash agility is a separate, explicitly-versioned change. |

## 9. Open questions

1. **Role taxonomy + per-stamp escape hatch.** Two coupled questions, decide together: (a) Is `{origin, transit, accountability, sovereignty-assertion, notary}` the right starter set, or open-ended (string)? (b) Per Q5 below, will stamps carry their own `extensions` bag? Recommendation: closed enum + per-stamp `extensions` (so `extensions.custom_role` is INSIDE the chain, not the envelope-level mutable bag). Resolving Q5 first determines whether the closed-enum decision has a real escape hatch or only a non-attested one.
2. **`hub-stamp` semantics inside a chain.** When a hub stamps on behalf of an agent mid-chain, does the chain index it under the agent's principal (the *attested* identity) or the hub's (the *signing* key)? Proposal: `principal` is the attested identity, `stamped_by` is the signing hub — same as today. Document this.
3. **Hub-stamp authority composition (security-critical).** Today the registry treats hub authorization as a single bit (*"hub H may stamp for principal P"*). With chains, that bit applies to **any** role at **any** index — including a hub injecting `role: accountability` for a principal that never delegated accountability authority. Chains give hubs strictly more power than they had in MY-400. Strong recommendation: **role-scoped hub authority** in the registry — *"hub H may stamp `transit` for P but not `accountability`"* — resolved before implementation, not deferred. Concrete shape options: per-role allowlist on `Principal.is_hub`, or a separate `HubAuthorizationGrant` type. Decide here.
4. **Mutable-field hashing.** Should we add an optional `mutable_fields_hash` *outside* the chain so observers can detect when intermediaries have annotated, even if they can't prove what was changed? (Cheap, additive, observability win — but maybe out of scope.)
5. **Per-stamp `extensions`.** Do we want each stamp to carry its own opaque `extensions` field for hop-specific metadata (timing, evidence references)? Coupled to Q1 — see above. Recommendation: yes, cheap, and unlocks a real role escape hatch.
6. **Verifier ergonomics.** Most call sites today only care about "is this verified at all" — the `requireVerifiedIdentity` shape. Should chain policy be **opt-in via a new function** (proposed) or **default with a relaxed policy** (`minLength: 1`)? Recommendation: opt-in. Less risk of subtle behavior shift.
7. **Per-stamp freshness default.** Replay protection runs against `envelope.timestamp` only by default (§4.3.1). Should there be a recommended `maxStampAgeSeconds` for sensitive roles (e.g. `accountability`), and where does that recommendation live — in code, in this spec, or in handler-level policy docs?
8. **Chain length cap.** Should we set a hard max chain length to avoid pathological envelopes? Probably 16; pick a number.
9. **Hub-on-hub.** Can a hub-stamp stamp another hub-stamp? Yes mechanically — but is there a use case? Document as supported, no special handling.

## 10. Out of scope

See §2 *Non-goals* for the full list with rationale. The one item not covered there:

- Cross-operator trust roots / federation handshake. Each operator is sovereign over its principal registry; cross-operator trust establishment is a separate problem.

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
