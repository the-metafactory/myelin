# Layer 4: Identity

Transport-independent verifiable principal model for the metafactory agentic nervous system.

## Overview

Every envelope carries a `signed_by` **chain** of cryptographic attestations (myelin#31). The identity layer sits between the envelope format (M3) and the transport (M2) — it works the same regardless of whether the message rode NATS, gRPC, or an in-memory test bus.

The chain reflects the path the envelope took: the origin stamps it first, every relay/hub/policy-enforcer that passes it along can append its own attestation. Each new stamp commits to the prior chain, so tampering with any earlier stamp invalidates every downstream stamp's signature.

## Principals

A principal is a DID-style identifier for any entity in the system:

```
did:mf:echo          — agent
did:mf:hub.metafactory — operator hub
did:mf:signal-tap    — service
```

```typescript
interface Principal {
  id: string;           // "did:mf:echo"
  display_name?: string;
  operator: string;     // "metafactory"
  public_key: string;   // Base64 Ed25519 public key (32 bytes)
  type: "agent" | "service" | "operator";
  created_at: string;   // ISO-8601
  is_hub?: boolean;     // hub principals can issue hub-stamps
}
```

## `source` vs `signed_by`

| Field | Purpose | Verified? |
|-------|---------|-----------|
| `source` | Display label / routing hint | No — self-asserted |
| `signed_by.principal` | Verified identity | Yes — cryptographically |

`source` remains for routing and display. `signed_by` is the trust anchor.

## Chain of Stamps

`MyelinEnvelope.signed_by` is an **array** of stamps. Each stamp signs the canonical bytes of the envelope *including the prior chain*, so a chain of length `N` carries `N` independent signatures, every one of which must verify for the envelope to be trusted.

```typescript
interface SignedBy {
  method: "ed25519" | "hub-stamp";
  principal: string;        // who is attesting
  signature: string;        // base64 Ed25519 signature (64 bytes)
  at: string;               // ISO-8601 timestamp
  role?: StampRole;         // semantic position (optional, see below)
  stamped_by?: string;      // only for hub-stamp method
}
```

### Stamp roles

`role` is a semantic label describing what the stamp ATTESTS, not what the principal IS:

| role | meaning |
|---|---|
| `origin` | first author — the principal that minted the envelope body. |
| `transit` | a relay/hub adding a hop attestation without changing semantics. |
| `accountability` | claims responsibility for downstream effects (audit/compliance handle). |
| `sovereignty` | asserts the envelope was checked against a sovereignty policy. |
| `notary` | third-party witness — neither origin nor transit, just observing. |

`role` is optional for back-compat — pre-#31 stamps don't carry one. Predicate APIs (e.g. `mustIncludeRole`) treat missing roles as not-matching.

### Signing methods

Two methods can appear at any position in a chain:

- `ed25519` — the principal signs with its own Ed25519 keypair. The verifier resolves the public key from the registry.
- `hub-stamp` — a trusted hub signs on the principal's behalf (faster for intra-operator trust). The stamp carries `stamped_by: <hub-did>`; the verifier resolves the hub's key from the registry and checks `trustedHubs()` membership.

## Building a chain

```typescript
import {
  createEnvelope,
  signEnvelope,
  verifyEnvelopeIdentity,
  createInMemoryRegistry,
} from "@the-metafactory/myelin";

const registry = createInMemoryRegistry();
registry.add({ id: "did:mf:echo", operator: "metafactory", public_key: echoPubKey, type: "agent", created_at: "..." });
registry.add({ id: "did:mf:hub.metafactory", operator: "metafactory", public_key: hubPubKey, type: "operator", created_at: "...", is_hub: true });

// Origin stamp.
const envelope = createEnvelope({
  source: "metafactory.echo.local",
  type: "review.completed",
  sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only" },
  payload: { pr: 42, verdict: "approved" },
});
const stamped1 = await signEnvelope(envelope, echoPrivKey, "did:mf:echo", { role: "origin" });

// Hub appends an accountability stamp.
const stamped2 = await signEnvelope(stamped1, hubPrivKey, "did:mf:hub.metafactory", { role: "accountability" });

// stamped2.signed_by.length === 2; stamp[0].signature is preserved bit-for-bit.

const result = await verifyEnvelopeIdentity(stamped2, registry);
if (result.status === "verified") {
  console.log(result.chain.length);                  // 2
  console.log(result.chain.every((v) => v.valid));   // true
  console.log(result.principal.id);                  // "did:mf:hub.metafactory" — LAST verified principal
}
```

### Chain-shape predicates

Use `requireVerifiedIdentity` to express constraints on the chain itself:

```typescript
import { requireVerifiedIdentity } from "@the-metafactory/myelin";

// "Must be signed by an operator-type principal with role=accountability,
// at least two hops deep, with an explicit origin from did:mf:echo."
const principal = await requireVerifiedIdentity(envelope, registry, {
  minLength: 2,
  mustIncludeRole: "accountability",
  mustIncludePrincipalType: "operator",
  mustIncludePrincipal: "did:mf:echo",
});
```

All predicates compose with AND semantics. The function returns the LAST verified principal on success.

## Canonical Signing Payload

The signature for stamp `i` covers a deterministic JSON representation (RFC 8785 JCS) of the envelope:

- **Always inside the signature**: `id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`, `signed_by` (with stamps `0..i-1` keeping their signatures intact and stamp `i`'s own signature stripped — can't sign yourself).
- **Always inside (when present)**: F-021 task routing fields — `requirements`, `sovereignty_required`, `deadline`, `distribution_mode`, `target_principal`.
- **Intentionally outside (mutable without invalidating)**: `correlation_id`, `economics`, `extensions`.

The carve-out for `correlation_id`, `economics`, and `extensions` is deliberate. Hubs and relays MUST be able to:
- thread correlation IDs after the fact,
- aggregate cost into `economics.actual` as work fans out into delegate chains,
- annotate `extensions` with routing hints or trace metadata,

without invalidating any stamp in the chain. The trade-off is that nobody signs what they wrote there — so consumers MUST NOT base trust or security decisions on the contents of those three fields. The architecture doc spells this out (`docs/architecture.md` §5.2). When a relay needs to bind its annotation cryptographically, the answer is to append a stamp, not to bring more fields under the carve-out.

Because each new stamp commits to the prior chain, tampering with any earlier stamp's signature, principal, role, timestamp, or method breaks every downstream stamp's verification. The first failing index is reported in `result.reason` and `result.chain[i].valid === false`.

## Verification Rules

`verifyEnvelopeIdentity(envelope, registry)` walks every stamp in the chain and returns one of:

| Status | When |
|--------|------|
| `verified` | Every stamp's signature valid, every principal known, every timestamp fresh. Returns `chain: StampVerdict[]` with per-stamp `{ index, valid, principal, method }`, plus `principal`/`method` convenience handles bound to the LAST stamp. |
| `unverified` | Reserved — present in the type union for future iteration (not returned by current implementation). |
| `rejected` | Missing/empty `signed_by`, any stamp fails (unknown principal, bad signature, untrusted hub, stale timestamp, wrong-length key or signature, unknown method). `reason` reports the first failing stamp as `stamp[N] (did:mf:...): <detail>`. `chain` is included when failure was deep enough to walk. |

Unsigned envelopes are always rejected. No permissive path in v1.

Clock skew tolerance: 5 minutes by default, configurable via `{ clockSkewMs }`. The same tolerance applies to every stamp in the chain — a chain where stamp 0 is recent but stamp 1 is stale rejects on stamp 1.

### `requireVerifiedIdentity`

Convenience wrapper that throws on any non-verified result and, optionally, on failed chain-shape predicates:

```typescript
import { requireVerifiedIdentity } from "@the-metafactory/myelin";

const principal = await requireVerifiedIdentity(envelope, registry, {
  minLength: 2,                          // chain must be at least 2 stamps deep
  mustIncludeRole: "accountability",     // a stamp in the chain must have this role
  mustIncludePrincipalType: "operator",  // a stamp's principal must have this type
  mustIncludePrincipal: "did:mf:echo",   // a stamp must be by this exact DID
  clockSkewMs: 60_000,                   // override default 5 min tolerance
});
// throws Error("Identity verification failed: ...") if not verified
// returns the LAST verified principal on success
```

All predicates compose with AND semantics.

## Migration from pre-#31

Pre-#31 envelopes carried `signed_by: SignedBy` (single object). Post-#31, the canonical form is `signed_by: SignedBy[]` (chain). To keep the migration cheap:

- **Validator-level back-compat shim.** `validateEnvelope` and the verification path BOTH accept a single-object `signed_by` and normalize it internally to a one-element chain. Existing wire envelopes flowing through the system continue to validate and verify.
- **Wire serialization always emits the array form.** Once an envelope is re-signed or freshly created, its on-the-wire shape is an array. The single-object shape is for input only.
- **`signEnvelope` no longer throws on re-sign.** Pre-#31 callers relied on the "already signed → throw" guard to prevent double-stamping. Post-#31, re-signing is the chain-append affordance. Callers that need the old guard should inspect the existing chain before signing.
- **F-5 readers use `getSignedByChain` and read the LAST stamp.** Sovereignty engine + ingress validator authenticate against the most recent attestor. The `chain_of_stamps.verify_delegation_sovereignty` feature flag stays OFF by default; turning it on opts into walking earlier stamps for delegation policy (F-5 T-6.1, separate PR).

## NATS Transport Binding

| NATS concept | Maps to |
|-------------|---------|
| NATS user name | `did:mf:<username>` |
| NATS NKey | Ed25519 keypair (same key for transport auth + envelope signing) |
| Hub NATS server | Hub principal with `is_hub: true` |

Key insight: NATS NKeys ARE Ed25519 keypairs. One key serves both transport authentication and envelope signing.

## Principal Registry

```typescript
// In-memory (testing)
const registry = createInMemoryRegistry();
registry.add(principal);

// JSON file (production) — pass absolute path, no tilde expansion
import { join } from "node:path";
import { homedir } from "node:os";
const registry = loadRegistry(join(homedir(), ".config", "metafactory", "principals.json"));
```

Registry file format:
```json
{
  "version": 1,
  "principals": [
    {
      "id": "did:mf:echo",
      "operator": "metafactory",
      "public_key": "...",
      "type": "agent",
      "created_at": "2026-05-07T00:00:00Z"
    }
  ],
  "trusted_hubs": ["did:mf:hub.metafactory"]
}
```

`trustedHubs()` returns principals that are either `is_hub: true` OR listed in `trusted_hubs`.

## Out of Scope

- Key management (generation, rotation, storage, revocation)
- Authorization/RBAC (what a principal can do)
- Human identity mapping
- Cross-ecosystem interop (external DID, OIDC, X.509)
- Multi-party co-signing / threshold sigs at a single hop (only sequential append-mode chains for now)
- Revocation lists for compromised principals
