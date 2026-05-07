# Specification: MY-400 — Layer 4 Identity

## Context

> Generated from Interview conducted on 2026-05-07
> Tracks: myelin#8 | Parent: myelin#7 (seven-layer model)
> Related: grove#320 (NATS AAA), grove#321 (manifest identity)

## Problem Statement

**Core Problem**: Identity is split across three unrelated models that don't compose:

| Model | Where | Trust basis | Spoofable? |
|-------|-------|-------------|------------|
| Envelope `source` | MyelinEnvelope field | Self-asserted string | Yes — any agent can claim any source |
| NATS user | Transport-level auth | NATS credential (user/pass or NKey) | No — but only verifiable on NATS |
| Discord `trustedAgentBots` | Surface-level allowlist | Configuration file | No — but only verifiable on Discord |

This means: (a) envelope sovereignty is a gentleman's agreement — any agent can forge a `source` claim, (b) identity verification is transport-locked — you can't verify a sender's identity on a different transport than the one that delivered the message, (c) the trust model is inconsistent — three separate trust decisions for the same conceptual question ("who sent this?").

**Urgency**: Federation requires verifiable identity. An operator cannot safely accept envelopes from a remote operator when the only identity proof is a self-asserted string. Sovereignty enforcement (MY-200) needs to know WHO is making sovereignty claims before it can enforce them. Designing identity now with 3-4 agents is cheaper than retrofitting after 50.

**Impact if Unsolved**: Federation blocked, sovereignty unenforceable, spoofing trivial within an operator boundary.

## Users & Stakeholders

**All four consumer types need identity verification:**

| Consumer | Need | Verification level |
|----------|------|-------------------|
| Gateway/hub nodes | Verify sender before forwarding across operator boundary | Cryptographic (cross-operator) |
| Subscriber agents | Trust that pilot's review.requested actually came from pilot | Hub-stamp (intra-operator) |
| Sovereignty enforcers | Verify who is making sovereignty claims before enforcement | Hub-stamp minimum |
| Operators/admins | Audit who-sent-what for debugging, compliance, incidents | Display-level (principal → human-readable name) |

## Current State

**Existing Systems:**
- `MyelinEnvelope` has a `source` field (3-5 segment dotted string, e.g. `metafactory.grove.echo`) — display label, not verified identity
- NATS user-per-bot (grove#320, confirmed by JC) provides transport-level authentication
- `createEnvelope()` and `validateEnvelope()` in myelin handle envelope lifecycle
- No `signed_by` field exists on the envelope today

**Integration Points:**
- grove#320 (NATS AAA design) — becomes the first transport binding for this spec
- grove#321 (manifest + install identity) — arc install creates NATS user, maps to principal
- MY-200 (sovereignty enforcement) — depends on identity to verify sovereignty claims
- MY-300 (cryptographic attestation, iteration 3) — extends the signed_by mechanism

## Requirements

### Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| FR-1 | Define a `Principal` type with DID-style identifier (`did:mf:<name>`) | Interview: principal format |
| FR-2 | Add optional `signed_by` field to MyelinEnvelope schema (backwards-compatible) | Interview: envelope extension |
| FR-3 | `signed_by` contains principal identifier, signature, and algorithm | Interview: signed_by content |
| FR-4 | Implement `signEnvelope(envelope, privateKey, principal)` → envelope with signed_by | Interview: signing function |
| FR-5 | Implement `verifyEnvelopeIdentity(envelope, registry)` → verified/unverified/rejected | Interview: verification |
| FR-6 | Layered verification: hub-stamp for intra-operator, cryptographic for cross-operator | Interview: trust model |
| FR-7 | Document NATS user → DID principal mapping as the first transport binding | Interview: NATS-first |
| FR-8 | Envelope `source` field relationship to principal documented (display label vs verified identity) | myelin#8 AC |
| FR-9 | Reject envelopes with invalid or missing signed_by (strict mode, no permissive path) | Interview: edge cases |

### Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | No external dependencies — self-contained within operator boundary (no OIDC, no external PKI) | Interview: constraints |
| NFR-2 | Backwards-compatible — existing envelopes without signed_by must still validate until strict mode is enabled | Migration reality |
| NFR-3 | Ed25519 as the default signing algorithm (fast, small keys, well-supported) | Industry standard for this use case |
| NFR-4 | Signing overhead < 1ms per envelope (ed25519 is ~50μs, budget is generous) | Performance: must not degrade publish path |
| NFR-5 | Operator sovereignty over principal registry — no global authority | Interview: constraints |

## Identity Architecture

### Principal

```typescript
interface Principal {
  id: string;                    // DID-style: "did:mf:<name>" (e.g. "did:mf:echo")
  display_name?: string;         // Human-readable: "Echo" (optional, for UIs)
  operator: string;              // Operator namespace: "metafactory" (matches envelope source org segment)
  public_key: string;            // Base64-encoded Ed25519 public key
  type: "agent" | "service" | "operator";
}
```

### Signed_by field (envelope extension)

```typescript
interface SignedBy {
  principal: string;             // DID: "did:mf:echo"
  method: "ed25519" | "hub-stamp";
  signature?: string;            // Base64-encoded Ed25519 signature (when method = "ed25519")
  stamped_by?: string;           // Hub DID: "did:mf:hub.metafactory" (when method = "hub-stamp")
  at: string;                    // ISO-8601 timestamp of signing/stamping
}
```

Discriminated on `method`:
- `ed25519`: agent-signed, verifiable without hub trust. `signature` is over the canonical envelope body (id + source + type + timestamp + sovereignty + payload, deterministic JSON serialization).
- `hub-stamp`: hub attests that NATS user X published this envelope. `stamped_by` is the hub's principal. Consumers within the same operator trust the hub.

### Verification contract

```typescript
type VerificationResult = 
  | { status: "verified"; principal: Principal; method: "ed25519" | "hub-stamp" }
  | { status: "unverified"; reason: string }
  | { status: "rejected"; reason: string };

function verifyEnvelopeIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
): VerificationResult;
```

**Verification rules:**
1. If `signed_by` is missing → `rejected` (strict mode)
2. If `signed_by.principal` not found in registry → `rejected`
3. If `method === "ed25519"`: verify signature against principal's public key → `verified` or `rejected`
4. If `method === "hub-stamp"`: verify stamped_by is a trusted hub in registry → `verified` or `rejected`

### Principal Registry

```typescript
interface PrincipalRegistry {
  resolve(did: string): Principal | null;
  list(): Principal[];
  trustedHubs(): Principal[];    // Hubs whose hub-stamps are accepted
}
```

First implementation: JSON file at `~/.config/metafactory/principals.json`. Future: queryable over NATS (M5 Discovery integration).

### NATS Transport Binding

| NATS concept | Maps to | How |
|-------------|---------|-----|
| NATS user name | `did:mf:<username>` | Deterministic: `nats-user-echo` → `did:mf:echo` |
| NATS user auth | Transport-level authentication | NATS server verifies credentials before message delivery |
| Hub stamp | Hub's NATS server identity stamps the envelope | Post-auth enrichment: hub adds `signed_by` with its own DID |
| NKey | Ed25519 public key for the principal | Same key used for NATS auth and envelope signing |

**Key insight**: NATS NKeys ARE Ed25519 keypairs. The same NKey that authenticates a bot to NATS can sign envelopes — one key, two verification levels.

### Relationship: `source` vs `signed_by`

| Field | Purpose | Verified? | Example |
|-------|---------|-----------|---------|
| `source` | Display label — who claims to have sent this | No — self-asserted | `metafactory.grove.echo` |
| `signed_by.principal` | Verified identity — who provably sent this | Yes — cryptographically | `did:mf:echo` |

`source` remains for routing and display. `signed_by` is the trust anchor. Consumers that need trust verify `signed_by`; consumers that just need a label read `source`.

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Envelope arrives without `signed_by` | Rejected — strict mode, no unsigned envelopes accepted |
| `signed_by.principal` not in registry | Rejected — unknown principal |
| Signature invalid (wrong key, tampered envelope) | Rejected — verification failed |
| Hub-stamp from untrusted hub | Rejected — hub not in `trustedHubs()` |
| `source` and `signed_by.principal` disagree | Warning logged but accepted — source is display, signed_by is truth |
| Registry file missing or corrupt | Fail open locally (log warning), reject cross-operator |
| Clock skew between signer and verifier | Accept if `signed_by.at` within configurable tolerance (default: 5 min) |

## Success Criteria

**Definition of Done:**
1. `Principal` type exported from `@the-metafactory/myelin`
2. `signed_by` field on `MyelinEnvelope` (optional, backwards-compatible)
3. `signEnvelope()` function — signs an envelope with Ed25519 key
4. `verifyEnvelopeIdentity()` function — verifies signed_by claim against registry
5. `PrincipalRegistry` interface + JSON file implementation
6. NATS user → DID principal mapping documented
7. Tests covering: sign→verify round-trip, reject unsigned, reject unknown principal, reject bad signature, hub-stamp verification

**Phasing:**
- **Phase 1**: Types + signed_by field + signEnvelope + PrincipalRegistry interface
- **Phase 2**: verifyEnvelopeIdentity + NATS binding docs + JSON registry implementation

## Scope

### In Scope
- Principal type definition (DID-style `did:mf:<name>`)
- `signed_by` envelope field specification and implementation
- Ed25519 signing and verification functions
- Hub-stamp attestation model
- PrincipalRegistry interface and JSON file implementation
- NATS user → principal mapping documentation
- Verification contract (strict: reject unsigned)
- `source` vs `signed_by` relationship documentation

### Explicitly Out of Scope
- Key management (generation, rotation, storage, revocation) — operational concern
- Authorization/RBAC (what a principal is ALLOWED to do) — separate M4+ concern
- Human identity (mapping principals to real people) — agents and services only for v1
- Cross-ecosystem interop (external DID networks, OIDC, X.509) — future iteration
- M5 Discovery integration for runtime registry queries — future iteration
- UI for principal management — CLI or config file only

## Open Questions

- [ ] Should the canonical JSON serialization for signing use JSON Canonicalization Scheme (JCS/RFC 8785) or a simpler deterministic sort?
- [ ] Should the JSON registry file live at `~/.config/metafactory/principals.json` or inside the myelin arc bundle?
- [ ] Should `verifyEnvelopeIdentity` be async (to support future network-based registries)?

## Assumptions

- Ed25519 is available via Bun's `crypto` or `@noble/ed25519` (zero native deps)
- NATS NKeys are Ed25519-compatible — same keypair can serve both NATS auth and envelope signing
- Operators run a single hub per boundary — hub-stamp model assumes one trust root per operator
- The MyelinEnvelope JSON schema allows `additionalProperties` for `signed_by` — or we add it to the allowed set in `validateEnvelope()`

---
*Interview conducted: 2026-05-07*
*Phases completed: 6/8 (skipped UX — protocol spec, not UI)*
