# Implementation Tasks: F-5 Sovereignty Policy Engine

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | |
| T-1.2 | ☐ | |
| T-1.3 | ☐ | |
| T-2.1 | ☑ | PR feat/f-5-kv-policy-store |
| T-2.2 | ☑ | PR feat/f-5-kv-policy-store |
| T-2.3 | ☑ | PR feat/f-5-kv-policy-store |
| T-3.1 | ☑ | PR feat/f-5-audit-log |
| T-3.2 | ☑ | PR feat/f-5-audit-log |
| T-4.1 | ☐ | |
| T-4.2 | ☐ | |
| T-4.3 | ☐ | |
| T-5.1 | ☐ | |
| T-5.2 | ☐ | |
| T-5.3 | ☐ | |
| T-6.1 | ☐ | |
| T-7.1 | ☑ | PR feat/f-5-engine-audit |
| T-7.2 | ☑ | PR feat/f-5-perf-hardening |
| T-8.1 | ☑ | PR feat/f-5-sovereign-transport |
| T-8.2 | ☑ | PR feat/f-5-sovereign-transport |
| T-8.3 | ☑ | PR feat/f-5-sovereign-transport |
| T-9.1 | ☑ | PR feat/f-5-nsc-federation |
| T-9.2 | ☑ | PR feat/f-5-operator-doc |
| T-10.1 | ☑ | PR feat/f-5-architecture-doc |
| T-10.2 | ☐ | |
| T-10.3 | ☑ | PR feat/f-5-e2e-integration |

---

## Group 1: Foundation — Types & Schema

### T-1.1: Define sovereignty types [T]
- **File:** `src/sovereignty/types.ts`
- **Test:** `src/sovereignty/types.test.ts`
- **Dependencies:** none
- **Description:** Create core sovereignty types:
  - `SovereigntyPolicy` interface (version, org, egress, ingress, chain_of_stamps, audit)
  - `EgressRule` interface (classification, allowed_subjects, data_residency_constraints)
  - `ScopeMapping` interface (partner_org, imported_principals, local_scope, max_capabilities)
  - `AuditEntry` interface (timestamp, envelope_id, direction, decision, reason, reason_code, principal, subject, classification, data_residency)
  - `AuditDecision` = `'allow' | 'block'`
  - `AuditDirection` = `'egress' | 'ingress'`
  - `NakReasonCode` type (6 variants: classification-mismatch, residency-violation, unknown-principal, scope-exceeded, chain-invalid, partner-unknown)
  - `ValidationResult` type (valid: true | valid: false with reason and code)
- **Acceptance:** Types compile, test imports all types successfully

### T-1.2: Create Zod validation schemas [T] [P with T-1.1]
- **File:** `src/sovereignty/schema.ts`
- **Test:** `src/sovereignty/schema.test.ts`
- **Dependencies:** none (uses Classification from src/types.ts)
- **Description:**
  - `EgressRuleSchema` — validates classification, allowed_subjects array, optional data_residency_constraints
  - `ScopeMappingSchema` — validates partner_org, imported_principals (DID regex), local_scope, max_capabilities
  - `SovereigntyPolicySchema` — validates full policy structure with version literal(1)
  - `AuditEntrySchema` — validates audit entry structure
- **Acceptance:**
  - Valid policies from spec examples pass validation
  - Invalid policies rejected with clear Zod errors
  - DID regex matches `did:mf:[a-z][a-z0-9._-]+`

### T-1.3: Create module index [P with T-1.2]
- **File:** `src/sovereignty/index.ts`
- **Test:** none (export only)
- **Dependencies:** T-1.1, T-1.2
- **Description:** Export all types and schemas:
  ```typescript
  export type { SovereigntyPolicy, EgressRule, ScopeMapping, AuditEntry, AuditDecision, AuditDirection, NakReasonCode, ValidationResult } from './types';
  export { SovereigntyPolicySchema, EgressRuleSchema, ScopeMappingSchema, AuditEntrySchema } from './schema';
  ```
- **Acceptance:** Types and schemas importable from `./sovereignty`

---

## Group 2: Policy Store — KV-Backed Hot Reload

### T-2.1: Implement PolicyStore interface and factory [T]
- **File:** `src/sovereignty/policy-store.ts`
- **Test:** `src/sovereignty/policy-store.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:**
  - Define `PolicyStore` interface (get, isLoaded, reload, watch, unwatch, close)
  - Define `PolicyStoreOptions` interface (bucket, requirePolicy)
  - `createPolicyStore(js: JetStreamClient, options?)` factory
  - Internal state: cached policy, watch subscription
- **Acceptance:** Interface compiles, factory returns PolicyStore instance

### T-2.2: Add KV loading with fail-closed behavior [T]
- **File:** `src/sovereignty/policy-store.ts` (extend)
- **Test:** `src/sovereignty/policy-store.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  - Load policy from KV bucket `SOVEREIGNTY_POLICY` key `config`
  - Validate loaded JSON with `SovereigntyPolicySchema`
  - If `requirePolicy: true` (default), throw if policy missing
  - If policy invalid, throw with Zod error details
  - Cache validated policy for `get()` access
- **Acceptance:**
  - Policy loads from KV on startup
  - Missing policy → throws with clear message (fail-closed)
  - Invalid policy → throws with validation errors

### T-2.3: Implement hot reload via KV watch [T]
- **File:** `src/sovereignty/policy-store.ts` (extend)
- **Test:** `src/sovereignty/policy-store.test.ts`
- **Dependencies:** T-2.2
- **Description:**
  - `watch()` starts KV watch on `config` key
  - On update: validate new policy, atomic swap if valid
  - On invalid update: log error, retain previous policy
  - Debounce rapid updates (100ms window)
  - `unwatch()` stops watch subscription
- **Acceptance:**
  - Policy changes trigger reload within 100ms
  - Invalid policy updates rejected, previous policy retained
  - Multiple rapid updates debounced

---

## Group 3: Audit Log — JetStream Emitter

### T-3.1: Implement AuditLog with stream creation [T]
- **File:** `src/sovereignty/audit-log.ts`
- **Test:** `src/sovereignty/audit-log.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  - Define `AuditLog` interface (emit, close)
  - Define `AuditLogOptions` interface (stream, subjectPrefix, retentionNs)
  - `createAuditLog(js: JetStreamClient, options?)` factory
  - Ensure stream `_AUDIT` exists on creation:
    - subjects: `_audit.sovereignty.>`
    - retention: 90 days (7776000000000000ns, configurable)
    - storage: file
    - discard: old
- **Acceptance:**
  - Stream created if not exists
  - Stream config matches spec requirements
  - Factory returns AuditLog instance

### T-3.2: Add async emit functionality [T]
- **File:** `src/sovereignty/audit-log.ts` (extend)
- **Test:** `src/sovereignty/audit-log.test.ts`
- **Dependencies:** T-3.1
- **Description:**
  - `emit(entry: AuditEntry)` publishes to `_audit.sovereignty.<decision>.<direction>`
  - Fire-and-forget: don't await ack in hot path
  - Internal queue for batching if needed
  - Emit latency target: < 0.5ms
- **Acceptance:**
  - Entries retrievable via JetStream consumer
  - Emit is async (doesn't block caller)
  - Subject format: `_audit.sovereignty.allow.egress` or `_audit.sovereignty.block.ingress`

---

## Group 4: Egress Validation — Classification & Residency

### T-4.1: Implement classification alignment check [T]
- **File:** `src/sovereignty/validators/egress.ts`
- **Test:** `src/sovereignty/validators/egress.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  - `checkClassificationAlignment(envelope: MyelinEnvelope, targetSubject: string, rules: EgressRule[])` → ValidationResult
  - Map classification to allowed subject prefixes:
    - `local` → `local.*` only
    - `federated` → `local.*` or `federated.*`
    - `public` → any
  - Find matching rule by classification
  - Check subject against `allowed_subjects` glob patterns
- **Acceptance:**
  - `local` envelope → `federated.*.tasks.*` returns `{ valid: false, code: 'compliance-block:classification-mismatch' }`
  - `local` envelope → `local.org.tasks.*` returns `{ valid: true }`

### T-4.2: Implement glob pattern matching [T] [P with T-4.1]
- **File:** `src/sovereignty/validators/egress.ts` (extend)
- **Test:** `src/sovereignty/validators/egress.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  - `matchesGlobPattern(subject: string, pattern: string)` → boolean
  - Pre-compile patterns at policy load for performance
  - Support NATS-style patterns: `*` (single token), `>` (multi-token)
  - Cache compiled RegExp in `CompiledPolicy` wrapper
- **Acceptance:**
  - `local.org.tasks.review` matches `local.org.tasks.>`
  - `local.org.tasks.review` matches `local.*.tasks.*`
  - `federated.org.tasks` does NOT match `local.>`

### T-4.3: Implement data residency check [T]
- **File:** `src/sovereignty/validators/egress.ts` (extend)
- **Test:** `src/sovereignty/validators/egress.test.ts`
- **Dependencies:** T-4.1, T-4.2
- **Description:**
  - `checkDataResidency(envelope: MyelinEnvelope, targetSubject: string, rule: EgressRule)` → ValidationResult
  - Check `sovereignty.data_residency` against rule's `data_residency_constraints`
  - If residency code has constraint, subject must match constraint patterns
  - Example: `CH` residency → subject must match `*.ch.*` patterns
- **Acceptance:**
  - CH-resident envelope → `federated.de.tasks` returns `{ valid: false, code: 'compliance-block:residency-violation' }`
  - CH-resident envelope → `federated.ch.tasks` returns `{ valid: true }`
  - No constraint for residency → passes

---

## Group 5: Ingress Validation — Principal Scope & Partner

### T-5.1: Implement principal scope mapping lookup [T]
- **File:** `src/sovereignty/validators/ingress.ts`
- **Test:** `src/sovereignty/validators/ingress.test.ts`
- **Dependencies:** T-1.1, T-4.2
- **Description:**
  - `lookupPrincipalScope(principal: string, mappings: ScopeMapping[])` → ScopeMapping | null
  - Search `imported_principals` arrays for DID match
  - Return matching scope mapping or null if unknown
- **Acceptance:**
  - Known principal returns scope mapping
  - Unknown principal returns null

### T-5.2: Implement scope ceiling enforcement [T]
- **File:** `src/sovereignty/validators/ingress.ts` (extend)
- **Test:** `src/sovereignty/validators/ingress.test.ts`
- **Dependencies:** T-5.1
- **Description:**
  - `checkScopeCeiling(envelope: MyelinEnvelope, sourceSubject: string, mapping: ScopeMapping)` → ValidationResult
  - Subject must match one of `local_scope` patterns
  - If envelope claims capability, must be in `max_capabilities`
  - Return scope-exceeded on violations
- **Acceptance:**
  - Principal accessing allowed scope → valid
  - Principal accessing outside scope → `{ valid: false, code: 'compliance-block:scope-exceeded' }`

### T-5.3: Implement unknown principal/partner rejection [T]
- **File:** `src/sovereignty/validators/ingress.ts` (extend)
- **Test:** `src/sovereignty/validators/ingress.test.ts`
- **Dependencies:** T-5.1, T-5.2
- **Description:**
  - `validateIngress(envelope: MyelinEnvelope, sourceSubject: string, policy: SovereigntyPolicy, registry: PrincipalRegistry)` → ValidationResult
  - Extract `signed_by.principal` from envelope
  - If principal not in any scope mapping → `unknown-principal`
  - If partner org unknown and `reject_unknown_partners: true` → `partner-unknown`
  - If scope check fails → `scope-exceeded`
- **Acceptance:**
  - Unknown principal rejected with `compliance-block:unknown-principal`
  - Unknown partner rejected with `compliance-block:partner-unknown`
  - Valid federated envelope passes all checks

---

## Group 6: Chain-of-Stamps Integration

### T-6.1: Implement chain-of-stamps sovereignty verification [T]
- **File:** `src/sovereignty/validators/chain.ts`
- **Test:** `src/sovereignty/validators/chain.test.ts`
- **Dependencies:** T-5.1, T-5.2 (myelin#31 chain-of-stamps must be merged)
- **Description:**
  - `verifyChainSovereignty(envelope: MyelinEnvelope, policy: SovereigntyPolicy, registry: PrincipalRegistry)` → ValidationResult
  - Extract delegation chain from `correlation_id` + envelope history
  - For each stamp in chain:
    - Resolve principal from registry
    - Verify principal had sovereignty for its hop
  - Break chain on first sovereignty violation
  - Feature-flag: `policy.chain_of_stamps.verify_delegation_sovereignty`
- **Acceptance:**
  - Valid chain with sovereign principals → valid
  - Chain with non-sovereign hop → `{ valid: false, code: 'compliance-block:chain-invalid' }`
  - Verification skipped if feature flag false

---

## Group 7: Engine Assembly — Orchestration

### T-7.1: Implement SovereigntyEngine orchestration [T]
- **File:** `src/sovereignty/engine.ts`
- **Test:** `src/sovereignty/engine.test.ts`
- **Dependencies:** T-2.3, T-3.2, T-4.3, T-5.3, T-6.1
- **Description:**
  - Define `SovereigntyEngine` interface (validateEgress, validateIngress, getPolicy, close)
  - Define `SovereigntyEngineOptions` interface (registry, policyStore, auditLog, verifyChainOfStamps)
  - `createSovereigntyEngine(options)` factory
  - Wire policy store, audit log, validators
  - `validateEgress()`:
    1. Get cached policy
    2. Run egress validators (classification, residency)
    3. Emit audit entry
    4. Return result
  - `validateIngress()`:
    1. Get cached policy
    2. Run ingress validators (principal, scope, partner)
    3. Optionally run chain-of-stamps verification
    4. Emit audit entry
    5. Return result
- **Acceptance:**
  - Engine validates egress correctly
  - Engine validates ingress correctly
  - Audit entries emitted for all decisions

### T-7.2: Add performance optimization [T]
- **File:** `src/sovereignty/engine.ts` (extend)
- **Test:** `src/sovereignty/engine.test.ts`
- **Dependencies:** T-7.1
- **Description:**
  - Pre-compile policy patterns on policy load
  - Cache compiled patterns in `CompiledPolicy` wrapper
  - Avoid allocations in hot path
  - Audit emit failure doesn't block validation (catch + log)
  - Target: p99 latency < 1ms
- **Acceptance:**
  - Benchmark: 10k validations in < 10s
  - Audit emit failure logged but doesn't throw
  - No per-envelope allocations for simple cases

---

## Group 8: Transport Wrapper — Middleware

### T-8.1: Implement SovereignTransport publish wrapper [T]
- **File:** `src/sovereignty/transport.ts`
- **Test:** `src/sovereignty/transport.test.ts`
- **Dependencies:** T-7.1
- **Description:**
  - Define `SovereignTransport` interface (extends TransportPublisher, TransportSubscriber, + engine accessor)
  - Define `SovereignTransportOptions` interface (transport, engine)
  - `createSovereignTransport(options)` factory
  - `publish(subject, envelope)`:
    1. Call `engine.validateEgress(envelope, subject)`
    2. If invalid: emit structured nak, throw with reason
    3. If valid: delegate to underlying transport
- **Acceptance:**
  - Valid envelopes published to underlying transport
  - Invalid envelopes throw before reaching transport

### T-8.2: Implement subscribe handler wrapper [T]
- **File:** `src/sovereignty/transport.ts` (extend)
- **Test:** `src/sovereignty/transport.test.ts`
- **Dependencies:** T-8.1
- **Description:**
  - `subscribe(subject, handler, options)`:
    1. Wrap handler with validation
    2. On message: call `engine.validateIngress(envelope, subject)`
    3. If invalid: nak with structured reason, don't call handler
    4. If valid: call original handler
  - `subscribeBestEffort(subject, handler)`:
    1. Same validation, but drop invalid (no nak)
  - Preserve JetStream ack/nak semantics
- **Acceptance:**
  - Handler not called for blocked envelopes
  - JetStream durables work correctly
  - Best effort drops silently

### T-8.3: Add structured nak emission [T]
- **File:** `src/sovereignty/transport.ts` (extend)
- **Test:** `src/sovereignty/transport.test.ts`
- **Dependencies:** T-8.2
- **Description:**
  - On validation failure, emit structured nak:
    ```typescript
    { 
      type: 'compliance-block',
      reason: result.reason,
      code: result.code,
      envelope_id: envelope.id,
      timestamp: new Date().toISOString()
    }
    ```
  - Align with F-22 structured nak reasons pattern
  - Nak subjects: `_nak.sovereignty.egress.<envelope_id>` or `_nak.sovereignty.ingress.<envelope_id>`
- **Acceptance:**
  - Nak contains machine-readable code from NakReasonCode
  - Nak published to predictable subject
  - Consumer can filter naks by direction

---

## Group 9: NSC Integration — Federation Setup

### T-9.1: Implement NSC command generation [T]
- **File:** `src/sovereignty/nsc.ts`
- **Test:** `src/sovereignty/nsc.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  - `generateExportCommands(policy: SovereigntyPolicy)` → string[]
    - Generate `nsc add export` commands for subjects we export
  - `generateImportCommands(mapping: ScopeMapping)` → string[]
    - Generate `nsc add import` commands for partner mappings
  - Commands must be idempotent (safe to run multiple times)
  - No subprocess execution — just command string generation
- **Acceptance:**
  - Generated commands are valid `nsc` syntax
  - Commands match examples in spec
  - Idempotent (running twice doesn't break)

### T-9.2: Document operator workflow [T]
- **File:** `docs/sovereignty-operator.md`
- **Test:** none
- **Dependencies:** T-9.1
- **Description:**
  - Document KV bucket provisioning:
    ```bash
    nats kv add SOVEREIGNTY_POLICY
    nats kv put SOVEREIGNTY_POLICY config '{ ... }'
    ```
  - Document NSC workflow for federation setup
  - Document policy update procedure (hot reload)
  - Document failure recovery (missing policy, invalid policy)
- **Acceptance:** Operator can follow guide to set up sovereignty

---

## Group 10: Documentation & Integration

### T-10.1: Write sovereignty documentation
- **File:** `docs/sovereignty.md`
- **Test:** none
- **Dependencies:** T-9.2
- **Description:**
  - Overview: what sovereignty engine does
  - Policy format with complete examples
  - Validation flow diagrams (egress, ingress)
  - Error codes reference (all NakReasonCode values)
  - Performance characteristics
  - Integration with chain-of-stamps
- **Acceptance:** Documentation covers all spec use cases

### T-10.2: Export sovereignty module from package [P with T-10.1]
- **File:** `src/index.ts`, `src/sovereignty/index.ts`
- **Test:** none (export only)
- **Dependencies:** T-8.3
- **Description:**
  - Update `src/sovereignty/index.ts` with all exports:
    - Types: SovereigntyPolicy, EgressRule, ScopeMapping, AuditEntry, ValidationResult, NakReasonCode
    - Factories: createPolicyStore, createAuditLog, createSovereigntyEngine, createSovereignTransport
    - Schemas: SovereigntyPolicySchema
    - NSC: generateExportCommands, generateImportCommands
  - Update `src/index.ts`:
    ```typescript
    export * from './sovereignty';
    ```
- **Acceptance:** All sovereignty exports available from `@the-metafactory/myelin`

### T-10.3: Write integration test [T]
- **File:** `src/sovereignty/integration.test.ts`
- **Test:** (this is the test)
- **Dependencies:** T-8.3, T-10.2
- **Description:**
  - End-to-end test with real NATS:
    1. Provision policy in KV
    2. Create sovereignty engine
    3. Wrap transport with SovereignTransport
    4. Publish valid local envelope → succeeds
    5. Publish local envelope to federated subject → blocked
    6. Receive valid federated envelope → delivered
    7. Receive unknown principal envelope → blocked
    8. Verify audit entries in JetStream
  - Test hot reload:
    1. Update policy in KV
    2. Wait 100ms
    3. Verify new rules take effect
- **Acceptance:**
  - Full round-trip egress validation works
  - Full round-trip ingress validation works
  - Audit trail complete
  - Hot reload functional

---

## Execution Order

```
Phase 1 (Foundation):
├── T-1.1 (types) ──────┬──► T-1.3 (index)
├── T-1.2 (schemas) ────┘   
│   [T-1.1 and T-1.2 can run in parallel]

Phase 2 (Policy Store):
└── T-2.1 (factory) ──► T-2.2 (KV load) ──► T-2.3 (hot reload)

Phase 3 (Audit Log):
└── T-3.1 (stream) ──► T-3.2 (emit)

Phase 4 (Egress):
├── T-4.1 (classification) ──┬
├── T-4.2 (glob patterns) ───┼──► T-4.3 (data residency)
│   [T-4.1 and T-4.2 can run in parallel]

Phase 5 (Ingress):
└── T-5.1 (scope lookup) ──► T-5.2 (scope ceiling) ──► T-5.3 (rejection)

Phase 6 (Chain-of-Stamps):
└── T-6.1 (chain verification)
    [Requires myelin#31 merged]

Phase 7 (Engine):
└── T-7.1 (orchestration) ──► T-7.2 (performance)

Phase 8 (Transport):
└── T-8.1 (publish wrapper) ──► T-8.2 (subscribe wrapper) ──► T-8.3 (structured nak)

Phase 9 (NSC):
└── T-9.1 (command generation) ──► T-9.2 (operator docs)

Phase 10 (Integration):
├── T-10.1 (docs) ──────┬
├── T-10.2 (exports) ───┼──► T-10.3 (integration test)
│   [T-10.1 and T-10.2 can run in parallel]
```

### Parallelization Summary

| Group | Parallelizable Tasks |
|-------|---------------------|
| 1 | T-1.1 + T-1.2 |
| 2 | None (sequential) |
| 3 | None (sequential) |
| 4 | T-4.1 + T-4.2 |
| 5 | None (sequential) |
| 6 | None (single task) |
| 7 | None (sequential) |
| 8 | None (sequential) |
| 9 | None (sequential) |
| 10 | T-10.1 + T-10.2 |

### Critical Path

T-1.1 → T-2.1 → T-2.2 → T-2.3 → T-7.1 → T-8.1 → T-8.2 → T-10.3

### Cross-Group Parallelization

Groups 2, 3, 4, 5 can run in parallel after Group 1 completes:
- Policy Store (Group 2) is independent
- Audit Log (Group 3) is independent
- Egress validators (Group 4) only need types
- Ingress validators (Group 5) only need types + egress glob utility

Group 6 requires external dependency (myelin#31).

---

## Validation Checklist

### Phase 1-3 Complete When:
- [ ] `SovereigntyPolicy` type exported from `@the-metafactory/myelin`
- [ ] Policy loads from KV bucket with Zod validation
- [ ] Policy hot-reload works within 100ms
- [ ] Audit entries written to JetStream

### Phase 4-5 Complete When:
- [ ] `local` envelopes blocked from federated subjects
- [ ] Data residency constraints enforced
- [ ] Unknown principals rejected
- [ ] Scope ceiling enforced on federated principals

### Phase 6-7 Complete When:
- [ ] Chain-of-stamps verification working (if #31 merged)
- [ ] Engine p99 latency < 1ms
- [ ] Audit emit failure doesn't block validation

### Phase 8 Complete When:
- [ ] SovereignTransport wraps publish with validation
- [ ] SovereignTransport wraps subscribe with validation
- [ ] Structured nak emitted with machine-readable code
- [ ] All existing transport tests pass with wrapper

### Phase 9-10 Complete When:
- [ ] NSC commands generated correctly
- [ ] Operator documentation covers setup workflow
- [ ] Integration test passes end-to-end
- [ ] All exports available from package

---

## External Dependencies

| Dependency | Required By | Status |
|------------|-------------|--------|
| myelin#31 chain-of-stamps | T-6.1 | Merged |
| NATS JetStream | T-2.*, T-3.* | Available |
| zod | T-1.2 | Check if installed |

## Files Created (Summary)

```
src/sovereignty/
├── index.ts                 # T-1.3, T-10.2
├── types.ts                 # T-1.1
├── types.test.ts            # T-1.1
├── schema.ts                # T-1.2
├── schema.test.ts           # T-1.2
├── policy-store.ts          # T-2.1, T-2.2, T-2.3
├── policy-store.test.ts     # T-2.1, T-2.2, T-2.3
├── audit-log.ts             # T-3.1, T-3.2
├── audit-log.test.ts        # T-3.1, T-3.2
├── engine.ts                # T-7.1, T-7.2
├── engine.test.ts           # T-7.1, T-7.2
├── transport.ts             # T-8.1, T-8.2, T-8.3
├── transport.test.ts        # T-8.1, T-8.2, T-8.3
├── nsc.ts                   # T-9.1
├── nsc.test.ts              # T-9.1
├── integration.test.ts      # T-10.3
└── validators/
    ├── egress.ts            # T-4.1, T-4.2, T-4.3
    ├── egress.test.ts       # T-4.1, T-4.2, T-4.3
    ├── ingress.ts           # T-5.1, T-5.2, T-5.3
    ├── ingress.test.ts      # T-5.1, T-5.2, T-5.3
    ├── chain.ts             # T-6.1
    └── chain.test.ts        # T-6.1

docs/
├── sovereignty.md           # T-10.1
└── sovereignty-operator.md  # T-9.2

src/index.ts                 # T-10.2 (modify)
```

## Test Vectors (from plan)

### Egress: Classification Mismatch
```typescript
// T-4.1 test case
const envelope = createEnvelope({
  source: 'metafactory.echo.local',
  type: 'task.review',
  sovereignty: { classification: 'local', data_residency: 'CH', max_hop: 0, frontier_ok: false, model_class: 'local-only' },
  payload: { pr: 123 },
});
const result = await engine.validateEgress(envelope, 'federated.metafactory.tasks.review');
expect(result.valid).toBe(false);
expect(result.code).toBe('compliance-block:classification-mismatch');
```

### Ingress: Unknown Principal
```typescript
// T-5.3 test case
const envelope = createSignedEnvelope({
  source: 'operator-b.rogue.instance',
  type: 'task.claim',
  sovereignty: { classification: 'federated', ... },
  payload: {},
}, { did: 'did:mf:rogue', privateKey: '...' });
const result = await engine.validateIngress(envelope, 'federated.operator-b.tasks.claim');
expect(result.valid).toBe(false);
expect(result.code).toBe('compliance-block:unknown-principal');
```
