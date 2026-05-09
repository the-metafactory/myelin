# Technical Plan: F-11 — Agent Capability Discovery

## Architecture Overview

```
                              AGENT REGISTRATION FLOW
┌─────────────┐                                           ┌────────────────────────────┐
│   Agent     │  registerCapabilities()                   │  NATS KV                   │
│   (Luna)    │──────────────────────────────────────────>│  AGENT_CAPABILITIES        │
│             │   1. Build advertisement                  │                            │
│             │   2. Sign with Ed25519                    │  key: did:mf:luna          │
│             │   3. KV.put()                             │  value: SignedRegistration │
└─────────────┘                                           │  ttl: 60s                  │
      │                                                   └───────────┬────────────────┘
      │ renew every 30s                                               │
      └───────────────────────────────────────────────────────────────┤
                                                                      │ KV Watch
                                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           CONSUMER (Cortex M7)                                       │
│                                                                                      │
│   watchCapabilities()                                                                │
│      │                                                                               │
│      ├── PUT → verifyCapabilityRegistration()                                       │
│      │         │                                                                     │
│      │         ├── Valid   → handleAgentUpdate(principal, advertisement)            │
│      │         └── Invalid → log.warn("signature failed"), ignore                   │
│      │                                                                               │
│      ├── DEL/PURGE → handleAgentLeave(principal)                                    │
│      │               (TTL expiry or graceful shutdown)                              │
│      │                                                                               │
│      └── Consumer lifecycle manager creates/destroys filtered JetStream consumers   │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              VERIFICATION FLOW
┌────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  SignedCapabilityRegistration                                                       │
│  {                                                                                  │
│    advertisement: { principal, capabilities, sovereignty, load, ... }              │
│    signed_by: { method: "ed25519", principal, signature, at }                      │
│  }                                                                                  │
│          │                                                                          │
│          ▼                                                                          │
│  verifyCapabilityRegistration(registration, registry)                              │
│          │                                                                          │
│          ├─► Check signed_by.principal === advertisement.principal                 │
│          │   (prevent identity spoofing)                                            │
│          │                                                                          │
│          ├─► registry.resolve(principal) → publicKey                               │
│          │                                                                          │
│          └─► ed25519.verify(signature, canonical(advertisement), publicKey)        │
│                                                                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| KV Store | NATS KV (JetStream-backed) | Native watch semantics, already in stack, sub-100ms notification |
| Signing | `@noble/ed25519` (existing) | Already used in MY-400, ~50us/op |
| Canonicalization | RFC 8785 JCS (existing) | Reuse `canonicalizeForSigning` pattern |
| Types | Zod (optional) | Runtime validation; defer if complexity low |
| Async iteration | Native `for await` | Matches existing NATS subscribe patterns |

**No new dependencies.** All primitives exist in codebase.

## Data Model

### KV Bucket Configuration

```typescript
// src/discovery/kv.ts

interface CapabilityKVConfig {
  bucketName: string;          // "AGENT_CAPABILITIES"
  history: number;             // 5 - keep last 5 versions for debugging
  ttl: number;                 // 60_000_000_000 (60s in nanos)
  maxValueSize: number;        // 4096 bytes - thin advertisement only
}

const DEFAULT_CONFIG: CapabilityKVConfig = {
  bucketName: "AGENT_CAPABILITIES",
  history: 5,
  ttl: 60 * 1_000_000_000,    // 60s in nanos
  maxValueSize: 4096,
};
```

### Capability Advertisement (Thin)

```typescript
// src/discovery/types.ts

export type SovereigntyMode = "open" | "selective" | "strict" | "bidding";

export interface CapabilityAdvertisement {
  /** Agent's verified DID identity: "did:mf:luna" */
  principal: string;
  
  /** Capability tags: ["code-review", "typescript", "security-scan"] */
  capabilities: string[];
  
  /** Task acceptance behavior */
  sovereignty: SovereigntyMode;
  
  /** Current utilization [0.0, 1.0] — load = active/maxConcurrent */
  load: number;
  
  /** Task capacity limit */
  maxConcurrent: number;
  
  /** Last modification timestamp (ISO-8601) */
  updatedAt: string;
}
```

### Signed Registration Envelope

```typescript
// src/discovery/types.ts

import type { SignedByEd25519 } from "../identity/types";

export interface SignedCapabilityRegistration {
  advertisement: CapabilityAdvertisement;
  signed_by: SignedByEd25519;  // Reuse MY-400 type; only ed25519 for self-registration
}
```

### Watch Event Types

```typescript
// src/discovery/types.ts

export type CapabilityWatchOperation = "put" | "delete" | "purge";

export interface CapabilityWatchEntry {
  operation: CapabilityWatchOperation;
  key: string;                              // DID: "did:mf:luna"
  revision: number;
  registration?: SignedCapabilityRegistration;  // Present on PUT
}

export type CapabilityWatcher = AsyncIterable<CapabilityWatchEntry>;
```

### Verification Result

```typescript
// src/discovery/types.ts

export type CapabilityVerificationResult =
  | { status: "verified"; principal: string; advertisement: CapabilityAdvertisement }
  | { status: "rejected"; reason: string };
```

## API Contracts

### Registration

```typescript
// src/discovery/register.ts

import type { SigningIdentity } from "../identity/types";
import type { CapabilityAdvertisement, SignedCapabilityRegistration } from "./types";

/**
 * Build and sign a capability registration.
 * Does NOT publish — caller must use CapabilityStore.put().
 */
export function signCapabilityRegistration(
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<SignedCapabilityRegistration>;

/**
 * Convenience: sign and publish to KV in one call.
 */
export function registerCapabilities(
  store: CapabilityStore,
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<void>;

/**
 * Update load field and republish (common operation).
 * Preserves other fields, bumps updatedAt.
 */
export function updateLoad(
  store: CapabilityStore,
  principal: string,
  load: number,
  identity: SigningIdentity,
): Promise<void>;
```

### Verification

```typescript
// src/discovery/verify.ts

import type { PrincipalRegistry } from "../identity/registry";
import type { SignedCapabilityRegistration, CapabilityVerificationResult } from "./types";

/**
 * Verify a capability registration signature.
 * 
 * Checks:
 * 1. signed_by.principal === advertisement.principal (no identity spoofing)
 * 2. Principal exists in registry
 * 3. Signature valid for canonical(advertisement)
 * 4. Timestamp within clock skew tolerance
 */
export function verifyCapabilityRegistration(
  registration: SignedCapabilityRegistration,
  registry: PrincipalRegistry,
  options?: { clockSkewMs?: number },
): Promise<CapabilityVerificationResult>;
```

### KV Store Abstraction

```typescript
// src/discovery/store.ts

import type { SignedCapabilityRegistration, CapabilityWatcher } from "./types";

export interface CapabilityStore {
  /** Put a signed registration. Key = advertisement.principal */
  put(registration: SignedCapabilityRegistration): Promise<void>;
  
  /** Get registration by principal DID */
  get(principal: string): Promise<SignedCapabilityRegistration | null>;
  
  /** Delete registration (graceful shutdown) */
  delete(principal: string): Promise<void>;
  
  /** List all current registrations */
  list(): Promise<SignedCapabilityRegistration[]>;
  
  /** Watch for changes — returns async iterator */
  watch(options?: { startRevision?: number }): CapabilityWatcher;
  
  /** Close connection */
  close(): Promise<void>;
}
```

### NATS KV Implementation

```typescript
// src/discovery/nats-store.ts

import type { NatsConnection } from "@nats-io/transport-node";
import type { CapabilityStore } from "./store";

export interface NATSCapabilityStoreOptions {
  /** NATS connection (or will create one) */
  nc?: NatsConnection;
  /** Connection options if nc not provided */
  servers?: string | string[];
  credentials?: string;
  /** KV bucket name (default: AGENT_CAPABILITIES) */
  bucketName?: string;
}

export class NATSCapabilityStore implements CapabilityStore {
  constructor(options: NATSCapabilityStoreOptions);
  
  /** Ensure KV bucket exists with correct config */
  ensureBucket(): Promise<void>;
  
  // ... implements CapabilityStore interface
}
```

## Implementation Phases

### Phase 1: Types + Interfaces (2-3 hours)

**Files created:**
- `src/discovery/types.ts` — All type definitions
- `src/discovery/index.ts` — Module exports

**Tasks:**
1. Define `CapabilityAdvertisement` interface
2. Define `SovereigntyMode` union type
3. Define `SignedCapabilityRegistration` interface (reuses `SignedByEd25519`)
4. Define `CapabilityWatchEntry` and `CapabilityWatcher` types
5. Define `CapabilityVerificationResult` type
6. Define `CapabilityStore` interface
7. Export all types from index

### Phase 2: Signing + Canonicalization (2-3 hours)

**Files created:**
- `src/discovery/canonicalize.ts` — JCS for advertisements
- `src/discovery/register.ts` — Registration signing
- `src/discovery/register.test.ts` — Unit tests

**Tasks:**
1. Implement `canonicalizeAdvertisement()` — adapts existing JCS pattern
2. Implement `signCapabilityRegistration()` — signs advertisement
3. Implement `registerCapabilities()` — sign + put convenience
4. Implement `updateLoad()` — common load update pattern
5. Tests: round-trip sign, canonical determinism

**Key insight:** Reuse `canonicalizeForSigning` pattern from identity, but sign only the advertisement (not a full envelope).

### Phase 3: Verification (2-3 hours)

**Files created:**
- `src/discovery/verify.ts` — Registration verification
- `src/discovery/verify.test.ts` — Unit tests

**Tasks:**
1. Implement `verifyCapabilityRegistration()`
2. Check principal match: `signed_by.principal === advertisement.principal`
3. Resolve public key from registry
4. Verify Ed25519 signature
5. Check clock skew tolerance
6. Tests: valid sig, invalid sig, principal mismatch, unknown principal, clock skew

### Phase 4: NATS KV Store (3-4 hours)

**Files created:**
- `src/discovery/store.ts` — Store interface
- `src/discovery/nats-store.ts` — NATS KV implementation
- `src/discovery/nats-store.test.ts` — Integration tests

**Tasks:**
1. Implement `NATSCapabilityStore` class
2. Implement `ensureBucket()` — creates KV with TTL config
3. Implement `put()`, `get()`, `delete()`, `list()`
4. Implement `watch()` — async iterator over KV changes
5. JSON encode/decode with error handling
6. Integration tests (requires NATS)

**TTL handling:** NATS KV TTL is per-bucket. Agents must re-PUT before TTL expires (30s interval for 60s TTL).

### Phase 5: In-Memory Store (1-2 hours)

**Files created:**
- `src/discovery/memory-store.ts` — In-memory implementation
- `src/discovery/memory-store.test.ts` — Unit tests

**Tasks:**
1. Implement `InMemoryCapabilityStore` for testing
2. Simulate watch with event emitter pattern
3. Unit tests for store operations

### Phase 6: Integration + Exports (2 hours)

**Files modified:**
- `src/discovery/index.ts` — Full exports
- `src/index.ts` — Export discovery module

**Tasks:**
1. Wire up all exports
2. End-to-end test: register → watch → verify round-trip
3. Test TTL expiry behavior (manual trigger in test)
4. Document module usage in `docs/discovery.md`

## File Structure

```
src/
├── discovery/
│   ├── index.ts                 # Module exports
│   ├── types.ts                 # CapabilityAdvertisement, SignedRegistration, etc
│   ├── canonicalize.ts          # JCS for advertisements
│   ├── register.ts              # signCapabilityRegistration, registerCapabilities
│   ├── register.test.ts         # Registration tests
│   ├── verify.ts                # verifyCapabilityRegistration
│   ├── verify.test.ts           # Verification tests
│   ├── store.ts                 # CapabilityStore interface
│   ├── nats-store.ts            # NATSCapabilityStore implementation
│   ├── nats-store.test.ts       # NATS integration tests
│   ├── memory-store.ts          # InMemoryCapabilityStore (testing)
│   └── memory-store.test.ts     # Memory store tests
├── identity/                    # (existing — reuse types and patterns)
│   ├── types.ts                 # SignedByEd25519, SigningIdentity
│   ├── sign.ts                  # signEnvelope pattern reference
│   └── verify.ts                # verifyEnvelopeIdentity pattern reference
└── index.ts                     # (update: export discovery module)

docs/
└── discovery.md                 # Discovery layer documentation
```

## Dependencies

### Runtime Dependencies

No new dependencies. Uses existing:
- `@noble/ed25519` — Ed25519 signing/verification
- `@nats-io/jetstream` — KV operations
- `@nats-io/transport-node` — NATS connection

### External Prerequisites

| Prerequisite | Required By | Notes |
|--------------|-------------|-------|
| NATS with JetStream | `NATSCapabilityStore` | Use `arc nats start` or external cluster |
| Principal registry | Verification | `~/.config/metafactory/principals.json` |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| TTL race condition — agent renew delayed | Medium | Medium | 30s renew interval for 60s TTL gives 30s buffer; log warning at 45s |
| KV watch reconnect drops events | Medium | Low | Track revision, reconnect from last seen; NATS handles replay |
| Principal mismatch attack | High | Low | Explicit check `signed_by.principal === advertisement.principal` |
| Clock skew across agents | Low | Medium | 5-minute default tolerance; configurable |
| Load field desync with actual state | Low | Medium | Agent responsibility; periodic reconciliation at agent runtime |
| Bucket not created before first put | Medium | Medium | `ensureBucket()` called in `registerCapabilities()` |

## Capability Taxonomy

Per spec §Capability Taxonomy, convention-documented (not runtime registry):

### Starter Vocabulary

| Tag | Description |
|-----|-------------|
| `code-review` | Pull request review |
| `security-scan` | SAST, dependency scan, secret detection |
| `deploy` | Environment promotion (cloudflare, k8s, etc.) |
| `release` | Version cut, changelog, tag |
| `test` | Test suite execution |
| `build` | Artifact compilation |
| `document` | Documentation generation |

### Sub-capability Convention

Hierarchical via dot-notation:
```
code-review.typescript
code-review.python
security-scan.sast
security-scan.dast
deploy.cloudflare
deploy.kubernetes
```

### Operator Extensions

Prefixed with operator namespace:
```
northpower.compliance-check
acme.internal-deploy
```

## Test Vectors

### Canonical Advertisement Test

```typescript
const advertisement: CapabilityAdvertisement = {
  principal: "did:mf:luna",
  capabilities: ["code-review", "typescript"],
  sovereignty: "selective",
  load: 0.5,
  maxConcurrent: 3,
  updatedAt: "2026-05-09T12:00:00Z",
};

// Expected canonical (keys sorted):
const canonical = '{"capabilities":["code-review","typescript"],"load":0.5,"maxConcurrent":3,"principal":"did:mf:luna","sovereignty":"selective","updatedAt":"2026-05-09T12:00:00Z"}';
```

### Sign/Verify Round-Trip Test

```typescript
const identity: SigningIdentity = {
  did: "did:mf:luna",
  privateKey: /* Base64 Ed25519 seed */,
};

const registry = createInMemoryRegistry();
registry.add({
  id: "did:mf:luna",
  operator: "metafactory",
  public_key: /* corresponding public key */,
  type: "agent",
  created_at: "2026-05-09T00:00:00Z",
});

const registration = await signCapabilityRegistration(advertisement, identity);
const result = await verifyCapabilityRegistration(registration, registry);

expect(result.status).toBe("verified");
expect(result.advertisement.principal).toBe("did:mf:luna");
```

### Principal Mismatch Rejection Test

```typescript
const registration: SignedCapabilityRegistration = {
  advertisement: { principal: "did:mf:luna", ... },
  signed_by: { principal: "did:mf:attacker", ... },  // MISMATCH
};

const result = await verifyCapabilityRegistration(registration, registry);
expect(result.status).toBe("rejected");
expect(result.reason).toContain("principal mismatch");
```

## Validation Checklist

### Phase 1 Complete When:
- [ ] `CapabilityAdvertisement` type exported
- [ ] `SignedCapabilityRegistration` type exported
- [ ] `CapabilityStore` interface defined
- [ ] `SovereigntyMode` union type defined

### Phase 2-3 Complete When:
- [ ] `signCapabilityRegistration()` produces valid signatures
- [ ] `registerCapabilities()` signs and calls store.put()
- [ ] `verifyCapabilityRegistration()` validates correctly
- [ ] Principal mismatch detection working
- [ ] Clock skew tolerance configurable

### Phase 4-5 Complete When:
- [ ] `NATSCapabilityStore` creates bucket with TTL
- [ ] `watch()` returns async iterator
- [ ] `InMemoryCapabilityStore` works for unit tests
- [ ] Integration test passes with real NATS

### Phase 6 Complete When:
- [ ] All exports wired in `src/index.ts`
- [ ] E2E test: register → watch → verify
- [ ] Documentation complete in `docs/discovery.md`

## Integration Points

### Cortex (M7) Consumer

Cortex dispatch handler will:
```typescript
const store = new NATSCapabilityStore({ nc });
const registry = loadRegistry();

for await (const entry of store.watch()) {
  if (entry.operation === "put" && entry.registration) {
    const result = await verifyCapabilityRegistration(entry.registration, registry);
    if (result.status === "verified") {
      await ensureConsumersForCapabilities(result.advertisement);
    }
  } else if (entry.operation === "delete" || entry.operation === "purge") {
    await maybeCleanupConsumers(entry.key);
  }
}
```

### Agent Self-Registration

Agents will:
```typescript
const store = new NATSCapabilityStore({ nc });
const identity = loadIdentity();

// Initial registration
await registerCapabilities(store, {
  principal: identity.did,
  capabilities: ["code-review", "typescript"],
  sovereignty: "selective",
  load: 0,
  maxConcurrent: 3,
  updatedAt: new Date().toISOString(),
}, identity);

// Renewal loop (every 30s)
setInterval(() => {
  registerCapabilities(store, currentAdvertisement, identity);
}, 30_000);

// Load updates (on task accept/complete)
await updateLoad(store, identity.did, newLoad, identity);
```

## Out of Scope

Per spec, explicitly NOT in this implementation:

- **Rich capability profiles** (tool inventory, env scope) — M7 per §Stratification
- **Consumer lifecycle manager** — Cortex (M7) responsibility
- **Task routing implementation** — separate spec, uses this registry
- **Health-check TTL automation** — TTL is native NATS KV; agents renew
- **UI for capability management** — future iteration

---

*Plan generated: 2026-05-09*
*Estimated implementation time: 12-16 hours*
*Dependencies: MY-400 identity (done), NATS infrastructure (available)*
