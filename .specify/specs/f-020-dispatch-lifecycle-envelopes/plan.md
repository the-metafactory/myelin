# Technical Plan: F-020 — Dispatch Lifecycle Envelopes

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              OPERATOR BOUNDARY                                   │
│                                                                                  │
│  ┌──────────────┐    emitLifecycleEvent()    ┌─────────────────────────────────┐│
│  │   Agent      │───────────────────────────▶│  NATS JetStream                 ││
│  │   Runtime    │                            │  EVENTS stream                   ││
│  │              │                            │  local.{org}.dispatch.task.>     ││
│  └──────────────┘                            └──────────────┬──────────────────┘│
│        │                                                    │                    │
│        │ Task lifecycle:                                    │                    │
│        │  received → assigned →                             ▼                    │
│        │  started → progress → completed                                         │
│        │                ↘ failed                  ┌─────────────────────────────┐│
│        │                ↘ aborted                 │  Consumers                  ││
│        │                                          │  • Orchestrator (cortex M7) ││
│        │                                          │  • Operator UI              ││
│  ┌─────┴────────┐                                 │  • Threshold-review         ││
│  │ correlation_id                                 │  • Dead-letter handler      ││
│  │ (invariant)  │                                 │  • Replay consumers         ││
│  └──────────────┘                                 └─────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

Lifecycle State Machine:
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│                         ┌──────────┐                                            │
│                         │ received │                                            │
│                         └────┬─────┘                                            │
│                              │                                                   │
│                              ▼                                                   │
│                         ┌──────────┐                                            │
│                         │ assigned │◀───────────────────────────────────┐       │
│                         └────┬─────┘                                    │       │
│                              │                                          │       │
│              ┌───────────────┼───────────────┐                          │       │
│              │               │               │                          │       │
│              │ (Broadcast/   │ (Delegate)    │                          │       │
│              │  Direct)      ▼               │                          │       │
│              │          ┌─────────┐          │                          │       │
│              │          │ started │          │                          │       │
│              │          └────┬────┘          │                          │       │
│              │               │               │                          │       │
│              │               ▼               │                          │       │
│              │          ┌──────────┐         │                          │       │
│              │          │ progress │─────────┘   (loops for updates)    │       │
│              │          └────┬─────┘                                    │       │
│              │               │                                          │       │
│              └───────────────┴───────────────┐                          │       │
│                                              │                          │       │
│              ┌───────────────┬───────────────┼───────────────┐          │       │
│              ▼               ▼               ▼               ▼          │       │
│         ┌──────────┐   ┌─────────┐     ┌─────────┐     ┌─────────┐      │       │
│         │completed │   │ failed  │     │ aborted │     │ nak'd   │──────┘       │
│         │(terminal)│   │(terminal│     │(terminal│     │(redeliver)             │
│         └──────────┘   └─────────┘     └─────────┘     └─────────┘              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Transport | NATS JetStream | Already in `src/transport/nats.ts`, durable streaming |
| Schema validation | Zod | Existing pattern from envelope validation |
| ID generation | `crypto.randomUUID()` | Already used in `createEnvelope()` |
| Timestamps | ISO-8601 | Existing pattern |
| Signing | Ed25519 via `@noble/ed25519` | MY-400 identity integration |

**No new dependencies** — builds on existing myelin stack.

## Data Model

### Lifecycle State Enum

```typescript
// src/dispatch/types.ts

export type LifecycleState =
  | 'received'    // Task entered the system
  | 'assigned'    // Agent claimed the task
  | 'started'     // Agent began execution (Delegate only)
  | 'progress'    // Mid-flight update (Delegate only)
  | 'completed'   // Terminal: success
  | 'failed'      // Terminal: failure
  | 'aborted';    // Terminal: operator interrupt or timeout

export type DistributionMode = 'broadcast' | 'direct' | 'delegate';

export type NakReason =
  | 'cant-do'          // Static capability mismatch
  | 'wont-do'          // Sovereignty/policy refusal
  | 'not-now'          // Load/availability
  | 'compliance-block' // M7 attestation violation
;

export type AbortReason = 'operator-interrupt' | 'timeout' | 'dependency-failed';

export type ProgressSeverity = 'info' | 'warn' | 'escalate';
```

### Base Lifecycle Envelope

```typescript
// src/dispatch/types.ts

import type { MyelinEnvelope } from '../types';

/**
 * All lifecycle events extend MyelinEnvelope with a type pattern:
 * `dispatch.task.{state}` where state is one of LifecycleState.
 */
export interface DispatchLifecycleEnvelope extends MyelinEnvelope {
  type: `dispatch.task.${LifecycleState}`;
  payload: BaseLifecyclePayload & StateSpecificPayload;
}

/** Fields common to ALL lifecycle events */
export interface BaseLifecyclePayload {
  /** UUID — invariant across all events for a single task */
  correlation_id: string;
  /** Original task identifier */
  task_id: string;
  /** Distribution mode from original task */
  distribution_mode: DistributionMode;
  /** ISO-8601 event timestamp */
  timestamp: string;
}
```

### State-Specific Payloads

```typescript
// src/dispatch/types.ts

/** received — task entered routing */
export interface ReceivedPayload extends BaseLifecyclePayload {
  requirements: string[];           // Capability tags required
  target_principal?: string;        // For Direct/Delegate: specific agent DID
  deadline?: string;                // ISO-8601 optional deadline
}

/** assigned — agent claimed */
export interface AssignedPayload extends BaseLifecyclePayload {
  principal: string;                // DID of claiming agent
  claimed_at: string;               // ISO-8601
}

/** started — execution began (Delegate mode) */
export interface StartedPayload extends BaseLifecyclePayload {
  principal: string;
}

/** progress — mid-flight (Delegate mode) */
export interface ProgressPayload extends BaseLifecyclePayload {
  principal: string;
  message: string;                  // Human-readable progress
  severity: ProgressSeverity;       // info | warn | escalate
  step?: number;                    // Optional: current step
  total_steps?: number;             // Optional: total steps
  sub_correlation_id?: string;      // When fanning out sub-tasks
}

/** completed — terminal success */
export interface CompletedPayload extends BaseLifecyclePayload {
  principal: string;
  result?: unknown;                 // Task-specific result
  // Economics (optional per Decision Q4)
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
}

/** failed — terminal failure */
export interface FailedPayload extends BaseLifecyclePayload {
  principal?: string;               // May be unassigned at failure
  nak_reason?: NakReason;
  error?: string;                   // Human-readable error
  error_code?: string;              // Machine-parseable error code
  retries_exhausted?: boolean;      // True if max_deliver reached
}

/** aborted — terminal interrupt */
export interface AbortedPayload extends BaseLifecyclePayload {
  principal?: string;
  reason: AbortReason;
  aborted_by?: string;              // DID of aborting principal (if operator)
}

/** Union of all payload types for type discrimination */
export type LifecyclePayload =
  | ReceivedPayload
  | AssignedPayload
  | StartedPayload
  | ProgressPayload
  | CompletedPayload
  | FailedPayload
  | AbortedPayload;
```

### Helper Types for Event Creation

```typescript
// src/dispatch/types.ts

/** Input for creating lifecycle events — correlates with emitLifecycleEvent() */
export interface EmitLifecycleInput<S extends LifecycleState> {
  state: S;
  correlation_id: string;
  task_id: string;
  distribution_mode: DistributionMode;
  payload: StatePayloadMap[S];
}

/** Maps lifecycle state to its specific payload type */
export type StatePayloadMap = {
  received: Omit<ReceivedPayload, keyof BaseLifecyclePayload>;
  assigned: Omit<AssignedPayload, keyof BaseLifecyclePayload>;
  started: Omit<StartedPayload, keyof BaseLifecyclePayload>;
  progress: Omit<ProgressPayload, keyof BaseLifecyclePayload>;
  completed: Omit<CompletedPayload, keyof BaseLifecyclePayload>;
  failed: Omit<FailedPayload, keyof BaseLifecyclePayload>;
  aborted: Omit<AbortedPayload, keyof BaseLifecyclePayload>;
};
```

## API Contracts

### Core Emission Function

```typescript
// src/dispatch/lifecycle.ts

import type { MyelinEnvelope, Sovereignty } from '../types';
import type { TransportPublisher } from '../transport/types';
import type { SigningIdentity } from '../identity/types';
import type { LifecycleState, EmitLifecycleInput } from './types';

export interface LifecycleEmitterOptions {
  /** NATS transport for publishing */
  transport: TransportPublisher;
  /** Org namespace for subject construction (e.g., "metafactory") */
  org: string;
  /** Sovereignty defaults for lifecycle envelopes */
  sovereignty: Sovereignty;
  /** Optional signing identity — if provided, envelopes are signed */
  identity?: SigningIdentity;
}

/**
 * Create a lifecycle emitter bound to a specific org and transport.
 * Returns a function that emits lifecycle events to the correct subject.
 */
export function createLifecycleEmitter(options: LifecycleEmitterOptions): LifecycleEmitter;

export interface LifecycleEmitter {
  /**
   * Emit a lifecycle event to JetStream.
   * Subject: local.{org}.dispatch.task.{state}
   * Returns the created envelope for chaining/logging.
   */
  emit<S extends LifecycleState>(input: EmitLifecycleInput<S>): Promise<MyelinEnvelope>;

  /** Convenience: emit 'received' event */
  received(taskId: string, correlationId: string, mode: DistributionMode, requirements: string[], options?: { target_principal?: string; deadline?: string }): Promise<MyelinEnvelope>;

  /** Convenience: emit 'assigned' event */
  assigned(correlationId: string, taskId: string, mode: DistributionMode, principal: string): Promise<MyelinEnvelope>;

  /** Convenience: emit 'started' event (Delegate only) */
  started(correlationId: string, taskId: string, principal: string): Promise<MyelinEnvelope>;

  /** Convenience: emit 'progress' event (Delegate only) */
  progress(correlationId: string, taskId: string, principal: string, message: string, options?: { severity?: ProgressSeverity; step?: number; total_steps?: number; sub_correlation_id?: string }): Promise<MyelinEnvelope>;

  /** Convenience: emit 'completed' event */
  completed(correlationId: string, taskId: string, principal: string, options?: { result?: unknown; input_tokens?: number; output_tokens?: number; duration_ms?: number }): Promise<MyelinEnvelope>;

  /** Convenience: emit 'failed' event */
  failed(correlationId: string, taskId: string, options?: { principal?: string; nak_reason?: NakReason; error?: string; error_code?: string; retries_exhausted?: boolean }): Promise<MyelinEnvelope>;

  /** Convenience: emit 'aborted' event (Delegate only) */
  aborted(correlationId: string, taskId: string, reason: AbortReason, options?: { principal?: string; aborted_by?: string }): Promise<MyelinEnvelope>;
}
```

### Subject Derivation

```typescript
// src/dispatch/lifecycle.ts

/**
 * Derive NATS subject for lifecycle event.
 * Pattern: local.{org}.dispatch.task.{state}
 */
export function deriveLifecycleSubject(org: string, state: LifecycleState): string {
  return `local.${org}.dispatch.task.${state}`;
}

/**
 * Derive wildcard subject for all lifecycle events.
 * Pattern: local.{org}.dispatch.task.>
 */
export function deriveLifecycleWildcard(org: string): string {
  return `local.${org}.dispatch.task.>`;
}
```

### Correlation ID Generation

```typescript
// src/dispatch/correlation.ts

/**
 * Generate a new correlation ID for a task lifecycle.
 * All events for the same task MUST share this ID.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Validate a correlation ID format.
 */
export function isValidCorrelationId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
```

### Consumer Helper

```typescript
// src/dispatch/lifecycle.ts

import type { SubscribeOptions, Subscription } from '../transport/types';

/**
 * Subscribe to lifecycle events with optional state filter.
 * Uses JetStream durable consumers for replay capability.
 */
export function subscribeLifecycle(
  transport: TransportSubscriber,
  org: string,
  handler: (envelope: DispatchLifecycleEnvelope) => Promise<void>,
  options?: {
    /** Filter to specific states (default: all) */
    states?: LifecycleState[];
    /** Durable consumer name for replay */
    durableName?: string;
    /** Delivery policy: 'all' for replay, 'new' for live only */
    deliverPolicy?: 'all' | 'new';
  }
): Promise<Subscription>;
```

## Implementation Phases

### Phase 1: Types + Subject Derivation (Day 1)

**Files created:**
- `src/dispatch/types.ts` — All lifecycle types, state enums, payload interfaces
- `src/dispatch/correlation.ts` — Correlation ID generation/validation
- `src/dispatch/index.ts` — Module exports

**Tasks:**
1. Define `LifecycleState` enum
2. Define `DistributionMode` type (shared with F-021)
3. Define `NakReason` type (shared with F-022)
4. Define `ProgressSeverity` type
5. Define `AbortReason` type
6. Define all payload interfaces
7. Define `EmitLifecycleInput` helper type
8. Implement `generateCorrelationId()` and `isValidCorrelationId()`
9. Write unit tests for correlation ID

### Phase 2: Lifecycle Emitter (Day 1-2)

**Files created:**
- `src/dispatch/lifecycle.ts` — Emitter implementation
- `src/dispatch/lifecycle.test.ts` — Unit tests

**Tasks:**
1. Implement `deriveLifecycleSubject()`
2. Implement `deriveLifecycleWildcard()`
3. Implement `createLifecycleEmitter()` factory
4. Implement `emit()` method — builds envelope, signs (if identity provided), publishes
5. Implement convenience methods: `received()`, `assigned()`, `started()`, `progress()`, `completed()`, `failed()`, `aborted()`
6. Add emission rules enforcement:
   - `started`, `progress`, `aborted` only for Delegate mode
   - `target_principal` required for Direct/Delegate in `received`
7. Write unit tests with InMemoryTransport

### Phase 3: Validation (Day 2)

**Files modified:**
- `src/envelope.ts` — Add dispatch.task.* type pattern validation

**Tasks:**
1. Add `dispatch.task.*` type pattern to allowed envelope types
2. Add validation for lifecycle payloads when type matches `dispatch.task.*`
3. Validate `correlation_id` is present and valid UUID for lifecycle envelopes
4. Validate state-specific required fields
5. Write validation tests

### Phase 4: Consumer Helper (Day 2)

**Files modified:**
- `src/dispatch/lifecycle.ts` — Add `subscribeLifecycle()`

**Tasks:**
1. Implement `subscribeLifecycle()` with state filtering
2. Parse and typecheck incoming envelopes as `DispatchLifecycleEnvelope`
3. Support durable consumers for replay
4. Write consumer tests with InMemoryTransport

### Phase 5: JetStream EVENTS Stream Config (Day 3)

**Files created:**
- `src/dispatch/stream.ts` — EVENTS stream configuration helper

**Tasks:**
1. Document EVENTS stream configuration:
   ```typescript
   {
     name: "EVENTS",
     subjects: ["local.*.dispatch.task.>"],
     retention: "limits",
     max_age: 7 * 24 * 60 * 60 * 1e9, // 7 days in nanos
     storage: "file",
     discard: "old"
   }
   ```
2. Implement `ensureEventsStream()` helper
3. Integration test: emit → consume round-trip with NATSTransport

### Phase 6: Integration + Export (Day 3)

**Files modified:**
- `src/index.ts` — Export dispatch module

**Tasks:**
1. Export all dispatch types
2. Export `createLifecycleEmitter`, `subscribeLifecycle`
3. Export `generateCorrelationId`, `isValidCorrelationId`
4. Export `NakReason` enum (shared with F-022)
5. Write integration test: full lifecycle emit/consume with signing

### Phase 7: Documentation (Day 3)

**Files created:**
- `docs/dispatch-lifecycle.md` — Usage documentation

**Tasks:**
1. Document lifecycle state machine
2. Document subject naming convention
3. Document `correlation_id` invariant
4. Document emission rules per distribution mode
5. Add worked example (Pilot review loop)

## File Structure

```
src/
├── dispatch/
│   ├── index.ts              # Module exports
│   ├── types.ts              # Lifecycle types, payloads, state enum
│   ├── correlation.ts        # correlation_id generation/validation
│   ├── correlation.test.ts   # Correlation tests
│   ├── lifecycle.ts          # Emitter, consumer, subject derivation
│   ├── lifecycle.test.ts     # Emitter/consumer tests
│   ├── stream.ts             # EVENTS stream config helper
│   └── stream.test.ts        # Stream config tests
├── envelope.ts               # (update: dispatch.task.* validation)
├── types.ts                  # (unchanged)
└── index.ts                  # (update: export dispatch module)

docs/
└── dispatch-lifecycle.md     # Lifecycle documentation
```

## Dependencies

### Runtime Dependencies

None — uses existing myelin stack.

### Internal Dependencies

| Module | Purpose |
|--------|---------|
| `src/types.ts` | `MyelinEnvelope`, `Sovereignty` |
| `src/envelope.ts` | `createEnvelope`, `createSignedEnvelope`, `validateEnvelope` |
| `src/transport/types.ts` | `TransportPublisher`, `TransportSubscriber` |
| `src/transport/nats.ts` | `NATSTransport` (for integration tests) |
| `src/transport/in-memory.ts` | `InMemoryTransport` (for unit tests) |
| `src/identity/types.ts` | `SigningIdentity` (optional signing) |
| `src/identity/sign.ts` | `signEnvelope` (optional signing) |

### External Prerequisites

| Prerequisite | Required By | Notes |
|--------------|-------------|-------|
| JetStream EVENTS stream | Production runtime | Stream created by cortex or `ensureEventsStream()` |
| Principal registry | Signed envelopes | For verification on consumer side |

### Cross-Feature Dependencies

| Feature | Relationship |
|---------|--------------|
| F-019 (TASKS stream) | Lifecycle events emitted when tasks flow through TASKS stream |
| F-021 (Task Envelope Extension) | `distribution_mode`, `requirements` sourced from task envelope |
| F-022 (Structured Nak Reasons) | `NakReason` type shared, `failed` payload includes nak reason |
| myelin#31 (Chain-of-stamps) | `correlation_id` + `sub_correlation_id` enable audit graph |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| JetStream EVENTS stream not created | High | Medium | Provide `ensureEventsStream()` helper; document pre-requisite |
| `correlation_id` not preserved across events | High | Low | Invariant enforced via emitter API; tests verify |
| Performance regression from signing | Low | Low | Signing is optional; Ed25519 ~50μs budget |
| Backwards compat: old envelopes without dispatch type | Low | Low | `dispatch.task.*` type pattern only validated for new events |
| Consumer replay misses events | Medium | Low | Durable consumer with `deliver_policy: "all"` |
| Emission rules violated (e.g., `progress` in Broadcast) | Medium | Medium | Runtime check in `emit()`; throw if violated |

## Emission Rules Matrix

| State | Broadcast | Direct | Delegate | Notes |
|-------|-----------|--------|----------|-------|
| received | Yes | Yes | Yes | `target_principal` required for Direct/Delegate |
| assigned | Yes | Yes | Yes | |
| started | No | No | Yes | Delegate-only |
| progress | No | No | Yes | Delegate-only; supports severity + sub_correlation_id |
| completed | Yes | Yes | Yes | Economics fields optional |
| failed | Yes | Yes | Yes | Includes `nak_reason` |
| aborted | No | No | Yes | Delegate-only |

## Test Vectors

### Correlation ID Invariant Test

```typescript
// Verify all events for a task share correlation_id
const correlationId = generateCorrelationId();
const taskId = 'pilot-pr-32';

await emitter.received(taskId, correlationId, 'delegate', ['code-review'], { target_principal: 'did:mf:pilot' });
await emitter.assigned(correlationId, taskId, 'delegate', 'did:mf:pilot');
await emitter.started(correlationId, taskId, 'did:mf:pilot');
await emitter.progress(correlationId, taskId, 'did:mf:pilot', 'Requesting review', { severity: 'info' });
await emitter.completed(correlationId, taskId, 'did:mf:pilot', { input_tokens: 15420, output_tokens: 8200 });

// All published envelopes should have same correlation_id in payload
const events = transport.getPublished();
expect(events.every(e => e.payload.correlation_id === correlationId)).toBe(true);
```

### Emission Rules Enforcement Test

```typescript
// progress should throw for Broadcast mode
await expect(
  emitter.emit({
    state: 'progress',
    correlation_id: generateCorrelationId(),
    task_id: 'task-1',
    distribution_mode: 'broadcast', // ← invalid for progress
    payload: { principal: 'did:mf:pilot', message: 'update', severity: 'info' },
  })
).rejects.toThrow('progress state only valid for delegate mode');
```

### Subject Derivation Test

```typescript
expect(deriveLifecycleSubject('metafactory', 'received'))
  .toBe('local.metafactory.dispatch.task.received');

expect(deriveLifecycleSubject('metafactory', 'completed'))
  .toBe('local.metafactory.dispatch.task.completed');

expect(deriveLifecycleWildcard('metafactory'))
  .toBe('local.metafactory.dispatch.task.>');
```

### Round-Trip Test

```typescript
const emitter = createLifecycleEmitter({
  transport: natsTransport,
  org: 'metafactory',
  sovereignty: defaultSovereignty,
});

const received: DispatchLifecycleEnvelope[] = [];
await subscribeLifecycle(natsTransport, 'metafactory', async (env) => {
  received.push(env);
}, { durableName: 'test-consumer', deliverPolicy: 'all' });

await emitter.completed('corr-1', 'task-1', 'did:mf:pilot', { duration_ms: 5000 });

// Wait for delivery
await new Promise(r => setTimeout(r, 100));

expect(received.length).toBe(1);
expect(received[0].type).toBe('dispatch.task.completed');
expect(received[0].payload.correlation_id).toBe('corr-1');
```

## Worked Example: Pilot Review Loop

Per spec §Worked Example:

```typescript
const correlationId = generateCorrelationId();

// 1. Task received
await emitter.received(
  'pilot-pr-32',
  correlationId,
  'delegate',
  ['orchestration', 'code-review'],
  { target_principal: 'did:mf:pilot', deadline: '2026-05-10T18:00:00Z' }
);
// → local.metafactory.dispatch.task.received

// 2. Pilot claims
await emitter.assigned(correlationId, 'pilot-pr-32', 'delegate', 'did:mf:pilot');
// → local.metafactory.dispatch.task.assigned

// 3. Pilot starts
await emitter.started(correlationId, 'pilot-pr-32', 'did:mf:pilot');
// → local.metafactory.dispatch.task.started

// 4. Pilot fans out to Echo
const subCorrelationId = generateCorrelationId();
await emitter.progress(
  correlationId,
  'pilot-pr-32',
  'did:mf:pilot',
  'Requesting review from Echo',
  { severity: 'info', sub_correlation_id: subCorrelationId }
);
// → local.metafactory.dispatch.task.progress

// 5. (Echo's lifecycle events use subCorrelationId as their correlation_id)

// 6. Pilot pushes fix, requests re-review
await emitter.progress(
  correlationId,
  'pilot-pr-32',
  'did:mf:pilot',
  'Pushed fix, awaiting re-review',
  { severity: 'info', step: 2, total_steps: 3 }
);

// 7. PR approved, Pilot merges
await emitter.completed(
  correlationId,
  'pilot-pr-32',
  'did:mf:pilot',
  { input_tokens: 15420, output_tokens: 8200, duration_ms: 324000 }
);
// → local.metafactory.dispatch.task.completed
```

## Success Criteria Mapping

| Spec Criterion | Implementation |
|----------------|----------------|
| Lifecycle envelope types exported | `src/dispatch/types.ts` + `src/index.ts` exports |
| `correlation_id` generator utility | `src/dispatch/correlation.ts` |
| `emitLifecycleEvent(state, payload)` | `LifecycleEmitter.emit()` + convenience methods |
| JetStream EVENTS stream config | `src/dispatch/stream.ts` |
| Nak reason enum exported | `NakReason` type in `src/dispatch/types.ts` |
| Tests: emit→consume round-trip | `src/dispatch/lifecycle.test.ts` |
| Integration with chain-of-stamps | `sub_correlation_id` in `ProgressPayload` |

[PHASE COMPLETE: PLAN]
