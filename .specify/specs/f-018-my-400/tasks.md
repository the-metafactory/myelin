# Implementation Tasks: MY-400 — Layer 4 Identity

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | |
| T-1.2 | ☐ | |
| T-1.3 | ☐ | |
| T-1.4 | ☐ | |
| T-2.1 | ☐ | |
| T-2.2 | ☐ | |
| T-2.3 | ☐ | |
| T-3.1 | ☐ | |
| T-3.2 | ☐ | |
| T-3.3 | ☐ | |
| T-4.1 | ☐ | |
| T-4.2 | ☐ | |
| T-4.3 | ☐ | |
| T-5.1 | ☐ | |
| T-5.2 | ☐ | |
| T-6.1 | ☐ | |

---

## Group 1: Foundation — Types & Envelope Extension

### T-1.1: Define identity types [T]
- **File:** `src/identity/types.ts`
- **Test:** `src/identity/types.test.ts`
- **Dependencies:** none
- **Description:** Create core identity types:
  - `PrincipalType` = `'agent' | 'service' | 'operator'`
  - `Principal` interface (id, display_name?, operator, public_key, type, created_at, is_hub?)
  - `SigningMethod` = `'ed25519' | 'hub-stamp'`
  - `SignedByEd25519` interface (method, principal, signature, at)
  - `SignedByHubStamp` interface (method, principal, stamped_by, at)
  - `SignedBy` discriminated union
  - `VerificationResult` type (verified | unverified | rejected)
- **Acceptance:** Types compile, test file imports all types successfully

### T-1.2: Add signed_by to MyelinEnvelope [T]
- **File:** `src/types.ts`
- **Test:** `src/envelope.test.ts` (extend existing)
- **Dependencies:** T-1.1
- **Description:** 
  - Import `SignedBy` from `./identity/types`
  - Add `signed_by?: SignedBy` to `MyelinEnvelope` interface
- **Acceptance:** Existing tests pass, envelope can include signed_by field

### T-1.3: Update validateEnvelope for signed_by [T]
- **File:** `src/envelope.ts`
- **Test:** `src/envelope.test.ts` (extend existing)
- **Dependencies:** T-1.1, T-1.2
- **Description:**
  - Add `'signed_by'` to `allowedFields` set (line 92)
  - Add validation for `signed_by` structure when present:
    - `method` must be `'ed25519'` or `'hub-stamp'`
    - `principal` must be string matching `did:mf:<name>` pattern
    - `at` must be valid ISO-8601 timestamp
    - If `method === 'ed25519'`: `signature` required (Base64 string)
    - If `method === 'hub-stamp'`: `stamped_by` required (DID string)
- **Acceptance:** 
  - Envelope without signed_by validates (backwards compat)
  - Envelope with valid signed_by validates
  - Envelope with malformed signed_by rejected with clear errors

### T-1.4: Create identity module index [P with T-1.3]
- **File:** `src/identity/index.ts`
- **Test:** none (export only)
- **Dependencies:** T-1.1
- **Description:** Export all types from identity module:
  ```typescript
  export type { Principal, PrincipalType, SignedBy, SignedByEd25519, SignedByHubStamp, SigningMethod, VerificationResult } from './types';
  ```
- **Acceptance:** Types importable from `./identity`

---

## Group 2: Signing — Canonicalization & Ed25519

### T-2.1: Implement JCS canonicalization [T]
- **File:** `src/identity/canonicalize.ts`
- **Test:** `src/identity/canonicalize.test.ts`
- **Dependencies:** T-1.1
- **Description:** 
  - Implement RFC 8785 JSON Canonicalization Scheme:
    - Deterministic key ordering (lexicographic)
    - Specific number serialization (no trailing zeros)
    - Unicode normalization (NFC)
  - `canonicalizeForSigning(envelope)` → returns Uint8Array (UTF-8 bytes)
  - Only include signable fields: id, source, type, timestamp, sovereignty, payload
  - Exclude: correlation_id, economics, extensions, signed_by
- **Test vectors:** Use RFC 8785 test vectors + custom envelope test from plan
- **Acceptance:** 
  - Same envelope always produces identical bytes
  - Reordered keys produce same output
  - Unicode edge cases handled

### T-2.2: Add @noble/ed25519 dependency
- **File:** `package.json`
- **Test:** none
- **Dependencies:** none
- **Description:** 
  ```bash
  bun add @noble/ed25519@^2.2.0
  ```
- **Acceptance:** Dependency installed, importable

### T-2.3: Implement signEnvelope [T]
- **File:** `src/identity/sign.ts`
- **Test:** `src/identity/sign.test.ts`
- **Dependencies:** T-2.1, T-2.2
- **Description:**
  - `signEnvelope(envelope, privateKey, principal)` → MyelinEnvelope with signed_by
  - Throws if envelope already has signed_by
  - Uses canonicalizeForSigning() for signing payload
  - Uses @noble/ed25519 for signing
  - Sets `method: 'ed25519'`, `at: new Date().toISOString()`
  - Returns new envelope object (immutable)
- **Acceptance:**
  - Signed envelope has valid signed_by structure
  - Cannot re-sign already signed envelope
  - Signature verifiable with corresponding public key

---

## Group 3: Registry — Principal Storage & Lookup

### T-3.1: Define PrincipalRegistry interface [T]
- **File:** `src/identity/registry.ts`
- **Test:** `src/identity/registry.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  - `PrincipalRegistry` interface:
    - `resolve(did: string): Principal | null`
    - `list(): Principal[]`
    - `trustedHubs(): Principal[]`
    - `add(principal: Principal): void`
  - `PrincipalRegistryFile` type for JSON schema (version, principals, trusted_hubs)
- **Acceptance:** Interface compiles, test uses interface type

### T-3.2: Implement InMemoryRegistry [T] [P with T-3.3]
- **File:** `src/identity/registry.ts` (same file)
- **Test:** `src/identity/registry.test.ts`
- **Dependencies:** T-3.1
- **Description:**
  - `createInMemoryRegistry(): PrincipalRegistry`
  - Map-backed implementation
  - Separate set for trusted hub DIDs
- **Acceptance:**
  - add() then resolve() returns principal
  - trustedHubs() returns only principals with is_hub: true
  - list() returns all principals

### T-3.3: Implement JsonFileRegistry [T] [P with T-3.2]
- **File:** `src/identity/registry.ts` (same file)
- **Test:** `src/identity/registry.test.ts`
- **Dependencies:** T-3.1
- **Description:**
  - `loadRegistry(path?: string): PrincipalRegistry`
  - Default path: `~/.config/metafactory/principals.json`
  - Validates JSON structure on load
  - Throws with clear error if file missing/malformed
  - Read-only for v1 (add() throws or no-ops with warning)
- **Acceptance:**
  - Loads valid JSON file
  - Throws on missing file with helpful message
  - Throws on invalid JSON structure

---

## Group 4: Verification — Identity Checking

### T-4.1: Implement verifyEnvelopeIdentity [T]
- **File:** `src/identity/verify.ts`
- **Test:** `src/identity/verify.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-3.1, T-3.2
- **Description:**
  - `verifyEnvelopeIdentity(envelope, registry)` → VerificationResult
  - Returns `{ status: 'rejected', reason }` if:
    - No signed_by field (strict mode)
    - Principal not in registry
    - Signature verification fails
    - Hub-stamp from untrusted hub
    - Timestamp outside tolerance (configurable, default 5 min)
  - Returns `{ status: 'verified', principal, method }` on success
- **Acceptance:** All verification paths tested per spec edge cases

### T-4.2: Implement Ed25519 verification [T]
- **File:** `src/identity/verify.ts` (same file)
- **Test:** `src/identity/verify.test.ts`
- **Dependencies:** T-4.1
- **Description:**
  - Internal helper: `verifyEd25519Signature(envelope, principal)`
  - Re-canonicalize envelope, verify signature with public key
  - Handle tampered payload detection
- **Acceptance:**
  - Valid signature verifies
  - Tampered payload rejects
  - Wrong key rejects

### T-4.3: Implement hub-stamp verification [T]
- **File:** `src/identity/verify.ts` (same file)
- **Test:** `src/identity/verify.test.ts`
- **Dependencies:** T-4.1
- **Description:**
  - Internal helper: `verifyHubStamp(envelope, registry)`
  - Check `stamped_by` DID is in `registry.trustedHubs()`
  - No cryptographic verification (trust the hub's assertion)
- **Acceptance:**
  - Trusted hub stamp verifies
  - Untrusted hub stamp rejects

---

## Group 5: Integration — Exports & E2E

### T-5.1: Wire module exports [P with T-5.2]
- **File:** `src/identity/index.ts`, `src/index.ts`
- **Test:** none (export only)
- **Dependencies:** T-2.3, T-3.3, T-4.3
- **Description:**
  - Export from `src/identity/index.ts`:
    - Types: Principal, PrincipalType, SignedBy, VerificationResult, SigningMethod
    - Functions: signEnvelope, verifyEnvelopeIdentity, requireVerifiedIdentity
    - Registry: PrincipalRegistry, loadRegistry, createInMemoryRegistry
    - Canonicalize: canonicalizeForSigning
  - Export identity module from `src/index.ts`:
    ```typescript
    export * from './identity';
    ```
- **Acceptance:** All identity exports available from `@the-metafactory/myelin`

### T-5.2: Write integration test [T] [P with T-5.1]
- **File:** `src/identity/integration.test.ts`
- **Test:** (this is the test)
- **Dependencies:** T-2.3, T-3.2, T-4.1
- **Description:**
  - End-to-end test: create envelope → sign → verify
  - Test flow:
    1. Create in-memory registry with test principal
    2. Create envelope via createEnvelope()
    3. Sign with signEnvelope()
    4. Verify with verifyEnvelopeIdentity()
    5. Assert verified status with correct principal
  - Negative test: tamper with payload, verify rejection
- **Acceptance:** Full round-trip works, tampering detected

---

## Group 6: Documentation

### T-6.1: Write identity documentation
- **File:** `docs/identity.md`
- **Test:** none
- **Dependencies:** T-5.1
- **Description:**
  - Principal format and DID scheme (`did:mf:<name>`)
  - `source` vs `signed_by` relationship (display label vs verified identity)
  - NATS transport binding (NATS user → DID mapping)
  - Hub-stamp vs Ed25519 trust models
  - Code examples for common operations:
    - Creating and signing an envelope
    - Setting up a registry
    - Verifying incoming envelopes
- **Acceptance:** Documentation covers all spec requirements

---

## Execution Order

```
Phase 1 (Foundation):
├── T-1.1 (types) ─────────────────────┬──► T-1.4 (index)
│                                      │
└──► T-1.2 (envelope type) ──► T-1.3 (validation)

Phase 2 (Signing):
├── T-2.2 (dependency) ──┬
│                        ├──► T-2.3 (signEnvelope)
└── T-2.1 (canonicalize) ┘

Phase 3 (Registry):
└── T-3.1 (interface) ──┬──► T-3.2 (in-memory) [parallel]
                        └──► T-3.3 (json-file) [parallel]

Phase 4 (Verification):
└── T-4.1 (verify core) ──┬──► T-4.2 (ed25519)
                          └──► T-4.3 (hub-stamp)

Phase 5 (Integration):
└── T-5.1 (exports) ──┬ [parallel]
    T-5.2 (e2e test) ─┘

Phase 6 (Docs):
└── T-6.1 (documentation)
```

### Parallelization Summary

| Phase | Parallelizable Tasks |
|-------|---------------------|
| 1 | T-1.3 + T-1.4 |
| 2 | T-2.1 + T-2.2 |
| 3 | T-3.2 + T-3.3 |
| 4 | T-4.2 + T-4.3 (after T-4.1) |
| 5 | T-5.1 + T-5.2 |

### Critical Path

T-1.1 → T-1.2 → T-1.3 → T-2.1 → T-2.3 → T-4.1 → T-5.2

---

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
