# Implementation Tasks: F-020 — Dispatch Lifecycle Envelopes

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | |
| T-1.2 | ☐ | |
| T-1.3 | ☐ | |
| T-2.1 | ☐ | |
| T-2.2 | ☐ | |
| T-2.3 | ☐ | |
| T-3.1 | ☐ | |
| T-3.2 | ☐ | |
| T-4.1 | ☐ | |
| T-4.2 | ☐ | |
| T-5.1 | ☐ | |

---

## Group 1: Foundation — Types & Correlation

### T-1.1: Define lifecycle state and mode types [T]
- **File:** `src/dispatch/types.ts`
- **Test:** `src/dispatch/types.test.ts`
- **Dependencies:** none
- **Description:** Create type definitions:
  - `LifecycleState` union: `received | assigned | started | progress | completed | failed | aborted`
  - `DistributionMode` union: `broadcast | direct | delegate`
  - `NakReason` union: `cant-do | wont-do | not-now | compliance-block`
  - `AbortReason` union: `operator-interrupt | timeout | dependency-failed`
  - `ProgressSeverity` union: `info | warn | escalate`
  - Export all types

### T-1.2: Define payload interfaces [T] [P with T-1.1]
- **File:** `src/dispatch/types.ts`
- **Test:** `src/dispatch/types.test.ts`
- **Dependencies:** none
- **Description:** Create payload interfaces per spec:
  - `BaseLifecyclePayload` — common fields: `correlation_id`, `task_id`, `distribution_mode`, `timestamp`
  - `ReceivedPayload` — adds `requirements`, optional `target_principal`, `deadline`
  - `AssignedPayload` — adds `principal`, `claimed_at`
  - `StartedPayload` — adds `principal`
  - `ProgressPayload` — adds `principal`, `message`, `severity`, optional `step`, `total_steps`, `sub_correlation_id`
  - `CompletedPayload` — adds `principal`, optional `result`, `input_tokens`, `output_tokens`, `duration_ms`
  - `FailedPayload` — adds optional `principal`, `nak_reason`, `error`, `error_code`, `retries_exhausted`
  - `AbortedPayload` — adds `reason`, optional `principal`, `aborted_by`
  - `DispatchLifecycleEnvelope` extending `MyelinEnvelope`

### T-1.3: Implement correlation ID utilities [T] [P with T-1.1]
- **File:** `src/dispatch/correlation.ts`
- **Test:** `src/dispatch/correlation.test.ts`
- **Dependencies:** none
- **Description:** Implement correlation ID functions:
  - `generateCorrelationId()` — returns `crypto.randomUUID()`
  - `isValidCorrelationId(id: string)` — validates UUID format
  - Test: generation produces valid UUIDs, validation accepts/rejects correctly

---

## Group 2: Core — Lifecycle Emitter

### T-2.1: Implement subject derivation [T]
- **File:** `src/dispatch/lifecycle.ts`
- **Test:** `src/dispatch/lifecycle.test.ts`
- **Dependencies:** T-1.1
- **Description:** Subject derivation functions:
  - `deriveLifecycleSubject(org: string, state: LifecycleState)` → `local.{org}.dispatch.task.{state}`
  - `deriveLifecycleWildcard(org: string)` → `local.{org}.dispatch.task.>`
  - Test: all 7 states produce correct subjects

### T-2.2: Implement emission rules validation [T]
- **File:** `src/dispatch/lifecycle.ts`
- **Test:** `src/dispatch/lifecycle.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:** Emission rules matrix enforcement:
  - `validateEmissionRules(state: LifecycleState, mode: DistributionMode)` — throws if invalid
  - `started`, `progress`, `aborted` only valid for `delegate` mode
  - `target_principal` required in `received` for `direct`/`delegate`
  - Test: throw for invalid combinations, pass for valid

### T-2.3: Create lifecycle emitter factory [T]
- **File:** `src/dispatch/lifecycle.ts`
- **Test:** `src/dispatch/lifecycle.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-1.3, T-2.1, T-2.2
- **Description:** Implement `createLifecycleEmitter(options)`:
  - Options: `transport`, `org`, `sovereignty`, optional `identity`
  - Generic `emit<S extends LifecycleState>(input)` method — builds envelope, validates rules, signs if identity provided, publishes
  - Convenience methods: `received()`, `assigned()`, `started()`, `progress()`, `completed()`, `failed()`, `aborted()`
  - Uses `createSignedEnvelope()` from `src/envelope.ts` pattern
  - Test with `InMemoryTransport`: verify envelopes published to correct subjects, payloads correct, correlation_id invariant preserved

---

## Group 3: Validation & Consumer

### T-3.1: Add dispatch.task.* validation to envelope [T]
- **File:** `src/envelope.ts`
- **Test:** `src/envelope.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:** Extend `validateEnvelope()`:
  - Recognize `dispatch.task.*` type pattern
  - When matched: validate `correlation_id` required and valid UUID
  - Validate state-specific required fields per payload type
  - Add tests for lifecycle envelope validation

### T-3.2: Implement consumer helper [T]
- **File:** `src/dispatch/lifecycle.ts`
- **Test:** `src/dispatch/lifecycle.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-2.1
- **Description:** Implement `subscribeLifecycle()`:
  - Parameters: `transport`, `org`, `handler`, optional `states[]`, `durableName`, `deliverPolicy`
  - Builds subject filter from states (or wildcard for all)
  - Parses incoming envelopes, typecasts to `DispatchLifecycleEnvelope`
  - Returns `Subscription` for cleanup
  - Test: emit/consume round-trip with InMemoryTransport

---

## Group 4: Stream Config & Module Export

### T-4.1: Create EVENTS stream config helper [T]
- **File:** `src/dispatch/stream.ts`
- **Test:** `src/dispatch/stream.test.ts`
- **Dependencies:** T-2.1
- **Description:** JetStream stream configuration:
  - `getEventsStreamConfig(org: string)` — returns stream config object:
    ```typescript
    {
      name: "EVENTS",
      subjects: [`local.${org}.dispatch.task.>`],
      retention: "limits",
      max_age: 7 * 24 * 60 * 60 * 1e9,  // 7 days nanos
      storage: "file",
      discard: "old"
    }
    ```
  - `ensureEventsStream(nc, org)` — creates stream if not exists (for integration tests)
  - Unit test: config structure correct

### T-4.2: Wire dispatch module exports [T]
- **File:** `src/dispatch/index.ts` (new)
- **File:** `src/index.ts` (update)
- **Test:** Build verification
- **Dependencies:** T-1.1, T-1.2, T-1.3, T-2.3, T-3.2, T-4.1
- **Description:** Export dispatch module:
  - `src/dispatch/index.ts`: re-export all types, functions from module files
  - `src/index.ts`: add dispatch exports:
    - Types: `LifecycleState`, `DistributionMode`, `NakReason`, `ProgressSeverity`, `AbortReason`, all payload interfaces, `DispatchLifecycleEnvelope`
    - Functions: `createLifecycleEmitter`, `subscribeLifecycle`, `generateCorrelationId`, `isValidCorrelationId`, `deriveLifecycleSubject`, `deriveLifecycleWildcard`
  - Verify: `bun run build` succeeds, types importable

---

## Group 5: Integration & Documentation

### T-5.1: Write dispatch lifecycle documentation
- **File:** `docs/dispatch-lifecycle.md`
- **Test:** N/A
- **Dependencies:** T-2.3, T-3.2
- **Description:** Create usage documentation:
  - Lifecycle state machine diagram (ASCII)
  - Subject naming convention
  - `correlation_id` invariant explanation
  - Emission rules per distribution mode table
  - Worked example: Pilot review loop (from spec)
  - Consumer setup for replay
  - Integration with chain-of-stamps (reference myelin#31)

---

## Execution Order

```
Phase 1 (parallel):
├── T-1.1 (types)
├── T-1.2 (payloads)  
└── T-1.3 (correlation)

Phase 2 (sequential after Phase 1):
├── T-2.1 (subject derivation)
├── T-2.2 (emission rules)
└── T-2.3 (emitter factory)

Phase 3 (after T-2.3):
├── T-3.1 (envelope validation)
└── T-3.2 (consumer helper)

Phase 4 (after Phase 3):
├── T-4.1 (stream config)
└── T-4.2 (module exports)

Phase 5 (after Phase 4):
└── T-5.1 (documentation)
```

---

## Test Vectors (Reference)

### Correlation ID Invariant
```typescript
const correlationId = generateCorrelationId();
await emitter.received('task-1', correlationId, 'delegate', ['cap'], { target_principal: 'did:mf:pilot' });
await emitter.assigned(correlationId, 'task-1', 'delegate', 'did:mf:pilot');
await emitter.completed(correlationId, 'task-1', 'did:mf:pilot');
// All events must share same correlation_id
```

### Emission Rules Enforcement
```typescript
// Should throw: progress invalid for broadcast
await expect(
  emitter.emit({ state: 'progress', distribution_mode: 'broadcast', ... })
).rejects.toThrow('progress state only valid for delegate mode');
```

### Subject Derivation
```typescript
expect(deriveLifecycleSubject('metafactory', 'received'))
  .toBe('local.metafactory.dispatch.task.received');
```

---

## Success Criteria Mapping

| Spec Criterion | Task |
|----------------|------|
| Lifecycle envelope types exported | T-1.1, T-1.2, T-4.2 |
| `correlation_id` generator utility | T-1.3 |
| `emitLifecycleEvent(state, payload)` | T-2.3 |
| JetStream EVENTS stream config | T-4.1 |
| Nak reason enum exported | T-1.1, T-4.2 |
| Tests: emit→consume round-trip | T-2.3, T-3.2 |
| Integration with chain-of-stamps | T-5.1 (docs reference) |
