# Implementation Tasks: F-11 Agent Capability Discovery

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Types & interfaces |
| T-1.2 | ☐ | Module exports |
| T-2.1 | ☐ | Canonicalization |
| T-2.2 | ☐ | Registration signing |
| T-2.3 | ☐ | Load update helper |
| T-3.1 | ☐ | Verification logic |
| T-4.1 | ☐ | Store interface |
| T-4.2 | ☐ | NATS KV implementation |
| T-4.3 | ☐ | In-memory store |
| T-5.1 | ☐ | Package exports |
| T-5.2 | ☐ | E2E integration test |
| T-5.3 | ☐ | Documentation |

---

## Group 1: Foundation

### T-1.1: Define capability discovery types [T]
- **File:** `src/discovery/types.ts`
- **Test:** `src/discovery/types.test.ts`
- **Dependencies:** none
- **Description:** Core type definitions for discovery layer

**Types to define:**
```typescript
// From identity/types.ts — reuse these
import type { SignedByEd25519, SigningIdentity } from "../identity/types";

// New types
type SovereigntyMode = "open" | "selective" | "strict" | "bidding";

interface CapabilityAdvertisement {
  principal: string;           // DID: "did:mf:luna"
  capabilities: string[];      // ["code-review", "typescript"]
  sovereignty: SovereigntyMode;
  load: number;               // 0.0-1.0
  maxConcurrent: number;
  updatedAt: string;          // ISO-8601
}

interface SignedCapabilityRegistration {
  advertisement: CapabilityAdvertisement;
  signed_by: SignedByEd25519;  // Only ed25519 for self-registration
}

type CapabilityWatchOperation = "put" | "delete" | "purge";

interface CapabilityWatchEntry {
  operation: CapabilityWatchOperation;
  key: string;                 // DID
  revision: number;
  registration?: SignedCapabilityRegistration;
}

type CapabilityWatcher = AsyncIterable<CapabilityWatchEntry>;

type CapabilityVerificationResult =
  | { status: "verified"; principal: string; advertisement: CapabilityAdvertisement }
  | { status: "rejected"; reason: string };
```

**Validation tests:**
- DID format validation (reuse DID_RE from identity)
- Sovereignty mode literals
- Load clamping (0-1 range)
- maxConcurrent positive integer

---

### T-1.2: Create discovery module exports [P with T-2.1]
- **File:** `src/discovery/index.ts`
- **Dependencies:** T-1.1
- **Description:** Module barrel export — placeholder, updated as tasks complete

```typescript
// Initial stub
export * from "./types";
// Add more as implemented
```

---

## Group 2: Signing & Canonicalization

### T-2.1: Implement advertisement canonicalization [T] [P with T-1.2]
- **File:** `src/discovery/canonicalize.ts`
- **Test:** `src/discovery/canonicalize.test.ts`
- **Dependencies:** T-1.1
- **Description:** JCS canonicalization for capability advertisements

**Implementation:**
- Adapt `canonicalizeForSigning` pattern from `identity/canonicalize.ts`
- Canonicalize advertisement object only (not full registration)
- Keys sorted, deterministic JSON output

**Test vectors:**
```typescript
const ad: CapabilityAdvertisement = {
  principal: "did:mf:luna",
  capabilities: ["code-review", "typescript"],
  sovereignty: "selective",
  load: 0.5,
  maxConcurrent: 3,
  updatedAt: "2026-05-09T12:00:00Z",
};
// Expected canonical:
'{"capabilities":["code-review","typescript"],"load":0.5,"maxConcurrent":3,"principal":"did:mf:luna","sovereignty":"selective","updatedAt":"2026-05-09T12:00:00Z"}'
```

---

### T-2.2: Implement registration signing [T]
- **File:** `src/discovery/register.ts`
- **Test:** `src/discovery/register.test.ts`
- **Dependencies:** T-1.1, T-2.1
- **Description:** Sign capability registrations with Ed25519

**Functions:**
```typescript
// Build and sign registration (doesn't publish)
function signCapabilityRegistration(
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<SignedCapabilityRegistration>;

// Sign and publish in one call
function registerCapabilities(
  store: CapabilityStore,
  advertisement: CapabilityAdvertisement,
  identity: SigningIdentity,
): Promise<void>;
```

**Tests:**
- Sign produces valid SignedCapabilityRegistration
- Principal in signed_by matches advertisement.principal
- Signature is base64-encoded
- Timestamp is ISO-8601
- Reject invalid private key (not 32 bytes)

---

### T-2.3: Implement load update helper [T]
- **File:** `src/discovery/register.ts` (append)
- **Test:** `src/discovery/register.test.ts` (append)
- **Dependencies:** T-2.2
- **Description:** Helper for common load update operation

```typescript
function updateLoad(
  store: CapabilityStore,
  principal: string,
  load: number,
  identity: SigningIdentity,
): Promise<void>;
```

**Behavior:**
- Get existing registration from store
- Update load field, bump updatedAt
- Clamp load to [0, 1], warn if out of range
- Re-sign and put

---

## Group 3: Verification

### T-3.1: Implement registration verification [T]
- **File:** `src/discovery/verify.ts`
- **Test:** `src/discovery/verify.test.ts`
- **Dependencies:** T-1.1, T-2.1
- **Description:** Verify signed capability registrations

```typescript
function verifyCapabilityRegistration(
  registration: SignedCapabilityRegistration,
  registry: PrincipalRegistry,
  options?: { clockSkewMs?: number },
): Promise<CapabilityVerificationResult>;
```

**Verification steps:**
1. Check `signed_by.principal === advertisement.principal` (prevent spoofing)
2. Resolve public key from registry
3. Verify Ed25519 signature against canonical(advertisement)
4. Check timestamp within clock skew tolerance (default 5 min)

**Tests:**
- Valid signature → verified
- Invalid signature → rejected
- Principal mismatch (signed_by ≠ advertisement) → rejected
- Unknown principal → rejected
- Clock skew exceeded → rejected
- Clock skew within tolerance → verified

---

## Group 4: Store Implementations

### T-4.1: Define CapabilityStore interface [T]
- **File:** `src/discovery/store.ts`
- **Test:** (interface only, no unit test)
- **Dependencies:** T-1.1
- **Description:** Abstract store interface for KV operations

```typescript
interface CapabilityStore {
  put(registration: SignedCapabilityRegistration): Promise<void>;
  get(principal: string): Promise<SignedCapabilityRegistration | null>;
  delete(principal: string): Promise<void>;
  list(): Promise<SignedCapabilityRegistration[]>;
  watch(options?: { startRevision?: number }): CapabilityWatcher;
  close(): Promise<void>;
}
```

---

### T-4.2: Implement NATS KV store [T]
- **File:** `src/discovery/nats-store.ts`
- **Test:** `src/discovery/nats-store.test.ts`
- **Dependencies:** T-4.1
- **Description:** NATS KV-backed capability store

**Configuration:**
```typescript
interface NATSCapabilityStoreOptions {
  nc?: NatsConnection;
  servers?: string | string[];
  credentials?: string;
  bucketName?: string;  // default: "AGENT_CAPABILITIES"
}

const BUCKET_CONFIG = {
  history: 5,
  ttl: 60 * 1_000_000_000,  // 60s in nanos
  maxValueSize: 4096,
};
```

**Methods:**
- `ensureBucket()` — create KV bucket with TTL config
- `put()` — JSON encode, store at key = principal
- `get()` — JSON decode, return null if not found
- `delete()` — KV delete
- `list()` — iterate all keys
- `watch()` — async iterator wrapping KV watch

**Tests (integration, requires NATS):**
- Put → get round-trip
- Delete removes entry
- Watch receives PUT event
- Watch receives DEL event
- TTL expiry triggers purge event
- Invalid JSON handled gracefully

---

### T-4.3: Implement in-memory store [T] [P with T-4.2]
- **File:** `src/discovery/memory-store.ts`
- **Test:** `src/discovery/memory-store.test.ts`
- **Dependencies:** T-4.1
- **Description:** In-memory store for unit testing

**Implementation:**
- Map<string, { registration, revision }> for storage
- EventEmitter pattern for watch simulation
- Auto-increment revision counter

**Tests:**
- Put/get/delete operations
- List returns all entries
- Watch receives events in order
- Multiple watchers receive same events

---

## Group 5: Integration & Polish

### T-5.1: Wire up package exports
- **File:** `src/discovery/index.ts` (update)
- **File:** `src/index.ts` (update)
- **Dependencies:** T-1.1, T-2.2, T-3.1, T-4.1, T-4.2, T-4.3
- **Description:** Export all discovery types and functions

```typescript
// src/discovery/index.ts
export * from "./types";
export { canonicalizeAdvertisement } from "./canonicalize";
export { signCapabilityRegistration, registerCapabilities, updateLoad } from "./register";
export { verifyCapabilityRegistration } from "./verify";
export type { CapabilityStore } from "./store";
export { NATSCapabilityStore } from "./nats-store";
export { InMemoryCapabilityStore } from "./memory-store";

// src/index.ts — add:
export * as discovery from "./discovery";
```

---

### T-5.2: End-to-end integration test [T]
- **File:** `src/discovery/integration.test.ts`
- **Dependencies:** T-2.2, T-3.1, T-4.3
- **Description:** Full round-trip test: register → watch → verify

**Test scenario:**
```typescript
// 1. Setup
const registry = createInMemoryRegistry();
registry.add(lunaIdentity.principal);
const store = new InMemoryCapabilityStore();

// 2. Start watching
const entries: CapabilityWatchEntry[] = [];
const watcher = store.watch();
// (collect in background)

// 3. Register capabilities
await registerCapabilities(store, advertisement, lunaIdentity);

// 4. Verify PUT event received
expect(entries[0].operation).toBe("put");

// 5. Verify signature
const result = await verifyCapabilityRegistration(entries[0].registration!, registry);
expect(result.status).toBe("verified");

// 6. Update load
await updateLoad(store, "did:mf:luna", 0.7, lunaIdentity);

// 7. Verify update event
expect(entries[1].operation).toBe("put");
expect(entries[1].registration!.advertisement.load).toBe(0.7);

// 8. Graceful shutdown
await store.delete("did:mf:luna");
expect(entries[2].operation).toBe("delete");
```

---

### T-5.3: Write discovery documentation
- **File:** `docs/discovery.md`
- **Dependencies:** T-5.1
- **Description:** Document discovery layer usage

**Sections:**
1. Overview — what discovery does
2. Capability Advertisement schema
3. Sovereignty modes explained
4. Agent self-registration example
5. Consumer watch pattern example
6. Capability taxonomy vocabulary
7. TTL/renewal guidance (30s renew for 60s TTL)

---

## Execution Order

```
Phase 1 (Foundation):
  T-1.1  ─────────────────────────────┐
         ├─► T-1.2 ─────────────────►│
         │                            │
Phase 2 (Signing):                    │
         ├─► T-2.1 ─────────────────►│
         │     │                      │
         │     └─► T-2.2 ─► T-2.3 ──►│
         │                            │
Phase 3 (Verification):               │
         └─► T-3.1 ─────────────────►│
                                      │
Phase 4 (Stores):                     │
  T-4.1 ──┬─► T-4.2 ────────────────►│
          └─► T-4.3 ────────────────►│  (parallel)
                                      │
Phase 5 (Integration):                │
  T-5.1 ◄─────────────────────────────┘
    │
    └─► T-5.2 ─► T-5.3
```

**Parallelization opportunities:**
- T-1.2, T-2.1 (both depend only on T-1.1)
- T-4.2, T-4.3 (both depend only on T-4.1)
- T-3.1 can run parallel with T-2.2/T-2.3 (both need T-2.1)

---

## Estimated Effort

| Group | Tasks | Hours |
|-------|-------|-------|
| Foundation | T-1.1, T-1.2 | 2-3h |
| Signing | T-2.1, T-2.2, T-2.3 | 2-3h |
| Verification | T-3.1 | 2-3h |
| Stores | T-4.1, T-4.2, T-4.3 | 4-5h |
| Integration | T-5.1, T-5.2, T-5.3 | 2h |
| **Total** | **12 tasks** | **12-16h** |

---

## Dependencies on External Systems

| Prerequisite | Required By | Notes |
|--------------|-------------|-------|
| NATS with JetStream | T-4.2 tests | Use `arc nats start` |
| Principal registry | T-3.1, T-5.2 | `~/.config/metafactory/principals.json` |

---

## Validation Checklist

### After Group 1:
- [ ] `CapabilityAdvertisement` type compiles
- [ ] `SignedCapabilityRegistration` type compiles
- [ ] Types exported from `src/discovery/index.ts`

### After Group 2:
- [ ] `signCapabilityRegistration()` produces valid signatures
- [ ] Canonical output is deterministic
- [ ] `updateLoad()` clamps values correctly

### After Group 3:
- [ ] Principal mismatch detected and rejected
- [ ] Invalid signatures rejected
- [ ] Clock skew tolerance works

### After Group 4:
- [ ] NATS KV bucket created with correct TTL
- [ ] Watch returns async iterator
- [ ] In-memory store works for unit tests

### After Group 5:
- [ ] All exports wired in `src/index.ts`
- [ ] E2E test passes
- [ ] Documentation complete
