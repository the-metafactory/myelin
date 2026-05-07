# Technical Plan: MY-400 — Layer 4 Identity

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            OPERATOR BOUNDARY                             │
│                                                                          │
│  ┌──────────┐    signEnvelope()     ┌────────────┐     publish()        │
│  │  Agent   │──────────────────────>│  Envelope  │─────────────────┐    │
│  │  (echo)  │                       │  w/signed_by│                │    │
│  └──────────┘                       └────────────┘                 │    │
│       │                                                            │    │
│       │ Ed25519 private key                                        ▼    │
│       │ from ~/.config/mf/<agent>/identity.json         ┌─────────────┐ │
│                                                         │    NATS     │ │
│  ┌────────────────────────────────────────────┐         │    Hub      │ │
│  │          Principal Registry                │         └──────┬──────┘ │
│  │  ~/.config/metafactory/principals.json     │                │        │
│  │                                            │                │        │
│  │  { "did:mf:echo": { public_key: "...", } }│                │        │
│  └────────────────────────────────────────────┘                │        │
│                                                                ▼        │
│  ┌──────────┐    verifyEnvelopeIdentity()    ┌────────────────────────┐ │
│  │Subscriber│<───────────────────────────────│  Incoming Envelope     │ │
│  │  (luna)  │     resolve principal          │  w/signed_by           │ │
│  └──────────┘     verify signature           └────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

Verification Flow:
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  envelope.signed_by.method === "ed25519"                                │
│        │                                                                 │
│        ├─► registry.resolve(signed_by.principal)                        │
│        │       │                                                         │
│        │       └─► principal.public_key                                  │
│        │               │                                                 │
│        │               ▼                                                 │
│        └─► ed25519.verify(signature, canonicalBody, publicKey)          │
│                │                                                         │
│                ├─► TRUE  → { status: "verified", principal, method }    │
│                └─► FALSE → { status: "rejected", reason: "..." }        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Signing | `@noble/ed25519` | Pure JS, ~50μs/op, no native deps, 8KB |
| Canonicalization | RFC 8785 (JCS) | Deterministic JSON, ~2KB pure JS impl |
| Key encoding | Base64 (standard) | Interop with NATS NKeys (Base32) via mapping |
| Registry | JSON file | Simple, no deps, operator-controlled |

**Dependency additions to package.json:**
```json
{
  "dependencies": {
    "@noble/ed25519": "^2.2.0"
  }
}
```

No additional dev dependencies needed.

## Data Model

### Principal

```typescript
// src/identity/types.ts

export type PrincipalType = 'agent' | 'service' | 'operator';

export interface Principal {
  /** DID-style identifier: "did:mf:<name>" */
  id: string;
  /** Human-readable display name (optional) */
  display_name?: string;
  /** Operator namespace (matches envelope source org segment) */
  operator: string;
  /** Base64-encoded Ed25519 public key (32 bytes → 44 chars) */
  public_key: string;
  /** Principal type */
  type: PrincipalType;
  /** Creation timestamp */
  created_at: string;
  /** Whether this principal can issue hub-stamps */
  is_hub?: boolean;
}
```

### SignedBy (envelope extension)

```typescript
// src/identity/types.ts

export type SigningMethod = 'ed25519' | 'hub-stamp';

export interface SignedByEd25519 {
  method: 'ed25519';
  principal: string;          // "did:mf:echo"
  signature: string;          // Base64 Ed25519 signature
  at: string;                 // ISO-8601 timestamp
}

export interface SignedByHubStamp {
  method: 'hub-stamp';
  principal: string;          // "did:mf:echo" (asserted identity)
  stamped_by: string;         // "did:mf:hub.metafactory" (hub's DID)
  at: string;                 // ISO-8601 timestamp
}

export type SignedBy = SignedByEd25519 | SignedByHubStamp;
```

### Extended MyelinEnvelope

```typescript
// src/types.ts (update existing)

export interface MyelinEnvelope {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  correlation_id?: string;
  sovereignty: Sovereignty;
  economics?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  signed_by?: SignedBy;      // ← NEW (optional for backwards compat)
  payload: Record<string, unknown>;
}
```

### Verification Result

```typescript
// src/identity/types.ts

export type VerificationResult =
  | { status: 'verified'; principal: Principal; method: SigningMethod }
  | { status: 'unverified'; reason: string }
  | { status: 'rejected'; reason: string };
```

### Principal Registry Interface

```typescript
// src/identity/registry.ts

export interface PrincipalRegistry {
  /** Resolve a DID to its Principal, or null if unknown */
  resolve(did: string): Principal | null;
  
  /** List all known principals */
  list(): Principal[];
  
  /** Get trusted hub principals whose hub-stamps are accepted */
  trustedHubs(): Principal[];
  
  /** Add a principal to the registry (for testing/setup) */
  add(principal: Principal): void;
}
```

### JSON Registry File Schema

```typescript
// ~/.config/metafactory/principals.json

interface PrincipalRegistryFile {
  version: 1;
  principals: Principal[];
  trusted_hubs: string[];  // DIDs of trusted hub principals
}
```

## API Contracts

### Signing

```typescript
// src/identity/sign.ts

/**
 * Sign an envelope with Ed25519 private key.
 * 
 * @param envelope - Envelope to sign (must not have signed_by already)
 * @param privateKey - Base64-encoded Ed25519 private key (64 bytes seed+pub or 32 bytes seed)
 * @param principal - DID of the signing principal
 * @returns Envelope with signed_by field added
 * @throws Error if envelope already has signed_by
 */
export function signEnvelope(
  envelope: MyelinEnvelope,
  privateKey: string,
  principal: string,
): MyelinEnvelope;

/**
 * Create the canonical bytes for signing.
 * Uses RFC 8785 (JCS) for deterministic JSON serialization.
 * Signs: id, source, type, timestamp, sovereignty, payload (not extensions/economics)
 */
export function canonicalizeForSigning(envelope: MyelinEnvelope): Uint8Array;
```

### Verification

```typescript
// src/identity/verify.ts

/**
 * Verify envelope identity claim.
 * 
 * @param envelope - Envelope with signed_by field
 * @param registry - Principal registry for key lookup
 * @returns Verification result with status and details
 */
export function verifyEnvelopeIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
): VerificationResult;

/**
 * Strict verification that rejects unsigned envelopes.
 * For consumers that require identity verification.
 */
export function requireVerifiedIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
): Principal;  // throws if not verified
```

### Registry

```typescript
// src/identity/registry.ts

/**
 * Load registry from JSON file.
 * 
 * @param path - Path to principals.json (default: ~/.config/metafactory/principals.json)
 * @returns PrincipalRegistry instance
 * @throws Error if file missing or malformed
 */
export function loadRegistry(path?: string): PrincipalRegistry;

/**
 * Create in-memory registry for testing.
 */
export function createInMemoryRegistry(): PrincipalRegistry;
```

## Implementation Phases

### Phase 1: Types + Core Identity (Day 1)

**Files created:**
- `src/identity/types.ts` — Principal, SignedBy, VerificationResult types
- `src/identity/index.ts` — Module exports

**Files modified:**
- `src/types.ts` — Add optional `signed_by` field to MyelinEnvelope
- `src/envelope.ts` — Update `validateEnvelope()` to allow `signed_by` field
- `src/index.ts` — Export identity types

**Tasks:**
1. Define all identity types
2. Add `signed_by` to allowed fields in `validateEnvelope()` (line 92)
3. Add validation rules for `signed_by` structure (if present)
4. Write tests for envelope validation with/without signed_by

### Phase 2: Signing (Day 1-2)

**Files created:**
- `src/identity/canonicalize.ts` — RFC 8785 JCS implementation
- `src/identity/sign.ts` — signEnvelope function
- `src/identity/sign.test.ts` — Unit tests

**Tasks:**
1. Implement JCS canonicalization (RFC 8785)
   - Deterministic key ordering
   - Unicode normalization
   - Number serialization rules
2. Implement `signEnvelope()`
3. Add `@noble/ed25519` dependency
4. Write tests for canonicalization determinism
5. Write tests for sign round-trip

### Phase 3: Registry (Day 2)

**Files created:**
- `src/identity/registry.ts` — PrincipalRegistry interface + implementations
- `src/identity/registry.test.ts` — Unit tests

**Tasks:**
1. Implement `PrincipalRegistry` interface
2. Implement `JsonFileRegistry` class
3. Implement `InMemoryRegistry` for testing
4. Add validation for principal schema
5. Write tests for registry operations

### Phase 4: Verification (Day 2-3)

**Files created:**
- `src/identity/verify.ts` — Verification functions
- `src/identity/verify.test.ts` — Unit tests

**Tasks:**
1. Implement `verifyEnvelopeIdentity()`
2. Implement Ed25519 signature verification
3. Implement hub-stamp verification
4. Add clock skew tolerance (default 5 min)
5. Write tests for all verification paths:
   - Valid ed25519 signature
   - Invalid signature (tampered)
   - Unknown principal
   - Missing signed_by (rejected in strict mode)
   - Hub-stamp from trusted hub
   - Hub-stamp from untrusted hub
   - Clock skew within tolerance
   - Clock skew outside tolerance

### Phase 5: Integration + Export (Day 3)

**Files modified:**
- `src/index.ts` — Export all identity functions
- `src/identity/index.ts` — Clean module exports

**Tasks:**
1. Wire up all exports
2. Write integration test: create → sign → publish → receive → verify
3. Document NATS user → DID mapping
4. Update package exports

### Phase 6: Documentation (Day 3)

**Files created:**
- `docs/identity.md` — Identity layer documentation

**Tasks:**
1. Document Principal format and lifecycle
2. Document source vs signed_by relationship
3. Document NATS transport binding
4. Add examples for common operations

## File Structure

```
src/
├── identity/
│   ├── index.ts              # Module exports
│   ├── types.ts              # Principal, SignedBy, VerificationResult
│   ├── canonicalize.ts       # RFC 8785 JCS implementation
│   ├── canonicalize.test.ts  # Canonicalization tests
│   ├── sign.ts               # signEnvelope function
│   ├── sign.test.ts          # Signing tests
│   ├── verify.ts             # verifyEnvelopeIdentity function
│   ├── verify.test.ts        # Verification tests
│   ├── registry.ts           # PrincipalRegistry implementations
│   └── registry.test.ts      # Registry tests
├── envelope.ts               # (update: allow signed_by field)
├── types.ts                  # (update: add signed_by to MyelinEnvelope)
└── index.ts                  # (update: export identity module)

docs/
└── identity.md               # Identity layer documentation
```

## Dependencies

### Runtime Dependencies

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| `@noble/ed25519` | ^2.2.0 | 8KB | Ed25519 signing/verification |

### No Additional Dev Dependencies

Existing `bun:test` and TypeScript sufficient.

### External Prerequisites

| Prerequisite | Required By | Notes |
|--------------|-------------|-------|
| NATS server | Integration tests | Use `arc nats start` or external |
| `~/.config/metafactory/principals.json` | Runtime | Created manually or by `arc install` |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| JCS implementation edge cases | Medium | Low | Use comprehensive test vectors from RFC 8785 |
| `additionalProperties: false` breaks existing code | High | Medium | Add `signed_by` to allowed set first, before any other changes |
| Clock skew too strict | Low | Medium | Make tolerance configurable, default 5 min |
| Registry file corruption | Medium | Low | Validate on load, fail loudly with clear error |
| NATS NKey ↔ Ed25519 key format mismatch | Medium | Medium | Document mapping, provide conversion helpers if needed |
| Performance regression from signing | Low | Low | Ed25519 is ~50μs; budget is 1ms |

## Open Questions Resolution

| Question | Recommendation | Rationale |
|----------|----------------|-----------|
| JCS (RFC 8785) or simple sort? | **JCS** | Industry standard, handles edge cases (unicode, numbers) |
| Registry path | **`~/.config/metafactory/principals.json`** | Follows XDG, outside arc bundle, operator-editable |
| Async `verifyEnvelopeIdentity`? | **No** (sync for Phase 1) | JSON file is sync-loaded; add async wrapper in Phase 2 if needed for network registry |

## Validation Checklist

### Phase 1 Complete When:
- [ ] `Principal` type exported from `@the-metafactory/myelin`
- [ ] `signed_by` field on `MyelinEnvelope` (optional)
- [ ] `validateEnvelope()` accepts envelopes with valid `signed_by`
- [ ] Existing tests still pass

### Phase 2-4 Complete When:
- [ ] `signEnvelope()` produces valid signatures
- [ ] `verifyEnvelopeIdentity()` verifies correctly
- [ ] `PrincipalRegistry` loads from JSON file
- [ ] All test cases from spec implemented

### Phase 5-6 Complete When:
- [ ] End-to-end test: sign → publish → verify passes
- [ ] NATS user → DID mapping documented
- [ ] `source` vs `signed_by` relationship documented

## Test Vectors

### Canonical JSON (JCS) Test

```typescript
const envelope = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  source: "metafactory.echo.local",
  type: "test.identity.verify",
  timestamp: "2026-05-07T12:00:00Z",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "local-only"
  },
  payload: { message: "hello" }
};

// Expected canonical bytes (UTF-8 encoded)
const canonical = '{"id":"550e8400-e29b-41d4-a716-446655440000","payload":{"message":"hello"},"source":"metafactory.echo.local","sovereignty":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"timestamp":"2026-05-07T12:00:00Z","type":"test.identity.verify"}';
```

### Sign/Verify Round-Trip Test

```typescript
import { signEnvelope, verifyEnvelopeIdentity } from './identity';
import { createEnvelope } from './envelope';

const privateKey = /* Base64 Ed25519 seed */;
const publicKey = /* Base64 Ed25519 public key */;

const registry = createInMemoryRegistry();
registry.add({
  id: 'did:mf:echo',
  operator: 'metafactory',
  public_key: publicKey,
  type: 'agent',
  created_at: '2026-05-07T00:00:00Z',
});

const envelope = createEnvelope({
  source: 'metafactory.echo.local',
  type: 'test.identity.verify',
  sovereignty: { /* ... */ },
  payload: { message: 'hello' },
});

const signed = signEnvelope(envelope, privateKey, 'did:mf:echo');
const result = verifyEnvelopeIdentity(signed, registry);

expect(result.status).toBe('verified');
expect(result.principal.id).toBe('did:mf:echo');
```
