# Technical Plan: Sovereignty Policy Engine

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              OPERATOR BOUNDARY                                   │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                        SOVEREIGNTY ENGINE                                  │   │
│  │                                                                            │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌───────────┐  │   │
│  │  │ PolicyStore │<───│ KV Watch    │    │ AuditLog    │───>│ JetStream │  │   │
│  │  │ (cached)    │    │ (hot reload)│    │ (emmitter)  │    │ _audit.*  │  │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘    └───────────┘  │   │
│  │         │                                     ▲                           │   │
│  │         ▼                                     │                           │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐ │   │
│  │  │                    VALIDATION MIDDLEWARE                             │ │   │
│  │  │                                                                      │ │   │
│  │  │  ┌──────────────────────┐      ┌──────────────────────┐            │ │   │
│  │  │  │   EGRESS VALIDATOR   │      │   INGRESS VALIDATOR   │            │ │   │
│  │  │  │                      │      │                        │            │ │   │
│  │  │  │ 1. Classification    │      │ 1. Principal known?    │            │ │   │
│  │  │  │    matches subject?  │      │ 2. Scope mapping OK?   │            │ │   │
│  │  │  │ 2. Data residency OK?│      │ 3. Chain-of-stamps     │            │ │   │
│  │  │  │ 3. Max hop check     │      │    valid?              │            │ │   │
│  │  │  └──────────────────────┘      └──────────────────────┘            │ │   │
│  │  │           │                              │                          │ │   │
│  │  │           ├──────────┬──────────────────┤                          │ │   │
│  │  │           │          │                  │                          │ │   │
│  │  │           ▼          ▼                  ▼                          │ │   │
│  │  │      ✓ ALLOW    ✗ BLOCK + NAK     ✗ BLOCK + NAK                   │ │   │
│  │  │                 (compliance-block)  (compliance-block)              │ │   │
│  │  └─────────────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────┐                                           ┌─────────────────┐  │
│  │   Agent     │──publish()──>┌──────────────┐──publish()──│      NATS       │  │
│  │ (outbound)  │              │  Engine wrap │             │   Leaf Node     │  │
│  └─────────────┘<──nak/ack────└──────────────┘<───inbound──│   Boundary      │  │
│                                                             └─────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

Policy KV Layout:
┌─────────────────────────────────────────────────────────┐
│  SOVEREIGNTY_POLICY (NATS KV Bucket)                    │
├─────────────────────────────────────────────────────────┤
│  key: "config"                                           │
│  value: SovereigntyPolicy JSON (egress, ingress rules)  │
├─────────────────────────────────────────────────────────┤
│  key: "scope.<partner-org>"                              │
│  value: FederationScopeMapping JSON                      │
└─────────────────────────────────────────────────────────┘

Audit Stream:
┌─────────────────────────────────────────────────────────┐
│  _AUDIT (JetStream Stream)                               │
│  subjects: _audit.sovereignty.>                          │
│  retention: 90 days                                      │
│  replicas: 1 (operator-configurable)                     │
└─────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Policy store | NATS KV (`SOVEREIGNTY_POLICY`) | Matches F-11 AGENT_CAPABILITIES pattern, watch-based hot reload |
| Audit log | NATS JetStream (`_AUDIT`) | Append-only, tamper-evident via sequence numbers |
| Validation | Zod + custom | Schema validation + runtime enforcement |
| NSC integration | `nsc` CLI subprocess | Leverage NATS-native tooling, no custom PKI |

**No new dependencies required** — uses existing `@nats-io/jetstream` and `@nats-io/transport-node`.

## Data Model

### SovereigntyPolicy (KV bucket: SOVEREIGNTY_POLICY, key: "config")

```typescript
// src/sovereignty/types.ts

export interface SovereigntyPolicy {
  version: 1;
  org: string;  // "metafactory"
  
  egress: {
    /** Block local envelopes from leaving org boundary (default: true) */
    block_local_escape: boolean;
    
    /** Per-classification routing rules */
    rules: EgressRule[];
  };
  
  ingress: {
    /** Federation partner → local scope mappings */
    scope_mappings: ScopeMapping[];
    
    /** Reject envelopes from unknown federation partners (default: true) */
    reject_unknown_partners: boolean;
  };
  
  chain_of_stamps: {
    /** Verify sovereignty at each delegation hop (default: true) */
    verify_delegation_sovereignty: boolean;
  };
  
  audit: {
    /** Stream retention in nanoseconds (default: 90 days) */
    retention_ns: number;
  };
}

export interface EgressRule {
  classification: Classification;
  /** Glob patterns for allowed NATS subjects */
  allowed_subjects: string[];
  /** Data residency constraints: residency code → allowed subject patterns */
  data_residency_constraints?: Record<string, string[]>;
}

export interface ScopeMapping {
  partner_org: string;           // "operator-b"
  imported_principals: string[]; // DIDs from partner: ["did:mf:echo", "did:mf:forge"]
  local_scope: string[];         // What they can do here: ["tasks.code-review.*"]
  max_capabilities: string[];    // Capability ceiling: ["code-review", "test"]
}
```

### AuditEntry (JetStream stream: _AUDIT, subjects: _audit.sovereignty.>)

```typescript
// src/sovereignty/types.ts

export type AuditDecision = 'allow' | 'block';
export type AuditDirection = 'egress' | 'ingress';

export interface AuditEntry {
  timestamp: string;            // ISO-8601
  envelope_id: string;          // Envelope UUID
  direction: AuditDirection;
  decision: AuditDecision;
  reason: string;               // Human-readable
  reason_code: NakReasonCode;   // Machine-readable
  principal: string | null;     // DID if signed
  subject: string;              // NATS subject
  classification: Classification;
  data_residency: string;
  rule_matched?: string;        // Which rule triggered (for debugging)
}

export type NakReasonCode =
  | 'compliance-block:classification-mismatch'
  | 'compliance-block:residency-violation'
  | 'compliance-block:unknown-principal'
  | 'compliance-block:scope-exceeded'
  | 'compliance-block:chain-invalid'
  | 'compliance-block:partner-unknown';
```

### ValidationResult (internal)

```typescript
// src/sovereignty/types.ts

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string; code: NakReasonCode };
```

### Policy Zod Schemas

```typescript
// src/sovereignty/schema.ts

import { z } from 'zod';

const ClassificationSchema = z.enum(['local', 'federated', 'public']);

const EgressRuleSchema = z.object({
  classification: ClassificationSchema,
  allowed_subjects: z.array(z.string()),
  data_residency_constraints: z.record(z.array(z.string())).optional(),
});

const ScopeMappingSchema = z.object({
  partner_org: z.string().min(1),
  imported_principals: z.array(z.string().regex(/^did:mf:[a-z][a-z0-9._-]+$/)),
  local_scope: z.array(z.string()),
  max_capabilities: z.array(z.string()),
});

export const SovereigntyPolicySchema = z.object({
  version: z.literal(1),
  org: z.string().min(1),
  egress: z.object({
    block_local_escape: z.boolean(),
    rules: z.array(EgressRuleSchema),
  }),
  ingress: z.object({
    scope_mappings: z.array(ScopeMappingSchema),
    reject_unknown_partners: z.boolean(),
  }),
  chain_of_stamps: z.object({
    verify_delegation_sovereignty: z.boolean(),
  }),
  audit: z.object({
    retention_ns: z.number().int().positive(),
  }),
});
```

## API Contracts

### PolicyStore

```typescript
// src/sovereignty/policy-store.ts

export interface PolicyStore {
  /** Get current cached policy (throws if not loaded) */
  get(): SovereigntyPolicy;
  
  /** Check if policy is loaded */
  isLoaded(): boolean;
  
  /** Force reload from KV */
  reload(): Promise<void>;
  
  /** Start watching for changes (hot reload) */
  watch(): Promise<void>;
  
  /** Stop watching */
  unwatch(): Promise<void>;
  
  /** Cleanup */
  close(): Promise<void>;
}

export interface PolicyStoreOptions {
  /** NATS KV bucket name (default: "SOVEREIGNTY_POLICY") */
  bucket?: string;
  /** Fail if policy not found on startup (default: true — fail-closed) */
  requirePolicy?: boolean;
}

export function createPolicyStore(
  js: JetStreamClient,
  options?: PolicyStoreOptions,
): Promise<PolicyStore>;
```

### AuditLog

```typescript
// src/sovereignty/audit-log.ts

export interface AuditLog {
  /** Emit audit entry */
  emit(entry: AuditEntry): Promise<void>;
  
  /** Cleanup */
  close(): Promise<void>;
}

export interface AuditLogOptions {
  /** Stream name (default: "_AUDIT") */
  stream?: string;
  /** Subject prefix (default: "_audit.sovereignty") */
  subjectPrefix?: string;
  /** Retention in nanoseconds (default: 90 days) */
  retentionNs?: number;
}

export function createAuditLog(
  js: JetStreamClient,
  options?: AuditLogOptions,
): Promise<AuditLog>;
```

### SovereigntyEngine

```typescript
// src/sovereignty/engine.ts

export interface SovereigntyEngine {
  /** Validate envelope for egress (before publish) */
  validateEgress(
    envelope: MyelinEnvelope,
    targetSubject: string,
  ): Promise<ValidationResult>;
  
  /** Validate envelope for ingress (after receive, before delivery) */
  validateIngress(
    envelope: MyelinEnvelope,
    sourceSubject: string,
  ): Promise<ValidationResult>;
  
  /** Get current policy (for inspection) */
  getPolicy(): SovereigntyPolicy;
  
  /** Cleanup */
  close(): Promise<void>;
}

export interface SovereigntyEngineOptions {
  /** Principal registry for identity verification */
  registry: PrincipalRegistry;
  /** Policy store instance */
  policyStore: PolicyStore;
  /** Audit log instance */
  auditLog: AuditLog;
  /** Enable chain-of-stamps verification (default: true) */
  verifyChainOfStamps?: boolean;
}

export function createSovereigntyEngine(
  options: SovereigntyEngineOptions,
): SovereigntyEngine;
```

### SovereignTransport (middleware wrapper)

```typescript
// src/sovereignty/transport.ts

export interface SovereignTransport extends TransportPublisher, TransportSubscriber {
  /** Access underlying engine for inspection */
  engine: SovereigntyEngine;
}

export interface SovereignTransportOptions {
  /** Underlying transport to wrap */
  transport: TransportPublisher & TransportSubscriber;
  /** Sovereignty engine */
  engine: SovereigntyEngine;
}

export function createSovereignTransport(
  options: SovereignTransportOptions,
): SovereignTransport;
```

## Implementation Phases

### Phase 1: Core Types + Schema (Day 1)

**Files created:**
- `src/sovereignty/types.ts` — All type definitions
- `src/sovereignty/schema.ts` — Zod schemas for policy validation
- `src/sovereignty/index.ts` — Module exports

**Tasks:**
1. Define `SovereigntyPolicy`, `AuditEntry`, `ValidationResult` types
2. Define `NakReasonCode` enum (aligns with F-22 structured nak reasons)
3. Implement Zod schemas with strict validation
4. Export types from `src/index.ts`

**Acceptance:**
- [ ] Types compile without errors
- [ ] Zod schema validates example policy from spec
- [ ] Invalid policies rejected with clear error messages

### Phase 2: Policy Store with Hot Reload (Day 1-2)

**Files created:**
- `src/sovereignty/policy-store.ts` — KV-backed policy store
- `src/sovereignty/policy-store.test.ts` — Unit tests

**Tasks:**
1. Implement `createPolicyStore()` factory
2. Load policy from KV bucket on startup
3. Fail-closed behavior: throw if policy missing and `requirePolicy: true`
4. Implement KV watch for hot reload
5. Debounce rapid updates (100ms window)
6. Validate policy with Zod on every load

**Acceptance:**
- [ ] Policy loads from KV on startup
- [ ] Engine refuses to start without policy (fail-closed)
- [ ] Policy changes trigger reload within 100ms
- [ ] Invalid policy updates rejected, previous policy retained

### Phase 3: Audit Log (Day 2)

**Files created:**
- `src/sovereignty/audit-log.ts` — JetStream audit emitter
- `src/sovereignty/audit-log.test.ts` — Unit tests

**Tasks:**
1. Ensure stream `_AUDIT` exists with config:
   - subjects: `_audit.sovereignty.>`
   - retention: 90 days (configurable)
   - storage: file
   - discard: old
2. Implement `emit()` — publish to `_audit.sovereignty.<decision>.<direction>`
3. Batch low-latency: emit is fire-and-forget with internal queue

**Acceptance:**
- [ ] Stream created on first use
- [ ] Entries retrievable via JetStream consumer
- [ ] Emit latency < 0.5ms (async fire-and-forget)

### Phase 4: Egress Validation (Day 2-3)

**Files created:**
- `src/sovereignty/validators/egress.ts` — Egress validation logic
- `src/sovereignty/validators/egress.test.ts` — Unit tests

**Tasks:**
1. Classification → subject prefix alignment check
2. Data residency constraint check
3. `local` classification escape detection
4. Glob pattern matching for allowed subjects
5. Emit audit entry on every decision

**Validation rules:**

| Check | Fail condition | Reason code |
|-------|----------------|-------------|
| Classification alignment | `local` envelope → `federated.*` or `public.*` subject | `classification-mismatch` |
| Data residency | `CH` residency → subject outside `*.ch.*` (when constrained) | `residency-violation` |
| Allowed subjects | Subject not in allowed_subjects globs | `classification-mismatch` |

**Acceptance:**
- [ ] `local` envelopes blocked from federated subjects
- [ ] Data residency constraints enforced
- [ ] Audit entry emitted for every decision (allow + block)

### Phase 5: Ingress Validation (Day 3-4)

**Files created:**
- `src/sovereignty/validators/ingress.ts` — Ingress validation logic
- `src/sovereignty/validators/ingress.test.ts` — Unit tests

**Tasks:**
1. Principal scope mapping lookup
2. Unknown principal rejection
3. Scope ceiling enforcement
4. Unknown federation partner rejection
5. Emit audit entry on every decision

**Validation rules:**

| Check | Fail condition | Reason code |
|-------|----------------|-------------|
| Principal known | DID not in any scope_mapping | `unknown-principal` |
| Partner known | `signed_by` org not in mappings (when `reject_unknown_partners: true`) | `partner-unknown` |
| Scope allowed | Subject outside `local_scope` patterns | `scope-exceeded` |
| Capability ceiling | Claimed capability outside `max_capabilities` | `scope-exceeded` |

**Acceptance:**
- [ ] Unknown principals rejected at ingress
- [ ] Principals constrained to declared scope
- [ ] Audit entry emitted for every decision

### Phase 6: Chain-of-Stamps Integration (Day 4)

**Files created:**
- `src/sovereignty/validators/chain.ts` — Chain-of-stamps sovereignty check
- `src/sovereignty/validators/chain.test.ts` — Unit tests

**Tasks:**
1. Extract chain from `correlation_id` + envelope history
2. For each stamp in chain, verify principal had sovereignty for its action
3. Break chain on first sovereignty violation
4. Integration with myelin#31 chain-of-stamps module

**Acceptance:**
- [ ] Each hop's principal verified for sovereignty
- [ ] Chain broken → `compliance-block` with `chain-invalid`
- [ ] Valid chains pass through

### Phase 7: Engine Assembly (Day 4-5)

**Files created:**
- `src/sovereignty/engine.ts` — Main engine orchestration
- `src/sovereignty/engine.test.ts` — Integration tests

**Tasks:**
1. Wire policy store, audit log, validators
2. Implement `validateEgress()` and `validateIngress()`
3. Sub-millisecond latency path (cache policy, avoid allocs)
4. Error handling: if audit emit fails, log but don't block

**Acceptance:**
- [ ] Engine validates egress correctly
- [ ] Engine validates ingress correctly
- [ ] p99 latency < 1ms under load
- [ ] Audit emit failure doesn't block validation

### Phase 8: Transport Wrapper (Day 5)

**Files created:**
- `src/sovereignty/transport.ts` — Middleware transport wrapper
- `src/sovereignty/transport.test.ts` — Integration tests

**Tasks:**
1. Wrap `TransportPublisher.publish()` with egress validation
2. Wrap `TransportSubscriber.subscribe()` handler with ingress validation
3. On block: emit structured nak, don't deliver
4. Preserve all transport semantics (JetStream ack/nak, durables)

**Acceptance:**
- [ ] Publish blocked for sovereignty violations
- [ ] Subscribe handler not called for blocked envelopes
- [ ] Structured nak emitted with correct reason code
- [ ] All existing transport tests pass with wrapper

### Phase 9: NSC Integration Helpers (Day 5-6)

**Files created:**
- `src/sovereignty/nsc.ts` — NSC command generation
- `src/sovereignty/nsc.test.ts` — Unit tests

**Tasks:**
1. Generate `nsc` commands from policy scope mappings
2. Export scope definitions for federation partners
3. Import partner scope definitions
4. Document operator workflow

**Generated commands:**

```bash
# Export scope for partner "operator-b"
nsc add export --subject "tasks.code-review.>" --account metafactory

# Import partner's principals  
nsc add import --src-account operator-b --remote-subject "tasks.>" --local-subject "federated.operator-b.tasks.>"
```

**Acceptance:**
- [ ] Commands generated correctly from policy
- [ ] Commands are idempotent (can run multiple times)
- [ ] Documentation covers operator workflow

### Phase 10: Documentation + Integration (Day 6)

**Files created:**
- `docs/sovereignty.md` — User documentation

**Files modified:**
- `src/index.ts` — Export sovereignty module
- `README.md` — Add sovereignty section

**Tasks:**
1. Document policy format with examples
2. Document operator workflow (provision KV, NSC commands)
3. Document failure modes and recovery
4. Integration test: full flow with NATS

**Acceptance:**
- [ ] Documentation covers all use cases
- [ ] Integration test passes
- [ ] Exported from package

## File Structure

```
src/
├── sovereignty/
│   ├── index.ts                    # Module exports
│   ├── types.ts                    # Type definitions
│   ├── schema.ts                   # Zod validation schemas
│   ├── policy-store.ts             # KV-backed policy store
│   ├── policy-store.test.ts
│   ├── audit-log.ts                # JetStream audit emitter
│   ├── audit-log.test.ts
│   ├── engine.ts                   # Main sovereignty engine
│   ├── engine.test.ts
│   ├── transport.ts                # Middleware transport wrapper
│   ├── transport.test.ts
│   ├── nsc.ts                      # NSC command generation
│   ├── nsc.test.ts
│   └── validators/
│       ├── egress.ts               # Egress validation
│       ├── egress.test.ts
│       ├── ingress.ts              # Ingress validation
│       ├── ingress.test.ts
│       ├── chain.ts                # Chain-of-stamps verification
│       └── chain.test.ts
├── index.ts                        # (update: export sovereignty)
└── ...

docs/
├── sovereignty.md                  # Sovereignty documentation
└── ...
```

## Dependencies

### Runtime Dependencies

**No new dependencies** — uses existing:
- `@nats-io/jetstream` — KV and streams
- `@nats-io/transport-node` — NATS connection
- `zod` — needs to be added if not present (schema validation)

### Dev Dependencies

**No changes** — existing `bun:test` and TypeScript.

### External Prerequisites

| Prerequisite | Required By | Notes |
|--------------|-------------|-------|
| NATS server with JetStream | All phases | KV + streams |
| `SOVEREIGNTY_POLICY` KV bucket | Runtime | Provisioned by operator |
| `nsc` CLI | Phase 9 | Federation setup only |
| Principal registry | Phase 5+ | `~/.config/metafactory/principals.json` |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Policy hot-reload race condition | High | Medium | Debounce + atomic swap of cached policy |
| Audit emit bottleneck | Medium | Low | Fire-and-forget with internal queue, don't block validation |
| Glob pattern matching performance | Medium | Low | Pre-compile patterns at policy load, not per-envelope |
| Chain-of-stamps not yet merged | High | Low | Feature-flag `verifyChainOfStamps`, skip if #31 not ready |
| KV bucket doesn't exist on startup | High | Medium | Fail-closed with clear error message, operator must provision |
| NSC command drift from policy | Medium | Medium | Generate commands idempotently, document reconciliation |
| False positive blocks | High | Low | Extensive test coverage, audit log for debugging |

## Performance Considerations

### Hot Path Optimization

```typescript
// Pre-compile glob patterns at policy load
interface CompiledPolicy extends SovereigntyPolicy {
  _compiledEgressPatterns: Map<Classification, RegExp[]>;
  _compiledScopePatterns: Map<string, RegExp[]>;
}

// Validation should be O(1) lookups + pattern matching
// Target: < 100μs for simple cases, < 1ms p99
```

### Memory

- Policy cached in memory (~10KB typical)
- Compiled patterns add ~5KB
- No per-envelope allocations in hot path

### Latency Budget

| Operation | Budget | Notes |
|-----------|--------|-------|
| Classification check | 10μs | Map lookup |
| Subject pattern match | 50μs | Pre-compiled regex |
| Scope mapping lookup | 20μs | Map lookup by org |
| Audit emit | 100μs | Async fire-and-forget |
| **Total egress** | **< 200μs** | |
| **Total ingress** | **< 500μs** | Includes principal resolve |

## Test Vectors

### Egress: Classification Mismatch

```typescript
const envelope = createEnvelope({
  source: 'metafactory.echo.local',
  type: 'task.review',
  sovereignty: {
    classification: 'local',  // ← local
    data_residency: 'CH',
    max_hop: 0,
    frontier_ok: false,
    model_class: 'local-only',
  },
  payload: { pr: 123 },
});

const result = await engine.validateEgress(
  envelope,
  'federated.metafactory.tasks.review',  // ← federated subject
);

expect(result.valid).toBe(false);
expect(result.code).toBe('compliance-block:classification-mismatch');
```

### Ingress: Unknown Principal

```typescript
const envelope = createSignedEnvelope({
  source: 'operator-b.rogue.instance',
  type: 'task.claim',
  sovereignty: { classification: 'federated', ... },
  payload: {},
}, { did: 'did:mf:rogue', privateKey: '...' });

const result = await engine.validateIngress(
  envelope,
  'federated.operator-b.tasks.claim',
);

expect(result.valid).toBe(false);
expect(result.code).toBe('compliance-block:unknown-principal');
```

### Egress: Allow Valid Local

```typescript
const envelope = createEnvelope({
  source: 'metafactory.echo.local',
  type: 'task.review',
  sovereignty: { classification: 'local', ... },
  payload: {},
});

const result = await engine.validateEgress(
  envelope,
  'local.metafactory.tasks.review',  // ← local subject matches
);

expect(result.valid).toBe(true);
```

## Success Criteria Mapping

| Spec Criterion | Phase | Test |
|----------------|-------|------|
| `local` envelopes cannot reach federated/public subjects | Phase 4 | `egress.test.ts` |
| Federated envelopes with unknown principals rejected | Phase 5 | `ingress.test.ts` |
| Principal scope mapping constrains external agents | Phase 5 | `ingress.test.ts` |
| `compliance-block` nak includes machine-readable reason | Phase 8 | `transport.test.ts` |
| Audit log captures all decisions | Phase 3-8 | Integration tests |
| Policy hot-reload without restart | Phase 2 | `policy-store.test.ts` |
| Enforcement latency < 1ms p99 | Phase 7 | Benchmark test |
