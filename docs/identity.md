# Layer 4: Identity

Transport-independent verifiable principal model for the metafactory agentic nervous system.

## Overview

Every envelope can carry a `signed_by` field that cryptographically proves who sent it. The identity layer sits between the envelope format (M3) and the transport (M2) — it works the same regardless of whether the message rode NATS, gRPC, or an in-memory test bus.

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

## Signing Methods

### Ed25519 (agent-signed)

The agent holds a keypair and signs the envelope directly. Any consumer can verify without trusting a hub.

```typescript
import { createEnvelope, signEnvelope, verifyEnvelopeIdentity, createInMemoryRegistry } from "@the-metafactory/myelin";

// Setup
const registry = createInMemoryRegistry();
registry.add({
  id: "did:mf:echo",
  operator: "metafactory",
  public_key: publicKeyBase64,
  type: "agent",
  created_at: "2026-05-07T00:00:00Z",
});

// Sign
const envelope = createEnvelope({
  source: "metafactory.echo.local",
  type: "review.completed",
  sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only" },
  payload: { pr: 42, verdict: "approved" },
});
const signed = await signEnvelope(envelope, privateKeyBase64, "did:mf:echo");

// Verify
const result = await verifyEnvelopeIdentity(signed, registry);
// result.status === "verified", result.principal.id === "did:mf:echo"
```

### Hub-stamp (hub-signed)

The hub signs the envelope with its own key, attesting that the named principal is authenticated at the transport level. Faster for intra-operator trust (one signature instead of per-agent keys), but requires trusting the hub.

```typescript
signed_by: {
  method: "hub-stamp",
  principal: "did:mf:echo",       // who the hub attests sent this
  stamped_by: "did:mf:hub.metafactory", // the hub doing the attesting
  signature: "<base64>",           // hub's Ed25519 signature
  at: "2026-05-07T12:00:00Z",
}
```

Verification resolves the hub's public key from the registry and checks the signature — same crypto as ed25519, but the signing key belongs to the hub.

Creating a hub-stamp (hub-side code):
```typescript
import { canonicalizeForSigning } from "@the-metafactory/myelin";
import { signAsync } from "@noble/ed25519";

const signedByMeta = {
  method: "hub-stamp" as const,
  principal: "did:mf:echo",
  stamped_by: "did:mf:hub.metafactory",
  signature: "",
  at: new Date().toISOString(),
};
const envelopeForSigning = { ...envelope, signed_by: signedByMeta };
const message = canonicalizeForSigning(envelopeForSigning);
const sig = await signAsync(message, hubPrivateKeyBytes);
envelope.signed_by = { ...signedByMeta, signature: Buffer.from(sig).toString("base64") };
```

## Canonical Signing Payload

The signature covers a deterministic JSON representation (RFC 8785 JCS) of these fields:

- `id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`
- `signed_by` (method, principal, stamped_by, at — **excluding `signature`**)

Excluded fields (mutable without invalidating signature):
- `correlation_id`, `economics`, `extensions`

This means hubs and relays can add routing metadata (`extensions`) or correlation IDs without breaking signatures, but cannot rewrite the identity claim or timestamp.

## Verification Rules

`verifyEnvelopeIdentity(envelope, registry)` returns one of:

| Status | When |
|--------|------|
| `verified` | Signature valid, principal known, timestamp fresh |
| `unverified` | Reserved — present in the type union for future iteration (not returned by current implementation) |
| `rejected` | Missing `signed_by`, unknown principal, bad signature (ed25519), untrusted hub (hub-stamp), stale/unparseable timestamp, wrong-length signature or key, unknown signing method |

Unsigned envelopes are always rejected. No permissive path in v1.

Clock skew tolerance: 5 minutes by default, configurable via `{ clockSkewMs }`.

### `requireVerifiedIdentity`

Convenience wrapper that throws on any non-verified result:

```typescript
import { requireVerifiedIdentity } from "@the-metafactory/myelin";

const principal = await requireVerifiedIdentity(envelope, registry);
// throws Error("Identity verification failed: ...") if not verified
```

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
